import { Agent, BeforeToolCallEvent, ModelMessageEvent, tool } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { z } from "zod";
import type { Clothing, IncomingEvent, NightState, Snapshot, StreamItem } from "./types";
import { deviceById, timeLabel, type Household } from "./household";
import type { Assessment } from "./rules";
import type { RingClient } from "./ring/client";
import { describeClothing, clothingSentence } from "./vision";
import { sensitiveTerm } from "./privacy";

const MAX_TOOL_CALLS = 12;

function model() {
  return new OpenAIModel({
    api: "chat",
    apiKey: process.env.OPENAI_API_KEY,
    modelId: process.env.OPENAI_MODEL,
    maxTokens: 700,
    clientConfig: { baseURL: process.env.OPENAI_BASE_URL, timeout: 45_000, maxRetries: 1 },
    params: { temperature: 0, chat_template_kwargs: { enable_thinking: false } },
  });
}

const visible = (v: string | undefined) => !!v && !/^none visible|^not described/i.test(v);

/** Prefer the closer door-camera description, fill gaps from the later camera. */
function mergeClothing(door: Clothing | undefined, later: Clothing | undefined): Clothing | undefined {
  if (!door) return later;
  if (!later) return door;
  const pick = (k: keyof Clothing) => (visible(door[k]) ? door[k] : later[k]);
  return { top: pick("top"), bottom: pick("bottom"), footwear: pick("footwear"), headwear: pick("headwear"), carrying: pick("carrying"), direction: later.direction };
}

export async function runNightDoorAgent(opts: {
  h: Household;
  state: NightState;
  event: IncomingEvent;
  assessment: Assessment;
  ring: RingClient;
  emit: (item: StreamItem) => void;
}): Promise<{ modelCalls: number }> {
  const { h, state, event, assessment, ring, emit } = opts;
  const now = event.timestamp;
  const at = timeLabel(h, now);
  const protocol = assessment.protocol;
  const done = new Set<string>();
  const ctx: { snapshot?: Snapshot; dataUri?: string; clothing?: Clothing } = {};
  const onDuty = h.members.find((m) => m.onDuty) ?? h.members[0];
  const chimeDevice = h.devices.find((d) => d.kind === "chime");
  const eventDevice = "deviceId" in event ? deviceById(h, event.deviceId) : undefined;
  const expectedLevel = protocol.includes("escalate_incident") ? "urgent" : protocol.includes("confirm_check_in") ? "info" : "check";
  let toolCalls = 0;
  let modelCalls = 0;

  const tools = [
    tool({
      name: "get_snapshot",
      description: "Download the current snapshot from a Ring camera (Ring API POST /v1/devices/{device_id}/media/image/download).",
      inputSchema: z.object({ device_id: z.string().describe("Ring device id from the protocol") }),
      callback: async ({ device_id }) => {
        const d = deviceById(h, device_id);
        if (!d) return { error: `Unknown device ${device_id}` };
        const img = await ring.downloadSnapshot(device_id, 0);
        ctx.snapshot = { id: `snap-${device_id}-${now}`, deviceId: device_id, deviceName: d.name, capturedAt: now, src: img.src };
        ctx.dataUri = img.dataUri;
        done.add("get_snapshot");
        emit({ t: "tool_result", name: "get_snapshot", summary: `${d.name} snapshot · ${img.mime} · ${Math.round(img.bytes / 1024)} KB`, image: img.src });
        return { snapshot_id: ctx.snapshot.id, device_name: d.name, captured_at: at };
      },
    }),
    tool({
      name: "describe_clothing",
      description: "Describe only the clothing, carried items and direction of the person in a snapshot. Never identifies anyone.",
      inputSchema: z.object({ snapshot_id: z.string() }),
      callback: async () => {
        if (!ctx.dataUri) return { error: "Call get_snapshot first" };
        const { clothing, redactions, ms } = await describeClothing(ctx.dataUri);
        ctx.clothing = clothing;
        if (state.incident && state.incident.status === "watching" && eventDevice?.role === "exit_door") {
          state.incident.clothing = clothing;
          state.incident.doorSnapshot = ctx.snapshot;
        }
        done.add("describe_clothing");
        emit({
          t: "tool_result",
          name: "describe_clothing",
          summary: `${clothingSentence(clothing)} · ${clothing.direction} (${(ms / 1000).toFixed(1)}s)${redactions.length ? ` · privacy rule removed ${redactions.join(", ")}` : ""}`,
        });
        return { ...clothing, privacy_redactions: redactions.length };
      },
    }),
    tool({
      name: "play_chime_message",
      description: "Play a family member's pre-recorded calm voice message on the home's Ring Chime (Ring API POST /v1/devices/{device_id}/media/audio/playback).",
      inputSchema: z.object({ audio_ref: z.string() }),
      callback: async ({ audio_ref }) => {
        const msg = h.chimeMessages.find((m) => m.audioRef === audio_ref);
        if (!msg || !chimeDevice) return { error: `Unknown audio_ref ${audio_ref}` };
        const res = await ring.playChimeAudio(chimeDevice.id, audio_ref, [0]);
        state.chimes.push({ at: now, deviceId: chimeDevice.id, audioRef: audio_ref, text: msg.text, voiceOf: msg.voiceOf });
        if (state.incident && state.incident.status !== "closed") state.incident.chimePlayedAt = now;
        if (msg.purpose === "morning_check_in") state.checkIn = { status: "sent", sentAt: now };
        done.add("play_chime_message");
        emit({ t: "tool_result", name: "play_chime_message", summary: `${chimeDevice.name} (HTTP ${res.status}) · ${msg.voiceOf}'s voice: "${msg.text}"` });
        return { played: true, chime: chimeDevice.name, voice_of: msg.voiceOf, message: msg.text };
      },
    }),
    tool({
      name: "escalate_incident",
      description:
        "Escalate the open night exit: records the last-seen card and prepares the call chain and phone scripts. Never calls emergency services.",
      inputSchema: z.object({
        direction_summary: z
          .string()
          .max(70)
          .describe("3 to 8 words saying only where the person is heading, e.g. 'down the driveway toward the street'. No clothing, no time."),
      }),
      callback: async ({ direction_summary }) => {
        const inc = state.incident;
        if (!inc || !eventDevice) return { error: "No open incident" };
        const clothing = mergeClothing(inc.clothing, ctx.clothing);
        const direction = direction_summary.replace(/[.\s]+$/, "") || ctx.clothing?.direction || "away from the house";
        inc.status = "escalated";
        inc.lastSeen = { at: now, deviceId: eventDevice.id, deviceName: eventDevice.name, direction, snapshot: ctx.snapshot, clothing };
        inc.callChain = [...h.members]
          .sort((a, b) => Number(b.onDuty) - Number(a.onDuty))
          .map((m) => ({ memberId: m.id, name: m.name, relation: m.relation, phone: m.phone, note: m.note }));
        const left = timeLabel(h, inc.doorEventAt);
        const wearing = clothingSentence(clothing);
        const r = h.resident;
        const obj = r.pronoun === "He" ? "him" : "her";
        inc.scripts = {
          nonEmergency: `Hi, I'm calling about ${r.familyTerm}, ${r.fullName}, ${r.age}. ${r.pronoun} has ${r.condition} and walked out of the house at ${left}. Our camera last saw ${obj} at ${at} at the ${eventDevice.name.toLowerCase()}, heading ${direction}. ${r.pronoun} is wearing ${wearing}. I can give you our address and a recent photo.`,
          emergency: `I need help finding a person with dementia who is missing. ${r.fullName}, ${r.age}, left home at ${left} and was last seen at ${at}, heading ${direction}. ${r.pronoun} is wearing ${wearing}. ${r.pronoun} may be confused and unable to give an address.`,
          emergencyAfter: inc.doorEventAt + h.escalation.emergencyAfterMin * 60000,
        };
        done.add("escalate_incident");
        emit({ t: "tool_result", name: "escalate_incident", summary: `Last seen ${at} · ${eventDevice.name} · heading ${direction} · call chain ${inc.callChain.map((c) => c.name).join(" → ")} · scripts ready` });
        return { escalated: true, last_seen: at, heading: direction, wearing, call_chain: inc.callChain.map((c) => c.name), emergency_script_suggested_after: timeLabel(h, inc.scripts.emergencyAfter) };
      },
    }),
    tool({
      name: "alert_family",
      description: "Send a notification to the on-duty family member's phone. Attaches the latest snapshot and clothing description automatically.",
      inputSchema: z.object({
        member_id: z.string(),
        level: z.enum(["info", "check", "urgent"]),
        title: z.string().max(70),
        body: z.string().max(320),
      }),
      callback: async ({ member_id, level, title, body }) => {
        const member = h.members.find((m) => m.id === member_id);
        if (!member) return { error: `Unknown member ${member_id}` };
        state.alerts.push({
          id: `alert-${now}-${state.alerts.length}`,
          memberId: member.id,
          level,
          title,
          body,
          at: now,
          snapshot: ctx.snapshot,
          clothing: level === "urgent" ? mergeClothing(state.incident?.clothing, ctx.clothing) : ctx.clothing,
        });
        done.add("alert_family");
        emit({ t: "tool_result", name: "alert_family", summary: `${member.name}'s phone · ${level} · "${title}"` });
        return { delivered_to: member.name };
      },
    }),
    tool({
      name: "close_incident",
      description: "Close the incident after the family confirmed the person is safe, with a note for the care log.",
      inputSchema: z.object({ summary: z.string().max(260), follow_up: z.string().max(200) }),
      callback: async ({ summary, follow_up }) => {
        const inc = state.incident;
        if (!inc || event.kind !== "family_confirmed_safe") return { error: "No confirmation" };
        inc.status = "closed";
        inc.closedAt = now;
        inc.closedBy = event.by;
        inc.summary = summary;
        inc.followUp = follow_up;
        done.add("close_incident");
        emit({ t: "tool_result", name: "close_incident", summary: `Closed at ${at} · ${summary}` });
        return { closed: true };
      },
    }),
    tool({
      name: "confirm_check_in",
      description: "Mark the morning check-in as answered.",
      inputSchema: z.object({}),
      callback: async () => {
        if (!state.checkIn) return { error: "No check-in pending" };
        state.checkIn = { ...state.checkIn, status: "ok", okAt: now };
        done.add("confirm_check_in");
        emit({ t: "tool_result", name: "confirm_check_in", summary: `Check-in answered at ${at}` });
        return { confirmed: true, answered_at: at };
      },
    }),
  ];

  function guard(name: string, input: Record<string, unknown>): { rule: string; reason: string } | null {
    if (name === "play_chime_message") {
      const msg = h.chimeMessages.find((m) => m.audioRef === input.audio_ref);
      const purpose = h.quietMorning ? "morning_check_in" : "night_return";
      if (!msg || msg.purpose !== purpose) return { rule: "Care plan", reason: `Use the ${purpose.replace("_", " ")} message from the care plan` };
      const last = state.chimes.at(-1);
      if (last && now - last.at < h.escalation.chimeCooldownMin * 60000) return { rule: "R3 Chime cooldown", reason: `A chime message played ${Math.round((now - last.at) / 60000)} min ago` };
    }
    if (name === "alert_family") {
      if (input.member_id !== onDuty.id) return { rule: "Care plan", reason: `Alerts go to the on-duty family member (${onDuty.id})` };
      if (input.level !== expectedLevel) return { rule: expectedLevel === "urgent" ? "R4 Second signal" : "Alert level", reason: `This event calls for level "${expectedLevel}"` };
      const hit = sensitiveTerm(`${input.title ?? ""} ${input.body ?? ""}`);
      if (hit) return { rule: "R5 Privacy", reason: `Remove "${hit}": describe clothing and actions only` };
    }
    if (name === "escalate_incident") {
      const inc = state.incident;
      if (!inc || inc.status !== "watching") return { rule: "R4 Second signal", reason: "No night exit in progress" };
      if (now - inc.doorEventAt > h.escalation.secondSignalMin * 60000) return { rule: "R4 Second signal", reason: "Too long after the door exit" };
    }
    if (name === "close_incident" && event.kind !== "family_confirmed_safe") {
      return { rule: "R7 Family confirmed", reason: "Only a family member can close an incident" };
    }
    if (name === "describe_clothing" && !ctx.dataUri) return { rule: "Protocol", reason: "Call get_snapshot first" };
    return null;
  }

  const allowedRule: Record<string, string> = {
    get_snapshot: "Protocol",
    describe_clothing: "R5 Clothing only",
    play_chime_message: h.quietMorning ? "Q1–Q4 Quiet morning · cooldown" : "R1 Night hours · R3 Cooldown",
    escalate_incident: "R4 Second signal",
    alert_family: "R5 Privacy · on-duty member",
    close_incident: "R7 Family confirmed",
    confirm_check_in: "Q5 Answer to check-in",
  };

  const r = h.resident;
  const systemPrompt = `You are Night Door, a Strands agent that helps a family look after ${r.fullName} (${r.age}, ${r.condition}) at ${h.id === "ruth" ? "home" : "night"}. The family calls ${r.pronoun === "He" ? "him" : "her"} "${r.callName}".
A deterministic rules engine has already verified a signed Ring event and chosen a protocol. Execute the protocol with tools, in order, then stop.
Rules:
- Call only the tools in the protocol, in the given order, each once. Use the exact ids given.
- From images you may describe only clothing, carried items and direction. Never guess identity, age, gender, ethnicity or other personal traits. The family knows who lives in the home; you may say it is probably ${r.callName} because of the time and door, never because of the image.
- Family messages: 1 to 3 short sentences, calm and specific: what happened, at which door and time, what Night Door already did, and one clear next step. No emojis. Never tell anyone to call 911; the family decides.
- If a tool is blocked, read the reason, fix the arguments, and try again.
- After the last tool, reply with one short sentence summarizing what you did.
Household: ${JSON.stringify({ devices: h.devices.map((d) => ({ id: d.id, name: d.name, role: d.role })), members: h.members.map((m) => ({ id: m.id, name: m.name, relation: m.relation, on_duty: m.onDuty })) })}`;

  const agent = new Agent({ model: model(), tools, systemPrompt, printer: false });

  agent.addHook(BeforeToolCallEvent, (e) => {
    toolCalls++;
    const name = e.toolUse.name;
    const input = (e.toolUse.input ?? {}) as Record<string, unknown>;
    const block = (rule: string, reason: string) => {
      e.cancel = `${rule}: ${reason}`;
      emit({ t: "tool_call", id: e.toolUse.toolUseId, name, input, verdict: "blocked", rule, reason });
    };
    if (toolCalls > MAX_TOOL_CALLS) return block("Step cap", `More than ${MAX_TOOL_CALLS} tool calls in one run`);
    if (!protocol.includes(name)) return block("Protocol", `${name} is not in this event's protocol (${protocol.join(" → ")})`);
    if (done.has(name)) return block("Protocol", `${name} already completed`);
    const missing = protocol.slice(0, protocol.indexOf(name)).filter((p) => !done.has(p));
    if (missing.length) return block("Protocol", `Call ${missing[0]} first`);
    const violation = guard(name, input);
    if (violation) return block(violation.rule, violation.reason);
    emit({ t: "tool_call", id: e.toolUse.toolUseId, name, input, verdict: "allowed", rule: allowedRule[name] });
  });

  agent.addHook(ModelMessageEvent, (e) => {
    modelCalls++;
    const text = e.message.content
      .map((b) => (b.type === "textBlock" ? (b as unknown as { text: string }).text : ""))
      .join(" ")
      .trim();
    if (text) emit({ t: "agent_text", text });
  });

  const subject =
    event.kind === "motion_detected" || event.kind === "button_press"
      ? `Ring event (X-Signature verified): ${event.kind}${event.kind === "motion_detected" ? ` · sub_type ${event.subType}` : ""} · device ${event.deviceId} (${eventDevice?.name}) · ${at} local time.`
      : event.kind === "family_confirmed_safe"
        ? `App event: ${event.by} tapped "safe" on their phone at ${at}.`
        : `App event: scheduled check at ${at}.`;
  const context = state.incident
    ? `Open incident: door exit at ${timeLabel(h, state.incident.doorEventAt)}; clothing seen then: ${clothingSentence(state.incident.clothing)}; status ${state.incident.status}.`
    : "No open incident.";
  const prompt = `${subject}
Rules engine decision: RUN. ${assessment.reason}
${context}
Protocol: ${assessment.hints.join(" → ")}`;

  await agent.invoke(prompt);
  const missing = protocol.filter((p) => !done.has(p));
  if (missing.length && toolCalls < MAX_TOOL_CALLS) {
    await agent.invoke(`You have not completed: ${missing.join(", ")}. Call ${missing[0]} now, then finish the protocol.`);
  }
  const stillMissing = protocol.filter((p) => !done.has(p));
  if (stillMissing.length) emit({ t: "error", message: `Protocol incomplete: ${stillMissing.join(", ")}` });
  return { modelCalls };
}

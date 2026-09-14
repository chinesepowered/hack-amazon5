import type { IncomingEvent, NightState, RuleCheck } from "./types";
import { deviceById, hmLabel, inWindow, localMinutes, timeLabel, tsAt, type Household } from "./household";

// The deterministic rules engine. It decides whether the Strands agent runs at all, and which tools
// (in which order) it may use. The agent's BeforeToolCallEvent hook enforces the same protocol.

export interface Assessment {
  decision: "run" | "suppress" | "ignore";
  reason: string;
  title: string;
  protocol: string[];
  hints: string[];
  rules: RuleCheck[];
  tone: "quiet" | "watch" | "alert" | "safe" | "info";
  logLabel: string;
  opensIncident: boolean;
}

function base(title: string): Pick<Assessment, "title" | "rules" | "hints" | "protocol" | "opensIncident"> {
  return { title, rules: [], hints: [], protocol: [], opensIncident: false };
}

export function assess(h: Household, state: NightState, ev: IncomingEvent): Assessment {
  const at = timeLabel(h, ev.timestamp);
  const minutes = localMinutes(h, ev.timestamp);
  const incident = state.incident && state.incident.status !== "closed" ? state.incident : null;
  const onDuty = h.members.find((m) => m.onDuty) ?? h.members[0];
  const chime = h.devices.find((d) => d.kind === "chime");

  if (ev.kind === "family_confirmed_safe") {
    const a = { ...base(`${at} · ${ev.by} confirmed safe`) } as Assessment;
    a.rules.push({ id: "R7", label: "Family confirmed", pass: !!incident, detail: incident ? `${ev.by} tapped "safe" on their phone` : "No open incident" });
    if (!incident) return { ...a, decision: "ignore", reason: "Nothing to close", tone: "info", logLabel: "Safe confirmation" };
    return {
      ...a,
      decision: "run",
      reason: `${ev.by} confirmed ${h.resident.callName} is safe. Close the incident and leave a note for the care log.`,
      protocol: ["close_incident"],
      hints: ["close_incident(summary, follow_up)"],
      tone: "safe",
      logLabel: `Safe · confirmed by ${ev.by}`,
    };
  }

  if (ev.kind === "clock_tick") {
    const a = { ...base(`${at} · Quiet Morning check`) } as Assessment;
    if (!h.quietMorning || !chime) return { ...a, decision: "ignore", reason: "No morning check configured", tone: "info", logLabel: "Clock" };
    const since = tsAt(h, h.quietMorning.since);
    const activity = state.log.some(
      (l) => l.at >= since && l.at <= ev.timestamp && (l.eventKind === "motion_detected:human" || l.eventKind === "button_press") && deviceById(h, l.deviceId)?.role === "exit_door",
    );
    const due = minutes >= localMinutes(h, tsAt(h, h.quietMorning.by));
    a.rules.push(
      { id: "Q1", label: "Check time", pass: due, detail: `Check at ${hmLabel(h.quietMorning.by)}` },
      { id: "Q2", label: "No door activity", pass: !activity, detail: activity ? "Door activity seen this morning" : `No door activity since ${hmLabel(h.quietMorning.since)}` },
      { id: "Q3", label: "Lives alone", pass: h.resident.livesAlone, detail: h.resident.livesAlone ? "No one else would notice" : "Someone else is home" },
      { id: "Q4", label: "Not already checked", pass: !state.checkIn, detail: state.checkIn ? "Check-in already sent" : "First check today" },
    );
    if (a.rules.every((r) => r.pass)) {
      const msg = h.chimeMessages.find((m) => m.purpose === "morning_check_in")!;
      return {
        ...a,
        decision: "run",
        reason: `No sign of ${h.resident.name} at the door by ${hmLabel(h.quietMorning.by)}. Ask her gently through the chime and let ${onDuty.name} know.`,
        protocol: ["play_chime_message", "alert_family"],
        hints: [`play_chime_message(audio_ref="${msg.audioRef}")`, `alert_family(member_id="${onDuty.id}", level="check")`],
        tone: "watch",
        logLabel: "Quiet morning · no door activity",
      };
    }
    return { ...a, decision: "ignore", reason: "Morning check not needed", tone: "info", logLabel: "Morning check skipped" };
  }

  const dev = deviceById(h, ev.deviceId);
  const title = `${at} · ${ev.kind}${ev.kind === "motion_detected" ? ` (${ev.subType ?? "unknown"})` : ""} · ${dev?.name ?? ev.deviceId}`;
  const a = { ...base(title) } as Assessment;
  if (!dev) return { ...a, decision: "ignore", reason: "Device is not part of this care plan", tone: "info", logLabel: "Unknown device" };

  // Quiet Morning: any person at the door (or a doorbell press) after the check-in confirms she's up.
  if (h.quietMorning) {
    const human = ev.kind === "button_press" || ev.subType === "human";
    const waiting = state.checkIn?.status === "sent";
    a.rules.push({ id: "Q5", label: "Answer to check-in", pass: human && waiting, detail: waiting ? "Waiting for Ruth to respond" : "No check-in pending" });
    if (human && waiting) {
      return {
        ...a,
        decision: "run",
        reason: `${h.resident.name} responded at the door after the morning check-in.`,
        protocol: ["confirm_check_in", "alert_family"],
        hints: ["confirm_check_in()", `alert_family(member_id="${onDuty.id}", level="info")`],
        tone: "safe",
        logLabel: ev.kind === "button_press" ? "Doorbell pressed · she's up" : "Person at door · she's up",
      };
    }
    return { ...a, decision: "ignore", reason: human ? "Morning activity logged" : "Not a person", tone: "info", logLabel: human ? "Door activity" : `Motion · ${ev.subType}` };
  }

  if (ev.kind === "button_press") {
    a.rules.push({ id: "R0", label: "Exit signal", pass: false, detail: "A doorbell press is a visitor, not a night exit" });
    return { ...a, decision: "ignore", reason: "Visitors are handled by the Ring app", tone: "info", logLabel: "Doorbell press" };
  }

  const isHuman = ev.subType === "human";
  a.rules.push({ id: "R0", label: "Person detected", pass: isHuman, detail: `sub_type: ${ev.subType ?? "unknown"}` });
  if (!isHuman) return { ...a, decision: "ignore", reason: "Animals and vehicles are not exits", tone: "info", logLabel: `Motion · ${ev.subType}` };

  const night = h.nightWindow ? inWindow(minutes, h.nightWindow.start, h.nightWindow.end) : false;
  a.rules.push({ id: "R1", label: "Night hours", pass: night, detail: h.nightWindow ? `${hmLabel(h.nightWindow.start)}–${hmLabel(h.nightWindow.end)}` : "No night window" });
  if (!night) return { ...a, decision: "ignore", reason: "Daytime movement is normal", tone: "info", logLabel: "Daytime motion" };

  if (dev.role === "exit_door") {
    const expected = h.expectedArrivals.find((x) => x.deviceId === dev.id && inWindow(minutes, x.start, x.end));
    a.rules.push({
      id: "R2",
      label: "Not an expected arrival",
      pass: !expected,
      detail: expected ? `${expected.who} ${expected.reason} (${hmLabel(expected.start)}–${hmLabel(expected.end)})` : "No one is expected at this door now",
    });
    if (expected) {
      return { ...a, decision: "suppress", reason: `Expected: ${expected.who} is ${expected.reason}. No chime, no alert, no model call.`, tone: "quiet", logLabel: `${dev.name} · ${expected.who} home` };
    }
    if (incident) {
      const last = incident.chimePlayedAt ?? 0;
      const cooling = ev.timestamp - last < h.escalation.chimeCooldownMin * 60000;
      a.rules.push({ id: "R3", label: "Chime cooldown", pass: !cooling, detail: `${h.escalation.chimeCooldownMin} min between chime messages` });
      return { ...a, decision: "suppress", reason: "Already responding to this exit; the timeline is updated.", tone: "watch", logLabel: `${dev.name} · still at the door` };
    }
    a.rules.push({ id: "R3", label: "Chime cooldown", pass: true, detail: "No chime played in the last 5 min" });
    const msg = h.chimeMessages.find((m) => m.purpose === "night_return")!;
    return {
      ...a,
      decision: "run",
      reason: `Someone went out the ${dev.name.toLowerCase()} at ${at}, inside night hours, and nobody is expected.`,
      protocol: ["get_snapshot", "describe_clothing", "play_chime_message", "alert_family"],
      hints: [
        `get_snapshot(device_id="${dev.id}")`,
        "describe_clothing(snapshot_id from get_snapshot)",
        `play_chime_message(audio_ref="${msg.audioRef}")`,
        `alert_family(member_id="${onDuty.id}", level="check")`,
      ],
      tone: "watch",
      logLabel: `${dev.name} · night exit`,
      opensIncident: true,
    };
  }

  // Perimeter camera: only meaningful as the second signal of an exit already in progress.
  const withinWindow = !!incident && incident.status === "watching" && ev.timestamp - incident.doorEventAt <= h.escalation.secondSignalMin * 60000;
  a.rules.push({
    id: "R4",
    label: "Second signal",
    pass: withinWindow,
    detail: incident
      ? `${Math.round((ev.timestamp - incident.doorEventAt) / 60000)} min after the door exit (limit ${h.escalation.secondSignalMin} min)`
      : "No night exit in progress",
  });
  if (!withinWindow) {
    return {
      ...a,
      decision: incident ? "suppress" : "ignore",
      reason: incident ? "Already escalated; timeline updated." : "Driveway motion without a night exit is the Ring app's job, not ours.",
      tone: incident ? "alert" : "info",
      logLabel: `${dev.name} · person`,
    };
  }
  return {
    ...a,
    decision: "run",
    reason: `A second camera saw a person at the ${dev.name.toLowerCase()} ${Math.round((ev.timestamp - (incident?.doorEventAt ?? 0)) / 60000)} min after the door exit. Escalate.`,
    protocol: ["get_snapshot", "describe_clothing", "escalate_incident", "alert_family"],
    hints: [
      `get_snapshot(device_id="${dev.id}")`,
      "describe_clothing(snapshot_id from get_snapshot)",
      "escalate_incident(direction_summary)",
      `alert_family(member_id="${onDuty.id}", level="urgent")`,
    ],
    tone: "alert",
    logLabel: `${dev.name} · moving away`,
    opensIncident: false,
  };
}

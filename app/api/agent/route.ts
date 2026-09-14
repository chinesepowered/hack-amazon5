import type { NextRequest } from "next/server";
import { z } from "zod";
import type { IncomingEvent, StreamItem } from "@/lib/types";
import { HOUSEHOLDS } from "@/lib/household";
import { assess } from "@/lib/rules";
import { appendLog, NightStateSchema } from "@/lib/state";
import { runNightDoorAgent } from "@/lib/agent";
import { demoDeviceId, getRingClient, ringMode } from "@/lib/ring/client";
import { verifyAndParse, webhookSecret } from "@/lib/ring/webhook";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  state: NightStateSchema,
  ring: z.object({ raw: z.string().max(20_000), signature: z.string().max(200) }).optional(),
  app: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("clock_tick"), timestamp: z.number() }),
      z.object({ kind: z.literal("family_confirmed_safe"), timestamp: z.number(), by: z.string().max(40) }),
    ])
    .optional(),
});

export async function POST(req: NextRequest) {
  const limited = rateLimit(`agent:${clientIp(req)}`, 40, 10 * 60_000);
  if (!limited.ok) {
    return Response.json({ error: `Too many runs. Try again in ${limited.retryAfter}s.` }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || (!parsed.data.ring && !parsed.data.app)) {
    return Response.json({ error: "Expected { state, ring | app }" }, { status: 400 });
  }
  const { ring, app } = parsed.data;
  const state = structuredClone(parsed.data.state);
  const h = HOUSEHOLDS[state.household];
  const origin = req.nextUrl.origin;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const started = Date.now();
      const emit = (item: StreamItem) => controller.enqueue(encoder.encode(JSON.stringify(item) + "\n"));
      let modelCalls = 0;
      try {
        let event: IncomingEvent;
        if (ring) {
          const result = verifyAndParse(ring.raw, ring.signature, webhookSecret());
          emit({ t: "webhook", raw: ring.raw, signature: ring.signature, verified: result.ok, source: ringMode() === "live" ? "ring" : "simulator" });
          if (!result.ok || !result.event) {
            emit({ t: "error", message: result.ok ? `Ignored webhook type ${result.ignoredType}` : result.error });
            emit({ t: "state", state });
            emit({ t: "done", ms: Date.now() - started, modelCalls });
            controller.close();
            return;
          }
          event = { ...result.event, deviceId: demoDeviceId(result.event.deviceId) };
        } else {
          event = app!;
        }

        const assessment = assess(h, state, event);
        emit({ t: "assess", decision: assessment.decision, reason: assessment.reason, protocol: assessment.protocol, rules: assessment.rules, at: event.timestamp, title: assessment.title });
        appendLog(state, event, assessment);
        if (assessment.opensIncident && "deviceId" in event) {
          state.incident = { id: `inc-${event.timestamp}`, status: "watching", openedAt: event.timestamp, doorEventAt: event.timestamp, doorDeviceId: event.deviceId };
        }
        if (assessment.decision === "run") {
          const result = await runNightDoorAgent({ h, state, event, assessment, ring: getRingClient(origin), emit });
          modelCalls = result.modelCalls;
        }
      } catch (err) {
        emit({ t: "error", message: err instanceof Error ? err.message : "Agent run failed" });
      }
      emit({ t: "state", state });
      emit({ t: "done", ms: Date.now() - started, modelCalls });
      controller.close();
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}

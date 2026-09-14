import { z } from "zod";
import type { HouseholdId, IncomingEvent, NightState } from "./types";
import type { Assessment } from "./rules";

export function initialState(household: HouseholdId): NightState {
  return { household, log: [], incident: null, alerts: [], chimes: [], checkIn: null };
}

// The browser keeps demo state and sends it with each request (no database). Validate the envelope.
export const NightStateSchema = z
  .object({
    household: z.enum(["walter", "ruth"]),
    log: z.array(z.any()).max(200),
    incident: z.any().nullable(),
    alerts: z.array(z.any()).max(50),
    chimes: z.array(z.any()).max(50),
    checkIn: z.any().nullable(),
  })
  .transform((s) => s as unknown as NightState);

export function appendLog(state: NightState, ev: IncomingEvent, a: Assessment): void {
  const eventKind =
    ev.kind === "motion_detected" ? `motion_detected:${ev.subType ?? "unknown"}` : ev.kind;
  state.log.push({
    id: `log-${ev.timestamp}-${state.log.length}`,
    at: ev.timestamp,
    deviceId: "deviceId" in ev ? ev.deviceId : undefined,
    eventKind,
    label: a.logLabel,
    detail: a.reason,
    tone: a.tone,
  });
}

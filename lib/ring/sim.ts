// Ring simulator: builds webhook bodies with exactly the documented field names so the same
// verification and parsing code path handles simulated and real events.

export const SIM_ACCOUNT_ID = "ava1.ring.account.SIMULATED";

const SNAPSHOTS: Record<string, string> = {
  "ring-dev-front-door": "/sim/walter-front-door.jpg",
  "ring-dev-driveway": "/sim/walter-driveway.jpg",
  "ring-dev-back-door": "/sim/walter-front-door.jpg",
};

export function simSnapshotPath(deviceId: string): string | null {
  return SNAPSHOTS[deviceId] ?? null;
}

export function buildWebhookBody(opts: {
  kind: "motion_detected" | "button_press";
  deviceId: string;
  timestamp: number;
  subType?: string;
  componentIds?: number[];
}): string {
  const attributes =
    opts.kind === "motion_detected"
      ? { sub_type: opts.subType ?? "human", component_ids: opts.componentIds ?? [0], timestamp: opts.timestamp }
      : { timestamp: opts.timestamp };
  const body = {
    meta: {
      account_id: SIM_ACCOUNT_ID,
      request_id: `sim-${opts.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: opts.timestamp,
    },
    data: {
      type: opts.kind,
      attributes,
      relationships: { device: { data: { type: "devices", id: opts.deviceId } } },
    },
  };
  return JSON.stringify(body);
}

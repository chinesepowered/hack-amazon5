import { z } from "zod";
import type { RingEvent } from "../types";
import { verifySignature } from "./signature";
import { ringMode } from "./client";

// Payload shape from developer.amazon.com/docs/ring/api-documentation.html (JSON:API style).
const WebhookPayload = z.object({
  meta: z.object({
    account_id: z.string(),
    request_id: z.string(),
    timestamp: z.number(),
  }),
  data: z.object({
    type: z.string(),
    attributes: z
      .object({
        sub_type: z.string().optional(),
        component_ids: z.array(z.number()).optional(),
        timestamp: z.number(),
      })
      .passthrough(),
    relationships: z.object({
      device: z.object({ data: z.object({ type: z.string(), id: z.string() }) }),
    }),
  }),
});

export type VerifyResult =
  | { ok: true; event: RingEvent | null; ignoredType?: string }
  | { ok: false; status: number; error: string };

export function webhookSecret(): string {
  const configured = process.env.RING_WEBHOOK_SECRET ?? "";
  if (configured) return configured;
  // A fixed key keeps the simulator usable out of the box; live mode always requires the real key.
  return ringMode() === "simulator" ? "night-door-simulator-key" : "";
}

export function verifyAndParse(raw: string, signature: string | null, secret: string): VerifyResult {
  if (!verifySignature(raw, signature, secret)) {
    return { ok: false, status: 401, error: "X-Signature did not match HMAC-SHA256 of the body" };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, error: "Body is not JSON" };
  }
  const parsed = WebhookPayload.safeParse(json);
  if (!parsed.success) return { ok: false, status: 400, error: "Unexpected webhook shape" };
  const { meta, data } = parsed.data;
  if (data.type !== "motion_detected" && data.type !== "button_press") {
    return { ok: true, event: null, ignoredType: data.type };
  }
  return {
    ok: true,
    event: {
      kind: data.type,
      requestId: meta.request_id,
      accountId: meta.account_id,
      deviceId: data.relationships.device.data.id,
      subType: data.attributes.sub_type,
      componentIds: data.attributes.component_ids ?? [],
      timestamp: data.attributes.timestamp,
    },
  };
}

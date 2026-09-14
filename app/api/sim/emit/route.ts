import type { NextRequest } from "next/server";
import { z } from "zod";
import { HOUSEHOLDS, deviceById, tsAt } from "@/lib/household";
import { buildWebhookBody } from "@/lib/ring/sim";
import { signBody } from "@/lib/ring/signature";
import { webhookSecret } from "@/lib/ring/webhook";
import { ringMode } from "@/lib/ring/client";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

const Body = z.object({
  household: z.enum(["walter", "ruth"]),
  deviceId: z.string().max(80),
  kind: z.enum(["motion_detected", "button_press"]),
  subType: z.enum(["human", "animal", "vehicle"]).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/),
});

// Simulated Ring: returns a webhook body and X-Signature exactly as Ring would send them.
export async function POST(req: NextRequest) {
  if (ringMode() === "live" && process.env.ALLOW_SIMULATOR !== "1") {
    return Response.json({ error: "Simulator disabled in live mode" }, { status: 403 });
  }
  const limited = rateLimit(`sim:${clientIp(req)}`, 80, 10 * 60_000);
  if (!limited.ok) return Response.json({ error: "Too many simulated events" }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  const { household, deviceId, kind, subType, time } = parsed.data;
  const h = HOUSEHOLDS[household];
  if (!deviceById(h, deviceId)) return Response.json({ error: "Unknown device" }, { status: 400 });
  const raw = buildWebhookBody({ kind, deviceId, subType, timestamp: tsAt(h, time) });
  return Response.json({ raw, signature: signBody(raw, webhookSecret()), header: "X-Signature" });
}

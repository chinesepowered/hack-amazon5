import type { NextRequest } from "next/server";
import { getRingClient, ringMode } from "@/lib/ring/client";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// Quick live-mode check: GET /v1/devices through the configured token.
export async function GET(req: NextRequest) {
  const limited = rateLimit(`devices:${clientIp(req)}`, 30, 10 * 60_000);
  if (!limited.ok) return Response.json({ error: "Too many requests" }, { status: 429 });
  try {
    const devices = await getRingClient(req.nextUrl.origin).listDevices();
    return Response.json({ mode: ringMode(), devices });
  } catch (err) {
    return Response.json({ mode: ringMode(), error: err instanceof Error ? err.message : "Ring API error" }, { status: 502 });
  }
}

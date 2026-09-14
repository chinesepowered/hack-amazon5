import type { NextRequest } from "next/server";
import { verifyAndParse, webhookSecret } from "@/lib/ring/webhook";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

interface InboxItem {
  raw: string;
  signature: string;
  receivedAt: number;
}

// Live mode inbox. Ring needs a 200 within 5 seconds, so the webhook only verifies and queues;
// the dashboard pulls queued events and runs the agent. In-memory: use a queue or database in production.
const g = globalThis as unknown as { __nightDoorInbox?: InboxItem[] };
const inbox = (g.__nightDoorInbox ??= []);

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-signature");
  const result = verifyAndParse(raw, signature, webhookSecret());
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  // Ring's signature covers only the body, so drop replays of a request_id we already queued.
  if (result.event && inbox.some((i) => i.raw.includes(`"request_id":"${result.event!.requestId}"`))) {
    return Response.json({ received: true, queued: false, duplicate: true });
  }
  if (result.event) {
    inbox.push({ raw, signature: signature!, receivedAt: Date.now() });
    if (inbox.length > 100) inbox.splice(0, inbox.length - 100);
  }
  return Response.json({ received: true, queued: !!result.event, ignored: result.ok && !result.event ? result.ignoredType : null });
}

export async function GET(req: NextRequest) {
  const limited = rateLimit(`inbox:${clientIp(req)}`, 600, 10 * 60_000);
  if (!limited.ok) return Response.json({ error: "Too many requests" }, { status: 429 });
  const since = Number(req.nextUrl.searchParams.get("since") ?? "0");
  return Response.json({ items: inbox.filter((i) => i.receivedAt > since) });
}

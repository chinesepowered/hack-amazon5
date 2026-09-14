import { ringMode, RING_API_BASE } from "@/lib/ring/client";

export const runtime = "nodejs";

export function GET() {
  return Response.json({
    ok: true,
    app: "Night Door",
    agent: "Strands Agents SDK (TypeScript)",
    model: process.env.OPENAI_MODEL ?? null,
    modelConfigured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_BASE_URL),
    ring: { mode: ringMode(), api: RING_API_BASE, webhook: "/api/ring/webhook" },
  });
}

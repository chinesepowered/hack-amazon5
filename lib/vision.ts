import OpenAI from "openai";
import type { Clothing } from "./types";
import { redactField } from "./privacy";

const PROMPT = `You describe a home camera snapshot for a family caregiver who may need to find someone quickly.
Describe ONLY what the person is wearing, what they carry, and which way they are moving.
Name garments precisely (for example robe, coat, pajama pants, slippers, knit cap). Decide whether the person faces the camera or walks away from it by looking at the back of the head, the heels and which foot is further away.
Do not describe face, hair, skin, body, age, gender or ethnicity, and never guess who the person is.
Return strict JSON with these keys and short values (max 8 words each):
{"top": "", "bottom": "", "footwear": "", "headwear": "", "carrying": "", "direction": ""}
Use "none visible" when something is not visible. For direction, say where they are heading relative to the camera (e.g. "down the porch steps, away from the door").`;

export async function describeClothing(dataUri: string): Promise<{ clothing: Clothing; redactions: string[]; ms: number }> {
  const client = new OpenAI({
    baseURL: process.env.OPENAI_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 40_000,
    maxRetries: 1,
  });
  const started = Date.now();
  const request = {
    model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || "",
    temperature: 0,
    max_tokens: 220,
    chat_template_kwargs: { enable_thinking: false },
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: PROMPT },
          { type: "image_url" as const, image_url: { url: dataUri } },
        ],
      },
    ],
  };
  const res = await client.chat.completions.create(request as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  const text = res.choices[0]?.message?.content ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = match ? JSON.parse(match[0]) : {};
  } catch {
    parsed = {};
  }
  const keys: (keyof Clothing)[] = ["top", "bottom", "footwear", "headwear", "carrying", "direction"];
  const redactions: string[] = [];
  const clothing = {} as Clothing;
  for (const k of keys) {
    const raw = typeof parsed[k] === "string" && parsed[k] ? String(parsed[k]).trim() : "none visible";
    const { value, redacted } = redactField(raw.slice(0, 80));
    if (redacted) redactions.push(`${k}: "${redacted}"`);
    clothing[k] = value;
  }
  return { clothing, redactions, ms: Date.now() - started };
}

export function clothingSentence(c: Clothing | undefined): string {
  if (!c) return "clothing not yet described";
  const parts = [c.top, c.bottom, c.footwear, c.headwear]
    .filter((p) => p && !/^none visible|not described/i.test(p))
    .join(", ");
  const carrying = c.carrying && !/^none visible|not described/i.test(c.carrying) ? `, carrying ${c.carrying}` : "";
  return (parts || "clothing not clearly visible") + carrying;
}

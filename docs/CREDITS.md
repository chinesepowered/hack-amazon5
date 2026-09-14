# Credits and third-party material

## Images
- `public/sim/walter-front-door.jpg` and `public/sim/walter-driveway.jpg` are original illustrations made for this project from the SVG sources in `scenes/` (rendered with `node scripts/render-assets.mjs`). They show no real people or places.
- No Ring or Amazon logos are used. Camera overlays are generic.

## Fonts
- Fraunces, Inter and JetBrains Mono via Google Fonts (`next/font/google` in the app, Google Fonts CSS in `public/slides.html`). All three are licensed under the SIL Open Font License 1.1.

## Code and SDKs
- Strands Agents SDK for TypeScript (`@strands-agents/sdk`), OpenAI Node SDK (`openai`), Zod, Next.js, React, Playwright (dev only). Used as dependencies under their own licenses.
- Ring Partner API field names and endpoints follow the public docs at developer.amazon.com/docs/ring/api-documentation.html. No code was copied from `AmazonAppDev/ring-api-helloworld`; it was used as a reference for the Playground token flow only.

## Audio
- The chime messages in the demo are text placeholders labeled as a family member's recorded voice; no audio asset ships with the app.
- The demo video narration is synthetic (ElevenLabs text-to-speech). No music.

## Data
- All households, people, phone numbers (555-01xx) and events are fictional.
- Statistics are cited in the README with links to the Alzheimer's Association pages they come from.

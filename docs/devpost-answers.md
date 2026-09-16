# Devpost answers (drafts)

## Name (≤60)
Night Door: dementia night-exit care for Ring

## Tagline (≤200)
When Dad walks out at 2 AM, a Strands agent on Ring events plays a familiar voice on the Chime, tells family what he's wearing, and escalates only when a second camera sees him leave.

## Track
Ring

## Mini challenge
AWS Builder: yes (Strands Agents SDK). Open Source: no.

## Repo
https://github.com/chinesepowered/hack-amazon5

## Built with
ring-partner-api, ring-webhooks, strands-agents-sdk, typescript, next.js, react, zod, openai-compatible-api, qwen, vercel, playwright, elevenlabs

## Description (markdown)

**Night Door is a Ring app for families caring for someone with dementia.** When a Ring camera sees a person leave the house in the middle of the night, a **Strands agent** plays a family member's calm, familiar voice on the **Ring Chime**, sends the on-duty caregiver the snapshot and exactly what the person is wearing, and, if a second camera sees them moving away, prepares a last-seen card, the call chain and a phone script. The family decides what happens next.

### The problem
6 in 10 people living with dementia will wander at least once, and many do so repeatedly (Alzheimer's Association). An estimated 7.4 million Americans aged 65+ live with Alzheimer's dementia, and nearly 13 million family members and friends gave more than 19 billion hours of unpaid care last year (Alzheimer's Association, 2026 Facts and Figures). A plain door alarm only says *something opened*: it can't tell a son home from a night shift from Dad walking out at 2 AM, and it gives the person who must act nothing to go on.

### How it works
1. **Signed Ring webhooks** (`motion_detected` with `sub_type`, `button_press`) are verified with the HMAC-SHA256 `X-Signature`.
2. **A deterministic rules engine** checks the care plan: person? night hours? expected arrival? chime cooldown? second camera within 10 minutes? Expected and daytime events stay quiet with **zero model calls**.
3. **A Strands agent** (TypeScript SDK) runs the chosen protocol with 7 Zod-typed tools: Ring snapshot download, clothing-only description, **Ring Chime audio playback**, family alert, escalation, close, morning check-in.
4. **A `BeforeToolCallEvent` hook enforces the care plan** on every call: protocol order, cooldown, second-signal escalation, privacy (never faces, age, gender or identity), on-duty recipient, family-only close, step cap. Blocked calls return a reason the model corrects. Every verdict is visible in the UI.
5. **The family decides.** Night Door never calls 911; only a family member marks "safe". **Quiet Morning** checks on parents who live alone.

### Ring + AWS
Ring Partner API: webhooks, `GET /v1/devices?include=status,capabilities`, event history, `POST /v1/devices/{id}/media/image/download`, `POST /v1/devices/{id}/media/audio/playback`, OAuth/Playground tokens, 429 handling. AWS: Strands Agents SDK (`Agent`, `tool()`, `BeforeToolCallEvent`, `ModelMessageEvent`, `OpenAIModel`), model-agnostic so Amazon Bedrock is a provider swap.

### What is real Ring, and what is simulated
We created a Ring developer account with a private app. `RING_MODE` selects the mode, and the UI labels every element:

- **Hybrid** (Developer Playground token): device list, capabilities, status and event history are **live Ring API** calls; the night-exit events, snapshots and chime audio are simulated.
- **Simulator** (the public demo, no token): everything simulated with the documented shapes, through the same HMAC verification path.
- **Live**: everything against Ring; needs an account with hardware.

Measured on the Playground with a live token (scope `ava.v1:read`): one Doorbell Pro, no chime and no second camera; `media/image/download` returns 403 `TIME_RANGE_NOT_AUTHORIZED` for every timestamp; audio playback returns 400; event history is empty; and the simulate buttons only open a WHEP live-view session rather than delivering events to the app. See FRICTION_LOG.md #7.

**Honest note:** all people, phone numbers (555-01xx) and camera images are fictional. Built during the hackathon with Claude Code as a coding assistant.

## Existing project?
New.

## Testing instructions
No login. Open https://night-door.vercel.app. On "Walter · night exits", click the bottom buttons in order: 1:47 AM (expected arrival, stays quiet), 2:14 AM (night exit: watch the webhook verify, rule chips, each Strands tool call pass its hook, the Chime message and Maya's phone alert), 2:17 AM (driveway escalation: last-seen card, call chain and scripts; scroll the phone). Then tap "Found him. He's safe" on the phone. Switch to "Ruth · quiet morning" and run both steps. "Reset" starts over. Runs take about 3–8 s. Slides: /slides.html.

The header badge says which mode is running: the public demo has no Ring token, so it reads "Simulated Ring events"; with a Playground token it reads "Live Ring device · <device name> · simulated events", and the `get_snapshot` / `play_chime_message` rows in the agent feed say when a result is simulated and why. Mode details: README and docs/ring-live-checklist.md.

## AWS Builder: which AWS services did you incorporate and how?
**Strands Agents SDK (TypeScript, `@strands-agents/sdk` 1.17).** It powers the whole agent in `lib/agent.ts`, running inside a Next.js route handler on Vercel:
- An `Agent` with 7 `tool()` definitions using Zod schemas: `get_snapshot` (Ring image download), `describe_clothing` (image model, clothing only), `play_chime_message` (Ring Chime audio playback), `alert_family`, `escalate_incident`, `close_incident`, `confirm_check_in`.
- A `BeforeToolCallEvent` hook that enforces the care plan deterministically: protocol order and single use, chime cooldown, escalation only on a second camera signal within 10 minutes, a privacy rule that blocks identity or personal-trait language, on-duty recipient and alert level, family-only incident closing, and a 12-call step cap. Blocked calls set `event.cancel` with a reason the model reads and corrects.
- A `ModelMessageEvent` hook that streams the agent's narration to the UI.
- The `OpenAIModel` provider (Chat Completions) with temperature 0 and thinking disabled, pointed at an OpenAI-compatible endpoint (Qwen3.8-27B). Strands' model-agnostic providers mean the same tools and hooks run on Amazon Bedrock by swapping the model object.
We deliberately kept business rules out of the prompt: a deterministic rules engine decides whether the agent runs at all, and the hook guarantees it can only do what the care plan allows. No paid AWS services were used.

## Feedback Q1: Which developer tools, APIs, and SDKs did you use and for what?
- **Ring Partner API** (`api.amazonvision.com`): webhooks (`motion_detected` with `sub_type`, `button_press`) as the trigger for everything; `X-Signature` HMAC-SHA256 verification; device list, capabilities, status and event history (live against our developer account in hybrid mode); image download for the snapshot shown to family and described by a vision model; **Chime audio playback** for the familiar voice message; OAuth refresh and Developer Playground token for auth.
- **Ring Developer Console and Playground:** private app creation, scopes, credentials, and token generation for API testing.
- **Ring Appstore UX design guide**: web-first layout, accessibility (WCAG 2.2 AA), notification restraint.
- **Ring API docs and the `ring-api-helloworld` starter**: reference for token handling.
- **Strands Agents SDK for TypeScript**: agent loop, typed tools, `BeforeToolCallEvent` guardrail hook, `ModelMessageEvent` streaming, `OpenAIModel` provider.
- Supporting: Next.js on Vercel, Zod, an OpenAI-compatible model endpoint (Qwen3.8-27B with image input), Playwright for rendering assets and recording the demo.

## Feedback Q2: For each tool, API, or SDK used in your project, what worked well?
- **Ring webhooks:** the JSON:API payload is small and predictable, and `sub_type` (human/animal/vehicle) on `motion_detected` is exactly the signal a caregiving app needs to avoid false alarms from pets and cars. Signing with a plain HMAC-SHA256 of the raw body was quick to implement correctly.
- **Ring device reads:** `GET /v1/devices`, `capabilities`, `status` and `configurations` all worked immediately with a Playground token and return clean JSON:API, so wiring a real device panel took minutes.
- **Chime audio playback:** having even one write action on a Chime makes a real in-home response possible, which turns a notification app into something that can gently redirect a person in the moment.
- **Ring API reference:** clear base URL, Bearer auth, rate-limit headers with `Retry-After`, and the 5-second webhook response rule stated up front.
- **Ring UX guide:** concrete, actionable rules (WCAG 2.2 AA, one routine notification per day, consistent "Ring app" naming) that shaped our "quiet by default" design.
- **Strands TypeScript SDK:** very little code to get an agent with Zod-typed tools. `BeforeToolCallEvent` with `cancel = "reason"` is an excellent guardrail primitive: the model sees why it was blocked and fixes its call. The `OpenAIModel` provider worked with a non-OpenAI, OpenAI-compatible endpoint with no adapters, and hooks made streaming every step to the UI easy.

## Feedback Q3: For each tool, API, or SDK used in your project, what needs work?
- **The Developer Playground can't exercise an event-driven app.** With a live token: `media/image/download` → 403 `TIME_RANGE_NOT_AUTHORIZED` for every timestamp (no footage), `media/audio/playback` → 400 with `customizable_slots: null` (no chime), event history always empty, one device only (no second camera), and the Package/Vehicle/Motion buttons only open a WHEP live-view session in the browser instead of delivering an event to the registered app. That is exactly the surface a caregiving app needs.
- **Chime audio (critical for us):** `audio_ref` is not explained. There's no documented way to upload custom audio, list available refs, or read the capabilities JSON for "audio slot count".
- **Event history:** no response example, field names or pagination parameters.
- **Inconsistent component shapes:** webhook `component_ids: [0, 1]`, snapshot `components: [{"component_id": "N"}]` (string), audio `components: [0]`.
- **Webhook replay protection:** the signature covers only the body; there's no signed timestamp or tolerance guidance.
- **Getting started without hardware:** the Get started page lists "at least one Ring device" as a prerequisite and doesn't mention the Playground, while the hackathon page says no device is needed. Neither says what the Playground token can actually do.
- **UX guide:** no guidance for safety-critical alerts versus routine notifications.
- **Strands TypeScript:** the README mentions hooks but has no guardrail example; we learned that `cancel` accepts a string (and that message content blocks use `type: "textBlock"`) from the `.d.ts` files. Details are in FRICTION_LOG.md.

## Feedback Q4: For each tool, API, or SDK used in your project, how was your onboarding experience?
- **Ring:** reading the API reference to a working signed-webhook handler took under an hour; the docs are well organized for the happy path. Console sign-up needed government-ID verification, after which creating a private app and generating a Playground token took minutes. The friction is what the token can do: device reads work, but snapshots, chime audio and webhook delivery do not, so we built a simulator that mirrors the documented payloads and a hybrid mode that keeps the real reads live and labels the rest.
- **Strands Agents SDK (TypeScript):** zero to an agent calling a tool against our model in about 15 minutes (`pnpm add @strands-agents/sdk`, `OpenAIModel` with a base URL). One build gotcha: in Next.js 16 we had to add `serverExternalPackages: ["@strands-agents/sdk"]` because Turbopack tried to bundle an optional AWS SDK import.

## Feedback Q5: Would you build with these devices and services again?
Yes. Ring's event stream plus a Chime is a surprisingly strong platform for caregiving, not just security: a signed "person at the exit door" event and one way to speak in the home are enough to build something families need. We'd build more once custom Chime audio exists and the Playground can serve a snapshot and deliver events to a webhook. We'd use Strands again for any agent where the rules must hold: hooks let us keep the care plan in code while the model handles language and images.

## Feature requests (optional)
1. **A Playground that exercises the whole app** (Critical): canned footage for image download, a virtual chime with slots, a second virtual camera, and an option to deliver simulated events to the app's webhook URL.
2. **Custom audio upload + list for Chimes** (`POST /v1/devices/{id}/media/audio`, `GET .../audio`) with format/length limits. Critical: caregiving, accessibility and business apps all need their own voice prompts.
3. **Signed timestamp on webhooks** with a documented tolerance window. Important: replay protection for safety-relevant events.
4. **Door/contact and "exit direction" signals** (e.g. which way a person crossed a motion zone). Nice-to-have: fewer false alarms for night-exit use cases.
5. **Strands TypeScript README guardrail example** for `BeforeToolCallEvent.cancel` and typed `ModelMessageEvent` content. Nice-to-have.

## Friction log
See FRICTION_LOG.md in the repo (link the GitHub file URL in the optional Friction Log field).

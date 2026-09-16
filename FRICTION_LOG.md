# Friction log

Real friction we hit while building Night Door against the Ring Partner API docs and the Strands Agents TypeScript SDK (Sep 2026). Each entry: task, steps, expected vs. actual, severity, workaround, suggestion.

Severity scale: **High** blocks a core feature · **Medium** costs hours or forces a guess · **Low** annoyance.

---

## 1. Playing a family member's voice on a Ring Chime: `audio_ref` is undocumented

- **Task:** Play a pre-recorded, familiar voice message ("Dad, it's Maya…") on the Ring Chime when a night exit is detected.
- **Steps:** Read the API reference for `POST /v1/devices/{device_id}/media/audio/playback`. It takes `{"audio_ref": "custom_audio_1", "components": [0]}` and "Requires the Chime Controls capability". Searched the reference for how an `audio_ref` is created, listed, or uploaded.
- **Expected:** An endpoint (or console flow) to upload an MP3/WAV and get back an `audio_ref`, or a list of the refs available on a chime.
- **Actual:** No upload endpoint, no list endpoint, no example of the capabilities JSON that describes "audio slot count". We could not find where `custom_audio_1` comes from.
- **Severity:** High (the calm familiar voice is the core of our product).
- **Workaround:** The `audio_ref` is configurable (`RING_CHIME_AUDIO_REF`) and the simulator records the playback request. The live checklist tells the tester to confirm the slot name before re-recording.
- **Suggestion:** Document the audio lifecycle end to end: upload (format, max length, max slots), list refs per chime, and a capabilities JSON example with the slot fields.

## 2. Event history has no response schema

- **Task:** In live mode, backfill events that happened before our webhook was reachable (e.g. while a tunnel restarted).
- **Steps:** Looked up `GET /v1/history/devices/{device_id}/events` in the API reference.
- **Expected:** A response example with field names, event types, and pagination/time-range parameters.
- **Actual:** The endpoint is listed as "Get event history for a device" with no response example, field names or query parameters.
- **Severity:** Medium.
- **Workaround:** Live mode relies on signed webhooks only. `RingClient.eventHistory()` returns the raw JSON for inspection but nothing depends on its shape.
- **Suggestion:** Add a JSON example with `type`, `timestamp`, `sub_type`, and document `limit` / `start` / `end` or cursor pagination.

## 3. Component ids use three different shapes across endpoints

- **Task:** Use the same camera component from a webhook to fetch a snapshot and (for chimes) play audio.
- **Steps:** Compared the three documented bodies.
- **Expected:** One representation of a component id.
- **Actual:** The webhook sends `"component_ids": [0, 1]` (array of numbers). Snapshot download takes `"components": [{"component_id": "N"}]` (array of objects with a string). Audio playback takes `"components": [0]` (array of numbers).
- **Severity:** Medium (easy to send the wrong shape and get a 4xx with no hint).
- **Workaround:** `lib/ring/client.ts` converts per endpoint (`String(componentId)` for snapshots).
- **Suggestion:** Accept both forms everywhere, or document one canonical shape with an explicit note on each endpoint.

## 4. Webhook signature covers only the body (no timestamp)

- **Task:** Verify Ring webhooks securely in `/api/ring/webhook`.
- **Steps:** Implemented `X-Signature: sha256=<hex HMAC-SHA256(hmac_signing_key, raw_body)>` from the docs.
- **Expected:** A signed timestamp header (or guidance) so receivers can reject replayed requests.
- **Actual:** Only the body is signed. A captured request can be replayed indefinitely with a valid signature.
- **Severity:** Medium (security).
- **Workaround:** We drop duplicate `meta.request_id` values we have already queued.
- **Suggestion:** Add a signed timestamp (e.g. `X-Signature-Timestamp`, signature over `timestamp.body`) and document a tolerance window and retry behavior.

## 5. Getting started without a device: conflicting prerequisites

- **Task:** Decide whether we could build and demo the Ring track without owning Ring hardware.
- **Steps:** Read the Ring "Get started" page and the hackathon resources.
- **Expected:** One clear answer on what a developer with no device can test.
- **Actual:** The Get started page lists "At least one Ring device for testing (camera or doorbell)" as a prerequisite and does not mention the Developer Playground. The hackathon page says a physical device is not required and a free Ring account gives API access.
- **Severity:** Medium (we planned the whole build around a simulator because we could not confirm what works with zero devices).
- **Workaround:** Built a simulator mode that emits correctly shaped, HMAC-signed webhook bodies through the same verification code, clearly labeled "Simulated Ring events", plus a live mode and a checklist for re-recording on the Playground.
- **Suggestion:** Add a "No device yet?" section to Get started: what the Playground can simulate (motion sub-types, button press, snapshots, chime playback), whether simulated events are delivered to your webhook URL, and token lifetime.

## 6. Notification guidance vs. safety alerts

- **Task:** Follow the Ring Appstore UX guide for notifications while sending urgent family alerts.
- **Steps:** Read the notification section: "a maximum of one email or SMS per day for routine notifications".
- **Expected:** Guidance for safety-critical or time-sensitive alerts (a person with dementia leaving at night).
- **Actual:** Only routine notifications are covered; it is unclear whether urgent caregiving alerts are exempt or need a separate opt-in.
- **Severity:** Low.
- **Workaround:** Night Door sends nothing routine. Alerts only fire on a rules-engine decision (one "check" per exit, one "urgent" on the second camera), and quiet events never notify.
- **Suggestion:** Add a category for safety/urgent alerts with consent and rate-limit expectations.

## 7. What the Developer Playground can actually do (answers our #5, and it is less than expected)

- **Task:** After creating the Ring developer account, move Night Door off its own simulator and onto real Ring infrastructure.
- **Steps:** Console → Playground → *Generate token* (30 min, scope `ava.v1:read`), then exercised the endpoints Night Door uses (16 Sep 2026).
- **Expected:** From the Playground's "Simulate live view event" buttons (Package, Vehicle, Motion), we expected simulated events we could receive, plus a snapshot to describe.
- **Actual:**
  - Reads work: one device ("Playground Device", Doorbell Pro), plus `capabilities`, `status`, `configurations`, `locations`, `users/me`.
  - `POST /media/image/download` → **403 `TIME_RANGE_NOT_AUTHORIZED`** for every timestamp we tried; without a timestamp → 403 `REQUEST_FORBIDDEN`.
  - `POST /media/audio/playback` → 400, and `configurations.audio.customizable_slots` is `null`: there is no chime in the sandbox and the token cannot write anyway.
  - `GET /v1/history/devices/{id}/events` → `{"data": []}`.
  - The simulate buttons open a WHEP live-view session in the browser; nothing arrives at a registered webhook URL.
- **Severity:** High for a caregiving app: the two things Night Door depends on (a snapshot and speaking on a chime) are exactly what the sandbox cannot do.
- **Workaround:** `RING_MODE=hybrid` — real device/capability/status/history reads, simulated events, demo scenes for snapshots, simulated chime playback, each labeled in the agent feed and the header badge.
- **Suggestion:** Publish what the Playground supports per endpoint, serve a short canned clip for image download, add a virtual chime with slots, and offer "deliver simulated events to my webhook URL". That single feature would let partners build and test event-driven apps before buying hardware.

## 8. Strands TypeScript: cancelling a tool call from a hook

- **Task:** Enforce the care plan deterministically by blocking a tool call before it runs, and show the reason to the model.
- **Steps:** Looked for a hook example in the `@strands-agents/sdk` (1.17.0) README; then searched the type definitions.
- **Expected:** A README example of a `BeforeToolCallEvent` hook that blocks a call.
- **Actual:** The README lists "Extensible Hooks" but we had to read `dist/src/hooks/events.d.ts` to learn that `BeforeToolCallEvent.cancel` accepts `boolean | string`, and that the string is returned to the model. It works well once found.
- **Severity:** Low.
- **Workaround:** `agent.addHook(BeforeToolCallEvent, (e) => { e.cancel = "R3 Chime cooldown: …" })` in `lib/agent.ts`.
- **Suggestion:** Add a "guardrail hook" snippet to the TypeScript README, including how the cancel reason reaches the model and how `ModelMessageEvent` content blocks are typed (`textBlock`).

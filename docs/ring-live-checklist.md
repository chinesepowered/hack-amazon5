# Switching Night Door from simulator to the real Ring API

The hackathon rules require the demo to show the project working "through a simulator or an actual Ring device". The current video uses Night Door's own clearly labeled simulator. Follow these steps to run against Ring's Developer Playground or a linked Ring account and re-record.

## 1. Create the Ring developer account (owner does this once)
1. Go to https://developer.amazon.com/ring/console and sign up (contact info, organization, use case).
2. Complete identity verification: upload front and back photos of a valid government ID. The full legal name on the Developer Console Company Profile must match the ID exactly. It usually completes in minutes; up to three attempts.
3. In the Developer Console, register an application. Note the **Client ID / secret** and the **HMAC Signature Key**.

## 2. Get a token
- **Fastest:** open the Developer Playground (https://developer.amazon.com/ring/console/playground) and copy the access token. It lasts about 30 minutes.
- **Longer sessions:** link your own Ring account to the app and use the OAuth refresh token with the client id and secret.

## 3. Configure Night Door
In `.env.local` (and in Vercel project env vars for the deployed demo):

```
RING_MODE=live
RING_WEBHOOK_SECRET=<HMAC Signature Key from the console>
RING_ACCESS_TOKEN=<Playground token>          # or RING_REFRESH_TOKEN + RING_CLIENT_ID + RING_CLIENT_SECRET
```

Start the app and list devices:

```
pnpm build && pnpm start -p 3025
curl http://localhost:3025/api/ring/devices
```

Copy the ids into:

```
RING_DEVICE_FRONT_DOOR=<doorbell or camera id at the exit door>
RING_DEVICE_DRIVEWAY=<second camera id>
RING_DEVICE_CHIME=<chime id>
RING_CHIME_AUDIO_REF=<audio slot to play>     # see FRICTION_LOG.md #1: confirm the slot name in the console/Playground
```

Restart. The header badge changes from "Simulated Ring events" to "Live Ring API".

## 4. Webhook URL
- Deployed: set the app's webhook URL in the Developer Console to `https://<your-deployment>/api/ring/webhook`.
- Local: expose the port with a tunnel, e.g. `cloudflared tunnel --url http://localhost:3025`, and use `https://<tunnel-host>/api/ring/webhook`.
- Night Door verifies `X-Signature` (HMAC-SHA256 of the raw body) and answers within 5 seconds; the dashboard pulls queued events every 3 seconds and runs the agent.
- Check it: a request with a wrong signature must return 401.

## 5. Trigger events
1. In the Playground, trigger a simulated **Motion** event (person) on the device mapped to `RING_DEVICE_FRONT_DOOR` during the configured night hours. Tip: for recording in daytime, temporarily set `nightWindow` in `lib/household.ts` to include the current time.
2. Within 10 minutes, trigger a person motion event on the device mapped to `RING_DEVICE_DRIVEWAY`.
3. Tap "safe" on the phone panel.
4. Unknown to verify on first run: whether Playground-simulated events are delivered to your webhook URL. If they are not, use a linked Ring account and walk past the real devices, or note this in the friction log.

## 6. Re-record the video
1. Keep the same narration where it still fits (`_hackathon/hackathon-amazonappdev2026/narr5`); change "simulated Ring events" wording if needed and re-run `tts.py` for changed lines only.
2. Record the screen while triggering events from the Playground. Easiest: OBS or the Windows Game Bar at 1440x900, since events are triggered by hand. Alternatively adapt `record-5.mjs` to wait for `[data-testid=run]` to appear instead of clicking the simulator buttons.
3. Compose with `compose.py` and check frames before uploading. The final cut must stay under 3 minutes.
4. Update the README "Live demo" note and `docs/devpost-answers.md` testing instructions to say which parts use the real Ring API.

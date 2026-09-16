# Running Night Door against the real Ring API

The hackathon rules ask to show the project working "through a simulator or an actual Ring device". This documents what Ring's **Developer Playground** can do (measured 16 Sep 2026 with a live token), what Night Door does with it, and how to re-record.

## 1. What the Playground actually gives you

Token: console → **Playground** → *Generate token* (valid ~30 minutes, scope `ava.v1:read`).

| Call | Result |
| --- | --- |
| `GET /v1/devices` (also `?include=status,capabilities`) | ✅ exactly one device: **"Playground Device"**, a Doorbell Pro |
| `GET /v1/devices/{id}/capabilities`, `/status`, `/configurations` | ✅ (configurations show `audio.customizable_slots: null`) |
| `GET /v1/locations`, `GET /v1/users/me` | ✅ |
| `GET /v1/history/devices/{id}/events` | ✅ but always `{"data": []}` |
| `POST /v1/devices/{id}/media/image/download` | ❌ 403 `TIME_RANGE_NOT_AUTHORIZED` (any timestamp) / `REQUEST_FORBIDDEN` (without one) |
| `POST /v1/devices/{id}/media/audio/playback` | ❌ 400 — read-only token, and the sandbox has no chime |

There is also **no second camera** (Night Door's escalation needs one) and the Playground's Package/Vehicle/Motion buttons only open a WHEP live-view session in the browser: they are not delivered to a partner webhook URL.

## 2. Hybrid mode (what we ship)

`RING_MODE=hybrid`:

| Part of the demo | Source in hybrid |
| --- | --- |
| Device list / capabilities / status, event history | **Ring Partner API** (badge shows the real device name) |
| Night exit, driveway sighting, doorbell press | Simulated, signed with the app's HMAC key and verified by the same code as real webhooks |
| Snapshots | Demo scenes, with the Ring failure reason attached to the tool result |
| Ring Chime audio | Simulated (`play_chime_message` result says so) |

With no token, or an expired one, hybrid falls back to the simulator; the demo never breaks mid-recording.

## 3. Run it

```bash
RING_MODE=hybrid
RING_ACCESS_TOKEN=<paste the 30-minute Playground token>
RING_WEBHOOK_SECRET=<HMAC signature key from the app credentials>
```

```bash
pnpm build && pnpm start -p 3025
curl -s localhost:3025/api/ring/devices | jq '.mode, (.devices.data[]?.attributes.name)'
```

Expect `"hybrid"` and `"Playground Device"`. The header badge reads **"Live Ring device · Playground Device · simulated events"**.

## 4. Fully live (real Ring account with hardware)

`RING_MODE=live` plus either `RING_ACCESS_TOKEN` or `RING_REFRESH_TOKEN` + `RING_CLIENT_ID` + `RING_CLIENT_SECRET`, and map the household roles to real device ids:

```bash
RING_DEVICE_FRONT_DOOR=…   # exit door camera/doorbell
RING_DEVICE_DRIVEWAY=…     # second camera for the escalation rule
RING_DEVICE_CHIME=…
RING_CHIME_AUDIO_REF=…     # slot name; still undocumented, see FRICTION_LOG.md #1
```

Register the webhook URL (`https://<deployment>/api/ring/webhook`, or a `cloudflared` tunnel) in the app's Configure step. Night Door verifies `X-Signature` (HMAC-SHA256 of the raw body) and answers within 5 s; the dashboard polls queued events every 3 s.

## 5. Re-recording the demo video

1. Paste a fresh token, start the production build in hybrid mode, confirm the badge shows the real device.
2. Record with `scripts/record-5.mjs` (from `_hackathon/hackathon-amazonappdev2026`).
3. Narration must match what is on screen: it says the device reads are live and the events are simulated. Regenerate only changed lines with `tts.py`.
4. Compose, check frames, keep the cut under 3 minutes, then update the Devpost video URL.

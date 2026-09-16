import { simSnapshotPath } from "./sim";

export const RING_API_BASE = "https://api.amazonvision.com";

// Three modes:
//   live      everything goes to the Ring Partner API
//   hybrid    the reads the Ring Developer Playground actually serves are real (devices,
//             capabilities, status, event history); snapshots, chime audio and the events
//             themselves are simulated and labeled per element in the UI
//   simulator no network; the documented shapes are produced locally
//
// Measured against the Playground (token scope `ava.v1:read`): the sandbox account has one
// Doorbell Pro, image download answers 403 TIME_RANGE_NOT_AUTHORIZED for every timestamp we tried,
// there is no chime, and audio playback is rejected. Hence hybrid. See docs/ring-live-checklist.md.

export type RingMode = "simulator" | "hybrid" | "live";
export type Source = "ring" | "simulated";

export function ringMode(): RingMode {
  const m = process.env.RING_MODE;
  return m === "live" || m === "hybrid" ? m : "simulator";
}

export const hasRingToken = () => !!(process.env.RING_ACCESS_TOKEN || process.env.RING_REFRESH_TOKEN);

export interface SnapshotImage {
  src: string;
  dataUri: string;
  mime: string;
  bytes: number;
  source: Source;
  /** Why it is simulated, when it is. Surfaced in the agent feed. */
  note?: string;
}

export interface ChimeResult {
  status: number;
  source: Source;
  note?: string;
}

export interface RingClient {
  mode: RingMode;
  listDevices(): Promise<unknown>;
  eventHistory(deviceId: string): Promise<unknown>;
  downloadSnapshot(deviceId: string, componentId?: number): Promise<SnapshotImage>;
  playChimeAudio(deviceId: string, audioRef: string, components?: number[]): Promise<ChimeResult>;
}

// Household device ids are demo ids; live mode maps them to the account's real Ring devices.
const LIVE_DEVICE_MAP: Record<string, string | undefined> = {
  "ring-dev-front-door": process.env.RING_DEVICE_FRONT_DOOR,
  "ring-dev-ruth-door": process.env.RING_DEVICE_FRONT_DOOR,
  "ring-dev-driveway": process.env.RING_DEVICE_DRIVEWAY,
  "ring-dev-hall-chime": process.env.RING_DEVICE_CHIME,
  "ring-dev-ruth-chime": process.env.RING_DEVICE_CHIME,
};

export function liveDeviceId(demoId: string): string {
  return LIVE_DEVICE_MAP[demoId] || demoId;
}

export function demoDeviceId(liveId: string): string {
  const hit = Object.entries(LIVE_DEVICE_MAP).find(([, v]) => v && v === liveId);
  return hit ? hit[0] : liveId;
}

const SANDBOX_SNAPSHOT_NOTE = "Playground has no recorded footage (403 TIME_RANGE_NOT_AUTHORIZED); demo scene";
const SANDBOX_CHIME_NOTE = "Playground account has no chime; playback simulated";

let cachedToken: { value: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (process.env.RING_ACCESS_TOKEN) return process.env.RING_ACCESS_TOKEN;
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const { RING_REFRESH_TOKEN, RING_CLIENT_ID, RING_CLIENT_SECRET } = process.env;
  if (!RING_REFRESH_TOKEN || !RING_CLIENT_ID || !RING_CLIENT_SECRET) {
    throw new Error("Live mode needs RING_ACCESS_TOKEN or RING_REFRESH_TOKEN + RING_CLIENT_ID + RING_CLIENT_SECRET");
  }
  const res = await fetch("https://oauth.ring.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: RING_REFRESH_TOKEN,
      client_id: RING_CLIENT_ID,
      client_secret: RING_CLIENT_SECRET,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Ring token refresh failed (${res.status})`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function ringErrorMessage(res: Response, what: string) {
  const body = (await res.json().catch(() => null)) as { errors?: { code?: string; detail?: string }[] } | null;
  const first = body?.errors?.[0];
  return `${what} ${res.status}${first?.code ? ` ${first.code}` : ""}${first?.detail ? `: ${first.detail}` : ""}`;
}

class LiveRingClient implements RingClient {
  mode: RingMode = "live";

  private async request(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
    const res = await fetch(RING_API_BASE + path, {
      ...init,
      headers: { Authorization: `Bearer ${await accessToken()}`, Accept: "application/json", ...init.headers },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 429 && !retried) {
      const wait = Number(res.headers.get("Retry-After") ?? "1");
      await new Promise((r) => setTimeout(r, Math.min(wait, 5) * 1000));
      return this.request(path, init, true);
    }
    if (!res.ok) throw new Error(await ringErrorMessage(res, `${init.method ?? "GET"} ${path}`));
    return res;
  }

  async listDevices() {
    return (await this.request("/v1/devices?include=status,capabilities")).json();
  }

  async eventHistory(deviceId: string) {
    return (await this.request(`/v1/history/devices/${encodeURIComponent(liveDeviceId(deviceId))}/events`)).json();
  }

  async downloadSnapshot(deviceId: string, componentId = 0): Promise<SnapshotImage> {
    const res = await this.request(`/v1/devices/${encodeURIComponent(liveDeviceId(deviceId))}/media/image/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "at_timestamp", timestamp: Math.floor(Date.now() / 1000), components: [{ component_id: String(componentId) }] }),
    });
    const mime = res.headers.get("Content-Type")?.split(";")[0] || "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    const dataUri = `data:${mime};base64,${buf.toString("base64")}`;
    return { src: dataUri, dataUri, mime, bytes: buf.length, source: "ring" };
  }

  async playChimeAudio(deviceId: string, audioRef: string, components: number[] = [0]) {
    const ref = process.env.RING_CHIME_AUDIO_REF || audioRef;
    const res = await this.request(`/v1/devices/${encodeURIComponent(liveDeviceId(deviceId))}/media/audio/playback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { type: "audio", attributes: { audio_ref: ref } }, components }),
    });
    return { status: res.status, source: "ring" as const };
  }
}

class SimulatorRingClient implements RingClient {
  mode: RingMode = "simulator";
  constructor(
    private origin: string,
    private note?: string,
  ) {}

  async listDevices() {
    return { data: [], meta: { simulated: true } };
  }

  async eventHistory() {
    return { data: [], meta: { simulated: true } };
  }

  async downloadSnapshot(deviceId: string): Promise<SnapshotImage> {
    const path = simSnapshotPath(deviceId);
    if (!path) throw new Error(`Simulator has no camera image for ${deviceId}`);
    const res = await fetch(new URL(path, this.origin), { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Simulator snapshot ${res.status}`);
    const mime = res.headers.get("Content-Type")?.split(";")[0] || "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    return { src: path, dataUri: `data:${mime};base64,${buf.toString("base64")}`, mime, bytes: buf.length, source: "simulated", note: this.note };
  }

  async playChimeAudio() {
    return { status: 202, source: "simulated" as const, note: this.note };
  }
}

/**
 * Hybrid: real device reads, simulated media. Every live call degrades to the simulator with a
 * note rather than failing, so a stale 30-minute Playground token never breaks the demo.
 */
class HybridRingClient implements RingClient {
  mode: RingMode = "hybrid";
  private live = new LiveRingClient();
  private sim: SimulatorRingClient;
  constructor(origin: string) {
    this.sim = new SimulatorRingClient(origin, SANDBOX_SNAPSHOT_NOTE);
  }

  async listDevices() {
    if (!hasRingToken()) return { data: [], meta: { simulated: true, reason: "no RING_ACCESS_TOKEN" } };
    try {
      return await this.live.listDevices();
    } catch (err) {
      return { data: [], meta: { simulated: true, reason: err instanceof Error ? err.message : String(err) } };
    }
  }

  async eventHistory(deviceId: string) {
    if (!hasRingToken()) return { data: [], meta: { simulated: true } };
    try {
      return await this.live.eventHistory(deviceId);
    } catch (err) {
      return { data: [], meta: { simulated: true, reason: err instanceof Error ? err.message : String(err) } };
    }
  }

  async downloadSnapshot(deviceId: string, componentId = 0): Promise<SnapshotImage> {
    if (hasRingToken()) {
      try {
        return await this.live.downloadSnapshot(deviceId, componentId);
      } catch {
        // fall through to the demo scene, noted below
      }
    }
    return this.sim.downloadSnapshot(deviceId);
  }

  async playChimeAudio(): Promise<ChimeResult> {
    return { status: 202, source: "simulated", note: SANDBOX_CHIME_NOTE };
  }
}

export function getRingClient(origin: string): RingClient {
  const mode = ringMode();
  if (mode === "live") return new LiveRingClient();
  if (mode === "hybrid") return new HybridRingClient(origin);
  return new SimulatorRingClient(origin);
}

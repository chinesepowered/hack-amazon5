import { simSnapshotPath } from "./sim";

export const RING_API_BASE = "https://api.amazonvision.com";

export type RingMode = "simulator" | "live";

export function ringMode(): RingMode {
  return process.env.RING_MODE === "live" ? "live" : "simulator";
}

export interface SnapshotImage {
  src: string;
  dataUri: string;
  mime: string;
  bytes: number;
}

export interface RingClient {
  mode: RingMode;
  listDevices(): Promise<unknown>;
  eventHistory(deviceId: string): Promise<unknown>;
  downloadSnapshot(deviceId: string, componentId?: number): Promise<SnapshotImage>;
  playChimeAudio(deviceId: string, audioRef: string, components?: number[]): Promise<{ status: number }>;
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
    if (!res.ok) throw new Error(`Ring API ${res.status} on ${init.method ?? "GET"} ${path}`);
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
      body: JSON.stringify({ components: [{ component_id: String(componentId) }] }),
    });
    const mime = res.headers.get("Content-Type")?.split(";")[0] || "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    const dataUri = `data:${mime};base64,${buf.toString("base64")}`;
    return { src: dataUri, dataUri, mime, bytes: buf.length };
  }

  async playChimeAudio(deviceId: string, audioRef: string, components: number[] = [0]) {
    const ref = process.env.RING_CHIME_AUDIO_REF || audioRef;
    const res = await this.request(`/v1/devices/${encodeURIComponent(liveDeviceId(deviceId))}/media/audio/playback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio_ref: ref, components }),
    });
    return { status: res.status };
  }
}

class SimulatorRingClient implements RingClient {
  mode: RingMode = "simulator";
  constructor(private origin: string) {}

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
    return { src: path, dataUri: `data:${mime};base64,${buf.toString("base64")}`, mime, bytes: buf.length };
  }

  async playChimeAudio() {
    return { status: 202 };
  }
}

export function getRingClient(origin: string): RingClient {
  return ringMode() === "live" ? new LiveRingClient() : new SimulatorRingClient(origin);
}

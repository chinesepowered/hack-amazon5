export type HouseholdId = "walter" | "ruth";

export type RingEventKind = "motion_detected" | "button_press";

/** A verified Ring webhook, normalized from the JSON:API payload. */
export interface RingEvent {
  kind: RingEventKind;
  requestId: string;
  accountId: string;
  deviceId: string;
  subType?: string;
  componentIds: number[];
  timestamp: number;
}

export type AppEvent =
  | { kind: "clock_tick"; timestamp: number }
  | { kind: "family_confirmed_safe"; timestamp: number; by: string };

export type IncomingEvent = RingEvent | AppEvent;

export interface Clothing {
  top: string;
  bottom: string;
  footwear: string;
  headwear: string;
  carrying: string;
  direction: string;
}

export interface Snapshot {
  id: string;
  deviceId: string;
  deviceName: string;
  capturedAt: number;
  src: string;
}

export interface Alert {
  id: string;
  memberId: string;
  level: "info" | "check" | "urgent";
  title: string;
  body: string;
  at: number;
  snapshot?: Snapshot;
  clothing?: Clothing;
}

export interface CallChainEntry {
  memberId: string;
  name: string;
  relation: string;
  phone: string;
  note: string;
}

export interface Incident {
  id: string;
  status: "watching" | "escalated" | "closed";
  openedAt: number;
  doorEventAt: number;
  doorDeviceId: string;
  doorSnapshot?: Snapshot;
  clothing?: Clothing;
  chimePlayedAt?: number;
  lastSeen?: {
    at: number;
    deviceId: string;
    deviceName: string;
    direction: string;
    snapshot?: Snapshot;
    clothing?: Clothing;
  };
  callChain?: CallChainEntry[];
  scripts?: { nonEmergency: string; emergency: string; emergencyAfter: number };
  closedAt?: number;
  closedBy?: string;
  summary?: string;
  followUp?: string;
}

export interface LogItem {
  id: string;
  at: number;
  deviceId?: string;
  eventKind: string;
  label: string;
  detail: string;
  tone: "quiet" | "watch" | "alert" | "safe" | "info";
}

export interface ChimePlay {
  at: number;
  deviceId: string;
  audioRef: string;
  text: string;
  voiceOf: string;
}

export interface CheckIn {
  status: "sent" | "ok";
  sentAt: number;
  okAt?: number;
}

export interface NightState {
  household: HouseholdId;
  log: LogItem[];
  incident: Incident | null;
  alerts: Alert[];
  chimes: ChimePlay[];
  checkIn: CheckIn | null;
}

export interface RuleCheck {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

export type StreamItem =
  | { t: "webhook"; raw: string; signature: string; verified: boolean; source: "simulator" | "ring" }
  | { t: "ring_devices"; source: "simulator" | "ring"; names: string[]; note?: string }
  | { t: "assess"; decision: "run" | "suppress" | "ignore"; reason: string; protocol: string[]; rules: RuleCheck[]; at: number; title: string }
  | { t: "tool_call"; id: string; name: string; input: unknown; verdict: "allowed" | "blocked"; rule?: string; reason?: string }
  | { t: "tool_result"; name: string; summary: string; image?: string; source?: "simulator" | "ring"; note?: string }
  | { t: "agent_text"; text: string }
  | { t: "state"; state: NightState }
  | { t: "error"; message: string }
  | { t: "done"; ms: number; modelCalls: number };

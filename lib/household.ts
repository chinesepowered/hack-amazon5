import type { HouseholdId } from "./types";

// Fictional households used by the demo. In a real deployment this is the caregiver's care plan.

export interface Device {
  id: string;
  name: string;
  kind: "doorbell" | "camera" | "floodlight" | "chime";
  role: "exit_door" | "perimeter" | "chime";
  x: number;
  y: number;
}

export interface Member {
  id: string;
  name: string;
  relation: string;
  phone: string;
  onDuty: boolean;
  note: string;
}

export interface ChimeMessage {
  audioRef: string;
  voiceOf: string;
  text: string;
  purpose: "night_return" | "morning_check_in";
}

export interface Household {
  id: HouseholdId;
  resident: {
    name: string;
    fullName: string;
    age: number;
    condition: string;
    livesAlone: boolean;
    callName: string;
    familyTerm: string;
    pronoun: "He" | "She";
  };
  city: string;
  utcOffsetMin: number;
  date: string;
  devices: Device[];
  members: Member[];
  chimeMessages: ChimeMessage[];
  nightWindow?: { start: string; end: string };
  expectedArrivals: { who: string; deviceId: string; start: string; end: string; reason: string }[];
  escalation: { secondSignalMin: number; chimeCooldownMin: number; emergencyAfterMin: number };
  quietMorning?: { since: string; by: string };
}

export const HOUSEHOLDS: Record<HouseholdId, Household> = {
  walter: {
    id: "walter",
    resident: {
      name: "Walter",
      fullName: "Walter Brooks",
      age: 81,
      condition: "moderate Alzheimer's",
      livesAlone: false,
      callName: "Dad",
      familyTerm: "my father",
      pronoun: "He",
    },
    city: "St. Louis, MO",
    utcOffsetMin: -300,
    date: "2026-09-15",
    devices: [
      { id: "ring-dev-front-door", name: "Front Door", kind: "doorbell", role: "exit_door", x: 150, y: 222 },
      { id: "ring-dev-back-door", name: "Back Door", kind: "camera", role: "exit_door", x: 96, y: 30 },
      { id: "ring-dev-driveway", name: "Driveway", kind: "floodlight", role: "perimeter", x: 318, y: 58 },
      { id: "ring-dev-hall-chime", name: "Hallway Chime", kind: "chime", role: "chime", x: 205, y: 88 },
    ],
    members: [
      { id: "maya", name: "Maya", relation: "daughter · on duty tonight", phone: "(314) 555-0142", onDuty: true, note: "6 min away" },
      { id: "leo", name: "Leo", relation: "son · lives with Dad", phone: "(314) 555-0178", onDuty: false, note: "asleep after night shift" },
      { id: "june", name: "June Okafor", relation: "neighbor · has a key", phone: "(314) 555-0199", onDuty: false, note: "next door" },
    ],
    chimeMessages: [
      {
        audioRef: "night_voice_maya",
        voiceOf: "Maya",
        text: "Dad, it's Maya. It's the middle of the night. Let's head back inside and get some sleep.",
        purpose: "night_return",
      },
    ],
    nightWindow: { start: "23:00", end: "06:00" },
    expectedArrivals: [
      { who: "Leo", deviceId: "ring-dev-front-door", start: "01:30", end: "02:00", reason: "home from his night shift" },
    ],
    escalation: { secondSignalMin: 10, chimeCooldownMin: 5, emergencyAfterMin: 15 },
  },
  ruth: {
    id: "ruth",
    resident: {
      name: "Ruth",
      fullName: "Ruth Harmon",
      age: 79,
      condition: "early-stage dementia",
      livesAlone: true,
      callName: "Grandma",
      familyTerm: "my grandmother",
      pronoun: "She",
    },
    city: "Dayton, OH",
    utcOffsetMin: -240,
    date: "2026-09-15",
    devices: [
      { id: "ring-dev-ruth-door", name: "Front Door", kind: "doorbell", role: "exit_door", x: 132, y: 222 },
      { id: "ring-dev-ruth-chime", name: "Kitchen Chime", kind: "chime", role: "chime", x: 200, y: 118 },
    ],
    members: [
      { id: "sam", name: "Sam", relation: "grandson · checks in daily", phone: "(937) 555-0114", onDuty: true, note: "20 min away" },
    ],
    chimeMessages: [
      {
        audioRef: "morning_voice_sam",
        voiceOf: "Sam",
        text: "Good morning, Grandma, it's Sam. If you're doing okay, open the front door and press the doorbell button.",
        purpose: "morning_check_in",
      },
    ],
    expectedArrivals: [],
    escalation: { secondSignalMin: 10, chimeCooldownMin: 30, emergencyAfterMin: 60 },
    quietMorning: { since: "06:00", by: "10:00" },
  },
};

export function deviceById(h: Household, id: string | undefined): Device | undefined {
  return h.devices.find((d) => d.id === id);
}

export function hmToMinutes(hm: string): number {
  const [hh, mm] = hm.split(":").map(Number);
  return hh * 60 + mm;
}

/** Epoch ms for a local HH:MM on the household's scenario date. */
export function tsAt(h: Household, hm: string): number {
  const [y, m, d] = h.date.split("-").map(Number);
  const [hh, mm] = hm.split(":").map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - h.utcOffsetMin * 60000;
}

export function localMinutes(h: Household, ts: number): number {
  const d = new Date(ts + h.utcOffsetMin * 60000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function minutesLabel(total: number): string {
  const hr24 = Math.floor(total / 60) % 24;
  const mm = String(total % 60).padStart(2, "0");
  const ap = hr24 >= 12 ? "PM" : "AM";
  return `${hr24 % 12 || 12}:${mm} ${ap}`;
}

export function timeLabel(h: Household, ts: number): string {
  return minutesLabel(localMinutes(h, ts));
}

export function hmLabel(hm: string): string {
  return minutesLabel(hmToMinutes(hm));
}

export function inWindow(minutes: number, start: string, end: string): boolean {
  const s = hmToMinutes(start);
  const e = hmToMinutes(end);
  return s <= e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

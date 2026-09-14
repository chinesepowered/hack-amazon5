"use client";

import type { NightState } from "@/lib/types";
import { timeLabel, type Device, type Household } from "@/lib/household";

const TONE_COLOR: Record<string, string> = {
  quiet: "#6c7896",
  watch: "#f5b971",
  alert: "#ff7a72",
  safe: "#6fdcaa",
  info: "#4a5572",
};

export default function HomeMap({ h, state, pulse }: { h: Household; state: NightState; pulse: { deviceId: string; n: number } | null }) {
  const night = h.id === "walter";
  const inc = state.incident;
  const lastTone = (d: Device) => {
    const item = [...state.log].reverse().find((l) => l.deviceId === d.id);
    return item ? TONE_COLOR[item.tone] : "#8fb4ff";
  };
  const chimeActive = state.chimes.length > 0 && (inc ? inc.status !== "closed" : state.checkIn?.status === "sent");

  return (
    <svg className="map-svg" viewBox="0 0 380 300" role="img" aria-label={`Map of ${h.resident.name}'s home with Ring devices`}>
      <defs>
        <linearGradient id="mapbg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={night ? "#0a1022" : "#1d3346"} />
          <stop offset="1" stopColor={night ? "#0c1a16" : "#1f3a2c"} />
        </linearGradient>
      </defs>
      <rect width="380" height="300" rx="12" fill="url(#mapbg)" />

      {night ? (
        <g>
          <path d="M352 14 a10 10 0 1 0 8 15 a8 8 0 1 1 -8 -15 Z" fill="#dfe5ff" opacity="0.9" />
          <circle cx="330" cy="22" r="1" fill="#cdd6ff" />
          <circle cx="20" cy="16" r="1" fill="#cdd6ff" />
        </g>
      ) : (
        <circle cx="352" cy="24" r="12" fill="#ffd27a" opacity="0.85" />
      )}

      {/* street + sidewalk */}
      <rect x="0" y="266" width="380" height="34" fill={night ? "#161b28" : "#3a4150"} />
      <line x1="0" y1="283" x2="380" y2="283" stroke="#c9b35c" strokeOpacity="0.35" strokeDasharray="10 8" />
      <rect x="0" y="256" width="380" height="10" fill={night ? "#2a2f3a" : "#6b7280"} />
      <text x="8" y="294" fontSize="8" fill="#8a93a8">
        STREET
      </text>

      {night ? (
        <>
          {/* driveway */}
          <rect x="290" y="44" width="72" height="212" fill="#232a3a" />
          <rect x="296" y="150" width="58" height="84" rx="12" fill="#2d3a52" />
          <text x="326" y="246" fontSize="8" fill="#8a93a8" textAnchor="middle">
            DRIVEWAY
          </text>
          {/* house */}
          <rect x="40" y="34" width="232" height="180" rx="8" fill="#141a2b" stroke="#2c3550" />
          <line x1="140" y1="34" x2="140" y2="124" stroke="#2c3550" />
          <line x1="40" y1="124" x2="272" y2="124" stroke="#2c3550" />
          <text x="90" y="82" fontSize="9" fill="#6c7896" textAnchor="middle">
            Bedroom
          </text>
          <text x="232" y="62" fontSize="9" fill="#6c7896" textAnchor="middle">
            Hall
          </text>
          <text x="156" y="174" fontSize="9" fill="#6c7896" textAnchor="middle">
            Living room
          </text>
          {/* doors */}
          <rect x="140" y="210" width="20" height="6" fill="#f5b971" opacity="0.7" />
          <rect x="86" y="32" width="20" height="5" fill="#f5b971" opacity="0.5" />
          <rect x="143" y="216" width="14" height="40" fill="#2a2f3a" />
        </>
      ) : (
        <>
          <g fill="#3f7a4d" opacity="0.8">
            <circle cx="300" cy="120" r="16" />
            <circle cx="326" cy="160" r="12" />
            <circle cx="30" cy="236" r="10" />
          </g>
          <rect x="50" y="46" width="224" height="168" rx="8" fill="#20283a" stroke="#3a4560" />
          <line x1="160" y1="46" x2="160" y2="140" stroke="#3a4560" />
          <line x1="50" y1="140" x2="274" y2="140" stroke="#3a4560" />
          <text x="104" y="96" fontSize="9" fill="#9aa5c0" textAnchor="middle">
            Bedroom
          </text>
          <text x="218" y="96" fontSize="9" fill="#9aa5c0" textAnchor="middle">
            Kitchen
          </text>
          <text x="162" y="182" fontSize="9" fill="#9aa5c0" textAnchor="middle">
            Living room
          </text>
          <rect x="122" y="210" width="20" height="6" fill="#f5b971" opacity="0.7" />
          <rect x="125" y="216" width="14" height="40" fill="#4b5263" />
        </>
      )}

      {/* night exit path */}
      {night && inc && (
        <g>
          <path
            d={inc.status === "watching" ? "M92 88 L150 150 L150 222" : "M92 88 L150 150 L150 250 L300 250 L320 276"}
            fill="none"
            stroke={inc.status === "closed" ? "#6fdcaa" : "#f5b971"}
            strokeWidth="2.2"
            className={inc.status === "closed" ? undefined : "path-walk"}
            strokeDasharray="6 6"
          />
          {inc.lastSeen && (
            <g>
              <circle cx="320" cy="262" r="7" fill={inc.status === "closed" ? "#6fdcaa" : "#ff7a72"} />
              <rect x="226" y="198" width="92" height="30" rx="6" fill="#0b0f1d" stroke={inc.status === "closed" ? "#6fdcaa" : "#ff7a72"} strokeOpacity="0.7" />
              <text x="272" y="210" fontSize="8" fill="#ffc2bd" textAnchor="middle" fontWeight="700">
                {inc.status === "closed" ? "FOUND · SAFE" : "LAST SEEN"}
              </text>
              <text x="272" y="222" fontSize="9" fill="#eef1f8" textAnchor="middle">
                {timeLabel(h, inc.lastSeen.at)} · Driveway
              </text>
            </g>
          )}
        </g>
      )}

      {/* chime sound waves */}
      {chimeActive &&
        h.devices
          .filter((d) => d.kind === "chime")
          .map((d) => (
            <g key={`w-${d.id}`} className="waves" stroke="#f5b971" fill="none" strokeWidth="1.6">
              <path d={`M${d.x + 12} ${d.y - 8} q6 8 0 16`} />
              <path d={`M${d.x + 18} ${d.y - 13} q9 13 0 26`} />
            </g>
          ))}

      {/* devices */}
      {h.devices.map((d) => {
        const active = pulse?.deviceId === d.id;
        const color = lastTone(d);
        return (
          <g key={d.id}>
            {active && <circle key={pulse!.n} cx={d.x} cy={d.y} r="8" fill="none" stroke={color} strokeWidth="2" className="pulse-ring" />}
            <circle cx={d.x} cy={d.y} r="9" fill="#0b0f1d" stroke={color} strokeWidth="2" />
            <DeviceGlyph d={d} color={color} />
            <text x={d.x + (d.x > 300 ? -12 : 12)} y={d.y + (d.y < 40 ? 16 : 4)} fontSize="9" fill="#dfe4f2" textAnchor={d.x > 300 ? "end" : "start"} fontWeight="600">
              {d.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function DeviceGlyph({ d, color }: { d: Device; color: string }) {
  if (d.kind === "chime") return <path d={`M${d.x - 4} ${d.y + 3} h8 l-1.5 -2 v-3 a2.5 2.5 0 0 0 -5 0 v3 Z`} fill={color} />;
  if (d.kind === "doorbell") return <rect x={d.x - 2.5} y={d.y - 4.5} width="5" height="9" rx="2" fill={color} />;
  if (d.kind === "floodlight") return <path d={`M${d.x - 4} ${d.y - 2} h8 l-2 5 h-4 Z`} fill={color} />;
  return <circle cx={d.x} cy={d.y} r="3" fill={color} />;
}

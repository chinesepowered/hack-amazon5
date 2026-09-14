"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HouseholdId, NightState, StreamItem } from "@/lib/types";
import { HOUSEHOLDS, hmLabel, timeLabel, tsAt } from "@/lib/household";
import { initialState } from "@/lib/state";
import HomeMap from "./HomeMap";
import AgentFeed, { type FeedRun } from "./AgentFeed";
import Phone from "./Phone";

type Step = {
  id: string;
  time: string;
  label: string;
  hint: string;
  ring?: { deviceId: string; kind: "motion_detected" | "button_press"; subType?: "human" | "animal" | "vehicle" };
  app?: "clock_tick";
};

const STEPS: Record<HouseholdId, Step[]> = {
  walter: [
    { id: "leo", time: "01:47", label: "1:47 AM · Front Door", hint: "Leo home from night shift", ring: { deviceId: "ring-dev-front-door", kind: "motion_detected", subType: "human" } },
    { id: "exit", time: "02:14", label: "2:14 AM · Front Door", hint: "Someone walks out", ring: { deviceId: "ring-dev-front-door", kind: "motion_detected", subType: "human" } },
    { id: "drive", time: "02:17", label: "2:17 AM · Driveway", hint: "Heading toward the street", ring: { deviceId: "ring-dev-driveway", kind: "motion_detected", subType: "human" } },
  ],
  ruth: [
    { id: "tick", time: "10:00", label: "10:00 AM · Morning check", hint: "No door activity since 6 AM", app: "clock_tick" },
    { id: "press", time: "10:04", label: "10:04 AM · Doorbell button", hint: "Ruth answers the check-in", ring: { deviceId: "ring-dev-ruth-door", kind: "button_press" } },
  ],
};

const START_TIME: Record<HouseholdId, string> = { walter: "01:40", ruth: "09:52" };
const SAFE_TIME: Record<HouseholdId, string> = { walter: "02:26", ruth: "10:06" };

export default function NightDoorApp({ mode }: { mode: "simulator" | "live" }) {
  const [household, setHousehold] = useState<HouseholdId>("walter");
  const h = HOUSEHOLDS[household];
  const [state, setState] = useState<NightState>(() => initialState("walter"));
  const stateRef = useRef(state);
  const [runs, setRuns] = useState<FeedRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [doneSteps, setDoneSteps] = useState(0);
  const [clock, setClock] = useState(() => tsAt(HOUSEHOLDS.walter, START_TIME.walter));
  const [pulse, setPulse] = useState<{ deviceId: string; n: number } | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<string | null>(null);
  const lastAlertCount = useRef(0);

  const applyState = useCallback((s: NightState) => {
    stateRef.current = s;
    setState(s);
    if (s.alerts.length > lastAlertCount.current) setSelectedAlert(s.alerts[s.alerts.length - 1].id);
    lastAlertCount.current = s.alerts.length;
  }, []);

  const reset = useCallback(
    (id: HouseholdId) => {
      setHousehold(id);
      applyState(initialState(id));
      lastAlertCount.current = 0;
      setSelectedAlert(null);
      setRuns([]);
      setDoneSteps(0);
      setPulse(null);
      setClock(tsAt(HOUSEHOLDS[id], START_TIME[id]));
    },
    [applyState],
  );

  const run = useCallback(
    async (payload: { ring?: { raw: string; signature: string }; app?: unknown }, title: string) => {
      setBusy(true);
      const runId = `run-${Date.now()}`;
      setRuns((r) => [...r, { id: runId, title, items: [], status: "running" }]);
      const push = (item: StreamItem) => setRuns((r) => r.map((x) => (x.id === runId ? { ...x, items: [...x.items, item] } : x)));
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: stateRef.current, ...payload }),
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          push({ t: "error", message: err.error ?? `HTTP ${res.status}` });
        } else {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, idx).trim();
              buffer = buffer.slice(idx + 1);
              if (!line) continue;
              const item = JSON.parse(line) as StreamItem;
              if (item.t === "state") applyState(item.state);
              else push(item);
            }
          }
        }
      } catch (err) {
        push({ t: "error", message: err instanceof Error ? err.message : "Network error" });
      }
      setRuns((r) => r.map((x) => (x.id === runId ? { ...x, status: "done" } : x)));
      setBusy(false);
    },
    [applyState],
  );

  const doStep = useCallback(
    async (step: Step) => {
      const ts = tsAt(h, step.time);
      setClock(ts);
      if (step.ring) {
        const res = await fetch("/api/sim/emit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ household, deviceId: step.ring.deviceId, kind: step.ring.kind, subType: step.ring.subType, time: step.time }),
        });
        const signed = (await res.json()) as { raw: string; signature: string };
        setPulse({ deviceId: step.ring.deviceId, n: Date.now() });
        await run({ ring: { raw: signed.raw, signature: signed.signature } }, step.label);
      } else {
        await run({ app: { kind: "clock_tick", timestamp: ts } }, step.label);
      }
      setDoneSteps((d) => d + 1);
    },
    [h, household, run],
  );

  const confirmSafe = useCallback(async () => {
    const ts = tsAt(h, SAFE_TIME[household]);
    setClock(ts);
    const by = (h.members.find((m) => m.onDuty) ?? h.members[0]).name;
    await run({ app: { kind: "family_confirmed_safe", timestamp: ts, by } }, `${hmLabel(SAFE_TIME[household])} · ${by} taps "safe"`);
  }, [h, household, run]);

  // Live mode: pull verified Ring webhooks queued by /api/ring/webhook and run the agent on each.
  useEffect(() => {
    if (mode !== "live") return;
    let since = Date.now() - 60_000;
    let stopped = false;
    const tick = async () => {
      if (stopped || busy) return;
      setClock(Date.now());
      const res = await fetch(`/api/ring/webhook?since=${since}`).catch(() => null);
      const data = res?.ok ? ((await res.json()) as { items: { raw: string; signature: string; receivedAt: number }[] }) : null;
      for (const item of data?.items ?? []) {
        since = Math.max(since, item.receivedAt);
        await run({ ring: { raw: item.raw, signature: item.signature } }, "Live Ring event");
      }
    };
    const id = setInterval(tick, 3000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [mode, busy, run]);

  const steps = STEPS[household];
  const onDuty = h.members.find((m) => m.onDuty) ?? h.members[0];

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <div>
            <div className="brand-name">Night Door</div>
            <div className="brand-sub">
              Care plan for {h.resident.fullName}, {h.resident.age} · {h.resident.condition}
            </div>
          </div>
        </div>
        <div className="tabs" role="tablist" aria-label="Household">
          {(["walter", "ruth"] as HouseholdId[]).map((id) => (
            <button key={id} role="tab" className="tab" aria-selected={household === id} data-testid={`tab-${id}`} disabled={busy} onClick={() => reset(id)}>
              {id === "walter" ? "Walter · night exits" : "Ruth · quiet morning"}
            </button>
          ))}
        </div>
        <div className="topbar-right">
          {mode === "simulator" ? (
            <span className="badge badge-sim" title="Events come from the built-in Ring simulator, signed like real Ring webhooks">
              <span className="dot" /> Simulated Ring events
            </span>
          ) : (
            <span className="badge badge-live">
              <span className="dot" /> Live Ring API
            </span>
          )}
          <span className="badge badge-strands">Strands Agents SDK</span>
          <div className="clock" data-testid="clock" aria-label="Household local time">
            {timeLabel(h, clock)}
          </div>
        </div>
      </header>

      <main className="main">
        <section className="panel" aria-label="Home and timeline">
          <div className="panel-head">
            <span>
              Home · <strong>Ring devices</strong>
            </span>
            <span>{h.city}</span>
          </div>
          <div className="map-wrap">
            <HomeMap h={h} state={state} pulse={pulse} />
          </div>
          <div className="panel-head">
            <span>{household === "walter" ? "Tonight" : "This morning"}</span>
            <span>{state.log.length} events</span>
          </div>
          <div className="timeline" data-testid="timeline">
            {state.log.length === 0 ? (
              <div className="empty">
                {household === "walter"
                  ? `Night hours ${hmLabel(h.nightWindow!.start)}–${hmLabel(h.nightWindow!.end)}. Night Door stays silent unless someone leaves the house when nobody is expected.`
                  : `Ruth lives alone. If there is no door activity by ${hmLabel(h.quietMorning!.by)}, Night Door checks in gently.`}
              </div>
            ) : (
              [...state.log].reverse().map((l) => (
                <div key={l.id} className="tl-item">
                  <span className={`tl-dot tone-${l.tone}`} aria-hidden />
                  <span className="tl-time">{timeLabel(h, l.at)}</span>
                  <div>
                    <div className="tl-label">{l.label}</div>
                    <div className="tl-detail">{l.detail}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel" aria-label="Agent activity">
          <div className="panel-head">
            <span>
              Ring webhook → rules → <strong>Strands agent</strong> → Ring API
            </span>
            <span className="mono">{process.env.NEXT_PUBLIC_MODEL_LABEL ?? "Qwen3.8-27B"}</span>
          </div>
          <AgentFeed runs={runs} busy={busy} h={h} />
        </section>

        <section className="phone-col" aria-label={`${onDuty.name}'s phone`}>
          <Phone h={h} state={state} clock={clock} selectedAlert={selectedAlert} onSelect={setSelectedAlert} onConfirmSafe={confirmSafe} busy={busy} />
        </section>
      </main>

      <footer className="controls">
        <span className="controls-label">{mode === "simulator" ? "Simulate" : "Live"}</span>
        {mode === "simulator" &&
          steps.map((s, i) => (
            <button
              key={s.id}
              className="step"
              data-testid={`step-${s.id}`}
              data-state={i < doneSteps ? "done" : i === doneSteps ? "next" : "later"}
              disabled={busy || i !== doneSteps}
              onClick={() => doStep(s)}
            >
              <span className="step-label">{s.label}</span>
              <span className="step-hint">{s.hint}</span>
            </button>
          ))}
        <button className="reset" data-testid="reset" disabled={busy} onClick={() => reset(household)}>
          Reset
        </button>
        <div className="rules-line">
          {household === "walter" ? (
            <>
              Night {hmLabel(h.nightWindow!.start)}–{hmLabel(h.nightWindow!.end)} · chime cooldown {h.escalation.chimeCooldownMin} min · second signal within {h.escalation.secondSignalMin} min
              <br />
              Clothing only, never identity · family decides who to call
            </>
          ) : (
            <>
              Check at {hmLabel(h.quietMorning!.by)} if no door activity since {hmLabel(h.quietMorning!.since)}
              <br />
              One gentle chime · family notified once
            </>
          )}
        </div>
      </footer>
    </div>
  );
}

function Logo() {
  return (
    <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden>
      <rect x="1" y="1" width="36" height="36" rx="11" fill="#151d33" stroke="#2c3656" />
      <path d="M12 30 V12 a7 7 0 0 1 14 0 V30 Z" fill="#f5b971" opacity="0.18" stroke="#f5b971" strokeWidth="1.6" />
      <circle cx="22.5" cy="21" r="1.4" fill="#f5b971" />
      <path d="M27.5 7.5 a4.5 4.5 0 1 0 3.6 6.6 a3.6 3.6 0 1 1 -3.6 -6.6 Z" fill="#cdd6ff" />
    </svg>
  );
}

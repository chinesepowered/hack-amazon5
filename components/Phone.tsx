"use client";

import type { Alert, NightState } from "@/lib/types";
import { timeLabel, type Household } from "@/lib/household";

interface Props {
  h: Household;
  state: NightState;
  clock: number;
  selectedAlert: string | null;
  onSelect: (id: string | null) => void;
  onConfirmSafe: () => void;
  busy: boolean;
}

export default function Phone({ h, state, clock, selectedAlert, onSelect, onConfirmSafe, busy }: Props) {
  const member = h.members.find((m) => m.onDuty) ?? h.members[0];
  const alerts = state.alerts.filter((a) => a.memberId === member.id);
  const selected = alerts.find((a) => a.id === selectedAlert) ?? null;
  const day = new Date(Date.UTC(...(h.date.split("-").map(Number) as [number, number, number]).map((v, i) => (i === 1 ? v - 1 : v)) as [number, number, number]));
  const dateText = day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

  return (
    <div className="phone" data-testid="phone">
      <div className="phone-screen">
        <div className="phone-notch" aria-hidden />
        <div className="phone-status">
          <span>{timeLabel(h, clock).replace(/ (AM|PM)/, "")}</span>
          <span>5G ▮▮▮</span>
        </div>
        {selected ? (
          <Detail h={h} state={state} alert={selected} onBack={() => onSelect(null)} onConfirmSafe={onConfirmSafe} busy={busy} />
        ) : (
          <>
            <div className="lock-time">{timeLabel(h, clock).replace(/ (AM|PM)/, "")}</div>
            <div className="lock-date">
              {member.name}&apos;s phone · {dateText}
            </div>
            <div className="notifs">
              {alerts.length === 0 && <div className="fine" style={{ marginTop: 40 }}>No notifications. Night Door only reaches out when something needs a person.</div>}
              {[...alerts].reverse().map((a) => (
                <button key={a.id} className={`notif notif-${a.level}`} data-testid={`notif-${a.level}`} onClick={() => onSelect(a.id)}>
                  <div className="notif-top">
                    <span className="notif-app" aria-hidden>
                      ☾
                    </span>
                    NIGHT DOOR · {timeLabel(h, a.at)}
                  </div>
                  <div className="notif-title">{a.title}</div>
                  <div className="notif-body">{a.body}</div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Detail({ h, state, alert, onBack, onConfirmSafe, busy }: { h: Household; state: NightState; alert: Alert; onBack: () => void; onConfirmSafe: () => void; busy: boolean }) {
  const inc = state.incident;
  const chime = [...state.chimes].reverse().find((c) => c.at <= alert.at);
  const r = h.resident;
  const him = r.pronoun === "He" ? "him" : "her";
  const isLatest = state.alerts[state.alerts.length - 1]?.id === alert.id;

  return (
    <div className="sheet" data-testid="alert-detail">
      <button className="sheet-back" onClick={onBack}>
        ‹ Notifications
      </button>
      <div>
        <span className={`level level-${alert.level}`}>{alert.level === "urgent" ? "URGENT" : alert.level === "check" ? "PLEASE CHECK" : "ALL GOOD"}</span>
        <span className="fine" style={{ marginLeft: 8 }}>
          {timeLabel(h, alert.at)}
        </span>
      </div>
      <div className="sheet-title">{alert.title}</div>
      <div className="sheet-body">{alert.body}</div>

      {alert.level === "urgent" && inc?.lastSeen && (
        <div className="card lastseen" data-testid="last-seen">
          <div className="card-title" style={{ color: "#ffb4ad" }}>
            Last seen · {timeLabel(h, inc.lastSeen.at)}
          </div>
          <div>
            <strong>{inc.lastSeen.deviceName}</strong> camera, heading {inc.lastSeen.direction}. Left the house at {timeLabel(h, inc.doorEventAt)}.
          </div>
        </div>
      )}

      {alert.snapshot && (
        <div className="snap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={alert.snapshot.src} alt={`${alert.snapshot.deviceName} camera snapshot at ${timeLabel(h, alert.snapshot.capturedAt)}`} />
          <span className="snap-label">
            {alert.snapshot.deviceName} · {timeLabel(h, alert.snapshot.capturedAt)}
          </span>
        </div>
      )}

      {alert.clothing && (
        <div className="card">
          <div className="card-title">What they&apos;re wearing</div>
          <div className="wear">
            {[alert.clothing.top, alert.clothing.bottom, alert.clothing.footwear, alert.clothing.headwear, alert.clothing.carrying]
              .filter((v) => v && !/^none visible/i.test(v))
              .map((v) => (
                <span key={v}>{v}</span>
              ))}
          </div>
        </div>
      )}

      {chime && alert.level !== "urgent" && (
        <div className="card">
          <div className="card-title">Played on the Ring Chime · {chime.voiceOf}&apos;s voice</div>
          <div className="quote">&ldquo;{chime.text}&rdquo;</div>
        </div>
      )}

      {alert.level === "urgent" && inc?.callChain && inc.status === "escalated" && (
        <>
          <div className="card">
            <div className="card-title">Call chain</div>
            {inc.callChain.map((c) => (
              <div className="callrow" key={c.memberId}>
                <div>
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  <div className="fine" style={{ textAlign: "left" }}>
                    {c.relation} · {c.note}
                  </div>
                </div>
                <button className="callbtn" aria-label={`Call ${c.name} (demo)`} onClick={(e) => e.preventDefault()}>
                  Call
                </button>
              </div>
            ))}
          </div>
          {inc.scripts && (
            <div className="card">
              <details className="script" open>
                <summary>Non-emergency line script</summary>
                <p>{inc.scripts.nonEmergency}</p>
              </details>
              <details className="script" style={{ marginTop: 8 }}>
                <summary>If not found by {timeLabel(h, inc.scripts.emergencyAfter)}: 911 script</summary>
                <p>{inc.scripts.emergency}</p>
              </details>
            </div>
          )}
        </>
      )}

      {inc && inc.status !== "closed" && isLatest && h.id === "walter" && (
        <>
          <button className="btn btn-safe" data-testid="confirm-safe" disabled={busy} onClick={onConfirmSafe}>
            {inc.status === "escalated" ? `Found ${him}. ${r.pronoun}'s safe` : `${r.pronoun}'s back inside. All clear`}
          </button>
          <div className="fine">You decide who to call. Night Door never calls 911 for you.</div>
        </>
      )}

      {inc?.status === "closed" && (
        <div className="card" style={{ borderColor: "rgba(111,220,170,.45)" }} data-testid="closed">
          <div className="card-title" style={{ color: "#6fdcaa" }}>
            Closed · {timeLabel(h, inc.closedAt ?? alert.at)} by {inc.closedBy}
          </div>
          <div>{inc.summary}</div>
          {inc.followUp && (
            <div className="fine" style={{ textAlign: "left", marginTop: 6 }}>
              Follow-up: {inc.followUp}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

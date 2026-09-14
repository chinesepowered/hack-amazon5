"use client";

import { useEffect, useRef } from "react";
import type { StreamItem } from "@/lib/types";
import type { Household } from "@/lib/household";

export interface FeedRun {
  id: string;
  title: string;
  items: StreamItem[];
  status: "running" | "done";
}

export default function AgentFeed({ runs, busy, h }: { runs: FeedRun[]; busy: boolean; h: Household }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [runs]);

  return (
    <div className="feed" ref={ref} data-testid="feed">
      {runs.length === 0 && (
        <div className="empty">
          Every Ring event arrives as a signed webhook. Night Door verifies the <span className="mono">X-Signature</span> (HMAC-SHA256), a deterministic rules
          engine decides whether anything should happen, and only then a Strands agent calls tools: Ring snapshot download, clothing description, Ring Chime audio
          playback and family alerts. Every tool call passes through a Strands <span className="mono">BeforeToolCallEvent</span> hook that enforces the care plan.
        </div>
      )}
      {runs.map((run) => (
        <div className="run" key={run.id} data-testid="run">
          <div className="run-head">
            <span>{run.title}</span>
            <span className="run-meta">{summary(run)}</span>
          </div>
          <div className="run-body">
            {run.items.map((item, i) => (
              <Item key={i} item={item} h={h} />
            ))}
            {run.status === "running" && (
              <div className="working" data-testid="agent-status">
                <span className="spinner" aria-hidden /> agent is working…
              </div>
            )}
          </div>
        </div>
      ))}
      {!busy && runs.length > 0 && <div className="sr-only" data-testid="agent-idle" />}
    </div>
  );
}

function summary(run: FeedRun): string {
  const done = run.items.find((i) => i.t === "done");
  const tools = run.items.filter((i) => i.t === "tool_call");
  const blocked = tools.filter((i) => i.t === "tool_call" && i.verdict === "blocked").length;
  if (!done || done.t !== "done") return "running";
  return `${(done.ms / 1000).toFixed(1)}s · ${tools.length} tool calls${blocked ? ` · ${blocked} blocked` : ""} · ${done.modelCalls} model calls`;
}

function Item({ item }: { item: StreamItem; h: Household }) {
  switch (item.t) {
    case "webhook": {
      let summaryText = "";
      try {
        const j = JSON.parse(item.raw);
        const a = j.data.attributes;
        summaryText = `data.type: ${j.data.type}${a.sub_type ? ` · sub_type: ${a.sub_type}` : ""} · device: ${j.data.relationships.device.data.id}`;
      } catch {
        summaryText = "unparseable body";
      }
      return (
        <div className="row">
          <span className="row-icon icon-webhook">⇣</span>
          <div>
            <span className="kicker">Ring webhook {item.source === "simulator" ? "(simulated)" : ""}</span>
            <span className={`pill ${item.verified ? "pill-ok" : "pill-block"}`}>{item.verified ? "X-Signature verified" : "signature rejected"}</span>
            <div className="code">{summaryText}</div>
            <div className="code" style={{ opacity: 0.7 }}>
              X-Signature: {item.signature.slice(0, 18)}…{item.signature.slice(-6)} · HMAC-SHA256
            </div>
          </div>
        </div>
      );
    }
    case "assess":
      return (
        <div className="row">
          <span className="row-icon icon-rules">§</span>
          <div>
            <span className="kicker">Rules engine</span>
            <span className={`pill ${item.decision === "run" ? "pill-run" : "pill-quiet"}`}>
              {item.decision === "run" ? "run agent" : item.decision === "suppress" ? "quiet · no model call" : "no action"}
            </span>
            <div>{item.reason}</div>
            <div className="chips">
              {item.rules.map((r) => (
                <span key={r.id} className={`chip ${r.pass ? "chip-pass" : "chip-fail"}`} title={r.detail}>
                  {r.pass ? "✓" : "✕"} {r.id} {r.label}
                </span>
              ))}
            </div>
            {item.protocol.length > 0 && (
              <div className="protocol">
                {item.protocol.map((p, i) => (
                  <span key={p}>
                    {p}
                    {i < item.protocol.length - 1 ? " →" : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    case "tool_call":
      return (
        <div className="row" data-testid={`tool-${item.name}-${item.verdict}`}>
          <span className="row-icon icon-tool">ƒ</span>
          <div>
            <span className="tool-name">{item.name}</span>
            <span className={`pill ${item.verdict === "allowed" ? "pill-ok" : "pill-block"}`}>
              hook {item.verdict}
              {item.rule ? ` · ${item.rule}` : ""}
            </span>
            {item.reason && <div style={{ color: "#ffc2bd" }}>{item.reason}</div>}
            <div className="code">{argsText(item.input)}</div>
          </div>
        </div>
      );
    case "tool_result":
      return (
        <div className="row">
          <span className="row-icon icon-result">↳</span>
          <div>
            <div>{item.summary}</div>
            {item.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="thumb" src={item.image} alt={`Camera snapshot from ${item.summary.split(" snapshot")[0]}`} />
            )}
          </div>
        </div>
      );
    case "agent_text":
      return (
        <div className="row">
          <span className="row-icon icon-agent">✦</span>
          <div className="agent-text">{item.text}</div>
        </div>
      );
    case "error":
      return (
        <div className="row">
          <span className="row-icon icon-error">!</span>
          <div style={{ color: "#ffc2bd" }}>{item.message}</div>
        </div>
      );
    default:
      return null;
  }
}

function argsText(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  return Object.entries(input as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? JSON.stringify(v.length > 90 ? v.slice(0, 90) + "…" : v) : JSON.stringify(v)}`)
    .join(" · ");
}

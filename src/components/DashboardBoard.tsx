"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";

// Portfolio Dashboard (Master 1) — kliens-oldali triage: a 4 csempe
// mindegyike SZŰRI az alatta lévő kártyákat. A kártya a Master
// állapot-nyelvtanát nyomtatja: NEEDS YOU (lila) / GATE (borostyán) /
// STALLED (piros) + 7-szegmensű mini-spine + a blokkoló lépés a kártyán.
// Minden szám a szerverről, meglévő adatokból számolva érkezik.

export type DashStatus = "needs_you" | "gate" | "stalled" | "healthy";

export interface DashCardData {
  id: string;
  name: string;
  clientName: string;
  industry: string;
  initials: string;
  spine: { phase: string; tone: "done" | "active" | "gate" | "idle" }[];
  weekLabel: string;
  lastTouchLabel: string;
  movedThisWeek: boolean;
  status: DashStatus;
  blockLabel: string;
  blockText: string;
  blockTone: "accent" | "gateReady" | "muted";
}

export interface DashSummary {
  needsYou: number;
  needsYouSub: string;
  gates: number;
  gatesSub: string;
  stalled: number;
  stalledSub: string;
  moved: number;
  movedSub: string;
}

const SEGMENT_TONE: Record<DashCardData["spine"][number]["tone"], string> = {
  done: "bg-done",
  active: "bg-action",
  gate: "bg-gate",
  idle: "bg-neutral-150",
};

type Filter = "all" | "needs_you" | "gate" | "stalled" | "moved";

export function DashboardBoard({
  cards,
  summary,
}: {
  cards: DashCardData[];
  summary: DashSummary;
}) {
  const t = useTranslations("dashboard");
  const [filter, setFilter] = useState<Filter>("all");

  const visible = cards.filter((c) => {
    if (filter === "all") return true;
    if (filter === "moved") return c.movedThisWeek;
    return c.status === filter;
  });

  const tile = (
    key: Filter,
    value: number,
    valueCls: string,
    label: string,
    sub: string,
  ) => {
    const active = filter === key;
    return (
      <button
        type="button"
        onClick={() => setFilter(active ? "all" : key)}
        aria-pressed={active}
        className={`rounded-shell p-[14px_16px] text-left transition-colors duration-[var(--motion-fast)] ${
          active
            ? "border-[1.5px] border-action bg-accent-tint"
            : "border border-line bg-surface hover:bg-neutral-50"
        }`}
      >
        <div className="flex items-baseline gap-2">
          <span className={`font-mono text-[30px] font-bold leading-none ${valueCls}`}>
            {value}
          </span>
          <span
            className={`text-[12px] font-semibold ${active ? "text-action-deep" : "text-ink-tertiary"}`}
          >
            {label}
          </span>
        </div>
        <div className="mt-[7px] truncate text-[11.5px] text-ink-secondary">{sub}</div>
      </button>
    );
  };

  const statusPill = (status: DashStatus) => {
    if (status === "needs_you")
      return (
        <span className="shrink-0 rounded-pill bg-action px-2 py-0.5 text-[10.5px] font-bold text-white">
          {t("statusNeedsYou")}
        </span>
      );
    if (status === "gate")
      return (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-tint-gate px-2 py-0.5 text-[10.5px] font-bold text-gate-text">
          <span aria-hidden>◇</span>
          {t("statusGate")}
        </span>
      );
    if (status === "stalled")
      return (
        <span className="shrink-0 rounded-pill bg-tint-error px-2 py-0.5 text-[10.5px] font-bold text-danger">
          {t("statusStalled")}
        </span>
      );
    return null;
  };

  return (
    <div className="space-y-5">
      {/* Triage-csempék (P2: az érték dominál) — kattintásra szűrnek */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {tile("needs_you", summary.needsYou, "text-accent-deeptext", t("tileNeedsYou"), summary.needsYouSub)}
        {tile("gate", summary.gates, "text-gate-text", t("tileGates"), summary.gatesSub)}
        {tile("stalled", summary.stalled, "text-danger", t("tileStalled"), summary.stalledSub)}
        {tile("moved", summary.moved, "text-done-text", t("tileMoved"), summary.movedSub)}
      </div>

      {/* Projekt-kártyák — sorrend fixen: rád-vár → kapu → elakadt → egészséges */}
      {visible.length === 0 ? (
        <p className="rounded-tile border border-dashed border-line px-4 py-6 text-center text-body text-ink-tertiary">
          {t("noFilterMatch")}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((c) => (
            <Link
              key={c.id}
              href={`/project/${c.id}`}
              className={`flex flex-col gap-[13px] rounded-shell bg-surface p-[18px] transition-shadow duration-[var(--motion-base)] ${
                c.status === "needs_you"
                  ? "border-[1.5px] border-action shadow-accent"
                  : c.status === "stalled"
                    ? "border border-tint-error-border shadow-card"
                    : "border border-line shadow-card"
              } hover:shadow-shell`}
            >
              <div className="flex items-start gap-2.5">
                <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-control border border-line bg-sunken font-mono text-[12px] font-bold text-ink-secondary">
                  {c.initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-bold tracking-tight">
                    {c.name}
                  </span>
                  <span className="block truncate text-[11.5px] text-ink-tertiary">
                    {c.clientName}
                    {c.industry ? ` · ${c.industry}` : ""}
                  </span>
                </span>
                {statusPill(c.status)}
              </div>

              {/* 7-szegmensű mini-spine */}
              <div className="flex gap-0.5">
                {c.spine.map((s) => (
                  <span
                    key={s.phase}
                    title={s.phase}
                    className={`h-1.5 flex-1 rounded-[2px] ${SEGMENT_TONE[s.tone]}`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2 text-[11.5px] text-ink-secondary">
                <span
                  className={`font-mono font-semibold ${
                    c.status === "gate"
                      ? "text-gate-text"
                      : c.status === "stalled"
                        ? "text-pivot"
                        : "text-action-deep"
                  }`}
                >
                  {c.weekLabel}
                </span>
                <span className="text-neutral-400">·</span>
                <span className={c.status === "stalled" ? "font-semibold text-danger" : ""}>
                  {c.lastTouchLabel}
                </span>
              </div>

              {/* P5: a blokkoló lépés a kártyán, a döntési ponton */}
              <div
                className={`rounded-tile border p-[11px_12px] ${
                  c.blockTone === "accent"
                    ? "border-accent-box-border bg-accent-box"
                    : c.blockTone === "gateReady"
                      ? "border-tint-gate-border bg-tint-gate-band"
                      : "border-line bg-sunken"
                }`}
              >
                <div
                  className={`mb-[5px] font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] ${
                    c.blockTone === "accent"
                      ? "text-gate-text"
                      : c.blockTone === "gateReady"
                        ? "text-done-text"
                        : "text-ink-tertiary"
                  }`}
                >
                  {c.blockLabel}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={c.blockTone === "accent" ? "text-action" : "text-ink-tertiary"}
                  >
                    →
                  </span>
                  <span
                    className={`text-[12.5px] font-semibold ${
                      c.blockTone === "muted" ? "text-ink-secondary" : "text-ink"
                    }`}
                  >
                    {c.blockText}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

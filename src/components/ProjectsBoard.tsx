"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { PhaseId } from "@/lib/phases/config";

// ─────────────────────────────────────────────────────────────
// Projektek — fázis-pipeline board (ref_projektek.html). 7 oszlop (P0–P6),
// minden projekt az aktív fázisa oszlopában; a rád várók/blokkoltak felül,
// színes felső sávval (rád vár=lila, kapunál áll=borostyán, áll=piros, kapu
// kész=zöld, ütemben=semleges, lezárt=halvány). A teszt/piszkozat projektek
// alapból rejtettek. Nézetváltó: Pipeline ⇄ Lista (a régi kártyarács). Az
// érték szürke placeholder (konzisztens az Ügyfelek-lappal). Élő adat a
// közös portfolio.ts/state.ts származtatásból.
// ─────────────────────────────────────────────────────────────

export type CardVariant = "needsYou" | "gateBlocked" | "stalled" | "ready" | "healthy" | "closed";

export interface BoardCard {
  id: string;
  name: string;
  clientName: string;
  industry: string | null;
  initials: string;
  phase: PhaseId;
  variant: CardVariant;
  nextStep: string;
  lastLabel: string;
  lastDanger: boolean;
}

export interface BoardColumn {
  phase: PhaseId;
  phaseName: string;
  cards: BoardCard[];
}

const PHASES: PhaseId[] = ["P0", "P1", "P2", "P3", "P4", "P5", "P6"];

function topBar(v: CardVariant): string {
  switch (v) {
    case "needsYou":
      return "border-t-action";
    case "gateBlocked":
      return "border-t-gate";
    case "stalled":
      return "border-t-danger";
    case "ready":
      return "border-t-done";
    case "closed":
      return "border-t-neutral-300";
    default:
      return "border-t-neutral-300";
  }
}

function badgeClass(v: CardVariant): string {
  switch (v) {
    case "needsYou":
      return "bg-tint-action text-action-deep";
    case "gateBlocked":
      return "bg-tint-gate text-gate-text";
    case "stalled":
      return "bg-danger/10 text-danger";
    case "ready":
      return "bg-tint-done text-done-text";
    case "closed":
      return "bg-neutral-150 text-ink-secondary";
    default:
      return "bg-neutral-150 text-ink-tertiary";
  }
}

function dotColor(v: CardVariant): string {
  switch (v) {
    case "needsYou":
      return "bg-action";
    case "gateBlocked":
      return "bg-gate";
    case "stalled":
      return "bg-danger";
    case "ready":
    case "closed":
      return "bg-done";
    default:
      return "bg-neutral-350";
  }
}

function rankOf(v: CardVariant): number {
  const order: Record<CardVariant, number> = {
    needsYou: 5,
    gateBlocked: 4,
    stalled: 3,
    ready: 2,
    healthy: 1,
    closed: 0,
  };
  return order[v];
}

export function ProjectsBoard({
  columns,
  hiddenCards,
  hiddenNames,
  statusLine,
  activeCount,
  closedCount,
  listView,
  createForm,
}: {
  columns: BoardColumn[];
  hiddenCards: BoardCard[];
  hiddenNames: string[];
  statusLine: string;
  activeCount: number;
  closedCount: number;
  listView: ReactNode;
  createForm: ReactNode;
}) {
  const t = useTranslations("projects");
  const tc = useTranslations("clients");
  const [view, setView] = useState<"board" | "list">("board");
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const merged = useMemo(() => {
    const byPhase = new Map(columns.map((c) => [c.phase, c.cards.slice()]));
    if (showHidden) {
      for (const h of hiddenCards) {
        (byPhase.get(h.phase) ?? byPhase.set(h.phase, []).get(h.phase)!).push(h);
      }
    }
    const q = query.trim().toLowerCase();
    return PHASES.map((phase) => {
      let cards = byPhase.get(phase) ?? [];
      if (q) {
        cards = cards.filter(
          (c) => c.name.toLowerCase().includes(q) || c.clientName.toLowerCase().includes(q),
        );
      }
      cards = cards.slice().sort((a, b) => rankOf(b.variant) - rankOf(a.variant));
      const name = columns.find((c) => c.phase === phase)?.phaseName ?? phase;
      return { phase, phaseName: name, cards };
    });
  }, [columns, hiddenCards, showHidden, query]);

  return (
    <div className="space-y-4">
      {/* ── Fejléc ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-tertiary">
            {t("boardKicker")}
          </p>
          <h1 className="mt-0.5 text-[22px] font-extrabold tracking-tight">{t("listTitle")}</h1>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          {/* nézetváltó */}
          <div className="flex rounded-control border border-line bg-sunken p-0.5">
            <button
              type="button"
              onClick={() => setView("board")}
              className={`rounded-4 px-3 py-1.5 text-[12px] font-semibold ${
                view === "board" ? "bg-action text-white" : "text-ink-secondary hover:text-ink"
              }`}
            >
              {t("viewBoard")}
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              className={`rounded-4 px-3 py-1.5 text-[12px] font-semibold ${
                view === "list" ? "bg-action text-white" : "text-ink-secondary hover:text-ink"
              }`}
            >
              {t("viewList")}
            </button>
          </div>
          <div className="flex min-w-[190px] items-center gap-2 rounded-control border border-line bg-sunken px-3 py-2 text-ink-tertiary">
            <svg width="14" height="14" viewBox="0 0 20 20" className="shrink-0">
              <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M13 13 L17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-tertiary"
            />
            <span className="shrink-0 rounded-3 border border-line px-1.5 py-px font-mono text-[10px] text-neutral-400">
              ⌘K
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="shrink-0 rounded-control bg-action px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-action-hover"
          >
            {t("newProjectCta")}
          </button>
        </div>
      </div>

      {/* státusz-sor + legenda */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="inline-flex items-center gap-2 text-[13.5px] text-ink">
          <span
            aria-hidden
            className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-4 bg-action text-white"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M2 6 h7 M6.5 3 L9.5 6 L6.5 9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          {statusLine}
        </span>
        <div className="ml-auto flex items-center gap-3.5 font-mono text-[11px] text-ink-tertiary">
          {(
            [
              ["bg-gate", "legendNeedsYou"],
              ["bg-danger", "legendStalled"],
              ["bg-done", "legendReady"],
              ["bg-neutral-350", "legendOnTrack"],
            ] as const
          ).map(([c, k]) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-[2px] ${c}`} />
              {t(k)}
            </span>
          ))}
        </div>
      </div>

      {showCreate && (
        <div className="rounded-shell border border-line bg-surface p-5 shadow-card">{createForm}</div>
      )}

      {view === "list" ? (
        listView
      ) : (
        <>
          {/* ── PIPELINE BOARD ── */}
          <div className="overflow-x-auto rounded-shell border border-line bg-surface shadow-card">
            <div className="min-w-[1120px]">
              {/* oszlop-fejlécek */}
              <div className="grid grid-cols-7 border-b border-neutral-100 bg-soft">
                {merged.map((col) => (
                  <div key={col.phase} className="border-r border-line-soft px-3 py-3 last:border-r-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`font-mono text-[10px] font-bold ${
                          col.cards.length > 0 ? "text-action-deep" : "text-ink-tertiary"
                        }`}
                      >
                        {col.phase}
                      </span>
                      <span
                        className={`ml-auto rounded-pill px-1.5 font-mono text-[10px] font-bold ${
                          col.cards.length > 0
                            ? "bg-tint-action text-action-deep"
                            : "text-neutral-400"
                        }`}
                      >
                        {col.cards.length}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-[12px] font-bold text-ink-secondary">
                      {col.phaseName}
                    </div>
                  </div>
                ))}
              </div>
              {/* oszlop-törzsek */}
              <div className="grid min-h-[320px] grid-cols-7">
                {merged.map((col) => (
                  <div
                    key={col.phase}
                    className="flex flex-col gap-2.5 border-r border-line-soft p-2.5 last:border-r-0"
                  >
                    {col.cards.length === 0 ? (
                      <div className="pt-6 text-center font-mono text-[10px] text-neutral-400">—</div>
                    ) : (
                      col.cards.map((card) => <PipelineCard key={card.id} card={card} />)
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* footer: teszt-projektek + számlálók */}
          <div className="flex flex-wrap items-center gap-3">
            {hiddenNames.length > 0 && (
              <div className="flex flex-1 items-center gap-2.5 rounded-shell border border-dashed border-line bg-sunken px-4 py-3">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  className="shrink-0 text-ink-tertiary"
                >
                  <circle cx="8" cy="8" r="6" />
                  <path d="M8 5v3.5M8 10.5v.1" strokeLinecap="round" />
                </svg>
                <span className="text-[12px] text-ink-secondary">
                  <b>{t("hiddenTests", { n: hiddenNames.length })}</b>{" "}
                  <span className="text-ink-tertiary">({hiddenNames.join(", ")})</span>
                </span>
                <button
                  type="button"
                  onClick={() => setShowHidden((v) => !v)}
                  className="ml-auto shrink-0 text-[11.5px] font-semibold text-action-deep hover:underline"
                >
                  {showHidden ? t("hideTests") : t("showTests")}
                </button>
              </div>
            )}
            <div className="flex items-center gap-4 px-1 font-mono text-[11px] text-ink-tertiary">
              <span>
                <b className="text-[13px] text-ink">{activeCount}</b> {t("footerActive")}
              </span>
              <span>
                <b className="text-[13px] text-done-text">{closedCount}</b> {t("footerClosed")}
              </span>
              <span className="text-neutral-400">
                <b className="text-[13px]">—</b> {tc("comingSoonShort")}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PipelineCard({ card }: { card: BoardCard }) {
  const t = useTranslations("projects");
  const badgeKey: Record<CardVariant, string> = {
    needsYou: "badgeNeedsYou",
    gateBlocked: "badgeGateBlocked",
    stalled: "badgeStalled",
    ready: "badgeReady",
    healthy: "badgeOnTrack",
    closed: "badgeClosed",
  };
  return (
    <Link
      href={`/project/${card.id}`}
      className={`block rounded-5 border border-line border-t-[3px] bg-surface p-3 shadow-card-sm hover:shadow-card ${topBar(
        card.variant,
      )} ${card.variant === "closed" ? "opacity-80" : ""}`}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-4 bg-neutral-150 font-mono text-[9px] font-extrabold text-ink-secondary">
          {card.initials}
        </span>
        <span
          className={`ml-auto rounded-pill px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.04em] ${badgeClass(
            card.variant,
          )}`}
        >
          {t(badgeKey[card.variant])}
        </span>
      </div>
      <div className="mt-2 text-[12.5px] font-bold leading-tight tracking-tight">{card.name}</div>
      <div className="mt-0.5 truncate text-[10.5px] text-ink-tertiary">{card.clientName}</div>
      <div className="mt-2 flex items-start gap-1.5 border-t border-line-soft pt-2">
        <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-pill ${dotColor(card.variant)}`} />
        <span className="text-[10.5px] font-semibold leading-tight text-ink-secondary">
          {card.nextStep}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span
          className={`font-mono text-[9px] ${card.lastDanger ? "text-danger" : "text-ink-tertiary"}`}
        >
          {card.lastLabel}
        </span>
        <span className="font-mono text-[9px] font-semibold text-neutral-400">—</span>
      </div>
    </Link>
  );
}

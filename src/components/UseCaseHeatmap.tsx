"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

// ─────────────────────────────────────────────────────────────
// P1 hőtérkép (#7b, design 1e): 2×2 mátrix inline SVG-vel, új függőség
// nélkül. X = megvalósíthatóság (1–5), Y = érték (1–5).
//
// KÜSZÖB-SZABÁLY (dokumentált): a kvadráns-határ 3,5-nél fut — a „magas"
// oldal a ≥4 pontszám, a 3-as az „alacsony" oldalra esik. Ez konzisztens
// a quick win hüvelykujjszabállyal (érték≥4 ∧ megvalósíthatóság≥4).
//
// Pont = megerősített (confirmed/manual), NEM kizárt use case. A pontok
// számozottak; a számozás a térkép alatti kattintható jegyzékben oldódik
// fel (címke-ütközés helyett — design-döntés, a jelentésben dokumentálva).
// Kockázat: színes gyűrű + mini-ikon jelvény a ponton (sosem csak szín);
// quick win: lila külső gyűrű (döntési kiemelés — a lila itt jogos);
// tiltott/nagy kockázatú AI Act-besorolás: piros figyelmeztetés-jelvény.
// ─────────────────────────────────────────────────────────────

export interface HeatmapPoint {
  id: string;
  title: string;
  /** Érték-pontszám 1–5. */
  value: number;
  /** Megvalósíthatóság-pontszám 1–5. */
  feasibility: number;
  risk: "low" | "medium" | "high" | null;
  quickWin: boolean;
  /** Shortlisten van-e (v2: a KITÖLTÖTT csempe = shortlisted). */
  shortlisted: boolean;
  /** Megerősített AI Act-besorolás tiltott / nagy kockázatú (#7b 4. lépés). */
  aiActWarn: boolean;
}

export interface UnscoredItem {
  id: string;
  title: string;
}

// v2 négyzet-csempés hőtérkép: a pont pozíciója a rajzterület %-ában
// (X = megvalósíthatóság, Y = érték; a magas érték fölül). Padding, hogy a
// szélső pontok se lógjanak ki. Duplikátum-eltolás a chartban (%-ban).
const PAD = 9;
const SPAN = 100 - 2 * PAD;
const posX = (feasibility: number) => PAD + ((feasibility - 1) / 4) * SPAN;
const posY = (value: number) => PAD + (1 - (value - 1) / 4) * SPAN;

const RISK_LETTER: Record<"low" | "medium" | "high", string> = {
  low: "L",
  medium: "M",
  high: "H",
};
const RISK_TAG_CLS: Record<"low" | "medium" | "high", string> = {
  low: "bg-tint-done text-done",
  medium: "bg-tint-gate text-gate",
  high: "bg-danger/15 text-danger",
};

function Heatmap({
  points,
  onSelect,
  interactive = true,
}: {
  points: HeatmapPoint[];
  onSelect: (id: string) => void;
  /** Interaktív pontok (workbench-előnézet): fókuszálható gombok a globális
   *  2px lila fókuszgyűrűvel. A fókusz-módban false → a pontok csak megjelenítő
   *  elemek (role="img"), nem kap billentyűzet-fókuszt egy no-op gomb. */
  interactive?: boolean;
}) {
  const t = useTranslations("entities.heatmap");
  const tEnt = useTranslations("entities");
  const placed = points;
  const dupOffset = new Map<string, number>();

  return (
    <div>
      {/* v2 négyzet-csempés kvadráns-térkép (role="group": a csempék interaktívak) */}
      <div
        role="group"
        aria-label={t("ariaLabel")}
        className="relative aspect-[3/2] w-full overflow-hidden rounded-tile border border-line bg-neutral-50"
      >
        <div aria-hidden className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line" />
        <div aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
        <div aria-hidden className="absolute right-0 top-0 h-1/2 w-1/2 bg-tint-pivot/50" />
        <span className="absolute left-3 top-2.5 font-mono text-[10px] font-bold uppercase tracking-wide text-neutral-450">
          {t("quadrantStrategic")}
        </span>
        <span className="absolute right-3 top-2.5 font-mono text-[10px] font-bold uppercase tracking-wide text-pivot">
          {t("quadrantQuickWin")}
        </span>
        <span className="absolute bottom-2.5 left-3 font-mono text-[10px] font-bold uppercase tracking-wide text-neutral-450">
          {t("quadrantAvoid")}
        </span>
        <span className="absolute bottom-2.5 right-3 font-mono text-[10px] font-bold uppercase tracking-wide text-neutral-450">
          {t("quadrantOpportunistic")}
        </span>
        {placed.map((p, i) => {
          const key = `${p.feasibility}:${p.value}`;
          const nDup = dupOffset.get(key) ?? 0;
          dupOffset.set(key, nDup + 1);
          const shift = nDup === 0 ? 0 : Math.ceil(nDup / 2) * 6 * (nDup % 2 === 1 ? 1 : -1);
          const left = Math.min(95, Math.max(5, posX(p.feasibility) + shift));
          const top = posY(p.value);
          const riskText = p.risk ? tEnt(`level.${p.risk}`) : tEnt("level.none");
          const label = `${i + 1}. ${p.title} — ${tEnt("scoreValueLabel")}: ${p.value}/5 · ${tEnt("scoreFeasibilityLabel")}: ${p.feasibility}/5 · ${tEnt("riskLabel")}: ${riskText}${p.shortlisted ? ` · ${tEnt("listStatus.shortlist")}` : ""}${p.aiActWarn ? ` · ${t("aiActWarn")}` : ""}`;
          const tile = (
            <span
              className={`relative flex h-7 w-7 items-center justify-center rounded-tile font-mono text-[10px] font-bold ${
                p.shortlisted
                  ? "bg-action text-white shadow-tile-sm"
                  : "border-[1.5px] border-neutral-450 bg-surface text-ink-secondary"
              }`}
            >
              {String(i + 1).padStart(2, "0")}
              {p.risk && (
                <span
                  className={`absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-surface px-0.5 font-mono text-[8px] font-bold ${RISK_TAG_CLS[p.risk]}`}
                >
                  {RISK_LETTER[p.risk]}
                </span>
              )}
              {p.aiActWarn && (
                <span
                  aria-hidden
                  className="absolute -left-1.5 -top-1.5 text-[10px] leading-none text-danger"
                >
                  ▲
                </span>
              )}
            </span>
          );
          return (
            <div
              key={p.id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${left}%`, top: `${top}%` }}
            >
              {interactive ? (
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(p.id);
                    }
                  }}
                  title={label}
                  aria-label={label}
                  className="cursor-pointer rounded-tile focus-visible:opacity-80"
                >
                  {tile}
                </button>
              ) : (
                <div role="img" title={label} aria-label={label}>
                  {tile}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex items-center justify-between font-mono text-mono-sm text-ink-tertiary">
        <span>→ {t("axisFeasibility")}</span>
        <span>{t("filledShortlisted")}</span>
      </div>

      {/* Jelmagyarázat: ikon + szöveg (törvény 4) */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-mono-sm text-ink-tertiary">
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden>
            <circle r="4.5" fill="var(--status-done)" />
            <path d="M-2 0.2l1.3 1.4 2.6-3" fill="none" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t("legendRiskLow")}
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden>
            <circle r="4.5" fill="var(--status-gate)" />
            <line x1="-2" y1="0" x2="2" y2="0" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          {t("legendRiskMedium")}
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden>
            <circle r="4.5" fill="var(--status-error)" />
            <line x1="0" y1="-2.2" x2="0" y2="0.6" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="0" cy="2.4" r="0.8" fill="#fff" />
          </svg>
          {t("legendRiskHigh")}
        </span>
        <span className="flex items-center gap-1.5">
          {/* v2: KITÖLTÖTT csempe = shortlisten (a lila gyűrű helyett tömör négyzet) */}
          <span aria-hidden className="inline-block h-3 w-3 rounded-[2px] bg-action" />
          {tEnt("shortlistedShort")}
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="13" height="13" viewBox="-7 -7 14 14" aria-hidden>
            <path d="M0 -5.5L5.5 4.5H-5.5Z" fill="var(--status-error)" />
            <line x1="0" y1="-2" x2="0" y2="1" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="0" cy="3" r="0.7" fill="#fff" />
          </svg>
          {t("aiActWarn")}
        </span>
      </div>

      {/* Számozott jegyzék: a pont-számok feloldása. Interaktív módban
          kattintható (a kártyához görget); fókusz-módban statikus referencia. */}
      {placed.length > 0 && (
        <ol className="mt-2 space-y-1">
          {placed.map((p, i) => {
            const rowInner = (
              <>
                <span className="w-5 shrink-0 font-mono text-mono-sm text-ink-tertiary">
                  {i + 1}.
                </span>
                <span className="min-w-0 truncate">{p.title}</span>
                <span
                  className="ml-auto shrink-0 font-mono text-mono-sm text-ink-tertiary"
                  title={`${tEnt("scoreValueLabel")}: ${p.value}/5 · ${tEnt("scoreFeasibilityLabel")}: ${p.feasibility}/5`}
                >
                  {p.value}/{p.feasibility}
                </span>
              </>
            );
            return (
              <li key={p.id}>
                {interactive ? (
                  <button
                    type="button"
                    onClick={() => onSelect(p.id)}
                    className="flex w-full items-center gap-2 rounded-control px-2 py-1 text-left text-body hover:bg-sunken"
                  >
                    {rowInner}
                  </button>
                ) : (
                  <div className="flex w-full items-center gap-2 rounded-control px-2 py-1 text-left text-body">
                    {rowInner}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {interactive && (
        <p className="mt-1 text-mono-sm text-ink-tertiary">{t("clickHint")}</p>
      )}
    </div>
  );
}

/** Kártya-fókusz a listában: a use case kártyájához görget + kiemel.
 *  A workbench bal-oldali listája és a jobb-oldali hőtérkép ugyanabban a
 *  DOM-ban él, így a pontra kattintás közvetlenül a kártyát emeli ki. */
function focusUseCard(id: string) {
  const el = document.getElementById(`uc-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("ring-2", "ring-active");
  window.setTimeout(() => el.classList.remove("ring-2", "ring-active"), 2400);
}

/**
 * Workbench hőtérkép (Redesign #1, terv „A"): a munka MELLETT mindig
 * látható kompakt előnézet + ⛶ fókusz-mód. Pontra kattintva a bal-oldali
 * use case-kártyához görget. A geometriát a #7b `Heatmap` adja (nincs
 * újraírva) — a fókusz-mód ennek nagyított, prezentációs változata.
 */
export interface ShortlistItem {
  id: string;
  title: string;
  value: number;
  feasibility: number;
}

export function WorkbenchHeatmap({
  points,
  unscored,
  shortlist,
  clientName,
  phaseName,
}: {
  points: HeatmapPoint[];
  unscored: UnscoredItem[];
  shortlist: ShortlistItem[];
  clientName: string;
  phaseName: string;
}) {
  const t = useTranslations("entities.heatmap");
  const [focus, setFocus] = useState(false);

  return (
    <>
      <section className="surface-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-body font-semibold">{t("title")}</h4>
          <button
            type="button"
            onClick={() => setFocus(true)}
            disabled={points.length === 0}
            className="inline-flex items-center gap-1.5 rounded-control border border-action-light bg-accent-tint px-2.5 py-1.5 text-mono-sm font-semibold text-action-deep transition-colors duration-[var(--motion-base)] hover:bg-sunken disabled:opacity-50"
          >
            <span aria-hidden>⛶</span>
            {t("focusMode")}
          </button>
        </div>
        {points.length === 0 ? (
          <p className="mt-3 rounded-tile border border-dashed border-line px-3 py-6 text-center text-body text-ink-tertiary">
            {t("empty")}
          </p>
        ) : (
          <div className="mt-3">
            <Heatmap points={points} onSelect={focusUseCard} />
          </div>
        )}
        {unscored.length > 0 && (
          <div className="mt-3 rounded-tile border border-line bg-surface p-3">
            <h5 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
              {t("unscoredTitle")}
            </h5>
            <ul className="mt-1.5 space-y-1">
              {unscored.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => focusUseCard(u.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-control px-2 py-1 text-left text-body hover:bg-sunken"
                  >
                    <span className="min-w-0 truncate">{u.title}</span>
                    <span className="shrink-0 text-mono-sm text-ink-tertiary">
                      {t("unscoredHint")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {focus && (
        <HeatmapFocus
          points={points}
          shortlist={shortlist}
          clientName={clientName}
          phaseName={phaseName}
          onExit={() => setFocus(false)}
        />
      )}
    </>
  );
}

/** Hőtérkép fókusz-mód (design 1d): teljes képernyős, ügyfél-workshop
 *  nézet. All ⇄ Shortlist szűrő, nagy térkép + shortlist-sáv + „a térkép
 *  olvasása" magyarázó. Read-only (a pontozás a workbench confirm-lépésén
 *  történik — a kaput/jóváhagyást nem érinti). */
function HeatmapFocus({
  points,
  shortlist,
  clientName,
  phaseName,
  onExit,
}: {
  points: HeatmapPoint[];
  shortlist: ShortlistItem[];
  clientName: string;
  phaseName: string;
  onExit: () => void;
}) {
  const t = useTranslations("entities.heatmap");
  const tEnt = useTranslations("entities");
  const [onlyShortlist, setOnlyShortlist] = useState(false);
  const shortlistIds = new Set(shortlist.map((s) => s.id));
  const shown = onlyShortlist ? points.filter((p) => shortlistIds.has(p.id)) : points;
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Modal-akadálymentesség (review-lelet): Escape zár + kezdő-fókusz a
  // zárógombra + fókusz-csapda (Tab nem szökik a háttérbe) + fókusz-
  // visszaállítás a megnyitó elemre záráskor — az aria-modal ígéretét tartja.
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onExit();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const list = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl && !root.contains(activeEl)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prevFocus?.focus?.();
    };
  }, [onExit]);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("focusTitle")}
      className="fixed inset-0 z-50 overflow-auto bg-app/90 p-4 sm:p-8"
    >
      <div
        className="mx-auto max-w-6xl rounded-shell bg-surface p-5 sm:p-6"
        style={{ boxShadow: "var(--shadow-shell)" }}
      >
        {/* Fejléc */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-mono-sm text-ink-tertiary">
              {clientName} · {phaseName}
            </p>
            <h2 className="mt-0.5 text-title">{t("focusTitle")}</h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-tile border border-line bg-sunken p-1">
              <button
                type="button"
                aria-pressed={!onlyShortlist}
                onClick={() => setOnlyShortlist(false)}
                className={`rounded-control px-3 py-1 text-body font-medium ${!onlyShortlist ? "border border-line bg-surface shadow-tile-sm" : "text-ink-secondary hover:bg-neutral-100"}`}
              >
                {t("filterAll", { n: points.length })}
              </button>
              <button
                type="button"
                aria-pressed={onlyShortlist}
                onClick={() => setOnlyShortlist(true)}
                className={`rounded-control px-3 py-1 text-body font-medium ${onlyShortlist ? "border border-line bg-surface shadow-tile-sm" : "text-ink-secondary hover:bg-neutral-100"}`}
              >
                {t("filterShortlist", { n: shortlist.length })}
              </button>
            </div>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onExit}
              className="inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-3 py-1.5 text-body font-medium shadow-tile-sm hover:bg-sunken"
            >
              {t("exitFocus")} <span aria-hidden>✕</span>
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div>
            {shown.length === 0 ? (
              <p className="rounded-tile border border-dashed border-line px-3 py-10 text-center text-body text-ink-tertiary">
                {t("empty")}
              </p>
            ) : (
              // Fókusz-mód: prezentációs (read-only) térkép — a pontok nem
              // fókuszálható no-op gombok (review-lelet).
              <Heatmap points={shown} onSelect={() => {}} interactive={false} />
            )}
          </div>
          <div className="space-y-4">
            <div className="rounded-tile border border-line bg-surface p-4">
              <h3 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
                {t("shortlistTitle", { n: shortlist.length })}
              </h3>
              {shortlist.length === 0 ? (
                <p className="mt-2 text-body text-ink-tertiary">{t("shortlistEmpty")}</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {shortlist.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-2 text-body"
                    >
                      <span className="min-w-0 truncate">{s.title}</span>
                      <span className="shrink-0 font-mono text-mono-sm text-ink-tertiary">
                        {s.value} · {s.feasibility}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card-sunken p-4">
              <h3 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
                {t("readingTitle")}
              </h3>
              <p className="mt-2 text-body text-ink-secondary">{t("readingBody")}</p>
            </div>
            <p className="text-mono-sm text-ink-tertiary">{tEnt("quickWinBadge")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

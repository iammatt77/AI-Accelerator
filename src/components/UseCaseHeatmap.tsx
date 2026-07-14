"use client";

import { useState } from "react";
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
  /** Megerősített AI Act-besorolás tiltott / nagy kockázatú (#7b 4. lépés). */
  aiActWarn: boolean;
}

export interface UnscoredItem {
  id: string;
  title: string;
}

const RISK_COLOR: Record<string, string> = {
  low: "var(--status-done)",
  medium: "var(--status-gate)",
  high: "var(--status-error)",
};

/** Kockázat mini-ikon a pont jelvényén (fehér vonal a színes körben). */
function riskGlyph(risk: "low" | "medium" | "high"): React.ReactNode {
  switch (risk) {
    case "high":
      // felkiáltójel
      return (
        <>
          <line x1="0" y1="-2.2" x2="0" y2="0.8" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="0" cy="2.6" r="0.9" fill="#fff" />
        </>
      );
    case "medium":
      // vízszintes vonás
      return <line x1="-2" y1="0" x2="2" y2="0" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />;
    case "low":
      // pipa
      return (
        <path d="M-2.2 0.2l1.5 1.6 3-3.4" fill="none" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      );
  }
}

// SVG-geometria
const W = 480;
const H = 340;
const M = { left: 40, right: 10, top: 10, bottom: 34 };
const PW = W - M.left - M.right;
const PH = H - M.top - M.bottom;
const sx = (score: number) => M.left + ((score - 1) / 4) * PW;
const sy = (score: number) => M.top + PH - ((score - 1) / 4) * PH;
// Kvadráns-határ: 3,5 (a „magas" küszöb ≥4 — l. fejléc-komment)
const X_SPLIT = sx(3.5);
const Y_SPLIT = sy(3.5);

/** Azonos koordinátájú pontok szétterítése (ütközés-feloldás). A pozíció a
 *  rajzterületre CSATOLT (review-lelet): a szélső pontszámok (1/5)
 *  duplikátumai különben a viewBoxon kívülre tolódnának — láthatatlan
 *  pont a jegyzékben szereplő szám mögött. Sok (6+) azonos koordinátájú
 *  duplikátumnál a szétterítés átfedhet — v1-ben elfogadott (jelentésben
 *  dokumentálva). */
function spreadPoints(points: HeatmapPoint[]): (HeatmapPoint & { x: number; y: number })[] {
  const byCoord = new Map<string, number>();
  const XMIN = M.left + 14;
  const XMAX = M.left + PW - 14;
  return points.map((p) => {
    const key = `${p.feasibility}:${p.value}`;
    const n = byCoord.get(key) ?? 0;
    byCoord.set(key, n + 1);
    // az első pont középen; a továbbiak jobbra-balra váltakozva tolódnak
    const shift = n === 0 ? 0 : (Math.ceil(n / 2) * 22) * (n % 2 === 1 ? 1 : -1);
    const x = Math.min(XMAX, Math.max(XMIN, sx(p.feasibility) + shift));
    return { ...p, x, y: sy(p.value) };
  });
}

function Heatmap({
  points,
  onSelect,
}: {
  points: HeatmapPoint[];
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("entities.heatmap");
  const tEnt = useTranslations("entities");
  const placed = spreadPoints(points);

  return (
    <div>
      {/* role="group": a pontok interaktívak — a role="img" az AT elől
          ellapítaná őket (review-lelet) */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="group"
        aria-label={t("ariaLabel")}
      >
        {/* Kvadráns-hátterek: a Quick win sáv halvány lila tintát kap */}
        <rect x={M.left} y={M.top} width={X_SPLIT - M.left} height={PH} fill="var(--surface-sunken)" opacity="0.5" />
        <rect x={X_SPLIT} y={Y_SPLIT} width={M.left + PW - X_SPLIT} height={M.top + PH - Y_SPLIT} fill="var(--surface-sunken)" opacity="0.5" />
        <rect x={X_SPLIT} y={M.top} width={M.left + PW - X_SPLIT} height={Y_SPLIT - M.top} fill="var(--action-light)" opacity="0.22" />

        {/* Keret + osztóvonalak */}
        <rect x={M.left} y={M.top} width={PW} height={PH} fill="none" stroke="var(--border-subtle)" />
        <line x1={X_SPLIT} y1={M.top} x2={X_SPLIT} y2={M.top + PH} stroke="var(--border-subtle)" strokeDasharray="4 3" />
        <line x1={M.left} y1={Y_SPLIT} x2={M.left + PW} y2={Y_SPLIT} stroke="var(--border-subtle)" strokeDasharray="4 3" />

        {/* Kvadráns-címkék */}
        <text x={M.left + PW - 8} y={M.top + 14} textAnchor="end" fontSize="10" fontFamily="var(--font-mono)" fill="var(--ink-tertiary)">
          {t("quadrantQuickWin")}
        </text>
        <text x={M.left + 8} y={M.top + 14} fontSize="10" fontFamily="var(--font-mono)" fill="var(--ink-tertiary)">
          {t("quadrantStrategic")}
        </text>
        <text x={M.left + PW - 8} y={M.top + PH - 8} textAnchor="end" fontSize="10" fontFamily="var(--font-mono)" fill="var(--ink-tertiary)">
          {t("quadrantOpportunistic")}
        </text>
        <text x={M.left + 8} y={M.top + PH - 8} fontSize="10" fontFamily="var(--font-mono)" fill="var(--ink-tertiary)">
          {t("quadrantAvoid")}
        </text>

        {/* Tengely-skálák (1–5) + tengelycímek */}
        {[1, 2, 3, 4, 5].map((n) => (
          <g key={n}>
            <text x={sx(n)} y={M.top + PH + 14} textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="var(--ink-tertiary)">
              {n}
            </text>
            <text x={M.left - 8} y={sy(n) + 3} textAnchor="end" fontSize="9" fontFamily="var(--font-mono)" fill="var(--ink-tertiary)">
              {n}
            </text>
          </g>
        ))}
        <text x={M.left + PW / 2} y={H - 6} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="var(--ink-secondary)">
          {t("axisFeasibility")} →
        </text>
        <text x={12} y={M.top + PH / 2} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="var(--ink-secondary)" transform={`rotate(-90 12 ${M.top + PH / 2})`}>
          {t("axisValue")} →
        </text>

        {/* Pontok */}
        {placed.map((p, i) => {
          const riskColor = p.risk ? RISK_COLOR[p.risk] : "var(--status-locked)";
          const riskText = p.risk ? tEnt(`level.${p.risk}`) : tEnt("level.none");
          return (
            <g
              key={p.id}
              transform={`translate(${p.x} ${p.y})`}
              onClick={() => onSelect(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(p.id);
                }
              }}
              tabIndex={0}
              className="cursor-pointer focus:outline-none focus-visible:opacity-80"
              role="button"
              aria-label={`${i + 1}. ${p.title}`}
            >
              <title>
                {`${i + 1}. ${p.title} — ${tEnt("scoreValueLabel")}: ${p.value}/5 · ${tEnt("scoreFeasibilityLabel")}: ${p.feasibility}/5 · ${tEnt("riskLabel")}: ${riskText}${p.quickWin ? ` · ${tEnt("quickWinBadge")}` : ""}${p.aiActWarn ? ` · ${t("aiActWarn")}` : ""}`}
              </title>
              {/* Quick win: lila külső gyűrű (döntési kiemelés) */}
              {p.quickWin && (
                <circle r="13.5" fill="none" stroke="var(--action-primary)" strokeWidth="1.8" />
              )}
              <circle r="9" fill="var(--surface-solid)" stroke={riskColor} strokeWidth="2" />
              <text y="3.5" textAnchor="middle" fontSize="9" fontWeight="600" fontFamily="var(--font-mono)" fill="var(--ink-primary)">
                {i + 1}
              </text>
              {/* Kockázat-jelvény: színes mini-kör + ikon (sosem csak szín) */}
              {p.risk && (
                <g transform="translate(7.5 7.5)">
                  <circle r="5" fill={riskColor} stroke="var(--surface-solid)" strokeWidth="1" />
                  {riskGlyph(p.risk)}
                </g>
              )}
              {/* AI Act figyelmeztetés (tiltott / nagy kockázatú besorolás) */}
              {p.aiActWarn && (
                <g transform="translate(-8 -8)">
                  <path d="M0 -5.5L5.5 4.5H-5.5Z" fill="var(--status-error)" stroke="var(--surface-solid)" strokeWidth="1" />
                  <line x1="0" y1="-2.2" x2="0" y2="1" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
                  <circle cx="0" cy="3" r="0.8" fill="#fff" />
                </g>
              )}
            </g>
          );
        })}
      </svg>

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
          <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden>
            <circle r="5.6" fill="none" stroke="var(--action-primary)" strokeWidth="1.6" />
            <circle r="3" fill="var(--surface-solid)" stroke="var(--ink-tertiary)" strokeWidth="1" />
          </svg>
          {tEnt("quickWinBadge")}
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

      {/* Számozott jegyzék: a pont-számok feloldása, kattintható fókusz */}
      {placed.length > 0 && (
        <ol className="mt-2 space-y-1">
          {placed.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onSelect(p.id)}
                className="flex w-full items-center gap-2 rounded-control px-2 py-1 text-left text-body hover:bg-sunken"
              >
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
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-1 text-mono-sm text-ink-tertiary">{t("clickHint")}</p>
    </div>
  );
}

/**
 * Nézet-váltó: lista ⇄ hőtérkép. A lista maga a szerver-oldalon renderelt
 * kártya-sor (children) — a váltó csak megjelenít/elrejt. Pontra kattintva
 * lista-nézetre vált és a kártyához görget (fókusz-kiemeléssel).
 */
export function UseCaseViews({
  points,
  unscored,
  children,
}: {
  points: HeatmapPoint[];
  unscored: UnscoredItem[];
  children: React.ReactNode;
}) {
  const t = useTranslations("entities.heatmap");
  const [view, setView] = useState<"list" | "map">("list");

  const focusCard = (id: string) => {
    setView("list");
    // A lista-nézet renderelése után görgetünk + kiemelünk.
    window.setTimeout(() => {
      const el = document.getElementById(`uc-${id}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-active");
      window.setTimeout(() => el.classList.remove("ring-2", "ring-active"), 2400);
    }, 60);
  };

  const tabClass = (active: boolean) =>
    `rounded-control px-3 py-1.5 text-body font-medium transition-colors duration-[var(--motion-base)] ${
      active
        ? "border border-line bg-surface shadow-tile-sm"
        : "text-ink-secondary hover:bg-sunken"
    }`;

  return (
    <div className="space-y-3">
      {/* Toggle-gombpár aria-pressed-del (a csonka tabs-ARIA helyett) */}
      <div className="flex items-center gap-1 rounded-tile border border-line bg-sunken p-1">
        <button
          type="button"
          aria-pressed={view === "list"}
          onClick={() => setView("list")}
          className={tabClass(view === "list")}
        >
          {t("viewList")}
        </button>
        <button
          type="button"
          aria-pressed={view === "map"}
          onClick={() => setView("map")}
          className={tabClass(view === "map")}
        >
          {t("viewHeatmap")}
        </button>
      </div>

      {view === "list" ? (
        <div className="space-y-2">{children}</div>
      ) : (
        <div className="space-y-3">
          {points.length === 0 ? (
            // Üres állapot (1c minta): halk, keretezett, cselekvésre mutat
            <p className="rounded-tile border border-dashed border-line px-3 py-4 text-center text-body text-ink-tertiary">
              {t("empty")}
            </p>
          ) : (
            <Heatmap points={points} onSelect={focusCard} />
          )}
          {unscored.length > 0 && (
            <div className="rounded-tile border border-line bg-surface p-3">
              <h5 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
                {t("unscoredTitle")}
              </h5>
              <ul className="mt-1.5 space-y-1">
                {unscored.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => focusCard(u.id)}
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
        </div>
      )}
    </div>
  );
}

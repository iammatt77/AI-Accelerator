"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

// ─────────────────────────────────────────────────────────────
// Zone-tabs munkaterület-váz (Redesign #1, terv „A"): a négy zóna
// (Input / Workbench / Output / Gate) fülekké válik, felül a fázis-
// összegző sávval, amely a totálokat és a kaput minden fülről láthatóvá
// teszi. A panelek szerveroldalon renderelt ReactNode-ok; a fül-váltás
// csak megjelenít/elrejt (a bennük élő kliens-állapot — drill-in, fókusz —
// megmarad). A számlálók valós lekérdezésekből jönnek (props).
// ─────────────────────────────────────────────────────────────

export interface ZoneTab {
  key: string;
  label: string;
  /** Fül-jelvény (valós számláló); üres → nincs jelvény. */
  badge?: string;
  /** Kapu-fül: ◇ jel + borostyán hangsúly. */
  gate?: boolean;
}

export function WorkspaceTabs({
  tabs,
  panels,
  defaultTab,
}: {
  tabs: ZoneTab[];
  panels: Record<string, React.ReactNode>;
  defaultTab: string;
}) {
  const [active, setActive] = useState(defaultTab);

  return (
    <div>
      {/* Fül-sor */}
      <div
        role="tablist"
        className="flex flex-wrap items-end gap-1 border-b border-line"
      >
        {tabs.map((tab) => {
          const on = active === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setActive(tab.key)}
              className={`-mb-px flex items-center gap-2 rounded-[var(--radius-tab-top)] border-b-2 px-4 py-2.5 text-body font-medium transition-colors duration-[var(--motion-base)] ${
                on
                  ? "border-b-action text-ink"
                  : "border-b-transparent text-ink-secondary hover:bg-neutral-100 hover:text-ink"
              }`}
            >
              {tab.gate && (
                <span aria-hidden className={on ? "text-gate" : "text-ink-tertiary"}>
                  ◇
                </span>
              )}
              {tab.label}
              {tab.badge && (
                <span
                  className={`rounded-pill px-2 py-0.5 font-mono text-mono-sm ${
                    tab.gate
                      ? "bg-tint-gate text-gate"
                      : on
                        ? "bg-tint-action text-action-deep"
                        : "bg-neutral-150 text-ink-tertiary"
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Panelek — mind renderelve, az inaktív rejtve (kliens-állapot megmarad) */}
      <div className="pt-4">
        {tabs.map((tab) => (
          <div key={tab.key} role="tabpanel" hidden={active !== tab.key}>
            {panels[tab.key]}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Drill-in sor: kompakt összegző + kinyíló részlet ─────────
// A design 1a „egy kattintás → idézet, linkek, confirm/edit/dismiss".
// A kompakt sor egy toggle-gomb; a jobb-oldali inline akciók (ha vannak)
// kívül esnek a toggle-n (nem nyitják/csukják).

export function DrillRow({
  summary,
  actions,
  detail,
  accent,
  defaultOpen,
}: {
  summary: React.ReactNode;
  actions?: React.ReactNode;
  detail: React.ReactNode;
  /** Kinyitva bal-oldali lila él (döntési fókusz). */
  accent?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div
      className={`rounded-tile border border-line bg-surface ${
        open && accent ? "border-l-2 border-l-action" : ""
      }`}
    >
      <div className="flex items-center gap-2 pr-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left hover:bg-neutral-50"
        >
          <span
            aria-hidden
            className={`shrink-0 font-mono text-mono-sm text-ink-tertiary transition-transform duration-[var(--motion-base)] ${
              open ? "rotate-90" : ""
            }`}
          >
            ▸
          </span>
          {summary}
        </button>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {open && <div className="border-t border-line px-4 py-3">{detail}</div>}
    </div>
  );
}

// ── „Show N more" — hosszú listák csonkolása kliens-oldalon ──

export function ShowMore({
  children,
  initial,
  moreKey,
  lessKey,
}: {
  children: React.ReactNode[];
  /** Ennyi elem látszik alapból; a többi „Show N more" mögött. */
  initial: number;
  /** Teljes i18n-kulcs a „még N" felirathoz ({n} placeholderrel). */
  moreKey: string;
  /** Teljes i18n-kulcs a „kevesebb" felirathoz. */
  lessKey: string;
}) {
  // Root-szintű fordító: a kliens interpolálja az {n}-t (a rejtett elemszám
  // csak itt ismert — a server nem adhat át függvényt kliens-komponensnek).
  const t = useTranslations();
  const [expanded, setExpanded] = useState(false);
  const items = children;
  const hidden = Math.max(0, items.length - initial);
  const visible = expanded ? items : items.slice(0, initial);
  return (
    <div className="space-y-2">
      {visible}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full rounded-tile px-3 py-2 text-center text-body font-medium text-ink-secondary hover:bg-neutral-100"
        >
          {expanded ? t(lessKey) : t(moreKey, { n: hidden })}
        </button>
      )}
    </div>
  );
}

// ── Összecsukott státusz-csoport (1f: „Confirmed 18 · collapsed") ──

export function CollapsedGroup({
  label,
  count,
  tone = "neutral",
  children,
}: {
  label: string;
  count: number;
  tone?: "neutral" | "done";
  children: React.ReactNode;
}) {
  const t = useTranslations("workspace");
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-tile border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-neutral-50"
      >
        <span
          className={`text-body font-medium ${tone === "done" ? "text-done" : "text-ink-secondary"}`}
        >
          {label}
        </span>
        <span className="font-mono text-mono-sm text-ink-tertiary">
          {count} · {open ? t("groupExpanded") : t("groupCollapsed")}
        </span>
        <span
          aria-hidden
          className={`ml-auto font-mono text-mono-sm text-ink-tertiary transition-transform duration-[var(--motion-base)] ${
            open ? "rotate-90" : ""
          }`}
        >
          ▸
        </span>
      </button>
      {open && <div className="space-y-2 border-t border-line p-3">{children}</div>}
    </div>
  );
}

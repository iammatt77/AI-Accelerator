"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

// ─────────────────────────────────────────────────────────────
// Zone-flow-strip munkaterület-váz (v2, terv „A" véglegesítve): a négy
// zóna (Input → Workbench → Output → Gate) egy VÍZSZINTES flow-sáv —
// stat-kártyák nyíl-összekötőkkel; a kiválasztott zóna kiemelve („ITT"),
// a Gate-kártya megnevezi a nyílt kritériumot. A kártyák kattinthatók: az
// aktív zóna panelja alul jelenik meg (a fül-mechanizmus megmarad, csak a
// megjelenés lett flow-sáv). A panelek szerveroldalon renderelt ReactNode-ok.
// ─────────────────────────────────────────────────────────────

export interface FlowZone {
  key: string;
  index: number;
  label: string;
  /** Felső akcentus-sáv tónusa a zóna állapotához. */
  tone: "done" | "active" | "muted" | "gate";
  /** Jobb-fenti státusz-chip (pl. „kész" / „Draft"). */
  chip?: string;
  chipTone?: "done" | "muted" | "gate";
  /** Fő metrika (nagy szám): „14" / „7/9" / „2/3". */
  metric?: string;
  metricLabel?: string;
  /** Második metrika (Workbench: fájdalompont + use case). */
  metric2?: { value: string; label: string };
  /** Extra sor (Gate: nyílt kritérium neve). */
  sub?: string;
  subMuted?: string;
  /** Lezárt downstream zóna (üres állapot) — unlock-szöveg. */
  lockText?: string;
}

const TONE_BAR: Record<FlowZone["tone"], string> = {
  done: "bg-done",
  active: "bg-action",
  muted: "bg-neutral-300",
  gate: "bg-gate",
};

export function ZoneFlowStrip({
  zones,
  panels,
  defaultZone,
}: {
  zones: FlowZone[];
  panels: Record<string, React.ReactNode>;
  defaultZone: string;
}) {
  const t = useTranslations("workspace");
  const [active, setActive] = useState(defaultZone);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyNav = (e: React.KeyboardEvent, index: number) => {
    const last = zones.length - 1;
    let next = -1;
    if (e.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (e.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next < 0) return;
    e.preventDefault();
    setActive(zones[next].key);
    btnRefs.current[next]?.focus();
  };

  return (
    <div>
      {/* Flow-sáv: stat-kártyák nyíl-összekötőkkel */}
      <div role="tablist" className="flex flex-wrap items-stretch gap-0">
        {zones.map((z, i) => {
          const on = active === z.key;
          const chipCls =
            z.chipTone === "done"
              ? "text-done"
              : z.chipTone === "gate"
                ? "text-gate"
                : "text-ink-tertiary";
          return (
            <div key={z.key} className="flex flex-1 items-stretch">
              {i > 0 && (
                <span
                  aria-hidden
                  className="flex items-center px-1.5 text-ink-tertiary"
                >
                  ›
                </span>
              )}
              <button
                ref={(el) => {
                  btnRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`ws-tab-${z.key}`}
                aria-selected={on}
                aria-controls={`ws-panel-${z.key}`}
                tabIndex={on ? 0 : -1}
                onClick={() => setActive(z.key)}
                onKeyDown={(e) => onKeyNav(e, i)}
                className={`relative min-w-0 flex-1 overflow-hidden rounded-tile border px-4 py-3 text-left transition-colors duration-[var(--motion-base)] ${
                  on
                    ? "border-[1.5px] border-action bg-accent-tint shadow-accent"
                    : "border-line bg-surface hover:bg-neutral-50"
                }`}
              >
                <span
                  aria-hidden
                  className={`absolute inset-x-0 top-0 h-[3px] ${on ? "bg-action" : TONE_BAR[z.tone]}`}
                />
                <div className="flex items-center gap-2">
                  <span className="font-mono text-mono-sm font-bold uppercase tracking-wide text-ink-tertiary">
                    {z.index} · {z.label}
                  </span>
                  <span className="ml-auto">
                    {on ? (
                      <span className="rounded-3 bg-action px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-white">
                        {t("zoneHere")}
                      </span>
                    ) : (
                      z.chip && (
                        <span className={`font-mono text-mono-sm font-semibold ${chipCls}`}>
                          {z.chip}
                        </span>
                      )
                    )}
                  </span>
                </div>
                {z.lockText ? (
                  <p className="mt-2 text-body text-ink-tertiary">{z.lockText}</p>
                ) : z.metric2 ? (
                  <div className="mt-1.5 flex gap-5">
                    <div>
                      <div className="font-mono text-metric text-ink">{z.metric}</div>
                      <div className="text-mono-sm text-ink-tertiary">{z.metricLabel}</div>
                    </div>
                    <div>
                      <div className="font-mono text-metric text-ink">{z.metric2.value}</div>
                      <div className="text-mono-sm text-ink-tertiary">{z.metric2.label}</div>
                    </div>
                  </div>
                ) : (
                  <>
                    {z.metric && (
                      <div className="mt-1.5 font-mono text-metric text-ink">{z.metric}</div>
                    )}
                    {z.metricLabel && (
                      <div className="text-mono-sm text-ink-tertiary">{z.metricLabel}</div>
                    )}
                  </>
                )}
                {z.sub && (
                  <div className="mt-1.5 text-body font-semibold text-gate">{z.sub}</div>
                )}
                {z.subMuted && (
                  <div className="mt-0.5 text-mono-sm text-ink-tertiary">{z.subMuted}</div>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Panelek — mind renderelve, az inaktív rejtve (kliens-állapot megmarad) */}
      <div className="pt-5">
        {zones.map((z) => (
          <div
            key={z.key}
            id={`ws-panel-${z.key}`}
            role="tabpanel"
            aria-labelledby={`ws-tab-${z.key}`}
            tabIndex={0}
            hidden={active !== z.key}
          >
            {panels[z.key]}
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

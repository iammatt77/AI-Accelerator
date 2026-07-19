"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type AttentionLevel, barClass, needsAttention } from "@/lib/clients/portfolio";

// ─────────────────────────────────────────────────────────────
// Ügyfelek — döntési felület (ref_ugyfelek.html). Figyelem szerint rendezett
// tábla: a blokkolt/áll ügyfelek felül, a bal szín-sáv (borostyán=kapu,
// piros=áll) az ÉLŐ kapu/stagnálás-állapotból. A CRM-mezők (kapcsolat-státusz,
// érték, pénzügyi KPI) SZÜRKE placeholderek — látszik, hova jönnek, de nem
// fabrikálnak számot. A rendezés + élő cellák a szerverből jönnek; itt a
// kereső + „figyelmet igényel" szűrő fut kliens-oldalon.
// ─────────────────────────────────────────────────────────────

export interface ClientVM {
  id: string;
  name: string;
  industry: string | null;
  initials: string;
  attention: AttentionLevel;
  projectName: string | null;
  phase: string | null;
  phaseTone: "action" | "done" | "muted";
  todo: string | null;
  todoTone: "gate" | "action" | "danger" | "done" | "muted";
  lastLabel: string | null;
  agoLabel: string | null;
  agoDanger: boolean;
  dimmed: boolean;
  href: string;
}

export interface PortfolioKpis {
  clients: number;
  activeProjects: number;
  attention: number;
  blocked: number;
  stalled: number;
}

function phaseChip(tone: ClientVM["phaseTone"]): string {
  if (tone === "action") return "bg-tint-action text-action-deep";
  if (tone === "done") return "bg-tint-done text-done-text";
  return "bg-neutral-150 text-ink-tertiary";
}

function todoColor(tone: ClientVM["todoTone"]): string {
  if (tone === "gate") return "text-gate-text";
  if (tone === "action") return "text-action-deep";
  if (tone === "danger") return "text-danger";
  if (tone === "done") return "text-done-text";
  return "text-ink-tertiary";
}

function TodoIcon({ tone }: { tone: ClientVM["todoTone"] }) {
  const c = { width: 12, height: 12, viewBox: "0 0 12 12", className: `shrink-0 ${todoColor(tone)}` } as const;
  if (tone === "danger")
    return (
      <svg {...c} fill="none" stroke="currentColor" strokeWidth="1.2">
        <circle cx="6" cy="6" r="4.6" />
        <path d="M6 3.6v2.6l1.6 1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (tone === "done")
    return (
      <svg {...c} fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M2.5 6.5 L5 9 L9.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (tone === "gate")
    return (
      <svg {...c} fill="none" stroke="currentColor" strokeWidth="1.2">
        <rect x="2.5" y="5" width="7" height="5" rx="1" />
        <path d="M4 5V4a2 2 0 0 1 4 0v1" />
      </svg>
    );
  // action / muted → arrow
  return (
    <svg {...c} fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 6 h7 M6.5 3 L9.5 6 L6.5 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Szürke, még be nem kötött érték — „—" + halk „hamarosan". Nem fabrikál. */
function Placeholder({ hint }: { hint: string }) {
  return (
    <span className="inline-flex flex-col items-end">
      <span className="font-mono text-[13px] font-semibold text-neutral-400">—</span>
      <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-neutral-400">{hint}</span>
    </span>
  );
}

const GRID = "grid grid-cols-[minmax(0,2.1fr)_120px_minmax(0,2fr)_120px_112px] gap-4";

export function ClientsPortfolio({
  rows,
  kpis,
  statusLine,
  updatedLabel,
}: {
  rows: ClientVM[];
  kpis: PortfolioKpis;
  statusLine: string;
  updatedLabel: string;
}) {
  const t = useTranslations("clients");
  const [query, setQuery] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (attentionOnly && !needsAttention(r.attention)) return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || (r.industry ?? "").toLowerCase().includes(q);
    });
  }, [rows, query, attentionOnly]);

  return (
    <div className="space-y-5">
      {/* ── Fejléc + kereső + akciók ── */}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-tertiary">
              {t("portfolioKicker")}
            </p>
            <h1 className="mt-0.5 text-[22px] font-extrabold tracking-tight">{t("listTitle")}</h1>
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            <div className="flex min-w-[240px] items-center gap-2 rounded-control border border-line bg-sunken px-3 py-2 text-ink-tertiary">
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
            <Link
              href="/projects"
              className="shrink-0 rounded-control bg-action px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-action-hover"
            >
              {t("newClientCta")}
            </Link>
          </div>
        </div>

        {/* státusz-sor (ÉLŐ, származtatott) */}
        <div className="mt-4 flex items-center gap-3.5 rounded-shell border border-line border-l-[3px] border-l-action bg-accent-tint px-4 py-3">
          <span
            aria-hidden
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-4 bg-action text-white"
          >
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M2 6 h7 M6.5 3 L9.5 6 L6.5 9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <p className="min-w-0 flex-1 text-[14px] leading-snug text-ink">{statusLine}</p>
          <span className="shrink-0 font-mono text-[11px] text-ink-tertiary">{updatedLabel}</span>
        </div>
      </div>

      {/* ── Pipeline-KPI sáv ── */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <KpiCard value={String(kpis.clients)} label={t("kpiClients")} sub={t("kpiActiveProjects", { n: kpis.activeProjects })} tone="pivot" />
        <KpiCard
          value={String(kpis.attention)}
          label={t("kpiAttention")}
          sub={t("kpiAttentionBreak", { blocked: kpis.blocked, stalled: kpis.stalled })}
          tone="gate"
        />
        <KpiCard placeholder label={t("kpiContractedValue")} sub={t("comingSoon")} />
        <KpiCard placeholder label={t("kpiPipeline")} sub={t("comingSoon")} />
      </div>

      {/* ── Szűrő-sáv ── */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setAttentionOnly(false)}
          className={`rounded-control px-3 py-1.5 text-[12.5px] font-semibold ${
            !attentionOnly ? "bg-action text-white" : "border border-line bg-surface text-ink-secondary hover:bg-soft"
          }`}
        >
          {t("filterAll", { n: rows.length })}
        </button>
        <button
          type="button"
          onClick={() => setAttentionOnly(true)}
          className={`rounded-control px-3 py-1.5 text-[12.5px] font-semibold ${
            attentionOnly
              ? "bg-gate text-white"
              : "border border-tint-gate-border bg-tint-gate text-gate-text hover:bg-tint-gate-band"
          }`}
        >
          {t("filterAttention", { n: kpis.attention })}
        </button>
        {/* CRM-alapú szűrők — SZÜRKE placeholder (nincs kapcsolat-státusz adat) */}
        {(["filterContracted", "filterProposal", "filterClosed"] as const).map((k) => (
          <span
            key={k}
            title={t("comingSoon")}
            className="cursor-not-allowed rounded-control border border-dashed border-line bg-sunken px-3 py-1.5 text-[12.5px] font-medium text-neutral-400"
          >
            {t(k)}
          </span>
        ))}
        <div className="flex-1" />
        <span className="inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-3 py-1.5 text-[12px] text-ink-secondary">
          {t("sortByAttention")}
        </span>
      </div>

      {/* ── Ügyfél-tábla ── */}
      <div className="overflow-x-auto rounded-shell border border-line bg-surface shadow-card">
        <div className="min-w-[880px]">
          <div className={`${GRID} border-b border-neutral-100 bg-soft px-5 py-2.5`}>
            {(["colClient", "colContact", "colProjectTodo", "colValue", "colLast"] as const).map((k, i) => (
              <span
                key={k}
                className={`font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink-tertiary ${i >= 3 ? "text-right" : ""}`}
              >
                {t(k)}
              </span>
            ))}
          </div>

          {filtered.length === 0 ? (
            <p className="px-5 py-8 text-center text-body text-ink-tertiary">{t("noMatch")}</p>
          ) : (
            filtered.map((r) => (
              <Link
                key={r.id}
                href={r.href}
                className={`${GRID} items-center border-b border-line-soft border-l-[3px] px-5 py-3.5 ${barClass(r.attention)} ${
                  r.attention === "blocked"
                    ? "bg-tint-gate/40"
                    : r.attention === "stalled"
                      ? "bg-danger/[0.04]"
                      : "hover:bg-soft"
                } ${r.dimmed ? "opacity-80" : ""}`}
              >
                {/* ÜGYFÉL */}
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-5 font-mono text-[13px] font-extrabold ${
                      needsAttention(r.attention)
                        ? "bg-gradient-to-br from-[#1F5AE8] to-[#163E9E] text-white"
                        : "bg-neutral-150 text-ink-secondary"
                    }`}
                  >
                    {r.initials}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[14.5px] font-bold tracking-tight">{r.name}</div>
                    <div className="truncate text-[11.5px] text-ink-tertiary">{r.industry ?? "—"}</div>
                  </div>
                </div>

                {/* KAPCSOLAT — placeholder (nincs CRM-státusz) */}
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-pill border border-dashed border-line bg-sunken px-2.5 py-1 text-[10.5px] font-medium text-neutral-400">
                    {t("contactPlaceholder")}
                  </span>
                </div>

                {/* AKTÍV PROJEKT · TEENDŐ */}
                <div className="min-w-0">
                  {r.projectName ? (
                    <>
                      <div className="flex items-center gap-2">
                        <span className={`truncate text-[13px] font-bold ${r.dimmed ? "text-ink-secondary" : ""}`}>
                          {r.projectName}
                        </span>
                        {r.phase && (
                          <span
                            className={`shrink-0 rounded-3 px-1.5 py-px font-mono text-[10px] font-bold ${phaseChip(r.phaseTone)}`}
                          >
                            {r.phase}
                          </span>
                        )}
                      </div>
                      {r.todo && (
                        <div className={`mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold ${todoColor(r.todoTone)}`}>
                          <TodoIcon tone={r.todoTone} />
                          <span className="min-w-0 truncate">{r.todo}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="text-[12.5px] text-ink-tertiary">{t("noProjectRow")}</span>
                  )}
                </div>

                {/* ÉRTÉK / ÉV — placeholder */}
                <div className="text-right">
                  <Placeholder hint={t("comingSoonShort")} />
                </div>

                {/* UTOLSÓ */}
                <div className="text-right">
                  {r.lastLabel ? (
                    <>
                      <div className={`font-mono text-[12px] font-semibold ${r.agoDanger ? "text-danger" : "text-ink"}`}>
                        {r.lastLabel}
                      </div>
                      {r.agoLabel && (
                        <div className={`text-[10.5px] ${r.agoDanger ? "text-danger" : "text-ink-tertiary"}`}>
                          {r.agoLabel}
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="font-mono text-[12px] text-neutral-400">—</span>
                  )}
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  value,
  label,
  sub,
  tone,
  placeholder,
}: {
  value?: string;
  label: string;
  sub: string;
  tone?: "pivot" | "gate";
  placeholder?: boolean;
}) {
  const valueCls = tone === "gate" ? "text-gate-text" : "text-pivot";
  return (
    <div
      className={`rounded-shell border p-4 shadow-card-sm ${
        placeholder
          ? "border-dashed border-line bg-sunken"
          : tone === "gate"
            ? "border-tint-gate-border bg-tint-gate"
            : "border-line bg-surface"
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span
          className={`font-mono text-[28px] font-bold leading-none tracking-tight ${
            placeholder ? "text-neutral-400" : valueCls
          }`}
        >
          {placeholder ? "—" : value}
        </span>
        <span className={`text-[12px] font-semibold ${placeholder ? "text-neutral-400" : "text-ink-tertiary"}`}>
          {label}
        </span>
      </div>
      <div className={`mt-1.5 text-[11.5px] ${placeholder ? "text-neutral-400" : "text-ink-secondary"}`}>{sub}</div>
    </div>
  );
}

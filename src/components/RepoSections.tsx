"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { IconCheck, IconLock } from "@/components/icons";

// Document Repository (Master 4/1a) — kliens-oldal: szűrő-chipek +
// fázis-szekciók, amelyek EGY SOROS fázis-összefoglalóra csukódnak
// (státusz dot-strip = készültségi ujjlenyomat, P7); az aktív fázis
// alapból kinyitva, a kaput blokkoló dokumentum verziótörténettel.
// Minden akció meglévő (megnyitás / export / munkafelület-link).

export type RowStatus = "approved" | "in_review" | "draft" | "planned";

export interface RepoVersionRow {
  id: string;
  version: number;
  dateLabel: string;
  statusLabel: string;
  current: boolean;
}

export interface RepoRow {
  key: string;
  name: string;
  status: RowStatus;
  statusLabel: string;
  metaLabel: string;
  filled: number;
  required: number;
  missingNames: string[];
  blocksGate: boolean;
  optionalForGate: boolean;
  headId: string | null;
  versions: RepoVersionRow[];
}

export interface RepoPhaseSection {
  phase: string;
  name: string;
  state: "closed" | "active" | "open" | "locked";
  approved: number;
  total: number;
  dots: RowStatus[];
  rows: RepoRow[];
}

const DOT_CLS: Record<RowStatus, string> = {
  approved: "bg-done",
  in_review: "bg-gate",
  draft: "bg-neutral-400",
  planned: "border border-dashed border-neutral-400 bg-transparent",
};

type Filter = "all" | "attention" | "in_review" | "approved";

export function RepoSections({
  projectId,
  sections,
  counts,
}: {
  projectId: string;
  sections: RepoPhaseSection[];
  counts: { all: number; attention: number; inReview: number; approved: number };
}) {
  const t = useTranslations("hub");
  const [filter, setFilter] = useState<Filter>("all");
  const [openPhases, setOpenPhases] = useState<Set<string>>(
    () => new Set(sections.filter((s) => s.state === "active").map((s) => s.phase)),
  );

  const rowMatches = (r: RepoRow) => {
    if (filter === "all") return true;
    if (filter === "attention") return r.blocksGate || r.missingNames.length > 0;
    if (filter === "in_review") return r.status === "in_review";
    return r.status === "approved";
  };

  const togglePhase = (phase: string) =>
    setOpenPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase);
      else next.add(phase);
      return next;
    });

  const chip = (key: Filter, label: string, tone: "accent" | "gate" | "plain") => {
    const active = filter === key;
    return (
      <button
        type="button"
        onClick={() => setFilter(key)}
        aria-pressed={active}
        className={`rounded-pill px-3 py-1 text-[11.5px] font-semibold transition-colors duration-[var(--motion-fast)] ${
          active
            ? "bg-accent-fill text-action-deep"
            : tone === "gate"
              ? "border border-tint-gate-border bg-tint-gate-band text-gate-text"
              : "border border-line bg-surface text-ink-secondary hover:bg-neutral-50"
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="space-y-0">
      {/* Szűrő-chipek */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft bg-soft px-1 py-3">
        {chip("all", t("filterAll", { n: counts.all }), "accent")}
        {chip("attention", t("filterAttention", { n: counts.attention }), "gate")}
        {chip("in_review", t("filterInReview", { n: counts.inReview }), "plain")}
        {chip("approved", t("filterApproved", { n: counts.approved }), "plain")}
        <span className="ml-auto hidden font-mono text-[11px] text-ink-tertiary sm:inline">
          {t("groupedHint")}
        </span>
      </div>

      {/* Fázis-szekciók */}
      <div className="flex flex-col gap-2.5 pt-4">
        {sections.map((s) => {
          const open = openPhases.has(s.phase);
          const visibleRows = s.rows.filter(rowMatches);
          if (filter !== "all" && visibleRows.length === 0 && s.state !== "active") return null;

          if (s.state === "locked") {
            return (
              <div
                key={s.phase}
                className="flex items-center gap-3 rounded-tile border border-neutral-200 bg-neutral-100 px-4 py-3 text-ink-tertiary"
              >
                <span aria-hidden>›</span>
                <span className="font-mono text-[11px]">{s.phase}</span>
                <span className="text-[13px] font-semibold">{s.name}</span>
                <span className="inline-flex items-center gap-1 text-[11.5px]">
                  <IconLock size={10} />
                  {t("lockedUntil")}
                </span>
                <span className="ml-auto font-mono text-[11px]">
                  {t("deliverableCount", { n: s.total })}
                </span>
              </div>
            );
          }

          return (
            <div
              key={s.phase}
              className={`overflow-hidden rounded-tile bg-surface ${
                s.state === "active"
                  ? "border-[1.5px] border-action-light shadow-accent"
                  : "border border-line shadow-card-sm"
              }`}
            >
              {/* Fázis-fejléc sor (dot-strip ujjlenyomattal) */}
              <button
                type="button"
                onClick={() => togglePhase(s.phase)}
                aria-expanded={open}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left ${
                  s.state === "active" ? "border-b border-neutral-100 bg-context" : ""
                }`}
              >
                <span
                  aria-hidden
                  className={`transition-transform duration-[var(--motion-fast)] ${open ? "rotate-90" : ""} ${
                    s.state === "active" ? "text-action" : "text-ink-tertiary"
                  }`}
                >
                  ›
                </span>
                <span
                  className={`font-mono text-[11px] ${s.state === "active" ? "font-semibold text-action-deep" : "text-ink-tertiary"}`}
                >
                  {s.phase}
                </span>
                <span className="text-[13px] font-bold">{s.name}</span>
                {s.state === "active" && (
                  <span className="rounded-3 bg-action px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-white">
                    {t("activeBadge")}
                  </span>
                )}
                {s.state === "closed" && (
                  <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-done-text">
                    <IconCheck size={10} />
                    {t("closedBadge")}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-3">
                  <span className="flex gap-[3px]" aria-hidden>
                    {s.dots.map((d, i) => (
                      <span key={i} className={`h-2.5 w-2.5 rounded-[2px] ${DOT_CLS[d]}`} />
                    ))}
                  </span>
                  <span className="font-mono text-[11px] text-ink-secondary">
                    {t("approvedCount", { done: s.approved, total: s.total })}
                  </span>
                </span>
              </button>

              {/* Sorok */}
              {open &&
                visibleRows.map((r) => (
                  <div key={r.key} className="border-t border-line-row">
                    <div
                      className={`flex flex-wrap items-center gap-3 px-4 py-3 ${
                        r.blocksGate ? "bg-[var(--tint-gate-band)]" : ""
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-control ${
                          r.status === "planned"
                            ? "border-[1.5px] border-dashed border-neutral-400 text-neutral-450"
                            : "border border-line bg-sunken text-ink-secondary"
                        }`}
                      >
                        {r.status === "planned" ? "+" : "≡"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span
                            className={`text-[13px] font-semibold ${r.status === "planned" ? "text-ink-secondary" : ""}`}
                          >
                            {r.name}
                          </span>
                          {r.blocksGate && (
                            <span className="rounded-3 bg-tint-gate px-1.5 py-px font-mono text-[9.5px] font-bold text-gate-text">
                              {t("blocksGateTag")}
                            </span>
                          )}
                        </span>
                        <span className="block font-mono text-[11px] text-ink-tertiary">
                          {r.metaLabel}
                        </span>
                        {r.missingNames.length > 0 && (
                          <span className="block text-[11.5px] font-semibold text-gate-text">
                            {t("missingFields", { fields: r.missingNames.join(" · ") })}
                          </span>
                        )}
                      </span>
                      {r.status !== "planned" && r.required > 0 && (
                        <span className="hidden w-[110px] sm:block">
                          <span className="flex h-[5px] overflow-hidden rounded-[3px] bg-neutral-100">
                            <span
                              className={r.status === "approved" ? "bg-done" : "bg-gate"}
                              style={{
                                width: `${Math.round((r.filled / Math.max(1, r.required)) * 100)}%`,
                              }}
                            />
                          </span>
                        </span>
                      )}
                      {r.status !== "planned" && (
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-[3px] text-[11px] font-semibold ${
                            r.status === "approved"
                              ? "bg-tint-done text-done-text"
                              : r.status === "in_review"
                                ? "bg-tint-gate text-gate-text"
                                : "bg-neutral-150 text-ink-secondary"
                          }`}
                        >
                          {r.statusLabel}
                        </span>
                      )}
                      {r.headId ? (
                        <Link
                          href={`/project/${projectId}/artifact/${r.headId}`}
                          className={`rounded-control px-3 py-1.5 text-[11.5px] font-semibold ${
                            r.blocksGate
                              ? "bg-action text-white shadow-action hover:bg-action-hover"
                              : "border border-neutral-350 bg-surface text-ink hover:bg-neutral-50"
                          }`}
                        >
                          {r.blocksGate ? t("reviewCta") : t("openCta")}
                        </Link>
                      ) : (
                        <Link
                          href={`/project/${projectId}/phase/${s.phase}`}
                          className="rounded-control border border-action-light bg-surface px-3 py-1.5 text-[11.5px] font-semibold text-action-deep hover:bg-accent-tint"
                        >
                          {t("generateCta")}
                        </Link>
                      )}
                    </div>

                    {/* A kaput blokkoló dokumentum: dátumozott verziótörténet helyben */}
                    {r.blocksGate && r.versions.length > 0 && (
                      <div className="flex flex-col gap-1.5 border-t border-line-row bg-soft py-2 pl-14 pr-4">
                        {r.versions.map((v) => (
                          <div
                            key={v.id}
                            className={`flex items-center gap-2.5 text-[11.5px] ${
                              v.current ? "text-ink-secondary" : "text-ink-tertiary"
                            }`}
                          >
                            <span
                              className={`font-mono text-[10.5px] font-semibold ${v.current ? "text-action-deep" : ""}`}
                            >
                              v{v.version}
                            </span>
                            <span>{v.statusLabel}</span>
                            <span className="ml-auto font-mono text-[10px]">{v.dateLabel}</span>
                            <Link
                              href={`/project/${projectId}/artifact/${v.id}`}
                              className="text-[11px] font-semibold text-action-deep hover:underline"
                            >
                              {t("openCta")}
                            </Link>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              {open && visibleRows.length === 0 && (
                <p className="border-t border-line-row px-4 py-3 text-[12px] text-ink-tertiary">
                  {t("noRowsForFilter")}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

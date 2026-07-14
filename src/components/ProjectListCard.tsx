import Link from "next/link";
import type { ProjectListStatus } from "@/lib/projects/list-card";

// ─────────────────────────────────────────────────────────────
// Projekt-kártya a Projektek listához + Ügyfél-laphoz — a Portfolio
// Dashboard projekt-kártyájának (DashboardBoard.tsx) vizuális nyelvét
// követi: fehér tömör felület, avatar, státusz-pill (NEEDS YOU/GATE/
// STALLED), 7-szegmensű mini-spine. Itt a Dashboard „P1 · 1. hét"
// heti-jelölése helyett „X/7 lezárva" fázis-progresszust mutat (a
// csomag-specifikáció szerint) — kompakt lista-áttekintéshez, blokkoló-
// lépés doboz nélkül. Server-oldali, előre formázott feliratokkal (nincs
// kliens-állapot, nincs szűrő).
// ─────────────────────────────────────────────────────────────

const SEGMENT_TONE: Record<"done" | "active" | "gate" | "idle", string> = {
  done: "bg-done",
  active: "bg-action",
  gate: "bg-gate",
  idle: "bg-neutral-150",
};

export interface ProjectListCardProps {
  href: string;
  name: string;
  clientName: string;
  industry: string;
  initials: string;
  status: ProjectListStatus;
  statusLabel: string | null;
  progressLabel: string;
  activePhaseLabel: string | null;
  spine: { phase: string; tone: "done" | "active" | "gate" | "idle" }[];
}

export function ProjectListCard({
  href,
  name,
  clientName,
  industry,
  initials,
  status,
  statusLabel,
  progressLabel,
  activePhaseLabel,
  spine,
}: ProjectListCardProps) {
  return (
    <Link
      href={href}
      className={`flex flex-col gap-[13px] rounded-shell bg-surface p-[18px] transition-shadow duration-[var(--motion-base)] ${
        status === "needs_you"
          ? "border-[1.5px] border-action shadow-accent"
          : status === "stalled"
            ? "border border-tint-error-border shadow-card"
            : "border border-line shadow-card"
      } hover:shadow-shell`}
    >
      <div className="flex items-start gap-2.5">
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-control border border-line bg-sunken font-mono text-[12px] font-bold text-ink-secondary">
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-bold tracking-tight">{name}</span>
          <span className="block truncate text-[11.5px] text-ink-tertiary">
            {clientName}
            {industry ? ` · ${industry}` : ""}
          </span>
        </span>
        {statusLabel &&
          (status === "needs_you" ? (
            <span className="shrink-0 rounded-pill bg-action px-2 py-0.5 text-[10.5px] font-bold text-white">
              {statusLabel}
            </span>
          ) : status === "gate" ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-tint-gate px-2 py-0.5 text-[10.5px] font-bold text-gate-text">
              <span aria-hidden>◇</span>
              {statusLabel}
            </span>
          ) : status === "stalled" ? (
            <span className="shrink-0 rounded-pill bg-tint-error px-2 py-0.5 text-[10.5px] font-bold text-danger">
              {statusLabel}
            </span>
          ) : null)}
      </div>

      <div className="flex gap-0.5">
        {spine.map((s) => (
          <span
            key={s.phase}
            title={s.phase}
            className={`h-1.5 flex-1 rounded-[2px] ${SEGMENT_TONE[s.tone]}`}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 text-[11.5px] text-ink-secondary">
        <span className="font-mono font-semibold text-ink">{progressLabel}</span>
        {activePhaseLabel && (
          <>
            <span className="text-neutral-400">·</span>
            <span>{activePhaseLabel}</span>
          </>
        )}
      </div>
    </Link>
  );
}

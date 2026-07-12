import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { previousPhase, type PhaseId } from "@/lib/phases/config";
import type { PhaseState } from "@/lib/phases/machine";
import { PhaseStateIcon, PHASE_STATE_TEXT } from "@/components/icons";

// ─────────────────────────────────────────────────────────────
// Fázis-stepper — v0.4 design 1b.
//  V1: üveg-csempe gerinc (pilótafülke hős-elem)
//  V2: kompakt szegmens-sáv (fázis-oldalak teteje, dashboard-mini)
// Az 5 állapot vizuális lexikona: locked = halk pala + lakat ·
// open = semleges csempe · in_progress = lila + „Folyamatban" ·
// gate_pending = borostyán + „Döntés vár" · completed = zöld pipa +
// „Lezárva". MINDIG ikon + szöveg (törvény 4).
// ─────────────────────────────────────────────────────────────

export interface StepperEntry {
  phase: PhaseId;
  state: PhaseState;
}

/** A csempe/szegmens link-célja: zárt fázis az ELŐZŐ fázisra visz (spec). */
function targetHref(projectId: string, entry: StepperEntry): string {
  if (entry.state === "locked") {
    const prev = previousPhase(entry.phase);
    if (prev) return `/project/${projectId}/phase/${prev}`;
  }
  return `/project/${projectId}/phase/${entry.phase}`;
}

// Felső 3px állapot-csík színe (csak a „haladó" állapotokon — a design 1b
// szerint locked/open csempén nincs csík).
const TOP_STRIP: Partial<Record<PhaseState, string>> = {
  in_progress: "bg-active",
  gate_pending: "bg-gate",
  completed: "bg-done",
};

export async function PhaseStepperV1({
  projectId,
  board,
}: {
  projectId: string;
  board: StepperEntry[];
}) {
  const [tPhases, tLex] = await Promise.all([
    getTranslations("phases"),
    getTranslations("phases.lexicon"),
  ]);

  return (
    <ol aria-label={tPhases("stepperAria")} className="flex gap-2">
      {board.map((entry) => {
        const { phase, state } = entry;
        const locked = state === "locked";
        const prev = previousPhase(phase);
        const title = locked
          ? tPhases("lockedTooltip", { prev: prev ?? "" })
          : tPhases("goToPhase", { phase });
        const shortName = tPhases(`${phase.toLowerCase()}.short`);

        const tileBase =
          "relative block min-w-0 flex-1 overflow-hidden rounded-tile p-3 transition-shadow duration-[var(--motion-base)]";
        const tileByState = locked
          ? "border border-line bg-sunken"
          : state === "gate_pending"
            ? "glass-tile glass-tile-interactive border-gate/40"
            : "glass-tile glass-tile-interactive";

        return (
          <li key={phase} className="min-w-0 flex-1">
            <Link href={targetHref(projectId, entry)} title={title} className={`${tileBase} ${tileByState}`}>
              {TOP_STRIP[state] && (
                <span
                  aria-hidden
                  className={`absolute inset-x-0 top-0 h-[3px] ${TOP_STRIP[state]}`}
                />
              )}
              <span className="flex items-center gap-1.5">
                <span
                  className={`font-mono text-mono-sm ${
                    state === "in_progress" ? "font-semibold text-active" : "text-ink-tertiary"
                  }`}
                >
                  {phase}
                </span>
                {state === "in_progress" && (
                  <span className="rounded-control bg-active px-1.5 py-px font-mono text-[9px] font-bold tracking-widest text-white">
                    {tPhases("activeBadge")}
                  </span>
                )}
              </span>
              <span
                className={`mt-0.5 block truncate text-body font-semibold ${
                  locked ? "text-ink-tertiary" : ""
                }`}
              >
                {shortName}
              </span>
              {/* Törvény 4: ikon + szöveg */}
              <span
                className={`mt-1.5 flex items-center gap-1.5 text-mono-sm font-sans font-medium ${PHASE_STATE_TEXT[state]}`}
              >
                <PhaseStateIcon state={state} size={11} />
                {tLex(state)}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

export async function PhaseStepperV2({
  projectId,
  board,
  current,
  size = "sm",
  interactive = true,
}: {
  projectId: string;
  board: StepperEntry[];
  /** A fázis-oldal saját fázisa — kiemelt szegmens. */
  current?: PhaseId;
  size?: "sm" | "xs";
  /** false: csak megjelenítés (pl. kártya-Linken BELÜL — nincs beágyazott anchor). */
  interactive?: boolean;
}) {
  const [tPhases, tLex] = await Promise.all([
    getTranslations("phases"),
    getTranslations("phases.lexicon"),
  ]);
  const pad = size === "xs" ? "px-1.5 py-0.5" : "px-2 py-1";

  return (
    <ol
      aria-label={tPhases("stepperAria")}
      className="inline-flex items-center gap-1 rounded-pill border border-line bg-sunken p-0.5"
    >
      {board.map((entry) => {
        const { phase, state } = entry;
        const locked = state === "locked";
        const prev = previousPhase(phase);
        const isCurrent = phase === current;
        const title = `${phase} · ${tLex(state)}${
          locked && prev ? ` — ${tPhases("lockedTooltip", { prev })}` : ""
        }`;
        const segmentClass = `flex items-center gap-1 rounded-pill font-mono text-mono-sm ${pad} transition-colors duration-[var(--motion-fast)] ${
          isCurrent ? "bg-surface shadow-tile-sm" : interactive ? "hover:bg-surface" : ""
        } ${PHASE_STATE_TEXT[state]}`;
        const content = (
          <>
            <PhaseStateIcon state={state} size={10} />
            {phase}
          </>
        );
        return (
          <li key={phase}>
            {interactive ? (
              <Link
                href={targetHref(projectId, entry)}
                title={title}
                aria-current={isCurrent ? "step" : undefined}
                className={segmentClass}
              >
                {content}
              </Link>
            ) : (
              <span title={title} className={segmentClass}>
                {content}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

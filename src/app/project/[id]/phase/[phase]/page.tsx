import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { loadPhaseBoard } from "@/lib/phases/service";
import {
  hasGate,
  isManualClose,
  isPhaseId,
  previousPhase,
  type PhaseId,
} from "@/lib/phases/config";
import { PhaseStepperV2 } from "@/components/PhaseStepper";
import { StartPhaseForm, GateCloseForm } from "@/components/PhaseGateForms";
import { PhaseStateIcon, PHASE_STATE_TEXT, IconLock } from "@/components/icons";
import type { DecisionRow, ProjectRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Fázis-oldal (×7, állapotfüggő): V2 kompakt stepper felül; a négy zóna
// csontváza; a ④ Kapu MŰKÖDIK (kritérium-checklist, zárás-flow, Decision-
// történet). Zárt fázis: lakat-nézet (design 1c). P6: nincs kapu.
// ─────────────────────────────────────────────────────────────

/** A fázishoz tartozó gate_close döntések: a note a fáziskóddal kezdődik
 *  (opcionális '[ideiglenes kézi lezárás] ' prefix után). */
function decisionsForPhase(decisions: DecisionRow[], phase: PhaseId): DecisionRow[] {
  const TEMP_PREFIX = "[ideiglenes kézi lezárás] ";
  return decisions.filter((d) => {
    const note = (d.note ?? "").startsWith(TEMP_PREFIX)
      ? (d.note ?? "").slice(TEMP_PREFIX.length)
      : (d.note ?? "");
    return note.startsWith(phase);
  });
}

export default async function PhasePage({
  params,
}: {
  params: Promise<{ id: string; phase: string }>;
}) {
  const { id, phase: phaseParam } = await params;
  if (!isPhaseId(phaseParam)) notFound();
  const phase = phaseParam;

  const supabase = createServiceSupabaseClient();
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();
  const projectRow = project as ProjectRow;

  const [board, { data: decisionData }] = await Promise.all([
    loadPhaseBoard(supabase, id),
    supabase
      .from("decisions")
      .select("*")
      .eq("project_id", id)
      .eq("kind", "gate_close")
      .order("created_at", { ascending: false }),
  ]);

  const entry = board.find((e) => e.phase === phase);
  if (!entry) notFound();
  const state = entry.state;
  const phaseDecisions = decisionsForPhase(
    (decisionData ?? []) as DecisionRow[],
    phase,
  );

  const [locale, tPhases, tLex, tGates, tCriteria] = await Promise.all([
    getLocale(),
    getTranslations("phases"),
    getTranslations("phases.lexicon"),
    getTranslations("gates"),
    getTranslations("criteria"),
  ]);
  const dateLocale = locale === "hu" ? "hu-HU" : "en-GB";
  const dateOptions = { timeZone: "Europe/Budapest" } as const;
  const prev = previousPhase(phase);
  const shortName = tPhases(`${phase.toLowerCase()}.short`);
  const fullName = tPhases(`${phase.toLowerCase()}.full`);

  return (
    <div className="space-y-6">
      {/* Fejléc + V2 kompakt szegmens-stepper */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={`/project/${id}`}
            className="text-mono-sm text-ink-tertiary hover:text-ink-secondary hover:underline"
          >
            ← {projectRow.name}
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-title">
            <span className="font-mono text-ink-tertiary">{phase}</span>
            {shortName}
            {/* Állapot: ikon + szöveg (törvény 4) */}
            <span
              className={`inline-flex items-center gap-1 rounded-pill border border-line bg-surface px-2 py-0.5 text-mono-sm font-sans font-medium ${PHASE_STATE_TEXT[state]}`}
            >
              <PhaseStateIcon state={state} size={11} />
              {tLex(state)}
            </span>
          </h1>
          <p className="mt-0.5 text-body text-ink-secondary">{fullName}</p>
        </div>
        <PhaseStepperV2
          projectId={id}
          board={board.map(({ phase: p, state: s }) => ({ phase: p, state: s }))}
          current={phase}
        />
      </div>

      {/* ── Zárt (locked) nézet: lakat + magyarázat + link (design 1c) ── */}
      {state === "locked" && (
        <div className="card-sunken mx-auto mt-10 max-w-md p-10 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-pill border border-line bg-surface text-ink-tertiary">
            <IconLock size={18} />
          </div>
          <h2 className="mt-4 text-body font-semibold text-ink-secondary">
            {tGates("lockedTitle")}
          </h2>
          <p className="mt-1 text-body text-ink-tertiary">
            {tGates("lockedBody", { prev: prev ?? "" })}
          </p>
          {prev && (
            <Link
              href={`/project/${id}/phase/${prev}`}
              className="mt-5 inline-flex items-center justify-center rounded-control border border-line bg-surface px-4 py-2 text-body font-medium shadow-tile-sm transition-colors duration-[var(--motion-base)] hover:bg-sunken"
            >
              {tGates("goToPrev", { prev })}
            </Link>
          )}
        </div>
      )}

      {/* ── completed: olvasó nézet + kapu-döntés ── */}
      {state === "completed" && (
        <div className="space-y-6">
          <section className="glass-tile border-l-2 border-l-done p-4">
            <h2 className="flex items-center gap-2 text-body font-semibold text-done">
              <PhaseStateIcon state="completed" size={13} />
              {tGates("completedTitle")}
            </h2>
            {phaseDecisions[0] && (
              <div className="mt-3 rounded-tile border border-line bg-surface p-3">
                <div className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
                  {tGates("gateDecisionTitle")}
                </div>
                <p className="mt-1 text-body">{phaseDecisions[0].note}</p>
                <p className="mt-1 text-mono-sm text-ink-tertiary">
                  {tGates("closedAt", {
                    date: new Date(phaseDecisions[0].created_at).toLocaleString(
                      dateLocale,
                      dateOptions,
                    ),
                  })}
                </p>
              </div>
            )}
          </section>
          <DecisionHistory
            decisions={phaseDecisions}
            title={tGates("decisionsTitle")}
            emptyLabel={tGates("noDecisions")}
            dateLocale={dateLocale}
          />
        </div>
      )}

      {/* ── open / in_progress / gate_pending: zónák + működő kapu ── */}
      {(state === "open" || state === "in_progress" || state === "gate_pending") && (
        <div className="space-y-6">
          {state === "open" && (
            <section className="glass-tile border-l-2 border-l-active p-4">
              <StartPhaseForm projectId={id} phase={phase} />
            </section>
          )}

          {/* ①–③ zóna: címkézett placeholder — a következő csomagok építik */}
          <div className="grid gap-4 lg:grid-cols-3">
            {(["zoneInput", "zoneTools", "zoneOutput"] as const).map((zone) => (
              <section
                key={zone}
                className="rounded-tile border border-dashed border-line p-4"
              >
                <h3 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
                  {tGates(zone)}
                </h3>
                <p className="mt-1 text-body text-ink-tertiary">
                  {tGates("zonesPlaceholder")}
                </p>
              </section>
            ))}
          </div>

          {/* ④ Kapu */}
          {!hasGate(phase) ? (
            <section className="card-sunken p-4">
              <h3 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
                {tGates("zoneGate")}
              </h3>
              <p className="mt-1 text-body font-semibold">{tGates("noGate")}</p>
              <p className="mt-1 text-body text-ink-secondary">{tGates("noGateBody")}</p>
            </section>
          ) : (
            <section
              className={`glass-tile p-4 ${
                state === "gate_pending" ? "border-gate/40" : ""
              }`}
            >
              <h3 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
                {tGates("zoneGate")} — {tGates("criteriaTitle")}
              </h3>

              {/* Kritérium-checklist: élő kiértékelés, zöld/borostyán,
                  MINDIG ikon + szöveg */}
              <ul className="mt-2 space-y-1.5">
                {entry.criteria.map((criterion) => (
                  <li
                    key={criterion.id}
                    className={`flex items-center gap-2 text-body ${
                      criterion.mode === "manual"
                        ? "rounded-tile border border-dashed border-gate/40 px-2 py-1.5"
                        : ""
                    }`}
                  >
                    <span className={criterion.satisfied ? "text-done" : "text-gate"}>
                      <PhaseStateIcon
                        state={criterion.satisfied ? "completed" : "gate_pending"}
                        size={11}
                      />
                    </span>
                    <span className="min-w-0 flex-1">{tCriteria(criterion.id)}</span>
                    <span
                      className={`shrink-0 text-mono-sm font-medium ${
                        criterion.satisfied ? "text-done" : "text-gate"
                      }`}
                    >
                      {criterion.satisfied
                        ? tGates("criterionSatisfied")
                        : tGates("criterionPending")}
                    </span>
                  </li>
                ))}
              </ul>

              {/* Zárás-flow — csak indított fázison (open-nél előbb indítás) */}
              {state !== "open" && (
                <div className="mt-4">
                  <GateCloseForm
                    projectId={id}
                    phase={phase}
                    temporary={isManualClose(phase)}
                  />
                </div>
              )}
            </section>
          )}

          <DecisionHistory
            decisions={phaseDecisions}
            title={tGates("decisionsTitle")}
            emptyLabel={tGates("noDecisions")}
            dateLocale={dateLocale}
          />
        </div>
      )}
    </div>
  );
}

function DecisionHistory({
  decisions,
  title,
  emptyLabel,
  dateLocale,
}: {
  decisions: DecisionRow[];
  title: string;
  emptyLabel: string;
  dateLocale: string;
}) {
  return (
    <section>
      <h2 className="mb-2 text-body font-semibold">{title}</h2>
      {decisions.length === 0 ? (
        <p className="text-body text-ink-tertiary">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2">
          {decisions.map((decision) => (
            <li
              key={decision.id}
              className="rounded-tile border border-line bg-surface px-3 py-2 text-body shadow-tile-sm"
            >
              <p>{decision.note}</p>
              <p className="mt-0.5 text-mono-sm text-ink-tertiary">
                {new Date(decision.created_at).toLocaleString(dateLocale, {
                  timeZone: "Europe/Budapest",
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

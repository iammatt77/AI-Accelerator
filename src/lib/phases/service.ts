import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PhaseInstanceRow } from "@/lib/db/types";
import {
  PHASE_CRITERIA,
  PHASE_IDS,
  hasGate,
  isManualClose,
  nextPhase,
  phaseIndex,
  type PhaseCriterion,
  type PhaseId,
} from "./config";
import { canTransition, parsePhaseState, type PhaseState } from "./machine";

// ─────────────────────────────────────────────────────────────
// Fázis-szerviz (server-only): betöltés + kritérium-kiértékelés
// OLVASÁSKOR és kapu-akciókor (nincs háttér-job), automatikus
// szinkron-átmenetek (in_progress ↔ gate_pending, locked → open
// ha az előző completed), „következő legjobb lépés" számítás.
// ─────────────────────────────────────────────────────────────

export interface EvaluatedCriterion extends PhaseCriterion {
  satisfied: boolean;
}

export interface PhaseBoardEntry {
  phase: PhaseId;
  state: PhaseState;
  cycleCount: number;
  rowId: string | null;
  criteria: EvaluatedCriterion[];
  /** Minden releváns auto-kritérium teljesül (gate_pending-kész). */
  gateReady: boolean;
}

export type NextStep =
  | { kind: "start"; phase: PhaseId }
  | { kind: "satisfy_criterion"; phase: PhaseId; criterionId: string; typeKey?: string }
  | { kind: "close_gate"; phase: PhaseId; temporary: boolean }
  | { kind: "no_gate"; phase: PhaseId }
  | { kind: "all_done" };

/** A projekt jóváhagyott artefaktum-TÍPUSAINAK halmaza — minden auto
 *  kritérium ebből értékelődik ki (fázisonkénti külön lekérdezés helyett
 *  EGY lekérdezés board-betöltésenként). `null` = a lekérdezés hibázott
 *  (≠ üres halmaz): degradált kör, tartós állapot-írás nélkül. */
export async function fetchApprovedTypes(
  supabase: SupabaseClient,
  projectId: string,
): Promise<Set<string> | null> {
  const { data, error } = await supabase
    .from("artifacts")
    .select("type")
    .eq("project_id", projectId)
    .eq("status", "approved");
  if (error) {
    console.error(`Jóváhagyott típusok lekérése sikertelen: ${error.message}`);
    return null;
  }
  return new Set(((data ?? []) as { type: string }[]).map((row) => row.type));
}

/** #7a: létezik-e megerősített quick win a shortlisten — a P1 entitás-
 *  szintű kemény kritériuma. A manual a confirmed-del azonos erősségű
 *  (kézi felvétel = emberi eredet). `null` = a lekérdezés hibázott. */
async function fetchQuickWinOnShortlist(
  supabase: SupabaseClient,
  projectId: string,
): Promise<boolean | null> {
  const { data, error } = await supabase
    .from("use_cases")
    .select("id")
    .eq("project_id", projectId)
    .eq("quick_win", true)
    .in("list_status", ["shortlist", "selected"])
    .in("state", ["confirmed", "manual"])
    .limit(1);
  if (error) {
    console.error(`Quick win-kritérium lekérése sikertelen: ${error.message}`);
    return null;
  }
  return (data ?? []).length > 0;
}

/** A kritérium-kiértékelés bemenete — board-betöltésenként EGYSZER
 *  gyűjtve (nem fázisonként/kritériumonként). */
interface CriterionContext {
  approvedTypes: Set<string> | null;
  quickWinOnShortlist: boolean | null;
}

async function fetchCriterionContext(
  supabase: SupabaseClient,
  projectId: string,
): Promise<CriterionContext> {
  const [approvedTypes, quickWinOnShortlist] = await Promise.all([
    fetchApprovedTypes(supabase, projectId),
    fetchQuickWinOnShortlist(supabase, projectId),
  ]);
  return { approvedTypes, quickWinOnShortlist };
}

function evaluateCriteria(
  phase: PhaseId,
  ctx: CriterionContext,
): { criteria: EvaluatedCriterion[]; degraded: boolean } {
  const result: EvaluatedCriterion[] = [];
  let degraded = false;
  for (const criterion of PHASE_CRITERIA[phase]) {
    let satisfied = false;
    if (criterion.mode === "auto") {
      if (criterion.id === "quick_win_on_shortlist") {
        // #7a: entitás-szintű kritérium — a use_cases-ből értékelődik.
        if (ctx.quickWinOnShortlist === null) {
          degraded = true;
        } else {
          satisfied = ctx.quickWinOnShortlist;
        }
      } else if (ctx.approvedTypes === null) {
        // Kiértékelési hiba nem törheti el a felületet — de nem is azonos a
        // „nem teljesül"-lel: degradált kör (kijelzés: nem teljesül;
        // állapot-átmenet: NEM írunk vissza hibás kiértékelésből).
        degraded = true;
      } else if (criterion.id === "charter_approved") {
        // Az élő adat 'Projekt-charter' típussal seedelt; a korábbi #3-seed
        // 'project_charter'-t írt — mindkettőt elfogadjuk (defenzív).
        satisfied =
          ctx.approvedTypes.has("Projekt-charter") ||
          ctx.approvedTypes.has("project_charter");
      } else if (criterion.typeKey) {
        // Deliverable-alapú kritérium (#6): bármely approved verzió számít
        // (a #5a v1-döntése szerint).
        satisfied = ctx.approvedTypes.has(criterion.typeKey);
      }
    }
    result.push({ ...criterion, satisfied });
  }
  return { criteria: result, degraded };
}

/** Egy fázis kritériumainak kiértékelése (a kapu-zárás app-szintű őre is
 *  ezt használja — a close_gate() DB-fn érintetlen). */
export async function evaluatePhaseCriteria(
  supabase: SupabaseClient,
  projectId: string,
  phase: PhaseId,
): Promise<{ criteria: EvaluatedCriterion[]; degraded: boolean }> {
  const ctx = await fetchCriterionContext(supabase, projectId);
  return evaluateCriteria(phase, ctx);
}

/** gate_pending-készség: minden kemény auto-kritérium teljesül; ha nincs
 *  kemény, akkor az összes (puha) auto-kritérium teljesülése számít
 *  (P0: a puha charter-kritérium egyedül is gate_pending-et ad). */
function computeGateReady(criteria: EvaluatedCriterion[]): boolean {
  const auto = criteria.filter((c) => c.mode === "auto");
  if (auto.length === 0) return false;
  const hard = auto.filter((c) => c.weight === "hard");
  if (hard.length > 0) return hard.every((c) => c.satisfied);
  return auto.every((c) => c.satisfied);
}

/** Hiányzó fázis-sorok pótlása (pl. #1-es örökség-projekt: csak P0 létezik).
 *  P0 hiányában open-ként, minden más locked-ként jön létre. */
async function ensurePhaseRows(
  supabase: SupabaseClient,
  projectId: string,
  existing: PhaseInstanceRow[],
): Promise<void> {
  const have = new Set(existing.map((r) => r.phase));
  const missing = PHASE_IDS.filter((p) => !have.has(p));
  if (missing.length === 0) return;
  const rows = missing.map((phase) => ({
    project_id: projectId,
    phase,
    state: phase === "P0" ? "open" : "locked",
  }));
  const { error } = await supabase
    .from("phase_instances")
    .upsert(rows, { onConflict: "project_id,phase", ignoreDuplicates: true });
  if (error) {
    console.error(`Fázis-sorok pótlása sikertelen: ${error.message}`);
  }
}

async function setPhaseState(
  supabase: SupabaseClient,
  rowId: string,
  from: PhaseState,
  to: PhaseState,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("phase_instances")
    .update({ state: to })
    .eq("id", rowId)
    .eq("state", from) // optimista guard: csak a várt állapotból
    .select("id");
  if (error) {
    console.error(`Állapot-átmenet írása sikertelen (${from}→${to}): ${error.message}`);
    return false;
  }
  return (data ?? []).length > 0;
}

/**
 * A projekt teljes fázis-táblájának betöltése kiértékeléssel és a
 * szinkron-átmenetek alkalmazásával:
 *  - locked → open, ha az előző fázis completed (gép-konzisztencia helyreállítás)
 *  - in_progress → gate_pending, ha a kritériumok teljesülnek
 *  - gate_pending → in_progress, ha a kritérium visszaesett
 */
export async function loadPhaseBoard(
  supabase: SupabaseClient,
  projectId: string,
): Promise<PhaseBoardEntry[]> {
  const { data, error } = await supabase
    .from("phase_instances")
    .select("*")
    .eq("project_id", projectId);
  if (error) {
    console.error(`Fázisok betöltése sikertelen: ${error.message}`);
  }
  let rows = (data ?? []) as PhaseInstanceRow[];

  if (rows.length < PHASE_IDS.length) {
    await ensurePhaseRows(supabase, projectId, rows);
    const reread = await supabase
      .from("phase_instances")
      .select("*")
      .eq("project_id", projectId);
    rows = (reread.data ?? rows) as PhaseInstanceRow[];
  }

  const byPhase = new Map(rows.map((r) => [r.phase, r]));
  const board: PhaseBoardEntry[] = [];

  // Board-betöltésenként EGYSZER gyűjtött kiértékelési kontextus
  // (approved típusok + quick win-kritérium) — minden fázis ebből
  // értékelődik ki.
  const ctx = await fetchCriterionContext(supabase, projectId);

  for (const phase of PHASE_IDS) {
    const row = byPhase.get(phase) ?? null;
    // Defenzív degradáció: hiányzó sor vagy ismeretlen state → locked.
    let state = parsePhaseState(row?.state);
    const { criteria, degraded } = evaluateCriteria(phase, ctx);
    const gateReady = computeGateReady(criteria);

    if (row) {
      // locked → open: az előző fázis completed (automatikus nyitás)
      if (state === "locked" && phaseIndex(phase) > 0) {
        const prev = board[phaseIndex(phase) - 1];
        if (
          prev?.state === "completed" &&
          canTransition("locked", "open", "auto_prev_completed")
        ) {
          if (await setPhaseState(supabase, row.id, "locked", "open")) {
            state = "open";
          }
        }
      }
      // in_progress → gate_pending (kritériumok teljesülnek)
      if (
        state === "in_progress" &&
        gateReady &&
        canTransition("in_progress", "gate_pending", "auto_criteria_met")
      ) {
        if (await setPhaseState(supabase, row.id, "in_progress", "gate_pending")) {
          state = "gate_pending";
        }
      }
      // gate_pending → in_progress (kritérium visszaesett) — kiértékelési
      // HIBA nem visszaesés: degradált körben nem írunk tartós átmenetet.
      if (
        state === "gate_pending" &&
        !gateReady &&
        !degraded &&
        canTransition("gate_pending", "in_progress", "auto_criteria_regressed")
      ) {
        if (await setPhaseState(supabase, row.id, "gate_pending", "in_progress")) {
          state = "in_progress";
        }
      }
    }

    board.push({
      phase,
      state,
      cycleCount: row?.cycle_count ?? 1,
      rowId: row?.id ?? null,
      criteria,
      gateReady,
    });
  }

  return board;
}

/** „Következő legjobb lépés" — az állapotgépből SZÁMÍTVA (hardcode tilos). */
export function computeNextStep(board: PhaseBoardEntry[]): NextStep {
  const first = board.find((entry) => entry.state !== "completed");
  if (!first) return { kind: "all_done" };

  switch (first.state) {
    case "open":
      return { kind: "start", phase: first.phase };
    case "gate_pending":
      return { kind: "close_gate", phase: first.phase, temporary: isManualClose(first.phase) };
    case "in_progress": {
      if (!hasGate(first.phase)) {
        return { kind: "no_gate", phase: first.phase };
      }
      const unmetAuto = first.criteria.find((c) => c.mode === "auto" && !c.satisfied);
      if (unmetAuto) {
        return {
          kind: "satisfy_criterion",
          phase: first.phase,
          criterionId: unmetAuto.id,
          typeKey: unmetAuto.typeKey,
        };
      }
      return { kind: "close_gate", phase: first.phase, temporary: isManualClose(first.phase) };
    }
    case "locked":
    default:
      // Gép-konzisztencia sérülés (a loadPhaseBoard heal-je után ritka):
      // a teendő az előző fázis lezárása.
      return { kind: "start", phase: first.phase };
  }
}

/** Nyitott kapuk száma (gate_pending fázisok) — stat-chiphez. */
export function countOpenGates(board: PhaseBoardEntry[]): number {
  return board.filter((e) => e.state === "gate_pending").length;
}

/** Lezárt fázisok száma — „X/7 lezárva". */
export function countCompleted(board: PhaseBoardEntry[]): number {
  return board.filter((e) => e.state === "completed").length;
}

export { nextPhase };

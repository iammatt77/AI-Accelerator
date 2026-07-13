// ─────────────────────────────────────────────────────────────
// Fázis-kritérium konfig (v0.2 §11 alapján, #4-terjedelem).
// TS-ben él, nem DB-ben. Tiszta modul: kliens és szerver egyaránt
// importálhatja (kiértékelés-логика a service-ben, server-only).
// ─────────────────────────────────────────────────────────────

export const PHASE_IDS = ["P0", "P1", "P2", "P3", "P4", "P5", "P6"] as const;
export type PhaseId = (typeof PHASE_IDS)[number];

export function isPhaseId(value: string): value is PhaseId {
  return (PHASE_IDS as readonly string[]).includes(value);
}

export function phaseIndex(phase: PhaseId): number {
  return Number(phase.slice(1));
}

export function previousPhase(phase: PhaseId): PhaseId | null {
  const i = phaseIndex(phase);
  return i > 0 ? (PHASE_IDS[i - 1] as PhaseId) : null;
}

export function nextPhase(phase: PhaseId): PhaseId | null {
  const i = phaseIndex(phase);
  return i < PHASE_IDS.length - 1 ? (PHASE_IDS[i + 1] as PhaseId) : null;
}

// Kritérium-módok:
//  - auto: a rendszer értékeli ki (olvasáskor + kapu-akciókor)
//  - manual: ideiglenes-kézi zárás — a #6-tól NEM használt (a valós,
//    deliverable-alapú kritériumok váltották ki); a típus a defenzív
//    parse miatt marad.
export type CriterionMode = "auto" | "manual";
// Súly: a puha kritérium teljesülése gate_pending-et ad, ha nincs mellette
// kemény; kemény kritérium kötelező a gate_pending-hez.
export type CriterionWeight = "soft" | "hard";

export interface PhaseCriterion {
  id: string;
  mode: CriterionMode;
  weight: CriterionWeight;
  /** Deliverable-alapú kritériumnál a kapu-hordozó artifacts.type kulcsa. */
  typeKey?: string;
  /** Interim küszöb (#6): a kanonikus kritérium (golden set küszöb /
   *  scale-pivot-stop / adopciós küszöb) mélység-csomaggal érkezik. */
  interim?: boolean;
}

// A P1–P5 kilépő kritériumai a TÍPUS-KONFIGBÓL SZÁRMAZNAK (#6): a fázis
// összes kapu-hordozó ([K]) deliverable-je Approved — kritériumonként egy
// deliverable, KEMÉNY súllyal. (A körkörös importot az artifacts-konfig
// type-only visszahivatkozása zárja ki.)
import { gateTypesForPhase } from "@/lib/artifacts/config";

const INTERIM_PHASES: ReadonlySet<PhaseId> = new Set(["P3", "P4", "P5"]);

function deliverableCriteria(phase: PhaseId): PhaseCriterion[] {
  return gateTypesForPhase(phase).map((typeDef) => ({
    id: `deliverable_approved:${typeDef.key}`,
    mode: "auto" as const,
    weight: "hard" as const,
    typeKey: typeDef.key,
    interim: INTERIM_PHASES.has(phase) || undefined,
  }));
}

// #7a: a P1 kanonikus, ENTITÁS-szintű kemény kritériuma (v0.2 §6):
// létezik use case, amelynél quick_win=true ÉS list_status ∈ (shortlist,
// selected) ÉS state megerősített (confirmed/manual — a kézi felvétel
// emberi eredetű, megerősített-erősségű a kódbázis konvenciója szerint).
// Ez váltja ki a #6 csak-dokumentum interim megoldását — a shortlist
// Approved deliverable-kritérium MELLETT él, nem helyette.
export const QUICK_WIN_CRITERION: PhaseCriterion = {
  id: "quick_win_on_shortlist",
  mode: "auto",
  weight: "hard",
};

// Fázisonkénti KILÉPŐ kritériumok (#6, Melléklet A; #7a: P1 kanonikus):
//  P0: charter_approved — auto, PUHA (változatlan)
//  P1: shortlist Approved + megerősített quick win a shortlisten (KEMÉNY)
//  P2–P5: a fázis [K] deliverable-jei Approved — auto, KEMÉNY
//         (P3–P5: interim jelöléssel)
//  P6: nincs kapu (ciklikus fázis — változatlan)
export const PHASE_CRITERIA: Record<PhaseId, PhaseCriterion[]> = {
  P0: [{ id: "charter_approved", mode: "auto", weight: "soft" }],
  P1: [...deliverableCriteria("P1"), QUICK_WIN_CRITERION],
  P2: deliverableCriteria("P2"),
  P3: deliverableCriteria("P3"),
  P4: deliverableCriteria("P4"),
  P5: deliverableCriteria("P5"),
  P6: [],
};

/** Van-e egyáltalán kapuja a fázisnak (P6: nincs). */
export function hasGate(phase: PhaseId): boolean {
  return PHASE_CRITERIA[phase].length > 0;
}

/** Ideiglenes-kézi zárású fázis-e (P1–P5 a #4-ben). */
export function isManualClose(phase: PhaseId): boolean {
  return PHASE_CRITERIA[phase].some((c) => c.mode === "manual");
}

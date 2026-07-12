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
//  - manual: ideiglenes-kézi zárás (a #5+ csomagok váltják ki valódi
//    kritériumokra) — a felületen láthatóan megkülönböztetve
export type CriterionMode = "auto" | "manual";
// Súly: a puha kritérium teljesülése gate_pending-et ad, ha nincs mellette
// kemény; kemény kritérium kötelező a gate_pending-hez.
export type CriterionWeight = "soft" | "hard";

export interface PhaseCriterion {
  id: string;
  mode: CriterionMode;
  weight: CriterionWeight;
}

// Fázisonkénti KILÉPŐ kritériumok (A melléklet):
//  P0: charter_approved — auto, PUHA (artifacts: Projekt-charter + approved)
//  P1–P5: manual_close — ideiglenes-kézi
//  P6: nincs kapu (ciklikus fázis)
export const PHASE_CRITERIA: Record<PhaseId, PhaseCriterion[]> = {
  P0: [{ id: "charter_approved", mode: "auto", weight: "soft" }],
  P1: [{ id: "manual_close", mode: "manual", weight: "hard" }],
  P2: [{ id: "manual_close", mode: "manual", weight: "hard" }],
  P3: [{ id: "manual_close", mode: "manual", weight: "hard" }],
  P4: [{ id: "manual_close", mode: "manual", weight: "hard" }],
  P5: [{ id: "manual_close", mode: "manual", weight: "hard" }],
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

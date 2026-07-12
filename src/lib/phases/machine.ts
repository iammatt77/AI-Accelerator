// ─────────────────────────────────────────────────────────────
// Állapotgép — átmenet-tábla és validálás (A melléklet).
// Tiszta modul (nincs DB-hozzáférés): a szerviz és az actionök
// használják; a kliens állapotot SOHA nem diktál.
// ─────────────────────────────────────────────────────────────

export const PHASE_STATES = [
  "locked",
  "open",
  "in_progress",
  "gate_pending",
  "completed",
] as const;
export type PhaseState = (typeof PHASE_STATES)[number];

// Pivot-hurok (completed → in_progress): az átmenet-táblában DEFINIÁLT,
// de a #4-ben NEM bekötött — a #9 aktiválja (cycle_count++ ott).
export const PIVOT_LOOP_ENABLED = false;

export type TransitionTrigger =
  | "auto_prev_completed" // locked → open
  | "start_phase" // open → in_progress („Fázis indítása")
  | "auto_criteria_met" // in_progress → gate_pending
  | "auto_criteria_regressed" // gate_pending → in_progress
  | "close_gate" // in_progress | gate_pending → completed
  | "pivot"; // completed → in_progress (NEM bekötött, #9)

export interface Transition {
  from: PhaseState;
  to: PhaseState;
  trigger: TransitionTrigger;
  /** false: definiált, de ebben a csomagban nem hívható. */
  wired: boolean;
}

export const TRANSITIONS: Transition[] = [
  { from: "locked", to: "open", trigger: "auto_prev_completed", wired: true },
  { from: "open", to: "in_progress", trigger: "start_phase", wired: true },
  { from: "in_progress", to: "gate_pending", trigger: "auto_criteria_met", wired: true },
  { from: "gate_pending", to: "in_progress", trigger: "auto_criteria_regressed", wired: true },
  { from: "in_progress", to: "completed", trigger: "close_gate", wired: true },
  { from: "gate_pending", to: "completed", trigger: "close_gate", wired: true },
  { from: "completed", to: "in_progress", trigger: "pivot", wired: PIVOT_LOOP_ENABLED },
];

/** Megengedett-e az átmenet az adott triggerrel (és be van-e kötve). */
export function canTransition(
  from: PhaseState,
  to: PhaseState,
  trigger: TransitionTrigger,
): boolean {
  return TRANSITIONS.some(
    (t) => t.wired && t.from === from && t.to === to && t.trigger === trigger,
  );
}

/**
 * Defenzív degradáció: a DB-ből érkező state-stringet biztonságosan
 * értelmezi — ismeretlen/migráció előtti érték → 'locked', a felület
 * nem törik el.
 */
export function parsePhaseState(value: unknown): PhaseState {
  if (typeof value === "string" && (PHASE_STATES as readonly string[]).includes(value)) {
    return value as PhaseState;
  }
  return "locked";
}

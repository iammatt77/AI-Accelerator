// Adatbázis sor-típusok (v0.2 §4, minimális oszlopok).
// Kézzel karbantartott — a foundation csomaghoz elég.

export type ArtifactStatus = "draft" | "in_review" | "approved";

export interface ClientRow {
  id: string;
  name: string;
  industry: string | null;
  created_at: string;
}

export interface ProjectRow {
  id: string;
  client_id: string;
  name: string;
  package: string | null;
  status: string;
  created_at: string;
}

export interface PhaseInstanceRow {
  id: string;
  project_id: string;
  phase: string;
  // A DB-ben phase_state enum (0002 migráció); itt string marad, mert a
  // határon defenzíven parse-oljuk (ismeretlen érték → 'locked').
  state: string;
  cycle_count: number;
}

export interface InputItemRow {
  id: string;
  project_id: string;
  type: string;
  raw_text: string;
  /** A munkaterület fázisa, ahol a bemenet érkezett (0003; régi sorok: null). */
  phase: string | null;
  created_at: string;
}

export interface ArtifactRow {
  id: string;
  project_id: string;
  type: string;
  version: number;
  status: ArtifactStatus;
  body: string;
  source_input_ids: string[];
  /** Strukturált mezők jsonb (0003) — defenzív parse: parseArtifactFields. */
  fields: unknown;
  updated_at: string;
  created_at: string;
}

/** E1 entitás-szinten (0004): AI-javaslat → emberi megerősítés / elvetés;
 *  manual = kézi felvétel (emberi eredetű, megerősített-erősségű). */
export type EntityState = "ai_suggested" | "confirmed" | "manual" | "rejected";

export interface PainPointRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  quote: string | null;
  severity: "low" | "medium" | "high" | null;
  source_input_ids: string[];
  state: EntityState;
  created_at: string;
}

export interface UseCaseRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  pain_point_ids: string[];
  score_value: number | null;
  score_feasibility: number | null;
  risk: "low" | "medium" | "high" | null;
  quick_win: boolean;
  list_status: "candidate" | "shortlist" | "excluded" | "selected";
  exclusion_reason: string | null;
  source_input_ids: string[];
  state: EntityState;
  /** Értékelő jsonb-k (0005) — defenzív parse: lib/entities/evaluators. */
  ai_suitability: unknown;
  data_readiness: unknown;
  ai_act: unknown;
  created_at: string;
  updated_at: string;
}

export interface DecisionRow {
  id: string;
  project_id: string;
  kind: string;
  note: string | null;
  created_at: string;
}

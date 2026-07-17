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
  /** Melyik stakeholdertől jött az input (0006, #8); null = nem köthető. */
  stakeholder_source_id: string | null;
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
  /** P2 haszon-kalkulátor jsonb (0007, #9) — defenzív parse: parseBenefitCalc. */
  benefit_calc: unknown;
  /** P2 pilot sikerdefiníció jsonb (0007, #9) — defenzív parse: parsePilotSuccess. */
  pilot_success: unknown;
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

/** Stakeholder-entitás (0006, #8). Ügyfélhez ÉS projekthez kötve; az E1-lánc
 *  a pain_points/use_cases mintáját követi. A score (influence/impact) null,
 *  ha a forrás nem ad rá alapot (a modell nem tippel — c-minta). A
 *  communication_strategy KIZÁRÓLAG manuális (sosem AI-előtöltött). */
export interface StakeholderRow {
  id: string;
  client_id: string;
  project_id: string;
  name: string;
  title: string | null;
  influence_score: number | null;
  impact_score: number | null;
  communication_strategy: string | null;
  source_input_ids: string[];
  state: EntityState;
  created_at: string;
  updated_at: string;
}

/** pain_points ↔ stakeholders many-to-many kötőtábla sora (0006). */
export interface PainPointStakeholderRow {
  pain_point_id: string;
  stakeholder_id: string;
}

/** process_maps sora (0008, #10 Folyamattérkép). */
export interface ProcessMapRow {
  id: string;
  project_id: string;
  phase: string | null;
  kind: "as_is" | "to_be";
  title: string;
  status: ArtifactStatus;
  version: number;
  /** A nyers leirat (input_items) — csak hivatkozott, SOHA nem íródik felül. */
  source_input_id: string | null;
  to_be_origin: "document" | "ai_suggested" | null;
  /** Node-lista jsonb — defenzív parse: lib/processmap/parse.graphFromJson. */
  nodes: unknown;
  /** Él-lista jsonb — ugyanott. */
  edges: unknown;
  /** Az eredeti AI-generált {nodes,edges} a változáskövetéshez. */
  original_snapshot: unknown;
  /** Chat-üzenetek + függő javaslat jsonb — lib/processmap/chat. */
  chat_log: unknown;
  created_at: string;
  updated_at: string;
}

// ── Követelmény-modul (0009, #11) ────────────────────────────

export type RequirementLevel = "business" | "stakeholder" | "system";
export type RequirementSubtype = "functional" | "non_functional";
/** MoSCoW — NULLABLE: emberi ítélet, az AI alap nélkül nem tölti. */
export type Moscow = "must" | "should" | "could" | "wont";

/** requirements sora — háromszintű fa (parent_id), display_id = BR-/SR-/SYS-/NFR-nn. */
export interface RequirementRow {
  id: string;
  project_id: string;
  phase: string;
  level: RequirementLevel;
  subtype: RequirementSubtype | null;
  parent_id: string | null;
  moscow: Moscow | null;
  text: string;
  source_input_ids: string[];
  state: EntityState;
  display_id: string;
  created_at: string;
  updated_at: string;
}

/** acceptance_criteria sora — az AC a REQUIREMENTEN él (közös AC magja). */
export interface AcceptanceCriterionRow {
  id: string;
  requirement_id: string;
  title: string;
  given_text: string;
  when_text: string;
  then_text: string;
  ord: number;
  created_at: string;
}

/** epics sora (EP-nn). */
export interface EpicRow {
  id: string;
  project_id: string;
  title: string;
  business_requirement_id: string | null;
  display_id: string;
  created_at: string;
}

/** user_stories sora (US-nn) — a system requirementekből SZÁRMAZIK. */
export interface UserStoryRow {
  id: string;
  project_id: string;
  epic_id: string | null;
  role: string;
  want: string;
  so_that: string;
  moscow: Moscow | null;
  state: EntityState;
  source_input_ids: string[];
  display_id: string;
  created_at: string;
  updated_at: string;
}

/** requirement ↔ story N:M kötés sora. */
export interface RequirementStoryRow {
  requirement_id: string;
  story_id: string;
}

/** stakeholder-szintű requirement érintett-kötése. */
export interface StakeholderRequirementRow {
  requirement_id: string;
  stakeholder_id: string;
}

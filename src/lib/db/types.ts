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

// ── Megoldási opció-összevető (#12, 0010) ────────────────────

export type ComponentType = "process" | "infrastructure" | "personnel";

/** solution_components sora — MIVEL valósul meg a megoldás. */
export interface SolutionComponentRow {
  id: string;
  project_id: string;
  phase: string;
  type: ComponentType;
  name: string;
  description: string;
  state: EntityState;
  source_input_ids: string[];
  created_at: string;
  updated_at: string;
}

/**
 * component_step_links sora — a komponens ↔ TO-BE lépés kötés a process_map
 * jsonb-jén BELÜLI stabil node-id-re (a node-ok `id` mezője; a szerkesztés
 * és a verzió-emelés megőrzi). A process_map_id provenance.
 */
export interface ComponentStepLinkRow {
  component_id: string;
  process_map_id: string;
  node_id: string;
}

/** Egy szempont-cella értéke — a hiányzó szempont ÜRES (c-minta). */
export interface CriterionValue {
  value: string;
  note?: string;
  /** Egyedi (nem alap-készletbeli) szempont felirata. */
  label?: string;
}

/** component_options sora — a nyertest EMBER választja (HITL). */
export interface ComponentOptionRow {
  id: string;
  component_id: string;
  name: string;
  description: string;
  /** szempont-kulcs → { value, note, label? } — defenzív parse a lib-ben. */
  criteria_values: unknown;
  is_selected: boolean;
  /** ✦ AI AJÁNLJA — ajánlás, SOSEM választás. */
  ai_recommended: boolean;
  rationale: string;
  selected_by: string | null;
  selected_at: string | null;
  ord: number;
  created_at: string;
}

// ── P3 Golden set + Tesztriport (#14, 0011) ──────────────────

export type AnswerType = "free_text" | "choice_single" | "choice_multi" | "number_scale" | "yes_no";
export type Verdict = "passed" | "partial" | "failed";

/** golden_sets sora — a P2 use case-hez (1:1). A küszöb EMBERI mező. */
export interface GoldenSetRow {
  id: string;
  project_id: string;
  use_case_id: string;
  phase: string;
  /** NULL = nincs beállítva → a Tesztriport nem hagyható jóvá (poka-yoke). */
  pass_threshold: number | null;
  /** Dokumentált emberi felülírás (AC5 kivétel) — üres = nincs. */
  threshold_override_note: string;
  created_at: string;
  updated_at: string;
}

/** eval_cases sora (EC-nn) — az állapot (rögzítendő→besorolva) LEVEZETETT. */
export interface EvalCaseRow {
  id: string;
  golden_set_id: string;
  display_id: string;
  input_text: string;
  answer_type: AnswerType;
  /** Típusfüggő konfiguráció jsonb — defenzív parse: lib/goldenset/model. */
  answer_config: unknown;
  /** OPCIONÁLIS elvárt kimenet (c-minta — nyílt esetnél üres, a kritérium dönt). */
  expected_output: unknown;
  /** A KÍVÜL lefuttatott megoldás tényleges kimenete — a rendszer nem futtat. */
  actual_output: unknown;
  /** ✦ AI-ajánlás — KÜLÖN az emberi végső ítélettől (E1). */
  ai_verdict: Verdict | null;
  ai_rationale: string;
  /** Kritériumonkénti OK/BUKOTT hivatkozás jsonb: [{ord, ok}]. */
  ai_criteria: unknown;
  /** A VÉGSŐ ítélet — emberi (elfogadás vagy felülírás). */
  final_verdict: Verdict | null;
  verdict_by: string | null;
  verdict_at: string | null;
  source_input_ids: string[];
  state: EntityState;
  ord: number;
  created_at: string;
  updated_at: string;
}

/** eval_criteria sora (K1..) — a pass/fail fő alapja; eredet a state-ben. */
export interface EvalCriterionRow {
  id: string;
  eval_case_id: string;
  ord: number;
  text: string;
  state: EntityState;
  created_at: string;
}

// ── P3 Megoldás-dokumentáció (#15, 0012) ─────────────────────

export type BuildLayerType = "process" | "infrastructure" | "personnel";
export type ImplTargetType = "requirement" | "story" | "tobe_node" | "pain_point";

/** build_components sora (K-nn) — a megépített megoldás komponense.
 *  KÉT elkülönített kötés-fajta: EREDET (origin_component_id → P2
 *  solution_components; NULL = manuális) és MEGVALÓSÍTÁS (impl_links). */
export interface BuildComponentRow {
  id: string;
  project_id: string;
  phase: string;
  display_id: string;
  name: string;
  description: string;
  layer_type: BuildLayerType;
  /** P2-seed eredet (1-N); NULL = manuális, nincs P2-előzmény. */
  origin_component_id: string | null;
  state: EntityState;
  source_input_ids: string[];
  ord: number;
  created_at: string;
  updated_at: string;
}

/** impl_links sora — komponens ↔ terv-elem (N:M, 4 cél-típus, kétirányú
 *  olvasat). A tobe_node target_id-ja a térkép jsonb STABIL node-id-ja.
 *  ai_suggested (✦) csak emberi megerősítéssel válik aktívvá (E1). */
export interface ImplLinkRow {
  id: string;
  component_id: string;
  target_type: ImplTargetType;
  target_id: string;
  process_map_id: string | null;
  state: EntityState;
  created_at: string;
}

/** prompt_items sora (PR-nn) — komponenshez kötött prompt-elem (1-N). */
export interface PromptItemRow {
  id: string;
  project_id: string;
  component_id: string;
  display_id: string;
  name: string;
  purpose: string;
  prompt_text: string;
  state: EntityState;
  source_input_ids: string[];
  ord: number;
  created_at: string;
  updated_at: string;
}

/** control_points sora — guardrail/HITL; TO-BE kötés opcionális (c-minta). */
export interface ControlPointRow {
  id: string;
  project_id: string;
  name: string;
  kind: "guardrail" | "hitl";
  description: string;
  process_map_id: string | null;
  node_id: string | null;
  state: EntityState;
  source_input_ids: string[];
  ord: number;
  created_at: string;
  updated_at: string;
}

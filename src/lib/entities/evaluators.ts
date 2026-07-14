// ─────────────────────────────────────────────────────────────
// P1 értékelők (#7b) — TISZTA modul (kliens és szerver egyaránt
// importálhatja): a use_cases három jsonb mezőjének defenzív parse-a és
// az összesítő szabályok. NINCS LLM-érintés — az értékelők emberi űrlapok.
//
// Kanonikus tartalom: AI Enablement kézikönyv 3.2 (5 alkalmassági
// kritérium) és 6.1–6.2 (AI Act 4 kockázati szint) — a szövegek az i18n
// szótárban élnek, itt a kulcsok és a szabályok.
// ─────────────────────────────────────────────────────────────

// ── 3a. AI-alkalmassági szűrő (kézikönyv 3.2) ────────────────

export const SUITABILITY_CRITERIA = ["c1", "c2", "c3", "c4", "c5"] as const;
export type SuitabilityCriterion = (typeof SUITABILITY_CRITERIA)[number];
export type SuitabilityAnswer = "yes" | "partial" | "no";

export interface AiSuitability {
  criteria: Partial<Record<SuitabilityCriterion, SuitabilityAnswer>>;
  note: string | null;
}

/** 5 igen → erős jelölt · ≥3 igen és nincs nem → alkalmas · bármely nem →
 *  feltételes. Kiegészítő szabály (dokumentált): nem-teljes kitöltésnél
 *  nincs összesítés (null); teljes kitöltésnél a <3 igen (csupa részben)
 *  szintén „feltételes" — a leggyengébb kategóriába esik. */
export type SuitabilityVerdict = "strong" | "suitable" | "conditional";

const SUITABILITY_ANSWERS = new Set(["yes", "partial", "no"]);

export function parseAiSuitability(raw: unknown): AiSuitability | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const criteriaRaw =
    obj.criteria && typeof obj.criteria === "object" && !Array.isArray(obj.criteria)
      ? (obj.criteria as Record<string, unknown>)
      : {};
  const criteria: AiSuitability["criteria"] = {};
  for (const key of SUITABILITY_CRITERIA) {
    const value = criteriaRaw[key];
    if (typeof value === "string" && SUITABILITY_ANSWERS.has(value)) {
      criteria[key] = value as SuitabilityAnswer;
    }
  }
  if (Object.keys(criteria).length === 0) return null;
  return {
    criteria,
    note: typeof obj.note === "string" && obj.note.trim() !== "" ? obj.note : null,
  };
}

export function suitabilityVerdict(
  suitability: AiSuitability | null,
): SuitabilityVerdict | null {
  if (!suitability) return null;
  const answers = SUITABILITY_CRITERIA.map((k) => suitability.criteria[k]);
  if (answers.some((a) => a === undefined)) return null; // nem teljes kitöltés
  if (answers.some((a) => a === "no")) return "conditional";
  const yes = answers.filter((a) => a === "yes").length;
  if (yes === 5) return "strong";
  if (yes >= 3) return "suitable";
  return "conditional";
}

// ── 3b. Adatérettség mini-értékelő (láncszem-elv) ────────────

export const READINESS_DIMENSIONS = [
  "availability",
  "quality",
  "legal",
  "access",
] as const;
export type ReadinessDimension = (typeof READINESS_DIMENSIONS)[number];
export type ReadinessGrade = "weak" | "partial" | "strong";
export type ReadinessLevel = "low" | "medium" | "high";

export interface DataReadiness {
  dimensions: Partial<Record<ReadinessDimension, ReadinessGrade>>;
  note: string | null;
}

const READINESS_GRADES = new Set(["weak", "partial", "strong"]);

export function parseDataReadiness(raw: unknown): DataReadiness | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const dimsRaw =
    obj.dimensions && typeof obj.dimensions === "object" && !Array.isArray(obj.dimensions)
      ? (obj.dimensions as Record<string, unknown>)
      : {};
  const dimensions: DataReadiness["dimensions"] = {};
  for (const key of READINESS_DIMENSIONS) {
    const value = dimsRaw[key];
    if (typeof value === "string" && READINESS_GRADES.has(value)) {
      dimensions[key] = value as ReadinessGrade;
    }
  }
  if (Object.keys(dimensions).length === 0) return null;
  return {
    dimensions,
    note: typeof obj.note === "string" && obj.note.trim() !== "" ? obj.note : null,
  };
}

/** A LEGGYENGÉBB dimenzió dominál (láncszem-elv): bármely gyenge → low ·
 *  bármely részleges → medium · mind erős → high. Csak teljes kitöltésnél
 *  összesít (különben null). A szint a mentéskor tárolódik is (spec-alak),
 *  de olvasáskor ÚJRA számítjuk — a szabály a kód, nem a tárolt érték. */
export function readinessLevel(
  readiness: DataReadiness | null,
): ReadinessLevel | null {
  if (!readiness) return null;
  const grades = READINESS_DIMENSIONS.map((k) => readiness.dimensions[k]);
  if (grades.some((g) => g === undefined)) return null;
  if (grades.some((g) => g === "weak")) return "low";
  if (grades.some((g) => g === "partial")) return "medium";
  return "high";
}

// ── 3c. AI Act gyorsbesoroló (kézikönyv 6.1–6.2, E1) ─────────

export const AI_ACT_QUESTIONS = ["annex3", "interacts", "prohibited"] as const;
export type AiActQuestion = (typeof AI_ACT_QUESTIONS)[number];

/** A 4 kanonikus szint: tiltott · nagy kockázatú (Annex III) ·
 *  átláthatósági (Art. 50) · minimális. */
export const AI_ACT_CATEGORIES = [
  "prohibited",
  "high_risk",
  "transparency",
  "minimal",
] as const;
export type AiActCategory = (typeof AI_ACT_CATEGORIES)[number];

export interface AiActAssessment {
  answers: Partial<Record<AiActQuestion, boolean>>;
  suggested: AiActCategory | null;
  /** Az EMBER által megerősített besorolás (E1) — csak ez számít tovább. */
  confirmed_category: AiActCategory | null;
  note: string | null;
}

const AI_ACT_CATEGORY_SET = new Set<string>(AI_ACT_CATEGORIES);

export function parseAiAct(raw: unknown): AiActAssessment | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const answersRaw =
    obj.answers && typeof obj.answers === "object" && !Array.isArray(obj.answers)
      ? (obj.answers as Record<string, unknown>)
      : {};
  const answers: AiActAssessment["answers"] = {};
  for (const key of AI_ACT_QUESTIONS) {
    const value = answersRaw[key];
    if (typeof value === "boolean") answers[key] = value;
  }
  const suggested =
    typeof obj.suggested === "string" && AI_ACT_CATEGORY_SET.has(obj.suggested)
      ? (obj.suggested as AiActCategory)
      : null;
  const confirmed =
    typeof obj.confirmed_category === "string" &&
    AI_ACT_CATEGORY_SET.has(obj.confirmed_category)
      ? (obj.confirmed_category as AiActCategory)
      : null;
  if (Object.keys(answers).length === 0 && !suggested && !confirmed) return null;
  return {
    answers,
    suggested,
    confirmed_category: confirmed,
    note: typeof obj.note === "string" && obj.note.trim() !== "" ? obj.note : null,
  };
}

/** Javaslat-szabály (precedencia): tiltott gyakorlat → tiltott · Annex III →
 *  nagy kockázatú · ember-interakció / kifelé menő AI-tartalom → átláthatósági
 *  (Art. 50) · egyik sem → minimális. Csak JAVASLAT — az ember erősíti meg. */
export function suggestAiActCategory(
  answers: Partial<Record<AiActQuestion, boolean>>,
): AiActCategory {
  if (answers.prohibited) return "prohibited";
  if (answers.annex3) return "high_risk";
  if (answers.interacts) return "transparency";
  return "minimal";
}

/** Figyelmeztetés-köteles kategória (tiltott / nagy kockázatú). */
export function isAiActWarnCategory(category: AiActCategory | null): boolean {
  return category === "prohibited" || category === "high_risk";
}

/** Hőtérkép/kártya figyelmeztetés: a MEGERŐSÍTETT besorolás tiltott vagy
 *  nagy kockázatú. A javaslat önmagában nem jelöl (E1: az ember dönt) —
 *  a panelen viszont már a javaslat is figyelmeztet. */
export function aiActWarnFor(row: { ai_act: unknown }): boolean {
  return isAiActWarnCategory(parseAiAct(row.ai_act)?.confirmed_category ?? null);
}

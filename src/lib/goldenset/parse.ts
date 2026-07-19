// ─────────────────────────────────────────────────────────────
// P3 Golden set (#14) — defenzív LLM-parse (a #6-fix elvei: koerció,
// érvénytelen elem kihagyva, SOSEM dob). c-minta: az elvárt kimenet CSAK
// akkor kerül be, ha az LLM adott ÉS a típus formájában érvényes —
// egyébként üres („nincs megadva"), nem fabrikálunk.
// ─────────────────────────────────────────────────────────────

import { stripCodeFences } from "@/lib/llm/parse";
import { ANSWER_TYPES, VERDICTS, parseAnswerConfig, parseAnswerValue } from "./model";
import type { AnswerType, Verdict } from "@/lib/db/types";

function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

export interface EvalCaseProposal {
  input: string;
  answer_type: AnswerType;
  /** Normalizált típusfüggő konfiguráció (options / min-max-label). */
  answer_config: { options: string[] } | { min: number; max: number; label: string };
  /** 1-N kritérium — enélkül a javaslat kiesik (a pass/fail fő alapja). */
  criteria: string[];
  /** OPCIONÁLIS elvárt kimenet a típus formájában — null, ha nincs alap. */
  expected: unknown | null;
  source_indices: number[];
}

/** Teszteset-javaslatok parse-a. Választós típus legalább 2 opcióval érvényes. */
export function parseEvalCaseProposals(raw: string): EvalCaseProposal[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(raw));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const list = (parsed as Record<string, unknown>).cases;
  if (!Array.isArray(list)) return [];
  const out: EvalCaseProposal[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const input = str(o.input);
    const answerType = str(o.answer_type) as AnswerType;
    if (!input || !ANSWER_TYPES.includes(answerType)) continue;
    const criteria = (Array.isArray(o.criteria) ? o.criteria : []).map(str).filter(Boolean);
    if (criteria.length === 0) continue; // kritérium nélkül nincs pass/fail alap
    const cfg = parseAnswerConfig(o.answer_config);
    if ((answerType === "choice_single" || answerType === "choice_multi") && cfg.options.length < 2)
      continue;
    const config =
      answerType === "choice_single" || answerType === "choice_multi"
        ? { options: cfg.options }
        : answerType === "number_scale"
          ? { min: cfg.min, max: cfg.max, label: cfg.label }
          : { options: [] };
    // elvárt kimenet: CSAK érvényes típus-formában (c-minta — különben üres)
    const expected =
      o.expected !== undefined && parseAnswerValue(answerType, o.expected) !== null
        ? o.expected
        : null;
    const sourceIndices = (Array.isArray(o.source_indices) ? o.source_indices : [])
      .map((n) => (typeof n === "number" ? Math.trunc(n) : parseInt(str(n), 10)))
      .filter((n) => Number.isFinite(n) && n >= 1);
    out.push({
      input,
      answer_type: answerType,
      answer_config: config,
      criteria,
      expected,
      source_indices: [...new Set(sourceIndices)],
    });
  }
  return out;
}

export interface VerdictSuggestion {
  verdict: Verdict;
  /** Indok — a kritériumokra hivatkozva (AC3). */
  rationale: string;
  /** Kritériumonkénti OK/BUKOTT ([{ord, ok}]). */
  criteria: { ord: number; ok: boolean }[];
}

/** Besorolás-ajánlás parse-a; érvénytelen verdict → null (nincs ajánlás). */
export function parseVerdictSuggestion(raw: string): VerdictSuggestion | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  const verdict = str(o.verdict) as Verdict;
  if (!VERDICTS.includes(verdict)) return null;
  const criteria = (Array.isArray(o.criteria) ? o.criteria : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const c = item as Record<string, unknown>;
      const ord = typeof c.ord === "number" ? Math.trunc(c.ord) : parseInt(str(c.ord), 10);
      if (!Number.isFinite(ord) || ord < 1) return null;
      return { ord, ok: c.ok === true };
    })
    .filter((c): c is { ord: number; ok: boolean } => c !== null);
  return { verdict, rationale: str(o.rationale), criteria };
}

export interface ResidualRiskSuggestion {
  /** Szint (pl. alacsony/közepes/magas) — szabad szöveg, koercionálva. */
  level: string;
  text: string;
}

/** Maradék kockázat javaslat parse-a; üres szöveg → null (nincs javaslat). */
export function parseResidualRisk(raw: string): ResidualRiskSuggestion | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  const text = str(o.text);
  if (!text) return null;
  return { level: str(o.level), text };
}

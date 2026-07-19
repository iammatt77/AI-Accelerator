// ─────────────────────────────────────────────────────────────
// P3 Golden set (#14) — tiszta modell (nincs React/DB):
// válasz-típus konfiguráció + kimenet-értékek defenzív parse-a,
// levezetett eset-állapot, SZIGORÚ pass%-szabály (spec §7/1: megfelelt /
// ÖSSZES; a „részleges" és a „nem" egyaránt nem-teljesült, nincs
// partial-credit; nyers arány + egészre kerekített megjelenítés),
// approve-poka-yoke kiértékelő (kemény/felülírható ágak), riport-mező
// komponálás. A rendszer nem futtatja a megoldást — követi.
// ─────────────────────────────────────────────────────────────

import type { AnswerType, EvalCaseRow, EvalCriterionRow, GoldenSetRow, Verdict } from "@/lib/db/types";

export const ANSWER_TYPES: AnswerType[] = [
  "free_text",
  "choice_single",
  "choice_multi",
  "number_scale",
  "yes_no",
];

export const VERDICTS: Verdict[] = ["passed", "partial", "failed"];

// ── Típusfüggő konfiguráció ──────────────────────────────────

export interface AnswerConfig {
  /** choice_single / choice_multi opciói. */
  options: string[];
  /** number_scale határai. */
  min: number;
  max: number;
  /** number_scale kérdés-felirat (opcionális). */
  label: string;
}

const DEFAULT_CONFIG: AnswerConfig = { options: [], min: 0, max: 100, label: "" };

/** Defenzív parse — ismeretlen alak nem tör, üres alapokra esik. */
export function parseAnswerConfig(raw: unknown): AnswerConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_CONFIG };
  const o = raw as Record<string, unknown>;
  const options = Array.isArray(o.options)
    ? o.options.map((v) => (typeof v === "string" ? v.trim() : String(v ?? ""))).filter(Boolean)
    : [];
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const min = num(o.min, 0);
  const max = num(o.max, 100);
  return {
    options,
    min: Math.min(min, max),
    max: Math.max(min, max),
    label: typeof o.label === "string" ? o.label.trim() : "",
  };
}

// ── Kimenet-értékek (expected / actual jsonb) ────────────────
// Alak típusonként: free_text {text} · choice_single {choice} ·
// choice_multi {choices[]} · number_scale {value} · yes_no {value:bool}

export interface AnswerValue {
  text?: string;
  choice?: string;
  choices?: string[];
  value?: number | boolean;
}

/** Defenzív érték-parse; null = nincs értelmezhető kimenet. */
export function parseAnswerValue(type: AnswerType, raw: unknown): AnswerValue | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (type === "free_text") {
    const text = typeof o.text === "string" ? o.text : "";
    return text.trim() ? { text } : null;
  }
  if (type === "choice_single") {
    const choice = typeof o.choice === "string" ? o.choice.trim() : "";
    return choice ? { choice } : null;
  }
  if (type === "choice_multi") {
    const choices = Array.isArray(o.choices)
      ? o.choices.filter((c): c is string => typeof c === "string" && c.trim() !== "")
      : [];
    // az ÜRES kiválasztás is érvényes rögzítés (a megoldás nem adott címkét)
    return Array.isArray(o.choices) ? { choices } : null;
  }
  if (type === "number_scale") {
    return typeof o.value === "number" && Number.isFinite(o.value) ? { value: o.value } : null;
  }
  // yes_no
  return typeof o.value === "boolean" ? { value: o.value } : null;
}

/** Megjelenítés — a rögzített kimenet ember-olvasható formája. */
export function formatAnswerValue(type: AnswerType, raw: unknown): string | null {
  const v = parseAnswerValue(type, raw);
  if (v === null) return null;
  if (type === "free_text") return v.text ?? null;
  if (type === "choice_single") return v.choice ?? null;
  if (type === "choice_multi") return (v.choices ?? []).join(", ") || "—";
  if (type === "number_scale") return String(v.value);
  return v.value ? "igen" : "nem";
}

// ── Levezetett eset-állapot (nem tárolt) ─────────────────────

export type CaseStatus = "to_record" | "to_classify" | "classified";

export function caseStatus(c: EvalCaseRow): CaseStatus {
  if (c.final_verdict !== null) return "classified";
  if (parseAnswerValue(c.answer_type, c.actual_output) !== null) return "to_classify";
  return "to_record";
}

// ── SZIGORÚ pass% (spec §7/1 — lezárt döntés) ────────────────

export interface PassStats {
  total: number;
  classified: number;
  passed: number;
  partial: number;
  failed: number;
  /** Rögzítetlen VAGY besorolatlan esetek (a poka-yoke (a) ága). */
  open: number;
  /** Nyers arány: megfelelt / ÖSSZES (0, ha nincs eset). Nincs partial-credit. */
  rawRatio: number;
  /** Megjelenítéshez egészre kerekítve. */
  pct: number;
}

export function passStats(cases: EvalCaseRow[]): PassStats {
  const total = cases.length;
  const passed = cases.filter((c) => c.final_verdict === "passed").length;
  const partial = cases.filter((c) => c.final_verdict === "partial").length;
  const failed = cases.filter((c) => c.final_verdict === "failed").length;
  const classified = passed + partial + failed;
  const rawRatio = total === 0 ? 0 : passed / total;
  return {
    total,
    classified,
    passed,
    partial,
    failed,
    open: total - classified,
    rawRatio,
    pct: Math.round(rawRatio * 100),
  };
}

// ── Approve-poka-yoke (AC5) ──────────────────────────────────
// Kemény (felülírás sem old): nincs eset / nincs egyetlen besorolt eredmény.
// Felülírható (dokumentált override_note-tal): nyitott esetek · nincs küszöb ·
// pass% < küszöb. Az AI a küszöböt SOHA nem állítja.

export type ApproveBlock =
  | { ok: true; overridden: boolean }
  | { ok: false; hard: boolean; reason: "no_cases" | "no_results" | "open_cases" | "no_threshold" | "below_threshold" };

export function evaluateApprove(set: GoldenSetRow, cases: EvalCaseRow[]): ApproveBlock {
  const stats = passStats(cases);
  if (stats.total === 0) return { ok: false, hard: true, reason: "no_cases" };
  if (stats.classified === 0) return { ok: false, hard: true, reason: "no_results" };
  const override = set.threshold_override_note.trim() !== "";
  if (stats.open > 0) {
    return override ? { ok: true, overridden: true } : { ok: false, hard: false, reason: "open_cases" };
  }
  if (set.pass_threshold === null) {
    return override ? { ok: true, overridden: true } : { ok: false, hard: false, reason: "no_threshold" };
  }
  if (stats.pct < set.pass_threshold) {
    return override
      ? { ok: true, overridden: true }
      : { ok: false, hard: false, reason: "below_threshold" };
  }
  return { ok: true, overridden: false };
}

// ── Kritériumok (K1..) ───────────────────────────────────────

/** A kritériumok tárolt sorrendben; a felirat pozíció szerint K1..Kn (rés-mentes). */
export function orderedCriteria(caseId: string, criteria: EvalCriterionRow[]): EvalCriterionRow[] {
  return criteria
    .filter((k) => k.eval_case_id === caseId)
    .sort((a, b) => a.ord - b.ord || a.created_at.localeCompare(b.created_at));
}

/** Az AI kritériumonkénti OK/BUKOTT hivatkozása ([{ord, ok}]) — defenzív. */
export function parseAiCriteria(raw: unknown): { ord: number; ok: boolean }[] {
  if (!Array.isArray(raw)) return [];
  const out: { ord: number; ok: boolean }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const ord = typeof o.ord === "number" ? Math.trunc(o.ord) : parseInt(String(o.ord ?? ""), 10);
    if (!Number.isFinite(ord) || ord < 1) continue;
    out.push({ ord, ok: o.ok === true });
  }
  return out;
}

// ── Riport-mező komponálás (a tesztriport artifact fields-szinkronjához) ──

export interface FailedCaseLine {
  displayId: string;
  verdict: Verdict;
  note: string;
}

/** A bukott esetek (nem + részleges) sora a riporthoz — az AI-indoklás első
 *  mondatával, ha van (a végső ítélet emberi, az indok kontextus). */
export function failedCaseLines(cases: EvalCaseRow[]): FailedCaseLine[] {
  return cases
    .filter((c) => c.final_verdict === "failed" || c.final_verdict === "partial")
    .sort((a, b) => a.display_id.localeCompare(b.display_id))
    .map((c) => ({
      displayId: c.display_id,
      verdict: c.final_verdict as Verdict,
      note: (c.ai_rationale.split(/(?<=[.!?])\s/)[0] ?? "").slice(0, 160),
    }));
}

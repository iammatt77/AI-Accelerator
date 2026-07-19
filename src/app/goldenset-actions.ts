"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { suggestEvalCases, suggestVerdict, suggestResidualRisk } from "@/lib/llm";
import { loadNumberedSources, indicesToInputIds } from "@/lib/sources";
import { nextDisplayIds } from "@/lib/requirements/model";
import {
  ANSWER_TYPES,
  VERDICTS,
  failedCaseLines,
  formatAnswerValue,
  orderedCriteria,
  parseAnswerConfig,
  parseAnswerValue,
  passStats,
} from "@/lib/goldenset/model";
import { getTypeDef, parseArtifactFields, type ArtifactFields } from "@/lib/artifacts/config";
import type {
  AnswerType,
  ArtifactRow,
  EvalCaseRow,
  EvalCriterionRow,
  GoldenSetRow,
  UseCaseRow,
  Verdict,
} from "@/lib/db/types";
import type { FormState } from "./actions";

// ─────────────────────────────────────────────────────────────
// Golden set akciók (#14). E1 végig: az AI JAVASOL (eseteket, kritériumot,
// besorolást, maradék kockázatot), az EMBER szerkeszt/erősít meg/dönt.
// A rendszer a megoldást NEM futtatja — a tényleges kimenetet a tanácsadó
// rögzíti. A pass%-küszöböt KIZÁRÓLAG ember állítja. A Tesztriport a
// MEGLÉVŐ artifacts-lánc (Draft→In review→Approved) — itt csak a mezőit
// szinkronizáljuk; az approve-őr az artifact-actions-ben él.
// ─────────────────────────────────────────────────────────────

const TESZTRIPORT_TYPE = "Tesztriport";

interface SupabaseErrorLike {
  message?: string;
}

function errMessage(error: SupabaseErrorLike | null): string {
  return error?.message ?? "?";
}

function base(projectId: string): string {
  return `/project/${projectId}/goldenset`;
}

/** A P2 use case feloldása: selected előnyben, különben az első shortlist. */
async function resolveUseCase(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  projectId: string,
): Promise<UseCaseRow | null> {
  const { data } = await supabase
    .from("use_cases")
    .select("*")
    .eq("project_id", projectId)
    .in("list_status", ["selected", "shortlist"])
    .order("created_at", { ascending: true });
  const rows = ((data ?? []) as UseCaseRow[]).filter((u) => u.state !== "rejected");
  return rows.find((u) => u.list_status === "selected") ?? rows[0] ?? null;
}

/** A use case golden setje — get-or-create (1:1, unique index véd). */
async function ensureGoldenSet(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  projectId: string,
  useCaseId: string,
): Promise<GoldenSetRow | { error: string }> {
  const { data } = await supabase
    .from("golden_sets")
    .select("*")
    .eq("use_case_id", useCaseId)
    .maybeSingle();
  if (data) return data as GoldenSetRow;
  const { data: inserted, error } = await supabase
    .from("golden_sets")
    .insert({ project_id: projectId, use_case_id: useCaseId, phase: "P3" })
    .select("*")
    .single();
  if (error || !inserted) return { error: errMessage(error) };
  return inserted as GoldenSetRow;
}

// ── ✦ AC2: AI-javasolt golden set (E1, csak üres készletre) ──

export async function generateEvalCasesAction(
  projectId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("goldenset");
  const supabase = createServiceSupabaseClient();

  const useCase = await resolveUseCase(supabase, projectId);
  if (!useCase) return { ok: false, error: t("errNoUseCase") };
  const set = await ensureGoldenSet(supabase, projectId, useCase.id);
  if ("error" in set) return { ok: false, error: t("errSave", { message: set.error }) };

  const { data: existing } = await supabase
    .from("eval_cases")
    .select("id")
    .eq("golden_set_id", set.id)
    .limit(1);
  if ((existing ?? []).length > 0) return { ok: false, error: t("errAlreadyHasCases") };

  const loaded = await loadNumberedSources(supabase, projectId);
  if ("error" in loaded) return { ok: false, error: loaded.error };

  let proposals;
  try {
    proposals = await suggestEvalCases(loaded.sources, {
      title: useCase.title,
      description: useCase.description,
    });
  } catch (e) {
    return { ok: false, error: t("errLlm", { message: e instanceof Error ? e.message : "?" }) };
  }
  if (proposals.length === 0) return { ok: true, error: null, notice: t("noticeNoBasis") };

  const ids = nextDisplayIds([], "EC", proposals.length);
  for (const [i, p] of proposals.entries()) {
    const { data, error } = await supabase
      .from("eval_cases")
      .insert({
        golden_set_id: set.id,
        display_id: ids[i],
        input_text: p.input,
        answer_type: p.answer_type,
        answer_config: p.answer_config,
        expected_output: p.expected,
        source_input_ids: indicesToInputIds(p.source_indices, loaded.inputIds),
        state: "ai_suggested",
        ord: i,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
    const caseId = (data as { id: string }).id;
    for (const [j, text] of p.criteria.entries()) {
      const { error: critErr } = await supabase.from("eval_criteria").insert({
        eval_case_id: caseId,
        ord: j + 1,
        text,
        state: "ai_suggested",
      });
      if (critErr) return { ok: false, error: t("errSave", { message: errMessage(critErr) }) };
    }
  }
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

// ── Típusfüggő konfiguráció + érték az űrlapból ──────────────

function configFromForm(answerType: AnswerType, formData: FormData): Record<string, unknown> {
  if (answerType === "choice_single" || answerType === "choice_multi") {
    const options = String(formData.get("options") ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    return { options };
  }
  if (answerType === "number_scale") {
    const min = parseInt(String(formData.get("scale_min") ?? "0"), 10);
    const max = parseInt(String(formData.get("scale_max") ?? "100"), 10);
    return {
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) ? max : 100,
      label: String(formData.get("scale_label") ?? "").trim(),
    };
  }
  if (answerType === "yes_no") {
    const label = String(formData.get("scale_label") ?? "").trim();
    return label ? { label } : {};
  }
  return {};
}

/** Kimenet-érték az űrlapból a típus formájában; null = nincs megadva. */
function valueFromForm(
  answerType: AnswerType,
  formData: FormData,
  prefix: string,
): Record<string, unknown> | null {
  if (answerType === "free_text") {
    const text = String(formData.get(`${prefix}_text`) ?? "").trim();
    return text ? { text } : null;
  }
  if (answerType === "choice_single") {
    const choice = String(formData.get(`${prefix}_choice`) ?? "").trim();
    return choice ? { choice } : null;
  }
  if (answerType === "choice_multi") {
    if (String(formData.get(`${prefix}_multi_present`) ?? "") !== "1") return null;
    const choices = formData.getAll(`${prefix}_choices`).map((v) => String(v));
    return { choices };
  }
  if (answerType === "number_scale") {
    const raw = String(formData.get(`${prefix}_value`) ?? "").trim();
    if (raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? { value } : null;
  }
  const raw = String(formData.get(`${prefix}_bool`) ?? "");
  if (raw !== "yes" && raw !== "no") return null;
  return { value: raw === "yes" };
}

// ── Kézi eset-felvétel + szerkesztés (AC1/AC4) ───────────────

export async function addCaseAction(
  projectId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("goldenset");
  const supabase = createServiceSupabaseClient();

  const useCase = await resolveUseCase(supabase, projectId);
  if (!useCase) return { ok: false, error: t("errNoUseCase") };
  const set = await ensureGoldenSet(supabase, projectId, useCase.id);
  if ("error" in set) return { ok: false, error: t("errSave", { message: set.error }) };

  const inputText = String(formData.get("input_text") ?? "").trim();
  const answerType = String(formData.get("answer_type") ?? "") as AnswerType;
  if (!inputText) return { ok: false, error: t("errInputRequired") };
  if (!ANSWER_TYPES.includes(answerType)) return { ok: false, error: t("errTypeRequired") };
  const config = configFromForm(answerType, formData);
  if (
    (answerType === "choice_single" || answerType === "choice_multi") &&
    parseAnswerConfig(config).options.length < 2
  ) {
    return { ok: false, error: t("errNeedsOptions") };
  }

  const { data: existing } = await supabase
    .from("eval_cases")
    .select("display_id, ord")
    .eq("golden_set_id", set.id);
  const existingIds = ((existing ?? []) as { display_id: string }[]).map((r) => r.display_id);
  const maxOrd = Math.max(-1, ...((existing ?? []) as { ord: number }[]).map((r) => r.ord));
  const [displayId] = nextDisplayIds(existingIds, "EC", 1);

  // elvárt kimenet: OPCIONÁLIS (c-minta — üresen marad, ha nincs egyetlen jó válasz)
  const expected = valueFromForm(answerType, formData, "expected");

  const { data, error } = await supabase
    .from("eval_cases")
    .insert({
      golden_set_id: set.id,
      display_id: displayId,
      input_text: inputText,
      answer_type: answerType,
      answer_config: config,
      expected_output: expected,
      state: "manual",
      ord: maxOrd + 1,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: t("errSave", { message: errMessage(error) }) };

  const criteria = String(formData.get("criteria") ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const [j, text] of criteria.entries()) {
    await supabase.from("eval_criteria").insert({
      eval_case_id: (data as { id: string }).id,
      ord: j + 1,
      text,
      state: "manual",
    });
  }
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

/** Teszteset mentése (2. jelenet): a szerkesztés emberi kontroll —
 *  ai_suggested → confirmed. A rögzített tényleges kimenetet nem érinti. */
export async function updateCaseAction(
  projectId: string,
  caseId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("goldenset");
  const supabase = createServiceSupabaseClient();

  const inputText = String(formData.get("input_text") ?? "").trim();
  const answerType = String(formData.get("answer_type") ?? "") as AnswerType;
  if (!inputText) return { ok: false, error: t("errInputRequired") };
  if (!ANSWER_TYPES.includes(answerType)) return { ok: false, error: t("errTypeRequired") };
  const config = configFromForm(answerType, formData);
  if (
    (answerType === "choice_single" || answerType === "choice_multi") &&
    parseAnswerConfig(config).options.length < 2
  ) {
    return { ok: false, error: t("errNeedsOptions") };
  }
  const expected = valueFromForm(answerType, formData, "expected");

  const { data: cur } = await supabase
    .from("eval_cases")
    .select("state")
    .eq("id", caseId)
    .maybeSingle();
  if (!cur) return { ok: false, error: t("errCaseNotFound") };
  const state = (cur as { state: string }).state === "ai_suggested" ? "confirmed" : (cur as { state: string }).state;

  const { error } = await supabase
    .from("eval_cases")
    .update({
      input_text: inputText,
      answer_type: answerType,
      answer_config: config,
      expected_output: expected,
      state,
      updated_at: new Date().toISOString(),
    })
    .eq("id", caseId);
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

/** Elvetés: CSAK ai_suggested eset törölhető (E1). */
export async function rejectCaseAction(
  projectId: string,
  caseId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("goldenset");
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("eval_cases")
    .delete()
    .eq("id", caseId)
    .eq("state", "ai_suggested");
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

// ── Kritérium CRUD (a tanácsadó kontrollja — AC3 alap) ───────

export async function addCriterionAction(
  projectId: string,
  caseId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("goldenset");
  const supabase = createServiceSupabaseClient();
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return { ok: false, error: t("errCriterionRequired") };
  const { data: existing } = await supabase
    .from("eval_criteria")
    .select("ord")
    .eq("eval_case_id", caseId)
    .order("ord", { ascending: false })
    .limit(1);
  const nextOrd = (((existing ?? [])[0] as { ord: number } | undefined)?.ord ?? 0) + 1;
  const { error } = await supabase
    .from("eval_criteria")
    .insert({ eval_case_id: caseId, ord: nextOrd, text, state: "manual" });
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

export async function updateCriterionAction(
  projectId: string,
  criterionId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("goldenset");
  const supabase = createServiceSupabaseClient();
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return { ok: false, error: t("errCriterionRequired") };
  const { data: cur } = await supabase
    .from("eval_criteria")
    .select("state")
    .eq("id", criterionId)
    .maybeSingle();
  if (!cur) return { ok: false, error: t("errCriterionNotFound") };
  const state = (cur as { state: string }).state === "ai_suggested" ? "confirmed" : (cur as { state: string }).state;
  const { error } = await supabase
    .from("eval_criteria")
    .update({ text, state })
    .eq("id", criterionId);
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

export async function deleteCriterionAction(
  projectId: string,
  criterionId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("goldenset");
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase.from("eval_criteria").delete().eq("id", criterionId);
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

// ── AC1: dinamikus rögzítés + opcionális ✦ AI-besorolás ──────

async function runAiVerdict(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  c: EvalCaseRow,
  criteria: EvalCriterionRow[],
  actual: unknown,
): Promise<void> {
  const t = await getTranslations("goldenset");
  const ordered = orderedCriteria(c.id, criteria);
  const suggestion = await suggestVerdict({
    inputText: c.input_text,
    answerTypeLabel: t(`type.${c.answer_type}`),
    criteria: ordered.map((k) => k.text),
    actualFormatted: formatAnswerValue(c.answer_type, actual) ?? "",
    expectedFormatted: formatAnswerValue(c.answer_type, c.expected_output),
  });
  if (!suggestion) return;
  await supabase
    .from("eval_cases")
    .update({
      ai_verdict: suggestion.verdict,
      ai_rationale: suggestion.rationale,
      ai_criteria: suggestion.criteria,
      updated_at: new Date().toISOString(),
    })
    .eq("id", c.id);
}

/** A TÉNYLEGES kimenet rögzítése (a tanácsadó írja be — a rendszer nem
 *  futtat). with_ai=1 esetén ✦ besorolás-ajánlást is kér (E1 — a végső
 *  ítélet a besorolás-panelen emberi). */
export async function recordActualAction(
  projectId: string,
  caseId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("goldenset");
  const supabase = createServiceSupabaseClient();

  const { data } = await supabase.from("eval_cases").select("*").eq("id", caseId).maybeSingle();
  if (!data) return { ok: false, error: t("errCaseNotFound") };
  const c = data as EvalCaseRow;

  const actual = valueFromForm(c.answer_type, formData, "actual");
  if (actual === null || parseAnswerValue(c.answer_type, actual) === null) {
    return { ok: false, error: t("errActualRequired") };
  }

  const { error } = await supabase
    .from("eval_cases")
    .update({ actual_output: actual, updated_at: new Date().toISOString() })
    .eq("id", caseId);
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };

  if (String(formData.get("with_ai") ?? "") === "1") {
    const { data: critData } = await supabase
      .from("eval_criteria")
      .select("*")
      .eq("eval_case_id", caseId);
    try {
      await runAiVerdict(supabase, c, (critData ?? []) as EvalCriterionRow[], actual);
    } catch (e) {
      revalidatePath(base(projectId));
      return { ok: true, error: null, notice: t("noticeAiFailed", { message: e instanceof Error ? e.message : "?" }) };
    }
  }
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

/** ✦ Besorolás-ajánlás kérése egy már rögzített esetre (E1). */
export async function suggestVerdictAction(
  projectId: string,
  caseId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("goldenset");
  const supabase = createServiceSupabaseClient();
  const { data } = await supabase.from("eval_cases").select("*").eq("id", caseId).maybeSingle();
  if (!data) return { ok: false, error: t("errCaseNotFound") };
  const c = data as EvalCaseRow;
  if (parseAnswerValue(c.answer_type, c.actual_output) === null) {
    return { ok: false, error: t("errNotRecorded") };
  }
  const { data: critData } = await supabase
    .from("eval_criteria")
    .select("*")
    .eq("eval_case_id", caseId);
  try {
    await runAiVerdict(supabase, c, (critData ?? []) as EvalCriterionRow[], c.actual_output);
  } catch (e) {
    return { ok: false, error: t("errLlm", { message: e instanceof Error ? e.message : "?" }) };
  }
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

// ── AC3: a VÉGSŐ besorolás emberi (elfogadás vagy felülírás) ─

export async function classifyAction(
  projectId: string,
  caseId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("goldenset");
  const supabase = createServiceSupabaseClient();

  const verdict = String(formData.get("verdict") ?? "") as Verdict;
  if (!VERDICTS.includes(verdict)) return { ok: false, error: t("errVerdictRequired") };
  const by = String(formData.get("verdict_by") ?? "").trim() || t("defaultJudge");

  const { data } = await supabase.from("eval_cases").select("*").eq("id", caseId).maybeSingle();
  if (!data) return { ok: false, error: t("errCaseNotFound") };
  const c = data as EvalCaseRow;
  if (parseAnswerValue(c.answer_type, c.actual_output) === null) {
    return { ok: false, error: t("errNotRecorded") };
  }

  const { error } = await supabase
    .from("eval_cases")
    .update({
      final_verdict: verdict,
      verdict_by: by,
      verdict_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", caseId);
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

// ── AC5: küszöb (EMBERI — az AI soha nem állítja) + felülírás ─

export async function setThresholdAction(
  projectId: string,
  setId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("goldenset");
  const supabase = createServiceSupabaseClient();
  const raw = parseInt(String(formData.get("threshold") ?? ""), 10);
  if (!Number.isFinite(raw) || raw < 1 || raw > 100) {
    return { ok: false, error: t("errThresholdRange") };
  }
  const { error } = await supabase
    .from("golden_sets")
    .update({ pass_threshold: raw, updated_at: new Date().toISOString() })
    .eq("id", setId)
    .eq("project_id", projectId);
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

/** Dokumentált emberi felülírás (AC5 kivétel) — üres jegyzet = visszavonás. */
export async function setOverrideAction(
  projectId: string,
  setId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("goldenset");
  const supabase = createServiceSupabaseClient();
  const note = String(formData.get("note") ?? "").trim();
  const { error } = await supabase
    .from("golden_sets")
    .update({ threshold_override_note: note, updated_at: new Date().toISOString() })
    .eq("id", setId)
    .eq("project_id", projectId);
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

// ── AC6: Tesztriport mező-szinkron (a MEGLÉVŐ artifacts-láncra) ─

function syncField(fields: ArtifactFields, key: string, value: string): void {
  if (value.trim() === "") {
    fields[key] = { value: null, source_indices: [], state: "missing" };
  } else {
    fields[key] = {
      value,
      source_indices: fields[key]?.source_indices ?? [],
      state: "manual",
    };
  }
}

/** A mérésből számolt mezők írása a Tesztriport artifactba (draft/in_review);
 *  ha még nincs riport, első draft-verziót hoz létre. A maradek_kockazat
 *  mezőt NEM írja felül (az AI-javaslat + emberi megerősítés útján él). */
export async function syncReportAction(
  projectId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("goldenset");
  const supabase = createServiceSupabaseClient();

  const useCase = await resolveUseCase(supabase, projectId);
  if (!useCase) return { ok: false, error: t("errNoUseCase") };
  const { data: setData } = await supabase
    .from("golden_sets")
    .select("*")
    .eq("use_case_id", useCase.id)
    .maybeSingle();
  if (!setData) return { ok: false, error: t("errNoSet") };
  const set = setData as GoldenSetRow;
  const { data: caseData } = await supabase
    .from("eval_cases")
    .select("*")
    .eq("golden_set_id", set.id);
  const cases = (caseData ?? []) as EvalCaseRow[];
  const stats = passStats(cases);
  if (stats.total === 0) return { ok: false, error: t("errNoCasesToReport") };

  const typeDef = getTypeDef(TESZTRIPORT_TYPE);
  if (!typeDef) return { ok: false, error: t("errSave", { message: "typedef" }) };

  const tv = await getTranslations("goldenset");
  const failLines = failedCaseLines(cases)
    .map((f) => `${f.displayId} (${tv(`verdict.${f.verdict}`)}): ${f.note}`)
    .join("\n");
  const resultText = tv("fieldResultText", {
    total: stats.total,
    passed: stats.passed,
    partial: stats.partial,
    failed: stats.failed,
    open: stats.open,
    useCase: useCase.title,
  });
  const ratioText =
    `${stats.pct}% (${stats.passed}/${stats.total})` +
    (set.pass_threshold !== null ? ` · ${tv("fieldThreshold", { t: set.pass_threshold })}` : "");

  const { data: artData } = await supabase
    .from("artifacts")
    .select("*")
    .eq("project_id", projectId)
    .eq("type", TESZTRIPORT_TYPE)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const artifact = artData as ArtifactRow | null;

  if (artifact && artifact.status !== "approved") {
    const fields = parseArtifactFields(typeDef, artifact.fields);
    syncField(fields, "golden_set_eredmeny", resultText);
    syncField(fields, "atmenesi_arany", ratioText);
    syncField(fields, "hibak_javitasok", failLines);
    const { error } = await supabase
      .from("artifacts")
      .update({ fields, updated_at: new Date().toISOString() })
      .eq("id", artifact.id);
    if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  } else if (!artifact) {
    const fields = parseArtifactFields(typeDef, {});
    syncField(fields, "golden_set_eredmeny", resultText);
    syncField(fields, "atmenesi_arany", ratioText);
    syncField(fields, "hibak_javitasok", failLines);
    const { error } = await supabase.from("artifacts").insert({
      project_id: projectId,
      type: TESZTRIPORT_TYPE,
      version: 1,
      status: "draft",
      body: "",
      fields,
      source_input_ids: [],
    });
    if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  } else {
    return { ok: false, error: t("errReportApproved") };
  }

  revalidatePath(base(projectId));
  revalidatePath(`/project/${projectId}/documents`);
  return { ok: true, error: null };
}

/** ✦ Maradék kockázat javaslat (§7/3 — E1): ai_filled mezőként kerül a
 *  riportba — a MEGLÉVŐ szerkesztő-HITL (megerősítés/szerkesztés) zárja. */
export async function suggestResidualRiskAction(
  projectId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("goldenset");
  const supabase = createServiceSupabaseClient();

  const useCase = await resolveUseCase(supabase, projectId);
  if (!useCase) return { ok: false, error: t("errNoUseCase") };
  const { data: setData } = await supabase
    .from("golden_sets")
    .select("*")
    .eq("use_case_id", useCase.id)
    .maybeSingle();
  if (!setData) return { ok: false, error: t("errNoSet") };
  const set = setData as GoldenSetRow;
  const { data: caseData } = await supabase
    .from("eval_cases")
    .select("*")
    .eq("golden_set_id", set.id);
  const cases = (caseData ?? []) as EvalCaseRow[];
  const stats = passStats(cases);

  const { data: artData } = await supabase
    .from("artifacts")
    .select("*")
    .eq("project_id", projectId)
    .eq("type", TESZTRIPORT_TYPE)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const artifact = artData as ArtifactRow | null;
  if (!artifact || artifact.status === "approved") {
    return { ok: false, error: t("errSyncFirst") };
  }

  let suggestion;
  try {
    suggestion = await suggestResidualRisk(failedCaseLines(cases), {
      pct: stats.pct,
      threshold: set.pass_threshold,
    });
  } catch (e) {
    return { ok: false, error: t("errLlm", { message: e instanceof Error ? e.message : "?" }) };
  }
  if (!suggestion) return { ok: true, error: null, notice: t("noticeNoRisk") };

  const typeDef = getTypeDef(TESZTRIPORT_TYPE);
  const fields = typeDef ? parseArtifactFields(typeDef, artifact.fields) : ({} as ArtifactFields);
  fields.maradek_kockazat = {
    value: `${suggestion.level ? `[${suggestion.level}] ` : ""}${suggestion.text}`,
    source_indices: fields.maradek_kockazat?.source_indices ?? [],
    state: "ai_filled", // a meglévő editor-HITL erősíti meg
  };
  const { error } = await supabase
    .from("artifacts")
    .update({ fields, updated_at: new Date().toISOString() })
    .eq("id", artifact.id);
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

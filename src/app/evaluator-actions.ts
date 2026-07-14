"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import {
  AI_ACT_QUESTIONS,
  READINESS_DIMENSIONS,
  SUITABILITY_CRITERIA,
  isAiActWarnCategory,
  readinessLevel,
  suggestAiActCategory,
  type AiActAssessment,
  type AiActCategory,
  type AiSuitability,
  type DataReadiness,
  type ReadinessGrade,
  type SuitabilityAnswer,
} from "@/lib/entities/evaluators";
import type { FormState } from "./actions";

// ─────────────────────────────────────────────────────────────
// Értékelő-akciók (#7b): EMBERI űrlapok mentése a use_cases jsonb
// mezőibe — NINCS LLM-hívás. Csak megerősített (confirmed/manual)
// use case értékelhető; a #7a entitás-akciók érintetlenek.
// ─────────────────────────────────────────────────────────────

interface SupabaseErrorLike {
  message?: string;
}

function errMessage(error: SupabaseErrorLike | null): string {
  return error?.message ?? "?";
}

function revalidateWorkspace(projectId: string): void {
  revalidatePath(`/project/${projectId}`, "layout");
}

/** jsonb-mező mentése MEGERŐSÍTETT use case-en, optimista guardokkal. */
async function saveEvaluator(
  supabase: SupabaseClient,
  projectId: string,
  useCaseId: string,
  column: "ai_suitability" | "data_readiness" | "ai_act",
  value: AiSuitability | DataReadiness | AiActAssessment,
): Promise<{ error: string | null; notConfirmed?: boolean }> {
  const { data, error } = await supabase
    .from("use_cases")
    .update({ [column]: value, updated_at: new Date().toISOString() })
    .eq("id", useCaseId)
    .eq("project_id", projectId)
    .in("state", ["confirmed", "manual"])
    .select("id");
  if (error) return { error: errMessage(error) };
  if ((data ?? []).length === 0) return { error: null, notConfirmed: true };
  return { error: null };
}

function optionalNote(raw: FormDataEntryValue | null): string | null {
  const value = String(raw ?? "").trim();
  return value === "" ? null : value;
}

// ── 3a. AI-alkalmassági szűrő (kézikönyv 3.2) ────────────────

const SUITABILITY_ANSWER_SET = new Set(["yes", "partial", "no"]);

export async function saveAiSuitabilityAction(
  projectId: string,
  useCaseId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const nonce = Date.now();

  const criteria: AiSuitability["criteria"] = {};
  for (const key of SUITABILITY_CRITERIA) {
    const raw = String(formData.get(key) ?? "").trim();
    if (raw === "") continue; // megválaszolatlan kritérium kihagyható
    if (!SUITABILITY_ANSWER_SET.has(raw)) {
      return { ok: false, error: tErrors("evaluatorInvalid"), nonce };
    }
    criteria[key] = raw as SuitabilityAnswer;
  }
  const note = optionalNote(formData.get("note"));

  const supabase = createServiceSupabaseClient();
  const result = await saveEvaluator(supabase, projectId, useCaseId, "ai_suitability", {
    criteria,
    note,
  });
  if (result.error) {
    return { ok: false, error: tErrors("entitySaveFailed", { message: result.error }), nonce };
  }
  if (result.notConfirmed) {
    return { ok: false, error: tErrors("entityNotConfirmed"), nonce };
  }
  revalidateWorkspace(projectId);
  return { ok: true, error: null, nonce };
}

// ── 3b. Adatérettség mini-értékelő (láncszem-elv) ────────────

const READINESS_GRADE_SET = new Set(["weak", "partial", "strong"]);

export async function saveDataReadinessAction(
  projectId: string,
  useCaseId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const nonce = Date.now();

  const dimensions: DataReadiness["dimensions"] = {};
  for (const key of READINESS_DIMENSIONS) {
    const raw = String(formData.get(key) ?? "").trim();
    if (raw === "") continue;
    if (!READINESS_GRADE_SET.has(raw)) {
      return { ok: false, error: tErrors("evaluatorInvalid"), nonce };
    }
    dimensions[key] = raw as ReadinessGrade;
  }
  const note = optionalNote(formData.get("note"));
  const readiness: DataReadiness = { dimensions, note };
  // A spec tárolt alakja a levelt is tartalmazza; olvasáskor ÚJRA számoljuk
  // (a szabály a kód, nem a tárolt érték) — l. lib/entities/evaluators.
  const stored = { ...readiness, level: readinessLevel(readiness) };

  const supabase = createServiceSupabaseClient();
  const result = await saveEvaluator(
    supabase,
    projectId,
    useCaseId,
    "data_readiness",
    stored as DataReadiness,
  );
  if (result.error) {
    return { ok: false, error: tErrors("entitySaveFailed", { message: result.error }), nonce };
  }
  if (result.notConfirmed) {
    return { ok: false, error: tErrors("entityNotConfirmed"), nonce };
  }
  revalidateWorkspace(projectId);
  return { ok: true, error: null, nonce };
}

// ── 3c. AI Act gyorsbesoroló (kézikönyv 6.1–6.2, E1) ─────────

const AI_ACT_CATEGORY_SET = new Set(["prohibited", "high_risk", "transparency", "minimal"]);

export async function saveAiActAction(
  projectId: string,
  useCaseId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const nonce = Date.now();

  const answers: AiActAssessment["answers"] = {};
  for (const key of AI_ACT_QUESTIONS) {
    answers[key] = formData.get(key) === "on";
  }
  // A javaslat SZERVEROLDALON számítódik a válaszokból (a kliens-oldali
  // kijelzés csak tükör) — a tárolt suggested nem manipulálható.
  const suggested = suggestAiActCategory(answers);

  const confirmedRaw = String(formData.get("confirmedCategory") ?? "").trim();
  if (confirmedRaw !== "" && !AI_ACT_CATEGORY_SET.has(confirmedRaw)) {
    return { ok: false, error: tErrors("evaluatorInvalid"), nonce };
  }
  // E1: a megerősítés emberi aktus — üres = még nincs megerősítve.
  const confirmed_category = (confirmedRaw || null) as AiActCategory | null;

  const note = optionalNote(formData.get("note"));
  // Poka-yoke (spec F3): tiltott vagy nagy kockázatú JAVASLATNÁL (és
  // megerősítésnél) a megjegyzés KÖTELEZŐ — auto-kizárás viszont NINCS,
  // a döntés az emberé.
  if ((isAiActWarnCategory(suggested) || isAiActWarnCategory(confirmed_category)) && !note) {
    return {
      ok: false,
      error: tErrors("aiActNoteRequired"),
      values: { fieldValue: note ?? "" },
      nonce,
    };
  }

  const supabase = createServiceSupabaseClient();
  const result = await saveEvaluator(supabase, projectId, useCaseId, "ai_act", {
    answers,
    suggested,
    confirmed_category,
    note,
  });
  if (result.error) {
    return { ok: false, error: tErrors("entitySaveFailed", { message: result.error }), nonce };
  }
  if (result.notConfirmed) {
    return { ok: false, error: tErrors("entityNotConfirmed"), nonce };
  }
  revalidateWorkspace(projectId);
  return { ok: true, error: null, nonce };
}

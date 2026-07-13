"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import {
  deriveUseCases,
  extractPainPoints,
  type NumberedPainPoint,
} from "@/lib/llm";
import { indicesToInputIds, loadNumberedSources } from "@/lib/sources";
import type { PainPointRow, UseCaseRow } from "@/lib/db/types";
import type { FormState } from "./actions";

// ─────────────────────────────────────────────────────────────
// Entitás-akciók (Coding-csomag #7a): fájdalompont-kivonatolás →
// E1-megerősítés → use case-származtatás → pontozás + shortlist-státusz.
//
// E1 entitás-szinten: az AI ai_suggested javaslatot ír, MEGERŐSÍTETT
// (confirmed) állapotba csak emberi akció visz; a manual kézi felvétel
// emberi eredetű, megerősített-erősségű. Az elvetett (rejected) sor a
// listából eltűnik, de NEM törlődik (audit).
//
// Újrafuttatás-szabály (a #5a extract-merge elvének entitás-megfelelője):
// az újrafuttatás a korábbi ai_suggested javaslatokat LECSERÉLI (törli és
// újakat ír) — a confirmed/manual/rejected sorokhoz nem nyúl. Az emberi
// munka védett, a machine-javaslat efemer.
// ─────────────────────────────────────────────────────────────

interface SupabaseErrorLike {
  message?: string;
  code?: string;
}

function errMessage(error: SupabaseErrorLike | null): string {
  return error?.message ?? "?";
}

function revalidateWorkspace(projectId: string): void {
  revalidatePath(`/project/${projectId}`, "layout");
}

async function logDecision(
  supabase: SupabaseClient,
  projectId: string,
  kind: string,
  note: string,
): Promise<void> {
  await supabase.from("decisions").insert({ project_id: projectId, kind, note });
}

const SEVERITY_VALUES = new Set(["low", "medium", "high"]);

/** Űrlap-érték → severity/risk. Üres → null (nincs megadva); ismeretlen
 *  érték → "invalid" (látható hiba, nem néma null-ra írás — review-lelet:
 *  a manipulált/elavult űrlap ne törölje jelzés nélkül a meglévő adatot). */
function parseLevel(
  raw: FormDataEntryValue | null,
): "low" | "medium" | "high" | null | "invalid" {
  const value = String(raw ?? "").trim();
  if (value === "") return null;
  return SEVERITY_VALUES.has(value) ? (value as "low" | "medium" | "high") : "invalid";
}

// ── Fájdalompont: kivonatolás ────────────────────────────────

export async function extractPainPointsAction(
  projectId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const supabase = createServiceSupabaseClient();

  const loaded = await loadNumberedSources(supabase, projectId);
  if ("error" in loaded) {
    return { ok: false, error: tErrors("inputsFetchFailed") + `: ${loaded.error}` };
  }
  const { sources, inputIds } = loaded;
  if (sources.length === 0) {
    return { ok: false, error: tErrors("noInputForDraft") };
  }

  // ÉLŐ LLM-hívás az adapteren át (MOCK_LLM=1: determinisztikus fixture).
  let proposals;
  try {
    proposals = await extractPainPoints(sources);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`Fájdalompont-kivonatolás sikertelen: ${message}`);
    return { ok: false, error: tErrors("extractFailed", { message }) };
  }

  // Csere-szabály: a korábbi ai_suggested javaslatok lecserélődnek — a
  // confirmed/manual/rejected sorok érintetlenek (E1: emberi munka védett).
  // VESZTESÉGMENTES sorrend (review-lelet): előbb a régi javaslat-snapshot
  // felolvasása, majd az újak beszúrása, VÉGÜL a régiek törlése — ha az
  // insert hibázik, a korábbi javaslatok megmaradnak.
  const { data: oldRows, error: oldErr } = await supabase
    .from("pain_points")
    .select("id")
    .eq("project_id", projectId)
    .eq("state", "ai_suggested");
  if (oldErr) {
    return {
      ok: false,
      error: tErrors("entityFetchFailed", { message: errMessage(oldErr) }),
    };
  }
  const oldIds = ((oldRows ?? []) as { id: string }[]).map((r) => r.id);

  if (proposals.length > 0) {
    const rows = proposals.map((p) => ({
      project_id: projectId,
      title: p.title,
      description: p.description,
      quote: p.quote,
      severity: p.severity,
      source_input_ids: indicesToInputIds(p.source_indices, inputIds),
      state: "ai_suggested",
    }));
    const { error: insertErr } = await supabase.from("pain_points").insert(rows);
    if (insertErr) {
      return {
        ok: false,
        error: tErrors("entitySaveFailed", { message: errMessage(insertErr) }),
      };
    }
  }

  if (oldIds.length > 0) {
    const { error: deleteErr } = await supabase
      .from("pain_points")
      .delete()
      .eq("project_id", projectId)
      .eq("state", "ai_suggested") // guard: közben megerősített sort nem töröl
      .in("id", oldIds);
    if (deleteErr) {
      return {
        ok: false,
        error: tErrors("entitySaveFailed", { message: errMessage(deleteErr) }),
      };
    }
  }

  await logDecision(
    supabase,
    projectId,
    "extract_pain_points",
    `Fájdalompont-kivonatolás: ${proposals.length} javaslat ${sources.length} forrásból.`,
  );
  revalidateWorkspace(projectId);
  // A 0-javaslat LÁTHATÓ jelzést kap (a hibajavítás notice-mintája) —
  // nem néma üres siker.
  if (proposals.length === 0) {
    return { ok: true, error: null, notice: tErrors("painExtractNoResult") };
  }
  return { ok: true, error: null };
}

// ── Fájdalompont: E1-akciók (megerősít / szerkeszt / elvet / kézi) ──

async function loadOwnedPainPoint(
  supabase: SupabaseClient,
  projectId: string,
  painPointId: string,
): Promise<{ row: PainPointRow } | { error: string }> {
  const tErrors = await getTranslations("errors");
  const { data, error } = await supabase
    .from("pain_points")
    .select("*")
    .eq("id", painPointId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error || !data) {
    return { error: tErrors("entityFetchFailed", { message: errMessage(error) }) };
  }
  return { row: data as PainPointRow };
}

export async function confirmPainPointAction(
  projectId: string,
  painPointId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const supabase = createServiceSupabaseClient();

  // E1: megerősíteni csak AI-javaslatot lehet — optimista guard a state-re.
  const { data, error } = await supabase
    .from("pain_points")
    .update({ state: "confirmed" })
    .eq("id", painPointId)
    .eq("project_id", projectId)
    .eq("state", "ai_suggested")
    .select("id");
  if (error) {
    return { ok: false, error: tErrors("entitySaveFailed", { message: errMessage(error) }) };
  }
  if ((data ?? []).length === 0) {
    return { ok: false, error: tErrors("entityNotSuggested") };
  }
  revalidateWorkspace(projectId);
  return { ok: true, error: null };
}

export async function editPainPointAction(
  projectId: string,
  painPointId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const severity = parseLevel(formData.get("severity"));
  const nonce = Date.now();
  // Hibaágon a beírt tartalom visszaáll (FormState-minta): a cím a title,
  // a leírás a fieldValue kulcson utazik vissza az űrlapba.
  const values = { title, fieldValue: description };
  if (!title) {
    return { ok: false, error: tErrors("entityTitleRequired"), values, nonce };
  }
  if (severity === "invalid") {
    return { ok: false, error: tErrors("levelInvalid"), values, nonce };
  }

  const supabase = createServiceSupabaseClient();
  const loaded = await loadOwnedPainPoint(supabase, projectId, painPointId);
  if ("error" in loaded) return { ok: false, error: loaded.error, values, nonce };
  const { row } = loaded;
  if (row.state === "rejected") {
    return { ok: false, error: tErrors("entityNotEditable"), values, nonce };
  }

  // Szerkesztés = emberi aktus: az AI-javaslat confirmed-be lép; a már
  // emberi (confirmed/manual) sor állapota nem változik.
  const nextState = row.state === "ai_suggested" ? "confirmed" : row.state;
  const { data, error } = await supabase
    .from("pain_points")
    .update({ title, description: description || null, severity, state: nextState })
    .eq("id", painPointId)
    .eq("project_id", projectId)
    .eq("state", row.state) // optimista guard: közben nem mozdult el
    .select("id");
  if (error || (data ?? []).length === 0) {
    return {
      ok: false,
      error: error
        ? tErrors("entitySaveFailed", { message: errMessage(error) })
        : tErrors("entityNotEditable"),
      values,
      nonce,
    };
  }
  revalidateWorkspace(projectId);
  return { ok: true, error: null, nonce };
}

export async function rejectPainPointAction(
  projectId: string,
  painPointId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const supabase = createServiceSupabaseClient();

  // Elvetés bármely nem-rejected állapotból (a tévedés visszavonható emberi
  // döntéssel) — a sor NEM törlődik, csak eltűnik a listából.
  const { data, error } = await supabase
    .from("pain_points")
    .update({ state: "rejected" })
    .eq("id", painPointId)
    .eq("project_id", projectId)
    .neq("state", "rejected")
    .select("id");
  if (error) {
    return { ok: false, error: tErrors("entitySaveFailed", { message: errMessage(error) }) };
  }
  if ((data ?? []).length === 0) {
    return { ok: false, error: tErrors("entityNotEditable") };
  }
  revalidateWorkspace(projectId);
  return { ok: true, error: null };
}

export async function addPainPointAction(
  projectId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const severity = parseLevel(formData.get("severity"));
  const nonce = Date.now();
  const values = { title, fieldValue: description };
  if (!title) {
    return { ok: false, error: tErrors("entityTitleRequired"), values, nonce };
  }
  if (severity === "invalid") {
    return { ok: false, error: tErrors("levelInvalid"), values, nonce };
  }

  const supabase = createServiceSupabaseClient();
  const { error } = await supabase.from("pain_points").insert({
    project_id: projectId,
    title,
    description: description || null,
    severity,
    state: "manual", // kézi felvétel = emberi eredet (E1)
  });
  if (error) {
    return {
      ok: false,
      error: tErrors("entitySaveFailed", { message: errMessage(error) }),
      values,
      nonce,
    };
  }
  revalidateWorkspace(projectId);
  return { ok: true, error: null, nonce };
}

// ── Use case: származtatás a megerősített fájdalompontokból ──

export async function deriveUseCasesAction(
  projectId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const supabase = createServiceSupabaseClient();

  // Bemenet: KIZÁRÓLAG az emberi kontrollon átment (confirmed/manual)
  // fájdalompontok — ai_suggested/rejected sohasem kerül a modell elé.
  const { data: painData, error: painErr } = await supabase
    .from("pain_points")
    .select("*")
    .eq("project_id", projectId)
    .in("state", ["confirmed", "manual"])
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (painErr) {
    return { ok: false, error: tErrors("entityFetchFailed", { message: errMessage(painErr) }) };
  }
  const pains = (painData ?? []) as PainPointRow[];
  if (pains.length === 0) {
    // Nem hiba: látható jelzés, hogy előbb megerősített fájdalompont kell.
    return { ok: true, error: null, notice: tErrors("needConfirmedPain") };
  }

  const loaded = await loadNumberedSources(supabase, projectId);
  if ("error" in loaded) {
    return { ok: false, error: tErrors("inputsFetchFailed") + `: ${loaded.error}` };
  }
  const { sources, inputIds } = loaded;

  const numbered: NumberedPainPoint[] = pains.map((p, i) => ({
    index: i + 1,
    title: p.title,
    description: p.description,
    quote: p.quote,
  }));

  // ÉLŐ LLM-hívás az adapteren át (MOCK_LLM=1: determinisztikus fixture).
  let proposals;
  try {
    proposals = await deriveUseCases(numbered, sources);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`Use case-származtatás sikertelen: ${message}`);
    return { ok: false, error: tErrors("deriveFailed", { message }) };
  }

  // Csere-szabály: a korábbi ai_suggested use case-ek lecserélődnek —
  // veszteségmentes sorrendben (snapshot → insert → régi törlése), mint a
  // fájdalompont-kivonatolásnál.
  const { data: oldRows, error: oldErr } = await supabase
    .from("use_cases")
    .select("id")
    .eq("project_id", projectId)
    .eq("state", "ai_suggested");
  if (oldErr) {
    return {
      ok: false,
      error: tErrors("entityFetchFailed", { message: errMessage(oldErr) }),
    };
  }
  const oldIds = ((oldRows ?? []) as { id: string }[]).map((r) => r.id);

  if (proposals.length > 0) {
    const rows = proposals.map((p) => ({
      project_id: projectId,
      title: p.title,
      description: p.description,
      // A ref-ek a modellnek átadott (1-alapú) listára mutatnak — itt
      // fordulnak vissza entitás-id-vá (a lánc: use case ← fájdalompont).
      pain_point_ids: p.pain_point_refs
        .map((r) => pains[r - 1]?.id)
        .filter((id): id is string => typeof id === "string"),
      source_input_ids: indicesToInputIds(p.source_indices, inputIds),
      state: "ai_suggested",
    }));
    const { error: insertErr } = await supabase.from("use_cases").insert(rows);
    if (insertErr) {
      return {
        ok: false,
        error: tErrors("entitySaveFailed", { message: errMessage(insertErr) }),
      };
    }
  }

  if (oldIds.length > 0) {
    const { error: deleteErr } = await supabase
      .from("use_cases")
      .delete()
      .eq("project_id", projectId)
      .eq("state", "ai_suggested") // guard: közben megerősített sort nem töröl
      .in("id", oldIds);
    if (deleteErr) {
      return {
        ok: false,
        error: tErrors("entitySaveFailed", { message: errMessage(deleteErr) }),
      };
    }
  }

  await logDecision(
    supabase,
    projectId,
    "derive_use_cases",
    `Use case-származtatás: ${proposals.length} javaslat ${pains.length} megerősített fájdalompontból.`,
  );
  revalidateWorkspace(projectId);
  if (proposals.length === 0) {
    return { ok: true, error: null, notice: tErrors("useCaseDeriveNoResult") };
  }
  return { ok: true, error: null };
}

// ── Use case: E1-akciók ──────────────────────────────────────

async function loadOwnedUseCase(
  supabase: SupabaseClient,
  projectId: string,
  useCaseId: string,
): Promise<{ row: UseCaseRow } | { error: string }> {
  const tErrors = await getTranslations("errors");
  const { data, error } = await supabase
    .from("use_cases")
    .select("*")
    .eq("id", useCaseId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error || !data) {
    return { error: tErrors("entityFetchFailed", { message: errMessage(error) }) };
  }
  return { row: data as UseCaseRow };
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function confirmUseCaseAction(
  projectId: string,
  useCaseId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("use_cases")
    .update({ state: "confirmed", updated_at: nowIso() })
    .eq("id", useCaseId)
    .eq("project_id", projectId)
    .eq("state", "ai_suggested")
    .select("id");
  if (error) {
    return { ok: false, error: tErrors("entitySaveFailed", { message: errMessage(error) }) };
  }
  if ((data ?? []).length === 0) {
    return { ok: false, error: tErrors("entityNotSuggested") };
  }
  revalidateWorkspace(projectId);
  return { ok: true, error: null };
}

export async function editUseCaseAction(
  projectId: string,
  useCaseId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const nonce = Date.now();
  const values = { title, fieldValue: description };
  if (!title) {
    return { ok: false, error: tErrors("entityTitleRequired"), values, nonce };
  }

  const supabase = createServiceSupabaseClient();
  const loaded = await loadOwnedUseCase(supabase, projectId, useCaseId);
  if ("error" in loaded) return { ok: false, error: loaded.error, values, nonce };
  const { row } = loaded;
  if (row.state === "rejected") {
    return { ok: false, error: tErrors("entityNotEditable"), values, nonce };
  }

  const nextState = row.state === "ai_suggested" ? "confirmed" : row.state;
  const { data, error } = await supabase
    .from("use_cases")
    .update({
      title,
      description: description || null,
      state: nextState,
      updated_at: nowIso(),
    })
    .eq("id", useCaseId)
    .eq("project_id", projectId)
    .eq("state", row.state) // optimista guard
    .select("id");
  if (error || (data ?? []).length === 0) {
    return {
      ok: false,
      error: error
        ? tErrors("entitySaveFailed", { message: errMessage(error) })
        : tErrors("entityNotEditable"),
      values,
      nonce,
    };
  }
  revalidateWorkspace(projectId);
  return { ok: true, error: null, nonce };
}

export async function rejectUseCaseAction(
  projectId: string,
  useCaseId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("use_cases")
    .update({ state: "rejected", updated_at: nowIso() })
    .eq("id", useCaseId)
    .eq("project_id", projectId)
    .neq("state", "rejected")
    .select("id");
  if (error) {
    return { ok: false, error: tErrors("entitySaveFailed", { message: errMessage(error) }) };
  }
  if ((data ?? []).length === 0) {
    return { ok: false, error: tErrors("entityNotEditable") };
  }
  revalidateWorkspace(projectId);
  return { ok: true, error: null };
}

export async function addUseCaseAction(
  projectId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  // UUID-alakra szűrés: a tamperelt form-érték ne nyers Postgres-hibát
  // adjon (invalid input syntax for type uuid), hanem csendben kiessen —
  // a valós kiválasztást a lenti projekt+state lekérdezés validálja.
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const selectedPainIds = formData
    .getAll("painPointIds")
    .map((v) => String(v))
    .filter((v) => UUID_RE.test(v));
  const nonce = Date.now();
  const values = { title, fieldValue: description };
  if (!title) {
    return { ok: false, error: tErrors("entityTitleRequired"), values, nonce };
  }

  const supabase = createServiceSupabaseClient();

  // A kézi use case is csak LÉTEZŐ, emberi kontrollon átment fájdalompontra
  // hivatkozhat — a kiválasztott id-k validálása a projekt entitásain.
  let painPointIds: string[] = [];
  if (selectedPainIds.length > 0) {
    const { data, error } = await supabase
      .from("pain_points")
      .select("id")
      .eq("project_id", projectId)
      .in("state", ["confirmed", "manual"])
      .in("id", selectedPainIds);
    if (error) {
      return {
        ok: false,
        error: tErrors("entityFetchFailed", { message: errMessage(error) }),
        values,
        nonce,
      };
    }
    painPointIds = ((data ?? []) as { id: string }[]).map((r) => r.id);
  }

  const { error } = await supabase.from("use_cases").insert({
    project_id: projectId,
    title,
    description: description || null,
    pain_point_ids: painPointIds,
    state: "manual", // kézi felvétel = emberi eredet (E1)
  });
  if (error) {
    return {
      ok: false,
      error: tErrors("entitySaveFailed", { message: errMessage(error) }),
      values,
      nonce,
    };
  }
  revalidateWorkspace(projectId);
  return { ok: true, error: null, nonce };
}

// ── Use case: pontozás + quick win ───────────────────────────

export async function scoreUseCaseAction(
  projectId: string,
  useCaseId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");

  const parseScore = (raw: FormDataEntryValue | null): number | null | "invalid" => {
    const value = String(raw ?? "").trim();
    if (value === "") return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 5) return "invalid";
    return n;
  };
  const scoreValue = parseScore(formData.get("scoreValue"));
  const scoreFeasibility = parseScore(formData.get("scoreFeasibility"));
  if (scoreValue === "invalid" || scoreFeasibility === "invalid") {
    return { ok: false, error: tErrors("scoreInvalid") };
  }
  const risk = parseLevel(formData.get("risk"));
  if (risk === "invalid") {
    return { ok: false, error: tErrors("levelInvalid") };
  }
  const quickWin = formData.get("quickWin") === "on";

  const supabase = createServiceSupabaseClient();
  // Pontozni csak emberi kontrollon átment (confirmed/manual) use case-t
  // lehet — az ai_suggested előbb megerősítendő (E1).
  const { data, error } = await supabase
    .from("use_cases")
    .update({
      score_value: scoreValue,
      score_feasibility: scoreFeasibility,
      risk,
      quick_win: quickWin,
      updated_at: nowIso(),
    })
    .eq("id", useCaseId)
    .eq("project_id", projectId)
    .in("state", ["confirmed", "manual"])
    .select("id");
  if (error) {
    return { ok: false, error: tErrors("entitySaveFailed", { message: errMessage(error) }) };
  }
  if ((data ?? []).length === 0) {
    return { ok: false, error: tErrors("entityNotConfirmed") };
  }
  revalidateWorkspace(projectId);
  return { ok: true, error: null };
}

// ── Use case: shortlist-státusz (jelölt → shortlist / kizárt) ─

export async function shortlistUseCaseAction(
  projectId: string,
  useCaseId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const supabase = createServiceSupabaseClient();

  const loaded = await loadOwnedUseCase(supabase, projectId, useCaseId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { row } = loaded;

  const { data, error } = await supabase
    .from("use_cases")
    .update({ list_status: "shortlist", exclusion_reason: null, updated_at: nowIso() })
    .eq("id", useCaseId)
    .eq("project_id", projectId)
    .in("state", ["confirmed", "manual"]) // csak megerősített kerülhet listára
    .select("id");
  if (error) {
    return { ok: false, error: tErrors("entitySaveFailed", { message: errMessage(error) }) };
  }
  if ((data ?? []).length === 0) {
    return { ok: false, error: tErrors("entityNotConfirmed") };
  }

  await logDecision(
    supabase,
    projectId,
    "use_case_status",
    `Use case shortlistre: „${row.title}” (${row.list_status} → shortlist).`,
  );
  revalidateWorkspace(projectId);
  return { ok: true, error: null };
}

export async function excludeUseCaseAction(
  projectId: string,
  useCaseId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const reason = String(formData.get("reason") ?? "").trim();
  const nonce = Date.now();
  // Poka-yoke: a kizárás indoklás nélkül nem menthető.
  if (!reason) {
    return { ok: false, error: tErrors("exclusionReasonRequired"), nonce };
  }

  const supabase = createServiceSupabaseClient();
  const loaded = await loadOwnedUseCase(supabase, projectId, useCaseId);
  if ("error" in loaded) {
    return { ok: false, error: loaded.error, values: { reason }, nonce };
  }
  const { row } = loaded;

  const { data, error } = await supabase
    .from("use_cases")
    .update({ list_status: "excluded", exclusion_reason: reason, updated_at: nowIso() })
    .eq("id", useCaseId)
    .eq("project_id", projectId)
    .in("state", ["confirmed", "manual"])
    .select("id");
  if (error) {
    return {
      ok: false,
      error: tErrors("entitySaveFailed", { message: errMessage(error) }),
      values: { reason },
      nonce,
    };
  }
  if ((data ?? []).length === 0) {
    return { ok: false, error: tErrors("entityNotConfirmed"), values: { reason }, nonce };
  }

  await logDecision(
    supabase,
    projectId,
    "use_case_status",
    `Use case kizárva: „${row.title}” — ${reason}`,
  );
  revalidateWorkspace(projectId);
  return { ok: true, error: null, nonce };
}

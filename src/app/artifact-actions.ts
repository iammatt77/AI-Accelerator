"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { extract, generateBody, type LlmSource } from "@/lib/llm";
import {
  EMPTY_FIELD,
  getTypeDef,
  missingRequiredFields,
  parseArtifactFields,
  type ArtifactFields,
  type ArtifactTypeDef,
} from "@/lib/artifacts/config";
import { isPhaseId } from "@/lib/phases/config";
import type { ArtifactRow, InputItemRow } from "@/lib/db/types";
import type { FormState } from "./actions";

// ─────────────────────────────────────────────────────────────
// Artefaktum-akciók (Coding-csomag #5a): kivonatolás → mező-megerősítés
// (E1: az AI javasol, az ember erősít meg) → sablon-vezérelt generálás.
// Minden action FormState-mintás — hiba a felületen látható, nem 500.
// ─────────────────────────────────────────────────────────────

interface SupabaseErrorLike {
  message?: string;
  code?: string;
}

function errMessage(error: SupabaseErrorLike | null): string {
  return error?.message ?? "?";
}

/** A projekt bemenetei stabil sorrendben (created_at, majd id) — ez adja a
 *  forrás-SZÁMOZÁST (1..n). A source_input_ids az artefaktumon PONTOSAN ezt
 *  a sorrendet rögzíti, így a [n] hivatkozás később is ugyanarra mutat. */
async function loadNumberedSources(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{ sources: LlmSource[]; inputIds: string[] } | { error: string }> {
  const { data, error } = await supabase
    .from("input_items")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) return { error: errMessage(error) };
  const rows = (data ?? []) as InputItemRow[];
  return {
    sources: rows.map((row, i) => ({
      index: i + 1,
      title: row.type,
      text: row.raw_text,
    })),
    inputIds: rows.map((row) => row.id),
  };
}

/** A típus legfrissebb verziója (bármely státusz). */
async function loadLatestArtifact(
  supabase: SupabaseClient,
  projectId: string,
  typeKey: string,
): Promise<ArtifactRow | null> {
  const { data } = await supabase
    .from("artifacts")
    .select("*")
    .eq("project_id", projectId)
    .eq("type", typeKey)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ArtifactRow | null) ?? null;
}

async function logDecision(
  supabase: SupabaseClient,
  projectId: string,
  kind: string,
  note: string,
): Promise<void> {
  await supabase.from("decisions").insert({ project_id: projectId, kind, note });
}

function revalidateWorkspace(projectId: string): void {
  // A pilótafülke, a fázis-oldalak és a szerkesztő is a projekt-fa alatt él.
  revalidatePath(`/project/${projectId}`, "layout");
}

// ── ① Bemenet: hozzáadás fázis-címkével ──────────────────────
// (az addInput a #1-ből él tovább az actions.ts-ben; itt a fázis-címkés
// változat, a munkaterület ① zónája ezt használja)

export async function addPhaseInput(
  projectId: string,
  phase: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const rawText = String(formData.get("rawText") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const nonce = Date.now();
  if (!rawText) {
    return { ok: false, error: tErrors("emptyInput"), nonce };
  }
  if (!isPhaseId(phase)) {
    return { ok: false, error: tErrors("phaseActionFailed", { message: phase }), nonce };
  }

  const supabase = createServiceSupabaseClient();
  const { error } = await supabase.from("input_items").insert({
    project_id: projectId,
    type: title || "raw",
    raw_text: rawText,
    phase,
  });
  if (error) {
    return {
      ok: false,
      error: tErrors("inputSaveFailed") + `: ${errMessage(error)}`,
      values: { rawText, title },
      nonce,
    };
  }

  await logDecision(
    supabase,
    projectId,
    "add_input",
    `Nyers bemenet hozzáadva a(z) ${phase} fázishoz (${rawText.length} karakter).`,
  );
  revalidateWorkspace(projectId);
  return { ok: true, error: null, nonce };
}

// ── ② Kivonatolás: extract → ai_filled mezőjavaslatok ────────
// Draft artefaktum jön létre, ha még nincs; a megerősített/kézi mezőket
// az újrafuttatás NEM írja felül (E1: az emberi munka védett).

export async function extractAction(
  projectId: string,
  typeKey: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const typeDef = getTypeDef(typeKey);
  if (!typeDef) {
    return { ok: false, error: tErrors("typeNotFound", { type: typeKey }) };
  }

  const supabase = createServiceSupabaseClient();

  const loaded = await loadNumberedSources(supabase, projectId);
  if ("error" in loaded) {
    return {
      ok: false,
      error: tErrors("inputsFetchFailed") + `: ${loaded.error}`,
    };
  }
  const { sources, inputIds } = loaded;
  if (sources.length === 0) {
    return { ok: false, error: tErrors("noInputForDraft") };
  }

  const latest = await loadLatestArtifact(supabase, projectId, typeKey);
  if (latest && latest.status !== "draft") {
    return { ok: false, error: tErrors("artifactNotDraft") };
  }

  // ÉLŐ LLM-hívás az adapteren át (MOCK_LLM=1: determinisztikus fixture).
  let extracted;
  try {
    extracted = await extract(sources, typeDef);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`Kivonatolás sikertelen: ${message}`);
    return { ok: false, error: tErrors("extractFailed", { message }) };
  }

  // Merge: confirmed/manual mező NEM íródik felül; ai_filled/missing frissül.
  const current: ArtifactFields = parseArtifactFields(typeDef, latest?.fields ?? {});
  const merged: ArtifactFields = {};
  for (const fieldDef of typeDef.fields) {
    const existing = current[fieldDef.key] ?? { ...EMPTY_FIELD };
    if (existing.state === "confirmed" || existing.state === "manual") {
      merged[fieldDef.key] = existing;
      continue;
    }
    const proposal = extracted[fieldDef.key];
    merged[fieldDef.key] = proposal
      ? {
          value: proposal.value,
          source_indices: proposal.source_indices,
          state: "ai_filled",
        }
      : { ...EMPTY_FIELD };
  }

  if (latest) {
    const { data, error } = await supabase
      .from("artifacts")
      .update({
        fields: merged,
        source_input_ids: inputIds,
        updated_at: new Date().toISOString(),
      })
      .eq("id", latest.id)
      .eq("status", "draft") // optimista guard: közben nem mozdult el
      .select("id");
    if (error || (data ?? []).length === 0) {
      return {
        ok: false,
        error: error
          ? tErrors("artifactSaveFailed", { message: errMessage(error) })
          : tErrors("artifactNotDraft"),
      };
    }
  } else {
    const created = await insertNewArtifact(supabase, projectId, typeDef, {
      fields: merged,
      source_input_ids: inputIds,
    });
    if (created.error) return { ok: false, error: created.error };
  }

  const proposals = Object.values(extracted).filter(Boolean).length;
  await logDecision(
    supabase,
    projectId,
    "extract",
    `${typeKey} kivonatolás: ${proposals} mezőjavaslat ${sources.length} forrásból.`,
  );
  revalidateWorkspace(projectId);
  // UX-megkülönböztetés: a „feldolgozva, de EGYETLEN mezőhöz sem született
  // használható javaslat" eset LÁTHATÓ jelzést kap — nem néma üres siker.
  // (A „részben talált" a normál eset: néhány mező jogosan missing.)
  if (proposals === 0) {
    return { ok: true, error: null, notice: tErrors("extractNoResult") };
  }
  return { ok: true, error: null };
}

/** Új (első) draft-verzió beszúrása. A verziószámot kliens-oldalon számítjuk
 *  (max+1), de az uq_artifacts_project_type_version unique index véd: ütköző
 *  párhuzamos insert graceful hibát kap, nem duplikál. */
async function insertNewArtifact(
  supabase: SupabaseClient,
  projectId: string,
  typeDef: ArtifactTypeDef,
  extra: { fields: ArtifactFields; source_input_ids: string[] },
): Promise<{ error: string | null }> {
  const tErrors = await getTranslations("errors");
  const { data } = await supabase
    .from("artifacts")
    .select("version")
    .eq("project_id", projectId)
    .eq("type", typeDef.key)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = ((data as { version?: number } | null)?.version ?? 0) + 1;

  const { error } = await supabase.from("artifacts").insert({
    project_id: projectId,
    type: typeDef.key,
    version: nextVersion,
    status: "draft",
    body: "",
    fields: extra.fields,
    source_input_ids: extra.source_input_ids,
  });
  if (error) {
    if (error.code === "23505") {
      return { error: tErrors("versionConflict") };
    }
    return { error: tErrors("artifactSaveFailed", { message: errMessage(error) }) };
  }
  return { error: null };
}

// ── ② Mező-megerősítés / szerkesztés / elvetés (E1) ──────────

type FieldOp = "confirm" | "edit" | "dismiss";

async function updateField(
  projectId: string,
  artifactId: string,
  fieldKey: string,
  op: FieldOp,
  newValue?: string,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const supabase = createServiceSupabaseClient();

  const { data, error: fetchErr } = await supabase
    .from("artifacts")
    .select("*")
    .eq("id", artifactId)
    .maybeSingle();
  if (fetchErr || !data) {
    return {
      ok: false,
      error: tErrors("artifactFetchFailed", { message: errMessage(fetchErr) }),
    };
  }
  const artifact = data as ArtifactRow;
  if (artifact.project_id !== projectId) {
    return { ok: false, error: tErrors("artifactFetchFailed", { message: "project" }) };
  }
  if (artifact.status !== "draft") {
    return { ok: false, error: tErrors("artifactNotDraft") };
  }
  const typeDef = getTypeDef(artifact.type);
  if (!typeDef || !typeDef.fields.some((f) => f.key === fieldKey)) {
    return { ok: false, error: tErrors("typeNotFound", { type: artifact.type }) };
  }

  const fields = parseArtifactFields(typeDef, artifact.fields);
  const field = fields[fieldKey] ?? { ...EMPTY_FIELD };

  if (op === "confirm") {
    // E1: megerősíteni csak AI-javaslatot lehet (értékkel).
    if (field.state !== "ai_filled" || !field.value) {
      return { ok: false, error: tErrors("fieldNotConfirmable") };
    }
    fields[fieldKey] = { ...field, state: "confirmed" };
  } else if (op === "edit") {
    const value = (newValue ?? "").trim();
    if (!value) {
      return { ok: false, error: tErrors("fieldValueRequired") };
    }
    // Kézi érték: a forrás-jelölés megmarad eredet-információnak, ha volt.
    fields[fieldKey] = { ...field, value, state: "manual" };
  } else {
    fields[fieldKey] = { ...EMPTY_FIELD };
  }

  const { data: updated, error } = await supabase
    .from("artifacts")
    .update({ fields, updated_at: new Date().toISOString() })
    .eq("id", artifactId)
    .eq("status", "draft") // optimista guard
    .select("id");
  if (error || (updated ?? []).length === 0) {
    return {
      ok: false,
      error: error
        ? tErrors("artifactSaveFailed", { message: errMessage(error) })
        : tErrors("artifactNotDraft"),
    };
  }

  revalidateWorkspace(projectId);
  return { ok: true, error: null, nonce: Date.now() };
}

export async function confirmFieldAction(
  projectId: string,
  artifactId: string,
  fieldKey: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  return updateField(projectId, artifactId, fieldKey, "confirm");
}

export async function editFieldAction(
  projectId: string,
  artifactId: string,
  fieldKey: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const value = String(formData.get("value") ?? "");
  const result = await updateField(projectId, artifactId, fieldKey, "edit", value);
  if (!result.ok) {
    return { ...result, values: { fieldValue: value }, nonce: Date.now() };
  }
  return result;
}

export async function dismissFieldAction(
  projectId: string,
  artifactId: string,
  fieldKey: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  return updateField(projectId, artifactId, fieldKey, "dismiss");
}

// ── Státusz-lánc: Draft → In review → Approved (#5a, 6. lépés) ─
// A lánc NEM átugorható (HITL-fegyelem): Approve csak In review-ból.
// Approved immutábilis; folytatás „Új verzió"-val (verseny-biztos klón).

async function loadOwnedArtifact(
  supabase: SupabaseClient,
  projectId: string,
  artifactId: string,
): Promise<{ artifact: ArtifactRow } | { error: string }> {
  const tErrors = await getTranslations("errors");
  const { data, error } = await supabase
    .from("artifacts")
    .select("*")
    .eq("id", artifactId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error || !data) {
    return { error: tErrors("artifactFetchFailed", { message: errMessage(error) }) };
  }
  return { artifact: data as ArtifactRow };
}

/** Optimista guard-os státusz-váltás: csak a várt állapotból mozdul. */
async function setArtifactStatus(
  projectId: string,
  artifactId: string,
  from: "draft" | "in_review",
  to: "draft" | "in_review" | "approved",
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const supabase = createServiceSupabaseClient();

  const loaded = await loadOwnedArtifact(supabase, projectId, artifactId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { artifact } = loaded;

  const { data, error } = await supabase
    .from("artifacts")
    .update({ status: to, updated_at: new Date().toISOString() })
    .eq("id", artifactId)
    .eq("status", from) // a lánc nem átugorható + verseny-védelem
    .select("id");
  if (error) {
    return {
      ok: false,
      error: tErrors("statusChangeFailed", { message: errMessage(error) }),
    };
  }
  if ((data ?? []).length === 0) {
    return { ok: false, error: tErrors("invalidStatusTransition") };
  }

  await logDecision(
    supabase,
    projectId,
    "status_change",
    `${artifact.type} v${artifact.version}: ${from} → ${to}.`,
  );
  revalidateWorkspace(projectId);
  return { ok: true, error: null };
}

export async function sendToReviewAction(
  projectId: string,
  artifactId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  return setArtifactStatus(projectId, artifactId, "draft", "in_review");
}

export async function backToDraftAction(
  projectId: string,
  artifactId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  return setArtifactStatus(projectId, artifactId, "in_review", "draft");
}

/** Approve — CSAK In review-ból; kemény blokk, ha kötelező mező hiányzik.
 *  A nem megerősített (ai_filled) mező NEM blokkol (a felület figyelmeztet). */
export async function approveArtifactAction(
  projectId: string,
  artifactId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const supabase = createServiceSupabaseClient();

  const loaded = await loadOwnedArtifact(supabase, projectId, artifactId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { artifact } = loaded;

  if (artifact.status !== "in_review") {
    return { ok: false, error: tErrors("approveOnlyFromReview") };
  }

  // Artefaktum-szintű poka-yoke: hiányzó kötelező mező → kemény blokk,
  // a hiányzók i18n-elt felsorolásával.
  const typeDef = getTypeDef(artifact.type);
  if (typeDef) {
    const fields = parseArtifactFields(typeDef, artifact.fields);
    const missing = missingRequiredFields(typeDef, fields);
    if (missing.length > 0) {
      const tFields = await getTranslations("fields");
      const labels = missing
        .map((f) => tFields(f.labelKey.replace(/^fields\./, "")))
        .join(", ");
      return { ok: false, error: tErrors("approveBlocked", { fields: labels }) };
    }
  }

  const { data, error } = await supabase
    .from("artifacts")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", artifactId)
    .eq("status", "in_review") // optimista guard
    .select("id");
  if (error) {
    return {
      ok: false,
      error: tErrors("statusChangeFailed", { message: errMessage(error) }),
    };
  }
  if ((data ?? []).length === 0) {
    return { ok: false, error: tErrors("invalidStatusTransition") };
  }

  await logDecision(
    supabase,
    projectId,
    "approve_artifact",
    `${artifact.type} v${artifact.version} jóváhagyva (In review → Approved).`,
  );
  revalidateWorkspace(projectId);
  return { ok: true, error: null };
}

/** „Új verzió": version+1 draft-klón. A verziószám DB-oldalon, verseny-
 *  biztosan képződik (new_artifact_version RPC + unique constraint);
 *  ütközésnél graceful FormState-hiba. */
export async function newVersionAction(
  projectId: string,
  artifactId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState & { newArtifactId?: string }> {
  const tErrors = await getTranslations("errors");
  const supabase = createServiceSupabaseClient();

  const loaded = await loadOwnedArtifact(supabase, projectId, artifactId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { artifact } = loaded;
  if (artifact.status !== "approved") {
    return { ok: false, error: tErrors("newVersionOnlyApproved") };
  }

  const { data, error } = await supabase.rpc("new_artifact_version", {
    p_artifact_id: artifactId,
  });
  if (error) {
    const message = errMessage(error);
    if (error.code === "23505" || message.includes("duplicate key")) {
      return { ok: false, error: tErrors("versionConflict") };
    }
    if (message.includes("not_approved")) {
      return { ok: false, error: tErrors("newVersionOnlyApproved") };
    }
    if (message.includes("not_latest")) {
      return { ok: false, error: tErrors("newVersionOnlyLatest") };
    }
    return { ok: false, error: tErrors("statusChangeFailed", { message }) };
  }
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as ArtifactRow[];
  const created = rows[0] ?? null;

  await logDecision(
    supabase,
    projectId,
    "new_version",
    `${artifact.type}: új draft-verzió v${created?.version ?? "?"} (v${artifact.version} klónja).`,
  );
  revalidateWorkspace(projectId);
  return { ok: true, error: null, newArtifactId: created?.id };
}

// ── Szerkesztő: body mentése (csak draft; updated_at frissül) ─

export async function saveArtifactBody(
  projectId: string,
  artifactId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const body = String(formData.get("body") ?? "");
  const nonce = Date.now();

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("artifacts")
    .update({ body, updated_at: new Date().toISOString() })
    .eq("id", artifactId)
    .eq("project_id", projectId)
    .eq("status", "draft") // csak draft szerkeszthető (Approved immutábilis)
    .select("id");
  if (error || (data ?? []).length === 0) {
    return {
      ok: false,
      error: error
        ? tErrors("draftSaveFailed") + `: ${errMessage(error)}`
        : tErrors("artifactNotDraft"),
      values: { body },
      nonce,
    };
  }

  await logDecision(supabase, projectId, "edit_draft", `Draft szerkesztve (${artifactId}).`);
  revalidateWorkspace(projectId);
  return { ok: true, error: null, nonce };
}

// ── ③ Draft-generálás: megerősített mezők + sablon → body ────

export async function generateBodyAction(
  projectId: string,
  artifactId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const supabase = createServiceSupabaseClient();

  const { data, error: fetchErr } = await supabase
    .from("artifacts")
    .select("*")
    .eq("id", artifactId)
    .maybeSingle();
  if (fetchErr || !data) {
    return {
      ok: false,
      error: tErrors("artifactFetchFailed", { message: errMessage(fetchErr) }),
    };
  }
  const artifact = data as ArtifactRow;
  if (artifact.project_id !== projectId) {
    return { ok: false, error: tErrors("artifactFetchFailed", { message: "project" }) };
  }
  if (artifact.status !== "draft") {
    return { ok: false, error: tErrors("artifactNotDraft") };
  }
  const typeDef = getTypeDef(artifact.type);
  if (!typeDef) {
    return { ok: false, error: tErrors("typeNotFound", { type: artifact.type }) };
  }

  const fields = parseArtifactFields(typeDef, artifact.fields);
  // Tényként kezelt mezők: ember által megerősített VAGY kézzel írt.
  // A label a locale-FÜGGETLEN magyar labelHu — az adapter promptja nem
  // változhat a UI-nyelvvel (i18n-védőkorlát).
  const confirmedFields = typeDef.fields
    .filter((f) => {
      const value = fields[f.key];
      return (
        (value.state === "confirmed" || value.state === "manual") &&
        Boolean(value.value)
      );
    })
    .map((f) => ({
      key: f.key,
      label: f.labelHu,
      value: fields[f.key].value as string,
    }));
  if (confirmedFields.length === 0) {
    return { ok: false, error: tErrors("generateNeedsConfirmed") };
  }

  // A forrás-számozás az artefaktumon rögzített input-sorrendből jön; ha
  // (kivonatolás nélkül, csak kézi mezőkkel) még üres, most rögzítjük.
  let sourceIds = artifact.source_input_ids;
  let sources: LlmSource[];
  if (sourceIds.length === 0) {
    const loaded = await loadNumberedSources(supabase, projectId);
    if ("error" in loaded) {
      return { ok: false, error: tErrors("inputsFetchFailed") + `: ${loaded.error}` };
    }
    sources = loaded.sources;
    sourceIds = loaded.inputIds;
  } else {
    const { data: inputData, error } = await supabase
      .from("input_items")
      .select("*")
      .in("id", sourceIds);
    if (error) {
      return { ok: false, error: tErrors("inputsFetchFailed") + `: ${errMessage(error)}` };
    }
    const byId = new Map(((inputData ?? []) as InputItemRow[]).map((r) => [r.id, r]));
    sources = sourceIds
      .map((sid, i) => {
        const row = byId.get(sid);
        return row ? { index: i + 1, title: row.type, text: row.raw_text } : null;
      })
      .filter((s): s is LlmSource => s !== null);
  }

  // ÉLŐ LLM-hívás az adapteren át (MOCK_LLM=1: determinisztikus fixture).
  let body: string;
  try {
    body = await generateBody(confirmedFields, sources, typeDef);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`Draft-generálás sikertelen: ${message}`);
    return { ok: false, error: tErrors("generateFailed", { message }) };
  }

  const { data: updated, error } = await supabase
    .from("artifacts")
    .update({
      body,
      source_input_ids: sourceIds,
      updated_at: new Date().toISOString(),
    })
    .eq("id", artifactId)
    .eq("status", "draft") // optimista guard
    .select("id");
  if (error || (updated ?? []).length === 0) {
    return {
      ok: false,
      error: error
        ? tErrors("artifactSaveFailed", { message: errMessage(error) })
        : tErrors("artifactNotDraft"),
    };
  }

  await logDecision(
    supabase,
    projectId,
    "generate_draft",
    `${artifact.type} v${artifact.version} body generálva (${confirmedFields.length} megerősített mező, ${sources.length} forrás).`,
  );
  revalidateWorkspace(projectId);
  return { ok: true, error: null };
}

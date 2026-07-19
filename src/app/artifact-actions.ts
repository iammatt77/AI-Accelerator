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
import { parseAiAct } from "@/lib/entities/evaluators";
import { loadNumberedSources } from "@/lib/sources";
import { evaluateApprove } from "@/lib/goldenset/model";
import type {
  ArtifactRow,
  EvalCaseRow,
  GoldenSetRow,
  InputItemRow,
  UseCaseRow,
} from "@/lib/db/types";
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

// A loadNumberedSources a @/lib/sources közös helperben él (#7a): az
// entitás-akciók is ugyanazt a kanonikus forrás-számozást használják.

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
  // Review-lelet (#7a): az entitás-forrású típus SZERVEROLDALON is tiltott a
  // generikus kivonatolásra — a UI-elrejtés önmagában megkerülhető, és a
  // szabad-szöveges extract a mezőket + a source_input_ids-t (unió →
  // teljes lista) is elrontaná.
  if (typeDef.entitySourced) {
    return { ok: false, error: tErrors("entitySourcedNoExtract") };
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

  // Típusspecifikus poka-yoke (#14, AC5): a Tesztriport NEM Approved-olható
  // golden set eredmény nélkül (kemény), rögzítetlen eset mellett, küszöb
  // nélkül vagy küszöb alatt — kivéve a dokumentált emberi felülírást
  // (threshold_override_note). Az AI a küszöböt soha nem állítja.
  if (artifact.type === "Tesztriport") {
    const { data: setData } = await supabase
      .from("golden_sets")
      .select("*")
      .eq("project_id", projectId)
      .maybeSingle();
    const goldenSet = setData as GoldenSetRow | null;
    if (!goldenSet) {
      return { ok: false, error: tErrors("testreportNoGoldenSet") };
    }
    const { data: caseData } = await supabase
      .from("eval_cases")
      .select("*")
      .eq("golden_set_id", goldenSet.id);
    const verdict = evaluateApprove(goldenSet, (caseData ?? []) as EvalCaseRow[]);
    if (!verdict.ok) {
      const reasonKey =
        verdict.reason === "no_cases" || verdict.reason === "no_results"
          ? "testreportNoResults"
          : verdict.reason === "open_cases"
            ? "testreportOpenCases"
            : verdict.reason === "no_threshold"
              ? "testreportNoThreshold"
              : "testreportBelowThreshold";
      return { ok: false, error: tErrors(reasonKey) };
    }
    if (verdict.overridden) {
      await logDecision(
        supabase,
        projectId,
        "approve_override",
        `Tesztriport jóváhagyás dokumentált felülírással: ${goldenSet.threshold_override_note}`,
      );
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

// ── ③ Shortlist-mezők az ENTITÁSOKBÓL (#7a, F4) ──────────────
// A „Priorizált use case-shortlist" mezői nem szabad-szöveges kivonatolásból,
// hanem a MEGERŐSÍTETT use case-entitásokból származnak. A mezők állapota
// confirmed — a forrásuk az emberi megerősítésen átment entitás. A body
// ezután a szokott láncon készül (generateBodyAction), a [n] citációk az
// érintett entitások forrás-inputjainak UNIÓJÁBÓL oldódnak fel.

const SHORTLIST_TYPE_KEY = "Priorizált use case-shortlist";

const RISK_HU: Record<string, string> = {
  low: "alacsony",
  medium: "közepes",
  high: "magas",
};

// #7b: a MEGERŐSÍTETT AI Act-besorolás magyar megnevezése a dokumentumban
// (a puszta javaslat nem folyik dokumentumba — E1).
const AI_ACT_HU: Record<string, string> = {
  prohibited: "tiltott",
  high_risk: "nagy kockázatú (Annex III)",
  transparency: "átláthatósági kötelezettség (Art. 50)",
  minimal: "minimális",
};

export async function generateShortlistFromEntitiesAction(
  projectId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const typeDef = getTypeDef(SHORTLIST_TYPE_KEY);
  if (!typeDef) {
    return { ok: false, error: tErrors("typeNotFound", { type: SHORTLIST_TYPE_KEY }) };
  }

  const supabase = createServiceSupabaseClient();

  // KIZÁRÓLAG emberi kontrollon átment (confirmed/manual) use case-ek — az
  // ai_suggested javaslat nem kerülhet dokumentumba (E1, negatív teszt b).
  const { data: ucData, error: ucErr } = await supabase
    .from("use_cases")
    .select("*")
    .eq("project_id", projectId)
    .in("state", ["confirmed", "manual"])
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (ucErr) {
    return { ok: false, error: tErrors("entityFetchFailed", { message: errMessage(ucErr) }) };
  }
  const useCases = (ucData ?? []) as UseCaseRow[];

  const shortlisted = useCases.filter(
    (u) => u.list_status === "shortlist" || u.list_status === "selected",
  );
  // Nincs megerősített, shortlisten lévő use case → LÁTHATÓ jelzés, üres
  // dokumentum NEM készül (F4).
  if (shortlisted.length === 0) {
    return { ok: true, error: null, notice: tErrors("noShortlistedUseCase") };
  }
  const excluded = useCases.filter((u) => u.list_status === "excluded");
  // Review-lelet (#7a): a quick win a dokumentumban UGYANAZZAL a
  // predikátummal, mint a kapu-kritérium (list_status ∈ shortlist/selected)
  // — különben a doksi kizárt/jelölt elemet hirdetne quick winként,
  // miközben a kapu jogosan blokkol (dokumentum–kapu divergencia).
  const quickWins = shortlisted.filter((u) => u.quick_win);

  // Rangsor: az érték + megvalósíthatóság összege szerint csökkenő; a nem
  // pontozott elem a sor végére kerül (0-ként számít).
  const scoreOf = (u: UseCaseRow) => (u.score_value ?? 0) + (u.score_feasibility ?? 0);
  const ranked = [...shortlisted].sort((a, b) => scoreOf(b) - scoreOf(a));

  // A dokumentum forrás-listája: az érintett entitások forrás-inputjainak
  // UNIÓJA, a projekt kanonikus input-sorrendjében — a [n] erre a listára
  // (pozicionálisan) mutat, ahogy a szerkesztő és az export is számoz.
  const loaded = await loadNumberedSources(supabase, projectId);
  if ("error" in loaded) {
    return { ok: false, error: tErrors("inputsFetchFailed") + `: ${loaded.error}` };
  }
  const involved = [...shortlisted, ...excluded, ...quickWins];
  const involvedIds = new Set(involved.flatMap((u) => u.source_input_ids));
  const unionIds = loaded.inputIds.filter((id) => involvedIds.has(id));
  const posInUnion = new Map(unionIds.map((id, i) => [id, i + 1]));
  const indicesOf = (items: UseCaseRow[]): number[] =>
    [
      ...new Set(
        items
          .flatMap((u) => u.source_input_ids)
          .map((id) => posInUnion.get(id))
          .filter((n): n is number => typeof n === "number"),
      ),
    ].sort((a, b) => a - b);

  // Mezőértékek determinisztikusan az entitásokból (magyar — a dokumentum
  // nyelve a UI-nyelvtől független).
  const scoreMark = (n: number | null) => (n == null ? "–" : String(n));
  const riskMark = (r: string | null) => (r ? RISK_HU[r] ?? r : "–");
  const shortlistValue = ranked
    .map((u, i) => {
      const head =
        `${i + 1}. ${u.title} — érték: ${scoreMark(u.score_value)}/5 · ` +
        `megvalósíthatóság: ${scoreMark(u.score_feasibility)}/5 · ` +
        `kockázat: ${riskMark(u.risk)}${u.quick_win ? " · quick win" : ""}`;
      return u.description ? `${head}\n   Indoklás: ${u.description}` : head;
    })
    .join("\n");
  const quickWinValue = quickWins
    .map((u) => (u.description ? `${u.title} — ${u.description}` : u.title))
    .join("\n");
  const excludedValue = excluded
    .map((u) => `${u.title} — ${u.exclusion_reason ?? "(indoklás nélkül)"}`)
    .join("\n");
  // #7b: a kockázati jegyzet a kockázat-jelölések MELLETT a megerősített
  // AI Act-besorolásokat is hordozza (use case-enként).
  const confirmedAiAct = (u: UseCaseRow) =>
    parseAiAct(u.ai_act)?.confirmed_category ?? null;
  const riskNoted = ranked.filter(
    (u) => u.risk !== null || confirmedAiAct(u) !== null,
  );
  const riskValue = riskNoted
    .map((u) => {
      const parts: string[] = [];
      if (u.risk) parts.push(`${riskMark(u.risk)} kockázat`);
      const category = confirmedAiAct(u);
      if (category) parts.push(`AI Act: ${AI_ACT_HU[category] ?? category}`);
      return `${u.title}: ${parts.join(" · ")}`;
    })
    .join("\n");
  const criteriaValue =
    "Érték (1–5): a várt üzleti haszon mértéke. " +
    "Megvalósíthatóság (1–5): a bevezetés realitása az adott adat- és folyamatérettség mellett. " +
    "Kockázat (alacsony/közepes/magas): bevezetési és működési kockázat. " +
    "A rangsor az érték és a megvalósíthatóság pontszámának összegén alapul; a quick win jelölés emberi döntés.";

  // Minden kitöltött mező confirmed — a forrása az emberi megerősítésen
  // átment entitás. Ami nem áll elő entitásból (pl. nincs quick win),
  // az missing marad — az approve-blokk / kapu jelez (poka-yoke).
  const confirmedField = (value: string, indices: number[]): ArtifactFields[string] =>
    value !== ""
      ? { value, source_indices: indices, state: "confirmed" }
      : { ...EMPTY_FIELD };
  const fields: ArtifactFields = {
    shortlist: confirmedField(shortlistValue, indicesOf(ranked)),
    ertekelesi_szempontok: confirmedField(criteriaValue, []),
    quick_win: confirmedField(quickWinValue, indicesOf(quickWins)),
    kizart_jeloltek: confirmedField(excludedValue, indicesOf(excluded)),
    kockazati_jegyzet: confirmedField(riskValue, indicesOf(riskNoted)),
  };

  // Mentés: draft fej → frissítés (a mezőket az entitás-forrás felülírja —
  // ez az akció explicit szándéka); approved fej → ÚJ draft-verzió MELLÉ
  // (a régi, szabad-szöveges verzió érintetlen a történetben, F4);
  // in_review → nem módosítható (előbb vissza draftba vagy jóváhagyás).
  const latest = await loadLatestArtifact(supabase, projectId, SHORTLIST_TYPE_KEY);
  if (latest && latest.status === "in_review") {
    return { ok: false, error: tErrors("artifactNotDraft") };
  }
  if (latest && latest.status === "draft") {
    const { data, error } = await supabase
      .from("artifacts")
      .update({
        fields,
        source_input_ids: unionIds,
        updated_at: new Date().toISOString(),
      })
      .eq("id", latest.id)
      .eq("status", "draft") // optimista guard
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
      fields,
      source_input_ids: unionIds,
    });
    if (created.error) return { ok: false, error: created.error };
  }

  await logDecision(
    supabase,
    projectId,
    "generate_shortlist_fields",
    `Shortlist-mezők entitásokból: ${ranked.length} shortlist-elem, ` +
      `${quickWins.length} quick win, ${excluded.length} kizárt, ${unionIds.length} forrás.`,
  );
  revalidateWorkspace(projectId);
  return { ok: true, error: null };
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
  const hadSourceIds = artifact.source_input_ids.length > 0;
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

  // Review-lelet (#7a): a source_input_ids-t csak akkor írjuk vissza, ha a
  // hívás elején még ÜRES volt (fallback-rögzítés). Ha már volt lista, a
  // lassú LLM-hívás alatti párhuzamos mező-újragenerálás (új unió + új
  // számozású source_indices) elveszett frissítést szenvedne — a régi lista
  // visszaírása a mező-citációkat rossz inputra tolná.
  const bodyUpdate: Record<string, unknown> = {
    body,
    updated_at: new Date().toISOString(),
  };
  if (!hadSourceIds) {
    bodyUpdate.source_input_ids = sourceIds;
  }
  const { data: updated, error } = await supabase
    .from("artifacts")
    .update(bodyUpdate)
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

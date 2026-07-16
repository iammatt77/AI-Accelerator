"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { extractStakeholders } from "@/lib/llm";
import { indicesToInputIds, loadNumberedSources } from "@/lib/sources";
import type { StakeholderRow } from "@/lib/db/types";
import type { FormState } from "./actions";

// ─────────────────────────────────────────────────────────────
// Stakeholder-akciók (Coding-csomag #8) — a #7a entitás-mintáját követi:
// AI ai_suggested javaslatot ír → emberi megerősítés (confirmed) / elvetés
// (rejected, listából eltűnik, nem törlődik) / kézi felvétel (manual).
// Az újrafuttatás a korábbi ai_suggested sorokat LECSERÉLI (veszteségmentes
// sorrend: snapshot → insert → régi törlése); a confirmed/manual/rejected
// sorokhoz nem nyúl.
//
// SPECIÁLIS SZABÁLYOK (#8):
//  - Score (influence/impact): az AI CSAK alappal javasol; a null a KÍVÁNT
//    viselkedés alap nélkül. Kézzel bármikor tölthető/módosítható.
//  - communication_strategy: KIZÁRÓLAG manuális — sosem AI-előtöltött.
//  - input-forrás (3a): suggest+confirm, NINCS kényszerített hozzárendelés.
//  - fájdalompont-kötés: many-to-many a pain_point_stakeholders táblán.
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

function nowIso(): string {
  return new Date().toISOString();
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A projekt client_id-ja — a stakeholder ügyfélhez ÉS projekthez kötött. */
async function loadProjectClientId(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{ clientId: string } | { error: string }> {
  const tErrors = await getTranslations("errors");
  const { data, error } = await supabase
    .from("projects")
    .select("client_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !data) {
    return { error: tErrors("entityFetchFailed", { message: errMessage(error) }) };
  }
  return { clientId: (data as { client_id: string }).client_id };
}

/** Score-parse: üres → null; 1–5 egész → szám; egyéb → "invalid" (látható
 *  hiba, nem néma null-ra írás — a #7a parseLevel-mintája). */
function parseScore(raw: FormDataEntryValue | null): number | null | "invalid" {
  const value = String(raw ?? "").trim();
  if (value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) return "invalid";
  return n;
}

// ── Kivonatolás ──────────────────────────────────────────────

export async function extractStakeholdersAction(
  projectId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const supabase = createServiceSupabaseClient();

  const client = await loadProjectClientId(supabase, projectId);
  if ("error" in client) return { ok: false, error: client.error };

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
    proposals = await extractStakeholders(sources);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`Stakeholder-kivonatolás sikertelen: ${message}`);
    return { ok: false, error: tErrors("extractFailed", { message }) };
  }

  // Veszteségmentes csere: snapshot → insert → régi törlése (a #7a elve).
  const { data: oldRows, error: oldErr } = await supabase
    .from("stakeholders")
    .select("id")
    .eq("project_id", projectId)
    .eq("state", "ai_suggested");
  if (oldErr) {
    return { ok: false, error: tErrors("entityFetchFailed", { message: errMessage(oldErr) }) };
  }
  const oldIds = ((oldRows ?? []) as { id: string }[]).map((r) => r.id);

  if (proposals.length > 0) {
    const rows = proposals.map((p) => ({
      client_id: client.clientId,
      project_id: projectId,
      name: p.name,
      title: p.title,
      // Score c-minta: csak alappal (a parse már null-ra normalizált).
      influence_score: p.influence_score,
      impact_score: p.impact_score,
      // communication_strategy SOSEM AI-forrású — nem írjuk (null marad).
      source_input_ids: indicesToInputIds(p.source_indices, inputIds),
      state: "ai_suggested",
    }));
    const { error: insertErr } = await supabase.from("stakeholders").insert(rows);
    if (insertErr) {
      return { ok: false, error: tErrors("entitySaveFailed", { message: errMessage(insertErr) }) };
    }
  }

  if (oldIds.length > 0) {
    const { error: deleteErr } = await supabase
      .from("stakeholders")
      .delete()
      .eq("project_id", projectId)
      .eq("state", "ai_suggested") // guard: közben megerősített sort nem töröl
      .in("id", oldIds);
    if (deleteErr) {
      return { ok: false, error: tErrors("entitySaveFailed", { message: errMessage(deleteErr) }) };
    }
  }

  await logDecision(
    supabase,
    projectId,
    "extract_stakeholders",
    `Stakeholder-kivonatolás: ${proposals.length} javaslat ${sources.length} forrásból.`,
  );
  revalidateWorkspace(projectId);
  if (proposals.length === 0) {
    return { ok: true, error: null, notice: tErrors("stakeholderExtractNoResult") };
  }
  return { ok: true, error: null };
}

// ── E1-akciók (megerősít / szerkeszt / elvet / kézi) ─────────

async function loadOwnedStakeholder(
  supabase: SupabaseClient,
  projectId: string,
  stakeholderId: string,
): Promise<{ row: StakeholderRow } | { error: string }> {
  const tErrors = await getTranslations("errors");
  const { data, error } = await supabase
    .from("stakeholders")
    .select("*")
    .eq("id", stakeholderId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error || !data) {
    return { error: tErrors("entityFetchFailed", { message: errMessage(error) }) };
  }
  return { row: data as StakeholderRow };
}

export async function confirmStakeholderAction(
  projectId: string,
  stakeholderId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("stakeholders")
    .update({ state: "confirmed", updated_at: nowIso() })
    .eq("id", stakeholderId)
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

export async function editStakeholderAction(
  projectId: string,
  stakeholderId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const name = String(formData.get("name") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const nonce = Date.now();
  const values = { title: name, fieldValue: title };
  if (!name) {
    return { ok: false, error: tErrors("stakeholderNameRequired"), values, nonce };
  }

  const supabase = createServiceSupabaseClient();
  const loaded = await loadOwnedStakeholder(supabase, projectId, stakeholderId);
  if ("error" in loaded) return { ok: false, error: loaded.error, values, nonce };
  const { row } = loaded;
  if (row.state === "rejected") {
    return { ok: false, error: tErrors("entityNotEditable"), values, nonce };
  }

  // Szerkesztés = emberi aktus: az AI-javaslat confirmed-be lép.
  const nextState = row.state === "ai_suggested" ? "confirmed" : row.state;
  const { data, error } = await supabase
    .from("stakeholders")
    .update({ name, title: title || null, state: nextState, updated_at: nowIso() })
    .eq("id", stakeholderId)
    .eq("project_id", projectId)
    .eq("state", row.state)
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

export async function rejectStakeholderAction(
  projectId: string,
  stakeholderId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("stakeholders")
    .update({ state: "rejected", updated_at: nowIso() })
    .eq("id", stakeholderId)
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

export async function addStakeholderAction(
  projectId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const name = String(formData.get("name") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const nonce = Date.now();
  const values = { title: name, fieldValue: title };
  if (!name) {
    return { ok: false, error: tErrors("stakeholderNameRequired"), values, nonce };
  }

  const supabase = createServiceSupabaseClient();
  const client = await loadProjectClientId(supabase, projectId);
  if ("error" in client) return { ok: false, error: client.error, values, nonce };

  const { error } = await supabase.from("stakeholders").insert({
    client_id: client.clientId,
    project_id: projectId,
    name,
    title: title || null,
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

// ── Score (influence/impact) — megerősítés / kézi töltés ─────

export async function scoreStakeholderAction(
  projectId: string,
  stakeholderId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const influence = parseScore(formData.get("influenceScore"));
  const impact = parseScore(formData.get("impactScore"));
  if (influence === "invalid" || impact === "invalid") {
    return { ok: false, error: tErrors("scoreInvalid") };
  }

  const supabase = createServiceSupabaseClient();
  // Pontozni csak emberi kontrollon átment (confirmed/manual) stakeholdert
  // lehet — az ai_suggested előbb megerősítendő (E1).
  const { data, error } = await supabase
    .from("stakeholders")
    .update({ influence_score: influence, impact_score: impact, updated_at: nowIso() })
    .eq("id", stakeholderId)
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

// ── Kommunikációs stratégia — KIZÁRÓLAG manuális ─────────────

export async function setCommunicationStrategyAction(
  projectId: string,
  stakeholderId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const strategy = String(formData.get("strategy") ?? "").trim();
  const nonce = Date.now();

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("stakeholders")
    .update({ communication_strategy: strategy || null, updated_at: nowIso() })
    .eq("id", stakeholderId)
    .eq("project_id", projectId)
    .in("state", ["confirmed", "manual"])
    .select("id");
  if (error) {
    return {
      ok: false,
      error: tErrors("entitySaveFailed", { message: errMessage(error) }),
      values: { fieldValue: strategy },
      nonce,
    };
  }
  if ((data ?? []).length === 0) {
    return { ok: false, error: tErrors("entityNotConfirmed"), values: { fieldValue: strategy }, nonce };
  }
  revalidateWorkspace(projectId);
  return { ok: true, error: null, nonce };
}

// ── Input-forrás hozzárendelés (3a) — suggest + confirm, nincs kényszer ──

export async function assignInputSourceAction(
  projectId: string,
  stakeholderId: string,
  inputId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  if (!UUID_RE.test(inputId)) {
    return { ok: false, error: tErrors("entityNotEditable") };
  }
  // A form „assign" (bekötés) vagy „unassign" (feloldás) — nincs kényszer.
  const assign = String(formData.get("assign") ?? "") === "1";

  const supabase = createServiceSupabaseClient();
  // A stakeholder a projekthez tartozik-e (defense-in-depth).
  const loaded = await loadOwnedStakeholder(supabase, projectId, stakeholderId);
  if ("error" in loaded) return { ok: false, error: loaded.error };

  const { data, error } = await supabase
    .from("input_items")
    .update({ stakeholder_source_id: assign ? stakeholderId : null })
    .eq("id", inputId)
    .eq("project_id", projectId)
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

// ── Fájdalompont-kötés (many-to-many) ────────────────────────

/** A fájdalompont ÖSSZES stakeholder-kötését a kiválasztott halmazra állítja
 *  (checkbox-lista). Egy fájdalompont több stakeholdert is érinthet. A törlés
 *  + beszúrás project-scope-olt: csak a projekt megerősített stakeholderei
 *  köthetők (tamper-védelem). */
export async function setPainStakeholdersAction(
  projectId: string,
  painPointId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  if (!UUID_RE.test(painPointId)) {
    return { ok: false, error: tErrors("entityNotEditable") };
  }
  const selected = formData
    .getAll("stakeholderIds")
    .map((v) => String(v))
    .filter((v) => UUID_RE.test(v));

  const supabase = createServiceSupabaseClient();

  // A fájdalompont a projekthez tartozik-e.
  const { data: painRow, error: painErr } = await supabase
    .from("pain_points")
    .select("id")
    .eq("id", painPointId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (painErr || !painRow) {
    return { ok: false, error: tErrors("entityFetchFailed", { message: errMessage(painErr) }) };
  }

  // Csak LÉTEZŐ, emberi kontrollon átment (confirmed/manual) projekt-
  // stakeholderek köthetők — a többi kiesik (tamperelt form ne írjon idegen
  // vagy meg nem erősített kötést).
  let validIds: string[] = [];
  if (selected.length > 0) {
    const { data, error } = await supabase
      .from("stakeholders")
      .select("id")
      .eq("project_id", projectId)
      .in("state", ["confirmed", "manual"])
      .in("id", selected);
    if (error) {
      return { ok: false, error: tErrors("entityFetchFailed", { message: errMessage(error) }) };
    }
    validIds = ((data ?? []) as { id: string }[]).map((r) => r.id);
  }

  // Csere: a fájdalompont meglévő kötéseit töröljük, majd az újakat beszúrjuk.
  const { error: delErr } = await supabase
    .from("pain_point_stakeholders")
    .delete()
    .eq("pain_point_id", painPointId);
  if (delErr) {
    return { ok: false, error: tErrors("entitySaveFailed", { message: errMessage(delErr) }) };
  }
  if (validIds.length > 0) {
    const rows = validIds.map((sid) => ({
      pain_point_id: painPointId,
      stakeholder_id: sid,
    }));
    const { error: insErr } = await supabase.from("pain_point_stakeholders").insert(rows);
    if (insErr) {
      return { ok: false, error: tErrors("entitySaveFailed", { message: errMessage(insErr) }) };
    }
  }
  revalidateWorkspace(projectId);
  return { ok: true, error: null };
}

// ── Fájdalompont-kötés a STAKEHOLDER OLDALÁRÓL (a dedikált lap „+ kötés"/
// „feloldás" belépője). Ugyanaz az M:N tábla és ugyanazok az őrök, mint a
// pain-oldali setPainStakeholdersAction-nél — csak egyetlen sort állít
// (idempotens), a pain-oldali csere-akció érintetlen. Nincs új adatmodell. ──
export async function togglePainBindAction(
  projectId: string,
  stakeholderId: string,
  painPointId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  if (!UUID_RE.test(stakeholderId) || !UUID_RE.test(painPointId)) {
    return { ok: false, error: tErrors("entityNotEditable") };
  }
  const bind = formData.get("bind") === "1";
  const supabase = createServiceSupabaseClient();

  // A stakeholder a projekthez tartozik ÉS emberi kontrollon átment
  // (confirmed/manual) — tamperelt form ne kössön meg nem erősített sort.
  const { data: sh } = await supabase
    .from("stakeholders")
    .select("id")
    .eq("id", stakeholderId)
    .eq("project_id", projectId)
    .in("state", ["confirmed", "manual"])
    .maybeSingle();
  if (!sh) {
    return { ok: false, error: tErrors("entityNotEditable") };
  }
  // A fájdalompont a projekthez tartozik-e.
  const { data: pain } = await supabase
    .from("pain_points")
    .select("id")
    .eq("id", painPointId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!pain) {
    return { ok: false, error: tErrors("entityNotEditable") };
  }

  if (bind) {
    // Idempotens: csak ha még nincs ilyen kötés.
    const { data: existing } = await supabase
      .from("pain_point_stakeholders")
      .select("pain_point_id")
      .eq("pain_point_id", painPointId)
      .eq("stakeholder_id", stakeholderId)
      .maybeSingle();
    if (!existing) {
      const { error } = await supabase
        .from("pain_point_stakeholders")
        .insert({ pain_point_id: painPointId, stakeholder_id: stakeholderId });
      if (error) {
        return { ok: false, error: tErrors("entitySaveFailed", { message: errMessage(error) }) };
      }
    }
  } else {
    const { error } = await supabase
      .from("pain_point_stakeholders")
      .delete()
      .eq("pain_point_id", painPointId)
      .eq("stakeholder_id", stakeholderId);
    if (error) {
      return { ok: false, error: tErrors("entitySaveFailed", { message: errMessage(error) }) };
    }
  }
  revalidateWorkspace(projectId);
  return { ok: true, error: null };
}

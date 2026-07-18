"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { suggestComponents, suggestOptions } from "@/lib/llm";
import { loadNumberedSources, indicesToInputIds } from "@/lib/sources";
import { resolveApprovedToBe, spineFromMap, linkedStepsOf, optionsOf } from "@/lib/solution/model";
import type {
  ComponentOptionRow,
  ComponentStepLinkRow,
  ComponentType,
  CriterionValue,
  PainPointRow,
  ProcessMapRow,
  SolutionComponentRow,
} from "@/lib/db/types";
import type { FormState } from "./actions";

// ─────────────────────────────────────────────────────────────
// Megoldási opció-összevető akciók (#12). E1 végig: az AI JAVASOL
// (komponenst, opciót, szempont-értéket — ai_suggested / ai_recommended),
// a NYERTEST kizárólag EMBER választja (selectOptionAction rögzíti: ki,
// mikor, indoklás). A modul a folyamattérképet NEM módosítja — a kötés a
// jóváhagyott TO-BE stabil node-id-jaira hivatkozik.
// ─────────────────────────────────────────────────────────────

const COMPONENT_TYPES: ComponentType[] = ["process", "infrastructure", "personnel"];

interface SupabaseErrorLike {
  message?: string;
}

function errMessage(error: SupabaseErrorLike | null): string {
  return error?.message ?? "?";
}

function base(projectId: string): string {
  return `/project/${projectId}/solution`;
}

/** A projekt jóváhagyott TO-BE térképe — a gerinc; nélküle a modul zárt. */
async function loadApprovedToBe(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  projectId: string,
): Promise<ProcessMapRow | null> {
  const { data } = await supabase
    .from("process_maps")
    .select("*")
    .eq("project_id", projectId)
    .eq("kind", "to_be")
    .eq("status", "approved")
    .order("version", { ascending: false })
    .limit(1);
  return resolveApprovedToBe((data ?? []) as ProcessMapRow[]);
}

async function loadPains(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  projectId: string,
): Promise<{ title: string; description: string | null }[]> {
  const { data } = await supabase
    .from("pain_points")
    .select("title, description, state")
    .eq("project_id", projectId);
  return ((data ?? []) as Pick<PainPointRow, "title" | "description" | "state">[])
    .filter((p) => p.state !== "rejected")
    .map((p) => ({ title: p.title, description: p.description }));
}

// ── ✦ Komponens-generálás (E1, csak üres készletre) ──────────

export async function generateComponentsAction(
  projectId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("solution");
  const supabase = createServiceSupabaseClient();

  const { data: existing } = await supabase
    .from("solution_components")
    .select("id")
    .eq("project_id", projectId)
    .limit(1);
  if ((existing ?? []).length > 0) {
    return { ok: false, error: t("errAlreadyHasComponents") };
  }

  const toBe = await loadApprovedToBe(supabase, projectId);
  if (!toBe) return { ok: false, error: t("errNoApprovedToBe") };
  const steps = spineFromMap(toBe);

  const loaded = await loadNumberedSources(supabase, projectId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const pains = await loadPains(supabase, projectId);

  let proposals;
  try {
    proposals = await suggestComponents(
      loaded.sources,
      pains,
      steps.map((s) => ({ nodeId: s.nodeId, num: s.num, title: s.title, type: s.type, desc: "" })),
    );
  } catch (e) {
    return { ok: false, error: t("errLlm", { message: e instanceof Error ? e.message : "?" }) };
  }
  if (proposals.length === 0) {
    return { ok: true, error: null, notice: t("noticeNoBasis") };
  }

  for (const p of proposals) {
    const { data, error } = await supabase
      .from("solution_components")
      .insert({
        project_id: projectId,
        phase: "P2",
        type: p.type,
        name: p.name,
        description: p.description,
        state: "ai_suggested",
        source_input_ids: indicesToInputIds(p.source_indices, loaded.inputIds),
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
    const cid = (data as { id: string }).id;
    for (const nodeId of p.step_ids) {
      const { error: linkErr } = await supabase.from("component_step_links").insert({
        component_id: cid,
        process_map_id: toBe.id,
        node_id: nodeId,
      });
      if (linkErr) return { ok: false, error: t("errSave", { message: errMessage(linkErr) }) };
    }
  }
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

// ── ✦ Opció-generálás egy komponenshez (E1, csak üres opciókra) ──

export async function generateOptionsAction(
  projectId: string,
  componentId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("solution");
  const supabase = createServiceSupabaseClient();

  const { data: compData } = await supabase
    .from("solution_components")
    .select("*")
    .eq("id", componentId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!compData) return { ok: false, error: t("errComponentNotFound") };
  const component = compData as SolutionComponentRow;

  const { data: optData } = await supabase
    .from("component_options")
    .select("id")
    .eq("component_id", componentId)
    .limit(1);
  if ((optData ?? []).length > 0) {
    return { ok: false, error: t("errAlreadyHasOptions") };
  }

  const toBe = await loadApprovedToBe(supabase, projectId);
  const steps = toBe ? spineFromMap(toBe) : [];
  const { data: linkData } = await supabase
    .from("component_step_links")
    .select("*")
    .eq("component_id", componentId);
  const stepTitles = linkedStepsOf(
    componentId,
    (linkData ?? []) as ComponentStepLinkRow[],
    steps,
  ).map((s) => `TO-BE ${s.num} ${s.title}`);

  const loaded = await loadNumberedSources(supabase, projectId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const pains = await loadPains(supabase, projectId);

  let proposals;
  try {
    proposals = await suggestOptions(
      { name: component.name, type: component.type, description: component.description, stepTitles },
      loaded.sources,
      pains,
    );
  } catch (e) {
    return { ok: false, error: t("errLlm", { message: e instanceof Error ? e.message : "?" }) };
  }
  if (proposals.length === 0) {
    return { ok: true, error: null, notice: t("noticeNoOptionBasis") };
  }

  for (const [i, p] of proposals.entries()) {
    const { error } = await supabase.from("component_options").insert({
      component_id: componentId,
      name: p.name,
      description: p.description,
      criteria_values: p.criteria,
      ai_recommended: p.recommended,
      is_selected: false,
      ord: i,
    });
    if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  }
  revalidatePath(base(projectId));
  revalidatePath(`${base(projectId)}/c/${componentId}`);
  return { ok: true, error: null };
}

// ── E1: komponens megerősítés / elvetés ──────────────────────

export async function confirmComponentAction(
  projectId: string,
  componentId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("solution");
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("solution_components")
    .update({ state: "confirmed", updated_at: new Date().toISOString() })
    .eq("id", componentId)
    .eq("project_id", projectId)
    .eq("state", "ai_suggested");
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  revalidatePath(`${base(projectId)}/c/${componentId}`);
  return { ok: true, error: null };
}

/** Elvetés: CSAK ai_suggested törölhető (a kézit/ megerősítettet nem). */
export async function rejectComponentAction(
  projectId: string,
  componentId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("solution");
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("solution_components")
    .delete()
    .eq("id", componentId)
    .eq("project_id", projectId)
    .eq("state", "ai_suggested");
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

// ── Kézi komponens-felvétel (+ kötés a stabil node-id-kre) ───

export async function addComponentAction(
  projectId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("solution");
  const supabase = createServiceSupabaseClient();

  const type = String(formData.get("type") ?? "") as ComponentType;
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!COMPONENT_TYPES.includes(type)) return { ok: false, error: t("errTypeRequired") };
  if (!name) return { ok: false, error: t("errNameRequired") };

  const toBe = await loadApprovedToBe(supabase, projectId);
  if (!toBe) return { ok: false, error: t("errNoApprovedToBe") };
  const validIds = new Set(spineFromMap(toBe).map((s) => s.nodeId));

  // kötés: process → pontosan egy lépés; infra → 0+; personnel → 0-1
  let nodeIds = formData
    .getAll("node_ids")
    .map((v) => String(v))
    .filter((v) => validIds.has(v));
  nodeIds = [...new Set(nodeIds)];
  if (type === "process") {
    if (nodeIds.length !== 1) return { ok: false, error: t("errProcessNeedsStep") };
  } else if (type === "personnel") {
    nodeIds = nodeIds.slice(0, 1);
  }

  const { data, error } = await supabase
    .from("solution_components")
    .insert({
      project_id: projectId,
      phase: "P2",
      type,
      name,
      description,
      state: "manual",
      source_input_ids: [],
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  const cid = (data as { id: string }).id;
  for (const nodeId of nodeIds) {
    const { error: linkErr } = await supabase.from("component_step_links").insert({
      component_id: cid,
      process_map_id: toBe.id,
      node_id: nodeId,
    });
    if (linkErr) return { ok: false, error: t("errSave", { message: errMessage(linkErr) }) };
  }
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

// ── Kézi opció-felvétel + „+ szempont" bővítés ───────────────

const BASE_KEYS = ["cost", "lead_time", "risk", "data_need", "fit"] as const;

export async function addOptionAction(
  projectId: string,
  componentId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("solution");
  const supabase = createServiceSupabaseClient();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: t("errNameRequired") };
  const description = String(formData.get("description") ?? "").trim();

  // alap-szempontok az űrlapról — az üres mező KIMARAD (c-minta)
  const criteria: Record<string, CriterionValue> = {};
  for (const key of BASE_KEYS) {
    const value = String(formData.get(`crit_${key}`) ?? "").trim();
    const note = String(formData.get(`crit_${key}_note`) ?? "").trim();
    if (value || note) criteria[key] = { value, ...(note ? { note } : {}) };
  }

  const { data: existing } = await supabase
    .from("component_options")
    .select("ord")
    .eq("component_id", componentId)
    .order("ord", { ascending: false })
    .limit(1);
  const nextOrd = (((existing ?? [])[0] as { ord: number } | undefined)?.ord ?? -1) + 1;

  const { error } = await supabase.from("component_options").insert({
    component_id: componentId,
    name,
    description,
    criteria_values: criteria,
    is_selected: false,
    ai_recommended: false,
    ord: nextOrd,
  });
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  revalidatePath(`${base(projectId)}/c/${componentId}`);
  return { ok: true, error: null };
}

/**
 * „+ szempont": egyedi szempont felvétele a mátrixba — opciónkénti értékekkel.
 * Legalább egy opción kell érték (különben nincs mit tárolni — c-minta:
 * üres szempont-sort nem fabrikálunk).
 */
export async function addCriterionAction(
  projectId: string,
  componentId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("solution");
  const supabase = createServiceSupabaseClient();

  const label = String(formData.get("label") ?? "").trim();
  if (!label) return { ok: false, error: t("errCriterionLabelRequired") };
  const key = `custom_${label
    .toLowerCase()
    .replace(/[^a-z0-9áéíóöőúüű]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)}`;

  const { data: optData } = await supabase
    .from("component_options")
    .select("*")
    .eq("component_id", componentId);
  const options = optionsOf(componentId, (optData ?? []) as ComponentOptionRow[]);
  if (options.length === 0) return { ok: false, error: t("errNoOptionsYet") };

  let wrote = false;
  for (const o of options) {
    const value = String(formData.get(`val_${o.id}`) ?? "").trim();
    if (!value) continue;
    const current =
      o.criteria_values && typeof o.criteria_values === "object" && !Array.isArray(o.criteria_values)
        ? (o.criteria_values as Record<string, unknown>)
        : {};
    const next = { ...current, [key]: { value, label } };
    const { error } = await supabase
      .from("component_options")
      .update({ criteria_values: next })
      .eq("id", o.id);
    if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
    wrote = true;
  }
  if (!wrote) return { ok: false, error: t("errCriterionNeedsValue") };
  revalidatePath(`${base(projectId)}/c/${componentId}`);
  return { ok: true, error: null };
}

// ── HITL-kiválasztás: a nyertest EMBER jelöli ki ─────────────

/**
 * A kiválasztás SOSEM automatikus: ez az akció egy explicit emberi
 * gombnyomás. Rögzíti: melyik opció (is_selected), ki (selected_by), mikor
 * (selected_at), miért (rationale). Komponensenként egy nyertes — előbb
 * minden opciót visszaállítunk, majd a választottat jelöljük (a részleges
 * unique index őrzi a konzisztenciát).
 */
export async function selectOptionAction(
  projectId: string,
  componentId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("solution");
  const supabase = createServiceSupabaseClient();

  const optionId = String(formData.get("option_id") ?? "");
  const { data: optData } = await supabase
    .from("component_options")
    .select("id, component_id")
    .eq("id", optionId)
    .eq("component_id", componentId)
    .maybeSingle();
  if (!optData) return { ok: false, error: t("errOptionNotFound") };

  const selectedBy = String(formData.get("selected_by") ?? "").trim() || t("defaultSelector");
  const rationale = String(formData.get("rationale") ?? "").trim();

  const { error: clearErr } = await supabase
    .from("component_options")
    .update({ is_selected: false })
    .eq("component_id", componentId)
    .eq("is_selected", true);
  if (clearErr) return { ok: false, error: t("errSave", { message: errMessage(clearErr) }) };

  const { error } = await supabase
    .from("component_options")
    .update({
      is_selected: true,
      selected_by: selectedBy,
      selected_at: new Date().toISOString(),
      ...(rationale ? { rationale } : {}),
    })
    .eq("id", optionId);
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };

  revalidatePath(base(projectId));
  revalidatePath(`${base(projectId)}/c/${componentId}`);
  return { ok: true, error: null };
}

/** „Választás módosítása" — a döntés újranyitása (a rationale megmarad). */
export async function unselectOptionAction(
  projectId: string,
  componentId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("solution");
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("component_options")
    .update({ is_selected: false, selected_by: null, selected_at: null })
    .eq("component_id", componentId)
    .eq("is_selected", true);
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  revalidatePath(`${base(projectId)}/c/${componentId}`);
  return { ok: true, error: null };
}

"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { suggestBuildDoc, suggestImplLinks } from "@/lib/llm";
import { loadNumberedSources, indicesToInputIds } from "@/lib/sources";
import { nextDisplayIds } from "@/lib/requirements/model";
import { resolveApprovedToBe, spineFromMap } from "@/lib/solution/model";
import {
  LAYER_TYPES,
  TARGET_TYPES,
  byDisplayId,
  planElements,
  seedCandidates,
} from "@/lib/builddoc/model";
import { getTypeDef, parseArtifactFields, type ArtifactFields } from "@/lib/artifacts/config";
import type {
  ArtifactRow,
  BuildComponentRow,
  BuildLayerType,
  ComponentOptionRow,
  ControlPointRow,
  ImplLinkRow,
  ImplTargetType,
  PainPointRow,
  ProcessMapRow,
  PromptItemRow,
  RequirementRow,
  SolutionComponentRow,
  UserStoryRow,
} from "@/lib/db/types";
import type { FormState } from "./actions";

// ─────────────────────────────────────────────────────────────
// Megoldás-dokumentáció akciók (#15). E1 végig: az AI JAVASOL (komponenst,
// kötést, promptot, kontrollt), az EMBER erősít meg / szerkeszt / vet el.
// A kötés MINDIG emberi döntés — ai_suggested kötés nem aktív. A deliverable
// a MEGLÉVŐ artifacts-lánc (Draft→In review→Approved); itt csak a mezőit
// szinkronizáljuk az entitásokból.
// ─────────────────────────────────────────────────────────────

const DOC_TYPE = "Megoldás-dokumentáció";

interface SupabaseErrorLike {
  message?: string;
}

function errMessage(error: SupabaseErrorLike | null): string {
  return error?.message ?? "?";
}

function base(projectId: string): string {
  return `/project/${projectId}/builddoc`;
}

type Supabase = ReturnType<typeof createServiceSupabaseClient>;

/** A terv-elem címtár betöltése (a kötés-célok feloldásához). */
async function loadPlanContext(supabase: Supabase, projectId: string) {
  const [{ data: reqData }, { data: storyData }, { data: mapData }, { data: painData }] =
    await Promise.all([
      supabase.from("requirements").select("*").eq("project_id", projectId).order("display_id"),
      supabase.from("user_stories").select("*").eq("project_id", projectId).order("display_id"),
      supabase
        .from("process_maps")
        .select("*")
        .eq("project_id", projectId)
        .eq("kind", "to_be")
        .order("version", { ascending: false }),
      supabase
        .from("pain_points")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
    ]);
  const toBe = resolveApprovedToBe((mapData ?? []) as ProcessMapRow[]);
  const spine = toBe ? spineFromMap(toBe) : [];
  const elements = planElements(
    (reqData ?? []) as RequirementRow[],
    (storyData ?? []) as UserStoryRow[],
    spine,
    (painData ?? []) as PainPointRow[],
  );
  return { elements, toBe, spine };
}

// ── AC1: P2-seed (strukturált eredet-kötéssel, 1-N) ──────────

export async function seedFromP2Action(
  projectId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("builddoc");
  const supabase = createServiceSupabaseClient();

  const pickedIds = formData.getAll("seed_ids").map((v) => String(v));
  if (pickedIds.length === 0) return { ok: false, error: t("errNoSeedPicked") };

  const [{ data: p2Data }, { data: existingData }] = await Promise.all([
    supabase.from("solution_components").select("*").eq("project_id", projectId),
    supabase.from("build_components").select("display_id, ord").eq("project_id", projectId),
  ]);
  const p2 = (p2Data ?? []) as SolutionComponentRow[];
  const existingIds = ((existingData ?? []) as { display_id: string }[]).map((r) => r.display_id);
  let maxOrd = Math.max(-1, ...((existingData ?? []) as { ord: number }[]).map((r) => r.ord));

  const picked = p2.filter((c) => pickedIds.includes(c.id) && c.state !== "rejected");
  if (picked.length === 0) return { ok: false, error: t("errNoSeedPicked") };

  const ids = nextDisplayIds(existingIds, "K", picked.length);
  for (const [i, c] of picked.entries()) {
    // A P2-seed EMBERI behúzás strukturált alapról → confirmed; az eredet-
    // kötés a origin_component_id (1-N: ugyanabból többször is húzható).
    const { error } = await supabase.from("build_components").insert({
      project_id: projectId,
      display_id: ids[i],
      name: c.name,
      description: c.description,
      layer_type: c.type,
      origin_component_id: c.id,
      // A8: a seed-átvétel bélyege — az origin_drift jelölő ehhez mér.
      seeded_at: new Date().toISOString(),
      state: "confirmed",
      source_input_ids: c.source_input_ids,
      ord: ++maxOrd,
    });
    if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  }
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

// ── Kézi komponens-felvétel (+ opcionális ✦ kötés-javaslat) ──

export async function addComponentAction(
  projectId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("builddoc");
  const supabase = createServiceSupabaseClient();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const layer = String(formData.get("layer_type") ?? "") as BuildLayerType;
  if (!name) return { ok: false, error: t("errNameRequired") };
  if (!LAYER_TYPES.includes(layer)) return { ok: false, error: t("errLayerRequired") };

  const { data: existingData } = await supabase
    .from("build_components")
    .select("display_id, ord")
    .eq("project_id", projectId);
  const existingIds = ((existingData ?? []) as { display_id: string }[]).map((r) => r.display_id);
  const maxOrd = Math.max(-1, ...((existingData ?? []) as { ord: number }[]).map((r) => r.ord));
  const [displayId] = nextDisplayIds(existingIds, "K", 1);

  const { data, error } = await supabase
    .from("build_components")
    .insert({
      project_id: projectId,
      display_id: displayId,
      name,
      description,
      layer_type: layer,
      origin_component_id: null, // manuális — nincs P2-előzmény
      state: "manual",
      ord: maxOrd + 1,
    })
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: t("errSave", { message: errMessage(error) }) };

  let notice: string | undefined;
  if (String(formData.get("with_ai") ?? "") === "1") {
    try {
      const n = await runLinkSuggestion(supabase, projectId, data as BuildComponentRow);
      notice = n > 0 ? t("noticeLinksSuggested", { n }) : t("noticeNoLinkBasis");
    } catch (e) {
      notice = t("noticeAiFailed", { message: e instanceof Error ? e.message : "?" });
    }
  }
  revalidatePath(base(projectId));
  return { ok: true, error: null, ...(notice ? { notice } : {}) };
}

export async function updateComponentAction(
  projectId: string,
  componentId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("builddoc");
  const supabase = createServiceSupabaseClient();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const layer = String(formData.get("layer_type") ?? "") as BuildLayerType;
  if (!name) return { ok: false, error: t("errNameRequired") };
  if (!LAYER_TYPES.includes(layer)) return { ok: false, error: t("errLayerRequired") };

  const { data: cur } = await supabase
    .from("build_components")
    .select("state")
    .eq("id", componentId)
    .maybeSingle();
  if (!cur) return { ok: false, error: t("errComponentNotFound") };
  const state =
    (cur as { state: string }).state === "ai_suggested" ? "confirmed" : (cur as { state: string }).state;

  const { error } = await supabase
    .from("build_components")
    .update({ name, description, layer_type: layer, state, updated_at: new Date().toISOString() })
    .eq("id", componentId);
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

/** Megerősítés szerkesztés nélkül (✓ az AI-javaslaton). */
export async function confirmComponentAction(
  projectId: string,
  componentId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("builddoc");
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("build_components")
    .update({ state: "confirmed", updated_at: new Date().toISOString() })
    .eq("id", componentId)
    .eq("state", "ai_suggested");
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

/** Elvetés: CSAK ai_suggested komponens törölhető (E1). */
export async function rejectComponentAction(
  projectId: string,
  componentId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("builddoc");
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("build_components")
    .delete()
    .eq("id", componentId)
    .eq("state", "ai_suggested");
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

// ── AC3: ✦ struktúra-javaslat az építési anyagból ────────────

export async function generateBuildDocAction(
  projectId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("builddoc");
  const supabase = createServiceSupabaseClient();

  const loaded = await loadNumberedSources(supabase, projectId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  if (loaded.sources.length === 0) return { ok: false, error: t("errNoSources") };

  const [{ data: p2Data }, { data: optData }, { data: compData }] = await Promise.all([
    supabase
      .from("solution_components")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    supabase.from("component_options").select("*"),
    supabase.from("build_components").select("*").eq("project_id", projectId),
  ]);
  const existing = (compData ?? []) as BuildComponentRow[];
  const cands = seedCandidates(
    (p2Data ?? []) as SolutionComponentRow[],
    (optData ?? []) as ComponentOptionRow[],
    existing,
  );
  // Csomag A (A3): entitás-primer — a javaslat elsődleges alapja a
  // JÓVÁHAGYOTT (confirmed/manual) P2-komponensek teljes tartalma; e nélkül
  // a hívás blokkolt. Az origin_index is erre a szűrt listára képez.
  const approvedCands = cands.filter(
    (c) => c.component.state === "confirmed" || c.component.state === "manual",
  );
  if (approvedCands.length === 0) return { ok: false, error: t("errNeedApprovedComponents") };
  const { toBe, spine } = await loadPlanContext(supabase, projectId);

  let proposal;
  try {
    proposal = await suggestBuildDoc(loaded.sources, {
      p2Components: approvedCands.map((c) => ({
        name: c.component.name,
        description: c.component.description,
        optionName: c.selectedOption?.name ?? null,
        optionDescription: c.selectedOption?.description ?? null,
      })),
      tobeSteps: spine.map((s) => ({ num: s.num, title: s.title })),
    });
  } catch (e) {
    return { ok: false, error: t("errLlm", { message: e instanceof Error ? e.message : "?" }) };
  }

  // Additív, de név-duplikátum nem jön létre (case-insensitive).
  const knownNames = new Set(existing.map((c) => c.name.toLowerCase()));
  const newComponents = proposal.components.filter((c) => !knownNames.has(c.name.toLowerCase()));
  const { data: ctrlData } = await supabase
    .from("control_points")
    .select("name")
    .eq("project_id", projectId);
  const knownControls = new Set(
    ((ctrlData ?? []) as { name: string }[]).map((c) => c.name.toLowerCase()),
  );
  const newControls = proposal.controls.filter((c) => !knownControls.has(c.name.toLowerCase()));

  if (newComponents.length === 0 && newControls.length === 0) {
    return { ok: true, error: null, notice: t("noticeNothingNew") };
  }

  const existingIds = existing.map((c) => c.display_id);
  let maxOrd = Math.max(-1, ...existing.map((c) => c.ord));
  const ids = nextDisplayIds(existingIds, "K", newComponents.length);

  const { data: promptData } = await supabase
    .from("prompt_items")
    .select("display_id, ord")
    .eq("project_id", projectId);
  const promptIds = ((promptData ?? []) as { display_id: string }[]).map((r) => r.display_id);
  let promptOrd = Math.max(-1, ...((promptData ?? []) as { ord: number }[]).map((r) => r.ord));
  let promptCount = 0;
  for (const c of newComponents) promptCount += c.prompts.length;
  const prIds = nextDisplayIds(promptIds, "PR", promptCount);
  let prCursor = 0;

  for (const [i, c] of newComponents.entries()) {
    const { data, error } = await supabase
      .from("build_components")
      .insert({
        project_id: projectId,
        display_id: ids[i],
        name: c.name,
        description: c.description,
        layer_type: c.layer_type,
        origin_component_id:
          c.origin_index !== null ? (approvedCands[c.origin_index - 1]?.component.id ?? null) : null,
        // A8: eredettel érkező javaslatnál a seed-bélyeg is íródik.
        seeded_at:
          c.origin_index !== null && approvedCands[c.origin_index - 1]
            ? new Date().toISOString()
            : null,
        state: "ai_suggested",
        source_input_ids: indicesToInputIds(c.source_indices, loaded.inputIds),
        ord: ++maxOrd,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
    for (const p of c.prompts) {
      const { error: pErr } = await supabase.from("prompt_items").insert({
        project_id: projectId,
        component_id: (data as { id: string }).id,
        display_id: prIds[prCursor++],
        name: p.name,
        purpose: p.purpose,
        prompt_text: p.prompt_text,
        state: "ai_suggested",
        ord: ++promptOrd,
      });
      if (pErr) return { ok: false, error: t("errSave", { message: errMessage(pErr) }) };
    }
  }

  let ctrlOrd = -1;
  const { data: ctrlOrdData } = await supabase
    .from("control_points")
    .select("ord")
    .eq("project_id", projectId);
  ctrlOrd = Math.max(-1, ...((ctrlOrdData ?? []) as { ord: number }[]).map((r) => r.ord));
  for (const c of newControls) {
    const step = c.tobe_ord !== null ? (spine[c.tobe_ord - 1] ?? null) : null;
    const { error } = await supabase.from("control_points").insert({
      project_id: projectId,
      name: c.name,
      kind: c.kind,
      description: c.description,
      process_map_id: step && toBe ? toBe.id : null,
      node_id: step ? step.nodeId : null, // c-minta: alap nélkül üres
      state: "ai_suggested",
      source_input_ids: indicesToInputIds(c.source_indices, loaded.inputIds),
      ord: ++ctrlOrd,
    });
    if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  }
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

// ── AC2+AC3: megvalósítás-kötések ────────────────────────────

/** ✦ kötés-javaslat egy komponensre — a meglévő párok kimaradnak. */
async function runLinkSuggestion(
  supabase: Supabase,
  projectId: string,
  component: BuildComponentRow,
): Promise<number> {
  const { elements, toBe } = await loadPlanContext(supabase, projectId);
  if (elements.length === 0) return 0;
  const suggestions = await suggestImplLinks(
    { name: component.name, description: component.description },
    elements.map((e) => ({ targetType: e.targetType, label: e.label, title: e.title })),
  );
  if (suggestions.length === 0) return 0;

  const { data: linkData } = await supabase
    .from("impl_links")
    .select("*")
    .eq("component_id", component.id);
  const existing = new Set(
    ((linkData ?? []) as ImplLinkRow[]).map((l) => `${l.target_type}:${l.target_id}`),
  );
  const byLabel = new Map(elements.map((e) => [`${e.targetType}:${e.label}`, e]));
  let created = 0;
  for (const s of suggestions) {
    const el = byLabel.get(`${s.target_type}:${s.label}`);
    if (!el || existing.has(`${el.targetType}:${el.targetId}`)) continue;
    const { error } = await supabase.from("impl_links").insert({
      component_id: component.id,
      target_type: el.targetType,
      target_id: el.targetId,
      process_map_id: el.targetType === "tobe_node" && toBe ? toBe.id : null,
      state: "ai_suggested",
    });
    if (!error) created += 1;
  }
  return created;
}

export async function suggestLinksAction(
  projectId: string,
  componentId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("builddoc");
  const supabase = createServiceSupabaseClient();
  const { data } = await supabase
    .from("build_components")
    .select("*")
    .eq("id", componentId)
    .maybeSingle();
  if (!data) return { ok: false, error: t("errComponentNotFound") };
  try {
    const n = await runLinkSuggestion(supabase, projectId, data as BuildComponentRow);
    revalidatePath(base(projectId));
    return n > 0
      ? { ok: true, error: null }
      : { ok: true, error: null, notice: t("noticeNoLinkBasis") };
  } catch (e) {
    return { ok: false, error: t("errLlm", { message: e instanceof Error ? e.message : "?" }) };
  }
}

/** Kézi kötés — MINDKÉT irányból ez fut (komponens→elem és elem→komponens):
 *  a component_id és a cél (target_type + target_id) az űrlapból jön. */
export async function addLinkAction(
  projectId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("builddoc");
  const supabase = createServiceSupabaseClient();

  const componentId = String(formData.get("component_id") ?? "").trim();
  const targetType = String(formData.get("target_type") ?? "") as ImplTargetType;
  const targetId = String(formData.get("target_id") ?? "").trim();
  if (!componentId) return { ok: false, error: t("errComponentRequired") };
  if (!TARGET_TYPES.includes(targetType) || !targetId) {
    return { ok: false, error: t("errTargetRequired") };
  }
  // A cél léteznie kell a címtárban (fabrikált kötés tiltva).
  const { elements, toBe } = await loadPlanContext(supabase, projectId);
  const el = elements.find((e) => e.targetType === targetType && e.targetId === targetId);
  if (!el) return { ok: false, error: t("errTargetUnknown") };

  const { error } = await supabase.from("impl_links").insert({
    component_id: componentId,
    target_type: targetType,
    target_id: targetId,
    process_map_id: targetType === "tobe_node" && toBe ? toBe.id : null,
    state: "manual",
  });
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

/** ✓ az AI-javasolt kötésen — ettől válik aktívvá (E1). */
export async function confirmLinkAction(
  projectId: string,
  linkId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("builddoc");
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("impl_links")
    .update({ state: "confirmed" })
    .eq("id", linkId)
    .eq("state", "ai_suggested");
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

/** × bármely kötésen: a kötés emberi döntés — törölhető. */
export async function deleteLinkAction(
  projectId: string,
  linkId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("builddoc");
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase.from("impl_links").delete().eq("id", linkId);
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

// ── Prompt-elemek (4. jelenet, 1-N) ──────────────────────────

export async function addPromptAction(
  projectId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("builddoc");
  const supabase = createServiceSupabaseClient();

  const componentId = String(formData.get("component_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: t("errNameRequired") };
  if (!componentId) return { ok: false, error: t("errPromptComponentRequired") };

  const { data: existing } = await supabase
    .from("prompt_items")
    .select("display_id, ord")
    .eq("project_id", projectId);
  const ids = ((existing ?? []) as { display_id: string }[]).map((r) => r.display_id);
  const maxOrd = Math.max(-1, ...((existing ?? []) as { ord: number }[]).map((r) => r.ord));
  const [displayId] = nextDisplayIds(ids, "PR", 1);

  const { error } = await supabase.from("prompt_items").insert({
    project_id: projectId,
    component_id: componentId,
    display_id: displayId,
    name,
    purpose: String(formData.get("purpose") ?? "").trim(),
    prompt_text: String(formData.get("prompt_text") ?? "").trim(),
    state: "manual",
    ord: maxOrd + 1,
  });
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

export async function updatePromptAction(
  projectId: string,
  promptId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("builddoc");
  const supabase = createServiceSupabaseClient();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: t("errNameRequired") };
  const { data: cur } = await supabase
    .from("prompt_items")
    .select("state")
    .eq("id", promptId)
    .maybeSingle();
  if (!cur) return { ok: false, error: t("errPromptNotFound") };
  const state =
    (cur as { state: string }).state === "ai_suggested" ? "confirmed" : (cur as { state: string }).state;
  const { error } = await supabase
    .from("prompt_items")
    .update({
      name,
      purpose: String(formData.get("purpose") ?? "").trim(),
      prompt_text: String(formData.get("prompt_text") ?? "").trim(),
      state,
      updated_at: new Date().toISOString(),
    })
    .eq("id", promptId);
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

export async function rejectPromptAction(
  projectId: string,
  promptId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("builddoc");
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("prompt_items")
    .delete()
    .eq("id", promptId)
    .eq("state", "ai_suggested");
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

// ── Kontrollpontok (5. jelenet, AC6) ─────────────────────────

export async function addControlAction(
  projectId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("builddoc");
  const supabase = createServiceSupabaseClient();

  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "");
  if (!name) return { ok: false, error: t("errNameRequired") };
  if (kind !== "guardrail" && kind !== "hitl") return { ok: false, error: t("errKindRequired") };

  const nodeId = String(formData.get("node_id") ?? "").trim();
  const { toBe, spine } = await loadPlanContext(supabase, projectId);
  const step = nodeId ? spine.find((s) => s.nodeId === nodeId) : null;

  const { data: existing } = await supabase
    .from("control_points")
    .select("ord")
    .eq("project_id", projectId);
  const maxOrd = Math.max(-1, ...((existing ?? []) as { ord: number }[]).map((r) => r.ord));

  const { error } = await supabase.from("control_points").insert({
    project_id: projectId,
    name,
    kind,
    description: String(formData.get("description") ?? "").trim(),
    process_map_id: step && toBe ? toBe.id : null,
    node_id: step ? step.nodeId : null, // c-minta: érvénytelen/üres → nincs kötés
    state: "manual",
    ord: maxOrd + 1,
  });
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

export async function confirmControlAction(
  projectId: string,
  controlId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("builddoc");
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("control_points")
    .update({ state: "confirmed", updated_at: new Date().toISOString() })
    .eq("id", controlId)
    .eq("state", "ai_suggested");
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

export async function rejectControlAction(
  projectId: string,
  controlId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("builddoc");
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("control_points")
    .delete()
    .eq("id", controlId)
    .eq("state", "ai_suggested");
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

// ── AC5: a deliverable mező-szinkronja (MEGLÉVŐ artifacts-lánc) ─

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

/** Az entitásokból számolt szekció-mezők írása a Megoldás-dokumentációba
 *  (draft/in_review; ha nincs, első draft). Az architektúra és az
 *  integrációs mező NEM íródik felül — az a kivonatolás/kézi útján él. */
export async function syncDocAction(
  projectId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("builddoc");
  const supabase = createServiceSupabaseClient();

  const [{ data: compData }, { data: linkData }, { data: promptData }, { data: ctrlData }] =
    await Promise.all([
      supabase.from("build_components").select("*").eq("project_id", projectId),
      supabase.from("impl_links").select("*"),
      supabase.from("prompt_items").select("*").eq("project_id", projectId),
      supabase.from("control_points").select("*").eq("project_id", projectId),
    ]);
  // CSAK aktív (nem ✦) entitás kerül a dokumentumba (E1).
  const components = byDisplayId(
    ((compData ?? []) as BuildComponentRow[]).filter((c) => c.state !== "ai_suggested"),
  );
  if (components.length === 0) return { ok: false, error: t("errNoComponentsToSync") };
  const compIds = new Set(components.map((c) => c.id));
  const links = ((linkData ?? []) as ImplLinkRow[]).filter(
    (l) => compIds.has(l.component_id) && l.state !== "ai_suggested",
  );
  const prompts = byDisplayId(
    ((promptData ?? []) as PromptItemRow[]).filter((p) => p.state !== "ai_suggested"),
  );
  const controls = ((ctrlData ?? []) as ControlPointRow[]).filter(
    (c) => c.state !== "ai_suggested",
  );

  const { elements } = await loadPlanContext(supabase, projectId);
  const byKey = new Map(elements.map((e) => [`${e.targetType}:${e.targetId}`, e.label]));
  const { data: p2Data } = await supabase
    .from("solution_components")
    .select("*")
    .eq("project_id", projectId);
  const p2ById = new Map(((p2Data ?? []) as SolutionComponentRow[]).map((c) => [c.id, c.name]));
  const compById = new Map(components.map((c) => [c.id, c]));

  const compLines = components
    .map((c) => {
      const origin = c.origin_component_id
        ? t("syncOriginP2", { name: p2ById.get(c.origin_component_id) ?? "?" })
        : t("syncOriginManual");
      const linkLabels = links
        .filter((l) => l.component_id === c.id)
        .map((l) => byKey.get(`${l.target_type}:${l.target_id}`))
        .filter(Boolean)
        .join(", ");
      return `${c.display_id} · ${c.name} (${t(`layer.${c.layer_type}`)}) — ${origin}${
        linkLabels ? ` — ${t("syncImplements")}: ${linkLabels}` : ""
      }`;
    })
    .join("\n");
  const promptLines = prompts
    .map((p) => {
      const comp = compById.get(p.component_id);
      return `${p.display_id} · ${p.name}${p.purpose ? ` — ${p.purpose}` : ""}${
        comp ? ` (${comp.display_id})` : ""
      }`;
    })
    .join("\n");
  const ctrlLines = controls
    .map((c) => {
      const label = c.node_id ? byKey.get(`tobe_node:${c.node_id}`) : null;
      return `[${t(`kind.${c.kind}`)}] ${c.name}${c.description ? ` — ${c.description}` : ""}${
        label ? ` (${label})` : ""
      }`;
    })
    .join("\n");

  const typeDef = getTypeDef(DOC_TYPE);
  if (!typeDef) return { ok: false, error: t("errSave", { message: "typedef" }) };

  const { data: artData } = await supabase
    .from("artifacts")
    .select("*")
    .eq("project_id", projectId)
    .eq("type", DOC_TYPE)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const artifact = artData as ArtifactRow | null;

  if (artifact && artifact.status !== "approved") {
    const fields = parseArtifactFields(typeDef, artifact.fields);
    syncField(fields, "komponensek", compLines);
    syncField(fields, "prompt_konyvtar", promptLines);
    syncField(fields, "guardrail_hitl", ctrlLines);
    const { error } = await supabase
      .from("artifacts")
      .update({ fields, synced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", artifact.id);
    if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  } else if (!artifact) {
    const fields = parseArtifactFields(typeDef, {});
    syncField(fields, "komponensek", compLines);
    syncField(fields, "prompt_konyvtar", promptLines);
    syncField(fields, "guardrail_hitl", ctrlLines);
    const { error } = await supabase.from("artifacts").insert({
      project_id: projectId,
      type: DOC_TYPE,
      version: 1,
      status: "draft",
      body: "",
      fields,
      synced_at: new Date().toISOString(),
      source_input_ids: [],
    });
    if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  } else {
    return { ok: false, error: t("errDocApproved") };
  }

  revalidatePath(base(projectId));
  revalidatePath(`/project/${projectId}/documents`);
  return { ok: true, error: null };
}

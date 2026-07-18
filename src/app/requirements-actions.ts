"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import {
  suggestAcDraft,
  suggestRequirements,
  suggestStories,
  suggestStoryDraft,
  type StoryDraft,
} from "@/lib/llm";
import { loadNumberedSources, indicesToInputIds } from "@/lib/sources";
import { displayPrefix, nextDisplayIds } from "@/lib/requirements/model";
import { graphFromJson } from "@/lib/processmap/parse";
import type {
  Moscow,
  PainPointRow,
  ProcessMapRow,
  RequirementLevel,
  RequirementRow,
  RequirementSubtype,
  StakeholderRow,
  UserStoryRow,
} from "@/lib/db/types";
import type { FormState } from "./actions";

// ─────────────────────────────────────────────────────────────
// Követelmény-akciók (#11). E1 végig: az AI JAVASOL (ai_suggested),
// az ember erősít meg / vesz fel kézzel (manual). Az irány KÖTÖTT:
// requirement → story (a story sosem elsődleges). Az AC a requirementen
// él — a story-oldal a kötésen át örökli, ezek az akciók AC-t soha nem
// másolnak story-ra.
// ─────────────────────────────────────────────────────────────

const MOSCOWS: Moscow[] = ["must", "should", "could", "wont"];

interface SupabaseErrorLike {
  message?: string;
}

function errMessage(error: SupabaseErrorLike | null): string {
  return error?.message ?? "?";
}

function moscowFromForm(v: FormDataEntryValue | null): Moscow | null {
  const s = String(v ?? "").toLowerCase();
  return (MOSCOWS as string[]).includes(s) ? (s as Moscow) : null;
}

function base(projectId: string): string {
  return `/project/${projectId}/requirements`;
}

/**
 * Egy LLM-adta érintett-név feloldása a projekt stakeholder-listájára.
 * Normalizált pontos egyezés → EGYÉRTELMŰ tartalmazás (pontosan egy jelölt,
 * min. 4 karakter, hogy a rövid töredékek ne kössenek false-t). Ha nem
 * egyértelmű, null — nem fabrikálunk kötést (c-minta).
 */
function matchStakeholder(name: string, rows: StakeholderRow[]): StakeholderRow | null {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const n = norm(name);
  if (!n) return null;
  const exact = rows.find((s) => norm(s.name) === n);
  if (exact) return exact;
  if (n.length < 4) return null;
  const contains = rows.filter((s) => {
    const sn = norm(s.name);
    return sn.length >= 4 && (sn.includes(n) || n.includes(sn));
  });
  return contains.length === 1 ? contains[0] : null;
}

// ── Generálás: requirement-fa (üres állapotból, E1) ──────────

/**
 * ✦ AI-javaslat a TO-BE-ből: a nem-elvetett fájdalompontok + a legfrissebb
 * TO-BE folyamat lépései + az érintettek alapján háromszintű fát javasol.
 * CSAK üres fába fut (a belépő az üres állapot CTA-ja) — meglévő fára nem
 * generál rá.
 */
export async function generateRequirementsAction(
  projectId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("requirements");
  const supabase = createServiceSupabaseClient();

  const { data: existing } = await supabase
    .from("requirements")
    .select("id")
    .eq("project_id", projectId)
    .limit(1);
  if ((existing ?? []).length > 0) {
    return { ok: false, error: t("errAlreadyHasTree") };
  }

  const loaded = await loadNumberedSources(supabase, projectId);
  if ("error" in loaded) return { ok: false, error: loaded.error };

  const [{ data: painData }, { data: mapData }, { data: shData }] = await Promise.all([
    supabase.from("pain_points").select("title, description, state").eq("project_id", projectId),
    supabase
      .from("process_maps")
      .select("*")
      .eq("project_id", projectId)
      .eq("kind", "to_be")
      .order("version", { ascending: false })
      .limit(1),
    supabase.from("stakeholders").select("*").eq("project_id", projectId),
  ]);
  const pains = ((painData ?? []) as Pick<PainPointRow, "title" | "description" | "state">[])
    .filter((p) => p.state !== "rejected")
    .map((p) => ({ title: p.title, description: p.description }));
  const toBeMap = ((mapData ?? []) as ProcessMapRow[])[0] ?? null;
  const toBeSteps = toBeMap
    ? graphFromJson(toBeMap.nodes, toBeMap.edges).nodes.map((n) => ({
        title: n.title,
        type: n.type,
        desc: n.desc,
      }))
    : [];
  const stakeholders = ((shData ?? []) as StakeholderRow[]).map((s) => ({
    name: s.name,
    title: s.title,
  }));

  let proposals;
  try {
    proposals = await suggestRequirements(loaded.sources, pains, toBeSteps, stakeholders);
  } catch (e) {
    return { ok: false, error: t("errLlm", { message: e instanceof Error ? e.message : "?" }) };
  }
  if (proposals.length === 0) {
    return { ok: true, error: null, notice: t("noticeNoBasis") };
  }

  // display_id-k prefixenként; beszúrás szint-sorrendben (szülő előbb).
  const byPrefix = new Map<string, number>();
  const idsFor = (level: RequirementLevel, subtype: RequirementSubtype | null): string => {
    const prefix = displayPrefix(level, subtype);
    const used = byPrefix.get(prefix) ?? 0;
    byPrefix.set(prefix, used + 1);
    return `${prefix}-${String(used + 1).padStart(2, "0")}`;
  };
  const order: RequirementLevel[] = ["business", "stakeholder", "system"];
  const sorted = [...proposals].sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
  const tmpToId = new Map<string, string>();
  const shRows = (shData ?? []) as StakeholderRow[];

  for (const p of sorted) {
    const { data, error } = await supabase
      .from("requirements")
      .insert({
        project_id: projectId,
        phase: "P2",
        level: p.level,
        subtype: p.subtype,
        parent_id: p.parentTmp ? (tmpToId.get(p.parentTmp) ?? null) : null,
        moscow: p.moscow,
        text: p.text,
        source_input_ids: indicesToInputIds(p.sourceIndices, loaded.inputIds),
        state: "ai_suggested",
        display_id: idsFor(p.level, p.subtype),
      })
      .select("id")
      .single();
    if (error || !data) {
      return { ok: false, error: t("errSave", { message: errMessage(error) }) };
    }
    const newId = (data as { id: string }).id;
    tmpToId.set(p.tmp, newId);
    // Stakeholder-kötés név szerint (a #8 entitásra). Robusztus egyezés a
    // valós-LLM névvariancia miatt: normalizált (kis/nagybetű, whitespace)
    // pontos egyezés, majd EGYÉRTELMŰ tartalmazás-egyezés (pontosan egy
    // jelölt) — ha nincs egyértelmű alap, üresen marad (c-minta, nem tippel).
    for (const name of p.stakeholderNames) {
      const sh = matchStakeholder(name, shRows);
      if (sh) {
        await supabase
          .from("stakeholder_requirements")
          .upsert(
            { requirement_id: newId, stakeholder_id: sh.id },
            { onConflict: "requirement_id,stakeholder_id", ignoreDuplicates: true },
          );
      }
    }
  }
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

// ── Generálás: story-származtatás (E1; irány: requirement → story) ──

/**
 * ✦ Story-k származtatása a SYSTEM requirementekből (epic-csomagolással,
 * N:M kötéssel). CSAK üres story-készletre fut. AC-t NEM hoz létre — a
 * story a lefedett requirement(ek) AC-jét a kötésen át örökli.
 */
export async function generateStoriesAction(
  projectId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("requirements");
  const supabase = createServiceSupabaseClient();

  const { data: existing } = await supabase
    .from("user_stories")
    .select("id")
    .eq("project_id", projectId)
    .limit(1);
  if ((existing ?? []).length > 0) {
    return { ok: false, error: t("errAlreadyHasStories") };
  }

  const { data: reqData } = await supabase
    .from("requirements")
    .select("*")
    .eq("project_id", projectId);
  const reqs = (reqData ?? []) as RequirementRow[];
  const systemReqs = reqs.filter((r) => r.level === "system");
  if (systemReqs.length === 0) {
    return { ok: false, error: t("errNoSystemReqs") };
  }

  let pkg;
  try {
    pkg = await suggestStories(
      systemReqs.map((r) => ({
        displayId: r.display_id,
        text: r.text,
        subtype: r.subtype,
        moscow: r.moscow,
      })),
      reqs.filter((r) => r.level === "business").map((r) => ({ displayId: r.display_id, text: r.text })),
    );
  } catch (e) {
    return { ok: false, error: t("errLlm", { message: e instanceof Error ? e.message : "?" }) };
  }
  if (pkg.stories.length === 0) {
    return { ok: true, error: null, notice: t("noticeNoBasis") };
  }

  // Epic-ek (EP-nn)
  const epicTmpToId = new Map<string, string>();
  let epicSeq = 0;
  for (const e of pkg.epics) {
    epicSeq += 1;
    const br = reqs.find((r) => r.display_id === e.businessDisplayId) ?? null;
    const { data, error } = await supabase
      .from("epics")
      .insert({
        project_id: projectId,
        title: e.title,
        business_requirement_id: br?.id ?? null,
        display_id: `EP-${String(epicSeq).padStart(2, "0")}`,
      })
      .select("id")
      .single();
    if (error || !data) {
      return { ok: false, error: t("errSave", { message: errMessage(error) }) };
    }
    epicTmpToId.set(e.tmp, (data as { id: string }).id);
  }

  // Story-k (US-nn) + N:M kötések; a forrás a lefedett reqek forrás-uniója.
  let storySeq = 0;
  for (const s of pkg.stories) {
    const covered = s.coversDisplayIds
      .map((d) => systemReqs.find((r) => r.display_id === d))
      .filter((r): r is RequirementRow => r !== undefined);
    if (covered.length === 0) continue; // az irány kötött: fedés nélkül nincs story
    storySeq += 1;
    const sourceUnion = [...new Set(covered.flatMap((r) => r.source_input_ids))];
    const { data, error } = await supabase
      .from("user_stories")
      .insert({
        project_id: projectId,
        epic_id: s.epicTmp ? (epicTmpToId.get(s.epicTmp) ?? null) : null,
        role: s.role,
        want: s.want,
        so_that: s.soThat,
        moscow: s.moscow,
        state: "ai_suggested",
        source_input_ids: sourceUnion,
        display_id: `US-${String(storySeq).padStart(2, "0")}`,
      })
      .select("id")
      .single();
    if (error || !data) {
      return { ok: false, error: t("errSave", { message: errMessage(error) }) };
    }
    const storyId = (data as { id: string }).id;
    for (const r of covered) {
      await supabase.from("requirement_stories").insert({ requirement_id: r.id, story_id: storyId });
    }
  }
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

// ── E1 megerősítés / elvetés / MoSCoW (emberi ítélet) ────────

export async function confirmRequirementAction(
  projectId: string,
  reqId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("requirements");
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("requirements")
    .update({ state: "confirmed", updated_at: new Date().toISOString() })
    .eq("id", reqId)
    .eq("project_id", projectId);
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  revalidatePath(`${base(projectId)}/r/${reqId}`);
  return { ok: true, error: null };
}

/** AI-javaslat elvetése — csak ai_suggested törölhető (a megerősített nem). */
export async function rejectRequirementAction(
  projectId: string,
  reqId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("requirements");
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("requirements")
    .delete()
    .eq("id", reqId)
    .eq("project_id", projectId)
    .eq("state", "ai_suggested");
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

export async function setRequirementMoscowAction(
  projectId: string,
  reqId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("requirements");
  const supabase = createServiceSupabaseClient();
  const moscow = moscowFromForm(formData.get("moscow"));
  if (!moscow) return { ok: false, error: t("errBadMoscow") };
  const { error } = await supabase
    .from("requirements")
    .update({ moscow, updated_at: new Date().toISOString() })
    .eq("id", reqId)
    .eq("project_id", projectId);
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  revalidatePath(`${base(projectId)}/r/${reqId}`);
  return { ok: true, error: null };
}

export async function confirmStoryAction(
  projectId: string,
  storyId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("requirements");
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("user_stories")
    .update({ state: "confirmed", updated_at: new Date().toISOString() })
    .eq("id", storyId)
    .eq("project_id", projectId);
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  revalidatePath(`${base(projectId)}/s/${storyId}`);
  return { ok: true, error: null };
}

export async function rejectStoryAction(
  projectId: string,
  storyId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("requirements");
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("user_stories")
    .delete()
    .eq("id", storyId)
    .eq("project_id", projectId)
    .eq("state", "ai_suggested");
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

export async function setStoryMoscowAction(
  projectId: string,
  storyId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("requirements");
  const supabase = createServiceSupabaseClient();
  const moscow = moscowFromForm(formData.get("moscow"));
  if (!moscow) return { ok: false, error: t("errBadMoscow") };
  const { error } = await supabase
    .from("user_stories")
    .update({ moscow, updated_at: new Date().toISOString() })
    .eq("id", storyId)
    .eq("project_id", projectId);
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  revalidatePath(`${base(projectId)}/s/${storyId}`);
  return { ok: true, error: null };
}

// ── Kézi felvétel: requirement a fába ────────────────────────

export async function addRequirementAction(
  projectId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("requirements");
  const supabase = createServiceSupabaseClient();

  const levelRaw = String(formData.get("level") ?? "");
  const level: RequirementLevel | null = ["business", "stakeholder", "system"].includes(levelRaw)
    ? (levelRaw as RequirementLevel)
    : null;
  const subtypeRaw = String(formData.get("subtype") ?? "");
  const subtype: RequirementSubtype | null =
    level === "system"
      ? subtypeRaw === "non_functional"
        ? "non_functional"
        : "functional"
      : null;
  const text = String(formData.get("text") ?? "").trim();
  const parentId = String(formData.get("parentId") ?? "") || null;
  const moscow = moscowFromForm(formData.get("moscow"));
  if (!level || !text) {
    return { ok: false, error: t("errAddMissing") };
  }
  // A fa-kötés kötelező a nem-business szinteken (a ref „Szülő · kötelező").
  if (level !== "business" && !parentId) {
    return { ok: false, error: t("errParentRequired") };
  }

  const { data: existing } = await supabase
    .from("requirements")
    .select("display_id")
    .eq("project_id", projectId);
  const prefix = displayPrefix(level, subtype);
  const [displayId] = nextDisplayIds(
    ((existing ?? []) as { display_id: string }[]).map((r) => r.display_id),
    prefix,
    1,
  );

  const { error } = await supabase.from("requirements").insert({
    project_id: projectId,
    phase: "P2",
    level,
    subtype,
    parent_id: parentId,
    moscow,
    text,
    source_input_ids: [],
    state: "manual", // kézi felvétel = emberi eredet (E1)
    display_id: displayId,
  });
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

// ── AC-k (a REQUIREMENTEN élnek — közös AC) ──────────────────

export async function addAcAction(
  projectId: string,
  reqId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("requirements");
  const supabase = createServiceSupabaseClient();
  const title = String(formData.get("title") ?? "").trim();
  const given = String(formData.get("given") ?? "").trim();
  const when = String(formData.get("when") ?? "").trim();
  const then = String(formData.get("then") ?? "").trim();
  if (!given || !when || !then) {
    return { ok: false, error: t("errAcMissing") };
  }
  const { data: reqRow } = await supabase
    .from("requirements")
    .select("id")
    .eq("id", reqId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!reqRow) return { ok: false, error: t("errNotFound") };
  const { data: acRows } = await supabase
    .from("acceptance_criteria")
    .select("ord")
    .eq("requirement_id", reqId)
    .order("ord", { ascending: false })
    .limit(1);
  const nextOrd = (((acRows ?? [])[0] as { ord: number } | undefined)?.ord ?? -1) + 1;
  const { error } = await supabase.from("acceptance_criteria").insert({
    requirement_id: reqId,
    title: title || `AC-${nextOrd + 1}`,
    given_text: given,
    when_text: when,
    then_text: then,
    ord: nextOrd,
  });
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  revalidatePath(`${base(projectId)}/r/${reqId}`);
  return { ok: true, error: null };
}

export async function deleteAcAction(
  projectId: string,
  reqId: string,
  acId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("requirements");
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase.from("acceptance_criteria").delete().eq("id", acId);
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  revalidatePath(`${base(projectId)}/r/${reqId}`);
  return { ok: true, error: null };
}

// ── Kézi story-származtatás (requirement → story, N:M) ───────

export async function deriveStoryAction(
  projectId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("requirements");
  const supabase = createServiceSupabaseClient();

  const coveredIds = formData.getAll("coveredId").map(String).filter(Boolean);
  const role = String(formData.get("role") ?? "").trim();
  const want = String(formData.get("want") ?? "").trim();
  const soThat = String(formData.get("soThat") ?? "").trim();
  const epicId = String(formData.get("epicId") ?? "") || null;
  const newEpicTitle = String(formData.get("newEpicTitle") ?? "").trim();
  const moscow = moscowFromForm(formData.get("moscow"));

  if (coveredIds.length === 0) {
    return { ok: false, error: t("errCoverRequired") }; // az irány kötött
  }
  if (!role || !want) {
    return { ok: false, error: t("errStoryMissing") };
  }
  const { data: reqData } = await supabase
    .from("requirements")
    .select("*")
    .eq("project_id", projectId)
    .in("id", coveredIds);
  const covered = ((reqData ?? []) as RequirementRow[]).filter((r) => r.level === "system");
  if (covered.length === 0) {
    return { ok: false, error: t("errCoverSystemOnly") };
  }

  let finalEpicId = epicId;
  if (!finalEpicId && newEpicTitle) {
    const { data: epicRows } = await supabase
      .from("epics")
      .select("display_id")
      .eq("project_id", projectId);
    const [epicDisplay] = nextDisplayIds(
      ((epicRows ?? []) as { display_id: string }[]).map((r) => r.display_id),
      "EP",
      1,
    );
    const { data, error } = await supabase
      .from("epics")
      .insert({ project_id: projectId, title: newEpicTitle, display_id: epicDisplay })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
    finalEpicId = (data as { id: string }).id;
  }

  const { data: storyRows } = await supabase
    .from("user_stories")
    .select("display_id")
    .eq("project_id", projectId);
  const [displayId] = nextDisplayIds(
    ((storyRows ?? []) as { display_id: string }[]).map((r) => r.display_id),
    "US",
    1,
  );
  const sourceUnion = [...new Set(covered.flatMap((r) => r.source_input_ids))];
  const { data: inserted, error } = await supabase
    .from("user_stories")
    .insert({
      project_id: projectId,
      epic_id: finalEpicId,
      role,
      want,
      so_that: soThat,
      moscow,
      state: "manual", // kézi felvétel = emberi eredet (E1)
      source_input_ids: sourceUnion,
      display_id: displayId,
    })
    .select("id")
    .single();
  if (error || !inserted) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  const storyId = (inserted as { id: string }).id;
  for (const r of covered) {
    await supabase.from("requirement_stories").insert({ requirement_id: r.id, story_id: storyId });
  }
  revalidatePath(base(projectId));
  return { ok: true, error: null };
}

// ── ✦ Vázlat-akciók (űrlap-kitöltés — nem írnak DB-t; az ember dönt) ──

/**
 * ✦ AC-vázlat GENERÁLÁSA — a javasolt Given–When–Then AC-ket KÖZVETLENÜL
 * PERZISZTÁLJA az acceptance_criteria táblába (a requirementre), majd
 * revalidál — így kilépés/visszalépés után is megmaradnak, és a kötött
 * story-k a közös AC mechanizmuson át azonnal látják őket. HITL: az AC
 * a követelmény szövegéből származik (a prompt tiltja a kitalálást), és az
 * ember bármelyik AC-t törölheti (deleteAcAction). Korábban ez csak
 * kliens-oldali vázlatot adott — DB-be sosem írt (ez volt a bug).
 */
export async function generateAcAction(
  projectId: string,
  reqId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("requirements");
  const supabase = createServiceSupabaseClient();
  const { data } = await supabase
    .from("requirements")
    .select("text")
    .eq("id", reqId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!data) return { ok: false, error: t("errNotFound") };

  let drafts;
  try {
    drafts = await suggestAcDraft((data as { text: string }).text);
  } catch (e) {
    return { ok: false, error: t("errLlm", { message: e instanceof Error ? e.message : "?" }) };
  }
  if (drafts.length === 0) {
    return { ok: true, error: null, notice: t("noticeNoAc") };
  }
  const { data: acRows } = await supabase
    .from("acceptance_criteria")
    .select("ord")
    .eq("requirement_id", reqId)
    .order("ord", { ascending: false })
    .limit(1);
  let nextOrd = (((acRows ?? [])[0] as { ord: number } | undefined)?.ord ?? -1) + 1;
  for (const d of drafts) {
    const { error } = await supabase.from("acceptance_criteria").insert({
      requirement_id: reqId,
      title: d.title,
      given_text: d.given,
      when_text: d.when,
      then_text: d.then,
      ord: nextOrd,
    });
    if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
    nextOrd += 1;
  }
  revalidatePath(base(projectId));
  revalidatePath(`${base(projectId)}/r/${reqId}`);
  return { ok: true, error: null };
}

// ── Stakeholder-kötés (kézi bind/unbind a stakeholder requirementen) ──
// A stakeholder_requirements kötés OPCIONÁLIS — a mentés/létrehozás sosem
// blokkolt a hiánya miatt. Ez a manuális út, ha a generálás nem talált
// (vagy rosszul kötött) — a c-minta szerint az AI üresen hagyja, ahol
// nincs egyértelmű alap.

export async function addStakeholderLinkAction(
  projectId: string,
  reqId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("requirements");
  const supabase = createServiceSupabaseClient();
  const stakeholderId = String(formData.get("stakeholderId") ?? "");
  if (!stakeholderId) return { ok: false, error: t("errPickStakeholder") };
  // A requirementnek a projekthez kell tartoznia + stakeholder szintűnek lennie.
  const { data: reqRow } = await supabase
    .from("requirements")
    .select("level")
    .eq("id", reqId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!reqRow) return { ok: false, error: t("errNotFound") };
  const { error } = await supabase
    .from("stakeholder_requirements")
    .upsert({ requirement_id: reqId, stakeholder_id: stakeholderId }, { onConflict: "requirement_id,stakeholder_id", ignoreDuplicates: true });
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  revalidatePath(`${base(projectId)}/r/${reqId}`);
  return { ok: true, error: null };
}

export async function removeStakeholderLinkAction(
  projectId: string,
  reqId: string,
  stakeholderId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("requirements");
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("stakeholder_requirements")
    .delete()
    .eq("requirement_id", reqId)
    .eq("stakeholder_id", stakeholderId);
  if (error) return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  revalidatePath(base(projectId));
  revalidatePath(`${base(projectId)}/r/${reqId}`);
  return { ok: true, error: null };
}

export interface StoryDraftState {
  ok: boolean;
  error: string | null;
  draft: StoryDraft | null;
}

export async function suggestStoryDraftAction(
  projectId: string,
  _prevState: StoryDraftState,
  formData: FormData,
): Promise<StoryDraftState> {
  const t = await getTranslations("requirements");
  const supabase = createServiceSupabaseClient();
  const coveredIds = formData.getAll("coveredId").map(String).filter(Boolean);
  const { data } = await supabase
    .from("requirements")
    .select("display_id, text")
    .eq("project_id", projectId)
    .in("id", coveredIds.length ? coveredIds : ["00000000-0000-0000-0000-000000000000"]);
  const reqs = (data ?? []) as { display_id: string; text: string }[];
  if (reqs.length === 0) return { ok: false, error: t("errCoverRequired"), draft: null };
  try {
    const draft = await suggestStoryDraft(reqs.map((r) => ({ displayId: r.display_id, text: r.text })));
    return { ok: true, error: null, draft };
  } catch (e) {
    return {
      ok: false,
      error: t("errLlm", { message: e instanceof Error ? e.message : "?" }),
      draft: null,
    };
  }
}

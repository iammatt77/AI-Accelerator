"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { extractProcessMap, suggestToBeProcess } from "@/lib/llm";
import { loadNumberedSources } from "@/lib/sources";
import { layoutGraph } from "@/lib/processmap/model";
import { graphFromJson } from "@/lib/processmap/parse";
import type { PainPointRow, ProcessMapRow } from "@/lib/db/types";
import type { FormState } from "./actions";

// ─────────────────────────────────────────────────────────────
// Folyamattérkép-akciók (#10, Fázis 2): generálás.
//
// E1: az AI JAVASOL (draft), az ember korrigál/hagy jóvá. A nyers forrás
// (input_items) SOHA nem íródik felül — a térkép csak hivatkozza
// (source_input_id + node-onkénti [n] forrás-ref). Az eredeti AI-generált
// gráf original_snapshot-ba mentődik (változáskövetés) — a szerkesztés
// ezt nem módosítja.
//
// Verziózás: (project, kind)-onként a következő szabad verziószám — az
// újragenerálás/új iteráció új sort ír, a korábbi verziók megmaradnak.
// ─────────────────────────────────────────────────────────────

interface SupabaseErrorLike {
  message?: string;
}

function errMessage(error: SupabaseErrorLike | null): string {
  return error?.message ?? "?";
}

async function nextVersion(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  projectId: string,
  kind: "as_is" | "to_be",
): Promise<number> {
  const { data } = await supabase
    .from("process_maps")
    .select("version")
    .eq("project_id", projectId)
    .eq("kind", kind)
    .order("version", { ascending: false })
    .limit(1);
  const max = (data ?? [])[0]?.version ?? 0;
  return max + 1;
}

/**
 * Leiratból generálás — AS-IS-hez ÉS bevitt TO-BE-dokumentumhoz ugyanez a
 * belépő (kind szerint). A forrás-hivatkozás a kanonikus [n]-nel készül
 * (a citáció-rendszerrel konzisztensen). Siker esetén a nézetre irányít.
 */
export async function generateProcessMapAction(
  projectId: string,
  inputId: string,
  kind: "as_is" | "to_be",
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("processMap");
  const supabase = createServiceSupabaseClient();

  const loaded = await loadNumberedSources(supabase, projectId);
  if ("error" in loaded) {
    return { ok: false, error: loaded.error };
  }
  const idx = loaded.inputIds.indexOf(inputId);
  if (idx < 0) {
    return { ok: false, error: t("errInputNotFound") };
  }
  const source = loaded.sources[idx];
  const refLabel = `[${source.index}]`;

  let mapId: string;
  try {
    const proposal = await extractProcessMap(source, refLabel);
    if (proposal.graph.nodes.length === 0) {
      return { ok: true, error: null, notice: t("noticeNoSteps") };
    }
    const graph = layoutGraph(proposal.graph.nodes, proposal.graph.edges);
    const version = await nextVersion(supabase, projectId, kind);
    const { data, error } = await supabase
      .from("process_maps")
      .insert({
        project_id: projectId,
        phase: "P1",
        kind,
        title: proposal.title || source.title,
        status: "draft",
        version,
        source_input_id: inputId,
        to_be_origin: kind === "to_be" ? "document" : null,
        nodes: graph.nodes,
        edges: graph.edges,
        original_snapshot: { nodes: graph.nodes, edges: graph.edges },
        chat_log: [],
      })
      .select("id")
      .single();
    if (error || !data) {
      return { ok: false, error: t("errSave", { message: errMessage(error) }) };
    }
    mapId = (data as { id: string }).id;
  } catch (e) {
    return { ok: false, error: t("errLlm", { message: e instanceof Error ? e.message : "?" }) };
  }
  revalidatePath(`/project/${projectId}/process`);
  redirect(`/project/${projectId}/process/${mapId}`);
}

/**
 * TO-BE tervezés AI-javasolt eredettel: a nem-elvetett fájdalompontok + az
 * AS-IS lépéslista alapján. A source_input_id az AS-IS leirata marad, hogy a
 * nyers-leirat overlay a TO-BE nézetből is elérhető legyen.
 */
export async function suggestToBeAction(
  projectId: string,
  asIsMapId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("processMap");
  const supabase = createServiceSupabaseClient();

  const { data: asIsData } = await supabase
    .from("process_maps")
    .select("*")
    .eq("id", asIsMapId)
    .eq("project_id", projectId)
    .eq("kind", "as_is")
    .maybeSingle();
  if (!asIsData) {
    return { ok: false, error: t("errAsIsNotFound") };
  }
  const asIs = asIsData as ProcessMapRow;
  const asIsGraph = graphFromJson(asIs.nodes, asIs.edges);

  const { data: painData } = await supabase
    .from("pain_points")
    .select("title, description, state")
    .eq("project_id", projectId);
  const pains = ((painData ?? []) as Pick<PainPointRow, "title" | "description" | "state">[])
    .filter((p) => p.state !== "rejected")
    .map((p) => ({ title: p.title, description: p.description }));

  let mapId: string;
  try {
    const proposal = await suggestToBeProcess(
      asIsGraph.nodes.map((n) => ({ title: n.title, type: n.type, desc: n.desc })),
      pains,
    );
    if (proposal.graph.nodes.length === 0) {
      return { ok: true, error: null, notice: t("noticeNoSteps") };
    }
    const graph = layoutGraph(proposal.graph.nodes, proposal.graph.edges);
    const version = await nextVersion(supabase, projectId, "to_be");
    const { data, error } = await supabase
      .from("process_maps")
      .insert({
        project_id: projectId,
        phase: asIs.phase ?? "P1",
        kind: "to_be",
        title: proposal.title || t("toBeDefaultTitle"),
        status: "draft",
        version,
        source_input_id: asIs.source_input_id,
        to_be_origin: "ai_suggested",
        nodes: graph.nodes,
        edges: graph.edges,
        original_snapshot: { nodes: graph.nodes, edges: graph.edges },
        chat_log: [],
      })
      .select("id")
      .single();
    if (error || !data) {
      return { ok: false, error: t("errSave", { message: errMessage(error) }) };
    }
    mapId = (data as { id: string }).id;
  } catch (e) {
    return { ok: false, error: t("errLlm", { message: e instanceof Error ? e.message : "?" }) };
  }
  revalidatePath(`/project/${projectId}/process`);
  redirect(`/project/${projectId}/process/${mapId}`);
}


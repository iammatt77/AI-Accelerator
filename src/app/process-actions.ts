"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { chatEditProcess, extractProcessMap, suggestToBeProcess, type ChatProposal } from "@/lib/llm";
import { loadNumberedSources } from "@/lib/sources";
import { layoutGraph } from "@/lib/processmap/model";
import { applyChanges, chatLogFromJson, type ChatEntry } from "@/lib/processmap/chat";
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
    if (e instanceof Error && e.message === "PROCESS_MAP_TRUNCATED") {
      return { ok: false, error: t("errTruncated") };
    }
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


// ─────────────────────────────────────────────────────────────
// Chat-szerkesztés (#10, Fázis 4) — javaslat → alkalmazás/elvetés (HITL).
// Az asszisztens a strukturált lépéslistát javasolja módosítani; a nyers
// forráshoz (input_items) nem nyúl SEMELYIK akció. Jóváhagyott terv nem
// szerkeszthető — arra új iteráció való (Fázis 5).
// ─────────────────────────────────────────────────────────────

async function loadEditableMap(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  projectId: string,
  mapId: string,
): Promise<ProcessMapRow | { error: string }> {
  const t = await getTranslations("processMap");
  const { data } = await supabase
    .from("process_maps")
    .select("*")
    .eq("id", mapId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!data) return { error: t("errMapNotFound") };
  const map = data as ProcessMapRow;
  if (map.status === "approved") return { error: t("errChatApproved") };
  return map;
}

/** Chat-üzenet: az asszisztens javaslatot készít (pending) — nem alkalmaz. */
export async function processChatAction(
  projectId: string,
  mapId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("processMap");
  const supabase = createServiceSupabaseClient();
  const message = String(formData.get("message") ?? "").trim();
  if (!message) {
    return { ok: false, error: t("errChatEmpty") };
  }
  const map = await loadEditableMap(supabase, projectId, mapId);
  if ("error" in map) return { ok: false, error: map.error };

  const graph = graphFromJson(map.nodes, map.edges);
  const chatLog = chatLogFromJson(map.chat_log);
  // Egyszerre EGY pending javaslat él: az új kérés a régit elvetetté teszi
  // (az ember expliciten úgyis az utolsó előnézetről dönt).
  for (const e of chatLog) {
    if (e.proposal_status === "pending") e.proposal_status = "discarded";
  }

  let proposal: ChatProposal;
  try {
    proposal = await chatEditProcess(
      graph.nodes.map((n) => ({ id: n.id, title: n.title, sub: n.sub, type: n.type, desc: n.desc })),
      message,
    );
  } catch (e) {
    return { ok: false, error: t("errLlm", { message: e instanceof Error ? e.message : "?" }) };
  }

  const now = new Date().toISOString();
  chatLog.push({ role: "user", text: message, at: now });
  const reply: ChatEntry = {
    role: "assistant",
    text: proposal.reply || t("chatNoChangeReply"),
    at: now,
  };
  if (proposal.changes.length > 0) {
    reply.proposal = proposal.changes;
    reply.proposal_status = "pending";
  }
  chatLog.push(reply);

  const { error } = await supabase
    .from("process_maps")
    .update({ chat_log: chatLog, updated_at: now })
    .eq("id", mapId);
  if (error) {
    return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  }
  revalidatePath(`/project/${projectId}/process/${mapId}`);
  return { ok: true, error: null };
}

/** A pending javaslat alkalmazása az ábrán (az EMBER dönt — HITL). */
export async function applyChatProposalAction(
  projectId: string,
  mapId: string,
  entryIndex: number,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("processMap");
  const locale = await getLocale();
  const supabase = createServiceSupabaseClient();
  const map = await loadEditableMap(supabase, projectId, mapId);
  if ("error" in map) return { ok: false, error: map.error };

  const chatLog = chatLogFromJson(map.chat_log);
  const entry = chatLog[entryIndex];
  if (!entry || entry.role !== "assistant" || entry.proposal_status !== "pending" || !entry.proposal) {
    return { ok: false, error: t("errChatNoPending") };
  }

  const graph = graphFromJson(map.nodes, map.edges);
  const now = new Date();
  const dateStr = now.toLocaleDateString(locale === "hu" ? "hu-HU" : "en-GB", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const applied = applyChanges(graph, entry.proposal, t("chatLocStamp", { date: dateStr }));
  const laidOut = layoutGraph(applied.graph.nodes, applied.graph.edges);

  entry.proposal_status = "applied";
  chatLog.push({
    role: "assistant",
    text: t("chatAppliedMsg", {
      added: applied.added,
      modified: applied.modified,
      removed: applied.removed,
    }),
    at: now.toISOString(),
  });

  const { error } = await supabase
    .from("process_maps")
    .update({
      nodes: laidOut.nodes,
      edges: laidOut.edges,
      chat_log: chatLog,
      updated_at: now.toISOString(),
    })
    .eq("id", mapId);
  if (error) {
    return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  }
  revalidatePath(`/project/${projectId}/process/${mapId}`);
  return { ok: true, error: null };
}

/** A pending javaslat elvetése — az ábra érintetlen marad. */
export async function discardChatProposalAction(
  projectId: string,
  mapId: string,
  entryIndex: number,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("processMap");
  const supabase = createServiceSupabaseClient();
  const map = await loadEditableMap(supabase, projectId, mapId);
  if ("error" in map) return { ok: false, error: map.error };

  const chatLog = chatLogFromJson(map.chat_log);
  const entry = chatLog[entryIndex];
  if (!entry || entry.role !== "assistant" || entry.proposal_status !== "pending") {
    return { ok: false, error: t("errChatNoPending") };
  }
  entry.proposal_status = "discarded";
  const { error } = await supabase
    .from("process_maps")
    .update({ chat_log: chatLog, updated_at: new Date().toISOString() })
    .eq("id", mapId);
  if (error) {
    return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  }
  revalidatePath(`/project/${projectId}/process/${mapId}`);
  return { ok: true, error: null };
}

// ─────────────────────────────────────────────────────────────
// Egyben-jóváhagyás + új iteráció (#10, Fázis 5).
// A jóváhagyás a TELJES tervet zárja (E1: az ember dönt) — a verzió ezzel
// rögzül, az original_snapshot (az eredeti AI-verzió) megmarad a sorban.
// További munka: új iteráció (v+1) — a jóváhagyott állapot másolata friss
// diff-alappal (a snapshot az induló állapot, a diff-jegyzetek törlődnek).
// ─────────────────────────────────────────────────────────────

/** A terv egyben-jóváhagyása — a verzió ezzel zárul. */
export async function approveProcessMapAction(
  projectId: string,
  mapId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("processMap");
  const supabase = createServiceSupabaseClient();
  const { data } = await supabase
    .from("process_maps")
    .select("*")
    .eq("id", mapId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!data) return { ok: false, error: t("errMapNotFound") };
  const map = data as ProcessMapRow;
  if (map.status === "approved") {
    return { ok: true, error: null, notice: t("noticeAlreadyApproved") };
  }
  const { error } = await supabase
    .from("process_maps")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", mapId);
  if (error) {
    return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  }
  revalidatePath(`/project/${projectId}/process/${mapId}`);
  revalidatePath(`/project/${projectId}/process`);
  return { ok: true, error: null };
}

/** Új iteráció a jóváhagyott tervből: v+1 draft, friss diff-alappal. */
export async function newIterationAction(
  projectId: string,
  mapId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("processMap");
  const supabase = createServiceSupabaseClient();
  const { data } = await supabase
    .from("process_maps")
    .select("*")
    .eq("id", mapId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!data) return { ok: false, error: t("errMapNotFound") };
  const map = data as ProcessMapRow;

  // Friss alap: a mostani (jóváhagyott) állapot lesz a v+1 snapshotja,
  // a korábbi diff-jelzések nem öröklődnek.
  const graph = graphFromJson(map.nodes, map.edges);
  const cleanNodes = graph.nodes.map((n) => ({ ...n, diff: null, diff_note: null }));

  let newId: string;
  const version = await nextVersion(supabase, projectId, map.kind);
  const { data: inserted, error } = await supabase
    .from("process_maps")
    .insert({
      project_id: projectId,
      phase: map.phase,
      kind: map.kind,
      title: map.title,
      status: "draft",
      version,
      source_input_id: map.source_input_id,
      to_be_origin: map.to_be_origin,
      nodes: cleanNodes,
      edges: graph.edges,
      original_snapshot: { nodes: cleanNodes, edges: graph.edges },
      chat_log: [],
    })
    .select("id")
    .single();
  if (error || !inserted) {
    return { ok: false, error: t("errSave", { message: errMessage(error) }) };
  }
  newId = (inserted as { id: string }).id;
  revalidatePath(`/project/${projectId}/process`);
  redirect(`/project/${projectId}/process/${newId}`);
}

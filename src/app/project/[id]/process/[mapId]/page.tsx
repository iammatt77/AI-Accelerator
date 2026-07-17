import { notFound } from "next/navigation";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { ProcessMapViewer, type ProcessMapData } from "@/components/ProcessMapViewer";
import { computeDiff } from "@/lib/processmap/model";
import { graphFromJson, snapshotFromJson } from "@/lib/processmap/parse";
import type { InputItemRow, ProcessMapRow, ProjectRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Folyamattérkép-nézet route (#10): betölti a kért tervet + a MÁSIK kind
// legfrissebb verzióját (AS-IS/TO-BE váltó + compare) + a nyers leiratot
// (csak olvasható overlay). A diff szerver-oldalon számolódik az
// original_snapshot ellenében.
// ─────────────────────────────────────────────────────────────

function toMapData(row: ProcessMapRow): ProcessMapData {
  const graph = graphFromJson(row.nodes, row.edges);
  const snapshot = snapshotFromJson(row.original_snapshot);
  const diff = computeDiff(graph.nodes, snapshot.nodes);
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    status: row.status,
    version: row.version,
    toBeOrigin: row.to_be_origin,
    nodes: graph.nodes,
    edges: graph.edges,
    originalNodes: snapshot.nodes,
    originalEdges: snapshot.edges,
    diff,
  };
}

export default async function ProcessMapPage({
  params,
}: {
  params: Promise<{ id: string; mapId: string }>;
}) {
  const { id, mapId } = await params;
  const supabase = createServiceSupabaseClient();

  const [{ data: projectData }, { data: mapRowData }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase.from("process_maps").select("*").eq("id", mapId).eq("project_id", id).maybeSingle(),
  ]);
  if (!projectData || !mapRowData) notFound();
  const project = projectData as ProjectRow;
  const mapRow = mapRowData as ProcessMapRow;

  // A másik kind legfrissebb verziója (a váltóhoz/compare-hez).
  const otherKind = mapRow.kind === "as_is" ? "to_be" : "as_is";
  const { data: siblingData } = await supabase
    .from("process_maps")
    .select("*")
    .eq("project_id", id)
    .eq("kind", otherKind)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sibling = (siblingData as ProcessMapRow | null) ?? null;

  const current = toMapData(mapRow);
  const other = sibling ? toMapData(sibling) : null;
  const asIs = mapRow.kind === "as_is" ? current : other;
  const toBe = mapRow.kind === "to_be" ? current : other;

  // Nyers leirat (csak olvasható) — a térkép forrása.
  const srcId = mapRow.source_input_id ?? sibling?.source_input_id ?? null;
  let source: { title: string; text: string } | null = null;
  if (srcId) {
    const { data: inputData } = await supabase
      .from("input_items")
      .select("type, raw_text")
      .eq("id", srcId)
      .maybeSingle();
    if (inputData) {
      const input = inputData as Pick<InputItemRow, "type" | "raw_text">;
      source = { title: input.type, text: input.raw_text };
    }
  }

  return (
    <ProcessMapViewer
      projectId={id}
      projectLabel={`${project.name} / ${mapRow.phase ?? "P1"} / ${mapRow.title}`}
      asIs={asIs}
      toBe={toBe}
      initialKind={mapRow.kind}
      source={source}
    />
  );
}

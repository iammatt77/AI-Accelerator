import { notFound } from "next/navigation";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { ComponentDetail } from "@/components/ComponentDetail";
import { loadNumberedSources, inputIdsToIndices } from "@/lib/sources";
import { resolveApprovedToBe, spineFromMap } from "@/lib/solution/model";
import type {
  ComponentOptionRow,
  ComponentStepLinkRow,
  ProcessMapRow,
  ProjectRow,
  SolutionComponentRow,
} from "@/lib/db/types";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Komponens-részlet (#12, ref 2./3./4. jelenet): opció-összevető mátrix
// (folyamat-komp.), lefedettség-viz (infra), ∞ nem-kötött (személyi) +
// HITL-kiválasztás. A forrás-chipek a kanonikus [n] számozással.
// ─────────────────────────────────────────────────────────────

export default async function ComponentDetailPage({
  params,
}: {
  params: Promise<{ id: string; componentId: string }>;
}) {
  const { id, componentId } = await params;
  const supabase = createServiceSupabaseClient();

  const [{ data: projectData }, { data: compData }, { data: mapData }, { data: linkData }, { data: optData }] =
    await Promise.all([
      supabase.from("projects").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("solution_components")
        .select("*")
        .eq("id", componentId)
        .eq("project_id", id)
        .maybeSingle(),
      supabase
        .from("process_maps")
        .select("*")
        .eq("project_id", id)
        .eq("kind", "to_be")
        .order("version", { ascending: false }),
      supabase.from("component_step_links").select("*").eq("component_id", componentId),
      supabase
        .from("component_options")
        .select("*")
        .eq("component_id", componentId)
        .order("ord", { ascending: true }),
    ]);
  if (!projectData || !compData) notFound();
  const project = projectData as ProjectRow;
  const component = compData as SolutionComponentRow;

  const toBe = resolveApprovedToBe((mapData ?? []) as ProcessMapRow[]);
  const steps = toBe ? spineFromMap(toBe) : [];
  const links = (linkData ?? []) as ComponentStepLinkRow[];
  const options = (optData ?? []) as ComponentOptionRow[];

  // Forrás-chipek a kanonikus [n] számozással (traceability)
  const loaded = await loadNumberedSources(supabase, id);
  const sourceChips =
    "error" in loaded
      ? []
      : inputIdsToIndices(component.source_input_ids, loaded.inputIds).map((n) => ({
          n,
          title: loaded.sources[n - 1]?.title ?? "?",
        }));

  return (
    <main className="mx-auto flex w-full max-w-[1360px] flex-col gap-4 px-6 py-6">
      <ComponentDetail
        projectId={id}
        projectLabel={`${project.name} / P2`}
        component={component}
        steps={steps}
        links={links}
        options={options}
        sourceChips={sourceChips}
      />
    </main>
  );
}

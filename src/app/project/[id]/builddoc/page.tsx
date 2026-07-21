import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { BuildDocBoard } from "@/components/BuildDocBoard";
import { originLabel, planElements, seedCandidates } from "@/lib/builddoc/model";
import { resolveApprovedToBe, spineFromMap } from "@/lib/solution/model";
import { getTypeDef, parseArtifactFields } from "@/lib/artifacts/config";
import { implLinksFrom } from "@/lib/links";
import type {
  ArtifactRow,
  BuildComponentRow,
  ComponentLinkRow,
  ComponentOptionRow,
  ControlPointRow,
  PainPointRow,
  ProcessMapRow,
  ProjectRow,
  PromptItemRow,
  RequirementRow,
  SolutionComponentRow,
  StaleAckRow,
  UserStoryRow,
} from "@/lib/db/types";
import { activeStaleSince, originDriftSince } from "@/lib/staleness";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Megoldás-dokumentáció (#15) — belépő. A szerver mindent betölt: a
// build-entitásokat, a P2-seed jelölteket (strukturáltan — AC1), és a
// 4 kötés-cél terv-elemeit. Üres állapotnál is nyitva: a 7. jelenet
// a seedre / építési anyagra hív (nincs kemény kapu-fallback — a P2
// nélküli projektben a seed-lista üres, a manuális út él).
// ─────────────────────────────────────────────────────────────

export default async function BuildDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await getTranslations("builddoc"); // namespace-betöltés
  const supabase = createServiceSupabaseClient();

  const [
    { data: projectData },
    { data: compData },
    { data: linkData },
    { data: promptData },
    { data: ctrlData },
    { data: p2Data },
    { data: optData },
    { data: reqData },
    { data: storyData },
    { data: mapData },
    { data: painData },
    { data: artData },
    { data: inputData },
  ] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase.from("build_components").select("*").eq("project_id", id).order("ord"),
    supabase.from("component_links").select("*"),
    supabase.from("prompt_items").select("*").eq("project_id", id).order("ord"),
    supabase.from("control_points").select("*").eq("project_id", id).order("ord"),
    supabase
      .from("solution_components")
      .select("*")
      .eq("project_id", id)
      .order("created_at", { ascending: true }),
    supabase.from("component_options").select("*"),
    supabase.from("requirements").select("*").eq("project_id", id).order("display_id"),
    supabase.from("user_stories").select("*").eq("project_id", id).order("display_id"),
    supabase
      .from("process_maps")
      .select("*")
      .eq("project_id", id)
      .eq("kind", "to_be")
      .order("version", { ascending: false }),
    supabase
      .from("pain_points")
      .select("*")
      .eq("project_id", id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("artifacts")
      .select("*")
      .eq("project_id", id)
      .eq("type", "Megoldás-dokumentáció")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("input_items").select("id").eq("project_id", id),
  ]);
  if (!projectData) notFound();
  const project = projectData as ProjectRow;

  const components = (compData ?? []) as BuildComponentRow[];
  const compIds = new Set(components.map((c) => c.id));
  const links = implLinksFrom((linkData ?? []) as ComponentLinkRow[]).filter((l) =>
    compIds.has(l.component_id),
  );
  const prompts = (promptData ?? []) as PromptItemRow[];
  const controls = (ctrlData ?? []) as ControlPointRow[];
  const p2Components = (p2Data ?? []) as SolutionComponentRow[];
  const p2Ids = new Set(p2Components.map((c) => c.id));
  const options = ((optData ?? []) as ComponentOptionRow[]).filter((o) => p2Ids.has(o.component_id));

  const toBe = resolveApprovedToBe((mapData ?? []) as ProcessMapRow[]);
  const spine = toBe ? spineFromMap(toBe) : [];
  const elements = planElements(
    (reqData ?? []) as RequirementRow[],
    (storyData ?? []) as UserStoryRow[],
    spine,
    (painData ?? []) as PainPointRow[],
  );

  const seeds = seedCandidates(p2Components, options, components).map((s) => ({
    id: s.component.id,
    name: s.component.name,
    optionName: s.selectedOption?.name ?? null,
    extractedAs: s.extractedAs,
  }));
  const originLabels: Record<string, string> = {};
  for (const c of components) {
    const label = originLabel(c, p2Components);
    if (label) originLabels[c.id] = label;
  }

  // Csomag A (A8): derivált origin_drift — a P2-eredet a seed-átvétel után
  // változott; csak a még nem nyugtázott jelölők aktívak.
  const { data: ackData } = await supabase
    .from("stale_acks")
    .select("*")
    .eq("project_id", id);
  const staleAcks = (ackData ?? []) as StaleAckRow[];
  const p2ById = new Map(p2Components.map((c) => [c.id, c]));
  const driftIds = components
    .filter((c) => {
      if (!c.origin_component_id) return false;
      const since = originDriftSince(
        c.seeded_at,
        p2ById.get(c.origin_component_id)?.updated_at,
      );
      return activeStaleSince(since, staleAcks, "build_component", c.id, "origin_drift") !== null;
    })
    .map((c) => c.id);

  const artifact = artData as ArtifactRow | null;
  let docExtras = { architektura: false, integracio: false };
  if (artifact) {
    const typeDef = getTypeDef("Megoldás-dokumentáció");
    if (typeDef) {
      const fields = parseArtifactFields(typeDef, artifact.fields);
      docExtras = {
        architektura: (fields.architektura?.value ?? null) !== null,
        integracio: (fields.uzemeltetesi_jegyzet?.value ?? null) !== null,
      };
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-6 py-6">
      <BuildDocBoard
        projectId={id}
        projectLabel={`${project.name} / P3`}
        components={components}
        links={links}
        prompts={prompts}
        controls={controls}
        seeds={seeds}
        originLabels={originLabels}
        driftIds={driftIds}
        elements={elements}
        spine={spine.map((s) => ({ nodeId: s.nodeId, label: `TO-BE·${s.num}`, title: s.title }))}
        doc={artifact ? { id: artifact.id, status: artifact.status } : null}
        docExtras={docExtras}
        sourceCount={((inputData ?? []) as { id: string }[]).length}
      />
    </main>
  );
}

import { notFound } from "next/navigation";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { RequirementsBoard } from "@/components/RequirementsBoard";
import type {
  AcceptanceCriterionRow,
  EpicRow,
  ProjectRow,
  RequirementRow,
  RequirementStoryRow,
  StakeholderRequirementRow,
  StakeholderRow,
  UserStoryRow,
} from "@/lib/db/types";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Követelmények & story-k (#11) — belépő: EGY adat, KÉT nézet (BA-fa ⇄
// Agile epic→story), N:M kötéssel. A szerver mindent betölt, a nézet-váltó
// és a kijelölés-kiemelés kliens-állapot (RequirementsBoard).
// ─────────────────────────────────────────────────────────────

export default async function RequirementsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createServiceSupabaseClient();

  const [
    { data: projectData },
    { data: reqData },
    { data: acData },
    { data: epicData },
    { data: storyData },
    { data: linkData },
    { data: shLinkData },
    { data: shData },
  ] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("requirements")
      .select("*")
      .eq("project_id", id)
      .order("display_id", { ascending: true }),
    supabase.from("acceptance_criteria").select("*").order("ord", { ascending: true }),
    supabase.from("epics").select("*").eq("project_id", id).order("display_id", { ascending: true }),
    supabase
      .from("user_stories")
      .select("*")
      .eq("project_id", id)
      .order("display_id", { ascending: true }),
    supabase.from("requirement_stories").select("*"),
    supabase.from("stakeholder_requirements").select("*"),
    supabase.from("stakeholders").select("*").eq("project_id", id),
  ]);
  if (!projectData) notFound();
  const project = projectData as ProjectRow;

  const requirements = (reqData ?? []) as RequirementRow[];
  const reqIds = new Set(requirements.map((r) => r.id));
  const stories = (storyData ?? []) as UserStoryRow[];
  const storyIds = new Set(stories.map((s) => s.id));
  // A globálisan betöltött kapcsoló-táblákat a projekt sorai­ra szűkítjük.
  const acs = ((acData ?? []) as AcceptanceCriterionRow[]).filter((a) =>
    reqIds.has(a.requirement_id),
  );
  const links = ((linkData ?? []) as RequirementStoryRow[]).filter(
    (l) => reqIds.has(l.requirement_id) && storyIds.has(l.story_id),
  );
  const shLinks = ((shLinkData ?? []) as StakeholderRequirementRow[]).filter((l) =>
    reqIds.has(l.requirement_id),
  );

  return (
    <RequirementsBoard
      projectId={id}
      projectLabel={`${project.name} / P2`}
      requirements={requirements}
      acs={acs}
      epics={(epicData ?? []) as EpicRow[]}
      stories={stories}
      links={links}
      stakeholderLinks={shLinks}
      stakeholders={(shData ?? []) as StakeholderRow[]}
    />
  );
}

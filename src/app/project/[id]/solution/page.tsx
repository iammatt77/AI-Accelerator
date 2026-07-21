import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { SolutionBoard } from "@/components/SolutionBoard";
import { resolveApprovedToBe, spineFromMap } from "@/lib/solution/model";
import { stepLinksFrom } from "@/lib/links";
import type {
  ComponentLinkRow,
  ComponentOptionRow,
  ProcessMapRow,
  ProjectRow,
  SolutionComponentRow,
} from "@/lib/db/types";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Megoldás-terv (#12) — belépő: a JÓVÁHAGYOTT TO-BE folyamat a gerinc,
// fölé rétegzett komponensekkel és opciókkal. Jóváhagyott TO-BE nélkül a
// modul zárt (poka-yoke) — a gerinc nem fabrikálható.
// ─────────────────────────────────────────────────────────────

export default async function SolutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("solution");
  const supabase = createServiceSupabaseClient();

  const [{ data: projectData }, { data: mapData }, { data: compData }, { data: linkData }, { data: optData }] =
    await Promise.all([
      supabase.from("projects").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("process_maps")
        .select("*")
        .eq("project_id", id)
        .eq("kind", "to_be")
        .order("version", { ascending: false }),
      supabase
        .from("solution_components")
        .select("*")
        .eq("project_id", id)
        .order("created_at", { ascending: true }),
      supabase.from("component_links").select("*"),
      supabase.from("component_options").select("*"),
    ]);
  if (!projectData) notFound();
  const project = projectData as ProjectRow;

  const toBe = resolveApprovedToBe((mapData ?? []) as ProcessMapRow[]);

  if (!toBe) {
    // Poka-yoke: jóváhagyott TO-BE nélkül nincs gerinc — a modul irányít.
    return (
      <main className="mx-auto flex w-full max-w-[900px] flex-col gap-4 px-6 py-10">
        <div className="flex flex-col items-center gap-3 rounded-shell border-[1.5px] border-dashed border-[#EADFC0] bg-tint-gate/40 px-6 py-10 text-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-shell bg-gate text-[16px] font-bold text-white">!</span>
          <h1 className="text-[17px] font-extrabold tracking-[-0.01em]">{t("noApprovedTitle")}</h1>
          <p className="max-w-[520px] text-[13px] leading-[1.55] text-ink-secondary">{t("noApprovedText")}</p>
          <Link
            href={`/project/${id}/process`}
            className="mt-1 rounded-control bg-action px-4 py-2 text-[12.5px] font-bold text-white"
          >
            {t("noApprovedCta")} ↗
          </Link>
        </div>
      </main>
    );
  }

  const steps = spineFromMap(toBe);
  const components = (compData ?? []) as SolutionComponentRow[];
  const compIds = new Set(components.map((c) => c.id));
  // A globálisan betöltött kapcsoló-táblákat a projekt komponenseire szűkítjük.
  const links = stepLinksFrom((linkData ?? []) as ComponentLinkRow[]).filter((l) =>
    compIds.has(l.component_id),
  );
  const options = ((optData ?? []) as ComponentOptionRow[]).filter((o) => compIds.has(o.component_id));

  return (
    <main className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-6 py-6">
      <SolutionBoard
        projectId={id}
        projectLabel={`${project.name} / P2`}
        mapId={toBe.id}
        tobeVersion={toBe.version}
        steps={steps}
        components={components}
        links={links}
        options={options}
      />
    </main>
  );
}

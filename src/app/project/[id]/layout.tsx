import { notFound } from "next/navigation";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { loadPhaseBoard } from "@/lib/phases/service";
import { PHASE_IDS, type PhaseId } from "@/lib/phases/config";
import { ProjectContextNav } from "@/components/ProjectContextNav";
import { PageTransition } from "@/components/PageTransition";
import type { ProjectRow } from "@/lib/db/types";

// Projekt-útvonalak kerete (Master ◆ SIDEBAR): a globális sidebar mellett
// megjelenik a KONTEXTUÁLIS második oszlop. A badge és az aktív fázis a
// meglévő fázis-board kiértékelésből számolt — nincs új akció/adatmodell.

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createServiceSupabaseClient();

  const { data: projectData } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!projectData) notFound();
  const project = projectData as ProjectRow;

  const board = await loadPhaseBoard(supabase, id);
  const byPhase = new Map(board.map((e) => [e.phase, e]));

  // Aktív fázis: az első in_progress/gate_pending; ha nincs, az első open;
  // végső fallback P0.
  const activePhase: PhaseId =
    PHASE_IDS.find((p) => {
      const s = byPhase.get(p)?.state;
      return s === "in_progress" || s === "gate_pending";
    }) ??
    PHASE_IDS.find((p) => byPhase.get(p)?.state === "open") ??
    "P0";

  // Dokumentumok-badge = a kaput blokkoló elemek száma (az aktív fázis
  // nem teljesülő kritériumai).
  const activeEntry = byPhase.get(activePhase);
  const docsBadge = (activeEntry?.criteria ?? []).filter((c) => !c.satisfied).length;

  // Zárolt fázisok tartománya (pl. "P2–P6").
  const locked = PHASE_IDS.filter((p) => byPhase.get(p)?.state === "locked");
  const lockedRange =
    locked.length === 0
      ? ""
      : locked.length === 1
        ? locked[0]
        : `${locked[0]}–${locked[locked.length - 1]}`;

  return (
    <>
      <ProjectContextNav
        nav={{
          projectId: id,
          clientName: project.name,
          activePhase,
          docsBadge,
          lockedRange,
        }}
      />
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1360px] px-6 py-7">
          <PageTransition initialMotion="push-in">{children}</PageTransition>
        </div>
      </main>
    </>
  );
}

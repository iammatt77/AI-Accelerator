import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { computeNextStep, countCompleted, loadPhaseBoard } from "@/lib/phases/service";
import { nextStepLabel } from "@/components/NextStep";
import { PhaseStepperV2 } from "@/components/PhaseStepper";
import type { ClientRow, ProjectRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

// Dashboard — projekt-kártyák: név, ügyfél, mini fázis-progressz,
// következő lépés egy sorban. Egyszerű: egy user, kevés projekt.

interface ProjectWithClient extends ProjectRow {
  clients: Pick<ClientRow, "name" | "industry"> | null;
}

export default async function DashboardPage() {
  const supabase = createServiceSupabaseClient();
  const [tDashboard, tClients, tEmpty, tErrors] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("clients"),
    getTranslations("empty"),
    getTranslations("errors"),
  ]);

  const { data, error } = await supabase
    .from("projects")
    .select("*, clients ( name, industry )")
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(tErrors("projectsFetchFailed", { message: error.message }));
  }
  const projects = (data ?? []) as ProjectWithClient[];

  const cards = await Promise.all(
    projects.map(async (project) => {
      const board = await loadPhaseBoard(supabase, project.id);
      const step = computeNextStep(board);
      return {
        project,
        board: board.map(({ phase, state }) => ({ phase, state })),
        completed: countCompleted(board),
        stepText: await nextStepLabel(step),
      };
    }),
  );

  return (
    <div>
      <h1 className="text-title">{tDashboard("title")}</h1>
      <p className="mt-1 text-body text-ink-secondary">{tDashboard("lead")}</p>

      <ul className="mt-6 grid gap-4 lg:grid-cols-2">
        {cards.length === 0 && (
          <li className="rounded-tile border border-dashed border-line p-6 text-body text-ink-tertiary">
            {tEmpty("noProjects")}
          </li>
        )}
        {cards.map(({ project, board, completed, stepText }) => (
          <li key={project.id}>
            <Link
              href={`/project/${project.id}`}
              className="glass-tile glass-tile-interactive block p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-medium">{project.name}</span>
                <span className="shrink-0 font-mono text-mono-sm text-ink-tertiary">
                  {tDashboard("progressLabel", { completed })}
                </span>
              </div>
              <div className="mt-0.5 text-body text-ink-secondary">
                {project.clients?.name ?? tClients("unknown")}
                {project.clients?.industry ? ` · ${project.clients.industry}` : ""}
              </div>
              <div className="mt-3">
                {/* interactive={false}: a kártya maga Link — nincs beágyazott anchor */}
                <PhaseStepperV2
                  projectId={project.id}
                  board={board}
                  size="xs"
                  interactive={false}
                />
              </div>
              <div className="mt-3 border-t border-line pt-2 text-body">
                <span className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
                  {tDashboard("nextStepLabel")}
                </span>
                <span className="ml-2">{stepText}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

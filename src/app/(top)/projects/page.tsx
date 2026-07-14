import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { createClientAndProject } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { ProjectListCard } from "@/components/ProjectListCard";
import { loadProjectListCard, type ProjectListStatus } from "@/lib/projects/list-card";
import type { ClientRow, ProjectRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

// Projektek — valós lista (Dashboard-kártya nyelvén, X/7 lezárva-
// progresszussal) + a #1-es kliens+projekt-létrehozó flow.

interface ProjectWithClient extends ProjectRow {
  clients: Pick<ClientRow, "name" | "industry"> | null;
}

async function loadProjects(): Promise<ProjectWithClient[]> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*, clients ( name, industry )")
    .order("created_at", { ascending: false });
  if (error) {
    const t = await getTranslations("errors");
    throw new Error(t("projectsFetchFailed", { message: error.message }));
  }
  return (data ?? []) as ProjectWithClient[];
}

const STATUS_LABEL_KEY: Record<Exclude<ProjectListStatus, "healthy">, string> = {
  needs_you: "statusNeedsYou",
  gate: "statusGate",
  stalled: "statusStalled",
};

export default async function ProjectsPage() {
  const supabase = createServiceSupabaseClient();
  const [projects, tCommon, tClients, tProjects, tDash, tEmpty] = await Promise.all([
    loadProjects(),
    getTranslations("common"),
    getTranslations("clients"),
    getTranslations("projects"),
    getTranslations("dashboard"),
    getTranslations("empty"),
  ]);

  const cards = await Promise.all(
    projects.map(async (project) => {
      const card = await loadProjectListCard(supabase, project.id, project.created_at);
      const initials = (project.clients?.name ?? project.name)
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
      return { project, card, initials };
    }),
  );

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* Projektlista */}
      <section>
        <h1 className="text-title">{tProjects("listTitle")}</h1>

        {cards.length === 0 ? (
          <p className="mt-6 rounded-tile border border-dashed border-line p-6 text-body text-ink-tertiary">
            {tEmpty("noProjects")}
          </p>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            {cards.map(({ project, card, initials }) => (
              <ProjectListCard
                key={project.id}
                href={`/project/${project.id}`}
                name={project.name}
                clientName={project.clients?.name ?? tClients("unknown")}
                industry={project.clients?.industry ?? ""}
                initials={initials}
                status={card.status}
                statusLabel={
                  card.status === "healthy" ? null : tDash(STATUS_LABEL_KEY[card.status])
                }
                progressLabel={tProjects("progressLabel", {
                  closed: card.closedCount,
                  total: card.totalPhases,
                })}
                activePhaseLabel={
                  card.activePhase
                    ? tProjects("activePhaseLabel", { phase: card.activePhase })
                    : null
                }
                spine={card.spine}
              />
            ))}
          </div>
        )}
      </section>

      {/* (a) Kliens + projekt létrehozása (#1 flow) */}
      <section className="h-fit rounded-shell border border-line bg-surface p-5 shadow-card">
        <h2 className="text-body font-semibold">{tClients("newTitle")}</h2>
        <form action={createClientAndProject} className="mt-4 space-y-3">
          <Field label={tClients("nameLabel")} name="clientName" required />
          <Field label={tClients("industryLabel")} name="industry" />
          <Field label={tProjects("nameLabel")} name="projectName" required />
          <Field
            label={tProjects("packageLabel")}
            name="package"
            placeholder={tProjects("packagePlaceholder")}
          />
          <SubmitButton pendingLabel={tCommon("creating")} className="w-full">
            {tCommon("create")}
          </SubmitButton>
        </form>
      </section>
    </div>
  );
}

function Field({
  label,
  name,
  required,
  placeholder,
}: {
  label: string;
  name: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-mono-sm font-medium text-ink-secondary">{label}</span>
      <input
        name={name}
        required={required}
        placeholder={placeholder}
        className="mt-1 w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
      />
    </label>
  );
}

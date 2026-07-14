import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { createClientAndProject } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import type { ClientRow, ProjectRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

// Projektek — valós lista + a #1-es kliens+projekt-létrehozó flow
// (a nav-vázba illesztve; a dashboard a főoldalra került).

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

export default async function ProjectsPage() {
  const [projects, tCommon, tClients, tProjects, tEmpty] = await Promise.all([
    loadProjects(),
    getTranslations("common"),
    getTranslations("clients"),
    getTranslations("projects"),
    getTranslations("empty"),
  ]);

  return (
    <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_320px]">
      {/* Projektlista */}
      <section>
        <h1 className="text-title">{tProjects("listTitle")}</h1>

        <ul className="mt-6 space-y-3">
          {projects.length === 0 && (
            <li className="rounded-tile border border-dashed border-line p-6 text-body text-ink-tertiary">
              {tEmpty("noProjects")}
            </li>
          )}
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/project/${project.id}`}
                className="surface-card surface-card-interactive block p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{project.name}</span>
                  <span className="rounded-pill border border-line px-2 py-0.5 text-mono-sm font-sans text-ink-tertiary">
                    {project.package ?? "—"}
                  </span>
                </div>
                <div className="mt-1 text-body text-ink-secondary">
                  {project.clients?.name ?? tClients("unknown")}
                  {project.clients?.industry ? ` · ${project.clients.industry}` : ""}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* (a) Kliens + projekt létrehozása (#1 flow) */}
      <section>
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

import Link from "next/link";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { createClientAndProject } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import type { ClientRow, ProjectRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

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
    throw new Error(`Projektek lekérése sikertelen: ${error.message}`);
  }
  return (data ?? []) as ProjectWithClient[];
}

export default async function HomePage() {
  const projects = await loadProjects();

  return (
    <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_320px]">
      {/* Projektlista */}
      <section>
        <h1 className="text-lg font-semibold">Projektek</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Nyers anyag → szerveroldali generálás → draft → jóváhagyás.
        </p>

        <ul className="mt-6 space-y-3">
          {projects.length === 0 && (
            <li className="rounded-lg border border-dashed border-[var(--border)] p-6 text-sm text-[var(--muted)]">
              Még nincs projekt. Hozz létre egyet jobbra.
            </li>
          )}
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/project/${project.id}`}
                className="block rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 transition-colors hover:border-[var(--accent)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{project.name}</span>
                  <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">
                    {project.package ?? "—"}
                  </span>
                </div>
                <div className="mt-1 text-sm text-[var(--muted)]">
                  {project.clients?.name ?? "ismeretlen ügyfél"}
                  {project.clients?.industry ? ` · ${project.clients.industry}` : ""}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* (a) Kliens + projekt létrehozása */}
      <section>
        <h2 className="text-sm font-semibold">Új kliens + projekt</h2>
        <form action={createClientAndProject} className="mt-4 space-y-3">
          <Field label="Ügyfél neve" name="clientName" required />
          <Field label="Iparág" name="industry" />
          <Field label="Projekt neve" name="projectName" required />
          <Field label="Csomag" name="package" placeholder="pl. Discovery" />
          <SubmitButton pendingLabel="Létrehozás…" className="w-full">
            Létrehozás
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
      <span className="text-xs font-medium text-[var(--muted)]">{label}</span>
      <input
        name={name}
        required={required}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
      />
    </label>
  );
}

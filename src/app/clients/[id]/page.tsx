import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ClientRow, ProjectRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

// Ügyfél-lap: adatok + a kliens projektjei.

export default async function ClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createServiceSupabaseClient();

  const { data: client } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!client) notFound();
  const row = client as ClientRow;

  const [locale, tClients, tEmpty] = await Promise.all([
    getLocale(),
    getTranslations("clients"),
    getTranslations("empty"),
  ]);
  const dateLocale = locale === "hu" ? "hu-HU" : "en-GB";
  const dateOptions = { timeZone: "Europe/Budapest" } as const;

  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .eq("client_id", id)
    .order("created_at", { ascending: false });
  const projectRows = (projects ?? []) as ProjectRow[];

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/clients"
          className="text-mono-sm text-ink-tertiary hover:text-ink-secondary hover:underline"
        >
          ← {tClients("listTitle")}
        </Link>
        <h1 className="mt-2 text-title">{row.name}</h1>
      </div>

      {/* Ügyfél-adatok — süllyesztett kontextus-kártya (törvény 6) */}
      <section className="card-sunken max-w-md p-4">
        <dl className="space-y-1.5 text-body">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-tertiary">{tClients("industryLabel")}</dt>
            <dd>{row.industry ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-tertiary">{tClients("sinceLabel")}</dt>
            <dd>
              {new Date(row.created_at).toLocaleDateString(dateLocale, dateOptions)}
            </dd>
          </div>
        </dl>
      </section>

      {/* A kliens projektjei */}
      <section>
        <h2 className="mb-3 text-body font-semibold">{tClients("projectsOfClient")}</h2>
        <ul className="space-y-3">
          {projectRows.length === 0 && (
            <li className="rounded-tile border border-dashed border-line p-6 text-body text-ink-tertiary">
              {tClients("noProjects")}
            </li>
          )}
          {projectRows.map((project) => (
            <li key={project.id}>
              <Link
                href={`/project/${project.id}`}
                className="glass-tile glass-tile-interactive block p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{project.name}</span>
                  <span className="rounded-pill border border-line px-2 py-0.5 text-mono-sm font-sans text-ink-tertiary">
                    {project.package ?? "—"}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

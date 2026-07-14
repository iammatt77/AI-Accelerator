import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { ProjectListCard } from "@/components/ProjectListCard";
import { loadProjectListCard, type ProjectListStatus } from "@/lib/projects/list-card";
import type { ClientRow, ProjectRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

// Ügyfél-lap: adatok (süllyesztett kontextus-kártya) + a kliens
// projektjei — ugyanazzal a ProjectListCard-dal, mint a Projektek lista.

const STATUS_LABEL_KEY: Record<Exclude<ProjectListStatus, "healthy">, string> = {
  needs_you: "statusNeedsYou",
  gate: "statusGate",
  stalled: "statusStalled",
};

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

  const [locale, tClients, tProjects, tDash] = await Promise.all([
    getLocale(),
    getTranslations("clients"),
    getTranslations("projects"),
    getTranslations("dashboard"),
  ]);
  const dateLocale = locale === "hu" ? "hu-HU" : "en-GB";
  const dateOptions = { timeZone: "Europe/Budapest" } as const;

  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .eq("client_id", id)
    .order("created_at", { ascending: false });
  const projectRows = (projects ?? []) as ProjectRow[];
  const initials = row.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const cards = await Promise.all(
    projectRows.map(async (project) => ({
      project,
      card: await loadProjectListCard(supabase, project.id, project.created_at),
    })),
  );

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
        {cards.length === 0 ? (
          <p className="rounded-tile border border-dashed border-line p-6 text-body text-ink-tertiary">
            {tClients("noProjects")}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {cards.map(({ project, card }) => (
              <ProjectListCard
                key={project.id}
                href={`/project/${project.id}`}
                name={project.name}
                clientName={row.name}
                industry={row.industry ?? ""}
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
    </div>
  );
}

import { getLocale, getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { createClientAndProject } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { ProjectListCard } from "@/components/ProjectListCard";
import {
  ProjectsBoard,
  type BoardCard,
  type BoardColumn,
  type CardVariant,
} from "@/components/ProjectsBoard";
import { loadProjectListCard, type ProjectListStatus } from "@/lib/projects/list-card";
import { loadProjectStates } from "@/lib/projects/state";
import { isTestProject } from "@/lib/clients/portfolio";
import { criterionLabel } from "@/lib/phases/criterion-label";
import { PHASE_IDS } from "@/lib/phases/config";
import type { ClientRow, ProjectRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

// Projektek — fázis-pipeline board (ref_projektek.html) az ÚJ alapértelmezett;
// a régi kártyarács a nézetváltó „Lista" mögött él tovább. Az élő adat a KÖZÖS
// portfolio.ts/state.ts származtatásból (mint az Ügyfelek-lap); az érték szürke
// placeholder. Teszt/piszkozat projektek alapból rejtve.

interface ProjectWithClient extends ProjectRow {
  clients: Pick<ClientRow, "name" | "industry"> | null;
}

const STATUS_LABEL_KEY: Record<Exclude<ProjectListStatus, "healthy">, string> = {
  needs_you: "statusNeedsYou",
  gate: "statusGate",
  stalled: "statusStalled",
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default async function ProjectsPage() {
  const supabase = createServiceSupabaseClient();
  const [locale, tCommon, tClients, tProjects, tDash, tEmpty, tCriteria, tTypes, tPhases] =
    await Promise.all([
      getLocale(),
      getTranslations("common"),
      getTranslations("clients"),
      getTranslations("projects"),
      getTranslations("dashboard"),
      getTranslations("empty"),
      getTranslations("criteria"),
      getTranslations("artifactTypes"),
      getTranslations("phases"),
    ]);
  const dateLocale = locale === "hu" ? "hu-HU" : "en-GB";
  const tz = { timeZone: "Europe/Budapest" } as const;
  const nowMs = Date.now();
  const shortDate = (iso: string) =>
    new Date(iso).toLocaleDateString(dateLocale, { ...tz, month: "short", day: "numeric" });

  const { data: projectData } = await supabase
    .from("projects")
    .select("*, clients ( name, industry )")
    .order("created_at", { ascending: false });
  const projects = (projectData ?? []) as ProjectWithClient[];

  const states = await loadProjectStates(supabase, projects, nowMs);

  // Élő projekt → board-kártya (a közös állapotból; érték szürke placeholder).
  function toCard(project: ProjectWithClient): BoardCard {
    const s = states.get(project.id)!;
    let variant: CardVariant;
    let nextStep: string;
    if (s.attention === "closed") {
      variant = "closed";
      nextStep = tClients("todoClosed");
    } else if (s.attention === "stalled") {
      variant = "stalled";
      nextStep = tClients("todoStalled", { n: s.days });
    } else if (s.attention === "blocked") {
      variant = s.met > 0 ? "needsYou" : "gateBlocked";
      nextStep = tClients("todoGate", {
        met: s.met,
        total: s.total,
        criterion: s.firstUnmet ? criterionLabel(s.firstUnmet, tCriteria, tTypes) : "",
      });
    } else if (s.attention === "ready") {
      variant = "ready";
      nextStep = tClients("todoReady", { met: s.met, total: s.total, next: s.nextPhase });
    } else {
      variant = "healthy";
      nextStep = tClients("todoHealthy");
    }
    return {
      id: project.id,
      name: project.name,
      clientName: project.clients?.name ?? tClients("unknown"),
      industry: project.clients?.industry ?? null,
      initials: initialsOf(project.clients?.name ?? project.name),
      phase: s.phase,
      variant,
      nextStep,
      lastLabel: shortDate(s.lastIso),
      lastDanger: s.attention === "stalled",
    };
  }

  // Teszt/piszkozat elkülönítés (dokumentált kritérium a portfolio.ts-ben).
  const visible: BoardCard[] = [];
  const hiddenCards: BoardCard[] = [];
  const hiddenNames: string[] = [];
  for (const p of projects) {
    if (isTestProject(p.name, p.clients?.name ?? null)) {
      hiddenCards.push(toCard(p));
      hiddenNames.push(p.name);
    } else {
      visible.push(toCard(p));
    }
  }

  const columns: BoardColumn[] = PHASE_IDS.map((phase) => ({
    phase,
    phaseName: tPhases(`${phase.toLowerCase()}.short`),
    cards: visible.filter((c) => c.phase === phase),
  }));

  // Státusz-sor (élő): hány projekt vár rád + miért.
  const blocked = visible.filter(
    (c) => c.variant === "needsYou" || c.variant === "gateBlocked",
  ).length;
  const ready = visible.filter((c) => c.variant === "ready").length;
  const stalledCards = visible.filter((c) => c.variant === "stalled");
  const n = blocked + ready + stalledCards.length;
  const reasons: string[] = [];
  if (blocked > 0) reasons.push(tProjects("reasonGate", { n: blocked }));
  if (ready > 0) reasons.push(tProjects("reasonReady", { n: ready }));
  if (stalledCards.length > 0) reasons.push(tProjects("reasonStalled", { n: stalledCards.length }));
  let statusLine =
    n === 0
      ? tProjects("boardAllClear")
      : tProjects("boardStatus", { n, reasons: reasons.join(", ") });
  if (stalledCards.length > 0) {
    const top = stalledCards.reduce((a, b) =>
      states.get(b.id)!.days > states.get(a.id)!.days ? b : a,
    );
    statusLine +=
      " " + tProjects("boardStalledName", { name: top.clientName, n: states.get(top.id)!.days });
  }

  const activeCount = visible.filter((c) => c.variant !== "closed").length;
  const closedCount = visible.filter((c) => c.variant === "closed").length;

  // Lista-nézet (a régi kártyarács, változatlan logikával).
  const listCards = await Promise.all(
    projects.map(async (project) => {
      const card = await loadProjectListCard(supabase, project.id, project.created_at);
      return { project, card, initials: initialsOf(project.clients?.name ?? project.name) };
    }),
  );
  const listView =
    listCards.length === 0 ? (
      <p className="rounded-tile border border-dashed border-line p-6 text-body text-ink-tertiary">
        {tEmpty("noProjects")}
      </p>
    ) : (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {listCards.map(({ project, card, initials }) => (
          <ProjectListCard
            key={project.id}
            href={`/project/${project.id}`}
            name={project.name}
            clientName={project.clients?.name ?? tClients("unknown")}
            industry={project.clients?.industry ?? ""}
            initials={initials}
            status={card.status}
            statusLabel={card.status === "healthy" ? null : tDash(STATUS_LABEL_KEY[card.status])}
            progressLabel={tProjects("progressLabel", {
              closed: card.closedCount,
              total: card.totalPhases,
            })}
            activePhaseLabel={
              card.activePhase ? tProjects("activePhaseLabel", { phase: card.activePhase }) : null
            }
            spine={card.spine}
          />
        ))}
      </div>
    );

  const createForm = (
    <>
      <h2 className="text-body font-semibold">{tClients("newTitle")}</h2>
      <form action={createClientAndProject} className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label={tClients("nameLabel")} name="clientName" required />
        <Field label={tClients("industryLabel")} name="industry" />
        <Field label={tProjects("nameLabel")} name="projectName" required />
        <Field
          label={tProjects("packageLabel")}
          name="package"
          placeholder={tProjects("packagePlaceholder")}
        />
        <div className="sm:col-span-2">
          <SubmitButton pendingLabel={tCommon("creating")} className="w-full sm:w-auto">
            {tCommon("create")}
          </SubmitButton>
        </div>
      </form>
    </>
  );

  return (
    <ProjectsBoard
      columns={columns}
      hiddenCards={hiddenCards}
      hiddenNames={hiddenNames}
      statusLine={statusLine}
      activeCount={activeCount}
      closedCount={closedCount}
      listView={listView}
      createForm={createForm}
    />
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

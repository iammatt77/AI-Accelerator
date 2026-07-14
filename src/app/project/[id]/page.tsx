import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import {
  computeNextStep,
  countCompleted,
  countOpenGates,
  loadPhaseBoard,
} from "@/lib/phases/service";
import { getTypeDef } from "@/lib/artifacts/config";
import { criterionLabel } from "@/lib/phases/criterion-label";
import { StatusPill } from "@/components/StatusPill";
import { PhaseStepperV1 } from "@/components/PhaseStepper";
import { NextStepWidget } from "@/components/NextStep";
import { PhaseStateIcon, PHASE_STATE_TEXT } from "@/components/icons";
import type {
  ArtifactRow,
  ClientRow,
  InputItemRow,
  ProjectRow,
} from "@/lib/db/types";

export const dynamic = "force-dynamic";

interface ProjectWithClient extends ProjectRow {
  clients: ClientRow | null;
}

async function loadWorkspace(projectId: string) {
  const supabase = createServiceSupabaseClient();

  const { data: project } = await supabase
    .from("projects")
    .select("*, clients ( * )")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) return null;

  const [
    { data: inputs },
    { data: artifacts },
    board,
    { count: painCount },
    { count: useCaseCount },
  ] = await Promise.all([
    supabase
      .from("input_items")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    supabase
      .from("artifacts")
      .select("*")
      .eq("project_id", projectId)
      // „Legutóbbi" = utoljára érintett: a verziószám #5a óta típusonként
      // számolódik, típusok KÖZÖTT nem közelíti a frissességet.
      .order("updated_at", { ascending: false }),
    loadPhaseBoard(supabase, projectId),
    // #7a: valós entitás-számlálók — MEGERŐSÍTETT (confirmed/manual)
    // fájdalompontok és use case-ek (az 1d mockup chipjei élesítve).
    supabase
      .from("pain_points")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .in("state", ["confirmed", "manual"]),
    supabase
      .from("use_cases")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .in("state", ["confirmed", "manual"]),
  ]);

  return {
    project: project as ProjectWithClient,
    inputs: (inputs ?? []) as InputItemRow[],
    artifacts: (artifacts ?? []) as ArtifactRow[],
    board,
    painCount: painCount ?? 0,
    useCaseCount: useCaseCount ?? 0,
  };
}

export default async function ProjectCockpitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadWorkspace(id);
  if (!data) notFound();

  const { project, inputs, artifacts, board, painCount, useCaseCount } = data;

  const [locale, tCockpit, tClients, tArtifacts, tTypes, tEmpty, tGates, tCriteria, tLex] =
    await Promise.all([
      getLocale(),
      getTranslations("cockpit"),
      getTranslations("clients"),
      getTranslations("artifacts"),
      getTranslations("artifactTypes"),
      getTranslations("empty"),
      getTranslations("gates"),
      getTranslations("criteria"),
      getTranslations("phases.lexicon"),
    ]);
  // Lokalizált típusnév, ha van típusdefiníció (örökség-típus: nyers kulcs).
  const typeName = (type: string) => {
    const def = getTypeDef(type);
    return def ? tTypes(def.nameKey.replace(/^artifactTypes\./, "")) : type;
  };
  const dateLocale = locale === "hu" ? "hu-HU" : "en-GB";
  // Szerver-komponensben formázunk: időzóna nélkül a SZERVER (prod: UTC)
  // zónájában jelenne meg minden időbélyeg — fixen Europe/Budapest.
  const dateOptions = { timeZone: "Europe/Budapest" } as const;

  const statusLabel = (status: ArtifactRow["status"]) =>
    tArtifacts(`status.${status}`);

  // Állapotgépből számított kijelzők
  const nextStep = computeNextStep(board);
  const completed = countCompleted(board);
  const openGates = countOpenGates(board);
  const currentPhase = board.find((entry) => entry.state !== "completed") ?? null;
  const week = Math.max(
    1,
    Math.floor(
      (Date.now() - new Date(project.created_at).getTime()) / (7 * 24 * 3600 * 1000),
    ) + 1,
  );

  const recentArtifacts = artifacts.slice(0, 3);

  return (
    <div className="space-y-6">
      {/* Fejléc: breadcrumb + hét-számláló */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav className="text-mono-sm text-ink-tertiary">
            {project.clients ? (
              <Link
                href={`/clients/${project.clients.id}`}
                className="hover:text-ink-secondary hover:underline"
              >
                {project.clients.name}
              </Link>
            ) : (
              tClients("unknown")
            )}
            <span className="mx-1">/</span>
            <Link href="/projects" className="hover:text-ink-secondary hover:underline">
              {tCockpit("backToProjects")}
            </Link>
          </nav>
          <h1 className="mt-1 text-title">{project.name}</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-pill border border-line bg-surface px-2.5 py-1 font-mono text-mono-sm text-ink-secondary">
            {tCockpit("weekCounter", { week })}
          </span>
          <span className="rounded-pill border border-line bg-surface px-2.5 py-1 font-mono text-mono-sm text-ink-secondary">
            {tCockpit("phasesClosed", { completed })}
          </span>
        </div>
      </div>

      {/* Stepper V1 — hős-elem */}
      <PhaseStepperV1
        projectId={id}
        board={board.map(({ phase, state }) => ({ phase, state }))}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {/* Következő legjobb lépés — számított */}
          <NextStepWidget projectId={id} step={nextStep} />

          {/* Stat-chipek: csak létező entitásból (C melléklet); a
              fájdalompont/use case chip a P1 munkaterületre visz (#7a) */}
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            <StatChip value={inputs.length} label={tCockpit("statInputs")} />
            <StatChip value={artifacts.length} label={tCockpit("statArtifacts")} />
            <StatChip value={openGates} label={tCockpit("statOpenGates")} />
            <StatChip
              value={painCount}
              label={tCockpit("statPainPoints")}
              href={`/project/${id}/phase/P1`}
            />
            <StatChip
              value={useCaseCount}
              label={tCockpit("statUseCases")}
              href={`/project/${id}/phase/P1`}
            />
          </div>

          {/* Legutóbbi artefaktumok (max 3) + belépő a tárba (#5b) */}
          <section className="surface-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
                {tCockpit("recentArtifacts")}
              </h2>
              <Link
                href={`/project/${id}/documents`}
                className="text-mono-sm font-medium text-ink-secondary hover:text-ink hover:underline"
              >
                {tCockpit("documentsLink")}
              </Link>
            </div>
            {recentArtifacts.length === 0 ? (
              <p className="mt-2 text-body text-ink-tertiary">{tEmpty("noArtifact")}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {recentArtifacts.map((artifact) => (
                  <li key={artifact.id}>
                    <Link
                      href={`/project/${id}/artifact/${artifact.id}`}
                      className="flex items-center justify-between gap-3 rounded-tile border border-line bg-surface px-3 py-2 text-body transition-colors duration-[var(--motion-base)] hover:bg-sunken"
                    >
                      <span className="min-w-0 truncate">
                        v{artifact.version} · {typeName(artifact.type)}
                      </span>
                      <StatusPill
                        variant={artifact.status}
                        label={statusLabel(artifact.status)}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-6">
          {/* Aktuális fázis — kapu-checklist kártya */}
          {currentPhase && (
            <section className="surface-card p-4">
              <h2 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
                {tCockpit("gateChecklistTitle")}
              </h2>
              {/* Állapot mindig ikon + szöveg (törvény 4) */}
              <p className="mt-1 flex items-center gap-2 text-body font-semibold">
                <span
                  className={`inline-flex items-center gap-1 ${PHASE_STATE_TEXT[currentPhase.state]}`}
                >
                  <PhaseStateIcon state={currentPhase.state} size={12} />
                  {tLex(currentPhase.state)}
                </span>
                {currentPhase.phase}
              </p>
              {currentPhase.criteria.length === 0 ? (
                <p className="mt-2 text-body text-ink-tertiary">{tGates("noGate")}</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {currentPhase.criteria.map((criterion) => (
                    <li key={criterion.id} className="flex items-center gap-2 text-body">
                      <span
                        className={
                          criterion.satisfied ? "text-done" : "text-gate"
                        }
                      >
                        <PhaseStateIcon
                          state={criterion.satisfied ? "completed" : "gate_pending"}
                          size={11}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        {criterionLabel(criterion, tCriteria, tTypes)}
                      </span>
                      {criterion.interim && (
                        <span
                          title={tGates("interimHint")}
                          className="shrink-0 rounded-pill border border-dashed border-line px-1.5 py-px text-[10px] font-medium text-ink-tertiary"
                        >
                          {tGates("interimBadge")}
                        </span>
                      )}
                      {/* Státusz mindig ikon + szöveg (törvény 4) */}
                      <span
                        className={`shrink-0 text-mono-sm font-medium ${
                          criterion.satisfied ? "text-done" : "text-gate"
                        }`}
                      >
                        {criterion.satisfied
                          ? tGates("criterionSatisfied")
                          : tGates("criterionPending")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href={`/project/${id}/phase/${currentPhase.phase}`}
                className="mt-3 inline-flex items-center justify-center rounded-control border border-line bg-surface px-3 py-1.5 text-body font-medium shadow-tile-sm transition-colors duration-[var(--motion-base)] hover:bg-sunken"
              >
                {tCockpit("openCockpit")}
              </Link>
            </section>
          )}

          {/* Projekt-meta kártya — öröklött kontextus: süllyesztett (törvény 6) */}
          <section className="card-sunken p-4">
            <h2 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
              {tCockpit("projectMetaTitle")}
            </h2>
            <dl className="mt-2 space-y-1.5 text-body">
              <MetaRow label={tCockpit("metaClient")}>
                {project.clients?.name ?? tClients("unknown")}
              </MetaRow>
              <MetaRow label={tCockpit("metaIndustry")}>
                {project.clients?.industry ?? "—"}
              </MetaRow>
              <MetaRow label={tCockpit("metaPackage")}>
                {project.package ?? "—"}
              </MetaRow>
              <MetaRow label={tCockpit("metaStart")}>
                {new Date(project.created_at).toLocaleDateString(dateLocale, dateOptions)}
              </MetaRow>
            </dl>
          </section>
        </div>
      </div>

      {/* A régi „Bemenet & generálás" blokk (#1) kivezetve (#5a) — a munka
          az aktuális fázis munkaterületén folyik; innen CTA vezet oda. */}
      {currentPhase && (
        <section className="surface-card border-l-2 border-l-active p-5">
          <h2 className="text-body font-semibold">{tCockpit("workspaceCtaTitle")}</h2>
          <p className="mt-1 text-body text-ink-secondary">
            {tCockpit("workspaceCtaBody")}
          </p>
          <Link
            href={`/project/${id}/phase/${currentPhase.phase}`}
            className="mt-3 inline-flex items-center justify-center rounded-control border border-line bg-surface px-4 py-2 text-body font-medium shadow-tile-sm transition-colors duration-[var(--motion-base)] hover:bg-sunken"
          >
            {tCockpit("workspaceCta", { phase: currentPhase.phase })}
          </Link>
        </section>
      )}
    </div>
  );
}

function StatChip({
  value,
  label,
  href,
}: {
  value: number;
  label: string;
  /** #7a: opcionális cél — a chip kattintható belépő (pl. P1 munkaterület). */
  href?: string;
}) {
  const body = (
    <>
      <div className="font-mono text-metric">{value}</div>
      <div className="mt-0.5 text-mono-sm text-ink-tertiary">{label}</div>
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="surface-card block p-3 text-center transition-colors duration-[var(--motion-base)] hover:bg-sunken"
      >
        {body}
      </Link>
    );
  }
  return <div className="surface-card p-3 text-center">{body}</div>;
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-tertiary">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

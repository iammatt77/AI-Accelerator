import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { saveDraftBody, approveArtifact } from "@/app/actions";
import {
  computeNextStep,
  countCompleted,
  countOpenGates,
  loadPhaseBoard,
} from "@/lib/phases/service";
import { SubmitButton } from "@/components/SubmitButton";
import { InputForm } from "@/components/InputForm";
import { GenerateForm } from "@/components/GenerateForm";
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

  const [{ data: inputs }, { data: artifacts }, board] = await Promise.all([
    supabase
      .from("input_items")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    supabase
      .from("artifacts")
      .select("*")
      .eq("project_id", projectId)
      .order("version", { ascending: false }),
    loadPhaseBoard(supabase, projectId),
  ]);

  return {
    project: project as ProjectWithClient,
    inputs: (inputs ?? []) as InputItemRow[],
    artifacts: (artifacts ?? []) as ArtifactRow[],
    board,
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

  const { project, inputs, artifacts, board } = data;

  const [locale, tCockpit, tCommon, tClients, tInputs, tArtifacts, tEmpty, tGates, tCriteria] =
    await Promise.all([
      getLocale(),
      getTranslations("cockpit"),
      getTranslations("common"),
      getTranslations("clients"),
      getTranslations("inputs"),
      getTranslations("artifacts"),
      getTranslations("empty"),
      getTranslations("gates"),
      getTranslations("criteria"),
    ]);
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

  // Generálási vertikum (#1) — a fázis-munkaterületek (#5+) átvételéig itt él
  const current = artifacts[0] ?? null;
  const inputsById = new Map(inputs.map((i) => [i.id, i]));
  const hasRealSources = Boolean(current && current.source_input_ids.length > 0);
  const sourceInputs = hasRealSources
    ? current!.source_input_ids
        .map((sid) => inputsById.get(sid))
        .filter((i): i is InputItemRow => Boolean(i))
    : inputs;
  const sourcesHeading = hasRealSources
    ? tInputs("sourcesTitle")
    : tInputs("listTitle");
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

          {/* Stat-chipek: csak létező entitásból (C melléklet) */}
          <div className="grid grid-cols-3 gap-3">
            <StatChip value={inputs.length} label={tCockpit("statInputs")} />
            <StatChip value={artifacts.length} label={tCockpit("statArtifacts")} />
            <StatChip value={openGates} label={tCockpit("statOpenGates")} />
          </div>

          {/* Legutóbbi artefaktumok (max 3) */}
          <section className="glass-tile p-4">
            <h2 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
              {tCockpit("recentArtifacts")}
            </h2>
            {recentArtifacts.length === 0 ? (
              <p className="mt-2 text-body text-ink-tertiary">{tEmpty("noArtifact")}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {recentArtifacts.map((artifact) => (
                  <li
                    key={artifact.id}
                    className="flex items-center justify-between gap-3 rounded-tile border border-line bg-surface px-3 py-2 text-body"
                  >
                    <span className="min-w-0 truncate">
                      v{artifact.version} · {artifact.type}
                    </span>
                    <StatusPill
                      variant={artifact.status}
                      label={statusLabel(artifact.status)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-6">
          {/* Aktuális fázis — kapu-checklist kártya */}
          {currentPhase && (
            <section className="glass-tile p-4">
              <h2 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
                {tCockpit("gateChecklistTitle")}
              </h2>
              <p className="mt-1 flex items-center gap-2 text-body font-semibold">
                <span className={PHASE_STATE_TEXT[currentPhase.state]}>
                  <PhaseStateIcon state={currentPhase.state} size={12} />
                </span>
                {currentPhase.phase}
              </p>
              {currentPhase.criteria.length === 0 ? (
                <p className="mt-2 text-body text-ink-tertiary">{tGates("noGate")}</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {currentPhase.criteria.map((criterion) => (
                    <li
                      key={criterion.id}
                      className={`flex items-center gap-2 text-body ${
                        criterion.mode === "manual"
                          ? "rounded-tile border border-dashed border-line px-2 py-1.5"
                          : ""
                      }`}
                    >
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
                        {tCriteria(criterion.id)}
                      </span>
                      {criterion.mode === "manual" && (
                        <span className="shrink-0 rounded-pill border border-dashed border-gate/60 px-1.5 py-px text-[10px] font-medium text-gate">
                          {tGates("temporaryBadge")}
                        </span>
                      )}
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

      {/* Generálási vertikum (#1) — a fázis-munkaterületek (#5+) átvételéig */}
      <section className="glass-tile p-5">
        <h2 className="text-body font-semibold">{tCockpit("inputAndGenerate")}</h2>
        <InputForm projectId={id} />
        <GenerateForm
          projectId={id}
          inputsCount={inputs.length}
          artifactsCount={artifacts.length}
        />
      </section>

      {/* SPLIT-VIEW: bal = draft body (szerkeszthető), jobb = forrás */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="glass-tile p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-body font-semibold">{tArtifacts("draftHeading")}</h2>
            {current && (
              <StatusPill
                variant={current.status}
                label={`${statusLabel(current.status)} · v${current.version}`}
              />
            )}
          </div>

          {!current && (
            <p className="text-body text-ink-tertiary">{tEmpty("noArtifact")}</p>
          )}

          {current && current.status === "draft" && (
            <div className="space-y-3">
              <form
                action={saveDraftBody.bind(null, id, current.id)}
                className="space-y-3"
              >
                <textarea
                  name="body"
                  rows={16}
                  defaultValue={current.body}
                  className="w-full rounded-control border border-line bg-surface px-3 py-2 font-mono text-mono-sm"
                />
                <div className="flex flex-wrap gap-3">
                  <SubmitButton variant="secondary" pendingLabel={tCommon("saving")}>
                    {tArtifacts("saveDraft")}
                  </SubmitButton>
                </div>
              </form>

              <form
                action={approveArtifact.bind(null, id, current.id)}
                className="border-t border-line pt-3"
              >
                <input type="hidden" name="body" value={current.body} />
                <SubmitButton pendingLabel={tArtifacts("approving")}>
                  {tArtifacts("approveCta")}
                </SubmitButton>
                <p className="mt-2 text-mono-sm text-ink-tertiary">
                  {tArtifacts("approveHint")}
                </p>
              </form>
            </div>
          )}

          {current && current.status !== "draft" && (
            <pre className="card-sunken whitespace-pre-wrap p-3 font-sans text-body">
              {current.body}
            </pre>
          )}
        </div>

        <div className="glass-tile p-5">
          <h2 className="mb-3 text-body font-semibold">{sourcesHeading}</h2>
          {sourceInputs.length === 0 && (
            <p className="text-body text-ink-tertiary">{tEmpty("noSources")}</p>
          )}
          <ul className="space-y-3">
            {sourceInputs.map((input) => (
              <li key={input.id} className="card-sunken p-3">
                <div className="mb-1 text-mono-sm text-ink-tertiary">
                  {input.type} ·{" "}
                  {new Date(input.created_at).toLocaleString(dateLocale, dateOptions)}
                </div>
                <pre className="whitespace-pre-wrap font-sans text-body">
                  {input.raw_text}
                </pre>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Verziótörténet */}
      {artifacts.length > 0 && (
        <section>
          <h2 className="mb-3 text-body font-semibold">
            {tArtifacts("historyTitle")}
          </h2>
          <ul className="space-y-2">
            {artifacts.map((artifact) => (
              <li
                key={artifact.id}
                className="flex items-center justify-between rounded-tile border border-line bg-surface px-4 py-2 text-body shadow-tile-sm"
              >
                <span>
                  v{artifact.version} · {artifact.type}
                </span>
                <span className="flex items-center gap-3 text-ink-tertiary">
                  <StatusPill
                    variant={artifact.status}
                    label={statusLabel(artifact.status)}
                  />
                  {new Date(artifact.created_at).toLocaleString(dateLocale, dateOptions)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StatChip({ value, label }: { value: number; label: string }) {
  return (
    <div className="glass-tile p-3 text-center">
      <div className="font-mono text-metric">{value}</div>
      <div className="mt-0.5 text-mono-sm text-ink-tertiary">{label}</div>
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-tertiary">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  completeness,
  parseArtifactFields,
  typesForPhase,
  type ArtifactTypeDef,
} from "@/lib/artifacts/config";
import {
  hasGate,
  isManualClose,
  type PhaseId,
} from "@/lib/phases/config";
import { criterionLabel } from "@/lib/phases/criterion-label";
import type { EvaluatedCriterion } from "@/lib/phases/service";
import type { PhaseState } from "@/lib/phases/machine";
import type {
  ArtifactRow,
  InputItemRow,
  PainPointRow,
  UseCaseRow,
} from "@/lib/db/types";
import {
  ExtractForm,
  FieldCard,
  GenerateBodyForm,
  PhaseInputForm,
} from "@/components/WorkspaceForms";
import {
  AddPainPointForm,
  AddUseCaseForm,
  DeriveUseCasesForm,
  ExtractPainPointsForm,
  GenerateShortlistFieldsForm,
  PainPointProposalCard,
  UseCaseCard,
  type PainPointCardData,
  type UseCaseCardData,
} from "@/components/EntityForms";
import {
  InlinePainActions,
  PainSummary,
  UseCaseSummary,
} from "@/components/EntitySummaries";
import { WorkbenchHeatmap } from "@/components/UseCaseHeatmap";
import {
  aiActWarnFor,
  parseAiAct,
  parseAiSuitability,
  parseDataReadiness,
} from "@/lib/entities/evaluators";
import {
  WorkspaceTabs,
  DrillRow,
  ShowMore,
  CollapsedGroup,
  type ZoneTab,
} from "@/components/WorkspaceShell";
import { GateCloseForm } from "@/components/PhaseGateForms";
import { PhaseStateIcon } from "@/components/icons";
import { StatusPill } from "@/components/StatusPill";

// ─────────────────────────────────────────────────────────────
// Fázis-munkaterület — Redesign #1 „A" variáns (zone-tabs). A négy zóna
// (Input / Workbench / Output / Gate) fülekké válik, felül a fázis-összegző
// sávval (valós totálok + kapu + „Next"). A funkció változatlan: minden
// meglévő akció (input, kivonatolás, E1-megerősítés, pontozás, státusz,
// generálás, kapuzárás, értékelők) elérhető és működik — csak az elrendezés
// új. A hőtérkép a #7b SVG-jét emeli (fókusz-mód a workbench mellett).
// ─────────────────────────────────────────────────────────────

export async function PhaseWorkspace({
  supabase,
  projectId,
  phase,
  state,
  criteria,
  clientName,
  phaseName,
}: {
  supabase: SupabaseClient;
  projectId: string;
  phase: PhaseId;
  state: PhaseState;
  criteria: EvaluatedCriterion[];
  clientName: string;
  phaseName: string;
}) {
  const [locale, t, tGates, tArtifacts, tTypes, tFields, tEmpty, tEnt, tCriteria] =
    await Promise.all([
      getLocale(),
      getTranslations("workspace"),
      getTranslations("gates"),
      getTranslations("artifacts"),
      getTranslations("artifactTypes"),
      getTranslations("fields"),
      getTranslations("empty"),
      getTranslations("entities"),
      getTranslations("criteria"),
    ]);
  const typeName = (typeDef: ArtifactTypeDef) =>
    tTypes(typeDef.nameKey.replace(/^artifactTypes\./, ""));
  const dateLocale = locale === "hu" ? "hu-HU" : "en-GB";
  const dateOptions = { timeZone: "Europe/Budapest" } as const;

  const phaseTypes = typesForPhase(phase);

  const [{ data: inputData }, { data: artifactData }] = await Promise.all([
    supabase
      .from("input_items")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    phaseTypes.length > 0
      ? supabase
          .from("artifacts")
          .select("*")
          .eq("project_id", projectId)
          .in(
            "type",
            phaseTypes.map((typeDef) => typeDef.key),
          )
          .order("version", { ascending: false })
      : Promise.resolve({ data: [] as ArtifactRow[] }),
  ]);
  const inputs = (inputData ?? []) as InputItemRow[];
  const artifacts = (artifactData ?? []) as ArtifactRow[];
  const artifactsOfType = (typeDef: ArtifactTypeDef) =>
    artifacts.filter((a) => a.type === typeDef.key);
  const latestOfType = (typeDef: ArtifactTypeDef) =>
    artifactsOfType(typeDef)[0] ?? null;

  // ── P1 entitások (#7a/#7b) ──────────────────────────────────
  const isP1 = phase === "P1";
  const [{ data: painData }, { data: useCaseData }] = isP1
    ? await Promise.all([
        supabase
          .from("pain_points")
          .select("*")
          .eq("project_id", projectId)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true }),
        supabase
          .from("use_cases")
          .select("*")
          .eq("project_id", projectId)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true }),
      ])
    : [{ data: [] as PainPointRow[] }, { data: [] as UseCaseRow[] }];
  const allPains = (painData ?? []) as PainPointRow[];
  const useCases = ((useCaseData ?? []) as UseCaseRow[]).filter(
    (u) => u.state !== "rejected",
  );

  const inputPos = new Map(inputs.map((row, i) => [row.id, i + 1]));
  const toIndices = (ids: string[]) =>
    ids.map((id) => inputPos.get(id)).filter((n): n is number => typeof n === "number");
  const painTitleById = new Map(allPains.map((p) => [p.id, p.title]));

  const toPainCard = (p: PainPointRow): PainPointCardData => ({
    id: p.id,
    title: p.title,
    description: p.description,
    quote: p.quote,
    severity: p.severity,
    state: p.state,
    sourceIndices: toIndices(p.source_input_ids),
  });
  const toUseCaseCard = (u: UseCaseRow): UseCaseCardData => ({
    id: u.id,
    title: u.title,
    description: u.description,
    state: u.state,
    scoreValue: u.score_value,
    scoreFeasibility: u.score_feasibility,
    risk: u.risk,
    quickWin: u.quick_win,
    listStatus: u.list_status,
    exclusionReason: u.exclusion_reason,
    painChips: u.pain_point_ids
      .map((id) => painTitleById.get(id))
      .filter((title): title is string => typeof title === "string"),
    sourceIndices: toIndices(u.source_input_ids),
    evaluators: {
      aiSuitability: parseAiSuitability(u.ai_suitability),
      dataReadiness: parseDataReadiness(u.data_readiness),
      aiAct: parseAiAct(u.ai_act),
    },
  });

  const painProposals = allPains.filter((p) => p.state === "ai_suggested");
  const painConfirmed = allPains.filter(
    (p) => p.state === "confirmed" || p.state === "manual",
  );
  const isUcConfirmed = (u: UseCaseRow) =>
    u.state === "confirmed" || u.state === "manual";
  const ucShortlistedCount = useCases.filter(
    (u) => isUcConfirmed(u) && (u.list_status === "shortlist" || u.list_status === "selected"),
  ).length;
  const ucQuickWinCount = useCases.filter(
    (u) =>
      u.quick_win &&
      isUcConfirmed(u) &&
      (u.list_status === "shortlist" || u.list_status === "selected"),
  ).length;

  // Kód-jelölő (PP-01 / UC-01) a listasorrend szerint.
  const painCode = new Map(allPains.map((p, i) => [p.id, `PP-${String(i + 1).padStart(2, "0")}`]));
  const ucCode = new Map(useCases.map((u, i) => [u.id, `UC-${String(i + 1).padStart(2, "0")}`]));

  // Hőtérkép-pontok + pontozásra-váró + shortlist (a #7b logikájával).
  const heatmapPoints = useCases
    .filter(
      (u) =>
        isUcConfirmed(u) &&
        u.list_status !== "excluded" &&
        u.score_value !== null &&
        u.score_feasibility !== null,
    )
    .map((u) => ({
      id: u.id,
      title: u.title,
      value: u.score_value as number,
      feasibility: u.score_feasibility as number,
      risk: u.risk,
      quickWin: u.quick_win,
      aiActWarn: aiActWarnFor(u),
    }));
  const heatmapUnscored = useCases
    .filter(
      (u) =>
        isUcConfirmed(u) &&
        u.list_status !== "excluded" &&
        (u.score_value === null || u.score_feasibility === null),
    )
    .map((u) => ({ id: u.id, title: u.title }));
  const heatmapShortlist = useCases
    .filter(
      (u) =>
        isUcConfirmed(u) && (u.list_status === "shortlist" || u.list_status === "selected"),
    )
    .map((u) => ({
      id: u.id,
      title: u.title,
      value: u.score_value ?? 0,
      feasibility: u.score_feasibility ?? 0,
    }));

  // ── Kimenet-blokk (③) egy típusra — Output tab ──────────────
  function OutputCard({ typeDef }: { typeDef: ArtifactTypeDef }) {
    const versions = artifactsOfType(typeDef);
    const latest = versions[0] ?? null;
    const fields = latest ? parseArtifactFields(typeDef, latest.fields) : null;
    const done = fields ? completeness(typeDef, fields) : null;
    const hasConfirmed = fields
      ? typeDef.fields.some((f) => {
          const v = fields[f.key];
          return (v.state === "confirmed" || v.state === "manual") && Boolean(v.value);
        })
      : false;
    return (
      <div className="space-y-3">
        <div className="glass-tile p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-body font-semibold">{typeName(typeDef)}</span>
            {latest ? (
              <StatusPill
                variant={latest.status}
                label={`${tArtifacts(`status.${latest.status}`)} · v${latest.version}`}
              />
            ) : (
              <span className="text-mono-sm text-ink-tertiary">{t("noArtifactYet")}</span>
            )}
          </div>
          {latest && done && (
            <>
              <p className="mt-1.5 font-mono text-mono-sm text-ink-tertiary">
                {t("completeness", done)} · {t("versionsCount", { count: versions.length })}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-neutral-200">
                {/* Teljesség = információ, nem döntési pont → semleges kitöltés
                    (törvény 3: a lila a döntéseknek van fenntartva). */}
                <div
                  className="h-full rounded-pill bg-ink-secondary"
                  style={{
                    width: `${done.required > 0 ? Math.round((done.filled / done.required) * 100) : 0}%`,
                  }}
                />
              </div>
            </>
          )}
          {typeDef.entitySourced && (!latest || latest.status !== "in_review") && (
            <div className="mt-3">
              <GenerateShortlistFieldsForm projectId={projectId} />
            </div>
          )}
          {latest && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {latest.status === "draft" &&
                !typeDef.entitySourced &&
                (hasConfirmed ? (
                  <GenerateBodyForm
                    projectId={projectId}
                    artifactId={latest.id}
                    hasBody={latest.body.trim() !== ""}
                  />
                ) : (
                  <span className="text-mono-sm text-ink-tertiary">
                    {t("generateNeedsConfirmed")}
                  </span>
                ))}
              {latest.status === "draft" && typeDef.entitySourced && hasConfirmed && (
                <GenerateBodyForm
                  projectId={projectId}
                  artifactId={latest.id}
                  hasBody={latest.body.trim() !== ""}
                />
              )}
              <Link
                href={`/project/${projectId}/artifact/${latest.id}`}
                className="inline-flex items-center justify-center rounded-control border border-line bg-surface px-3 py-1.5 text-body font-medium shadow-tile-sm transition-colors duration-[var(--motion-base)] hover:bg-sunken"
              >
                {t("openEditor")}
              </Link>
            </div>
          )}
        </div>
        {versions.length > 1 && (
          <ul className="space-y-1.5">
            {versions.slice(1).map((artifact) => (
              <li key={artifact.id}>
                <Link
                  href={`/project/${projectId}/artifact/${artifact.id}`}
                  className="flex items-center justify-between gap-2 rounded-tile border border-line bg-surface px-3 py-1.5 text-body shadow-tile-sm transition-colors duration-[var(--motion-base)] hover:bg-sunken"
                >
                  <span className="font-mono text-mono-sm text-ink-secondary">
                    v{artifact.version}
                  </span>
                  <StatusPill
                    variant={artifact.status}
                    label={tArtifacts(`status.${artifact.status}`)}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ── Mező-kivonatolás blokk (②) egy típusra — Workbench tab ──
  function FieldWorkBlock({ typeDef }: { typeDef: ArtifactTypeDef }) {
    const latest = latestOfType(typeDef);
    const editable = latest?.status === "draft";
    const fields = latest ? parseArtifactFields(typeDef, latest.fields) : null;
    return (
      <div className="glass-tile space-y-3 p-4">
        <h4 className="text-body font-semibold">{typeName(typeDef)}</h4>
        <p className="text-mono-sm text-ink-tertiary">{t("toolsLead")}</p>
        {latest && !editable && (
          <p className="rounded-tile border border-dashed border-line px-3 py-2 text-body text-ink-tertiary">
            {t("notDraftNotice")}
          </p>
        )}
        {typeDef.entitySourced ? (
          <p className="rounded-tile border border-dashed border-line px-3 py-2 text-body text-ink-tertiary">
            {t("entitySourcedHint")}
          </p>
        ) : (
          (!latest || editable) && <ExtractForm projectId={projectId} typeKey={typeDef.key} />
        )}
        {latest && fields && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h5 className="text-body font-semibold">
                {t("fieldsTitle", { type: typeName(typeDef) })}
              </h5>
              <span className="rounded-pill border border-line bg-surface px-2 py-0.5 font-mono text-mono-sm text-ink-secondary">
                {t("completeness", completeness(typeDef, fields))}
              </span>
            </div>
            {typeDef.fields.map((fieldDef) => (
              <FieldCard
                key={fieldDef.key}
                projectId={projectId}
                artifactId={latest.id}
                fieldKey={fieldDef.key}
                label={tFields(fieldDef.labelKey.replace(/^fields\./, ""))}
                required={fieldDef.required}
                field={fields[fieldDef.key]}
                editable={editable}
              />
            ))}
          </div>
        )}
        {!latest && !typeDef.entitySourced && (
          <p className="text-body text-ink-tertiary">{t("noDraftYet")}</p>
        )}
      </div>
    );
  }

  // ── Panelek ─────────────────────────────────────────────────

  const inputPanel = (
    <section className="glass-tile p-4">
      <p className="text-mono-sm text-ink-tertiary">{t("inputsLead", { phase })}</p>
      {inputs.length === 0 ? (
        <p className="mt-3 rounded-tile border border-dashed border-line px-3 py-6 text-center text-body text-ink-tertiary">
          {tEmpty("noSources")}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {inputs.map((input, i) => (
            <li key={input.id} className="card-sunken px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-body font-medium">
                  <span className="mr-1.5 font-mono text-mono-sm text-ink-tertiary">
                    [{i + 1}]
                  </span>
                  {input.type}
                </span>
                {input.phase && (
                  <span className="shrink-0 rounded-pill border border-line bg-surface px-1.5 py-px font-mono text-[10px] text-ink-secondary">
                    {input.phase}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-mono-sm text-ink-tertiary">
                {new Date(input.created_at).toLocaleDateString(dateLocale, dateOptions)}
              </div>
            </li>
          ))}
        </ul>
      )}
      <PhaseInputForm projectId={projectId} phase={phase} />
    </section>
  );

  // Nem entitás-forrású típusok (mező-kivonatolás a workbench-en).
  const fieldTypes = phaseTypes.filter((td) => !td.entitySourced);

  const workbenchPanel = isP1 ? (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* Bal: entitás-munka */}
        <div className="space-y-5">
          {/* Fájdalompontok */}
          <section className="glass-tile p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-body font-semibold">
                {tEnt("painSectionTitle")}{" "}
                <span className="font-mono text-mono-sm font-normal text-ink-tertiary">
                  {allPains.filter((p) => p.state !== "rejected").length} ·{" "}
                  {painConfirmed.length} {tEnt("confirmedShort")}
                </span>
              </h4>
            </div>
            <p className="mt-1 text-mono-sm text-ink-tertiary">{tEnt("painLead")}</p>
            <div className="mt-3">
              <ExtractPainPointsForm projectId={projectId} />
            </div>

            {painProposals.length > 0 && (
              <div className="mt-3 space-y-2">
                <h5 className="text-mono-sm font-medium uppercase tracking-wide text-gate">
                  {tEnt("needsConfirmationHeading", { n: painProposals.length })}
                </h5>
                <ShowMore
                  initial={4}
                  moreKey="entities.showMoreWaiting"
                  lessKey="entities.showLess"
                >
                  {painProposals.map((p, i) => (
                    <DrillRow
                      key={p.id}
                      accent
                      defaultOpen={i === 0}
                      summary={
                        <PainSummary
                          code={painCode.get(p.id) ?? ""}
                          title={p.title}
                          sourceIndices={toIndices(p.source_input_ids)}
                          state={p.state}
                        />
                      }
                      actions={<InlinePainActions projectId={projectId} painPointId={p.id} />}
                      detail={
                        <PainPointProposalCard
                          projectId={projectId}
                          painPoint={toPainCard(p)}
                          embedded
                        />
                      }
                    />
                  ))}
                </ShowMore>
              </div>
            )}

            {painConfirmed.length > 0 && (
              <div className="mt-3">
                <CollapsedGroup
                  label={tEnt("confirmedHeading")}
                  count={painConfirmed.length}
                  tone="done"
                >
                  {painConfirmed.map((p) => (
                    <DrillRow
                      key={p.id}
                      summary={
                        <PainSummary
                          code={painCode.get(p.id) ?? ""}
                          title={p.title}
                          sourceIndices={toIndices(p.source_input_ids)}
                          state={p.state}
                        />
                      }
                      detail={
                        <PainPointProposalCard
                          projectId={projectId}
                          painPoint={toPainCard(p)}
                          embedded
                        />
                      }
                    />
                  ))}
                </CollapsedGroup>
              </div>
            )}

            {painProposals.length === 0 && painConfirmed.length === 0 && (
              <p className="mt-3 text-body text-ink-tertiary">{tEnt("noPains")}</p>
            )}
            <div className="mt-3">
              <AddPainPointForm projectId={projectId} />
            </div>
          </section>

          {/* Use case-ek */}
          <section className="glass-tile p-4">
            <h4 className="text-body font-semibold">
              {tEnt("useCaseSectionTitle")}{" "}
              <span className="font-mono text-mono-sm font-normal text-ink-tertiary">
                {useCases.length} · {ucShortlistedCount} {tEnt("shortlistedShort")}
              </span>
            </h4>
            <p className="mt-1 text-mono-sm text-ink-tertiary">{tEnt("useCaseLead")}</p>
            <div className="mt-3">
              <DeriveUseCasesForm projectId={projectId} />
            </div>
            {useCases.length > 0 ? (
              <div className="mt-3">
                <ShowMore
                  initial={5}
                  moreKey="entities.showMoreUseCases"
                  lessKey="entities.showLess"
                >
                  {useCases.map((u) => (
                    <div key={u.id} id={`uc-${u.id}`}>
                      <DrillRow
                        accent
                        summary={
                          <UseCaseSummary
                            code={ucCode.get(u.id) ?? ""}
                            title={u.title}
                            scoreValue={u.score_value}
                            scoreFeasibility={u.score_feasibility}
                            risk={u.risk}
                            quickWin={u.quick_win}
                            listStatus={u.list_status}
                            isProposal={u.state === "ai_suggested"}
                          />
                        }
                        detail={
                          <UseCaseCard projectId={projectId} useCase={toUseCaseCard(u)} embedded />
                        }
                      />
                    </div>
                  ))}
                </ShowMore>
              </div>
            ) : (
              <p className="mt-3 text-body text-ink-tertiary">{tEnt("noUseCases")}</p>
            )}
            <div className="mt-3">
              <AddUseCaseForm
                projectId={projectId}
                painOptions={painConfirmed.map((p) => ({ id: p.id, title: p.title }))}
              />
            </div>
          </section>
        </div>

        {/* Jobb: hőtérkép (mindig látható) + fókusz-mód */}
        <div>
          <WorkbenchHeatmap
            points={heatmapPoints}
            unscored={heatmapUnscored}
            shortlist={heatmapShortlist}
            clientName={clientName}
            phaseName={phaseName}
          />
        </div>
      </div>

      {/* Nem entitás-forrású típus(ok) mező-munkája (pl. Felmérési riport) */}
      {fieldTypes.map((typeDef) => (
        <FieldWorkBlock key={typeDef.key} typeDef={typeDef} />
      ))}
    </div>
  ) : phaseTypes.length === 0 ? (
    <p className="glass-tile p-4 text-body text-ink-tertiary">{t("noTypesForPhase")}</p>
  ) : (
    <div className="space-y-5">
      {phaseTypes.map((typeDef) => (
        <FieldWorkBlock key={typeDef.key} typeDef={typeDef} />
      ))}
    </div>
  );

  const outputPanel =
    phaseTypes.length === 0 ? (
      <p className="glass-tile p-4 text-body text-ink-tertiary">{t("noTypesForPhase")}</p>
    ) : (
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {phaseTypes.map((typeDef) => (
          <OutputCard key={typeDef.key} typeDef={typeDef} />
        ))}
      </div>
    );

  // ── Gate panel (④, a fázis-oldalról ide emelve) ─────────────
  const satisfiedCount = criteria.filter((c) => c.satisfied).length;
  const gatePanel = !hasGate(phase) ? (
    <section className="card-sunken p-4">
      <p className="text-body font-semibold">{tGates("noGate")}</p>
      <p className="mt-1 text-body text-ink-secondary">{tGates("noGateBody")}</p>
    </section>
  ) : (
    <section
      className={`glass-tile p-4 ${state === "gate_pending" ? "border-gate/40" : ""}`}
    >
      <h3 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
        {tGates("criteriaTitle")}
      </h3>
      <ul className="mt-2 space-y-1.5">
        {criteria.map((criterion) => (
          <li key={criterion.id} className="flex items-center gap-2 text-body">
            <span className={criterion.satisfied ? "text-done" : "text-gate"}>
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
            <span
              className={`shrink-0 text-mono-sm font-medium ${criterion.satisfied ? "text-done" : "text-gate"}`}
            >
              {criterion.satisfied ? tGates("criterionSatisfied") : tGates("criterionPending")}
            </span>
          </li>
        ))}
      </ul>
      {state !== "open" && (
        <div className="mt-4">
          <GateCloseForm projectId={projectId} phase={phase} temporary={isManualClose(phase)} />
        </div>
      )}
      {state === "open" && (
        <p className="mt-3 text-mono-sm text-ink-tertiary">{tGates("startFirstHint")}</p>
      )}
    </section>
  );

  // ── Fül-jelvények (valós számlálók) ─────────────────────────
  const confirmedFieldCount = fieldTypes.reduce((acc, td) => {
    const latest = latestOfType(td);
    if (!latest) return acc;
    const f = parseArtifactFields(td, latest.fields);
    return (
      acc +
      td.fields.filter((fd) => {
        const v = f[fd.key];
        return (v.state === "confirmed" || v.state === "manual") && Boolean(v.value);
      }).length
    );
  }, 0);
  const startedOutputs = phaseTypes.filter((td) => latestOfType(td) !== null).length;

  const tabs: ZoneTab[] = [
    { key: "input", label: tGates("zoneInput"), badge: `${inputs.length}` },
    {
      key: "workbench",
      label: tGates("zoneTools"),
      badge: isP1
        ? `${allPains.filter((p) => p.state !== "rejected").length} · ${painConfirmed.length}`
        : confirmedFieldCount > 0
          ? `${confirmedFieldCount}`
          : undefined,
    },
    {
      key: "output",
      label: tGates("zoneOutput"),
      badge: startedOutputs > 0 ? `${startedOutputs}` : undefined,
    },
    {
      key: "gate",
      label: tGates("zoneGate"),
      badge: hasGate(phase) ? `${satisfiedCount}/${criteria.length}` : undefined,
      gate: true,
    },
  ];

  const defaultTab =
    state === "open" || inputs.length === 0
      ? "input"
      : state === "gate_pending"
        ? "gate"
        : "workbench";

  // ── Összegző sáv (totálok + kapu + Next) ────────────────────
  const firstUnmet = criteria.find((c) => !c.satisfied);
  const gateReady = hasGate(phase) && criteria.length > 0 && !firstUnmet;
  const nextHint =
    state === "open"
      ? t("nextStart")
      : state === "gate_pending" || gateReady
        ? t("nextCloseGate")
        : firstUnmet
          ? t("nextSatisfy", { criterion: criterionLabel(firstUnmet, tCriteria, tTypes) })
          : t("nextCloseGate");

  return (
    <div className="space-y-4">
      {/* Összegző sáv */}
      <div className="glass-tile flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <SummaryStat value={`${inputs.length}`} label={t("statRawInputs")} />
          {isP1 && (
            <>
              <SummaryStat
                value={`${allPains.filter((p) => p.state !== "rejected").length}`}
                label={t("statPainPoints")}
                note={`${painConfirmed.length} ${tEnt("confirmedShort")}`}
              />
              <SummaryStat
                value={`${useCases.length}`}
                label={t("statUseCases")}
                note={`${ucShortlistedCount} ${tEnt("shortlistedShort")} · ${ucQuickWinCount} ${tEnt("quickWinShort")}`}
              />
            </>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {hasGate(phase) && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-body font-medium ${
                gateReady
                  ? "border-done/40 bg-tint-done text-done"
                  : "border-gate/50 bg-tint-gate text-gate"
              }`}
            >
              {/* Törvény 4: nem csak szín — a készenlétet ikon is jelöli
                  (✓ kész / ◇ vár) a szám-pár mellett. */}
              <span aria-hidden>{gateReady ? "✓" : "◇"}</span>
              {tGates("zoneGate")} {satisfiedCount}/{criteria.length}
            </span>
          )}
          {/* „Next" = navigációs útmutató (nem döntési pont) → semleges chip;
              a lila a döntés-gomboknak marad (törvény 3). */}
          <span className="inline-flex items-center gap-1.5 rounded-control border border-line bg-neutral-100 px-3 py-1.5 text-body font-medium text-ink-secondary">
            <span className="text-ink-tertiary">{t("nextLabel")}</span> {nextHint}
          </span>
        </div>
      </div>

      <WorkspaceTabs
        tabs={tabs}
        panels={{
          input: inputPanel,
          workbench: workbenchPanel,
          output: outputPanel,
          gate: gatePanel,
        }}
        defaultTab={defaultTab}
      />
    </div>
  );
}

function SummaryStat({
  value,
  label,
  note,
}: {
  value: string;
  label: string;
  note?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono text-metric text-ink">{value}</span>
      <span className="text-body text-ink-secondary">{label}</span>
      {note && <span className="text-mono-sm text-done">· {note}</span>}
    </div>
  );
}

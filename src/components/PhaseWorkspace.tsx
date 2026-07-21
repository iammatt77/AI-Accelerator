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
  PainPointStakeholderRow,
  StakeholderRow,
  StaleAckRow,
  UseCaseRow,
} from "@/lib/db/types";
import { numberSourceRows } from "@/lib/sources";
import { activeStaleSince, sourceUpdatedSince } from "@/lib/staleness";
import { StaleFlag } from "@/components/StaleFlag";
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
  GenerateSolutionPlanForm,
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
import {
  AddStakeholderForm,
  ExtractStakeholdersForm,
  PainStakeholderBinder,
  StakeholderConfirmedRow,
  StakeholderProposalCard,
  type StakeholderCardData,
} from "@/components/StakeholderForms";
import { WorkbenchHeatmap } from "@/components/UseCaseHeatmap";
import {
  aiActWarnFor,
  parseAiAct,
  parseAiSuitability,
  parseDataReadiness,
} from "@/lib/entities/evaluators";
import {
  ZoneFlowStrip,
  DrillRow,
  ShowMore,
  CollapsedGroup,
  type FlowZone,
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
  const [locale, t, tGates, tArtifacts, tTypes, tFields, tEmpty, tEnt, tCriteria, tSt] =
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
      getTranslations("stakeholders"),
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

  // ── P1 entitások (#7a/#7b/#8) ───────────────────────────────
  const isP1 = phase === "P1";
  const [{ data: painData }, { data: useCaseData }, { data: stakeholderData }] = isP1
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
        supabase
          .from("stakeholders")
          .select("*")
          .eq("project_id", projectId)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true }),
      ])
    : [
        { data: [] as PainPointRow[] },
        { data: [] as UseCaseRow[] },
        { data: [] as StakeholderRow[] },
      ];
  const allPains = (painData ?? []) as PainPointRow[];
  const useCases = ((useCaseData ?? []) as UseCaseRow[]).filter(
    (u) => u.state !== "rejected",
  );
  const allStakeholders = (stakeholderData ?? []) as StakeholderRow[];

  // Fájdalompont ↔ stakeholder kötések (a kötőtáblán nincs project_id, ezért
  // a projekt fájdalompont-id-ira szűrünk). Térkép: pain-id → stakeholder-id-k.
  const painStakeholderMap = new Map<string, string[]>();
  if (isP1 && allPains.length > 0) {
    const { data: ppsData } = await supabase
      .from("pain_point_stakeholders")
      .select("*")
      .in(
        "pain_point_id",
        allPains.map((p) => p.id),
      );
    for (const row of (ppsData ?? []) as PainPointStakeholderRow[]) {
      const list = painStakeholderMap.get(row.pain_point_id) ?? [];
      list.push(row.stakeholder_id);
      painStakeholderMap.set(row.pain_point_id, list);
    }
  }
  // Kanonikus [n] (A8): csoport-alapú — bármely verzió-id a csoport indexére
  // oldódik, így a chipek a szerkesztő/források számozásával azonosak.
  const numberedInputs = numberSourceRows(inputs);
  const inputPos = numberedInputs.aliasIndex;
  const toIndices = (ids: string[]) =>
    [...new Set(ids.map((id) => inputPos.get(id)).filter((n): n is number => typeof n === "number"))];
  // A ① lista sorai: csoport-képviselők (legfrissebb verzió), kanonikus
  // sorrendben — a verzió-emelés nem szaporítja a listát, csak vN-t vált.
  const sourceRows = numberedInputs.inputIds
    .map((sid) => inputs.find((r) => r.id === sid))
    .filter((r): r is InputItemRow => Boolean(r));

  // A8: elavulás-nyugták (a jelölők deriváltak; itt csak a P1-kártyákhoz
  // kell — source_updated).
  const { data: ackData } = isP1
    ? await supabase.from("stale_acks").select("*").eq("project_id", projectId)
    : { data: [] as StaleAckRow[] };
  const staleAcks = (ackData ?? []) as StaleAckRow[];
  const sourceUpdatedFlag = (subjectType: string, subjectId: string, ids: string[]) =>
    activeStaleSince(
      sourceUpdatedSince(ids, inputs),
      staleAcks,
      subjectType,
      subjectId,
      "source_updated",
    );
  const painTitleById = new Map(allPains.map((p) => [p.id, p.title]));

  // Megerősített stakeholderek (a kötés csak ezekre mutathat) + kártya-adat.
  const stakeholderProposals = allStakeholders.filter((s) => s.state === "ai_suggested");
  const stakeholderConfirmed = allStakeholders.filter(
    (s) => s.state === "confirmed" || s.state === "manual",
  );
  const toStakeholderCard = (s: StakeholderRow): StakeholderCardData => ({
    id: s.id,
    name: s.name,
    title: s.title,
    influenceScore: s.influence_score,
    impactScore: s.impact_score,
    state: s.state,
    sourceIndices: toIndices(s.source_input_ids),
  });
  const stakeholderBindOptions = stakeholderConfirmed.map((s) => ({ id: s.id, name: s.name }));

  const toPainCard = (p: PainPointRow): PainPointCardData => ({
    id: p.id,
    title: p.title,
    description: p.description,
    quote: p.quote,
    severity: p.severity,
    state: p.state,
    sourceIndices: toIndices(p.source_input_ids),
  });
  // Fájdalompont-részlet: a kártya + a stakeholder-kötés (many-to-many, #8).
  const renderPainDetail = (p: PainPointRow) => (
    <div className="space-y-3">
      {/* A8: derivált forrás-frissült jelölő (a hivatkozott forrásnak újabb
          verziója van) + beépített „Ellenőrizve" nyugta. */}
      {sourceUpdatedFlag("pain_point", p.id, p.source_input_ids) && (
        <StaleFlag
          projectId={projectId}
          subjectType="pain_point"
          subjectId={p.id}
          kind="source_updated"
        />
      )}
      <PainPointProposalCard projectId={projectId} painPoint={toPainCard(p)} embedded />
      <div className="border-t border-line pt-3">
        <PainStakeholderBinder
          projectId={projectId}
          painPointId={p.id}
          options={stakeholderBindOptions}
          boundIds={painStakeholderMap.get(p.id) ?? []}
        />
      </div>
    </div>
  );
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
      shortlisted: u.list_status === "shortlist" || u.list_status === "selected",
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
        <div className="surface-card p-4">
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
              {/* Típus-specifikus entitás-generátor: shortlist (#7a F4) vagy
                  Megoldási javaslat (Csomag A, A5). */}
              {typeDef.key === "Megoldási javaslat" ? (
                <GenerateSolutionPlanForm projectId={projectId} />
              ) : (
                <GenerateShortlistFieldsForm projectId={projectId} />
              )}
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
      <div className="surface-card space-y-3 p-4">
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
                moduleOwned={fieldDef.moduleOwned}
                syncedAtLabel={
                  latest.synced_at
                    ? new Date(latest.synced_at).toLocaleString(dateLocale, {
                        timeZone: "Europe/Budapest",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : null
                }
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
    <section className="surface-card p-4">
      <p className="text-mono-sm text-ink-tertiary">{t("inputsLead", { phase })}</p>
      {inputs.length === 0 ? (
        <p className="mt-3 rounded-tile border border-dashed border-line px-3 py-6 text-center text-body text-ink-tertiary">
          {tEmpty("noSources")}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {/* A8: egy sor = egy verzió-csoport (legfrissebb verzió); a [n] a
              kanonikus csoport-index, a vN a verziószám. */}
          {sourceRows.map((input, i) => (
            <li key={input.id} className="card-sunken px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-body font-medium">
                  <span className="mr-1.5 font-mono text-mono-sm text-ink-tertiary">
                    [{i + 1}]
                  </span>
                  {input.type}
                  {(input.version ?? 1) > 1 && (
                    <span className="ml-1.5 rounded-3 bg-tint-done px-1.5 py-px font-mono text-[9.5px] font-bold text-done-text">
                      v{input.version}
                    </span>
                  )}
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
          {/* Fájdalompontok (v2: tömör lap, a „Next" CTA görgetési célpontja) */}
          <section
            id="pain-points"
            className="scroll-mt-4 rounded-tile border border-line bg-surface p-4 shadow-tile-sm"
          >
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
                      detail={renderPainDetail(p)}
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
                      detail={renderPainDetail(p)}
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
          <section className="surface-card p-4">
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
                          <div className="space-y-3">
                            {sourceUpdatedFlag("use_case", u.id, u.source_input_ids) && (
                              <StaleFlag
                                projectId={projectId}
                                subjectType="use_case"
                                subjectId={u.id}
                                kind="source_updated"
                              />
                            )}
                            <UseCaseCard projectId={projectId} useCase={toUseCaseCard(u)} embedded />
                          </div>
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

          {/* Stakeholderek (#8): kivonatolás → E1-javaslatok → megerősített
              sorok a dedikált nézetre mutató linkkel */}
          <section className="surface-card p-4">
            <h4 className="text-body font-semibold">
              {tSt("sectionTitle")}{" "}
              <span className="font-mono text-mono-sm font-normal text-ink-tertiary">
                {allStakeholders.filter((s) => s.state !== "rejected").length} ·{" "}
                {stakeholderConfirmed.length} {tSt("confirmedShort")}
              </span>
            </h4>
            <p className="mt-1 text-mono-sm text-ink-tertiary">{tSt("lead")}</p>
            <div className="mt-3">
              <ExtractStakeholdersForm projectId={projectId} />
            </div>

            {stakeholderProposals.length > 0 && (
              <div className="mt-3 space-y-2">
                <h5 className="text-mono-sm font-medium uppercase tracking-wide text-gate">
                  {tSt("needsConfirmationHeading", { n: stakeholderProposals.length })}
                </h5>
                {stakeholderProposals.map((s) => (
                  <StakeholderProposalCard
                    key={s.id}
                    projectId={projectId}
                    stakeholder={toStakeholderCard(s)}
                  />
                ))}
              </div>
            )}

            {stakeholderConfirmed.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <h5 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
                  {tSt("confirmedHeading")}
                </h5>
                {stakeholderConfirmed.map((s) => (
                  <StakeholderConfirmedRow
                    key={s.id}
                    projectId={projectId}
                    stakeholder={toStakeholderCard(s)}
                  />
                ))}
              </div>
            )}

            {stakeholderProposals.length === 0 && stakeholderConfirmed.length === 0 && (
              <p className="mt-3 text-body text-ink-tertiary">{tSt("noStakeholders")}</p>
            )}
            <div className="mt-3">
              <AddStakeholderForm projectId={projectId} />
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
    <p className="surface-card p-4 text-body text-ink-tertiary">{t("noTypesForPhase")}</p>
  ) : (
    <div className="space-y-5">
      {phaseTypes.map((typeDef) => (
        <FieldWorkBlock key={typeDef.key} typeDef={typeDef} />
      ))}
    </div>
  );

  const outputPanel =
    phaseTypes.length === 0 ? (
      <p className="surface-card p-4 text-body text-ink-tertiary">{t("noTypesForPhase")}</p>
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
      className={`surface-card p-4 ${state === "gate_pending" ? "border-gate/40" : ""}`}
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

  // ── Üres állapot (v2 1b): csak az Input él (dashed lila); a downstream
  // zónák megnevezik a saját unlock-feltételüket, alul a „Next best step". ──
  if (isP1 && inputs.length === 0) {
    const zLabel = (key: string) => tGates(key).replace(/^[^\p{L}]+/u, "");
    const lockedZone = (index: number, labelKey: string, lockText: string) => (
      <div className="flex flex-1 items-stretch">
        <span aria-hidden className="flex items-center px-1.5 text-neutral-300">
          ›
        </span>
        <div className="min-w-0 flex-1 rounded-tile border border-line bg-neutral-100 p-4 text-ink-tertiary">
          <div className="font-mono text-mono-sm font-bold uppercase tracking-wide">
            {index} · {zLabel(labelKey)}
          </div>
          <p className="mt-2 text-body">{lockText}</p>
        </div>
      </div>
    );
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-stretch gap-0 lg:flex-row lg:flex-wrap">
          <div className="flex flex-[1.3] flex-col items-center justify-center gap-2.5 rounded-tile border-[1.5px] border-dashed border-action bg-tint-action/40 p-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-tile bg-action-light text-action">
              <span className="text-title leading-none">+</span>
            </div>
            <h3 className="text-title">{t("emptyAddTitle")}</h3>
            <p className="max-w-md text-body text-ink-secondary">{t("emptyAddBody")}</p>
            <div className="mt-1 w-full max-w-md text-left">
              <PhaseInputForm projectId={projectId} phase={phase} />
            </div>
          </div>
          {lockedZone(2, "zoneTools", t("unlockWorkbench"))}
          {lockedZone(3, "zoneOutput", t("unlockOutput"))}
          {lockedZone(4, "zoneGate", t("gateCriteriaList"))}
        </div>
        <div className="flex items-center gap-3 rounded-tile border border-line-soft bg-context px-4 py-3">
          <span
            aria-hidden
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-3 bg-action-light text-action"
          >
            →
          </span>
          <span className="text-body font-semibold">{t("nextBestStep")}</span>
        </div>
      </div>
    );
  }

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
  // ── Output-mezők összegzése (kitöltött/kötelező) a flow-sáv Output-kártyához ──
  let outFilled = 0;
  let outRequired = 0;
  for (const td of phaseTypes) {
    const latest = latestOfType(td);
    if (!latest) continue;
    const c = completeness(td, parseArtifactFields(td, latest.fields));
    outFilled += c.filled;
    outRequired += c.required;
  }
  const firstStartedOutput = phaseTypes
    .map((td) => latestOfType(td))
    .find((a): a is ArtifactRow => a !== null);
  const latestOutputStatus = firstStartedOutput
    ? tArtifacts(`status.${firstStartedOutput.status}`)
    : undefined;

  const painTotal = allPains.filter((p) => p.state !== "rejected").length;
  const ucScored = useCases.filter(
    (u) => u.score_value !== null && u.score_feasibility !== null,
  ).length;

  // ── Kapu ──
  const firstUnmet = criteria.find((c) => !c.satisfied);
  const gateReady = hasGate(phase) && criteria.length > 0 && !firstUnmet;

  const stripLabel = (s: string) => s.replace(/^[^\p{L}]+/u, "");

  // ── Flow-zónák (v2): a négy zóna stat-kártyaként, nyíllal összekötve ──
  const zones: FlowZone[] = [
    {
      key: "input",
      index: 1,
      label: stripLabel(tGates("zoneInput")),
      tone: inputs.length > 0 ? "done" : "active",
      chip: inputs.length > 0 ? t("zoneReady") : undefined,
      // (A8: a metrika a csoport-számot mutatja — a verzió-emelés nem növeli)
      chipTone: "done",
      metric: `${sourceRows.length}`,
      metricLabel: t("zoneRawLabel"),
    },
    {
      key: "workbench",
      index: 2,
      label: stripLabel(tGates("zoneTools")),
      tone: "active",
      ...(isP1
        ? {
            metric: `${painConfirmed.length}/${painTotal}`,
            metricLabel: t("zonePainLabel"),
            metric2: { value: `${ucScored}`, label: t("zoneUcLabel") },
          }
        : {
            metric: `${confirmedFieldCount}`,
            metricLabel: t("zoneFieldLabel"),
          }),
    },
    {
      key: "output",
      index: 3,
      label: stripLabel(tGates("zoneOutput")),
      tone: "muted",
      chip: latestOutputStatus,
      chipTone: "muted",
      metric: outRequired > 0 ? `${outFilled}/${outRequired}` : undefined,
      metricLabel: outRequired > 0 ? t("zoneOutputLabel") : undefined,
    },
    {
      key: "gate",
      index: 4,
      label: stripLabel(tGates("zoneGate")),
      tone: "gate",
      chip: hasGate(phase) ? `${satisfiedCount}/${criteria.length}` : undefined,
      chipTone: "gate",
      sub: !hasGate(phase)
        ? undefined
        : gateReady
          ? t("gateReadyShort")
          : firstUnmet
            ? `${t("gateOpenLabel")} ${criterionLabel(firstUnmet, tCriteria, tTypes)}`
            : undefined,
      subMuted:
        hasGate(phase) && satisfiedCount > 0
          ? `${satisfiedCount} ${tGates("criterionSatisfied")}`
          : undefined,
    },
  ];

  const defaultZone =
    state === "open" || inputs.length === 0
      ? "input"
      : state === "gate_pending"
        ? "gate"
        : "workbench";

  // ── Összegző mondat + elsődleges „Next" CTA (v2) ──
  const firstProposalCode =
    painProposals.length > 0 ? (painCode.get(painProposals[0].id) ?? "") : "";
  const summaryLead = isP1
    ? t("summaryP1Lead", { confirmed: painConfirmed.length, total: painTotal, scored: ucScored })
    : t("summaryGeneric", { confirmed: confirmedFieldCount });
  const fieldsLeft = Math.max(0, outRequired - outFilled);
  const summaryRest = [
    isP1 && painProposals.length > 0 ? t("summaryWaiting", { code: firstProposalCode }) : "",
    fieldsLeft > 0 ? t("summaryFieldsLeft", { n: fieldsLeft }) : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-4">
      {/* Összegző mondat + elsődleges „Next" CTA (v2: halvány lila sáv) */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-tile border border-line-soft bg-context px-4 py-3">
        <p className="min-w-0 flex-1 text-body text-ink">
          <span className="font-semibold">{summaryLead}</span>
          {summaryRest && <span className="text-ink-secondary"> {summaryRest}</span>}
        </p>
        {isP1 && painProposals.length > 0 && (
          <a
            href="#pain-points"
            className="shrink-0 rounded-control bg-action px-3.5 py-2 text-body font-semibold text-white shadow-action transition-colors duration-[var(--motion-base)] hover:bg-action-hover"
          >
            {t("nextConfirm", { code: firstProposalCode })}
          </a>
        )}
      </div>

      <ZoneFlowStrip
        zones={zones}
        panels={{
          input: inputPanel,
          workbench: workbenchPanel,
          output: outputPanel,
          gate: gatePanel,
        }}
        defaultZone={defaultZone}
      />
    </div>
  );
}

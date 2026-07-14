import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  completeness,
  parseArtifactFields,
  typesForPhase,
  type ArtifactTypeDef,
} from "@/lib/artifacts/config";
import type { PhaseId } from "@/lib/phases/config";
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
  PainPointConfirmedRow,
  PainPointProposalCard,
  UseCaseCard,
  type PainPointCardData,
  type UseCaseCardData,
} from "@/components/EntityForms";
import { UseCaseViews } from "@/components/UseCaseHeatmap";
import {
  aiActWarnFor,
  parseAiAct,
  parseAiSuitability,
  parseDataReadiness,
} from "@/lib/entities/evaluators";
import { StatusPill } from "@/components/StatusPill";

// ─────────────────────────────────────────────────────────────
// Fázis-munkaterület ①–③ zóna (Coding-csomag #5a) — a #4 csontváz megtelik:
//   ① Bemenet: a projekt inputjai + hozzáadás fázis-címkével
//   ② Munkaeszközök: kivonatolás + mező-megerősítő kártyák (E1)
//   ③ Kimenet: a fázis artefaktum-típusai + generálás + szerkesztő-belépés
// A ④ Kapu a fázis-oldalon él (#4, változatlan).
// ─────────────────────────────────────────────────────────────

export async function PhaseWorkspace({
  supabase,
  projectId,
  phase,
}: {
  supabase: SupabaseClient;
  projectId: string;
  phase: PhaseId;
}) {
  const [locale, t, tGates, tArtifacts, tTypes, tFields, tEmpty, tEnt] =
    await Promise.all([
      getLocale(),
      getTranslations("workspace"),
      getTranslations("gates"),
      getTranslations("artifacts"),
      getTranslations("artifactTypes"),
      getTranslations("fields"),
      getTranslations("empty"),
      getTranslations("entities"),
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

  // ── P1 entitások (#7a): fájdalompontok + use case-ek ────────
  // A rejected sor a listákból kimarad, de a use case eredet-láncához
  // (chip-címek) MINDEN fájdalompontot betöltünk — az elvetett hivatkozás
  // címe is feloldódik.
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

  // A [n] jelölés a projekt kanonikus input-sorrendjére mutat — ugyanarra,
  // amit az ① zóna számoz.
  const inputPos = new Map(inputs.map((row, i) => [row.id, i + 1]));
  const toIndices = (ids: string[]) =>
    ids
      .map((id) => inputPos.get(id))
      .filter((n): n is number => typeof n === "number");
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
  const painProposals = allPains.filter((p) => p.state === "ai_suggested");
  const painConfirmed = allPains.filter(
    (p) => p.state === "confirmed" || p.state === "manual",
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

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* ── ① Bemenet ── */}
      <section className="glass-tile p-4">
        <h3 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
          {tGates("zoneInput")}
        </h3>
        <p className="mt-1 text-mono-sm text-ink-tertiary">
          {t("inputsLead", { phase })}
        </p>
        {inputs.length === 0 ? (
          <p className="mt-3 text-body text-ink-tertiary">{tEmpty("noSources")}</p>
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

      {/* ── ② Munkaeszközök ── */}
      <section className="glass-tile p-4">
        <h3 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
          {tGates("zoneTools")}
        </h3>
        {/* ── P1 entitás-szekciók (#7a): Fájdalompontok · Use case-ek ── */}
        {isP1 && (
          <div className="mt-1 space-y-5">
            <div className="space-y-3">
              <h4 className="text-body font-semibold">{tEnt("painSectionTitle")}</h4>
              <p className="text-mono-sm text-ink-tertiary">{tEnt("painLead")}</p>
              <ExtractPainPointsForm projectId={projectId} />
              {painProposals.length > 0 && (
                <div className="space-y-2">
                  <h5 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
                    {tEnt("proposalsHeading")}
                  </h5>
                  {painProposals.map((p) => (
                    <PainPointProposalCard
                      key={p.id}
                      projectId={projectId}
                      painPoint={toPainCard(p)}
                    />
                  ))}
                </div>
              )}
              {painConfirmed.length > 0 && (
                <div className="space-y-2">
                  <h5 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
                    {tEnt("confirmedHeading")}
                  </h5>
                  <ul className="space-y-1.5">
                    {painConfirmed.map((p) => (
                      <PainPointConfirmedRow
                        key={p.id}
                        projectId={projectId}
                        painPoint={toPainCard(p)}
                      />
                    ))}
                  </ul>
                </div>
              )}
              {painProposals.length === 0 && painConfirmed.length === 0 && (
                <p className="text-body text-ink-tertiary">{tEnt("noPains")}</p>
              )}
              <AddPainPointForm projectId={projectId} />
            </div>

            <div className="space-y-3">
              <h4 className="border-t border-line pt-3 text-body font-semibold">
                {tEnt("useCaseSectionTitle")}
              </h4>
              <p className="text-mono-sm text-ink-tertiary">{tEnt("useCaseLead")}</p>
              <DeriveUseCasesForm projectId={projectId} />
              {useCases.length > 0 ? (
                // Nézet-váltó (#7b): lista ⇄ hőtérkép. Pont = megerősített,
                // NEM kizárt, pontozott use case; a pontozatlan a térkép
                // melletti „Pontozásra vár" listába kerül.
                <UseCaseViews
                  points={useCases
                    .filter(
                      (u) =>
                        (u.state === "confirmed" || u.state === "manual") &&
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
                    }))}
                  unscored={useCases
                    .filter(
                      (u) =>
                        (u.state === "confirmed" || u.state === "manual") &&
                        u.list_status !== "excluded" &&
                        (u.score_value === null || u.score_feasibility === null),
                    )
                    .map((u) => ({ id: u.id, title: u.title }))}
                >
                  {useCases.map((u) => (
                    <div key={u.id} id={`uc-${u.id}`} className="rounded-tile">
                      <UseCaseCard projectId={projectId} useCase={toUseCaseCard(u)} />
                    </div>
                  ))}
                </UseCaseViews>
              ) : (
                <p className="text-body text-ink-tertiary">{tEnt("noUseCases")}</p>
              )}
              <AddUseCaseForm
                projectId={projectId}
                painOptions={painConfirmed.map((p) => ({ id: p.id, title: p.title }))}
              />
            </div>
          </div>
        )}
        {phaseTypes.length === 0 ? (
          <p className="mt-2 text-body text-ink-tertiary">{t("noTypesForPhase")}</p>
        ) : (
          <div className={isP1 ? "mt-5 space-y-5 border-t border-line pt-4" : "mt-1 space-y-5"}>
            {phaseTypes.map((typeDef) => {
              const versions = artifactsOfType(typeDef);
              const latest = versions[0] ?? null;
              const editable = latest?.status === "draft";
              const fields = latest
                ? parseArtifactFields(typeDef, latest.fields)
                : null;
              return (
                <div key={typeDef.key} className="space-y-3">
                  {/* Típusnév MINDIG látszik (#6): többtípusos fázisban enélkül
                      a kivonatolás-blokkok megkülönböztethetetlenek */}
                  <h4 className="border-t border-line pt-3 text-body font-semibold first:border-t-0 first:pt-0">
                    {typeName(typeDef)}
                  </h4>
                  <p className="text-mono-sm text-ink-tertiary">{t("toolsLead")}</p>
                  {latest && !editable && (
                    <p className="rounded-tile border border-dashed border-line px-3 py-2 text-body text-ink-tertiary">
                      {t("notDraftNotice")}
                    </p>
                  )}
                  {/* Entitás-forrású típus (#7a): a generikus kivonatolás nem
                      fut — a mezőket a ③ zóna entitás-akciója tölti. */}
                  {typeDef.entitySourced ? (
                    <p className="rounded-tile border border-dashed border-line px-3 py-2 text-body text-ink-tertiary">
                      {t("entitySourcedHint")}
                    </p>
                  ) : (
                    (!latest || editable) && (
                      <ExtractForm projectId={projectId} typeKey={typeDef.key} />
                    )
                  )}
                  {latest && fields && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-body font-semibold">
                          {t("fieldsTitle", { type: typeName(typeDef) })}
                        </h4>
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
                  {!latest && (
                    <p className="text-body text-ink-tertiary">{t("noDraftYet")}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── ③ Kimenet ── */}
      <section className="glass-tile p-4">
        <h3 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
          {tGates("zoneOutput")}
        </h3>
        {phaseTypes.length === 0 ? (
          <p className="mt-2 text-body text-ink-tertiary">{t("noTypesForPhase")}</p>
        ) : (
          <div className="mt-1 space-y-5">
            {phaseTypes.map((typeDef) => {
              const versions = artifactsOfType(typeDef);
              const latest = versions[0] ?? null;
              const fields = latest
                ? parseArtifactFields(typeDef, latest.fields)
                : null;
              const done = fields ? completeness(typeDef, fields) : null;
              const hasConfirmed = fields
                ? typeDef.fields.some((f) => {
                    const value = fields[f.key];
                    return (
                      (value.state === "confirmed" || value.state === "manual") &&
                      Boolean(value.value)
                    );
                  })
                : false;
              return (
                <div key={typeDef.key} className="space-y-3">
                  <p className="mt-1 text-mono-sm text-ink-tertiary">{t("outputLead")}</p>
                  <div className="rounded-tile border border-line bg-surface p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-body font-medium">{typeName(typeDef)}</span>
                      {latest ? (
                        <StatusPill
                          variant={latest.status}
                          label={`${tArtifacts(`status.${latest.status}`)} · v${latest.version}`}
                        />
                      ) : (
                        <span className="text-mono-sm text-ink-tertiary">
                          {t("noArtifactYet")}
                        </span>
                      )}
                    </div>
                    {latest && done && (
                      <p className="mt-1.5 font-mono text-mono-sm text-ink-tertiary">
                        {t("completeness", done)} ·{" "}
                        {t("versionsCount", { count: versions.length })}
                      </p>
                    )}
                    {/* Entitás-forrású mező-generálás (#7a): első draftot is
                        ez hoz létre; approved fej mellé új verziót tesz. */}
                    {typeDef.entitySourced &&
                      (!latest || latest.status !== "in_review") && (
                        <div className="mt-3">
                          <GenerateShortlistFieldsForm projectId={projectId} />
                        </div>
                      )}
                    {latest && (
                      <div className="mt-3 space-y-3">
                        {latest.status === "draft" &&
                          (hasConfirmed ? (
                            <GenerateBodyForm
                              projectId={projectId}
                              artifactId={latest.id}
                              hasBody={latest.body.trim() !== ""}
                            />
                          ) : (
                            <p className="text-mono-sm text-ink-tertiary">
                              {t("generateNeedsConfirmed")}
                            </p>
                          ))}
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
            })}
          </div>
        )}
      </section>
    </div>
  );
}

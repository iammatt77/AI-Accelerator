import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { IconCheck } from "@/components/icons";
import {
  MatrixCard,
  PainBinder,
  ProfileEditor,
  StrategyCard,
  UnifiedSourceList,
  type PainRow,
  type UnifiedSourceRow,
} from "@/components/StakeholderPage";
import { hasMatrixPoint, quadrant, type Quadrant } from "@/lib/stakeholders/matrix";
import type {
  ClientRow,
  InputItemRow,
  PainPointRow,
  PainPointStakeholderRow,
  ProjectRow,
  StakeholderRow,
} from "@/lib/db/types";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Dedikált stakeholder-lap — redesign (ref_stakeholder_lap.html): a
// Befolyás × Érintettség mátrix a HERO (a #8 MEGLÉVŐ influence/impact
// score-jaiból), mellette a kvadránsból származtatott verdikt + a manuális
// kommunikációs stratégia; alatta a kötött fájdalompontok és az EGYESÍTETT
// forráslista (a régi „tőle jövő" + „hozzárendelés" duplikáció megszűnik).
// Nincs új adatmodell/migráció — minden a meglévő #8 mezőkre és akciókra épül.
// ─────────────────────────────────────────────────────────────

interface ProjectWithClient extends ProjectRow {
  clients: ClientRow | null;
}

// Verdikt-kvadráns → keret/tag szín (a ref palettájából).
const VERDICT_STYLE: Record<Quadrant, { border: string; tag: string }> = {
  manage_closely: { border: "border-l-action", tag: "bg-tint-action text-action-deep" },
  keep_satisfied: { border: "border-l-gate", tag: "bg-tint-gate text-gate-text" },
  keep_informed: { border: "border-l-pivot", tag: "bg-tint-pivot text-pivot" },
  monitor: { border: "border-l-neutral-400", tag: "bg-neutral-150 text-ink-tertiary" },
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default async function StakeholderViewPage({
  params,
}: {
  params: Promise<{ id: string; stakeholderId: string }>;
}) {
  const { id, stakeholderId } = await params;
  const supabase = createServiceSupabaseClient();

  const [{ data: projectData }, { data: stakeholderData }] = await Promise.all([
    supabase.from("projects").select("*, clients ( * )").eq("id", id).maybeSingle(),
    supabase
      .from("stakeholders")
      .select("*")
      .eq("id", stakeholderId)
      .eq("project_id", id)
      .maybeSingle(),
  ]);
  if (!projectData || !stakeholderData) notFound();
  const project = projectData as ProjectWithClient;
  const stakeholder = stakeholderData as StakeholderRow;

  const [locale, t, tEnt, tClients] = await Promise.all([
    getLocale(),
    getTranslations("stakeholders"),
    getTranslations("entities"),
    getTranslations("clients"),
  ]);
  const dateLocale = locale === "hu" ? "hu-HU" : "en-GB";
  const tz = { timeZone: "Europe/Budapest" } as const;
  const shortDate = (iso: string) =>
    new Date(iso).toLocaleDateString(dateLocale, { ...tz, month: "short", day: "numeric" });

  // Kanonikus forrás-számozás (a workspace [n]-jével azonos: created_at, id).
  const { data: inputData } = await supabase
    .from("input_items")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  const inputs = (inputData ?? []) as InputItemRow[];
  const inputIndex = new Map(inputs.map((row, i) => [row.id, i + 1]));

  // Fájdalompontok (kockázattal) + kötések.
  const { data: allPainData } = await supabase
    .from("pain_points")
    .select("id, title, state, severity")
    .eq("project_id", id);
  const allPains = (allPainData ?? []) as Pick<
    PainPointRow,
    "id" | "title" | "state" | "severity"
  >[];
  const activePains = allPains.filter((p) => p.state !== "rejected");
  const projectHasPains = activePains.length > 0;

  const { data: ppsData } = await supabase
    .from("pain_point_stakeholders")
    .select("*")
    .eq("stakeholder_id", stakeholderId);
  const boundPainIds = new Set(
    ((ppsData ?? []) as PainPointStakeholderRow[]).map((r) => r.pain_point_id),
  );
  // A pain „kockázata" a ref-ben = a fájdalompont severity mezője (low/med/high).
  const toPainRow = (p: (typeof activePains)[number]): PainRow => ({
    id: p.id,
    title: p.title,
    risk: p.severity,
  });
  const boundPains = activePains.filter((p) => boundPainIds.has(p.id)).map(toPainRow);
  const unboundPains = activePains.filter((p) => !boundPainIds.has(p.id)).map(toPainRow);

  // Egyesített forráslista: MINDEN bemenet egy sor; assigned =
  // stakeholder_source_id, extraction-forrás = source_input_ids.
  const sourceSet = new Set(stakeholder.source_input_ids);
  const preview = (text: string) => (text.length > 120 ? `${text.slice(0, 120)}…` : text);
  const sourceRows: UnifiedSourceRow[] = inputs.map((row) => ({
    id: row.id,
    index: inputIndex.get(row.id) ?? 0,
    type: row.type,
    preview: preview(row.raw_text),
    dateLabel: shortDate(row.created_at),
    assigned: row.stakeholder_source_id === stakeholderId,
    extractionSource: sourceSet.has(row.id),
  }));

  // Mátrix-pont + verdikt.
  const point = hasMatrixPoint(stakeholder.influence_score, stakeholder.impact_score);
  const q: Quadrant | null = point
    ? quadrant(stakeholder.influence_score as number, stakeholder.impact_score as number)
    : null;

  const stateVisual =
    stakeholder.state === "confirmed" || stakeholder.state === "manual";
  const canBindPains = stakeholder.state === "confirmed" || stakeholder.state === "manual";

  return (
    <div className="space-y-5">
      {/* ── Fejléc + profil ── */}
      <div className="rounded-shell border border-line bg-surface p-5 shadow-card">
        <div className="mb-3 flex items-center gap-2">
          <Link
            href={`/project/${id}`}
            className="font-mono text-[11px] text-ink-tertiary hover:text-ink-secondary hover:underline"
          >
            ← {t("crumb")}
          </Link>
          <span className="font-mono text-[11px] text-neutral-400">/</span>
          <span className="font-mono text-[11px] text-ink-tertiary">
            {project.clients?.name ?? tClients("unknown")} · {project.name}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#1F5AE8] to-[#163E9E] text-[20px] font-extrabold text-white">
            {initialsOf(stakeholder.name)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[23px] font-extrabold tracking-tight">{stakeholder.name}</span>
              {stateVisual ? (
                <span className="inline-flex items-center gap-1.5 rounded-pill bg-tint-done px-2.5 py-[3px] text-[11.5px] font-semibold text-done-text">
                  <IconCheck size={9} />
                  {tEnt(`state.${stakeholder.state}`)}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-pill bg-tint-action px-2.5 py-[3px] text-[11.5px] font-semibold text-action-deep">
                  {tEnt(`state.${stakeholder.state}`)}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[13.5px] text-ink-secondary">
              {stakeholder.title ?? t("noTitle")}
            </div>
          </div>
          <div className="flex-1" />
          <ProfileEditor
            projectId={id}
            stakeholderId={stakeholderId}
            name={stakeholder.name}
            title={stakeholder.title}
          />
        </div>
      </div>

      {/* ── HERO: mátrix + verdikt/stratégia ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[400px_minmax(0,1fr)]">
        <MatrixCard
          projectId={id}
          stakeholderId={stakeholderId}
          influence={stakeholder.influence_score}
          impact={stakeholder.impact_score}
          aiSuggested={stakeholder.state === "ai_suggested"}
          initials={initialsOf(stakeholder.name)}
        />

        <div className="flex flex-col gap-4">
          {/* Verdikt (kvadránsból származtatva) */}
          {q ? (
            <div
              className={`rounded-shell border border-line border-l-[3px] bg-surface p-5 shadow-card ${VERDICT_STYLE[q].border}`}
            >
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
                  {t("verdictLabel")}
                </span>
                <span
                  className={`rounded-3 px-2 py-0.5 font-mono text-[10px] font-bold ${VERDICT_STYLE[q].tag}`}
                >
                  {t(`verdict.${q}.tag`)}
                </span>
              </div>
              <div className="mt-2 text-[19px] font-extrabold leading-tight tracking-tight text-ink">
                {t(`verdict.${q}.title`)}
              </div>
              <p className="mt-2 text-[13px] leading-[1.6] text-ink-secondary">
                {t(`verdict.${q}.body`)}
              </p>
            </div>
          ) : (
            <div className="rounded-shell border border-dashed border-neutral-400 bg-soft p-5">
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-gate-text">
                {t("verdictLabel")}
              </span>
              <p className="mt-2 text-[13.5px] leading-[1.55] text-ink-secondary">
                {t("verdictNeedsScore")}
              </p>
            </div>
          )}

          <StrategyCard
            projectId={id}
            stakeholderId={stakeholderId}
            strategy={stakeholder.communication_strategy}
            updatedLabel={t("strategyUpdated", {
              date: shortDate(stakeholder.updated_at ?? stakeholder.created_at),
            })}
          />
        </div>
      </div>

      {/* ── Kötött fájdalompontok ── */}
      {!projectHasPains ? (
        <div className="rounded-shell border border-line bg-surface p-5 shadow-card">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
            {t("boundPainsTitle")}
          </span>
          <p className="mt-3 rounded-tile border border-dashed border-line px-3 py-3 text-body text-ink-tertiary">
            {t("boundPainsP0Hint")}
          </p>
        </div>
      ) : canBindPains ? (
        <PainBinder
          projectId={id}
          stakeholderId={stakeholderId}
          bound={boundPains}
          unbound={unboundPains}
        />
      ) : (
        <div className="rounded-shell border border-line bg-surface p-5 shadow-card">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
            {t("boundPainsTitle")}
          </span>
          <p className="mt-3 rounded-tile border border-dashed border-line px-3 py-3 text-body text-ink-tertiary">
            {t("bindNeedsConfirm")}
          </p>
        </div>
      )}

      {/* ── Egyesített forráslista ── */}
      {inputs.length > 0 ? (
        <UnifiedSourceList projectId={id} stakeholderId={stakeholderId} rows={sourceRows} />
      ) : (
        <div className="rounded-shell border border-line bg-surface p-5 shadow-card">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
            {t("unifiedSourcesTitle")}
          </span>
          <p className="mt-3 rounded-tile border border-dashed border-line px-3 py-3 text-body text-ink-tertiary">
            {t("noInputsToAssign")}
          </p>
        </div>
      )}
    </div>
  );
}

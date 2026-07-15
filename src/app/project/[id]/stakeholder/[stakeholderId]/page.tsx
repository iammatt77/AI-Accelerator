import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { FieldStateBadge } from "@/components/FieldStateBadge";
import {
  InputAssignRow,
  StakeholderScoreForm,
  StakeholderStrategyForm,
} from "@/components/StakeholderView";
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
// Dedikált stakeholder-nézet (#8) — a Handoff Master tömör-lapos nyelvében:
// fejléc (név · titulus · state ikon+szöveg) → influence/impact score →
// kommunikációs stratégia (manuális) → tőle jövő információ (a kötött
// bemenetekből, forrással) → kötött fájdalompontok (P0-ban üres, jelzéssel).
// Minden interaktív rész a MEGLÉVŐ stakeholder-actionöket hívja.
// ─────────────────────────────────────────────────────────────

interface ProjectWithClient extends ProjectRow {
  clients: ClientRow | null;
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

  // Kanonikus forrás-számozás (a workspace [n]-jével azonos: created_at, id).
  const { data: inputData } = await supabase
    .from("input_items")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  const inputs = (inputData ?? []) as InputItemRow[];
  const inputIndex = new Map(inputs.map((row, i) => [row.id, i + 1]));

  // Kötött fájdalompontok (many-to-many) + a projekt fájdalompont-léte (P0-jelzés).
  const { data: allPainData } = await supabase
    .from("pain_points")
    .select("id, title, state")
    .eq("project_id", id);
  const allPains = (allPainData ?? []) as Pick<PainPointRow, "id" | "title" | "state">[];
  const projectHasPains = allPains.some((p) => p.state !== "rejected");

  const { data: ppsData } = await supabase
    .from("pain_point_stakeholders")
    .select("*")
    .eq("stakeholder_id", stakeholderId);
  const boundPainIds = new Set(
    ((ppsData ?? []) as PainPointStakeholderRow[]).map((r) => r.pain_point_id),
  );
  const boundPains = allPains.filter((p) => boundPainIds.has(p.id) && p.state !== "rejected");

  // „Tőle jövő információ": a source_input_ids ∪ stakeholder_source_id inputok.
  const sourceSet = new Set(stakeholder.source_input_ids);
  const fromThem = inputs.filter(
    (row) => sourceSet.has(row.id) || row.stakeholder_source_id === stakeholderId,
  );

  const stateVisual =
    stakeholder.state === "ai_suggested"
      ? "ai_filled"
      : stakeholder.state === "confirmed"
        ? "confirmed"
        : "manual";

  const preview = (text: string) => (text.length > 160 ? `${text.slice(0, 160)}…` : text);

  return (
    <div className="space-y-4">
      {/* Fejléc */}
      <div className="border-b border-line-soft pb-4">
        <Link
          href={`/project/${id}`}
          className="font-mono text-[11px] text-ink-tertiary hover:text-ink-secondary hover:underline"
        >
          ← {t("backToProject")}
        </Link>
        <div className="mt-1 font-mono text-[11px] text-ink-tertiary">
          {project.clients?.name ?? tClients("unknown")} / {project.name} / {t("crumb")}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="text-[20px] font-bold tracking-tight">{stakeholder.name}</h1>
          <span className="text-body text-ink-secondary">{stakeholder.title ?? t("noTitle")}</span>
          <FieldStateBadge state={stateVisual} label={tEnt(`state.${stakeholder.state}`)} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Score */}
        <section className="rounded-shell border border-line bg-surface p-4 shadow-card">
          <h2 className="mb-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink-tertiary">
            {t("scoreSectionTitle")}
          </h2>
          <StakeholderScoreForm
            projectId={id}
            stakeholderId={stakeholderId}
            influenceScore={stakeholder.influence_score}
            impactScore={stakeholder.impact_score}
            aiSuggested={stakeholder.state === "ai_suggested"}
          />
        </section>

        {/* Kommunikációs stratégia (manuális) */}
        <section className="rounded-shell border border-line bg-surface p-4 shadow-card">
          <h2 className="mb-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink-tertiary">
            {t("strategyTitle")}
          </h2>
          <StakeholderStrategyForm
            projectId={id}
            stakeholderId={stakeholderId}
            strategy={stakeholder.communication_strategy}
          />
        </section>
      </div>

      {/* Tőle jövő információ */}
      <section className="rounded-shell border border-line bg-surface p-4 shadow-card">
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink-tertiary">
          {t("fromThemTitle")}
        </h2>
        <p className="mt-1 text-mono-sm text-ink-tertiary">{t("fromThemLead")}</p>
        {fromThem.length === 0 ? (
          <p className="mt-3 rounded-tile border border-dashed border-line px-3 py-3 text-body text-ink-tertiary">
            {t("noFromThem")}
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {fromThem.map((row) => (
              <div key={row.id} className="card-sunken px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 font-mono text-mono-sm text-pivot">
                    [{inputIndex.get(row.id)}]
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body font-medium">{row.type}</span>
                  <span className="shrink-0 font-mono text-[10px] text-ink-tertiary">
                    {new Date(row.created_at).toLocaleDateString(dateLocale, tz)}
                  </span>
                </div>
                <p className="mt-1 text-mono-sm leading-relaxed text-ink-secondary">
                  {preview(row.raw_text)}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Bemenet-forrás hozzárendelés (3a): suggest + confirm, nincs kényszer */}
        {inputs.length > 0 && (
          <div className="mt-4 border-t border-line-soft pt-3">
            <h3 className="text-mono-sm font-semibold text-ink-secondary">
              {t("assignSectionTitle")}
            </h3>
            <p className="mt-0.5 text-mono-sm text-ink-tertiary">{t("assignHint")}</p>
            <div className="mt-2 space-y-2">
              {inputs.map((row) => (
                <InputAssignRow
                  key={row.id}
                  projectId={id}
                  stakeholderId={stakeholderId}
                  inputId={row.id}
                  index={inputIndex.get(row.id) ?? 0}
                  type={row.type}
                  preview={preview(row.raw_text)}
                  assigned={row.stakeholder_source_id === stakeholderId}
                  suggested={sourceSet.has(row.id)}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Kötött fájdalompontok */}
      <section className="rounded-shell border border-line bg-surface p-4 shadow-card">
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink-tertiary">
          {t("boundPainsTitle")}
        </h2>
        {!projectHasPains ? (
          <p className="mt-3 rounded-tile border border-dashed border-line px-3 py-3 text-body text-ink-tertiary">
            {t("boundPainsP0Hint")}
          </p>
        ) : boundPains.length === 0 ? (
          <p className="mt-3 rounded-tile border border-dashed border-line px-3 py-3 text-body text-ink-tertiary">
            {t("noBoundPains")}
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {boundPains.map((p) => (
              <li
                key={p.id}
                className="rounded-tile border border-line bg-surface px-3 py-2 text-body shadow-tile-sm"
              >
                {p.title}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

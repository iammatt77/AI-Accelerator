import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { AcEditor } from "@/components/AcEditor";
import { AcDeleteButton } from "@/components/AcDeleteButton";
import { StakeholderLinkEditor } from "@/components/StakeholderLinkEditor";
import { MoscowChip } from "@/components/RequirementsBoard";
import { buildTree, lineageOf } from "@/lib/requirements/model";
import { loadNumberedSources, inputIdsToIndices } from "@/lib/sources";
import type {
  AcceptanceCriterionRow,
  RequirementRow,
  RequirementStoryRow,
  StakeholderRequirementRow,
  StakeholderRow,
  UserStoryRow,
} from "@/lib/db/types";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Requirement-részlet (#11, 2. jelenet): szint/altípus/lebontás meta, az
// AC-k (Given–When–Then, „közös · a story-kkal" — az AC-nél a kötött
// story-k), a megvalósító story-k (N:M), forrás ([n]) és eredet (E1).
// ─────────────────────────────────────────────────────────────

export default async function RequirementDetailPage({
  params,
}: {
  params: Promise<{ id: string; reqId: string }>;
}) {
  const { id, reqId } = await params;
  const t = await getTranslations("requirements");
  const supabase = createServiceSupabaseClient();

  const [{ data: reqRows }, { data: acRows }, { data: linkRows }, { data: storyRows }, { data: shLinkRows }, { data: shRows }] =
    await Promise.all([
      supabase.from("requirements").select("*").eq("project_id", id),
      supabase.from("acceptance_criteria").select("*").order("ord", { ascending: true }),
      supabase.from("requirement_stories").select("*"),
      supabase.from("user_stories").select("*").eq("project_id", id),
      supabase.from("stakeholder_requirements").select("*"),
      supabase.from("stakeholders").select("*").eq("project_id", id),
    ]);
  const requirements = (reqRows ?? []) as RequirementRow[];
  const req = requirements.find((r) => r.id === reqId);
  if (!req) notFound();

  const tree = buildTree(requirements);
  const lineage = lineageOf(req, tree.byId);
  const acs = ((acRows ?? []) as AcceptanceCriterionRow[]).filter((a) => a.requirement_id === reqId);
  const links = (linkRows ?? []) as RequirementStoryRow[];
  const stories = (storyRows ?? []) as UserStoryRow[];
  const implementing = links
    .filter((l) => l.requirement_id === reqId)
    .map((l) => stories.find((s) => s.id === l.story_id))
    .filter((s): s is UserStoryRow => s !== undefined);
  const storiesForAc = (acReqId: string) =>
    links
      .filter((l) => l.requirement_id === acReqId)
      .map((l) => stories.find((s) => s.id === l.story_id)?.display_id)
      .filter(Boolean)
      .join(", ");
  const allStakeholders = (shRows ?? []) as StakeholderRow[];
  const boundStakeholderIds = new Set(
    ((shLinkRows ?? []) as StakeholderRequirementRow[])
      .filter((l) => l.requirement_id === reqId)
      .map((l) => l.stakeholder_id),
  );
  const boundStakeholders = allStakeholders.filter((s) => boundStakeholderIds.has(s.id));
  const availableStakeholders = allStakeholders.filter((s) => !boundStakeholderIds.has(s.id));
  const shNames = boundStakeholders.map((s) => s.name);

  // Forrás-chipek: a kanonikus [n] számozással.
  const loaded = await loadNumberedSources(supabase, id);
  const sourceChips =
    "error" in loaded
      ? []
      : inputIdsToIndices(req.source_input_ids, loaded.aliasIndex).map((n) => ({
          n,
          title: loaded.sources[n - 1]?.title ?? "?",
        }));

  const idTone =
    req.level === "system" && req.subtype === "non_functional"
      ? "border-[#EADFC0] bg-tint-gate text-gate-text"
      : req.level === "system"
        ? "border-[#C7DEEF] bg-tint-sky text-pivot"
        : "border-[#B9CCF7] bg-tint-action text-action-deep";

  return (
    <div className="overflow-hidden rounded-shell border border-line bg-[#FBFBFD] shadow-card">
      {/* fejléc */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-3.5">
        <span className={`rounded-4 border px-2.5 py-1 font-mono text-[11px] font-bold ${idTone}`}>
          {req.display_id}
        </span>
        <span className="min-w-0 flex-1 text-[16px] font-bold tracking-[-0.01em]">{req.text}</span>
        <MoscowChip moscow={req.moscow} />
      </div>
      {/* meta */}
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-[#FDFDFE] px-5 py-3">
        <span className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
          <span className="font-mono text-[9px] font-bold uppercase text-ink-tertiary">{t("metaLevel")}</span>
          <span className="font-semibold">{t(`level.${req.level}`)}</span>
        </span>
        {req.subtype && (
          <>
            <span className="h-4 w-px bg-line" />
            <span className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
              <span className="font-mono text-[9px] font-bold uppercase text-ink-tertiary">{t("metaSubtype")}</span>
              <span
                className={`rounded-pill border px-2.5 py-0.5 font-bold ${
                  req.subtype === "non_functional"
                    ? "border-[#EADFC0] bg-tint-gate text-gate-text"
                    : "border-[#C7DEEF] bg-tint-sky text-pivot"
                }`}
              >
                {t(`subtype.${req.subtype}`)}
              </span>
            </span>
          </>
        )}
        <span className="h-4 w-px bg-line" />
        <span className="flex items-center gap-2 text-[12px] text-ink-secondary">
          <span className="font-mono text-[9px] font-bold uppercase text-ink-tertiary">{t("metaLineage")}</span>
          <span className="flex items-center gap-1.5 font-mono text-[11px]">
            {lineage.map((r, i) => (
              <span key={r.id} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-ink-tertiary">→</span>}
                <span className={r.id === req.id ? "font-bold text-ink" : "font-bold text-action-deep"}>
                  {r.display_id}
                </span>
              </span>
            ))}
          </span>
        </span>
        {shNames.map((n) => (
          <span key={n} className="rounded-pill border border-neutral-350 bg-sunken px-2 py-0.5 font-mono text-[9px] text-ink-secondary">
            👤 {n}
          </span>
        ))}
        <span className="ml-auto">
          <Link
            href={`/project/${id}/requirements`}
            className="font-mono text-[10.5px] font-semibold text-action-deep hover:underline"
          >
            ← {t("backToBoard")}
          </Link>
        </span>
      </div>

      <div className="grid grid-cols-[1fr_320px]">
        {/* AC-k — a KÖZÖS AC forrása (min-w-0: a 1fr sáv szűküljön, a GWT törjön) */}
        <div className="min-w-0 border-r border-line p-5">
          <div className="mb-3.5 flex items-center gap-2.5">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-ink">
              {t("acSection")}
            </span>
            <span className="rounded-3 border border-[#CBD9F9] bg-tint-action px-2 py-px font-mono text-[9.5px] font-bold text-action-deep">
              {t("acSharedWithStories")}
            </span>
          </div>
          {acs.length === 0 && (
            <p className="mb-2 rounded-tile border border-[#EADFC0] bg-tint-gate px-3 py-2 text-[12px] text-gate-text">
              ● {t("noAc")}
            </p>
          )}
          {acs.map((ac, i) => (
            <div key={ac.id} className="mb-3 overflow-hidden rounded-tile border border-line">
              <div className="flex items-center gap-2 border-b border-line-soft bg-[#F7F8FB] px-3.5 py-2">
                <span className="shrink-0 font-mono text-[9.5px] font-bold text-ink-tertiary">AC-{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{ac.title}</span>
                <span className="shrink-0 rounded-3 border border-[#CBD9F9] bg-tint-action px-1.5 py-px font-mono text-[8.5px] font-bold text-action-deep">
                  ◑ {storiesForAc(reqId) || t("acNoStoryYet")}
                </span>
                {req.level === "system" && <AcDeleteButton projectId={id} reqId={reqId} acId={ac.id} />}
              </div>
              <div className="flex flex-col gap-2 p-3.5">
                {(
                  [
                    ["GIVEN", "border-[#C7DEEF] bg-tint-sky text-pivot", ac.given_text],
                    ["WHEN", "border-[#CBD9F9] bg-tint-action text-action-deep", ac.when_text],
                    ["THEN", "border-[#CDE7DA] bg-tint-done text-done-text", ac.then_text],
                  ] as const
                ).map(([kw, cls, text]) => (
                  <div key={kw} className="flex items-start gap-2.5">
                    <span className={`min-w-[52px] shrink-0 rounded-4 border px-2 py-0.5 text-center font-mono text-[10px] font-bold ${cls}`}>
                      {kw}
                    </span>
                    <span className="min-w-0 flex-1 break-words text-[13px] leading-[1.5] text-[#33374A]">{text}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {req.level === "system" && <AcEditor projectId={id} reqId={reqId} />}
        </div>

        {/* oldalsáv: megvalósító story-k + forrás + eredet */}
        <div className="flex flex-col gap-4 bg-[#FAFAFC] p-4.5 pl-5">
          <div>
            <div className="mb-2.5 flex items-center gap-2">
              <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-action-deep">
                {t("implementingSection")}
              </span>
              <span className="rounded-3 bg-tint-action px-1.5 py-px font-mono text-[9px] font-bold text-action-deep">
                N:M · {implementing.length}
              </span>
            </div>
            {implementing.length === 0 && (
              <p className="text-[11.5px] text-ink-tertiary">○ {t("noStory")}</p>
            )}
            {implementing.map((s) => (
              <Link
                key={s.id}
                href={`/project/${id}/requirements/s/${s.id}`}
                className="mb-2 flex flex-col gap-1 rounded-tile border border-[#CBD9F9] border-l-[3px] border-l-action-deep bg-surface px-3 py-2.5"
              >
                <span className="flex items-center gap-1.5">
                  <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-tint-action text-[8px] font-bold text-action-deep">US</span>
                  <span className="font-mono text-[9.5px] font-bold text-action-deep">{s.display_id}</span>
                  <span className="ml-auto">
                    <MoscowChip moscow={s.moscow} small />
                  </span>
                </span>
                <span className="text-[11.5px] leading-[1.4] text-[#33374A]">
                  {t("storyAs", { role: s.role })} {t("storyWant", { want: s.want })}
                </span>
              </Link>
            ))}
            <p className="mt-1 text-[10.5px] leading-[1.4] text-ink-tertiary">{t("bidirectionalNote")}</p>
          </div>
          <div className="h-px bg-line" />
          <div>
            <div className="mb-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
              {t("sourceSection")}
            </div>
            {sourceChips.length === 0 ? (
              <p className="text-[11.5px] text-ink-tertiary">{t("noSource")}</p>
            ) : (
              sourceChips.map((c) => (
                <Link
                  key={c.n}
                  href={`/project/${id}/sources`}
                  className="mb-1.5 flex items-center gap-2 rounded-4 border border-[#C7DEEF] bg-surface px-2.5 py-2 text-[12px] font-semibold"
                >
                  <span className="font-mono text-[10px] font-bold text-pivot">[{c.n}]</span>
                  <span className="truncate">{c.title}</span>
                </Link>
              ))
            )}
          </div>
          <div>
            <div className="mb-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
              {t("originSection")}
            </div>
            <div className="flex items-center gap-2 rounded-4 border border-[#B9CCF7] bg-tint-action px-2.5 py-2">
              <span className="text-[13px]">{req.state === "manual" ? "✎" : "✦"}</span>
              <span className="text-[11px] leading-[1.4] text-[#17357F]">
                {req.state === "ai_suggested" && t("originAiPending")}
                {req.state === "confirmed" && t.rich("originAiConfirmed", { b: (c) => <b>{c}</b> })}
                {req.state === "manual" && t("originManual")}
                {req.state === "rejected" && t("originRejected")}
              </span>
            </div>
          </div>
          {req.level === "stakeholder" && (
            <>
              <div className="h-px bg-line" />
              <StakeholderLinkEditor
                projectId={id}
                reqId={reqId}
                bound={boundStakeholders}
                available={availableStakeholders}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

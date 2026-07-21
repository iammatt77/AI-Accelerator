import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { MoscowChip } from "@/components/RequirementsBoard";
import { buildTree, inheritedAcs, lineageOf } from "@/lib/requirements/model";
import { loadNumberedSources, inputIdsToIndices } from "@/lib/sources";
import type {
  AcceptanceCriterionRow,
  EpicRow,
  RequirementRow,
  RequirementStoryRow,
  UserStoryRow,
} from "@/lib/db/types";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Story-részlet (#11, 4. jelenet): a story-mondat (As a / I want / so that),
// az epic, a lefedett requirementek (N:M — kattintva a BA-részlet felé), és
// a KÖZÖS AC: a requirementtől örökölve, ⤴ jelöléssel — NEM másolat, ugyanaz
// az acceptance_criteria rekord, ami a requirement-részleten látszik.
// ─────────────────────────────────────────────────────────────

export default async function StoryDetailPage({
  params,
}: {
  params: Promise<{ id: string; storyId: string }>;
}) {
  const { id, storyId } = await params;
  const t = await getTranslations("requirements");
  const supabase = createServiceSupabaseClient();

  const [{ data: storyRows }, { data: reqRows }, { data: acRows }, { data: linkRows }, { data: epicRows }] =
    await Promise.all([
      supabase.from("user_stories").select("*").eq("project_id", id),
      supabase.from("requirements").select("*").eq("project_id", id),
      supabase.from("acceptance_criteria").select("*").order("ord", { ascending: true }),
      supabase.from("requirement_stories").select("*"),
      supabase.from("epics").select("*").eq("project_id", id),
    ]);
  const story = ((storyRows ?? []) as UserStoryRow[]).find((s) => s.id === storyId);
  if (!story) notFound();

  const requirements = (reqRows ?? []) as RequirementRow[];
  const tree = buildTree(requirements);
  const links = (linkRows ?? []) as RequirementStoryRow[];
  const acs = (acRows ?? []) as AcceptanceCriterionRow[];
  const epic = ((epicRows ?? []) as EpicRow[]).find((e) => e.id === story.epic_id) ?? null;
  const covered = links
    .filter((l) => l.story_id === storyId)
    .map((l) => tree.byId.get(l.requirement_id))
    .filter((r): r is RequirementRow => r !== undefined);
  // A KÖZÖS AC-k: a lefedett requirement(ek) AC-rekordjai a kötésen át.
  const shared = inheritedAcs(storyId, links, acs, tree.byId);
  const otherCoverNote = covered.find((r) =>
    links.some((l) => l.requirement_id === r.id && l.story_id !== storyId),
  );

  // Forrás-chipek: a story tényleges forrás-inputjai a kanonikus [n]
  // számozással (korábbi bug: a .length jelent meg [N]-ként, mindig [1]).
  const loaded = await loadNumberedSources(supabase, id);
  const sourceChips =
    "error" in loaded
      ? []
      : inputIdsToIndices(story.source_input_ids, loaded.aliasIndex).map((n) => ({
          n,
          title: loaded.sources[n - 1]?.title ?? "?",
        }));

  return (
    <div className="overflow-hidden rounded-shell border border-line bg-[#FBFBFD] shadow-card">
      {/* fejléc */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-3.5">
        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-tint-action text-[9px] font-bold text-action-deep">US</span>
        <span className="rounded-4 border border-[#CBD9F9] bg-tint-action px-2.5 py-1 font-mono text-[11px] font-bold text-action-deep">
          {story.display_id}
        </span>
        {epic && (
          <span className="font-mono text-[10px] font-semibold text-action-deep">
            ⤴ {epic.display_id} {epic.title}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <MoscowChip moscow={story.moscow} />
          <Link
            href={`/project/${id}/requirements`}
            className="font-mono text-[10.5px] font-semibold text-action-deep hover:underline"
          >
            ← {t("backToBoard")}
          </Link>
        </span>
      </div>
      {/* a story-mondat */}
      <div className="border-b border-line bg-[#F7FAFE] px-5 py-5">
        <p className="max-w-[820px] text-[19px] font-semibold leading-[1.5] tracking-[-0.01em]">
          <span className="mr-1 rounded-4 border border-[#CBD9F9] bg-surface px-2 py-0.5 align-middle font-mono text-[11px] font-bold text-action-deep">
            {t("asA")}
          </span>{" "}
          <span className="font-extrabold text-action-deep">{story.role}</span>{" "}
          <span className="mx-1 rounded-4 border border-[#CBD9F9] bg-surface px-2 py-0.5 align-middle font-mono text-[11px] font-bold text-action-deep">
            {t("iWant")}
          </span>{" "}
          {story.want},{" "}
          <span className="mx-1 rounded-4 border border-[#CBD9F9] bg-surface px-2 py-0.5 align-middle font-mono text-[11px] font-bold text-action-deep">
            {t("soThatKw")}
          </span>{" "}
          {story.so_that}.
        </p>
      </div>

      <div className="grid grid-cols-[320px_minmax(0,1fr)]">
        {/* oldalsáv: lefedett requirementek (N:M) + forrás + eredet */}
        <div className="flex flex-col gap-4 border-r border-line bg-[#FAFAFC] p-4.5 pl-5">
          <div>
            <div className="mb-2.5 flex items-center gap-2">
              <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-pivot">
                {t("coveredSection")}
              </span>
              <span className="rounded-3 bg-tint-sky px-1.5 py-px font-mono text-[9px] font-bold text-pivot">
                N:M · {covered.length}
              </span>
            </div>
            {covered.map((r) => {
              const parent = r.parent_id ? tree.byId.get(r.parent_id) : undefined;
              return (
                <Link
                  key={r.id}
                  href={`/project/${id}/requirements/r/${r.id}`}
                  className={`mb-2 flex flex-col gap-1 rounded-tile border border-l-[3px] bg-surface px-3 py-2.5 ${
                    r.subtype === "non_functional"
                      ? "border-[#EADFC0] border-l-gate"
                      : "border-[#C7DEEF] border-l-pivot"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`font-mono text-[9.5px] font-bold ${
                        r.subtype === "non_functional" ? "text-gate-text" : "text-pivot"
                      }`}
                    >
                      {r.display_id}
                    </span>
                    <span className="ml-auto">
                      <MoscowChip moscow={r.moscow} small />
                    </span>
                  </span>
                  <span className="text-[11.5px] leading-[1.4] text-[#33374A]">{r.text}</span>
                  <span className="font-mono text-[8.5px] text-ink-tertiary">
                    {r.subtype ? t(`subtype.${r.subtype}`) : ""}
                    {parent ? ` · ⤴ ${parent.display_id}` : ""}
                  </span>
                </Link>
              );
            })}
            {otherCoverNote && (
              <p className="mt-1 text-[10.5px] leading-[1.4] text-ink-tertiary">
                {t.rich("nmNote", { id: otherCoverNote.display_id, b: (c) => <b>{c}</b> })}
              </p>
            )}
          </div>
          <div className="h-px bg-line" />
          <div>
            <div className="mb-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
              {t("sourceSection")}
            </div>
            {sourceChips.length === 0 ? (
              <p className="text-[11.5px] text-ink-tertiary">{t("noSource")}</p>
            ) : (
              <>
                {sourceChips.map((c) => (
                  <Link
                    key={c.n}
                    href={`/project/${id}/sources`}
                    className="mb-1.5 flex items-center gap-2 rounded-4 border border-[#C7DEEF] bg-surface px-2.5 py-2 text-[12px] font-semibold"
                  >
                    <span className="shrink-0 font-mono text-[10px] font-bold text-pivot">[{c.n}]</span>
                    <span className="min-w-0 truncate">{c.title}</span>
                  </Link>
                ))}
                <p className="mt-0.5 text-[10.5px] leading-[1.4] text-ink-tertiary">{t("storySourceNote")}</p>
              </>
            )}
          </div>
          <div>
            <div className="mb-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
              {t("originSection")}
            </div>
            <div className="flex items-center gap-2 rounded-4 border border-[#B9CCF7] bg-tint-action px-2.5 py-2">
              <span className="text-[13px]">{story.state === "manual" ? "✎" : "✦"}</span>
              <span className="text-[11px] leading-[1.4] text-[#17357F]">
                {story.state === "ai_suggested" && t("originStoryAiPending")}
                {story.state === "confirmed" && t.rich("originStoryAi", { b: (c) => <b>{c}</b> })}
                {story.state === "manual" && t("originManual")}
                {story.state === "rejected" && t("originRejected")}
              </span>
            </div>
          </div>
        </div>

        {/* KÖZÖS AC — a requirementtől örökölve */}
        <div className="min-w-0 p-5">
          <div className="mb-1.5 flex items-center gap-2.5">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-ink">
              {t("acSection")}
            </span>
            {covered[0] && (
              <span className="rounded-3 border border-[#CBD9F9] bg-tint-action px-2 py-px font-mono text-[9.5px] font-bold text-action-deep">
                {t("acSharedFrom", { id: covered[0].display_id })}
              </span>
            )}
          </div>
          <p className="mb-3.5 text-[11.5px] leading-[1.45] text-ink-tertiary">{t("acSharedNote")}</p>
          {shared.length === 0 && (
            <p className="rounded-tile border border-[#EADFC0] bg-tint-gate px-3 py-2 text-[12px] text-gate-text">
              ● {t("noAc")}
            </p>
          )}
          {shared.map(({ ac, requirement }, i) => (
            <div key={ac.id} data-testid={`shared-ac-${ac.id}`} className="mb-3 overflow-hidden rounded-tile border border-line">
              <div className="flex items-center gap-2 border-b border-line-soft bg-[#F7F8FB] px-3.5 py-2">
                <span className="shrink-0 font-mono text-[9.5px] font-bold text-ink-tertiary">AC-{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{ac.title}</span>
                <span className="shrink-0 rounded-3 border border-[#C7DEEF] bg-tint-sky px-1.5 py-px font-mono text-[8.5px] font-bold text-pivot">
                  ⤴ {requirement.display_id}
                </span>
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
          <div className="mt-4 flex items-center gap-2.5 rounded-tile border border-[#B9CCF7] bg-[#F2F6FE] px-3.5 py-3">
            <span className="text-[14px]">🔗</span>
            <span className="text-[12.5px] leading-[1.45] text-[#17357F]">
              {t.rich("sharedAcBridge", { b: (c) => <b>{c}</b> })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

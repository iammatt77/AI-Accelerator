"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  confirmRequirementAction,
  confirmStoryAction,
  generateRequirementsAction,
  generateStoriesAction,
  rejectRequirementAction,
  rejectStoryAction,
} from "@/app/requirements-actions";
import { AddRequirementPanel } from "@/components/AddRequirementPanel";
import { DeriveStoryPanel } from "@/components/DeriveStoryPanel";
import { buildLineageRows, buildTree, lineageOf, rowSystems } from "@/lib/requirements/model";
import type { FormState } from "@/app/actions";
import type {
  AcceptanceCriterionRow,
  EpicRow,
  Moscow,
  RequirementRow,
  RequirementStoryRow,
  StakeholderRequirementRow,
  StakeholderRow,
  UserStoryRow,
} from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Követelmények & story-k board (#11, ref_kovetelmenyek.html) — EGY adat,
// KÉT nézet: BA (háromszintű fa, 1./8. jelenet) ⇄ Agile (epic→story,
// 3. jelenet), sötét topbar nézet-váltóval (a folyamattérkép mintájára).
// Kijelöléskor a kötött elemek kiemelődnek, a többi halványul (5. jelenet);
// a kijelölés a nézet-váltást TÚLÉLI (a kötés mindkét irányból bejárható).
// Az Agile-nézet zárolt, amíg nincs system requirement (8. jelenet).
// ─────────────────────────────────────────────────────────────

const INITIAL: FormState = { ok: true, error: null };

type Selection = { kind: "req" | "story"; id: string } | null;

export interface RequirementsBoardProps {
  projectId: string;
  projectLabel: string;
  requirements: RequirementRow[];
  acs: AcceptanceCriterionRow[];
  epics: EpicRow[];
  stories: UserStoryRow[];
  links: RequirementStoryRow[];
  stakeholderLinks: StakeholderRequirementRow[];
  stakeholders: StakeholderRow[];
}

// MoSCoW-címke — Must a leghangsúlyosabb, Won't a leghalványabb (ref).
export function MoscowChip({ moscow, small }: { moscow: Moscow | null; small?: boolean }) {
  const t = useTranslations("requirements");
  const sz = small ? "text-[8.5px] px-1.5" : "text-[9.5px] px-2";
  if (moscow === "must")
    return <span className={`rounded-3 bg-action font-mono ${sz} py-px font-bold text-white`}>{t("moscow.must")}</span>;
  if (moscow === "should")
    return (
      <span className={`rounded-3 border border-[#D9C8EE] bg-tint-action font-mono ${sz} py-px font-bold text-action-deep`}>
        {t("moscow.should")}
      </span>
    );
  if (moscow === "could")
    return (
      <span className={`rounded-3 border border-neutral-350 bg-soft font-mono ${sz} py-px font-bold text-ink-secondary`}>
        {t("moscow.could")}
      </span>
    );
  if (moscow === "wont")
    return (
      <span className={`rounded-3 border border-dashed border-neutral-350 font-mono ${sz} py-px font-bold text-ink-tertiary`}>
        {t("moscow.wont")}
      </span>
    );
  // nincs kitöltve — emberi ítéletre vár (nem fabrikálunk)
  return (
    <span
      title={t("moscowUnsetHint")}
      className={`rounded-3 border border-dashed border-[#C9B3E6] font-mono ${sz} py-px font-bold text-action-deep`}
    >
      —
    </span>
  );
}

function EOriginBadge({ state }: { state: RequirementRow["state"] }) {
  const t = useTranslations("requirements");
  if (state !== "ai_suggested") return null;
  return (
    <span className="rounded-3 bg-tint-action px-1.5 py-px font-mono text-[8.5px] font-bold text-action-deep">
      ✦ {t("aiBadge")}
    </span>
  );
}

export function RequirementsBoard({
  projectId,
  projectLabel,
  requirements,
  acs,
  epics,
  stories,
  links,
  stakeholderLinks,
  stakeholders,
}: RequirementsBoardProps) {
  const t = useTranslations("requirements");
  const [view, setView] = useState<"ba" | "agile">("ba");
  const [sel, setSel] = useState<Selection>(null);
  const [panel, setPanel] = useState<"addReq" | "derive" | null>(null);
  const [derivePrefill, setDerivePrefill] = useState<string[]>([]);

  const tree = useMemo(() => buildTree(requirements), [requirements]);
  const storyById = useMemo(() => new Map(stories.map((s) => [s.id, s])), [stories]);
  const shById = useMemo(() => new Map(stakeholders.map((s) => [s.id, s])), [stakeholders]);
  const systemReqs = requirements.filter((r) => r.level === "system");
  const agileUnlocked = systemReqs.length > 0;

  // Kijelölés-feloldás: a kötött elemek halmaza (mindkét irányból).
  const related = useMemo(() => {
    const reqIds = new Set<string>();
    const storyIds = new Set<string>();
    if (sel?.kind === "req") {
      reqIds.add(sel.id);
      const req = tree.byId.get(sel.id);
      if (req) for (const a of lineageOf(req, tree.byId)) reqIds.add(a.id);
      for (const l of links) if (l.requirement_id === sel.id) storyIds.add(l.story_id);
    } else if (sel?.kind === "story") {
      storyIds.add(sel.id);
      for (const l of links) if (l.story_id === sel.id) reqIds.add(l.requirement_id);
    }
    return { reqIds, storyIds };
  }, [sel, links, tree]);

  const dimReq = (id: string) => sel !== null && !related.reqIds.has(id);
  const dimStory = (id: string) => sel !== null && !related.storyIds.has(id);

  const toggleSelect = (s: Selection) => {
    setSel((prev) => (prev && s && prev.kind === s.kind && prev.id === s.id ? null : s));
  };

  const [genState, genAction, genPending] = useActionState(
    generateRequirementsAction.bind(null, projectId),
    INITIAL,
  );
  const [genStState, genStAction, genStPending] = useActionState(
    generateStoriesAction.bind(null, projectId),
    INITIAL,
  );

  const selReq = sel?.kind === "req" ? tree.byId.get(sel.id) : undefined;
  const selLineage = selReq ? lineageOf(selReq, tree.byId) : null;
  const selStories = sel?.kind === "req" ? [...related.storyIds].map((i) => storyById.get(i)).filter(Boolean) : [];

  return (
    <div className="overflow-hidden rounded-shell border border-line bg-[#FBFBFD] shadow-card">
      {/* ── Sötét topbar + nézet-váltó (a folyamattérkép mintája) ── */}
      <div className="flex flex-wrap items-center gap-3 bg-[#23262F] px-5 py-2.5 text-[#EDEEF3]">
        <span className="flex items-center gap-2 text-[15px] font-extrabold tracking-[-0.02em] text-white">
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-control bg-action text-[13px]">A</span>
          {t("title")}
        </span>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[#9EA2B5]">{projectLabel}</span>
        <div className="flex-1" />
        <div className="flex rounded-control border border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.06)] p-0.5">
          <button
            type="button"
            onClick={() => setView("ba")}
            className={`flex items-center gap-1.5 rounded-4 px-3.5 py-1.5 text-[12.5px] ${
              view === "ba" ? "bg-white font-bold text-[#23262F]" : "font-semibold text-[#B7BBCB]"
            }`}
          >
            <span className="h-[9px] w-[9px] rounded-[2px] bg-pivot" />
            {t("viewBa")} <span className="font-mono text-[10px] opacity-70">BA</span>
          </button>
          <button
            type="button"
            onClick={() => agileUnlocked && setView("agile")}
            disabled={!agileUnlocked}
            title={agileUnlocked ? undefined : t("agileLockedHint")}
            className={`flex items-center gap-1.5 rounded-4 px-3.5 py-1.5 text-[12.5px] ${
              view === "agile"
                ? "bg-white font-bold text-[#23262F]"
                : agileUnlocked
                  ? "font-semibold text-[#B7BBCB]"
                  : "cursor-not-allowed font-semibold text-[#6B6F80]"
            }`}
          >
            {!agileUnlocked && <span aria-hidden>🔒</span>}
            <span className="h-[9px] w-[9px] rounded-full bg-[#A585CE]" />
            {t("viewAgile")} <span className="font-mono text-[10px] opacity-70">Agile</span>
          </button>
        </div>
        {view === "ba" ? (
          <button
            type="button"
            onClick={() => setPanel("addReq")}
            className="rounded-control bg-action px-3 py-1.5 text-[12px] font-semibold text-white"
          >
            + {t("addReqCta")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDerivePrefill(sel?.kind === "req" ? [sel.id] : []);
              setPanel("derive");
            }}
            className="rounded-control bg-action px-3 py-1.5 text-[12px] font-semibold text-white"
          >
            + {t("deriveCta")}
          </button>
        )}
      </div>

      {/* ── Infó-sáv: lineage (BA) / származtatás-jegyzet (Agile) ── */}
      {view === "ba" ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-[#FAF8FD] px-5 py-2.5">
          <span className="shrink-0 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-action-deep">
            {t("lineageLabel")}
          </span>
          {selLineage ? (
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              {selLineage.map((r, i) => (
                <span key={r.id} className="flex items-center gap-2">
                  {i > 0 && <span className="text-ink-tertiary">→</span>}
                  <span className="flex items-center gap-1.5 rounded-4 border border-[#C9B3E6] bg-surface px-2.5 py-1">
                    <span className="font-mono text-[10px] font-bold text-action-deep">{r.display_id}</span>
                    <span className="max-w-[220px] truncate text-ink">{r.text}</span>
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[12px] text-ink-tertiary">{t("lineageHint")}</span>
          )}
          <div className="flex-1" />
          <span className="font-mono text-[10px] text-pivot">
            {t("countsBar", { req: requirements.length, story: stories.length })}
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-[#FAF8FD] px-5 py-2.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-4 bg-action-deep text-[11px] text-white">↳</span>
          <span className="text-[12.5px] leading-snug text-[#5B3C86]">{t.rich("agileNote", { b: (c) => <b>{c}</b> })}</span>
          <div className="flex-1" />
          <span className="font-mono text-[10px] text-ink-tertiary">
            {t("agileCounts", { e: epics.length, s: stories.length })}
          </span>
        </div>
      )}

      {(genState.error || genStState.error || genState.notice || genStState.notice) && (
        <div className="border-b border-line bg-surface px-5 py-2 text-[12px]">
          {(genState.error ?? genStState.error) && (
            <span className="text-danger">{genState.error ?? genStState.error}</span>
          )}
          {(genState.notice ?? genStState.notice) && (
            <span className="text-gate-text">{genState.notice ?? genStState.notice}</span>
          )}
        </div>
      )}

      {view === "ba" ? (
        <BaLanes
          projectId={projectId}
          tree={tree}
          requirements={requirements}
          acs={acs}
          epics={epics}
          links={links}
          stakeholderLinks={stakeholderLinks}
          shById={shById}
          dimReq={dimReq}
          sel={sel}
          selStories={selStories.map((s) => s!.display_id)}
          onSelect={(id) => toggleSelect({ kind: "req", id })}
          onAdd={() => setPanel("addReq")}
          genAction={genAction}
          genPending={genPending}
        />
      ) : (
        <AgileLanes
          projectId={projectId}
          epics={epics}
          stories={stories}
          links={links}
          tree={tree}
          acs={acs}
          dimStory={dimStory}
          sel={sel}
          relatedReqIds={related.reqIds}
          onSelect={(id) => toggleSelect({ kind: "story", id })}
          onDerive={(coveredIds) => {
            setDerivePrefill(coveredIds);
            setPanel("derive");
          }}
          genStAction={genStAction}
          genStPending={genStPending}
        />
      )}

      {/* ── Panelek (7. jelenet) ── */}
      {panel === "addReq" && (
        <AddRequirementPanel
          projectId={projectId}
          requirements={requirements}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "derive" && (
        <DeriveStoryPanel
          projectId={projectId}
          systemReqs={systemReqs}
          epics={epics}
          prefillCoveredIds={derivePrefill}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}

// ═════════════════════ BA-nézet (1./8. jelenet) ═════════════════════

function BaLanes({
  projectId,
  tree,
  requirements,
  acs,
  epics,
  links,
  stakeholderLinks,
  shById,
  dimReq,
  sel,
  selStories,
  onSelect,
  onAdd,
  genAction,
  genPending,
}: {
  projectId: string;
  tree: ReturnType<typeof buildTree>;
  requirements: RequirementRow[];
  acs: AcceptanceCriterionRow[];
  epics: EpicRow[];
  links: RequirementStoryRow[];
  stakeholderLinks: StakeholderRequirementRow[];
  shById: Map<string, StakeholderRow>;
  dimReq: (id: string) => boolean;
  sel: Selection;
  selStories: string[];
  onSelect: (id: string) => void;
  onAdd: () => void;
  genAction: (formData: FormData) => void;
  genPending: boolean;
}) {
  const t = useTranslations("requirements");
  const business = requirements.filter((r) => r.level === "business");
  const stakeholder = requirements.filter((r) => r.level === "stakeholder");
  const funcs = requirements.filter((r) => r.level === "system" && r.subtype === "functional");
  const nfrs = requirements.filter((r) => r.level === "system" && r.subtype === "non_functional");
  const empty = requirements.length === 0;

  // Swimlane-sorok: business-requirementenként a teljes leszármazott-lánc.
  const rows = buildLineageRows(requirements);

  // ── Üres állapot: a korábbi 3-oszlopos „kezdd itt" nézet (8. jelenet) ──
  if (empty) {
    return (
      <div className="grid grid-cols-[1fr_1fr_1.55fr] bg-[#F4F5F9]">
        <div className="flex flex-col gap-3 border-r border-line p-4">
          <LaneHead dotCls="bg-action-deep" label={t("laneBusiness")} sub={t("laneBusinessSub")} count={0} />
          <div className="flex flex-col items-center gap-2.5 rounded-tile border-[1.5px] border-dashed border-[#C9B3E6] bg-[#FBF9FE] px-3.5 py-4 text-center">
            <span className="flex h-[30px] w-[30px] items-center justify-center rounded-shell bg-tint-action text-[17px] font-bold text-action">+</span>
            <span className="text-[12.5px] font-bold">{t("emptyBizTitle")}</span>
            <span className="text-[11.5px] leading-[1.45] text-ink-tertiary">{t("emptyBizText")}</span>
            <button
              type="button"
              onClick={onAdd}
              className="rounded-control bg-action px-3 py-1.5 text-[11.5px] font-bold text-white"
            >
              + {t("emptyBizCta")}
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-r border-line p-4">
          <LaneHead dotCls="bg-ink-secondary" label={t("laneStakeholder")} sub={t("laneStakeholderSub")} count={0} />
          <div className="rounded-tile border-[1.5px] border-dashed border-neutral-350 bg-[#FBFBFD] px-3.5 py-4 text-center text-[11.5px] leading-[1.5] text-ink-tertiary">
            {t("emptyShNote")}
          </div>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <LaneHead
            dotCls="bg-[#23262F]"
            label={t("laneSystem")}
            sub={`${t("funcLabel")} · ${t("nfrLabel")}`}
            count={0}
          />
          <div className="rounded-tile border-[1.5px] border-dashed border-neutral-350 bg-[#FBFBFD] px-3.5 py-4 text-center text-[11.5px] leading-[1.5] text-ink-tertiary">
            {t("emptySysNote")}
          </div>
        </div>
        <div className="col-span-3 flex flex-wrap items-center gap-3 border-t border-line bg-surface px-5 py-3.5">
          <span className="text-[13px]">✦</span>
          <span className="min-w-0 flex-1 text-[12.5px] leading-[1.45] text-ink-secondary">
            {t.rich("aiTreeNote", { b: (c) => <b>{c}</b> })}
          </span>
          <form action={genAction}>
            <button
              type="submit"
              disabled={genPending}
              className="rounded-control border border-[#C9B3E6] bg-surface px-3.5 py-2 text-[12.5px] font-semibold text-action-deep hover:bg-accent-tint disabled:opacity-60"
            >
              {genPending ? t("generating") : `✦ ${t("aiTreeCta")}`}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const reqCardProps = { projectId, tree, acs, epics, links, stakeholderLinks, shById, selStories, onSelect };

  // ── Populált BA-nézet: swimlane-sorok, sticky fejléc, egyben görgethető ──
  return (
    <div className="bg-[#F4F5F9]">
      <div className="max-h-[72vh] overflow-y-auto overscroll-contain">
        {/* Sticky oszlopfejlécek (a sorok alattuk görgethetők) */}
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.55fr)] border-b border-line bg-[#E9EBF1] shadow-[0_1px_0_rgba(0,0,0,0.04)]">
          <div className="border-r border-line px-4 py-2.5">
            <LaneHead dotCls="bg-action-deep" label={t("laneBusiness")} sub={t("laneBusinessSub")} count={business.length} />
          </div>
          <div className="border-r border-line px-4 py-2.5">
            <LaneHead dotCls="bg-ink-secondary" label={t("laneStakeholder")} sub={t("laneStakeholderSub")} count={stakeholder.length} />
          </div>
          <div className="px-4 py-2.5">
            <LaneHead
              dotCls="bg-[#23262F]"
              label={t("laneSystem")}
              sub={`${funcs.length} ${t("funcLabel")} · ${nfrs.length} ${t("nfrLabel")}`}
              count={funcs.length + nfrs.length}
            />
          </div>
        </div>

        {/* Sorok: 1 business req + teljes leszármazott-lánc, tetejéhez igazítva, zebra */}
        {rows.map((row, i) => {
          const systems = rowSystems(row);
          return (
            <div
              key={row.key}
              data-testid={`ba-row-${row.business?.display_id ?? "orphan"}`}
              className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.55fr)] items-start border-b border-line ${
                i % 2 === 1 ? "bg-[#EFF1F6]" : "bg-transparent"
              }`}
            >
              {/* Business-cella */}
              <div className="min-w-0 border-r border-line p-4">
                {row.business ? (
                  <ReqCard {...reqCardProps} req={row.business} dim={dimReq(row.business.id)} selected={sel?.kind === "req" && sel.id === row.business.id} />
                ) : (
                  <div className="rounded-tile border-[1.5px] border-dashed border-[#EADFC0] bg-tint-gate/40 px-3 py-3 text-center">
                    <div className="font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-gate-text">
                      {t("orphanRowTitle")}
                    </div>
                    <div className="mt-1 text-[10.5px] leading-[1.4] text-ink-tertiary">{t("orphanRowNote")}</div>
                  </div>
                )}
              </div>

              {/* Stakeholder-cella */}
              <div className="flex min-w-0 flex-col gap-2.5 border-r border-line p-4">
                {row.stakeholders.length > 0 ? (
                  row.stakeholders.map((s) => (
                    <ReqCard
                      {...reqCardProps}
                      key={s.requirement.id}
                      req={s.requirement}
                      dim={dimReq(s.requirement.id)}
                      selected={sel?.kind === "req" && sel.id === s.requirement.id}
                    />
                  ))
                ) : (
                  <EmptyCell label={t("rowNoStakeholder")} onAdd={onAdd} addLabel={t("rowAddCta")} />
                )}
              </div>

              {/* System-cella (funkcionális + NFR, kártya-szintű megkülönböztetéssel) */}
              <div className="flex min-w-0 flex-col gap-2.5 p-4">
                {systems.length > 0 ? (
                  systems.map((r) => (
                    <ReqCard
                      {...reqCardProps}
                      key={r.id}
                      req={r}
                      dim={dimReq(r.id)}
                      selected={sel?.kind === "req" && sel.id === r.id}
                      compact
                    />
                  ))
                ) : (
                  <EmptyCell label={t("rowNoSystem")} onAdd={onAdd} addLabel={t("rowAddCta")} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LaneHead({ dotCls, label, sub, count }: { dotCls: string; label: string; sub: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-[9px] w-[9px] rounded-[2px] ${dotCls}`} />
      <span className="text-[13px] font-extrabold">{label}</span>
      <span className="min-w-0 truncate font-mono text-[10px] text-ink-tertiary">{sub}</span>
      <span className="ml-auto shrink-0 rounded-pill bg-[#ECEEF4] px-2 py-px font-mono text-[11px] font-bold text-ink-tertiary">
        {count}
      </span>
    </div>
  );
}

// Halk placeholder egy üres sor-cellához — a sor NEM omlik össze, a hierarchia
// látszik. Nem fabrikál tartalmat: csak jelzi az űrt + egy „+ hozzáadás" utat.
function EmptyCell({ label, addLabel, onAdd }: { label: string; addLabel: string; onAdd: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-tile border border-dashed border-neutral-350 bg-[#FBFBFD] px-3 py-2.5">
      <span className="min-w-0 flex-1 text-[11px] leading-[1.4] text-ink-tertiary">{label}</span>
      <button
        type="button"
        onClick={onAdd}
        className="shrink-0 rounded-3 border border-[#C9B3E6] bg-surface px-2 py-0.5 font-mono text-[9.5px] font-bold text-action-deep hover:bg-accent-tint"
      >
        + {addLabel}
      </button>
    </div>
  );
}

// A fa-kártya (1. jelenet): display_id + ⤴ szülő + MoSCoW + jelzések.
function ReqCard({
  projectId,
  req,
  tree,
  acs,
  epics,
  links,
  stakeholderLinks,
  shById,
  dim,
  selected,
  selStories,
  onSelect,
  compact,
}: {
  projectId: string;
  req: RequirementRow;
  tree: ReturnType<typeof buildTree>;
  acs: AcceptanceCriterionRow[];
  epics: EpicRow[];
  links: RequirementStoryRow[];
  stakeholderLinks: StakeholderRequirementRow[];
  shById: Map<string, StakeholderRow>;
  dim: boolean;
  selected: boolean;
  selStories: string[];
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  const t = useTranslations("requirements");
  const parent = req.parent_id ? tree.byId.get(req.parent_id) : undefined;
  const acCount = acs.filter((a) => a.requirement_id === req.id).length;
  const storyCount = links.filter((l) => l.requirement_id === req.id).length;
  const childCount = (tree.children.get(req.id) ?? []).length;
  const shNames = stakeholderLinks
    .filter((l) => l.requirement_id === req.id)
    .map((l) => shById.get(l.stakeholder_id)?.name)
    .filter(Boolean) as string[];
  const epic = epics.find((e) => e.business_requirement_id === req.id);
  const wont = req.moscow === "wont";
  const leftBorder =
    req.level === "business"
      ? "border-l-action-deep"
      : req.level === "stakeholder"
        ? "border-l-[#9A9EAE]"
        : req.subtype === "non_functional"
          ? "border-l-gate"
          : "border-l-pivot";
  const idColor =
    req.level === "business"
      ? "text-action-deep"
      : req.level === "stakeholder"
        ? "text-ink-secondary"
        : req.subtype === "non_functional"
          ? "text-gate-text"
          : "text-pivot";

  const [, confirmAct, confirmPending] = useActionState(
    confirmRequirementAction.bind(null, projectId, req.id),
    INITIAL,
  );
  const [, rejectAct, rejectPending] = useActionState(
    rejectRequirementAction.bind(null, projectId, req.id),
    INITIAL,
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(req.id)}
      onKeyDown={(e) => e.key === "Enter" && onSelect(req.id)}
      data-testid={`req-${req.display_id}`}
      className={`flex cursor-pointer flex-col gap-2 rounded-tile border bg-surface text-left transition-opacity ${
        compact ? "p-3" : "p-3.5"
      } border-l-4 ${leftBorder} ${
        selected
          ? "border-[1.5px] border-pivot shadow-[0_8px_20px_rgba(46,119,168,0.14)]"
          : wont
            ? "border-dashed border-neutral-350 opacity-50"
            : "border-line shadow-card-sm"
      } ${dim ? "opacity-40" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`font-mono text-[10px] font-bold ${idColor}`}>{req.display_id}</span>
        {parent && (
          <span className="font-mono text-[8.5px] text-action-deep">⤴ {parent.display_id}</span>
        )}
        {selected && (
          <span className="rounded-3 bg-pivot px-1.5 py-px font-mono text-[8.5px] font-bold text-white">
            ● {t("selectedBadge")}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <EOriginBadge state={req.state} />
          <MoscowChip moscow={req.moscow} small={compact} />
        </span>
      </div>
      <span
        className={`text-[12.5px] font-semibold leading-[1.35] ${
          wont ? "text-ink-tertiary line-through decoration-neutral-350" : "text-ink"
        }`}
      >
        {req.text}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {shNames.map((n) => (
          <span key={n} className="rounded-pill border border-neutral-350 bg-sunken px-1.5 py-px font-mono text-[9px] text-ink-secondary">
            👤 {n}
          </span>
        ))}
        {childCount > 0 && (
          <span className="font-mono text-[10px] font-bold text-action-deep">↓ {childCount}</span>
        )}
        {epic && (
          <span className="font-mono text-[10px] text-action-deep">○ {epic.display_id}</span>
        )}
        {req.level === "system" && (
          <>
            {acCount > 0 ? (
              <span className="rounded-3 border border-[#CDE7DA] bg-tint-done px-1.5 py-px font-mono text-[8.5px] font-bold text-done-text">
                ✓ {t("acBadge", { n: acCount })}
              </span>
            ) : (
              <span className="rounded-3 border border-[#EADFC0] bg-tint-gate px-1.5 py-px font-mono text-[8.5px] font-bold text-gate-text">
                ● {t("noAc")}
              </span>
            )}
            {storyCount > 0 ? (
              <span className="rounded-3 border border-[#D9C8EE] bg-tint-action px-1.5 py-px font-mono text-[8.5px] font-bold text-action-deep">
                ◑ {t("storyBadge", { n: storyCount })}
              </span>
            ) : (
              <span className="rounded-3 border border-line bg-soft px-1.5 py-px font-mono text-[8.5px] font-bold text-ink-tertiary">
                ○ {t("noStory")}
              </span>
            )}
          </>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {req.state === "ai_suggested" && (
            <>
              <form action={confirmAct} onClick={(e) => e.stopPropagation()}>
                <button
                  type="submit"
                  disabled={confirmPending || rejectPending}
                  className="rounded-3 bg-done px-1.5 py-px font-mono text-[8.5px] font-bold text-white disabled:opacity-60"
                >
                  ✓ {t("confirmCta")}
                </button>
              </form>
              <form action={rejectAct} onClick={(e) => e.stopPropagation()}>
                <button
                  type="submit"
                  disabled={confirmPending || rejectPending}
                  className="rounded-3 border border-neutral-350 bg-surface px-1.5 py-px font-mono text-[8.5px] font-bold text-ink-secondary disabled:opacity-60"
                >
                  {t("rejectCta")}
                </button>
              </form>
            </>
          )}
          <Link
            href={`/project/${projectId}/requirements/r/${req.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-[9px] font-semibold text-action-deep hover:underline"
          >
            {t("detailLink")} ↗
          </Link>
        </span>
      </div>
      {selected && selStories.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-dashed border-line-soft pt-2">
          <span className="font-mono text-[8.5px] uppercase text-ink-tertiary">{t("implementedBy")}</span>
          {selStories.map((d) => (
            <span key={d} className="rounded-3 border border-[#D9C8EE] bg-tint-action px-1.5 py-px font-mono text-[9px] font-bold text-action-deep">
              {d}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ═════════════════════ Agile-nézet (3. jelenet) ═════════════════════

function AgileLanes({
  projectId,
  epics,
  stories,
  links,
  tree,
  acs,
  dimStory,
  sel,
  relatedReqIds,
  onSelect,
  onDerive,
  genStAction,
  genStPending,
}: {
  projectId: string;
  epics: EpicRow[];
  stories: UserStoryRow[];
  links: RequirementStoryRow[];
  tree: ReturnType<typeof buildTree>;
  acs: AcceptanceCriterionRow[];
  dimStory: (id: string) => boolean;
  sel: Selection;
  relatedReqIds: Set<string>;
  onSelect: (id: string) => void;
  onDerive: (coveredIds: string[]) => void;
  genStAction: (formData: FormData) => void;
  genStPending: boolean;
}) {
  const t = useTranslations("requirements");
  const noEpic = stories.filter((s) => !s.epic_id || !epics.some((e) => e.id === s.epic_id));
  // Nem teljesen lefedett system reqek (a „story származtatása" CTA-hoz).
  const uncovered = [...tree.byId.values()].filter(
    (r) => r.level === "system" && !links.some((l) => l.requirement_id === r.id),
  );

  if (stories.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 bg-[#F4F5F9] px-5 py-14 text-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-shell bg-tint-action text-[18px] text-action">↳</span>
        <p className="max-w-[520px] text-[13px] leading-[1.5] text-ink-secondary">{t("agileEmptyText")}</p>
        <form action={genStAction}>
          <button
            type="submit"
            disabled={genStPending}
            className="rounded-control border border-[#C9B3E6] bg-surface px-4 py-2 text-[12.5px] font-semibold text-action-deep hover:bg-accent-tint disabled:opacity-60"
          >
            {genStPending ? t("generating") : `✦ ${t("genStoriesCta")}`}
          </button>
        </form>
        <p className="text-[11px] text-ink-tertiary">{t("genStoriesNote")}</p>
      </div>
    );
  }

  const lane = (epic: EpicRow | null, laneStories: UserStoryRow[]) => {
    const br = epic?.business_requirement_id ? tree.byId.get(epic.business_requirement_id) : undefined;
    const epicUncovered = uncovered.length > 0 && epic !== null;
    return (
      <div key={epic?.id ?? "none"} className="overflow-hidden rounded-shell border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-[#E9E1F5] bg-[#FBF9FE] px-4 py-2.5">
          <span className="rounded-3 bg-action-deep px-2 py-0.5 font-mono text-[9px] font-bold text-white">
            {epic?.display_id ?? "—"}
          </span>
          <span className="text-[14px] font-extrabold tracking-[-0.01em]">{epic?.title ?? t("epicNone")}</span>
          {br && <span className="font-mono text-[9.5px] text-action-deep">⤴ {br.display_id}</span>}
          <span className="ml-auto rounded-pill bg-soft px-2 py-px font-mono text-[10px] font-bold text-ink-tertiary">
            {t("epicStoryCount", { n: laneStories.length })}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3 p-3.5">
          {laneStories.map((s) => (
            <StoryCard
              key={s.id}
              projectId={projectId}
              story={s}
              links={links}
              tree={tree}
              acs={acs}
              dim={dimStory(s.id)}
              selected={sel?.kind === "story" && sel.id === s.id}
              highlightReqIds={sel?.kind === "req" ? relatedReqIds : null}
              onSelect={onSelect}
            />
          ))}
          {epicUncovered && (
            <button
              type="button"
              onClick={() => onDerive([uncovered[0].id])}
              className="flex flex-col items-center justify-center gap-2 rounded-tile border-[1.5px] border-dashed border-[#C9B3E6] p-3.5 text-center"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-control bg-tint-action text-[14px] font-bold text-action-deep">+</span>
              <span className="text-[11.5px] leading-[1.4] text-ink-tertiary">
                {t.rich("uncoveredCta", {
                  id: uncovered[0].display_id,
                  b: (c) => <b className="text-action-deep">{c}</b>,
                })}
              </span>
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4 bg-[#F4F5F9] p-5">
      {epics.map((e) =>
        lane(
          e,
          stories.filter((s) => s.epic_id === e.id),
        ),
      )}
      {noEpic.length > 0 && lane(null, noEpic)}
    </div>
  );
}

function StoryCard({
  projectId,
  story,
  links,
  tree,
  acs,
  dim,
  selected,
  highlightReqIds,
  onSelect,
}: {
  projectId: string;
  story: UserStoryRow;
  links: RequirementStoryRow[];
  tree: ReturnType<typeof buildTree>;
  acs: AcceptanceCriterionRow[];
  dim: boolean;
  selected: boolean;
  /** Req-kijelöléskor: melyik reqek érintettek (a „◑ LEFEDI" jelvényhez). */
  highlightReqIds: Set<string> | null;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("requirements");
  const covered = links
    .filter((l) => l.story_id === story.id)
    .map((l) => tree.byId.get(l.requirement_id))
    .filter((r): r is RequirementRow => r !== undefined);
  const acCount = covered.reduce(
    (a, r) => a + acs.filter((x) => x.requirement_id === r.id).length,
    0,
  );
  const coversSelected = highlightReqIds
    ? covered.find((r) => highlightReqIds.has(r.id))
    : undefined;

  const [, confirmAct, confirmPending] = useActionState(
    confirmStoryAction.bind(null, projectId, story.id),
    INITIAL,
  );
  const [, rejectAct, rejectPending] = useActionState(
    rejectStoryAction.bind(null, projectId, story.id),
    INITIAL,
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(story.id)}
      onKeyDown={(e) => e.key === "Enter" && onSelect(story.id)}
      data-testid={`story-${story.display_id}`}
      className={`flex cursor-pointer flex-col gap-2 rounded-tile border bg-surface p-3.5 text-left transition-opacity ${
        selected || coversSelected
          ? "border-[1.5px] border-action-deep border-t-[3px] shadow-[0_8px_20px_rgba(108,67,160,0.14)]"
          : "border-line border-t-[3px] border-t-action-deep shadow-card-sm"
      } ${dim ? "opacity-40" : ""}`}
    >
      <div className="flex items-center gap-1.5">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-tint-action text-[8px] font-bold text-action-deep">US</span>
        <span className="font-mono text-[9.5px] font-bold text-action-deep">{story.display_id}</span>
        {coversSelected && (
          <span className="rounded-3 bg-action-deep px-1.5 py-px font-mono text-[8.5px] font-bold text-white">
            ◑ {t("coversBadge", { id: coversSelected.display_id })}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <EOriginBadge state={story.state} />
          <MoscowChip moscow={story.moscow} small />
        </span>
      </div>
      <span className="text-[12.5px] leading-[1.45]">
        <span className="font-bold text-action-deep">{t("storyAs", { role: story.role })}</span>{" "}
        {t("storyWant", { want: story.want })}{" "}
        <span className="text-ink-tertiary">{t("storySo", { soThat: story.so_that })}</span>
      </span>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-dashed border-line-soft pt-2">
        <span className="font-mono text-[8px] uppercase text-ink-tertiary">{t("coversLabel")}</span>
        {covered.map((r) => (
          <span
            key={r.id}
            className={`rounded-3 border px-1.5 py-px font-mono text-[9px] font-bold ${
              r.subtype === "non_functional"
                ? "border-[#EADFC0] bg-tint-gate text-gate-text"
                : "border-[#C7DEEF] bg-tint-sky text-pivot"
            }`}
          >
            {r.display_id}
          </span>
        ))}
        {acCount > 0 ? (
          <span className="font-mono text-[8.5px] font-bold text-done-text">✓ {t("acBadge", { n: acCount })}</span>
        ) : (
          <span className="font-mono text-[8.5px] font-bold text-gate-text">● {t("noAc")}</span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {story.state === "ai_suggested" && (
            <>
              <form action={confirmAct} onClick={(e) => e.stopPropagation()}>
                <button
                  type="submit"
                  disabled={confirmPending || rejectPending}
                  className="rounded-3 bg-done px-1.5 py-px font-mono text-[8.5px] font-bold text-white disabled:opacity-60"
                >
                  ✓ {t("confirmCta")}
                </button>
              </form>
              <form action={rejectAct} onClick={(e) => e.stopPropagation()}>
                <button
                  type="submit"
                  disabled={confirmPending || rejectPending}
                  className="rounded-3 border border-neutral-350 bg-surface px-1.5 py-px font-mono text-[8.5px] font-bold text-ink-secondary disabled:opacity-60"
                >
                  {t("rejectCta")}
                </button>
              </form>
            </>
          )}
          <Link
            href={`/project/${projectId}/requirements/s/${story.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-[9px] font-semibold text-action-deep hover:underline"
          >
            {t("detailLink")} ↗
          </Link>
        </span>
      </div>
    </div>
  );
}

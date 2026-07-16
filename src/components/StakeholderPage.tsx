"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { FormState } from "@/app/actions";
import {
  assignInputSourceAction,
  editStakeholderAction,
  setCommunicationStrategyAction,
  togglePainBindAction,
} from "@/app/stakeholder-actions";
import { StakeholderScoreForm } from "@/components/StakeholderView";
import { scorePct, hasMatrixPoint } from "@/lib/stakeholders/matrix";
import { SubmitButton } from "@/components/SubmitButton";
import { IconCheck } from "@/components/icons";

// ─────────────────────────────────────────────────────────────
// Stakeholder-lap redesign (ref_stakeholder_lap.html): a Befolyás × Érintettség
// mátrix a HERO; a verdikt kliens-oldalon a kvadránsból származtatott; a
// forráslista EGY kapcsolós listává olvad (a régi „tőle jövő" + „hozzárendelés"
// duplikáció megszűnik). Minden interaktív rész a MEGLÉVŐ #8 akciókat hívja
// (score, stratégia, forrás-hozzárendelés, profil, pain-kötés). Tömör-lapos,
// a ref palettájával; nincs üveg/blur, nincs új adatmodell.
// ─────────────────────────────────────────────────────────────

const initialState: FormState = { ok: false, error: null };

function ErrorAlert({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-mono-sm text-danger">
      {error}
    </p>
  );
}

// ── Fejléc-profil szerkesztő (a „Profil szerkesztése" belépő) ──
export function ProfileEditor({
  projectId,
  stakeholderId,
  name,
  title,
}: {
  projectId: string;
  stakeholderId: string;
  name: string;
  title: string | null;
}) {
  const t = useTranslations("stakeholders");
  const [editing, setEditing] = useState(false);
  const [state, formAction] = useActionState(
    editStakeholderAction.bind(null, projectId, stakeholderId),
    initialState,
  );
  // Sikeres mentés után zárjuk a szerkesztőt.
  if (state.ok && editing) setEditing(false);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="shrink-0 rounded-control border border-neutral-350 bg-surface px-3.5 py-2 text-[12.5px] font-semibold text-ink hover:bg-neutral-50"
      >
        {t("editProfileCta")}
      </button>
    );
  }
  return (
    <form action={formAction} className="flex w-full flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
          {t("nameLabel")}
        </span>
        <input
          key={`n${state.nonce ?? 0}`}
          name="name"
          required
          defaultValue={state.values?.title ?? name}
          placeholder={t("namePlaceholder")}
          className="rounded-control border border-line bg-surface px-3 py-1.5 text-body"
        />
      </label>
      <label className="flex flex-1 flex-col gap-1">
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
          {t("titleLabel")}
        </span>
        <input
          key={`t${state.nonce ?? 0}`}
          name="title"
          defaultValue={state.values?.fieldValue ?? title ?? ""}
          placeholder={t("titlePlaceholder")}
          className="min-w-[180px] rounded-control border border-line bg-surface px-3 py-1.5 text-body"
        />
      </label>
      <div className="flex items-center gap-2">
        <SubmitButton variant="secondary" pendingLabel={t("savingProfile")}>
          {t("saveProfileCta")}
        </SubmitButton>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-control px-3 py-1.5 text-body text-ink-secondary hover:bg-sunken"
        >
          {t("cancelEdit")}
        </button>
      </div>
      <ErrorAlert error={state.error} />
    </form>
  );
}

// ── HERO: Befolyás × Érintettség mátrix ──
export function MatrixCard({
  projectId,
  stakeholderId,
  influence,
  impact,
  aiSuggested,
  initials,
}: {
  projectId: string;
  stakeholderId: string;
  influence: number | null;
  impact: number | null;
  aiSuggested: boolean;
  initials: string;
}) {
  const t = useTranslations("stakeholders");
  const [editing, setEditing] = useState(false);
  const point = hasMatrixPoint(influence, impact);

  return (
    <div className="rounded-shell border border-line bg-surface p-[18px] shadow-card">
      <div className="mb-3.5 flex items-center gap-2">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
          {t("matrixTitle")}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="font-mono text-[10.5px] text-action-deep hover:underline"
        >
          {t("editScoreCta")}
        </button>
      </div>

      {editing ? (
        <div className="rounded-tile border border-line-soft bg-soft p-3">
          <StakeholderScoreForm
            projectId={projectId}
            stakeholderId={stakeholderId}
            influenceScore={influence}
            impactScore={impact}
            aiSuggested={aiSuggested}
          />
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            {/* y tengely-címke */}
            <div className="flex items-center justify-center">
              <span
                className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary"
                style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
              >
                {t("axisInfluence")} →
              </span>
            </div>
            <div className="flex-1">
              <div className="relative aspect-square w-full overflow-hidden rounded-6 border border-line-soft">
                {/* kvadráns-tintek */}
                <div className="absolute left-0 top-0 h-1/2 w-1/2 bg-[#FAF4E8]" />
                <div className="absolute right-0 top-0 h-1/2 w-1/2 bg-[#F3EEFA]" />
                <div className="absolute bottom-0 left-0 h-1/2 w-1/2 bg-[#F4F5F8]" />
                <div className="absolute bottom-0 right-0 h-1/2 w-1/2 bg-[#EAF1F7]" />
                {/* osztók */}
                <div className="absolute bottom-0 left-1/2 top-0 w-px bg-[#E0E3EC]" />
                <div className="absolute left-0 right-0 top-1/2 h-px bg-[#E0E3EC]" />
                {/* kvadráns-címkék */}
                <div className="absolute left-2 top-[7px] font-mono text-[8.5px] font-bold leading-[1.2] text-[#9A6A12]">
                  {t("quadrant.keep_satisfied.label")}
                </div>
                <div className="absolute right-2 top-[7px] text-right font-mono text-[8.5px] font-bold leading-[1.2] text-[#7A4FB0]">
                  {t("quadrant.manage_closely.label")}
                </div>
                <div className="absolute bottom-[7px] left-2 font-mono text-[8.5px] font-bold leading-[1.2] text-[#A9AEBD]">
                  {t("quadrant.monitor.label")}
                </div>
                <div className="absolute bottom-[7px] right-2 text-right font-mono text-[8.5px] font-bold leading-[1.2] text-[#2E77A8]">
                  {t("quadrant.keep_informed.label")}
                </div>
                {/* pont vagy „score szükséges" */}
                {point ? (
                  <div
                    className="absolute"
                    style={{
                      left: `${scorePct(impact as number)}%`,
                      top: `${100 - scorePct(influence as number)}%`,
                      transform: "translate(-50%,-50%)",
                    }}
                  >
                    <div
                      aria-hidden
                      className="absolute left-1/2 top-1/2 h-[34px] w-[34px] -translate-x-1/2 -translate-y-1/2 rounded-pill"
                      style={{ background: "rgba(132,88,179,0.18)" }}
                    />
                    <div className="relative flex h-[22px] w-[22px] items-center justify-center rounded-pill border-[3px] border-white bg-action shadow-[0_3px_8px_rgba(108,67,160,0.4)]">
                      <span className="font-mono text-[8px] font-bold text-white">{initials}</span>
                    </div>
                  </div>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="rounded-pill border border-dashed border-neutral-400 bg-surface/90 px-3 py-1.5 font-mono text-[10px] font-semibold text-gate-text">
                      {t("scoreNeeded")}
                    </span>
                  </div>
                )}
              </div>
              <div className="mt-1.5 text-center font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
                {t("axisImpact")} →
              </div>
            </div>
          </div>

          {/* score-kiolvasás */}
          <div className="mt-3.5 grid grid-cols-2 gap-2">
            <ScoreReadout label={t("axisInfluence")} value={influence} accent="influence" />
            <ScoreReadout label={t("axisImpact")} value={impact} accent="impact" />
          </div>
          {aiSuggested && point && (
            <p className="mt-2.5 font-mono text-[10px] text-action-deep">{t("scoreAiSuggested")}</p>
          )}
        </>
      )}
    </div>
  );
}

function ScoreReadout({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | null;
  accent: "influence" | "impact";
}) {
  const infl = accent === "influence";
  return (
    <div
      className={`rounded-5 border px-[11px] py-2 ${
        infl ? "border-[#E1D3F3] bg-[#F3EEFA]" : "border-[#CFE0EC] bg-[#EAF1F7]"
      }`}
    >
      <div
        className={`font-mono text-[9px] font-bold uppercase ${infl ? "text-action" : "text-pivot"}`}
      >
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-[3px]">
        <span
          className={`font-mono text-[20px] font-bold ${infl ? "text-[#6C43A0]" : "text-[#256087]"}`}
        >
          {value ?? "—"}
        </span>
        <span className={`font-mono text-[11px] ${infl ? "text-[#A98BD0]" : "text-[#84AECB]"}`}>
          / 5
        </span>
      </div>
    </div>
  );
}

// ── Kommunikációs stratégia (read + „Szerkesztés" váltó, KIZÁRÓLAG manuális) ──
export function StrategyCard({
  projectId,
  stakeholderId,
  strategy,
  updatedLabel,
}: {
  projectId: string;
  stakeholderId: string;
  strategy: string | null;
  updatedLabel: string;
}) {
  const t = useTranslations("stakeholders");
  const [editing, setEditing] = useState(false);
  const [state, formAction] = useActionState(
    setCommunicationStrategyAction.bind(null, projectId, stakeholderId),
    initialState,
  );
  if (state.ok && editing) setEditing(false);

  return (
    <div className="flex flex-1 flex-col rounded-shell border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
          {t("strategyTitle")}
        </span>
        <span className="rounded-3 bg-tint-gate px-[7px] py-px font-mono text-[9.5px] font-bold text-gate-text">
          {t("humanOnlyTag")}
        </span>
        <div className="flex-1" />
        {strategy && !editing && (
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-tint-done px-2 py-0.5 text-[11px] font-semibold text-done-text">
            <IconCheck size={8} />
            {t("recordedTag")}
          </span>
        )}
      </div>

      {editing ? (
        <form action={formAction} className="mt-3 space-y-2">
          <textarea
            key={state.nonce ?? 0}
            name="strategy"
            rows={4}
            defaultValue={state.values?.fieldValue ?? strategy ?? ""}
            placeholder={t("strategyPlaceholder")}
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
          />
          <ErrorAlert error={state.error} />
          <div className="flex gap-2">
            <SubmitButton variant="secondary" pendingLabel={t("savingStrategy")}>
              {t("saveStrategyCta")}
            </SubmitButton>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-control px-3 py-1.5 text-body text-ink-secondary hover:bg-sunken"
            >
              {t("cancelEdit")}
            </button>
          </div>
        </form>
      ) : (
        <>
          {strategy ? (
            <p className="mt-3 flex-1 whitespace-pre-wrap text-[13.5px] leading-[1.65] text-ink">
              {strategy}
            </p>
          ) : (
            <p className="mt-3 flex-1 rounded-tile border border-dashed border-neutral-400 bg-soft px-3 py-3 text-body text-ink-tertiary">
              {t("strategyEmpty")}
            </p>
          )}
          <div className="mt-3.5 flex items-center gap-2.5 border-t border-line-soft pt-3">
            <span className="font-mono text-[10.5px] text-ink-tertiary">{updatedLabel}</span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[12px] font-semibold text-action-deep hover:underline"
            >
              {t("editStrategyCta")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Egyesített forráslista (a régi két lista → egy kapcsolós lista) ──
export interface UnifiedSourceRow {
  id: string;
  index: number;
  type: string;
  preview: string;
  dateLabel: string;
  assigned: boolean;
  /** A stakeholder ebből a bemenetből lett kivonatolva (source_input_ids) —
   *  a régi „kivonatolási forrás" jelölés megtartva (nincs információ-veszteség). */
  extractionSource: boolean;
}

export function UnifiedSourceList({
  projectId,
  stakeholderId,
  rows,
}: {
  projectId: string;
  stakeholderId: string;
  rows: UnifiedSourceRow[];
}) {
  const t = useTranslations("stakeholders");
  const [filter, setFilter] = useState<"all" | "assigned" | "unassigned">("all");
  const assignedCount = rows.filter((r) => r.assigned).length;
  const unassignedCount = rows.length - assignedCount;
  const shown = rows.filter((r) =>
    filter === "all" ? true : filter === "assigned" ? r.assigned : !r.assigned,
  );

  return (
    <div className="overflow-hidden rounded-shell border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-2.5 px-5 pb-3 pt-4">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
          {t("unifiedSourcesTitle")}
        </span>
        {assignedCount > 0 && (
          <span className="rounded-pill bg-tint-done px-2 py-px font-mono text-[10px] font-bold text-done-text">
            {t("assignedCount", { n: assignedCount })}
          </span>
        )}
        <div className="flex-1" />
        <span className="text-[12px] text-ink-tertiary">{t("unifiedSourcesHint")}</span>
      </div>
      {/* szűrő-fülek */}
      <div className="flex gap-4 border-b border-line-soft px-5">
        <FilterTab label={t("filterAll")} count={rows.length} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterTab
          label={t("filterAssigned")}
          count={assignedCount}
          active={filter === "assigned"}
          onClick={() => setFilter("assigned")}
        />
        <FilterTab
          label={t("filterUnassigned")}
          count={unassignedCount}
          active={filter === "unassigned"}
          onClick={() => setFilter("unassigned")}
        />
      </div>
      {shown.length === 0 ? (
        <p className="px-5 py-6 text-center text-body text-ink-tertiary">{t("noSourcesInFilter")}</p>
      ) : (
        <div className="flex flex-col">
          {shown.map((r) => (
            <SourceRow key={r.id} projectId={projectId} stakeholderId={stakeholderId} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 py-2 text-[12.5px] ${
        active
          ? "border-action font-bold text-action-deep"
          : "border-transparent font-semibold text-ink-tertiary hover:text-ink-secondary"
      }`}
    >
      {label} <span className="font-mono text-[10px] text-ink-tertiary">{count}</span>
    </button>
  );
}

function SourceRow({
  projectId,
  stakeholderId,
  row,
}: {
  projectId: string;
  stakeholderId: string;
  row: UnifiedSourceRow;
}) {
  const t = useTranslations("stakeholders");
  const [state, formAction] = useActionState(
    assignInputSourceAction.bind(null, projectId, stakeholderId, row.id),
    initialState,
  );
  return (
    <div
      className={`flex items-center gap-3.5 border-b border-line-row px-5 py-[13px] last:border-b-0 ${
        row.assigned ? "border-l-[3px] border-l-done" : "border-l-[3px] border-l-transparent"
      }`}
    >
      <span className="shrink-0 font-mono text-[11px] font-bold text-pivot">[{row.index}]</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold">{row.type}</span>
          {row.extractionSource && (
            <span className="shrink-0 rounded-3 border border-line bg-surface px-1.5 py-px font-mono text-[9px] text-ink-tertiary">
              {t("suggestedTag")}
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-[12px] leading-[1.5] text-ink-tertiary">
          {row.preview}
        </div>
      </div>
      <span className="shrink-0 font-mono text-[10px] text-ink-tertiary">{row.dateLabel}</span>
      {row.assigned && (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-tint-done px-2.5 py-[3px] text-[11px] font-semibold text-done-text">
          <IconCheck size={8} />
          {t("assignedTag")}
        </span>
      )}
      <form action={formAction} className="shrink-0">
        <input type="hidden" name="assign" value={row.assigned ? "0" : "1"} />
        {row.assigned ? (
          <SubmitButton variant="ghost" pendingLabel="…">
            {t("unassignCta")}
          </SubmitButton>
        ) : (
          <button
            type="submit"
            className="rounded-control bg-action px-3.5 py-1.5 text-[11.5px] font-semibold text-white shadow-action hover:bg-action-hover"
          >
            {t("assignCta")}
          </button>
        )}
      </form>
      <ErrorAlert error={state.error} />
    </div>
  );
}

// ── Kötött fájdalompontok + „+ kötés" belépő (togglePainBindAction) ──
export interface PainRow {
  id: string;
  title: string;
  risk: "low" | "medium" | "high" | null;
}

export function PainBinder({
  projectId,
  stakeholderId,
  bound,
  unbound,
}: {
  projectId: string;
  stakeholderId: string;
  bound: PainRow[];
  unbound: PainRow[];
}) {
  const t = useTranslations("stakeholders");
  const [adding, setAdding] = useState(false);

  return (
    <div className="rounded-shell border border-line bg-surface p-5 shadow-card">
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
          {t("boundPainsTitle")}
        </span>
        <span className="rounded-pill bg-neutral-150 px-[7px] py-px font-mono text-[10px] text-ink-tertiary">
          {bound.length}
        </span>
        <div className="flex-1" />
        {unbound.length > 0 && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="font-mono text-[10.5px] text-action-deep hover:underline"
          >
            {t("bindPainCta")}
          </button>
        )}
      </div>

      {bound.length === 0 && !adding ? (
        <p className="rounded-tile border border-dashed border-line px-3 py-3 text-body text-ink-tertiary">
          {t("noBoundPains")}
        </p>
      ) : (
        <div className="space-y-2">
          {bound.map((p) => (
            <PainRowItem
              key={p.id}
              projectId={projectId}
              stakeholderId={stakeholderId}
              pain={p}
              bound
            />
          ))}
        </div>
      )}

      {adding && (
        <div className="mt-3 rounded-tile border border-line-soft bg-soft p-3">
          <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
            {t("bindPickTitle")}
          </div>
          {unbound.length === 0 ? (
            <p className="text-body text-ink-tertiary">{t("noUnboundPains")}</p>
          ) : (
            <div className="space-y-2">
              {unbound.map((p) => (
                <PainRowItem
                  key={p.id}
                  projectId={projectId}
                  stakeholderId={stakeholderId}
                  pain={p}
                  bound={false}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RiskBadge({ risk }: { risk: "low" | "medium" | "high" | null }) {
  const t = useTranslations("stakeholders");
  if (!risk) return null;
  const style =
    risk === "high"
      ? "bg-[#F6DCE1] text-[#A6384C]"
      : risk === "medium"
        ? "bg-tint-gate text-gate-text"
        : "bg-neutral-150 text-ink-tertiary";
  return (
    <span
      className={`shrink-0 rounded-4 px-[9px] py-[3px] font-mono text-[10px] font-bold uppercase ${style}`}
    >
      {t(`risk.${risk}`)}
    </span>
  );
}

function PainRowItem({
  projectId,
  stakeholderId,
  pain,
  bound,
}: {
  projectId: string;
  stakeholderId: string;
  pain: PainRow;
  bound: boolean;
}) {
  const t = useTranslations("stakeholders");
  const [state, formAction] = useActionState(
    togglePainBindAction.bind(null, projectId, stakeholderId, pain.id),
    initialState,
  );
  const high = pain.risk === "high";
  return (
    <div
      className={`flex items-center gap-3.5 rounded-6 border px-4 py-3 ${
        bound && high ? "border-[#F1D3DA] bg-[#FCF2F4]" : "border-line bg-surface"
      }`}
    >
      {bound && high && (
        <svg
          width="18"
          height="18"
          viewBox="0 0 20 20"
          className="shrink-0 text-danger"
          aria-hidden
        >
          <path d="M10 2.5 L18 16.5 L2 16.5 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M10 8 L10 12 M10 14 L10 14.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-bold text-ink">{pain.title}</div>
      </div>
      <RiskBadge risk={pain.risk} />
      <form action={formAction} className="shrink-0">
        <input type="hidden" name="bind" value={bound ? "0" : "1"} />
        <SubmitButton variant="ghost" pendingLabel="…">
          {bound ? t("unassignCta") : t("bindThisPainCta")}
        </SubmitButton>
      </form>
      <ErrorAlert error={state.error} />
    </div>
  );
}

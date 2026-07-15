"use client";

import Link from "next/link";
import { useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { FormState } from "@/app/actions";
import {
  addStakeholderAction,
  confirmStakeholderAction,
  editStakeholderAction,
  extractStakeholdersAction,
  rejectStakeholderAction,
  setPainStakeholdersAction,
} from "@/app/stakeholder-actions";
import type { EntityState } from "@/lib/db/types";
import { FieldStateBadge } from "@/components/FieldStateBadge";
import { SubmitButton } from "@/components/SubmitButton";

// ─────────────────────────────────────────────────────────────
// Stakeholder-űrlapok (Coding-csomag #8) — a #7a entitás-kártya mintáját
// követi (AI javasol → ember erősít meg). Tömör-lapos nyelv: javaslat =
// borostyán bal-szegély, megerősített = kompakt sor a dedikált nézetre
// mutató linkkel. A score/kommunikációs stratégia/forrás-kötés a dedikált
// nézeten él (StakeholderView) — itt csak az E1-lánc + kézi felvétel.
// ─────────────────────────────────────────────────────────────

const initialState: FormState = { ok: false, error: null };

function ErrorAlert({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="rounded-tile border border-danger/40 bg-danger/10 px-3 py-2 text-body text-danger"
    >
      {error}
    </p>
  );
}

function NoticeAlert({ notice }: { notice?: string | null }) {
  if (!notice) return null;
  return (
    <p
      role="status"
      className="rounded-tile border border-gate/50 bg-surface px-3 py-2 text-body text-gate"
    >
      {notice}
    </p>
  );
}

function StakeholderStateBadge({ state }: { state: EntityState }) {
  const t = useTranslations("entities");
  const visual =
    state === "ai_suggested" ? "ai_filled" : state === "confirmed" ? "confirmed" : "manual";
  return <FieldStateBadge state={visual} label={t(`state.${state}`)} />;
}

function SourceMarks({ indices }: { indices: number[] }) {
  const t = useTranslations("workspace");
  return (
    <span className="font-mono text-mono-sm text-ink-tertiary">
      {t("sourcesLabel")}{" "}
      {indices.length > 0 ? indices.map((n) => `[${n}]`).join(" ") : t("noSourceMark")}
    </span>
  );
}

/** Score-jelvény (befolyás/érintettség). Csak akkor mutat értéket, ha van;
 *  a null a „nincs alap" (c-minta) — a semleges „—". */
function ScoreChip({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-pill border border-line bg-surface px-2 py-0.5 font-mono text-mono-sm text-ink-secondary">
      {label} {value ?? "—"}
    </span>
  );
}

// ── Kivonatolás gomb ─────────────────────────────────────────

export function ExtractStakeholdersForm({ projectId }: { projectId: string }) {
  const t = useTranslations("stakeholders");
  const [state, formAction] = useActionState(
    extractStakeholdersAction.bind(null, projectId),
    initialState,
  );
  return (
    <form action={formAction} className="space-y-2">
      <ErrorAlert error={state.error} />
      <NoticeAlert notice={state.notice} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary" pendingLabel={t("extracting")}>
          {t("extractCta")}
        </SubmitButton>
        <span className="text-mono-sm text-ink-tertiary">{t("reExtractHint")}</span>
      </div>
    </form>
  );
}

// ── Javaslat-kártya (megerősít / szerkeszt / elvet) ──────────

export interface StakeholderCardData {
  id: string;
  name: string;
  title: string | null;
  influenceScore: number | null;
  impactScore: number | null;
  state: EntityState;
  sourceIndices: number[];
}

export function StakeholderProposalCard({
  projectId,
  stakeholder,
}: {
  projectId: string;
  stakeholder: StakeholderCardData;
}) {
  const t = useTranslations("stakeholders");
  const tWs = useTranslations("workspace");
  const [editing, setEditing] = useState(false);

  const [confirmState, confirmAction] = useActionState(
    confirmStakeholderAction.bind(null, projectId, stakeholder.id),
    initialState,
  );
  const [rejectState, rejectAction] = useActionState(
    rejectStakeholderAction.bind(null, projectId, stakeholder.id),
    initialState,
  );
  const [editState, editFormAction] = useActionState(
    editStakeholderAction.bind(null, projectId, stakeholder.id),
    initialState,
  );

  const isProposal = stakeholder.state === "ai_suggested";
  const hasScore = stakeholder.influenceScore !== null || stakeholder.impactScore !== null;

  return (
    <div className="rounded-tile border border-line border-l-2 border-l-gate bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-body font-medium">{stakeholder.name}</span>
        <StakeholderStateBadge state={stakeholder.state} />
      </div>

      {!editing && (
        <>
          {isProposal && (
            <div className="mb-1.5 mt-1.5 inline-flex items-center rounded-3 bg-tint-action px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-action-deep">
              {t("aiSuggestionLabel")}
            </div>
          )}
          <p className="mt-1 text-body text-ink-secondary">
            {stakeholder.title ?? t("noTitle")}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-2">
            {hasScore && (
              <>
                <ScoreChip label={t("influenceLabel")} value={stakeholder.influenceScore} />
                <ScoreChip label={t("impactLabel")} value={stakeholder.impactScore} />
              </>
            )}
            <SourceMarks indices={stakeholder.sourceIndices} />
          </p>
        </>
      )}

      {editing && (
        <form action={editFormAction} className="mt-2 space-y-2">
          <input
            key={`n${editState.nonce ?? 0}`}
            name="name"
            required
            defaultValue={editState.values?.title ?? stakeholder.name}
            placeholder={t("namePlaceholder")}
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
          />
          <input
            key={`ti${editState.nonce ?? 0}`}
            name="title"
            defaultValue={editState.values?.fieldValue ?? stakeholder.title ?? ""}
            placeholder={t("titlePlaceholder")}
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
          />
          <ErrorAlert error={editState.error} />
          <div className="flex gap-2">
            <SubmitButton variant="secondary" pendingLabel={tWs("savingField")}>
              {tWs("saveCta")}
            </SubmitButton>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-control px-3 py-2 text-body text-ink-secondary hover:bg-sunken"
            >
              {tWs("cancelCta")}
            </button>
          </div>
        </form>
      )}

      <ErrorAlert error={confirmState.error} />
      <ErrorAlert error={rejectState.error} />

      {!editing && (
        <div className="mt-2 flex flex-wrap gap-2">
          {isProposal && (
            <form action={confirmAction}>
              <SubmitButton pendingLabel={tWs("confirming")}>{tWs("confirmCta")}</SubmitButton>
            </form>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-control border border-line bg-surface px-3 py-2 text-body font-medium shadow-tile-sm hover:bg-sunken"
          >
            {tWs("editCta")}
          </button>
          {!isProposal && (
            <Link
              href={`/project/${projectId}/stakeholder/${stakeholder.id}`}
              className="rounded-control border border-line bg-surface px-3 py-2 text-body font-medium shadow-tile-sm hover:bg-sunken"
            >
              {t("viewOpenCta")}
            </Link>
          )}
          <form action={rejectAction}>
            <SubmitButton variant="ghost" pendingLabel={tWs("dismissing")}>
              {tWs("dismissCta")}
            </SubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}

// ── Megerősített stakeholder: kompakt sor (link a dedikált nézetre) ──

export function StakeholderConfirmedRow({
  projectId,
  stakeholder,
}: {
  projectId: string;
  stakeholder: StakeholderCardData;
}) {
  const t = useTranslations("stakeholders");
  return (
    <Link
      href={`/project/${projectId}/stakeholder/${stakeholder.id}`}
      title={t("openViewTitle")}
      className="flex items-center gap-2.5 rounded-tile border border-line bg-surface px-3 py-2 shadow-tile-sm transition-colors duration-[var(--motion-base)] hover:bg-sunken"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium">{stakeholder.name}</span>
        <span className="block truncate text-mono-sm text-ink-tertiary">
          {stakeholder.title ?? t("noTitle")}
        </span>
      </span>
      {(stakeholder.influenceScore !== null || stakeholder.impactScore !== null) && (
        <span className="shrink-0 font-mono text-mono-sm text-ink-secondary">
          {t("influenceLabel")} {stakeholder.influenceScore ?? "—"} · {t("impactLabel")}{" "}
          {stakeholder.impactScore ?? "—"}
        </span>
      )}
      <StakeholderStateBadge state={stakeholder.state} />
      <span aria-hidden className="shrink-0 text-ink-tertiary">
        ›
      </span>
    </Link>
  );
}

// ── Kézi hozzáadás ───────────────────────────────────────────

export function AddStakeholderForm({ projectId }: { projectId: string }) {
  const t = useTranslations("stakeholders");
  const [state, formAction] = useActionState(
    addStakeholderAction.bind(null, projectId),
    initialState,
  );
  return (
    <details className="rounded-tile border border-dashed border-line">
      <summary className="cursor-pointer select-none px-3 py-2 text-body text-ink-secondary hover:text-ink">
        {t("addCta")}
      </summary>
      <form action={formAction} className="space-y-2 px-3 pb-3">
        <input
          key={`n${state.nonce ?? 0}`}
          name="name"
          required
          defaultValue={state.values?.title}
          placeholder={t("namePlaceholder")}
          className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
        />
        <input
          key={`ti${state.nonce ?? 0}`}
          name="title"
          defaultValue={state.values?.fieldValue}
          placeholder={t("titlePlaceholder")}
          className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
        />
        <ErrorAlert error={state.error} />
        {state.ok && <p className="text-body text-done">{t("added")}</p>}
        <SubmitButton variant="secondary" pendingLabel={t("adding")}>
          {t("addSubmit")}
        </SubmitButton>
      </form>
    </details>
  );
}

// ── Fájdalompont ↔ stakeholder kötés (a fájdalompont-kártyán) ──

export function PainStakeholderBinder({
  projectId,
  painPointId,
  options,
  boundIds,
}: {
  projectId: string;
  painPointId: string;
  /** A projekt megerősített stakeholderei, amikre kötni lehet. */
  options: { id: string; name: string }[];
  /** A fájdalomponthoz jelenleg kötött stakeholder-id-k. */
  boundIds: string[];
}) {
  const t = useTranslations("stakeholders");
  const [state, formAction] = useActionState(
    setPainStakeholdersAction.bind(null, projectId, painPointId),
    initialState,
  );
  const boundSet = new Set(boundIds);

  if (options.length === 0) {
    return (
      <p className="rounded-tile border border-dashed border-line px-3 py-2 text-mono-sm text-ink-tertiary">
        {t("noConfirmedStakeholders")}
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <span className="text-mono-sm font-medium text-ink-secondary">{t("bindPainsLabel")}</span>
      <div className="flex flex-col gap-1">
        {options.map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-body">
            <input
              type="checkbox"
              name="stakeholderIds"
              value={s.id}
              defaultChecked={boundSet.has(s.id)}
              className="accent-[var(--action-primary)]"
            />
            <span className="min-w-0 truncate">{s.name}</span>
          </label>
        ))}
      </div>
      <ErrorAlert error={state.error} />
      {state.ok && <p className="text-body text-done">{t("bindSaved")}</p>}
      <SubmitButton variant="secondary" pendingLabel={t("savingBind")}>
        {t("bindPainsCta")}
      </SubmitButton>
    </form>
  );
}

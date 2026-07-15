"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { FormState } from "@/app/actions";
import {
  assignInputSourceAction,
  scoreStakeholderAction,
  setCommunicationStrategyAction,
} from "@/app/stakeholder-actions";
import { SubmitButton } from "@/components/SubmitButton";

// ─────────────────────────────────────────────────────────────
// A dedikált stakeholder-nézet interaktív űrlapjai (#8): score
// (influence/impact — megerősítés vagy kézi töltés), kommunikációs stratégia
// (KIZÁRÓLAG manuális), input-forrás hozzárendelés (3a, suggest+confirm).
// Tömör-lapos nyelv; a szerveroldali nézet-oldal ezeket ágyazza be.
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

function ScoreSelect({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: number | null;
}) {
  const t = useTranslations("stakeholders");
  return (
    <label className="flex items-center gap-1.5 text-body">
      <span className="text-mono-sm text-ink-tertiary">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue ?? ""}
        className="rounded-control border border-line bg-surface px-2 py-1 font-mono text-body"
      >
        <option value="">{t("scoreUnset")}</option>
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

export function StakeholderScoreForm({
  projectId,
  stakeholderId,
  influenceScore,
  impactScore,
  aiSuggested,
}: {
  projectId: string;
  stakeholderId: string;
  influenceScore: number | null;
  impactScore: number | null;
  /** A stakeholder ai_suggested állapotában a score AI-javasolt (megerősítendő). */
  aiSuggested: boolean;
}) {
  const t = useTranslations("stakeholders");
  const [state, formAction] = useActionState(
    scoreStakeholderAction.bind(null, projectId, stakeholderId),
    initialState,
  );
  const hasScore = influenceScore !== null || impactScore !== null;

  return (
    <form action={formAction} className="space-y-2">
      {hasScore && aiSuggested && (
        <span className="inline-flex items-center rounded-3 bg-tint-action px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-action-deep">
          {t("scoreAiSuggested")}
        </span>
      )}
      {!hasScore && (
        <p className="text-mono-sm text-ink-tertiary">{t("scoreUnsetHint")}</p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <ScoreSelect name="influenceScore" label={t("influenceLabel")} defaultValue={influenceScore} />
        <ScoreSelect name="impactScore" label={t("impactLabel")} defaultValue={impactScore} />
        <span className="font-mono text-mono-sm text-ink-tertiary">{t("scorePickPrompt")}</span>
      </div>
      <ErrorAlert error={state.error} />
      {state.ok && <p className="text-body text-done">{t("scoreSaved")}</p>}
      <SubmitButton variant="secondary" pendingLabel={t("savingScore")}>
        {t("saveScoreCta")}
      </SubmitButton>
    </form>
  );
}

export function StakeholderStrategyForm({
  projectId,
  stakeholderId,
  strategy,
}: {
  projectId: string;
  stakeholderId: string;
  strategy: string | null;
}) {
  const t = useTranslations("stakeholders");
  const [state, formAction] = useActionState(
    setCommunicationStrategyAction.bind(null, projectId, stakeholderId),
    initialState,
  );
  return (
    <form action={formAction} className="space-y-2">
      <p className="text-mono-sm text-ink-tertiary">{t("strategyManualHint")}</p>
      <textarea
        key={state.nonce ?? 0}
        name="strategy"
        rows={3}
        defaultValue={state.values?.fieldValue ?? strategy ?? ""}
        placeholder={t("strategyPlaceholder")}
        className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
      />
      <ErrorAlert error={state.error} />
      {state.ok && <p className="text-body text-done">{t("strategySaved")}</p>}
      <SubmitButton variant="secondary" pendingLabel={t("savingStrategy")}>
        {t("saveStrategyCta")}
      </SubmitButton>
    </form>
  );
}

/** Input-forrás hozzárendelés (3a): egy bemenet sora assign/unassign gombbal.
 *  A „kivonatolási forrás" (suggested) tag jelzi, ha a stakeholder ebből az
 *  inputból lett kivonatolva — a hozzárendelés akkor is suggest+confirm, sosem
 *  kényszerített. */
export function InputAssignRow({
  projectId,
  stakeholderId,
  inputId,
  index,
  type,
  preview,
  assigned,
  suggested,
}: {
  projectId: string;
  stakeholderId: string;
  inputId: string;
  index: number;
  type: string;
  preview: string;
  assigned: boolean;
  suggested: boolean;
}) {
  const t = useTranslations("stakeholders");
  const [state, formAction] = useActionState(
    assignInputSourceAction.bind(null, projectId, stakeholderId, inputId),
    initialState,
  );
  return (
    <div className="rounded-tile border border-line bg-surface p-3 shadow-tile-sm">
      <div className="flex items-start gap-2">
        <span className="shrink-0 font-mono text-mono-sm text-pivot">[{index}]</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-body font-medium">{type}</span>
            {assigned && (
              <span className="rounded-pill bg-tint-done px-2 py-0.5 font-mono text-[10px] font-semibold text-done-text">
                {t("assignedTag")}
              </span>
            )}
            {suggested && !assigned && (
              <span className="rounded-pill border border-line bg-surface px-2 py-0.5 font-mono text-[10px] text-ink-secondary">
                {t("suggestedTag")}
              </span>
            )}
          </span>
          <span className="mt-0.5 block line-clamp-2 text-mono-sm text-ink-tertiary">{preview}</span>
        </span>
        <form action={formAction} className="shrink-0">
          <input type="hidden" name="assign" value={assigned ? "0" : "1"} />
          <SubmitButton variant="ghost" pendingLabel="…">
            {assigned ? t("unassignCta") : t("assignCta")}
          </SubmitButton>
        </form>
      </div>
      <ErrorAlert error={state.error} />
    </div>
  );
}

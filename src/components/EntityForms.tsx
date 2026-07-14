"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { FormState } from "@/app/actions";
import {
  addPainPointAction,
  addUseCaseAction,
  confirmPainPointAction,
  confirmUseCaseAction,
  deriveUseCasesAction,
  editPainPointAction,
  editUseCaseAction,
  excludeUseCaseAction,
  extractPainPointsAction,
  rejectPainPointAction,
  rejectUseCaseAction,
  scoreUseCaseAction,
  shortlistUseCaseAction,
} from "@/app/entity-actions";
import { generateShortlistFromEntitiesAction } from "@/app/artifact-actions";
import {
  AiActPanel,
  AiSuitabilityPanel,
  DataReadinessPanel,
  EvaluatorBadges,
  type EvaluatorData,
} from "@/components/EvaluatorForms";
import type { EntityState } from "@/lib/db/types";
import { FieldStateBadge } from "@/components/FieldStateBadge";
import { SubmitButton } from "@/components/SubmitButton";

// ─────────────────────────────────────────────────────────────
// P1 entitás-űrlapok (#7a): fájdalompont- és use case-kártyák az E1
// mintával (AI javasol → ember erősít meg), pontozás, shortlist-státusz.
// A vizuális nyelv a FieldCard/WorkspaceForms mintáit követi (1e kártya-
// minták): javaslat = borostyán bal-szegély, megerősített = zöld.
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

/** Entitás-állapot jelvény: ikon + szöveg (törvény 4). A vizuális a mező-
 *  állapotokra vetül: ai_suggested → szikra (borostyán), confirmed → pipa,
 *  manual → toll. A rejected sosem jelenik meg listában. */
function EntityStateBadge({ state }: { state: EntityState }) {
  const t = useTranslations("entities");
  const visual =
    state === "ai_suggested" ? "ai_filled" : state === "confirmed" ? "confirmed" : "manual";
  return <FieldStateBadge state={visual} label={t(`state.${state}`)} />;
}

function SeverityPill({ level }: { level: "low" | "medium" | "high" | null }) {
  const t = useTranslations("entities");
  const style =
    level === "high"
      ? "border-danger/40 text-danger"
      : level === "medium"
        ? "border-gate/50 text-gate"
        : "border-line text-ink-secondary";
  if (!level) {
    return <span className="font-mono text-mono-sm text-ink-tertiary">{t("level.none")}</span>;
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-pill border bg-surface px-2 py-0.5 font-mono text-mono-sm ${style}`}
    >
      {t(`level.${level}`)}
    </span>
  );
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

// ── Fájdalompont: kivonatolás gomb ───────────────────────────

export function ExtractPainPointsForm({ projectId }: { projectId: string }) {
  const t = useTranslations("entities");
  const [state, formAction] = useActionState(
    extractPainPointsAction.bind(null, projectId),
    initialState,
  );

  return (
    <form action={formAction} className="space-y-2">
      <ErrorAlert error={state.error} />
      <NoticeAlert notice={state.notice} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary" pendingLabel={t("extractingPains")}>
          {t("extractPainsCta")}
        </SubmitButton>
        <span className="text-mono-sm text-ink-tertiary">{t("reExtractPainsHint")}</span>
      </div>
    </form>
  );
}

// ── Fájdalompont: javaslat-kártya (megerősít / szerkeszt / elvet) ─

export interface PainPointCardData {
  id: string;
  title: string;
  description: string | null;
  quote: string | null;
  severity: "low" | "medium" | "high" | null;
  state: EntityState;
  sourceIndices: number[];
}

export function PainPointProposalCard({
  projectId,
  painPoint,
  embedded,
}: {
  projectId: string;
  painPoint: PainPointCardData;
  /** Drill-in részletként (Redesign #1): a külső keret + fejléc-sor a
   *  DrillRow-ból jön, itt csak a részlet + akciók renderelnek. */
  embedded?: boolean;
}) {
  const t = useTranslations("entities");
  const tWs = useTranslations("workspace");
  const [editing, setEditing] = useState(false);

  const [confirmState, confirmAction] = useActionState(
    confirmPainPointAction.bind(null, projectId, painPoint.id),
    initialState,
  );
  const [rejectState, rejectAction] = useActionState(
    rejectPainPointAction.bind(null, projectId, painPoint.id),
    initialState,
  );
  const [editState, editFormAction] = useActionState(
    editPainPointAction.bind(null, projectId, painPoint.id),
    initialState,
  );

  return (
    <div
      className={
        embedded
          ? ""
          : "rounded-tile border border-line border-l-2 border-l-gate bg-surface p-3"
      }
    >
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 text-body font-medium">{painPoint.title}</span>
          <EntityStateBadge state={painPoint.state} />
        </div>
      )}

      {!editing && (
        <>
          {painPoint.description && (
            <p className="mt-1.5 whitespace-pre-wrap text-body text-ink-secondary">
              {painPoint.description}
            </p>
          )}
          {painPoint.quote && (
            <p className="mt-1.5 border-l-2 border-line pl-2 text-body italic text-ink-secondary">
              {t("quoteWrapped", { quote: painPoint.quote })}
            </p>
          )}
          <p className="mt-1.5 flex flex-wrap items-center gap-2">
            <SeverityPill level={painPoint.severity} />
            <SourceMarks indices={painPoint.sourceIndices} />
          </p>
        </>
      )}

      {editing && (
        <form action={editFormAction} className="mt-2 space-y-2">
          {/* Hibaágon a beírt (values), egyébként az entitás értéke áll vissza */}
          <input
            key={`t${editState.nonce ?? 0}`}
            name="title"
            required
            defaultValue={editState.values?.title ?? painPoint.title}
            placeholder={t("titlePlaceholder")}
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
          />
          <textarea
            key={`d${editState.nonce ?? 0}`}
            name="description"
            rows={2}
            defaultValue={editState.values?.fieldValue ?? painPoint.description ?? ""}
            placeholder={t("descriptionPlaceholder")}
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
          />
          <label className="flex items-center gap-2 text-body">
            <span className="text-mono-sm text-ink-tertiary">{t("severityLabel")}</span>
            <select
              name="severity"
              defaultValue={painPoint.severity ?? ""}
              className="rounded-control border border-line bg-surface px-2 py-1.5 text-body"
            >
              <option value="">{t("level.none")}</option>
              <option value="low">{t("level.low")}</option>
              <option value="medium">{t("level.medium")}</option>
              <option value="high">{t("level.high")}</option>
            </select>
          </label>
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
          {painPoint.state === "ai_suggested" && (
            <form action={confirmAction}>
              {/* Megerősítés = döntési pont → lila (törvény 3) */}
              <SubmitButton pendingLabel={tWs("confirming")}>
                {tWs("confirmCta")}
              </SubmitButton>
            </form>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-control border border-line bg-surface px-3 py-2 text-body font-medium shadow-tile-sm hover:bg-sunken"
          >
            {tWs("editCta")}
          </button>
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

// ── Fájdalompont: megerősített sor (táblázat-nézet) ──────────

export function PainPointConfirmedRow({
  projectId,
  painPoint,
}: {
  projectId: string;
  painPoint: PainPointCardData;
}) {
  const tWs = useTranslations("workspace");
  const [rejectState, rejectAction] = useActionState(
    rejectPainPointAction.bind(null, projectId, painPoint.id),
    initialState,
  );

  return (
    <li className="card-sunken px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-body font-medium">{painPoint.title}</span>
        <span className="flex shrink-0 items-center gap-2">
          <SeverityPill level={painPoint.severity} />
          <EntityStateBadge state={painPoint.state} />
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <SourceMarks indices={painPoint.sourceIndices} />
        <form action={rejectAction}>
          <button
            type="submit"
            className="rounded-control px-2 py-0.5 text-mono-sm text-ink-tertiary hover:bg-sunken hover:text-ink-secondary"
          >
            {tWs("dismissCta")}
          </button>
        </form>
      </div>
      <ErrorAlert error={rejectState.error} />
    </li>
  );
}

// ── Fájdalompont: kézi hozzáadás ─────────────────────────────

export function AddPainPointForm({ projectId }: { projectId: string }) {
  const t = useTranslations("entities");
  const [state, formAction] = useActionState(
    addPainPointAction.bind(null, projectId),
    initialState,
  );

  return (
    <details className="rounded-tile border border-dashed border-line">
      <summary className="cursor-pointer select-none px-3 py-2 text-body text-ink-secondary hover:text-ink">
        {t("addPainCta")}
      </summary>
      <form action={formAction} className="space-y-2 px-3 pb-3">
        <input
          key={`t${state.nonce ?? 0}`}
          name="title"
          required
          defaultValue={state.values?.title}
          placeholder={t("titlePlaceholder")}
          className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
        />
        <textarea
          key={`d${state.nonce ?? 0}`}
          name="description"
          rows={2}
          defaultValue={state.values?.fieldValue}
          placeholder={t("descriptionPlaceholder")}
          className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
        />
        <label className="flex items-center gap-2 text-body">
          <span className="text-mono-sm text-ink-tertiary">{t("severityLabel")}</span>
          <select
            name="severity"
            defaultValue=""
            className="rounded-control border border-line bg-surface px-2 py-1.5 text-body"
          >
            <option value="">{t("level.none")}</option>
            <option value="low">{t("level.low")}</option>
            <option value="medium">{t("level.medium")}</option>
            <option value="high">{t("level.high")}</option>
          </select>
        </label>
        <ErrorAlert error={state.error} />
        {state.ok && <p className="text-body text-done">{t("added")}</p>}
        <SubmitButton variant="secondary" pendingLabel={t("adding")}>
          {t("addCta")}
        </SubmitButton>
      </form>
    </details>
  );
}

// ── Use case: származtatás gomb ──────────────────────────────

export function DeriveUseCasesForm({ projectId }: { projectId: string }) {
  const t = useTranslations("entities");
  const [state, formAction] = useActionState(
    deriveUseCasesAction.bind(null, projectId),
    initialState,
  );

  return (
    <form action={formAction} className="space-y-2">
      <ErrorAlert error={state.error} />
      <NoticeAlert notice={state.notice} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary" pendingLabel={t("deriving")}>
          {t("deriveCta")}
        </SubmitButton>
        <span className="text-mono-sm text-ink-tertiary">{t("deriveHint")}</span>
      </div>
    </form>
  );
}

// ── Use case: kártya (javaslat ÉS megerősített nézet) ────────

export interface UseCaseCardData {
  id: string;
  title: string;
  description: string | null;
  state: EntityState;
  scoreValue: number | null;
  scoreFeasibility: number | null;
  risk: "low" | "medium" | "high" | null;
  quickWin: boolean;
  listStatus: "candidate" | "shortlist" | "excluded" | "selected";
  exclusionReason: string | null;
  /** Eredet-lánc: a címzett fájdalompontok címei (a chipek). */
  painChips: string[];
  sourceIndices: number[];
  /** Értékelők (#7b) — defenzíven parse-olt jsonb-tartalom. */
  evaluators: EvaluatorData;
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
  const t = useTranslations("entities");
  return (
    <label className="flex items-center gap-1.5 text-body">
      <span className="text-mono-sm text-ink-tertiary">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue ?? ""}
        className="rounded-control border border-line bg-surface px-2 py-1 font-mono text-body"
      >
        <option value="">{t("unscored")}</option>
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

export function UseCaseCard({
  projectId,
  useCase,
  embedded,
}: {
  projectId: string;
  useCase: UseCaseCardData;
  /** Drill-in részletként (Redesign #1): külső keret + fejléc a DrillRow-ból. */
  embedded?: boolean;
}) {
  const t = useTranslations("entities");
  const tWs = useTranslations("workspace");
  const [editing, setEditing] = useState(false);
  const [excluding, setExcluding] = useState(false);

  const [confirmState, confirmAction] = useActionState(
    confirmUseCaseAction.bind(null, projectId, useCase.id),
    initialState,
  );
  const [rejectState, rejectAction] = useActionState(
    rejectUseCaseAction.bind(null, projectId, useCase.id),
    initialState,
  );
  const [editState, editFormAction] = useActionState(
    editUseCaseAction.bind(null, projectId, useCase.id),
    initialState,
  );
  const [scoreState, scoreFormAction] = useActionState(
    scoreUseCaseAction.bind(null, projectId, useCase.id),
    initialState,
  );
  const [shortlistState, shortlistFormAction] = useActionState(
    shortlistUseCaseAction.bind(null, projectId, useCase.id),
    initialState,
  );
  const [excludeState, excludeFormAction] = useActionState(
    excludeUseCaseAction.bind(null, projectId, useCase.id),
    initialState,
  );

  const isProposal = useCase.state === "ai_suggested";
  const accent = isProposal ? "border-l-gate" : "border-l-done";

  return (
    <div
      className={
        embedded
          ? ""
          : `rounded-tile border border-line border-l-2 ${accent} bg-surface p-3`
      }
    >
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 text-body font-medium">{useCase.title}</span>
          <span className="flex shrink-0 items-center gap-2">
            {useCase.quickWin && (
              // Jelvény, nem döntési pont → NEM lila (törvény 3); ikon+szöveg
              // (törvény 4): villám = quick win.
              <span className="inline-flex items-center gap-1 rounded-pill border border-line bg-surface px-2 py-0.5 font-mono text-mono-sm text-ink-secondary">
                <svg
                  width={11}
                  height={11}
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M9 2L4 9.5h3.5L7 14l5-7.5H8.5L9 2z" />
                </svg>
                {t("quickWinBadge")}
              </span>
            )}
            {!isProposal && (
              <span className="inline-flex items-center rounded-pill border border-line bg-surface px-2 py-0.5 font-mono text-mono-sm text-ink-secondary">
                {t(`listStatus.${useCase.listStatus}`)}
              </span>
            )}
            <EntityStateBadge state={useCase.state} />
          </span>
        </div>
      )}

      {!editing && useCase.description && (
        <p className="mt-1.5 whitespace-pre-wrap text-body text-ink-secondary">
          {useCase.description}
        </p>
      )}

      {/* Eredet-lánc: mely fájdalompontok ← mely források [n] */}
      <div className="mt-2 space-y-1">
        {useCase.painChips.length > 0 && (
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="text-mono-sm text-ink-tertiary">{t("addressedPains")}</span>
            {useCase.painChips.map((title, i) => (
              <span
                key={i}
                className="inline-flex max-w-full items-center truncate rounded-pill border border-line bg-sunken px-2 py-0.5 text-mono-sm text-ink-secondary"
              >
                {title}
              </span>
            ))}
          </p>
        )}
        <SourceMarks indices={useCase.sourceIndices} />
      </div>

      {useCase.listStatus === "excluded" && useCase.exclusionReason && (
        <p className="mt-2 rounded-tile border border-dashed border-line px-3 py-2 text-body text-ink-tertiary">
          {t("exclusionReasonLabel")} {useCase.exclusionReason}
        </p>
      )}

      {editing && (
        <form action={editFormAction} className="mt-2 space-y-2">
          {/* Hibaágon a beírt (values), egyébként az entitás értéke áll vissza */}
          <input
            key={`t${editState.nonce ?? 0}`}
            name="title"
            required
            defaultValue={editState.values?.title ?? useCase.title}
            placeholder={t("titlePlaceholder")}
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
          />
          <textarea
            key={`d${editState.nonce ?? 0}`}
            name="description"
            rows={2}
            defaultValue={editState.values?.fieldValue ?? useCase.description ?? ""}
            placeholder={t("descriptionPlaceholder")}
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
      <ErrorAlert error={shortlistState.error} />

      {/* Javaslat-akciók (E1) */}
      {isProposal && !editing && (
        <div className="mt-2 flex flex-wrap gap-2">
          <form action={confirmAction}>
            <SubmitButton pendingLabel={tWs("confirming")}>{tWs("confirmCta")}</SubmitButton>
          </form>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-control border border-line bg-surface px-3 py-2 text-body font-medium shadow-tile-sm hover:bg-sunken"
          >
            {tWs("editCta")}
          </button>
          <form action={rejectAction}>
            <SubmitButton variant="ghost" pendingLabel={tWs("dismissing")}>
              {tWs("dismissCta")}
            </SubmitButton>
          </form>
        </div>
      )}

      {/* Megerősített: pontozás + shortlist-státusz */}
      {!isProposal && !editing && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          {/* Értékelő-összegzések (#7b): ikon+szöveg jelvények */}
          <EvaluatorBadges data={useCase.evaluators} />
          <form action={scoreFormAction} className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <ScoreSelect
                name="scoreValue"
                label={t("scoreValueLabel")}
                defaultValue={useCase.scoreValue}
              />
              <ScoreSelect
                name="scoreFeasibility"
                label={t("scoreFeasibilityLabel")}
                defaultValue={useCase.scoreFeasibility}
              />
              <label className="flex items-center gap-1.5 text-body">
                <span className="text-mono-sm text-ink-tertiary">{t("riskLabel")}</span>
                <select
                  name="risk"
                  defaultValue={useCase.risk ?? ""}
                  className="rounded-control border border-line bg-surface px-2 py-1 text-body"
                >
                  <option value="">{t("level.none")}</option>
                  <option value="low">{t("level.low")}</option>
                  <option value="medium">{t("level.medium")}</option>
                  <option value="high">{t("level.high")}</option>
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-body">
                <input
                  type="checkbox"
                  name="quickWin"
                  defaultChecked={useCase.quickWin}
                  className="accent-[var(--action-primary)]"
                />
                {t("quickWinLabel")}
              </label>
            </div>
            <ErrorAlert error={scoreState.error} />
            {scoreState.ok && <p className="text-body text-done">{t("scoreSaved")}</p>}
            <SubmitButton variant="secondary" pendingLabel={t("savingScore")}>
              {t("saveScoreCta")}
            </SubmitButton>
          </form>

          <div className="flex flex-wrap items-start gap-2">
            {/* Csak jelölt/kizárt tehető shortlistre — a „kiválasztott" (P2
                aktusa) visszaminősítése nem innen történik. */}
            {(useCase.listStatus === "candidate" ||
              useCase.listStatus === "excluded") && (
              <form action={shortlistFormAction}>
                {/* Shortlistre tétel = döntési pont → lila (törvény 3) */}
                <SubmitButton pendingLabel={t("shortlisting")}>
                  {t("shortlistCta")}
                </SubmitButton>
              </form>
            )}
            {useCase.listStatus !== "excluded" && !excluding && (
              <button
                type="button"
                onClick={() => setExcluding(true)}
                className="rounded-control border border-line bg-surface px-3 py-2 text-body font-medium shadow-tile-sm hover:bg-sunken"
              >
                {t("excludeCta")}
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-control px-3 py-2 text-body text-ink-secondary hover:bg-sunken"
            >
              {tWs("editCta")}
            </button>
            <form action={rejectAction}>
              <SubmitButton variant="ghost" pendingLabel={tWs("dismissing")}>
                {tWs("dismissCta")}
              </SubmitButton>
            </form>
          </div>

          {/* Kizárás: kötelező indoklással (poka-yoke) */}
          {excluding && (
            <form action={excludeFormAction} className="space-y-2">
              <textarea
                key={`x${excludeState.nonce ?? 0}`}
                name="reason"
                required
                rows={2}
                defaultValue={excludeState.values?.reason}
                placeholder={t("excludeReasonPlaceholder")}
                className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
              />
              <ErrorAlert error={excludeState.error} />
              <div className="flex gap-2">
                <SubmitButton variant="secondary" pendingLabel={t("excluding")}>
                  {t("excludeConfirmCta")}
                </SubmitButton>
                <button
                  type="button"
                  onClick={() => setExcluding(false)}
                  className="rounded-control px-3 py-2 text-body text-ink-secondary hover:bg-sunken"
                >
                  {tWs("cancelCta")}
                </button>
              </div>
            </form>
          )}

          {/* Értékelő-panelek (#7b): emberi űrlapok, LLM nélkül */}
          <div className="space-y-2">
            <AiSuitabilityPanel
              projectId={projectId}
              useCaseId={useCase.id}
              current={useCase.evaluators.aiSuitability}
            />
            <DataReadinessPanel
              projectId={projectId}
              useCaseId={useCase.id}
              current={useCase.evaluators.dataReadiness}
            />
            <AiActPanel
              projectId={projectId}
              useCaseId={useCase.id}
              current={useCase.evaluators.aiAct}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── ③ Shortlist-mezők generálása az entitásokból (#7a F4) ────

export function GenerateShortlistFieldsForm({ projectId }: { projectId: string }) {
  const t = useTranslations("entities");
  const [state, formAction] = useActionState(
    generateShortlistFromEntitiesAction.bind(null, projectId),
    initialState,
  );

  return (
    <form action={formAction} className="space-y-2">
      <ErrorAlert error={state.error} />
      <NoticeAlert notice={state.notice} />
      {state.ok && !state.notice && (
        <p className="text-body text-done">{t("shortlistFieldsDone")}</p>
      )}
      {/* Mezők entitásból = döntés-előkészítő generálás → lila (törvény 3) */}
      <SubmitButton pendingLabel={t("generatingShortlist")}>
        {t("generateShortlistCta")}
      </SubmitButton>
      <p className="text-mono-sm text-ink-tertiary">{t("generateShortlistHint")}</p>
    </form>
  );
}

// ── Use case: kézi hozzáadás ─────────────────────────────────

export function AddUseCaseForm({
  projectId,
  painOptions,
}: {
  projectId: string;
  /** Megerősített fájdalompontok, amikre a kézi use case hivatkozhat. */
  painOptions: { id: string; title: string }[];
}) {
  const t = useTranslations("entities");
  const [state, formAction] = useActionState(
    addUseCaseAction.bind(null, projectId),
    initialState,
  );

  return (
    <details className="rounded-tile border border-dashed border-line">
      <summary className="cursor-pointer select-none px-3 py-2 text-body text-ink-secondary hover:text-ink">
        {t("addUseCaseCta")}
      </summary>
      <form action={formAction} className="space-y-2 px-3 pb-3">
        <input
          key={`t${state.nonce ?? 0}`}
          name="title"
          required
          defaultValue={state.values?.title}
          placeholder={t("titlePlaceholder")}
          className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
        />
        <textarea
          key={`d${state.nonce ?? 0}`}
          name="description"
          rows={2}
          defaultValue={state.values?.fieldValue}
          placeholder={t("descriptionPlaceholder")}
          className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
        />
        {painOptions.length > 0 && (
          <fieldset className="space-y-1">
            <legend className="text-mono-sm text-ink-tertiary">
              {t("selectPainsLabel")}
            </legend>
            {painOptions.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-body">
                <input
                  type="checkbox"
                  name="painPointIds"
                  value={p.id}
                  className="accent-[var(--action-primary)]"
                />
                <span className="min-w-0 truncate">{p.title}</span>
              </label>
            ))}
          </fieldset>
        )}
        <ErrorAlert error={state.error} />
        {state.ok && <p className="text-body text-done">{t("added")}</p>}
        <SubmitButton variant="secondary" pendingLabel={t("adding")}>
          {t("addCta")}
        </SubmitButton>
      </form>
    </details>
  );
}

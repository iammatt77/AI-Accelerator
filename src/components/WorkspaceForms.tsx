"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { FormState } from "@/app/actions";
import {
  addPhaseInput,
  confirmFieldAction,
  dismissFieldAction,
  editFieldAction,
  extractAction,
  generateBodyAction,
} from "@/app/artifact-actions";
import type { ArtifactFieldValue } from "@/lib/artifacts/config";
import { FieldStateBadge } from "@/components/FieldStateBadge";
import { SubmitButton } from "@/components/SubmitButton";

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

// Nem-hiba, de LÁTHATÓ jelzés (amber, role=status) — pl. sikeres
// feldolgozás, amely nem adott használható eredményt.
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

// ── ① Bemenet hozzáadása fázis-címkével ──────────────────────

export function PhaseInputForm({
  projectId,
  phase,
}: {
  projectId: string;
  phase: string;
}) {
  const t = useTranslations("workspace");
  const tInputs = useTranslations("inputs");
  const tCommon = useTranslations("common");
  const [state, formAction] = useActionState(
    addPhaseInput.bind(null, projectId, phase),
    initialState,
  );

  return (
    <form action={formAction} className="mt-3 space-y-2">
      {/* key + defaultValue: hibaágon a beírt szöveg nem veszik el */}
      <input
        key={`t${state.nonce ?? 0}`}
        name="title"
        defaultValue={state.values?.title}
        placeholder={t("inputTitlePlaceholder")}
        className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
      />
      <textarea
        key={`r${state.nonce ?? 0}`}
        name="rawText"
        required
        rows={4}
        defaultValue={state.values?.rawText}
        placeholder={tInputs("placeholder")}
        className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
      />
      <ErrorAlert error={state.error} />
      {state.ok && <p className="text-body text-done">{tInputs("saved")}</p>}
      <div className="flex items-center gap-3">
        <SubmitButton variant="secondary" pendingLabel={tCommon("saving")}>
          {tInputs("addCta")}
        </SubmitButton>
        <span className="text-mono-sm text-ink-tertiary">
          {t("inputPhaseTag", { phase })}
        </span>
      </div>
    </form>
  );
}

// ── ② „Feldolgozás (kivonatolás)" ────────────────────────────

export function ExtractForm({
  projectId,
  typeKey,
}: {
  projectId: string;
  typeKey: string;
}) {
  const t = useTranslations("workspace");
  const [state, formAction] = useActionState(
    extractAction.bind(null, projectId, typeKey),
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

// ── ② Mező-javaslat kártya: megerősít / szerkeszt / elvet (E1) ─

export function FieldCard({
  projectId,
  artifactId,
  fieldKey,
  label,
  required,
  field,
  editable,
}: {
  projectId: string;
  artifactId: string;
  fieldKey: string;
  label: string;
  required: boolean;
  field: ArtifactFieldValue;
  editable: boolean;
}) {
  const t = useTranslations("workspace");
  const [editing, setEditing] = useState(false);

  const [confirmState, confirmAction] = useActionState(
    confirmFieldAction.bind(null, projectId, artifactId, fieldKey),
    initialState,
  );
  const [dismissState, dismissAction] = useActionState(
    dismissFieldAction.bind(null, projectId, artifactId, fieldKey),
    initialState,
  );
  const [editState, editFormAction] = useActionState(
    editFieldAction.bind(null, projectId, artifactId, fieldKey),
    initialState,
  );

  const accent =
    field.state === "ai_filled"
      ? "border-l-gate"
      : field.state === "confirmed"
        ? "border-l-done"
        : "border-l-line";

  return (
    <div className={`rounded-tile border border-line border-l-2 ${accent} bg-surface p-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-body font-medium">
          {label}
          <span className="ml-1.5 text-mono-sm font-normal text-ink-tertiary">
            {required ? t("requiredMark") : t("optionalMark")}
          </span>
        </span>
        <FieldStateBadge state={field.state} label={t(`fieldState.${field.state}`)} />
      </div>

      {/* Érték + forrás-jelölés */}
      {!editing && (
        <>
          {field.value ? (
            <p className="mt-2 whitespace-pre-wrap text-body">{field.value}</p>
          ) : (
            <p className="mt-2 text-body text-ink-tertiary">{t("noValue")}</p>
          )}
          <p className="mt-1 text-mono-sm text-ink-tertiary">
            {t("sourcesLabel")}{" "}
            {field.source_indices.length > 0
              ? field.source_indices.map((n) => `[${n}]`).join(" ")
              : t("noSourceMark")}
          </p>
        </>
      )}

      {/* Szerkesztés (→ manual) */}
      {editing && (
        <form action={editFormAction} className="mt-2 space-y-2">
          <textarea
            key={editState.nonce ?? 0}
            name="value"
            required
            rows={3}
            defaultValue={editState.values?.fieldValue ?? field.value ?? ""}
            placeholder={t("fieldValuePlaceholder")}
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
          />
          <ErrorAlert error={editState.error} />
          <div className="flex gap-2">
            <SubmitButton variant="secondary" pendingLabel={t("savingField")}>
              {t("saveCta")}
            </SubmitButton>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-control px-3 py-2 text-body text-ink-secondary hover:bg-sunken"
            >
              {t("cancelCta")}
            </button>
          </div>
        </form>
      )}

      <ErrorAlert error={confirmState.error} />
      <ErrorAlert error={dismissState.error} />

      {/* Akciók — csak draft artefaktumon (E1: megerősítés emberi lépés) */}
      {editable && !editing && (
        <div className="mt-2 flex flex-wrap gap-2">
          {field.state === "ai_filled" && (
            <form action={confirmAction}>
              {/* Megerősítés = döntési pont → lila (törvény 3) */}
              <SubmitButton pendingLabel={t("confirming")}>
                {t("confirmCta")}
              </SubmitButton>
            </form>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-control border border-line bg-surface px-3 py-2 text-body font-medium shadow-tile-sm hover:bg-sunken"
          >
            {t("editCta")}
          </button>
          {field.state !== "missing" && (
            <form action={dismissAction}>
              <SubmitButton variant="ghost" pendingLabel={t("dismissing")}>
                {t("dismissCta")}
              </SubmitButton>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// ── ③ „Draft generálása" ─────────────────────────────────────

export function GenerateBodyForm({
  projectId,
  artifactId,
  hasBody,
}: {
  projectId: string;
  artifactId: string;
  /** Van már body — a generálás FELÜLÍRJA (a kézi szerkesztést is). */
  hasBody: boolean;
}) {
  const t = useTranslations("workspace");
  const [state, formAction] = useActionState(
    generateBodyAction.bind(null, projectId, artifactId),
    initialState,
  );

  return (
    <form action={formAction} className="space-y-2">
      <ErrorAlert error={state.error} />
      {state.ok && <p className="text-body text-done">{t("generated")}</p>}
      {/* Poka-yoke: meglévő (akár kézzel szerkesztett) body felülírása csak
          explicit megerősítéssel — az emberi munka védelme a body-ra is áll. */}
      {hasBody && (
        <label className="flex items-start gap-2 rounded-tile border border-gate/50 bg-surface px-3 py-2 text-body text-gate">
          <input type="checkbox" required className="mt-1 accent-[var(--action-primary)]" />
          <span>
            {t("generateConfirmLabel")}
            <span className="mt-0.5 block text-mono-sm text-ink-tertiary">
              {t("generateOverwriteWarn")}
            </span>
          </span>
        </label>
      )}
      {/* Generálás = döntési pont → lila (törvény 3) */}
      <SubmitButton pendingLabel={t("generating")}>{t("generateCta")}</SubmitButton>
    </form>
  );
}

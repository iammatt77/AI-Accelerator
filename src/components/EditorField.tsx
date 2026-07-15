"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import type { FormState } from "@/app/actions";
import {
  confirmFieldAction,
  dismissFieldAction,
  editFieldAction,
} from "@/app/artifact-actions";
import type { ArtifactFieldValue } from "@/lib/artifacts/config";
import { IconCheck } from "@/components/icons";
import { SubmitButton } from "@/components/SubmitButton";

// ─────────────────────────────────────────────────────────────
// Mező-accordion elem (Master 5 v3): egyszerre EGY mező van nyitva, a
// többi EGYSOROS összefoglaló (státusz + előnézet-részlet). A nyitott
// mező lila keretes kártya: érték (süllyesztett) / üres kötelező →
// szaggatott prompt + „Kézi kitöltés"; E1-akciók (confirm/edit/dismiss)
// a MEGLÉVŐ server actionökkel — csak a megjelenítés v3.
// FLAG: a per-mező „✦ Javaslat (te erősíted meg)" ÚJ server actiont +
// LLM-hívást igényelne — nem építjük csendben.
// ─────────────────────────────────────────────────────────────

const initialState: FormState = { ok: false, error: null };

export function EditorFieldAccordion({
  projectId,
  artifactId,
  fieldKey,
  label,
  required,
  field,
  editable,
  open,
  onToggle,
  customBody,
}: {
  projectId: string;
  artifactId: string;
  fieldKey: string;
  label: string;
  required: boolean;
  field: ArtifactFieldValue;
  editable: boolean;
  open: boolean;
  onToggle: () => void;
  /** P2 (#9): strukturált mező-törzs (kalkulátor / sikerdefiníció) a sima
   *  textarea helyett — a nyitott kártya body-jában. */
  customBody?: React.ReactNode;
}) {
  const t = useTranslations("editor");
  const tWs = useTranslations("workspace");
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

  const hasValue = Boolean(field.value);
  const confirmed = field.state === "confirmed" || field.state === "manual";
  const emptyRequired = required && !hasValue;

  const statusPill = confirmed ? (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-tint-done px-2.5 py-[3px] text-[11px] font-semibold text-done-text">
      <IconCheck size={8} />
      {tWs("fieldState.confirmed")}
    </span>
  ) : field.state === "ai_filled" ? (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-tint-gate px-2.5 py-[3px] text-[11px] font-semibold text-gate-text">
      <span aria-hidden>•</span>
      {tWs("fieldState.ai_filled")}
    </span>
  ) : null;

  const reqTag = required ? (
    <span className="shrink-0 rounded-3 bg-tint-gate px-1.5 py-px font-mono text-[9.5px] font-bold text-gate-text">
      {t("requiredTag")}
    </span>
  ) : (
    <span className="shrink-0 rounded-3 bg-neutral-150 px-1.5 py-px font-mono text-[9.5px] font-semibold text-ink-tertiary">
      {t("optionalTag")}
    </span>
  );

  // ── Csukott egysoros összefoglaló ──
  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={false}
        className={`flex w-full items-center gap-2.5 rounded-shell px-4 py-[13px] text-left ${
          emptyRequired
            ? "border-[1.5px] border-dashed border-gate bg-[var(--tint-gate-band)]"
            : !hasValue
              ? "border-[1.5px] border-dashed border-neutral-400 bg-soft"
              : "border border-line bg-surface shadow-card-sm hover:bg-neutral-50"
        }`}
      >
        <span aria-hidden className="shrink-0 text-ink-tertiary">
          ›
        </span>
        <span
          className={`shrink-0 text-[13.5px] font-bold ${emptyRequired ? "text-gate-text" : !hasValue ? "text-ink-secondary" : ""}`}
        >
          {label}
        </span>
        {reqTag}
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-tertiary">
          {hasValue ? field.value : emptyRequired ? t("emptyRequiredHint") : t("emptyOptionalHint")}
        </span>
        {statusPill}
      </button>
    );
  }

  // ── Nyitott kártya ──
  return (
    <div
      id={`fld-${fieldKey}`}
      className="scroll-mt-4 overflow-hidden rounded-shell border-[1.5px] border-action-light bg-surface shadow-accent"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded
        className="flex w-full items-center gap-2.5 border-b border-neutral-100 bg-context px-4 py-3 text-left"
      >
        <span aria-hidden className="shrink-0 rotate-90 text-action">
          ›
        </span>
        <span className="text-[14px] font-bold">{label}</span>
        {reqTag}
        <span className="ml-auto" />
        {statusPill}
      </button>

      {customBody ? (
        <div className="p-4">{customBody}</div>
      ) : (
      <div className="space-y-3 p-4">
        {editing ? (
          <form action={editFormAction} className="space-y-2">
            <textarea
              key={editState.nonce ?? 0}
              name="value"
              required
              rows={4}
              defaultValue={editState.values?.fieldValue ?? field.value ?? ""}
              placeholder={tWs("fieldValuePlaceholder")}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
            />
            {editState.error && (
              <p role="alert" className="text-mono-sm text-danger">
                {editState.error}
              </p>
            )}
            <div className="flex gap-2">
              <SubmitButton variant="secondary" pendingLabel={tWs("savingField")}>
                {tWs("saveCta")}
              </SubmitButton>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-control px-3 py-1.5 text-body text-ink-secondary hover:bg-sunken"
              >
                {tWs("cancelCta")}
              </button>
            </div>
          </form>
        ) : emptyRequired || !hasValue ? (
          <div
            className={`flex flex-wrap items-center gap-3 rounded-tile border-[1.5px] border-dashed px-4 py-3.5 ${
              emptyRequired
                ? "border-gate bg-[var(--tint-gate-band)]"
                : "border-neutral-400 bg-soft"
            }`}
          >
            <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink-tertiary">
              {t("fillPrompt", { field: label })}
            </p>
            {editable && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="shrink-0 rounded-control border border-neutral-350 bg-surface px-3 py-1.5 text-[12px] font-semibold hover:bg-neutral-50"
              >
                {t("writeManually")}
              </button>
            )}
          </div>
        ) : (
          <div className="card-sunken px-4 py-3.5">
            <p className="whitespace-pre-wrap text-body text-ink">{field.value}</p>
            <p className="mt-1.5 font-mono text-mono-sm text-ink-tertiary">
              {tWs("sourcesLabel")}{" "}
              {field.source_indices.length > 0
                ? field.source_indices.map((n) => `[${n}]`).join(" ")
                : tWs("noSourceMark")}
            </p>
          </div>
        )}

        {editable && !editing && hasValue && (
          <div className="flex flex-wrap gap-2">
            {field.state === "ai_filled" && (
              <form action={confirmAction}>
                <SubmitButton pendingLabel={tWs("confirming")}>{tWs("confirmCta")}</SubmitButton>
              </form>
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-control border border-neutral-350 bg-surface px-3 py-1.5 text-body font-medium hover:bg-neutral-50"
            >
              {tWs("editCta")}
            </button>
            <form action={dismissAction}>
              <SubmitButton variant="ghost" pendingLabel={tWs("dismissing")}>
                {tWs("dismissCta")}
              </SubmitButton>
            </form>
          </div>
        )}
        {(confirmState.error || dismissState.error) && (
          <p role="alert" className="text-mono-sm text-danger">
            {confirmState.error ?? dismissState.error}
          </p>
        )}
      </div>
      )}
    </div>
  );
}

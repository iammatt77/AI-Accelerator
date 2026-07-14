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
import { SubmitButton } from "@/components/SubmitButton";

// ─────────────────────────────────────────────────────────────
// Dokumentum-mező szekció a szerkesztő KÖZÉPSŐ oszlopában (v2 ref):
//   fejléc = cím + státusz-szó (✓ kész / kötelező · üres / …)
//   törzs  = kitöltött → süllyesztett érték-doboz; üres kötelező (draft) →
//            szaggatott borostyán doboz prompttal + „Kézi kitöltés"
//   E1-akciók (draft) kompakt sorban. A server actionök a MEGLÉVŐK
//   (confirm/edit/dismissFieldAction) — csak a megjelenítés a v2 szerinti.
// ─────────────────────────────────────────────────────────────

const initialState: FormState = { ok: false, error: null };

export function EditorField({
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
  const emptyRequired = required && !hasValue;
  const confirmed = field.state === "confirmed" || field.state === "manual";
  const statusWord = confirmed
    ? { text: t("fieldComplete"), cls: "text-done" }
    : field.state === "ai_filled"
      ? { text: t("fieldAiConfirm"), cls: "text-gate" }
      : emptyRequired
        ? { text: t("fieldRequiredEmpty"), cls: "text-gate" }
        : { text: t("optionalShort"), cls: "text-ink-tertiary" };

  return (
    <div id={`fld-${fieldKey}`} className="scroll-mt-4">
      <div className="mb-2 flex items-center gap-2">
        <span className={`text-body font-bold ${emptyRequired ? "text-gate" : "text-ink"}`}>
          {label}
        </span>
        <span className={`font-mono text-mono-sm font-bold ${statusWord.cls}`}>
          {statusWord.text}
        </span>
      </div>

      {editing ? (
        <form action={editFormAction} className="space-y-2">
          <textarea
            key={editState.nonce ?? 0}
            name="value"
            required
            rows={3}
            defaultValue={editState.values?.fieldValue ?? field.value ?? ""}
            placeholder={tWs("fieldValuePlaceholder")}
            className="w-full rounded-tile border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
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
      ) : emptyRequired && editable ? (
        // v2: szaggatott borostyán üres-kötelező doboz — a hiányzó feltétel a
        // döntési ponton. („Draft a suggestion" per-mező AI = külön backend, FLAG.)
        <div className="flex flex-wrap items-center gap-3 rounded-tile border-[1.5px] border-dashed border-gate bg-tint-gate/40 px-4 py-3.5">
          <p className="min-w-0 flex-1 text-body text-ink-tertiary">
            {t("fillPrompt", { field: label })}
          </p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 rounded-control border border-line bg-surface px-3 py-1.5 text-body font-semibold shadow-tile-sm hover:bg-sunken"
          >
            {t("writeManually")}
          </button>
        </div>
      ) : (
        // Öröklött/olvasó tartalom → süllyesztett (6. törvény)
        <div className="card-sunken px-4 py-3.5">
          {hasValue ? (
            <p className="whitespace-pre-wrap text-body text-ink">{field.value}</p>
          ) : (
            <p className="text-body text-ink-tertiary">{tWs("noValue")}</p>
          )}
          <p className="mt-1.5 font-mono text-mono-sm text-ink-tertiary">
            {tWs("sourcesLabel")}{" "}
            {field.source_indices.length > 0
              ? field.source_indices.map((n) => `[${n}]`).join(" ")
              : tWs("noSourceMark")}
          </p>
        </div>
      )}

      {editable && !editing && !emptyRequired && (
        <div className="mt-2 flex flex-wrap gap-2">
          {field.state === "ai_filled" && (
            <form action={confirmAction}>
              <SubmitButton pendingLabel={tWs("confirming")}>{tWs("confirmCta")}</SubmitButton>
            </form>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-control border border-line bg-surface px-3 py-1.5 text-body font-medium shadow-tile-sm hover:bg-sunken"
          >
            {tWs("editCta")}
          </button>
          {field.state !== "missing" && (
            <form action={dismissAction}>
              <SubmitButton variant="ghost" pendingLabel={tWs("dismissing")}>
                {tWs("dismissCta")}
              </SubmitButton>
            </form>
          )}
        </div>
      )}
      {(confirmState.error || dismissState.error) && (
        <p role="alert" className="mt-1 text-mono-sm text-danger">
          {confirmState.error ?? dismissState.error}
        </p>
      )}
    </div>
  );
}

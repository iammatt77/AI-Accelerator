"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { generateDraftAction, type FormState } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";

const initialState: FormState = { ok: false, error: null };

// (c) "Draft generálása" — a kétlépéses flow (bemenet → külön generálás)
// SZÁNDÉKOS és megmarad; a gomb mindig engedélyezett. A hiba LÁTHATÓ,
// kezelt üzenet (role="alert").
export function GenerateForm({
  projectId,
  inputsCount,
  artifactsCount,
}: {
  projectId: string;
  inputsCount: number;
  artifactsCount: number;
}) {
  const t = useTranslations("cockpit");
  const [state, formAction] = useActionState(
    generateDraftAction.bind(null, projectId),
    initialState,
  );
  const hasInput = inputsCount > 0;

  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-body text-ink-secondary">
          {t("counts", { inputs: inputsCount, artifacts: artifactsCount })}
        </span>
        <form action={formAction} className="flex items-center gap-3">
          {/* Opcionális vizuális segítség — NEM tiltja/blokkolja a gombot. */}
          {!hasInput && !state.error && (
            <span className="text-mono-sm text-ink-tertiary">
              {t("addInputFirst")}
            </span>
          )}
          <SubmitButton pendingLabel={t("generating")}>
            {t("generateCta")}
          </SubmitButton>
        </form>
      </div>

      {state.error && (
        <p
          role="alert"
          className="rounded-tile border border-danger/40 bg-danger/10 px-3 py-2 text-body text-danger"
        >
          {state.error}
        </p>
      )}
      {state.ok && <p className="text-body text-done">{t("generated")}</p>}
    </div>
  );
}

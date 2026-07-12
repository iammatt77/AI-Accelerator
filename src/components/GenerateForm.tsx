"use client";

import { useActionState } from "react";
import { generateDraftAction, type FormState } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";

const initialState: FormState = { ok: false, error: null };

// (c) "Draft generálása" — a kétlépéses flow (bemenet → külön generálás)
// SZÁNDÉKOS és megmarad; a gomb mindig engedélyezett. A hiba mostantól
// LÁTHATÓ, kezelt üzenet (role="alert"), nem Next.js "Uncaught Error".
export function GenerateForm({
  projectId,
  inputsCount,
  artifactsCount,
}: {
  projectId: string;
  inputsCount: number;
  artifactsCount: number;
}) {
  const [state, formAction] = useActionState(
    generateDraftAction.bind(null, projectId),
    initialState,
  );
  const hasInput = inputsCount > 0;

  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-body text-ink-secondary">
          {inputsCount} bemenet · {artifactsCount} artefaktum
        </span>
        <form action={formAction} className="flex items-center gap-3">
          {/* Opcionális vizuális segítség — NEM tiltja/blokkolja a gombot. */}
          {!hasInput && !state.error && (
            <span className="text-mono-sm text-ink-tertiary">
              Előbb adj hozzá bemenetet fentebb
            </span>
          )}
          <SubmitButton pendingLabel="Generálás élő API-val…">
            Draft generálása
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
      {state.ok && <p className="text-body text-done">Draft elkészült.</p>}
    </div>
  );
}

"use client";

import { useActionState } from "react";
import { addInput, type FormState } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";

const initialState: FormState = { ok: false, error: null };

// (b) Nyers szöveg beillesztése — LÁTHATÓ hibakezeléssel.
// A sikertelen mentés többé nem némán 500-zik: a Supabase valódi hibaüzenete
// (message + code + details + hint) itt jelenik meg a felhasználónak.
export function InputForm({ projectId }: { projectId: string }) {
  const [state, formAction] = useActionState(
    addInput.bind(null, projectId),
    initialState,
  );

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <textarea
        name="rawText"
        required
        rows={4}
        placeholder="Illeszd be a nyers ügyfélanyagot…"
        className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
      />

      {state.error && (
        <p
          role="alert"
          className="rounded-tile border border-danger/40 bg-danger/10 px-3 py-2 text-body text-danger"
        >
          {state.error}
        </p>
      )}
      {state.ok && <p className="text-body text-done">Bemenet elmentve.</p>}

      <SubmitButton variant="secondary" pendingLabel="Mentés…">
        Bemenet hozzáadása
      </SubmitButton>
    </form>
  );
}

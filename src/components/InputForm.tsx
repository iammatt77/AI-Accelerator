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
        className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
      />

      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
        >
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="text-sm text-green-600 dark:text-green-400">
          Bemenet elmentve.
        </p>
      )}

      <SubmitButton variant="secondary" pendingLabel="Mentés…">
        Bemenet hozzáadása
      </SubmitButton>
    </form>
  );
}

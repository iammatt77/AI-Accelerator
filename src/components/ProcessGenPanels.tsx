"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { generateProcessMapAction, suggestToBeAction } from "@/app/process-actions";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "@/app/actions";

// ─────────────────────────────────────────────────────────────
// Folyamattérkép — generálás-belépők (#10, Fázis 3). E1: az AI JAVASOL
// (draft), az ember korrigál/hagy jóvá. Három belépő:
//   · AS-IS leiratból (input-választó)
//   · TO-BE dokumentumból (input-választó)
//   · TO-BE AI-javasolt (a legfrissebb AS-IS + fájdalompontok alapján)
// ─────────────────────────────────────────────────────────────

const INITIAL: FormState = { ok: true, error: null };

function Feedback({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p className="mt-2 rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="mt-2 rounded-control border border-tint-gate-border bg-tint-gate px-3 py-2 text-[12px] text-gate-text">
        {state.notice}
      </p>
    );
  }
  return null;
}

export function GenerateFromInputPanel({
  projectId,
  kind,
  inputs,
}: {
  projectId: string;
  kind: "as_is" | "to_be";
  inputs: { id: string; label: string }[];
}) {
  const t = useTranslations("processMap");
  const [state, formAction] = useActionState(
    async (prev: FormState, formData: FormData) => {
      const inputId = String(formData.get("inputId") ?? "");
      if (!inputId) return { ok: false, error: t("errPickInput") };
      return generateProcessMapAction(projectId, inputId, kind, prev, formData);
    },
    INITIAL,
  );
  return (
    <form action={formAction} className="space-y-2.5">
      <label className="block">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
          {t("pickInputLabel")}
        </span>
        <select
          name="inputId"
          defaultValue={inputs[0]?.id ?? ""}
          className="mt-1 w-full rounded-control border border-line bg-surface px-3 py-2 text-body"
        >
          {inputs.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </select>
      </label>
      <SubmitButton pendingLabel={t("generating")}>
        {kind === "as_is" ? t("generateAsisCta") : t("generateTobeDocCta")} ✦
      </SubmitButton>
      <Feedback state={state} />
    </form>
  );
}

export function SuggestToBePanel({
  projectId,
  asIsMapId,
}: {
  projectId: string;
  asIsMapId: string;
}) {
  const t = useTranslations("processMap");
  const [state, formAction] = useActionState(
    suggestToBeAction.bind(null, projectId, asIsMapId),
    INITIAL,
  );
  return (
    <form action={formAction}>
      <SubmitButton pendingLabel={t("generating")}>{t("suggestTobeCta")} ✦</SubmitButton>
      <Feedback state={state} />
    </form>
  );
}

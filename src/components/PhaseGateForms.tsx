"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { startPhase, closeGate } from "@/app/phase-actions";
import type { FormState } from "@/app/actions";
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

// „Fázis indítása" — open → in_progress (a szerver validál).
export function StartPhaseForm({
  projectId,
  phase,
}: {
  projectId: string;
  phase: string;
}) {
  const t = useTranslations("gates");
  const [state, formAction] = useActionState(
    startPhase.bind(null, projectId, phase),
    initialState,
  );

  return (
    <form action={formAction} className="space-y-3">
      <ErrorAlert error={state.error} />
      <SubmitButton pendingLabel={t("starting")}>{t("startPhaseCta")}</SubmitButton>
    </form>
  );
}

// „Kapu lezárása" — kötelező indoklás + megerősítő jelölő; ideiglenes-kézi
// fázisnál vizuálisan megkülönböztetve (szaggatott keret + badge).
export function GateCloseForm({
  projectId,
  phase,
  temporary,
}: {
  projectId: string;
  phase: string;
  temporary: boolean;
}) {
  const t = useTranslations("gates");
  const [state, formAction] = useActionState(
    closeGate.bind(null, projectId, phase),
    initialState,
  );

  return (
    <form
      action={formAction}
      className={`space-y-3 rounded-tile p-3 ${
        temporary ? "border border-dashed border-gate/60" : "border border-line"
      }`}
    >
      {temporary && (
        <div className="flex items-center gap-2">
          <span className="rounded-pill border border-dashed border-gate/60 px-2 py-0.5 text-mono-sm font-sans font-medium text-gate">
            {t("temporaryBadge")}
          </span>
          <span className="text-mono-sm text-ink-tertiary">{t("temporaryHint")}</span>
        </div>
      )}

      <label className="block">
        <span className="text-mono-sm font-medium text-ink-secondary">
          {t("reasonLabel")}
        </span>
        {/* key + defaultValue: hibaágon a beírt indoklás nem veszik el
            (React 19 minden beküldés után reseteli a nem kontrollált mezőt).
            A megerősítő jelölőt szándékosan NEM állítjuk vissza: hiba után
            újra meg kell erősíteni a zárást (poka-yoke). */}
        <textarea
          key={state.nonce ?? 0}
          name="reason"
          required
          rows={3}
          defaultValue={state.values?.reason}
          placeholder={t("reasonPlaceholder")}
          className="mt-1 w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
        />
      </label>

      {/* Megerősítés — a zárás döntési pont (lila CTA, törvény 3 szerint). */}
      <label className="flex items-start gap-2 text-body">
        <input type="checkbox" required className="mt-1 accent-[var(--action-primary)]" />
        <span>
          {t("confirmLabel")}
          <span className="mt-0.5 block text-mono-sm text-ink-tertiary">
            {t("confirmHint")}
          </span>
        </span>
      </label>

      <ErrorAlert error={state.error} />

      <SubmitButton pendingLabel={t("closing")}>{t("closeGateCta")}</SubmitButton>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { FormState } from "@/app/actions";
import { ackStalenessAction } from "@/app/staleness-actions";
import type { StaleKind } from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Elavulás-jelvény (Csomag A, A8) — minimál badge: borostyán pill a jelölő
// fajtájával + beépített „Ellenőrizve" akció. A jelölő DERIVÁLT (a szerver
// számítja időbélyeg-összevetésből); az ack a stale_acks-be íródik, és a
// nyugta utáni ÚJABB változás automatikusan újra jelöl.
// ─────────────────────────────────────────────────────────────

const initialState: FormState = { ok: false, error: null };

export function StaleFlag({
  projectId,
  subjectType,
  subjectId,
  kind,
  dateLabel,
}: {
  projectId: string;
  subjectType: string;
  subjectId: string;
  kind: StaleKind;
  /** A kiváltó változás formázott dátuma (opcionális kijelzés). */
  dateLabel?: string | null;
}) {
  const t = useTranslations("stale");
  const [state, ackAction] = useActionState(
    ackStalenessAction.bind(null, projectId, subjectType, subjectId, kind),
    initialState,
  );

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 rounded-pill border border-tint-gate-border bg-tint-gate px-2 py-[3px]">
      <span aria-hidden className="text-[10px] text-gate-text">
        ⟳
      </span>
      <span className="text-[11px] font-semibold text-gate-text">
        {t(kind)}
        {dateLabel ? ` · ${dateLabel}` : ""}
      </span>
      <form action={ackAction} className="inline-flex">
        <button
          type="submit"
          className="rounded-3 border border-tint-gate-border bg-surface px-1.5 py-px text-[10.5px] font-bold text-gate-text hover:bg-neutral-50"
        >
          {t("ackCta")}
        </button>
      </form>
      {state.error && (
        <span role="alert" className="text-[10.5px] text-danger">
          {state.error}
        </span>
      )}
    </span>
  );
}

"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { approveProcessMapAction, newIterationAction } from "@/app/process-actions";
import type { FormState } from "@/app/actions";
import type { ArtifactStatus } from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Egyben-jóváhagyás / új iteráció (#10, Fázis 5) — a viewer approveSlot-ja.
// Draft: „Folyamat jóváhagyása" (az EMBER zárja a verziót — HITL);
// approved: „Új iteráció" (v+1 draft-másolat friss diff-alappal).
// ─────────────────────────────────────────────────────────────

const INITIAL: FormState = { ok: true, error: null };

export function ProcessApprovePanel({
  projectId,
  mapId,
  status,
}: {
  projectId: string;
  mapId: string;
  status: ArtifactStatus;
}) {
  const t = useTranslations("processMap");
  const [approveState, approveAction, approvePending] = useActionState(
    approveProcessMapAction.bind(null, projectId, mapId),
    INITIAL,
  );
  const [iterState, iterAction, iterPending] = useActionState(
    newIterationAction.bind(null, projectId, mapId),
    INITIAL,
  );
  const error = approveState.error ?? iterState.error;

  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-[11.5px] text-danger">{error}</span>}
      {status === "approved" ? (
        <form action={iterAction}>
          <button
            type="submit"
            disabled={iterPending}
            className="rounded-control border border-action bg-surface px-3 py-1.5 text-[12px] font-semibold text-action-deep hover:bg-accent-tint disabled:opacity-60"
          >
            {iterPending ? t("iterating") : t("newIterationBtn")}
          </button>
        </form>
      ) : (
        <form action={approveAction}>
          <button
            type="submit"
            disabled={approvePending}
            className="rounded-control bg-done px-3.5 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {approvePending ? t("approving") : `✓ ${t("approveBtn")}`}
          </button>
        </form>
      )}
    </span>
  );
}

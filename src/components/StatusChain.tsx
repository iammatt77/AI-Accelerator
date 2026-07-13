"use client";

import { useEffect } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { FormState } from "@/app/actions";
import {
  approveArtifactAction,
  backToDraftAction,
  newVersionAction,
  sendToReviewAction,
} from "@/app/artifact-actions";
import type { ArtifactStatus } from "@/lib/db/types";
import { SubmitButton } from "@/components/SubmitButton";

// ─────────────────────────────────────────────────────────────
// Státusz-lánc panel (C melléklet): Draft → „Review-ra küldés" →
// In review → „Approve" (primary) | „Vissza draftba" (secondary) →
// Approved → „Új verzió". A lánc nem átugorható — a szerver validál.
// Approve-megerősítő: hiányzó kötelező mező → kemény blokk (szerver,
// hibalistával); ai_filled mező → borostyán figyelmeztetés (nem blokkol).
// ─────────────────────────────────────────────────────────────

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

export function StatusChain({
  projectId,
  artifactId,
  status,
  missingRequiredLabels,
  unconfirmedLabels,
}: {
  projectId: string;
  artifactId: string;
  status: ArtifactStatus;
  missingRequiredLabels: string[];
  unconfirmedLabels: string[];
}) {
  const t = useTranslations("chain");
  const router = useRouter();

  const [reviewState, reviewAction] = useActionState(
    sendToReviewAction.bind(null, projectId, artifactId),
    initialState,
  );
  const [backState, backAction] = useActionState(
    backToDraftAction.bind(null, projectId, artifactId),
    initialState,
  );
  const [approveState, approveAction] = useActionState(
    approveArtifactAction.bind(null, projectId, artifactId),
    initialState,
  );
  const [versionState, versionAction] = useActionState(
    newVersionAction.bind(null, projectId, artifactId),
    initialState as FormState & { newArtifactId?: string },
  );

  // Sikeres „Új verzió" → az új draft szerkesztőjébe navigálunk.
  useEffect(() => {
    if (versionState.ok && versionState.newArtifactId) {
      router.push(`/project/${projectId}/artifact/${versionState.newArtifactId}`);
    }
  }, [versionState.ok, versionState.newArtifactId, projectId, router]);

  return (
    <section className="glass-tile p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-body font-semibold">{t("title")}</h2>
        <span className="text-mono-sm text-ink-tertiary">{t("chainHint")}</span>
      </div>

      {/* ── Draft: Review-ra küldés ── */}
      {status === "draft" && (
        <form action={reviewAction} className="mt-3 space-y-2">
          <ErrorAlert error={reviewState.error} />
          <SubmitButton variant="secondary" pendingLabel={t("sending")}>
            {t("sendToReview")}
          </SubmitButton>
        </form>
      )}

      {/* ── In review: Approve (döntési pont) + Vissza draftba ── */}
      {status === "in_review" && (
        <div className="mt-3 space-y-3">
          {/* Poka-yoke előjelzés: hiányzó kötelezők (a szerver keményen blokkol) */}
          {missingRequiredLabels.length > 0 && (
            <div
              role="alert"
              className="rounded-tile border border-danger/40 bg-danger/10 px-3 py-2 text-body text-danger"
            >
              <p className="font-medium">{t("missingBlockTitle")}</p>
              <p className="mt-0.5">{missingRequiredLabels.join(", ")}</p>
            </div>
          )}
          {/* Borostyán figyelmeztetés: nem megerősített mezők (NEM blokkol) */}
          {unconfirmedLabels.length > 0 && (
            <div className="rounded-tile border border-gate/50 bg-surface px-3 py-2 text-body text-gate">
              <p className="font-medium">{t("unconfirmedWarnTitle")}</p>
              <p className="mt-0.5">{unconfirmedLabels.join(", ")}</p>
            </div>
          )}

          <form action={approveAction} className="space-y-3">
            {/* Megerősítő jelölő — az Approve a lánc döntési pontja */}
            <label className="flex items-start gap-2 text-body">
              <input
                type="checkbox"
                required
                className="mt-1 accent-[var(--action-primary)]"
              />
              <span>
                {t("confirmLabel")}
                <span className="mt-0.5 block text-mono-sm text-ink-tertiary">
                  {t("confirmHint")}
                </span>
              </span>
            </label>
            <ErrorAlert error={approveState.error} />
            {/* Lila primary — törvény 3 szerinti döntési pont */}
            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton pendingLabel={t("approving")}>
                {t("approveCta")}
              </SubmitButton>
            </div>
          </form>

          <form action={backAction} className="border-t border-line pt-3">
            <ErrorAlert error={backState.error} />
            <SubmitButton variant="secondary" pendingLabel={t("reverting")}>
              {t("backToDraft")}
            </SubmitButton>
          </form>
        </div>
      )}

      {/* ── Approved: Új verzió ── */}
      {status === "approved" && (
        <form action={versionAction} className="mt-3 space-y-2">
          <p className="text-mono-sm text-ink-tertiary">{t("newVersionHint")}</p>
          <ErrorAlert error={versionState.error} />
          <SubmitButton variant="secondary" pendingLabel={t("creatingVersion")}>
            {t("newVersionCta")}
          </SubmitButton>
        </form>
      )}
    </section>
  );
}

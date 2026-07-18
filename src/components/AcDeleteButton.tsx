"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { deleteAcAction } from "@/app/requirements-actions";
import type { FormState } from "@/app/actions";

const INITIAL: FormState = { ok: true, error: null };

// Az AI-generált vagy kézi AC törlése (HITL — az ember elveti). Az AC a
// requirementen él, ezért itt törölhető; a kötött story-k a közös AC-n át
// automatikusan követik.
export function AcDeleteButton({
  projectId,
  reqId,
  acId,
}: {
  projectId: string;
  reqId: string;
  acId: string;
}) {
  const t = useTranslations("requirements");
  const [, action, pending] = useActionState(
    deleteAcAction.bind(null, projectId, reqId, acId),
    INITIAL,
  );
  return (
    <form action={action}>
      <button
        type="submit"
        disabled={pending}
        title={t("acDeleteCta")}
        aria-label={t("acDeleteCta")}
        className="rounded-3 border border-neutral-350 bg-surface px-1.5 py-px font-mono text-[9px] font-bold text-ink-tertiary hover:border-danger hover:text-danger disabled:opacity-60"
      >
        ✕
      </button>
    </form>
  );
}

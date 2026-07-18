"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  addStakeholderLinkAction,
  removeStakeholderLinkAction,
} from "@/app/requirements-actions";
import type { FormState } from "@/app/actions";
import type { StakeholderRow } from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Stakeholder-kötés kézi szerkesztése a stakeholder requirement részletén
// (#11-fix): a generálás a c-minta szerint üresen hagyja, ahol nincs
// egyértelmű alap — itt a tanácsadó utólag hozzáköthet vagy leválaszthat
// egy projekt-stakeholdert. A kötés OPCIONÁLIS: a hiánya semmit nem blokkol.
// ─────────────────────────────────────────────────────────────

const INITIAL: FormState = { ok: true, error: null };

function UnbindButton({
  projectId,
  reqId,
  stakeholderId,
  name,
}: {
  projectId: string;
  reqId: string;
  stakeholderId: string;
  name: string;
}) {
  const t = useTranslations("requirements");
  const [, action, pending] = useActionState(
    removeStakeholderLinkAction.bind(null, projectId, reqId, stakeholderId),
    INITIAL,
  );
  return (
    <form action={action}>
      <button
        type="submit"
        disabled={pending}
        aria-label={t("shUnbind", { name })}
        className="flex items-center gap-1 rounded-pill border border-neutral-350 bg-sunken px-2 py-0.5 font-mono text-[9px] text-ink-secondary hover:border-danger hover:text-danger disabled:opacity-60"
      >
        👤 {name} ✕
      </button>
    </form>
  );
}

export function StakeholderLinkEditor({
  projectId,
  reqId,
  bound,
  available,
}: {
  projectId: string;
  reqId: string;
  bound: StakeholderRow[];
  available: StakeholderRow[];
}) {
  const t = useTranslations("requirements");
  const [addState, addAction, addPending] = useActionState(
    addStakeholderLinkAction.bind(null, projectId, reqId),
    INITIAL,
  );

  return (
    <div>
      <div className="mb-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
        {t("stakeholderSection")}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {bound.length === 0 && (
          <span className="text-[11.5px] text-ink-tertiary">{t("shNone")}</span>
        )}
        {bound.map((s) => (
          <UnbindButton key={s.id} projectId={projectId} reqId={reqId} stakeholderId={s.id} name={s.name} />
        ))}
      </div>
      {available.length > 0 && (
        <form action={addAction} className="mt-2 flex items-center gap-1.5">
          <select
            name="stakeholderId"
            defaultValue=""
            className="min-w-0 flex-1 rounded-4 border border-neutral-350 bg-surface px-2 py-1.5 text-[12px]"
          >
            <option value="" disabled>
              {t("shAddPlaceholder")}
            </option>
            {available.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.title ? ` · ${s.title}` : ""}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={addPending}
            className="shrink-0 rounded-control border border-neutral-350 bg-surface px-2.5 py-1.5 text-[12px] font-semibold text-ink-secondary hover:bg-soft disabled:opacity-60"
          >
            + {t("shBind")}
          </button>
        </form>
      )}
      {addState.error && <p className="mt-1.5 text-[11.5px] text-danger">{addState.error}</p>}
    </div>
  );
}

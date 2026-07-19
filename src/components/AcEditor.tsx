"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { addAcAction, generateAcAction } from "@/app/requirements-actions";
import type { FormState } from "@/app/actions";

// ─────────────────────────────────────────────────────────────
// AC-szerkesztő (#11, javítva) — az AC a REQUIREMENTEN él (közös AC).
// ✦ AC-vázlat: a javasolt Given–When–Then AC-ket KÖZVETLENÜL perzisztálja
// (server action → acceptance_criteria + revalidate), így kilépés/vissza-
// lépés után is megmaradnak (a korábbi bug: csak kliens-state volt). HITL:
// az AC a követelmény szövegéből származik, és az ember bármelyiket törölheti.
// „+ Új AC": kézi felvétel.
// ─────────────────────────────────────────────────────────────

const INITIAL: FormState = { ok: true, error: null };

export function AcEditor({ projectId, reqId }: { projectId: string; reqId: string }) {
  const t = useTranslations("requirements");
  const [open, setOpen] = useState(false);

  const [addState, addAction, addPending] = useActionState(
    addAcAction.bind(null, projectId, reqId),
    INITIAL,
  );
  const [genState, genAction, genPending] = useActionState(
    generateAcAction.bind(null, projectId, reqId),
    INITIAL,
  );
  // Sikeres kézi mentés után zárjuk az űrlapot (a mezők nem-kontrolláltak,
  // a form natívan resetel — a friss AC a revalidate-tel jön vissza).
  useEffect(() => {
    if (addState.ok && addState.error === null && addState !== INITIAL) setOpen(false);
  }, [addState]);

  return (
    <div className="mt-3">
      {!open && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-control border border-neutral-350 bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-secondary hover:bg-soft"
          >
            + {t("acAddCta")}
          </button>
          <form action={genAction}>
            <button
              type="submit"
              disabled={genPending}
              className="rounded-control border border-[#B9CCF7] bg-surface px-3 py-1.5 text-[12px] font-semibold text-action-deep hover:bg-accent-tint disabled:opacity-60"
            >
              {genPending ? t("generating") : `✦ ${t("acDraftCta")}`}
            </button>
          </form>
          <span className="text-[10.5px] text-ink-tertiary">{t("acHitlNote")}</span>
        </div>
      )}
      {(genState.error || genState.notice) && (
        <p className={`mt-2 text-[12px] ${genState.error ? "text-danger" : "text-gate-text"}`}>
          {genState.error ?? genState.notice}
        </p>
      )}

      {open && (
        <form action={addAction} className="mt-2.5 flex flex-col gap-2.5 rounded-tile border border-line bg-surface p-3.5">
          <input
            name="title"
            placeholder={t("acTitlePlaceholder")}
            className="rounded-4 border border-neutral-350 px-2.5 py-1.5 text-[12.5px] font-semibold outline-none focus:border-action"
          />
          {(
            [
              ["GIVEN", "border-[#C7DEEF] bg-tint-sky text-pivot", "given"],
              ["WHEN", "border-[#CBD9F9] bg-tint-action text-action-deep", "when"],
              ["THEN", "border-[#CDE7DA] bg-tint-done text-done-text", "then"],
            ] as const
          ).map(([kw, cls, name]) => (
            <div key={kw} className="flex items-start gap-2.5">
              <span className={`min-w-[52px] shrink-0 rounded-4 border px-2 py-0.5 text-center font-mono text-[10px] font-bold ${cls}`}>
                {kw}
              </span>
              <input
                name={name}
                required
                className="min-w-0 flex-1 rounded-4 border border-neutral-350 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-action"
              />
            </div>
          ))}
          {addState.error && <p className="text-[12px] text-danger">{addState.error}</p>}
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 text-[10.5px] text-ink-tertiary">{t("acSharedFormNote")}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-control border border-neutral-350 bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-secondary"
            >
              {t("cancelCta")}
            </button>
            <button
              type="submit"
              disabled={addPending}
              className="rounded-control bg-action px-3.5 py-1.5 text-[12px] font-bold text-white disabled:opacity-60"
            >
              {addPending ? t("saving") : t("saveCta")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

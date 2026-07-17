"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  addAcAction,
  suggestAcDraftAction,
  type AcDraftState,
} from "@/app/requirements-actions";
import type { AcDraft } from "@/lib/requirements/parse";
import type { FormState } from "@/app/actions";

// ─────────────────────────────────────────────────────────────
// AC-szerkesztő (#11) — az AC a REQUIREMENTEN él (közös AC). Az ✦
// AC-vázlat kitölti az űrlapot (HITL: az ember szerkeszti és MENT — az
// AI sosem ír közvetlenül AC-t).
// ─────────────────────────────────────────────────────────────

const INITIAL: FormState = { ok: true, error: null };
const DRAFT_INITIAL: AcDraftState = { ok: true, error: null, drafts: null };

export function AcEditor({ projectId, reqId }: { projectId: string; reqId: string }) {
  const t = useTranslations("requirements");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [given, setGiven] = useState("");
  const [when, setWhen] = useState("");
  const [then, setThen] = useState("");

  const [state, action, pending] = useActionState(
    addAcAction.bind(null, projectId, reqId),
    INITIAL,
  );
  const [draftState, draftAction, draftPending] = useActionState(
    suggestAcDraftAction.bind(null, projectId, reqId),
    DRAFT_INITIAL,
  );
  useEffect(() => {
    if (state.ok && state.error === null && state !== INITIAL) {
      setTitle("");
      setGiven("");
      setWhen("");
      setThen("");
    }
  }, [state]);

  const loadDraft = (d: AcDraft) => {
    setTitle(d.title);
    setGiven(d.given);
    setWhen(d.when);
    setThen(d.then);
    setOpen(true);
  };

  const row = (kw: string, cls: string, value: string, setValue: (v: string) => void, name: string) => (
    <div className="flex items-start gap-2.5">
      <span className={`min-w-[52px] rounded-4 border px-2 py-0.5 text-center font-mono text-[10px] font-bold ${cls}`}>
        {kw}
      </span>
      <input
        name={name}
        required
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="min-w-0 flex-1 rounded-4 border border-neutral-350 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-action"
      />
    </div>
  );

  return (
    <div className="mt-3">
      {!open ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-control border border-neutral-350 bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-secondary hover:bg-soft"
          >
            + {t("acAddCta")}
          </button>
          <form action={draftAction}>
            <button
              type="submit"
              disabled={draftPending}
              className="rounded-control border border-[#C9B3E6] bg-surface px-3 py-1.5 text-[12px] font-semibold text-action-deep hover:bg-accent-tint disabled:opacity-60"
            >
              {draftPending ? t("drafting") : `✦ ${t("acDraftCta")}`}
            </button>
          </form>
          <span className="text-[10.5px] text-ink-tertiary">{t("acHitlNote")}</span>
        </div>
      ) : null}

      {draftState.drafts && draftState.drafts.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-2">
          {draftState.drafts.map((d, i) => (
            <div key={i} className="flex items-center gap-2.5 rounded-tile border border-[#C9B3E6] bg-tint-action px-3 py-2">
              <span className="text-[12px]">✦</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-[#5B3C86]">
                <b>{d.title}</b> — {d.given} / {d.when} / {d.then}
              </span>
              <button
                type="button"
                onClick={() => loadDraft(d)}
                className="shrink-0 rounded-control border border-[#C9B3E6] bg-surface px-2.5 py-1 text-[11px] font-semibold text-action-deep"
              >
                {t("acDraftLoad")}
              </button>
            </div>
          ))}
        </div>
      )}
      {draftState.error && <p className="mt-2 text-[12px] text-danger">{draftState.error}</p>}

      {open && (
        <form action={action} className="mt-2.5 flex flex-col gap-2.5 rounded-tile border border-line bg-surface p-3.5">
          <input
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("acTitlePlaceholder")}
            className="rounded-4 border border-neutral-350 px-2.5 py-1.5 text-[12.5px] font-semibold outline-none focus:border-action"
          />
          {row("GIVEN", "border-[#C7DEEF] bg-tint-sky text-pivot", given, setGiven, "given")}
          {row("WHEN", "border-[#D9C8EE] bg-tint-action text-action-deep", when, setWhen, "when")}
          {row("THEN", "border-[#CDE7DA] bg-tint-done text-done-text", then, setThen, "then")}
          {state.error && <p className="text-[12px] text-danger">{state.error}</p>}
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[10.5px] text-ink-tertiary">{t("acSharedFormNote")}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-control border border-neutral-350 bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-secondary"
            >
              {t("cancelCta")}
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-control bg-action px-3.5 py-1.5 text-[12px] font-bold text-white disabled:opacity-60"
            >
              {pending ? t("saving") : t("saveCta")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

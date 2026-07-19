"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  addCaseAction,
  addCriterionAction,
  deleteCriterionAction,
  rejectCaseAction,
  updateCaseAction,
  updateCriterionAction,
} from "@/app/goldenset-actions";
import { ANSWER_TYPES, formatAnswerValue, parseAnswerConfig, orderedCriteria } from "@/lib/goldenset/model";
import type { FormState } from "@/app/actions";
import type { AnswerType, EvalCaseRow, EvalCriterionRow } from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Teszteset-szerkesztő (#14, 2. jelenet): bemenet + kritériumok (1-N, a
// tanácsadó kontrollja: ✎ szerkesztés, × törlés, + hozzáadás) + válasz-
// típus választó (ez vezérli a rögzítő formáját) + OPCIONÁLIS elvárt
// kimenet (c-minta: „nincs megadva" — nyílt esetnél a kritérium dönt).
// AI-javaslatból jött eset: ✦ jelölés; a mentés emberi megerősítés
// (ai_suggested → confirmed).
// ─────────────────────────────────────────────────────────────

const INITIAL: FormState = { ok: true, error: null };

export function EvalCaseEditor({
  projectId,
  existing,
  criteria,
  sourceChips,
  onClose,
}: {
  projectId: string;
  /** null = új (manuális) eset. */
  existing: EvalCaseRow | null;
  criteria: EvalCriterionRow[];
  sourceChips: { n: number; title: string }[];
  onClose: () => void;
}) {
  const t = useTranslations("goldenset");
  const [answerType, setAnswerType] = useState<AnswerType>(existing?.answer_type ?? "free_text");
  const cfg = parseAnswerConfig(existing?.answer_config);
  const boundAction = existing
    ? updateCaseAction.bind(null, projectId, existing.id)
    : addCaseAction.bind(null, projectId);
  const [state, action, pending] = useActionState(boundAction, INITIAL);
  useEffect(() => {
    if (state.ok && state.error === null && state !== INITIAL) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const label = (txt: string, extra?: string) => (
    <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
      {txt}
      {extra && <span className="normal-case"> · {extra}</span>}
    </div>
  );

  const expectedFormatted = existing
    ? formatAnswerValue(existing.answer_type, existing.expected_output)
    : null;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-[rgba(35,38,47,0.4)] p-6 pt-10" onClick={onClose}>
      <div
        className="w-full max-w-[680px] overflow-hidden rounded-shell border border-line bg-surface shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* fejléc: EC-id + AI-eredet + forrás */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-tint-sky px-5 py-3">
          {existing && (
            <span className="rounded-3 bg-pivot px-2 py-0.5 font-mono text-[10px] font-bold text-white">
              {existing.display_id}
            </span>
          )}
          <span className="text-[14px] font-bold">{existing ? t("editorTitle") : t("addCaseCta")}</span>
          {existing?.state === "ai_suggested" && (
            <span className="rounded-3 bg-tint-action px-1.5 py-px font-mono text-[9px] font-bold text-action-deep">
              ✦ {t("aiFromBadge")} · {t("editHuman")}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            {sourceChips.map((c) => (
              <span key={c.n} className="rounded-3 border border-[#B9CCF7] bg-surface px-1.5 py-px font-mono text-[9px] font-bold text-action-deep">
                [{c.n}]
              </span>
            ))}
            <button type="button" onClick={onClose} className="text-[13px] font-semibold text-ink-secondary hover:text-ink">
              ✕
            </button>
          </span>
        </div>

        <form action={action} className="flex flex-col gap-4 p-5">
          <div>
            {label(t("inputLabel"))}
            <textarea
              name="input_text"
              required
              rows={2}
              defaultValue={existing?.input_text ?? ""}
              className="w-full rounded-tile border border-neutral-350 px-3 py-2.5 text-[13px] leading-[1.5] outline-none focus:border-pivot"
            />
          </div>

          {/* kritériumok: meglévő esetnél soronkénti CRUD, újnál textarea */}
          <div>
            {label(t("criteriaLabel"), t("criteriaSub"))}
            {existing ? (
              <CriteriaEditor projectId={projectId} caseRow={existing} criteria={criteria} />
            ) : (
              <textarea
                name="criteria"
                rows={3}
                placeholder={t("criteriaLines")}
                className="w-full rounded-tile border border-neutral-350 px-3 py-2.5 text-[12.5px] leading-[1.5] outline-none focus:border-pivot"
              />
            )}
          </div>

          {/* válasz-típus választó — ez vezérli a rögzítőt (AC1) */}
          <div>
            {label(t("typeLabel"))}
            <input type="hidden" name="answer_type" value={answerType} />
            <div className="flex flex-wrap gap-1.5">
              {ANSWER_TYPES.map((at) => (
                <button
                  key={at}
                  type="button"
                  onClick={() => setAnswerType(at)}
                  className={`rounded-4 border px-2.5 py-1.5 font-mono text-[10.5px] font-bold ${
                    answerType === at
                      ? "border-pivot bg-pivot text-white"
                      : "border-neutral-350 bg-surface text-ink-secondary hover:bg-soft"
                  }`}
                >
                  {t(`type.${at}`)}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-ink-tertiary">{t("typeHint")}</p>
          </div>

          {/* típusfüggő konfiguráció */}
          {(answerType === "choice_single" || answerType === "choice_multi") && (
            <div>
              {label(t("optionsLabel"))}
              <textarea
                name="options"
                rows={3}
                defaultValue={cfg.options.join("\n")}
                className="w-full rounded-tile border border-neutral-350 px-3 py-2 font-mono text-[12px] leading-[1.6] outline-none focus:border-pivot"
              />
            </div>
          )}
          {answerType === "number_scale" && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex w-[90px] flex-col gap-1">
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">{t("scaleMin")}</span>
                <input name="scale_min" type="number" defaultValue={cfg.min} className="rounded-tile border border-neutral-350 px-2.5 py-1.5 font-mono text-[12px]" />
              </label>
              <label className="flex w-[90px] flex-col gap-1">
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">{t("scaleMax")}</span>
                <input name="scale_max" type="number" defaultValue={cfg.max} className="rounded-tile border border-neutral-350 px-2.5 py-1.5 font-mono text-[12px]" />
              </label>
              <label className="flex min-w-[200px] flex-1 flex-col gap-1">
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">{t("scaleQuestion")}</span>
                <input name="scale_label" defaultValue={cfg.label} className="rounded-tile border border-neutral-350 px-2.5 py-1.5 text-[12.5px]" />
              </label>
            </div>
          )}
          {answerType === "yes_no" && (
            <div>
              {label(t("scaleQuestion"), t("optional"))}
              <input name="scale_label" defaultValue={cfg.label} className="w-full rounded-tile border border-neutral-350 px-2.5 py-1.5 text-[12.5px]" />
            </div>
          )}

          {/* elvárt kimenet — OPCIONÁLIS (c-minta) */}
          <div className="rounded-tile border border-dashed border-neutral-350 bg-[#FBFBFD] p-3.5">
            {label(t("expectedLabel"), t("optional"))}
            {expectedFormatted === null && existing && (
              <div className="mb-2 font-mono text-[10.5px] italic text-ink-tertiary">— {t("notGiven")}</div>
            )}
            <ExpectedInput answerType={answerType} existing={existing} options={cfg.options} />
            <p className="mt-2 text-[11px] leading-[1.45] text-ink-tertiary">{t("expectedNote")}</p>
          </div>

          {state.error && <p className="text-[12px] text-danger">{state.error}</p>}
          <div className="flex items-center gap-2 border-t border-line-soft pt-3.5">
            <span className="text-[11px] text-ink-tertiary">{t("humanControlNote")}</span>
            <span className="ml-auto flex items-center gap-2">
              {existing?.state === "ai_suggested" && (
                <RejectButton projectId={projectId} caseId={existing.id} onDone={onClose} />
              )}
              <button type="button" onClick={onClose} className="rounded-control border border-neutral-350 px-3.5 py-2 text-[12.5px] font-semibold text-ink-secondary">
                {t("cancelCta")}
              </button>
              <button type="submit" disabled={pending} className="rounded-control bg-action px-4 py-2 text-[12.5px] font-bold text-white disabled:opacity-60">
                {t("saveCaseCta")}
              </button>
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Elvárt kimenet beviteli mező — a kiválasztott típus formájában. */
function ExpectedInput({
  answerType,
  existing,
  options,
}: {
  answerType: AnswerType;
  existing: EvalCaseRow | null;
  options: string[];
}) {
  const t = useTranslations("goldenset");
  const sameType = existing?.answer_type === answerType;
  const cur = sameType ? existing?.expected_output : null;
  const curObj = (cur ?? {}) as Record<string, unknown>;

  if (answerType === "free_text") {
    return (
      <textarea
        name="expected_text"
        rows={2}
        defaultValue={typeof curObj.text === "string" ? curObj.text : ""}
        placeholder={t("notGiven")}
        className="w-full rounded-tile border border-neutral-350 px-3 py-2 text-[12.5px] outline-none focus:border-pivot"
      />
    );
  }
  if (answerType === "choice_single") {
    return (
      <select
        name="expected_choice"
        defaultValue={typeof curObj.choice === "string" ? curObj.choice : ""}
        className="w-full rounded-tile border border-neutral-350 px-3 py-2 text-[12.5px]"
      >
        <option value="">— {t("notGiven")} —</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    );
  }
  if (answerType === "choice_multi") {
    // az elvárt multi-készlet megadása opcionális; üresen hagyva „nincs megadva"
    const chosen = Array.isArray(curObj.choices) ? (curObj.choices as string[]) : [];
    return (
      <div className="flex flex-wrap gap-1.5">
        {chosen.length > 0 && <input type="hidden" name="expected_multi_present" value="1" />}
        {options.map((o) => (
          <label key={o} className="flex cursor-pointer items-center gap-1.5 rounded-4 border border-neutral-350 px-2.5 py-1.5 text-[12px] has-[:checked]:border-pivot has-[:checked]:bg-tint-sky">
            <input type="checkbox" name="expected_choices" value={o} defaultChecked={chosen.includes(o)} className="accent-[#2E77A8]" onChange={(e) => {
              const form = e.currentTarget.form;
              if (!form) return;
              let marker = form.querySelector<HTMLInputElement>('input[name="expected_multi_present"]');
              if (!marker) {
                marker = document.createElement("input");
                marker.type = "hidden";
                marker.name = "expected_multi_present";
                marker.value = "1";
                form.appendChild(marker);
              }
            }} />
            {o}
          </label>
        ))}
      </div>
    );
  }
  if (answerType === "number_scale") {
    return (
      <input
        name="expected_value"
        type="number"
        defaultValue={typeof curObj.value === "number" ? curObj.value : ""}
        placeholder={t("notGiven")}
        className="w-[140px] rounded-tile border border-neutral-350 px-3 py-2 font-mono text-[12.5px]"
      />
    );
  }
  const curBool = typeof curObj.value === "boolean" ? (curObj.value ? "yes" : "no") : "";
  return (
    <select name="expected_bool" defaultValue={curBool} className="w-[200px] rounded-tile border border-neutral-350 px-3 py-2 text-[12.5px]">
      <option value="">— {t("notGiven")} —</option>
      <option value="yes">{t("yes")}</option>
      <option value="no">{t("no")}</option>
    </select>
  );
}

/** Kritérium-sorok (K1..): ✎ szerkesztés · × törlés · + hozzáadás. */
function CriteriaEditor({
  projectId,
  caseRow,
  criteria,
}: {
  projectId: string;
  caseRow: EvalCaseRow;
  criteria: EvalCriterionRow[];
}) {
  const t = useTranslations("goldenset");
  const ordered = orderedCriteria(caseRow.id, criteria);
  const [addState, addAct, addPending] = useActionState(
    addCriterionAction.bind(null, projectId, caseRow.id),
    INITIAL,
  );
  return (
    <div className="flex flex-col gap-1.5">
      {ordered.map((k, i) => (
        <CriterionRow key={k.id} projectId={projectId} criterion={k} index={i} />
      ))}
      <form action={addAct} className="flex items-center gap-2">
        <input
          name="text"
          required
          placeholder={`+ ${t("addCriterionCta")}`}
          className="min-w-0 flex-1 rounded-tile border border-dashed border-neutral-350 px-3 py-1.5 text-[12px] outline-none focus:border-pivot"
        />
        <button type="submit" disabled={addPending} className="shrink-0 rounded-3 border border-[#B9CCF7] bg-surface px-2 py-1 font-mono text-[10px] font-bold text-action-deep disabled:opacity-60">
          +
        </button>
        {addState.error && <span className="text-[10.5px] text-danger">{addState.error}</span>}
      </form>
    </div>
  );
}

function CriterionRow({
  projectId,
  criterion,
  index,
}: {
  projectId: string;
  criterion: EvalCriterionRow;
  index: number;
}) {
  const t = useTranslations("goldenset");
  const [editing, setEditing] = useState(false);
  const [updState, updAct, updPending] = useActionState(
    updateCriterionAction.bind(null, projectId, criterion.id),
    INITIAL,
  );
  const [, delAct, delPending] = useActionState(
    deleteCriterionAction.bind(null, projectId, criterion.id),
    INITIAL,
  );
  useEffect(() => {
    if (updState.ok && updState.error === null && updState !== INITIAL) setEditing(false);
  }, [updState]);

  return (
    <div className="flex items-center gap-2 rounded-tile border border-line bg-surface px-3 py-1.5">
      <span className="shrink-0 font-mono text-[10px] font-bold text-pivot">K{index + 1}</span>
      {editing ? (
        <form action={updAct} className="flex min-w-0 flex-1 items-center gap-2">
          <input
            name="text"
            defaultValue={criterion.text}
            required
            className="min-w-0 flex-1 rounded-3 border border-pivot px-2 py-1 text-[12px] outline-none"
          />
          <button type="submit" disabled={updPending} className="shrink-0 font-mono text-[10px] font-bold text-done-text disabled:opacity-60">✓</button>
        </form>
      ) : (
        <span className="min-w-0 flex-1 text-[12px] leading-[1.4]">{criterion.text}</span>
      )}
      {criterion.state === "ai_suggested" && (
        <span className="shrink-0 rounded-3 bg-tint-action px-1 py-px font-mono text-[8px] font-bold text-action-deep">✦ AI</span>
      )}
      <button type="button" onClick={() => setEditing((v) => !v)} className="shrink-0 font-mono text-[11px] text-ink-tertiary hover:text-ink" aria-label="edit">
        ✎
      </button>
      <form action={delAct} className="shrink-0">
        <button type="submit" disabled={delPending} className="font-mono text-[11px] text-ink-tertiary hover:text-danger disabled:opacity-60" aria-label="delete">
          ×
        </button>
      </form>
    </div>
  );
}

function RejectButton({ projectId, caseId, onDone }: { projectId: string; caseId: string; onDone: () => void }) {
  const t = useTranslations("goldenset");
  const [state, act, pending] = useActionState(rejectCaseAction.bind(null, projectId, caseId), INITIAL);
  useEffect(() => {
    if (state.ok && state.error === null && state !== INITIAL) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <form action={act}>
      <button type="submit" disabled={pending} className="rounded-control border border-neutral-350 px-3 py-2 text-[12px] font-semibold text-ink-secondary disabled:opacity-60">
        {t("rejectCta")}
      </button>
    </form>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { addRequirementAction } from "@/app/requirements-actions";
import type { FormState } from "@/app/actions";
import type { RequirementRow } from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Új követelmény a fába (#11, 7. jelenet bal oldala): szint/altípus
// választó, KÖTELEZŐ szülő (fa-kötés) a nem-business szinteken, szöveg,
// MoSCoW (emberi ítélet — üresen is hagyható). Kézi felvétel = manual
// eredet (E1). Overlay-panel, üveg/blur nélkül.
// ─────────────────────────────────────────────────────────────

const INITIAL: FormState = { ok: true, error: null };

type LevelPick = "business" | "stakeholder" | "system_f" | "system_nf";

export function AddRequirementPanel({
  projectId,
  requirements,
  onClose,
}: {
  projectId: string;
  requirements: RequirementRow[];
  onClose: () => void;
}) {
  const t = useTranslations("requirements");
  const [pick, setPick] = useState<LevelPick>("business");
  const [state, action, pending] = useActionState(
    addRequirementAction.bind(null, projectId),
    INITIAL,
  );
  useEffect(() => {
    if (state.ok && state.error === null && state !== INITIAL) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const level = pick === "business" ? "business" : pick === "stakeholder" ? "stakeholder" : "system";
  const subtype = pick === "system_nf" ? "non_functional" : pick === "system_f" ? "functional" : "";
  const parentLevel = level === "system" ? "stakeholder" : level === "stakeholder" ? "business" : null;
  const parentOptions = parentLevel ? requirements.filter((r) => r.level === parentLevel) : [];

  const pickBtn = (value: LevelPick, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => setPick(value)}
      className={`rounded-4 border px-2.5 py-1.5 text-[11.5px] font-semibold ${
        pick === value
          ? "border-pivot bg-pivot text-white"
          : "border-neutral-350 bg-surface text-ink-secondary hover:bg-soft"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-[rgba(35,38,47,0.4)] p-6 pt-16" onClick={onClose}>
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-shell border border-line bg-surface shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-line bg-tint-sky px-4.5 py-3 pl-5">
          <span className="flex h-5 w-5 items-center justify-center rounded-4 bg-pivot font-bold text-white">+</span>
          <span className="text-[14px] font-bold">{t("panelAddTitle")}</span>
          <span className="font-mono text-[10px] text-[#55708A]">{t("panelAddSub")}</span>
          <button type="button" onClick={onClose} className="ml-auto text-[13px] font-semibold text-ink-secondary hover:text-ink">
            ✕
          </button>
        </div>
        <form action={action} className="flex flex-col gap-4 p-5">
          <input type="hidden" name="level" value={level} />
          <input type="hidden" name="subtype" value={subtype} />
          <div>
            <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
              {t("panelLevelLabel")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {pickBtn("business", t("levelBusiness"))}
              {pickBtn("stakeholder", t("levelStakeholder"))}
              {pickBtn("system_f", t("levelSystemF"))}
              {pickBtn("system_nf", t("levelSystemNf"))}
            </div>
          </div>
          {parentLevel && (
            <div>
              <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
                {t("panelParentLabel")} <span className="text-danger">· {t("requiredMark")}</span>
              </div>
              <select
                name="parentId"
                required
                defaultValue=""
                className="w-full rounded-tile border-[1.5px] border-[#C7DEEF] bg-[#F4FAFD] px-3 py-2 text-[12.5px]"
              >
                <option value="" disabled>
                  {t("panelParentPlaceholder")}
                </option>
                {parentOptions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.display_id} · {r.text.slice(0, 70)}
                  </option>
                ))}
              </select>
              {parentOptions.length === 0 && (
                <p className="mt-1.5 text-[11px] text-gate-text">{t("panelNoParent")}</p>
              )}
            </div>
          )}
          <div>
            <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
              {t("panelTextLabel")}
            </div>
            <textarea
              name="text"
              required
              rows={3}
              className="w-full rounded-tile border border-neutral-350 px-3 py-2.5 text-[13px] leading-[1.5] outline-none focus:border-pivot"
              placeholder={t("panelTextPlaceholder")}
            />
          </div>
          <div>
            <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
              MoSCoW <span className="normal-case text-ink-tertiary">· {t("humanJudgement")}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(["", "must", "should", "could", "wont"] as const).map((m) => (
                <label
                  key={m || "none"}
                  className="flex cursor-pointer items-center gap-1 rounded-4 border border-neutral-350 px-2.5 py-1.5 font-mono text-[9.5px] font-bold text-ink-secondary has-[:checked]:border-action has-[:checked]:bg-action has-[:checked]:text-white"
                >
                  <input type="radio" name="moscow" value={m} defaultChecked={m === ""} className="sr-only" />
                  {m === "" ? t("moscowNone") : t(`moscow.${m}`)}
                </label>
              ))}
            </div>
          </div>
          {state.error && <p className="text-[12px] text-danger">{state.error}</p>}
          <div className="flex items-center gap-3 border-t border-line-soft pt-3">
            <span className="flex-1 text-[11px] text-ink-tertiary">{t("panelAddNote")}</span>
            <button
              type="submit"
              disabled={pending}
              className="rounded-control bg-pivot px-4 py-2 text-[12px] font-bold text-white disabled:opacity-60"
            >
              {pending ? t("saving") : t("saveCta")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { addComponentAction } from "@/app/solution-actions";
import type { FormState } from "@/app/actions";
import type { ComponentType } from "@/lib/db/types";
import type { SpineStep } from "@/lib/solution/model";

// ─────────────────────────────────────────────────────────────
// Új komponens (#12): típus-választó + név/leírás + kötés a jóváhagyott
// TO-BE lépésekhez a STABIL node-id-kre. A kötés-szabály típusonként:
// folyamat → pontosan EGY lépés; infrastruktúra → több (vagy mind);
// személyi → opcionális egy. Kézi felvétel = manual eredet (E1).
// ─────────────────────────────────────────────────────────────

const INITIAL: FormState = { ok: true, error: null };

export function AddComponentPanel({
  projectId,
  steps,
  onClose,
}: {
  projectId: string;
  steps: SpineStep[];
  onClose: () => void;
}) {
  const t = useTranslations("solution");
  const [type, setType] = useState<ComponentType>("process");
  const [state, action, pending] = useActionState(addComponentAction.bind(null, projectId), INITIAL);
  useEffect(() => {
    if (state.ok && state.error === null && state !== INITIAL) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const typeBtn = (value: ComponentType, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => setType(value)}
      className={`rounded-4 border px-2.5 py-1.5 text-[11.5px] font-semibold ${
        type === value
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
        <div className="flex items-center gap-2.5 border-b border-line bg-tint-sky px-5 py-3">
          <span className="flex h-5 w-5 items-center justify-center rounded-4 bg-pivot font-bold text-white">+</span>
          <span className="text-[14px] font-bold">{t("panelAddTitle")}</span>
          <button type="button" onClick={onClose} className="ml-auto text-[13px] font-semibold text-ink-secondary hover:text-ink">
            ✕
          </button>
        </div>
        <form action={action} className="flex flex-col gap-4 p-5">
          <input type="hidden" name="type" value={type} />
          <div>
            <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
              {t("fieldType")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {typeBtn("process", t("typeProcessFull"))}
              {typeBtn("infrastructure", t("typeInfra"))}
              {typeBtn("personnel", t("typePersonnel"))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
              {t("fieldName")}
            </div>
            <input
              name="name"
              required
              className="w-full rounded-tile border border-neutral-350 px-3 py-2 text-[13px] outline-none focus:border-pivot"
            />
          </div>
          <div>
            <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
              {t("fieldDesc")}
            </div>
            <textarea
              name="description"
              rows={2}
              className="w-full rounded-tile border border-neutral-350 px-3 py-2 text-[13px] leading-[1.5] outline-none focus:border-pivot"
            />
          </div>
          {/* Kötés a TO-BE lépésekhez — típusfüggő vezérlő */}
          <div>
            <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
              {type === "infrastructure" ? t("bindLabelMulti") : t("bindLabelSingle")}
              {type !== "process" && (
                <span className="normal-case text-ink-tertiary"> · {t("bindOptional")}</span>
              )}
            </div>
            {type === "infrastructure" ? (
              <div className="flex max-h-[180px] flex-col gap-1 overflow-y-auto rounded-tile border border-neutral-350 p-2">
                {steps.map((s) => (
                  <label key={s.nodeId} className="flex cursor-pointer items-center gap-2 rounded-4 px-2 py-1 text-[12.5px] hover:bg-soft">
                    <input type="checkbox" name="node_ids" value={s.nodeId} className="accent-[#2E77A8]" />
                    <span className="font-mono text-[10px] font-bold text-action-deep">{s.num}</span>
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  </label>
                ))}
              </div>
            ) : (
              <select
                name="node_ids"
                required={type === "process"}
                defaultValue=""
                className="w-full rounded-tile border-[1.5px] border-[#C7DEEF] bg-[#F4FAFD] px-3 py-2 text-[12.5px]"
              >
                <option value="" disabled={type === "process"}>
                  {type === "process" ? "—" : t("bindNone")}
                </option>
                {steps.map((s) => (
                  <option key={s.nodeId} value={s.nodeId}>
                    {s.num} · {s.title}
                  </option>
                ))}
              </select>
            )}
          </div>
          {state.error && <p className="text-[12px] text-danger">{state.error}</p>}
          <div className="flex items-center justify-end gap-2 border-t border-line-soft pt-3.5">
            <button type="button" onClick={onClose} className="rounded-control border border-neutral-350 px-3.5 py-2 text-[12.5px] font-semibold text-ink-secondary">
              {t("cancelCta")}
            </button>
            <button type="submit" disabled={pending} className="rounded-control bg-action px-4 py-2 text-[12.5px] font-bold text-white disabled:opacity-60">
              {t("saveCta")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

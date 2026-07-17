"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  deriveStoryAction,
  suggestStoryDraftAction,
  type StoryDraftState,
} from "@/app/requirements-actions";
import type { FormState } from "@/app/actions";
import type { EpicRow, RequirementRow } from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Story származtatása (#11, 7. jelenet jobb oldala) — az irány KÖTÖTT:
// requirement → story. A lefedett requirement(ek) a kontextusból előre
// kitöltve (chip-lista, bővíthető — ez adja az N:M-et); role/want/so_that;
// epic választás vagy új. ✦ AI-vázlat: kitölti az űrlapot — az EMBER
// véglegesíti (HITL). A közös AC automatikusan öröklődik a kötésen át.
// ─────────────────────────────────────────────────────────────

const INITIAL: FormState = { ok: true, error: null };
const DRAFT_INITIAL: StoryDraftState = { ok: true, error: null, draft: null };

export function DeriveStoryPanel({
  projectId,
  systemReqs,
  epics,
  prefillCoveredIds,
  onClose,
}: {
  projectId: string;
  systemReqs: RequirementRow[];
  epics: EpicRow[];
  prefillCoveredIds: string[];
  onClose: () => void;
}) {
  const t = useTranslations("requirements");
  const [covered, setCovered] = useState<string[]>(
    prefillCoveredIds.filter((id) => systemReqs.some((r) => r.id === id)),
  );
  const [role, setRole] = useState("");
  const [want, setWant] = useState("");
  const [soThat, setSoThat] = useState("");
  const [picker, setPicker] = useState(false);

  const [state, action, pending] = useActionState(deriveStoryAction.bind(null, projectId), INITIAL);
  const [draftState, draftAction, draftPending] = useActionState(
    suggestStoryDraftAction.bind(null, projectId),
    DRAFT_INITIAL,
  );

  useEffect(() => {
    if (state.ok && state.error === null && state !== INITIAL) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  // ✦ vázlat érkezett → kitöltjük az űrlapot (az ember szerkeszti és ment).
  useEffect(() => {
    if (draftState.draft) {
      setRole(draftState.draft.role);
      setWant(draftState.draft.want);
      setSoThat(draftState.draft.soThat);
    }
  }, [draftState]);

  const coveredReqs = covered
    .map((id) => systemReqs.find((r) => r.id === id))
    .filter((r): r is RequirementRow => r !== undefined);
  const addable = systemReqs.filter((r) => !covered.includes(r.id));

  const field = (
    label: string,
    name: string,
    value: string,
    setValue: (v: string) => void,
    bold?: boolean,
  ) => (
    <div className="flex items-center gap-2">
      <span className="min-w-[56px] rounded-4 border border-[#D9C8EE] bg-tint-action px-2 py-1 text-center font-mono text-[9.5px] font-bold text-action-deep">
        {label}
      </span>
      <input
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required={name !== "soThat"}
        className={`min-w-0 flex-1 rounded-4 border border-neutral-350 px-2.5 py-2 text-[12.5px] outline-none focus:border-action ${
          bold ? "font-semibold text-action-deep" : ""
        }`}
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-[rgba(35,38,47,0.4)] p-6 pt-16" onClick={onClose}>
      <div
        className="w-full max-w-[580px] overflow-hidden rounded-shell border border-line bg-surface shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-line bg-[#FBF9FE] px-5 py-3">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-action-deep text-[11px] font-bold text-white">↳</span>
          <span className="text-[14px] font-bold">{t("panelDeriveTitle")}</span>
          <span className="font-mono text-[10px] text-action-deep">requirement → story</span>
          <button type="button" onClick={onClose} className="ml-auto text-[13px] font-semibold text-ink-secondary hover:text-ink">
            ✕
          </button>
        </div>
        <form action={action} className="flex flex-col gap-4 p-5">
          {covered.map((id) => (
            <input key={id} type="hidden" name="coveredId" value={id} />
          ))}
          <div>
            <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
              {t("panelCoveredLabel")} <span className="text-danger">· {t("requiredMark")}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 rounded-tile border-[1.5px] border-[#C7DEEF] bg-[#F4FAFD] px-2.5 py-2">
              {coveredReqs.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setCovered((prev) => prev.filter((x) => x !== r.id))}
                  className="flex items-center gap-1 rounded-4 border border-[#C7DEEF] bg-surface px-2 py-1 font-mono text-[10px] font-bold text-pivot"
                >
                  {r.display_id} ✕
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPicker((v) => !v)}
                className="text-[11.5px] text-ink-tertiary hover:text-ink-secondary"
              >
                + {t("panelCoveredAdd")}
              </button>
            </div>
            {picker && addable.length > 0 && (
              <div className="mt-1.5 flex max-h-[130px] flex-col gap-1 overflow-auto rounded-tile border border-line bg-surface p-2">
                {addable.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setCovered((prev) => [...prev, r.id]);
                      setPicker(false);
                    }}
                    className="flex items-center gap-2 rounded-4 px-2 py-1.5 text-left text-[12px] hover:bg-soft"
                  >
                    <span className="font-mono text-[10px] font-bold text-pivot">{r.display_id}</span>
                    <span className="truncate text-ink-secondary">{r.text}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="mt-1.5 text-[10.5px] text-ink-tertiary">{t("panelCoveredNote")}</p>
          </div>

          <div>
            <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
              {t("panelStoryLabel")}
            </div>
            <div className="flex flex-col gap-2">
              {field(t("asA"), "role", role, setRole, true)}
              {field(t("iWant"), "want", want, setWant)}
              {field(t("soThatKw"), "soThat", soThat, setSoThat)}
            </div>
          </div>

          <div>
            <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
              {t("panelEpicLabel")}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select name="epicId" defaultValue={epics[0]?.id ?? ""} className="min-w-[200px] rounded-4 border border-neutral-350 px-2.5 py-2 text-[12.5px]">
                <option value="">{t("panelEpicNew")}</option>
                {epics.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.display_id} · {e.title}
                  </option>
                ))}
              </select>
              <input
                name="newEpicTitle"
                placeholder={t("panelEpicNewPlaceholder")}
                className="min-w-0 flex-1 rounded-4 border border-neutral-350 px-2.5 py-2 text-[12.5px]"
              />
            </div>
          </div>

          <div className="flex items-center gap-2.5 rounded-tile border border-[#C9B3E6] bg-tint-action px-3 py-2.5">
            <span className="text-[13px]">✦</span>
            <span className="min-w-0 flex-1 text-[11px] leading-[1.4] text-[#5B3C86]">
              {t.rich("panelAiNote", { b: (c) => <b>{c}</b> })}
            </span>
            <button
              type="submit"
              formAction={draftAction}
              disabled={draftPending || covered.length === 0}
              className="rounded-control border border-[#C9B3E6] bg-surface px-3 py-1.5 text-[11.5px] font-semibold text-action-deep disabled:opacity-60"
            >
              {draftPending ? t("drafting") : `✦ ${t("panelAiDraftCta")}`}
            </button>
          </div>

          {(state.error || draftState.error) && (
            <p className="text-[12px] text-danger">{state.error ?? draftState.error}</p>
          )}
          <div className="flex items-center gap-3 border-t border-line-soft pt-3">
            <span className="flex-1 text-[11px] text-ink-tertiary">{t("panelDeriveNote")}</span>
            <button
              type="submit"
              disabled={pending || covered.length === 0}
              className="rounded-control bg-action-deep px-4 py-2 text-[12px] font-bold text-white disabled:opacity-60"
            >
              {pending ? t("saving") : t("panelDeriveCta")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

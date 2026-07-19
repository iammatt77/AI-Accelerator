"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { addComponentAction, seedFromP2Action } from "@/app/builddoc-actions";
import type { FormState } from "@/app/actions";

// ─────────────────────────────────────────────────────────────
// 6. jelenet — komponens felvétele: BAL a P2-seed (a kiválasztott P2-
// komponensekből; a már kinyertek jelölve „már kinyerve → K-xx", de az
// 1-N miatt újra behúzhatók), JOBB a manuális űrlap (mentés után ✦
// kötés-javaslat opció). Az eredet-kötés a seednél öröklődik (AC1).
// ─────────────────────────────────────────────────────────────

const INITIAL: FormState = { ok: true, error: null };

export interface SeedItem {
  id: string;
  name: string;
  optionName: string | null;
  extractedAs: string[];
}

export function BuildAddPanel({
  projectId,
  seeds,
  onClose,
}: {
  projectId: string;
  seeds: SeedItem[];
  onClose: () => void;
}) {
  const t = useTranslations("builddoc");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [seedState, seedAct, seedPending] = useActionState(
    async (prev: FormState, formData: FormData) => {
      const result = await seedFromP2Action(projectId, prev, formData);
      if (result.ok && !result.error) onClose();
      return result;
    },
    INITIAL,
  );
  const [addState, addAct, addPending] = useActionState(
    async (prev: FormState, formData: FormData) => {
      const result = await addComponentAction(projectId, prev, formData);
      if (result.ok && !result.error) onClose();
      return result;
    },
    INITIAL,
  );

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(20,22,30,0.45)] px-4 py-8"
      onClick={onClose}
      data-testid="add-panel"
    >
      <div
        className="w-full max-w-[880px] overflow-hidden rounded-shell border border-line bg-surface shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <span className="text-[15px] font-extrabold tracking-[-0.01em]">{t("addTitle")}</span>
          <button type="button" onClick={onClose} className="ml-auto rounded-control px-2.5 py-1 text-[13px] font-bold text-ink-tertiary hover:bg-soft">
            ×
          </button>
        </div>
        <div className="grid min-[820px]:grid-cols-2">
          {/* ── BAL: P2-seed ── */}
          <form action={seedAct} className="flex flex-col border-b border-line min-[820px]:border-b-0 min-[820px]:border-r">
            <div className="border-b border-line px-4 py-2.5">
              <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
                {t("seedTitle")}
              </span>
              <span className="ml-1.5 font-mono text-[9.5px] text-ink-tertiary">{t("seedSub")}</span>
            </div>
            <p className="border-b border-line-soft px-4 py-2 text-[11px] leading-[1.5] text-ink-secondary">
              ✦ {t("seedNote")}
            </p>
            <div className="flex max-h-[300px] flex-col overflow-y-auto">
              {seeds.length === 0 && (
                <p className="px-4 py-6 text-center text-[12px] italic text-ink-tertiary">{t("seedEmpty")}</p>
              )}
              {seeds.map((s) => {
                const done = s.extractedAs.length > 0;
                return (
                  <label
                    key={s.id}
                    className={`flex cursor-pointer items-center gap-2.5 border-b border-line-row px-4 py-2.5 ${
                      picked.has(s.id) ? "bg-accent-tint" : "hover:bg-soft"
                    }`}
                  >
                    <input
                      type="checkbox"
                      name="seed_ids"
                      value={s.id}
                      checked={picked.has(s.id)}
                      onChange={() => toggle(s.id)}
                      className="accent-[#1F5AE8]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-semibold">
                        {s.name}
                        {s.optionName && (
                          <span className="ml-1.5 font-mono text-[9.5px] font-normal text-ink-tertiary">
                            ({t("seedSelected")}: {s.optionName})
                          </span>
                        )}
                      </span>
                      <span className={`block font-mono text-[9.5px] ${done ? "text-done-text" : "text-ink-tertiary"}`}>
                        {done
                          ? `${t("seedExtracted")} → ${s.extractedAs.join(", ")}`
                          : t("seedNotExtracted")}
                      </span>
                    </span>
                    {done && (
                      <span className="rounded-3 border border-[#CDE7DA] bg-tint-done px-1.5 py-px font-mono text-[8.5px] font-bold text-done-text">
                        {t("seedDoneBadge")}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
            <div className="mt-auto flex items-center gap-2 border-t border-line px-4 py-3">
              <span className="min-w-0 flex-1 text-[11px] text-ink-tertiary">
                {picked.size > 0 ? t("seedPickedLine", { n: picked.size }) : t("seedPickHint")}
              </span>
              <button
                type="submit"
                disabled={seedPending || picked.size === 0}
                className="rounded-control bg-action px-3.5 py-1.5 text-[12px] font-bold text-white disabled:opacity-60"
              >
                {t("seedCta")}
              </button>
            </div>
            {seedState.error && <p className="px-4 pb-2 text-[11px] text-danger">{seedState.error}</p>}
          </form>

          {/* ── JOBB: manuális felvétel ── */}
          <form action={addAct} className="flex flex-col gap-2.5 p-4">
            <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
              + {t("manualTitle")}
            </div>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">{t("fName")}</span>
              <input name="name" className="rounded-tile border border-neutral-350 px-3 py-1.5 text-[12.5px] outline-none focus:border-pivot" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">{t("fDescription")}</span>
              <textarea name="description" rows={3} className="rounded-tile border border-neutral-350 px-3 py-2 text-[12.5px] leading-[1.55] outline-none focus:border-pivot" />
            </label>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">{t("fLayer")}</span>
              <div className="flex gap-1.5">
                {(["process", "infrastructure", "personnel"] as const).map((l, i) => (
                  <label
                    key={l}
                    className="flex cursor-pointer items-center gap-1.5 rounded-pill border border-neutral-350 px-3 py-1.5 text-[12px] font-semibold has-[:checked]:border-action has-[:checked]:bg-accent-fill has-[:checked]:text-action-deep"
                  >
                    <input type="radio" name="layer_type" value={l} defaultChecked={i === 0} className="sr-only" />
                    {t(`layer.${l}`)}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-start gap-2 rounded-tile border border-dashed border-[#8FACEE] bg-tint-action px-3 py-2 text-[11px] leading-[1.5] text-action-deep">
              <input type="checkbox" name="with_ai" value="1" defaultChecked className="mt-0.5 accent-[#1F5AE8]" />
              <span>✦ {t("manualAiNote")}</span>
            </label>
            <p className="text-[10.5px] text-ink-tertiary">{t("manualOriginNote")}</p>
            {addState.error && <p className="text-[11.5px] text-danger">{addState.error}</p>}
            {addState.notice && <p className="text-[11.5px] text-gate-text">{addState.notice}</p>}
            <div className="mt-auto flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-control px-3 py-1.5 text-[12px] font-semibold text-ink-secondary hover:bg-soft">
                {t("cancelCta")}
              </button>
              <button type="submit" disabled={addPending} className="rounded-control bg-action px-3.5 py-1.5 text-[12px] font-bold text-white disabled:opacity-60">
                {t("addCta")}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

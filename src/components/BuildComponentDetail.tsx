"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  addLinkAction,
  confirmComponentAction,
  confirmLinkAction,
  deleteLinkAction,
  rejectComponentAction,
  suggestLinksAction,
  updateComponentAction,
} from "@/app/builddoc-actions";
import { AiBadge, LayerChip } from "@/components/BuildDocBoard";
import { byDisplayId, elementIndex, resolveLink, type PlanElement } from "@/lib/builddoc/model";
import type { FormState } from "@/app/actions";
import type {
  BuildComponentRow,
  ImplLinkRow,
  ImplTargetType,
  PromptItemRow,
} from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// 2. jelenet ★ — komponens-részlet + kötés-szerkesztő: BAL az EREDET
// (honnan jött: P2-seed vagy manuális) + a prompt-elemek (1-N); JOBB a
// MEGVALÓSÍTÁS (mit valósít meg: 4 cél-típus, N:M). Az ✦ AI-javasolt kötés
// szaggatott — CSAK ✓-val válik aktívvá, ×-szel elvethető (E1). Minden
// elem-chip kattintható: a lefedettség-nézetre visz (kétirányú bejárás).
// ─────────────────────────────────────────────────────────────

const INITIAL: FormState = { ok: true, error: null };

export function BuildComponentDetail({
  projectId,
  component,
  links,
  prompts,
  originLabel,
  elements,
  onNavigate,
  onClose,
}: {
  projectId: string;
  component: BuildComponentRow;
  links: ImplLinkRow[];
  prompts: PromptItemRow[];
  originLabel: string | null;
  elements: PlanElement[];
  onNavigate: (el: PlanElement) => void;
  onClose: () => void;
}) {
  const t = useTranslations("builddoc");
  const [editing, setEditing] = useState(false);
  const index = elementIndex(elements);
  const [suggestState, suggestAct, suggestPending] = useActionState(
    suggestLinksAction.bind(null, projectId, component.id),
    INITIAL,
  );
  const [confirmState, confirmAct, confirmPending] = useActionState(
    confirmComponentAction.bind(null, projectId, component.id),
    INITIAL,
  );
  const [rejectState, rejectAct, rejectPending] = useActionState(
    async (prev: FormState, formData: FormData) => {
      const result = await rejectComponentAction(projectId, component.id, prev, formData);
      if (result.ok && !result.error) onClose();
      return result;
    },
    INITIAL,
  );

  const suggestedLinks = links.filter((l) => l.state === "ai_suggested");
  const linkedKeys = new Set(links.map((l) => `${l.target_type}:${l.target_id}`));
  const free = elements.filter((e) => !linkedKeys.has(`${e.targetType}:${e.targetId}`));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(20,22,30,0.45)] px-4 py-8"
      onClick={onClose}
      data-testid="component-detail"
    >
      <div
        className="w-full max-w-[980px] overflow-hidden rounded-shell border border-line bg-surface shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* fejléc */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-5 py-3">
          <span className="font-mono text-[12px] font-bold text-pivot">{component.display_id}</span>
          <span className="text-[16px] font-extrabold tracking-[-0.01em]">{component.name}</span>
          <LayerChip layer={component.layer_type} />
          {component.state === "ai_suggested" && <AiBadge />}
          <span className="ml-auto flex items-center gap-1.5">
            {component.state === "ai_suggested" && (
              <>
                <form action={confirmAct}>
                  <button type="submit" disabled={confirmPending} className="rounded-control bg-action px-2.5 py-1 text-[11.5px] font-bold text-white disabled:opacity-60">
                    ✓ {t("confirmCta")}
                  </button>
                </form>
                <form action={rejectAct}>
                  <button type="submit" disabled={rejectPending} className="rounded-control border border-neutral-350 px-2.5 py-1 text-[11.5px] font-semibold text-ink-secondary hover:bg-soft disabled:opacity-60">
                    × {t("rejectCta")}
                  </button>
                </form>
              </>
            )}
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="rounded-control border border-[#B9CCF7] bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-action-deep hover:bg-accent-tint"
            >
              ✎ {t("editCta")}
            </button>
            <button type="button" onClick={onClose} className="rounded-control px-2.5 py-1 text-[13px] font-bold text-ink-tertiary hover:bg-soft">
              ×
            </button>
          </span>
        </div>
        {(confirmState.error || rejectState.error) && (
          <p className="border-b border-line px-5 py-1.5 text-[11px] text-danger">
            {confirmState.error ?? rejectState.error}
          </p>
        )}

        {editing ? (
          <ComponentEditForm projectId={projectId} component={component} onDone={() => setEditing(false)} />
        ) : (
          component.description && (
            <p className="border-b border-line px-5 py-3 text-[12.5px] leading-[1.55] text-ink-secondary">
              {component.description}
            </p>
          )
        )}

        <div className="grid min-[860px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {/* ── BAL: eredet + prompt-elemek ── */}
          <div className="border-b border-line p-4 min-[860px]:border-b-0 min-[860px]:border-r">
            <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
              {t("originTitle")}
            </div>
            {originLabel ? (
              <div className="mt-1.5 rounded-tile border border-[#CDE7DA] bg-tint-done p-3">
                <div className="font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-done-text">
                  {t("originP2Label")}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[13px] font-bold">{originLabel}</span>
                  <span className="rounded-3 border border-[#CDE7DA] bg-surface px-1.5 py-px font-mono text-[8.5px] font-bold text-done-text">
                    {t("originSeedBadge")}
                  </span>
                  <Link
                    href={`/project/${projectId}/solution`}
                    className="font-mono text-[10px] font-bold text-action-deep hover:underline"
                  >
                    {t("originOpen")} ↗
                  </Link>
                </div>
                <p className="mt-1 text-[10.5px] leading-[1.5] text-ink-secondary">{t("originSeedNote")}</p>
              </div>
            ) : (
              <div className="mt-1.5 rounded-tile border border-dashed border-neutral-350 bg-[#FBFBFD] px-3 py-2.5 text-[11.5px] text-ink-tertiary">
                {t("originManualLong")}
              </div>
            )}

            <div className="mt-4 flex items-center gap-2">
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
                {t("promptItemsTitle")}
              </span>
              <span className="font-mono text-[9px] text-ink-tertiary">· 1-N</span>
            </div>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {byDisplayId(prompts).length === 0 && (
                <span className="text-[11.5px] italic text-ink-tertiary">{t("promptItemsEmpty")}</span>
              )}
              {byDisplayId(prompts).map((p) => (
                <div key={p.id} className="flex items-center gap-2 rounded-tile border border-line bg-surface px-3 py-1.5">
                  <span className="font-mono text-[10px] font-bold text-pivot">{p.display_id}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px]">{p.name}</span>
                  {p.state === "ai_suggested" && <AiBadge />}
                  <span className="font-mono text-[11px] text-ink-tertiary">›</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── JOBB: megvalósítás-kötések (4 cél-típus, N:M) ── */}
          <div className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
                {t("implTitle")}
              </span>
              <span className="rounded-3 bg-sunken px-1.5 py-px font-mono text-[8.5px] font-bold text-ink-secondary">
                {t("implNm")}
              </span>
              <form action={suggestAct} className="ml-auto">
                <button
                  type="submit"
                  disabled={suggestPending}
                  className="rounded-control border border-[#B9CCF7] bg-surface px-2.5 py-1 text-[11px] font-semibold text-action-deep hover:bg-accent-tint disabled:opacity-60"
                >
                  {suggestPending ? t("generating") : `✦ ${t("suggestLinksCta")}`}
                </button>
              </form>
            </div>
            <p className="mt-1 text-[10.5px] leading-[1.5] text-ink-tertiary">{t("implNote")}</p>
            {(suggestState.error || suggestState.notice) && (
              <p className={`mt-1 text-[11px] ${suggestState.error ? "text-danger" : "text-gate-text"}`}>
                {suggestState.error ?? suggestState.notice}
              </p>
            )}

            {(["requirement", "story", "tobe_node", "pain_point"] as ImplTargetType[]).map((type) => {
              const typeLinks = links.filter((l) => l.target_type === type);
              return (
                <div key={type} className="mt-3">
                  <div className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-secondary">
                    {t(`target.${type}`)}
                    {type === "pain_point" && (
                      <span className="ml-1 font-normal normal-case text-ink-tertiary">· {t("painOptional")}</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {typeLinks.length === 0 && (
                      <span className="font-mono text-[10px] italic text-ink-tertiary">—</span>
                    )}
                    {typeLinks.map((l) => (
                      <LinkChip
                        key={l.id}
                        projectId={projectId}
                        link={l}
                        element={resolveLink(l, index)}
                        onNavigate={onNavigate}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {suggestedLinks.length > 0 && (
              <div className="mt-3 rounded-tile border border-dashed border-[#8FACEE] bg-tint-action px-3 py-2 text-[11px] leading-[1.5] text-action-deep">
                ✦ {t("suggestedNote", { n: suggestedLinks.length })}
              </div>
            )}

            {/* kézi kötés-felvétel */}
            <AddLinkForm projectId={projectId} componentId={component.id} free={free} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Kötés-chip: aktív (× törölhető) vagy ✦ szaggatott (✓ / ×) — E1. */
function LinkChip({
  projectId,
  link,
  element,
  onNavigate,
}: {
  projectId: string;
  link: ImplLinkRow;
  element: PlanElement | null;
  onNavigate: (el: PlanElement) => void;
}) {
  const t = useTranslations("builddoc");
  const [, confirmAct, confirmPending] = useActionState(
    confirmLinkAction.bind(null, projectId, link.id),
    INITIAL,
  );
  const [, deleteAct, deletePending] = useActionState(
    deleteLinkAction.bind(null, projectId, link.id),
    INITIAL,
  );
  const suggested = link.state === "ai_suggested";
  if (!element) {
    // A cél már nem létezik a tervben — a chip jelzi, törölhető.
    return (
      <span className="flex items-center gap-1 rounded-3 border border-dashed border-neutral-350 bg-sunken px-1.5 py-px font-mono text-[9.5px] text-ink-tertiary">
        {t("targetGone")}
        <form action={deleteAct}>
          <button type="submit" disabled={deletePending} className="font-bold hover:text-danger">×</button>
        </form>
      </span>
    );
  }
  return (
    <span
      data-testid={`link-${element.label}`}
      className={`flex items-center gap-1 rounded-3 border px-1.5 py-px font-mono text-[9.5px] font-bold ${
        suggested
          ? "border-dashed border-[#8FACEE] bg-tint-action text-action-deep"
          : "border-[#B9CCF7] bg-surface text-action-deep"
      }`}
    >
      {suggested && "✦ "}
      <button type="button" title={element.title} onClick={() => onNavigate(element)} className="hover:underline">
        {element.label}
      </button>
      {suggested && (
        <form action={confirmAct}>
          <button
            type="submit"
            disabled={confirmPending}
            title={t("confirmCta")}
            className="font-bold text-done-text hover:opacity-70"
          >
            ✓
          </button>
        </form>
      )}
      <form action={deleteAct}>
        <button
          type="submit"
          disabled={deletePending}
          title={suggested ? t("rejectCta") : t("unlinkCta")}
          className="font-bold text-ink-tertiary hover:text-danger"
        >
          ×
        </button>
      </form>
    </span>
  );
}

function AddLinkForm({
  projectId,
  componentId,
  free,
}: {
  projectId: string;
  componentId: string;
  free: PlanElement[];
}) {
  const t = useTranslations("builddoc");
  const [state, act, pending] = useActionState(addLinkAction.bind(null, projectId), INITIAL);
  const [picked, setPicked] = useState("");
  const [type, id] = picked.split("|");
  const groups: [ImplTargetType, PlanElement[]][] = (
    ["requirement", "story", "tobe_node", "pain_point"] as ImplTargetType[]
  ).map((tt) => [tt, free.filter((e) => e.targetType === tt)]);

  return (
    <form action={act} className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
      <input type="hidden" name="component_id" value={componentId} />
      <input type="hidden" name="target_type" value={type ?? ""} />
      <input type="hidden" name="target_id" value={id ?? ""} />
      <select
        value={picked}
        onChange={(e) => setPicked(e.target.value)}
        className="min-w-0 flex-1 rounded-tile border border-neutral-350 bg-surface px-2.5 py-1.5 text-[12px] outline-none focus:border-pivot"
      >
        <option value="">{t("pickTarget")}</option>
        {groups.map(([tt, els]) =>
          els.length > 0 ? (
            <optgroup key={tt} label={t(`target.${tt}`)}>
              {els.map((e) => (
                <option key={`${e.targetType}:${e.targetId}`} value={`${e.targetType}|${e.targetId}`}>
                  {e.label} — {e.title.slice(0, 70)}
                </option>
              ))}
            </optgroup>
          ) : null,
        )}
      </select>
      <button
        type="submit"
        disabled={pending || !picked}
        className="rounded-control bg-action px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-60"
      >
        + {t("addLinkCta")}
      </button>
      {state.error && <span className="w-full text-[11px] text-danger">{state.error}</span>}
    </form>
  );
}

function ComponentEditForm({
  projectId,
  component,
  onDone,
}: {
  projectId: string;
  component: BuildComponentRow;
  onDone: () => void;
}) {
  const t = useTranslations("builddoc");
  const [state, act, pending] = useActionState(
    async (prev: FormState, formData: FormData) => {
      const result = await updateComponentAction(projectId, component.id, prev, formData);
      if (result.ok && !result.error) onDone();
      return result;
    },
    INITIAL,
  );
  return (
    <form action={act} className="flex flex-col gap-2.5 border-b border-line bg-soft px-5 py-3">
      <div className="grid gap-2.5 min-[700px]:grid-cols-[minmax(0,1fr)_180px]">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">{t("fName")}</span>
          <input name="name" defaultValue={component.name} className="rounded-tile border border-neutral-350 px-3 py-1.5 text-[12.5px] outline-none focus:border-pivot" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">{t("fLayer")}</span>
          <select name="layer_type" defaultValue={component.layer_type} className="rounded-tile border border-neutral-350 bg-surface px-3 py-1.5 text-[12.5px] outline-none focus:border-pivot">
            <option value="process">{t("layer.process")}</option>
            <option value="infrastructure">{t("layer.infrastructure")}</option>
            <option value="personnel">{t("layer.personnel")}</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">{t("fDescription")}</span>
        <textarea name="description" rows={3} defaultValue={component.description} className="rounded-tile border border-neutral-350 px-3 py-2 text-[12.5px] leading-[1.55] outline-none focus:border-pivot" />
      </label>
      {state.error && <p className="text-[11.5px] text-danger">{state.error}</p>}
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onDone} className="rounded-control px-3 py-1.5 text-[12px] font-semibold text-ink-secondary hover:bg-soft">
          {t("cancelCta")}
        </button>
        <button type="submit" disabled={pending} className="rounded-control bg-action px-3.5 py-1.5 text-[12px] font-bold text-white disabled:opacity-60">
          {t("saveCta")}
        </button>
      </div>
    </form>
  );
}

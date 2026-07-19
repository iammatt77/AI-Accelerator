"use client";

import Link from "next/link";
import { useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  confirmComponentAction,
  generateComponentsAction,
  rejectComponentAction,
} from "@/app/solution-actions";
import { AddComponentPanel } from "@/components/AddComponentPanel";
import {
  coverageOf,
  dockedComponents,
  linkedStepsOf,
  optionsOf,
  selectedOption,
  solutionStats,
  type SpineStep,
} from "@/lib/solution/model";
import type { FormState } from "@/app/actions";
import type {
  ComponentOptionRow,
  ComponentStepLinkRow,
  SolutionComponentRow,
} from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Megoldás-terv áttekintő (#12, ref 1./5. jelenet) — gerinc + dokk:
// a jóváhagyott TO-BE lépések vízszintes gerincen, a folyamat-komponensek
// a lépésük ALÁ dokkolva (kötés-vonallal), az infrastruktúra alsó sávban
// lefedettség-kapoccsal, a személyi/szervezeti elemek külön sávban.
// A modul a folyamattérképet NEM módosítja — csak hivatkozik rá.
// ─────────────────────────────────────────────────────────────

const INITIAL: FormState = { ok: true, error: null };

export interface SolutionBoardProps {
  projectId: string;
  projectLabel: string;
  mapId: string;
  tobeVersion: number;
  steps: SpineStep[];
  components: SolutionComponentRow[];
  links: ComponentStepLinkRow[];
  options: ComponentOptionRow[];
}

// Típus-szín: folyamat = accent (lila), infra = source-kék, személyi = amber.
export function typeTone(type: SolutionComponentRow["type"]): {
  border: string;
  text: string;
  chipBg: string;
} {
  if (type === "process")
    return { border: "border-l-action-deep", text: "text-action-deep", chipBg: "bg-tint-action" };
  if (type === "infrastructure")
    return { border: "border-l-pivot", text: "text-pivot", chipBg: "bg-tint-sky" };
  return { border: "border-l-gate", text: "text-gate-text", chipBg: "bg-tint-gate" };
}

export function SolutionBoard({
  projectId,
  projectLabel,
  mapId,
  tobeVersion,
  steps,
  components,
  links,
  options,
}: SolutionBoardProps) {
  const t = useTranslations("solution");
  const [panelOpen, setPanelOpen] = useState(false);
  const [genState, genAction, genPending] = useActionState(
    generateComponentsAction.bind(null, projectId),
    INITIAL,
  );

  const stats = solutionStats(components, options);
  const empty = components.length === 0;
  const infra = components.filter((c) => c.type === "infrastructure");
  const personnel = components.filter((c) => c.type === "personnel");

  const rule = (label: string) => (
    <div className="mb-3 mt-6 flex items-center gap-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink-tertiary first:mt-0">
      {label}
      <span className="h-px flex-1 bg-neutral-150" />
    </div>
  );

  return (
    <div className="overflow-hidden rounded-shell border border-line bg-surface shadow-card">
      {/* ── Sötét topbar ── */}
      <div className="flex flex-wrap items-center gap-3 bg-[#23262F] px-5 py-2.5 text-[#EDEEF3]">
        <span className="flex items-center gap-2 text-[15px] font-extrabold tracking-[-0.02em] text-white">
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-control bg-action text-[13px]">A</span>
          {t("title")}
        </span>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[#9EA2B5]">{projectLabel}</span>
        <span className="rounded-pill bg-[rgba(255,255,255,.08)] px-2.5 py-0.5 font-mono text-[10.5px] text-[#C9CBDA]">
          {t("compChip", { n: stats.total })}
          {stats.waiting.length > 0 && ` · ${t("waitChip", { m: stats.waiting.length })}`}
        </span>
        <div className="flex-1" />
        <span className="flex items-center gap-1.5 rounded-control border border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.06)] px-2.5 py-1 text-[11.5px] text-[#C9CBDA]">
          <span className="h-2 w-2 rounded-full bg-done" />
          {t("tobeChipLabel")} <b className="text-white">{t("tobeApproved", { v: tobeVersion })}</b>
        </span>
        <Link
          href={`/project/${projectId}/process/${mapId}`}
          className="rounded-control border border-[rgba(255,255,255,.2)] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[rgba(255,255,255,.08)]"
        >
          ↗ {t("mapLink")}
        </Link>
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="rounded-control bg-action px-3 py-1.5 text-[12px] font-semibold text-white"
        >
          + {t("addComponentCta")}
        </button>
      </div>

      {/* ── Figyelmeztetés-sor (döntés-állapot) ── */}
      {!empty && (
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-surface px-5 py-2.5 text-[12.5px]">
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-4 font-mono text-[11px] font-bold text-white ${
              stats.waiting.length > 0 ? "bg-gate" : "bg-done"
            }`}
          >
            {stats.waiting.length > 0 ? "!" : "✓"}
          </span>
          <span className="min-w-0 flex-1 leading-snug text-ink-secondary">
            <b className="text-ink">{t("warnDone", { done: stats.done, total: stats.total })}</b>{" "}
            {stats.waiting.length > 0
              ? t("warnWaiting", { names: stats.waiting.map((c) => c.name).join(" · ") })
              : t("allDone")}
          </span>
          {stats.aiSuggestedCount > 0 && (
            <span className="shrink-0 rounded-pill border border-[#CBD9F9] bg-tint-action px-2.5 py-0.5 font-mono text-[10px] font-bold text-action-deep">
              {t("aiCountChip", { n: stats.aiSuggestedCount })}
            </span>
          )}
        </div>
      )}

      {(genState.error || genState.notice) && (
        <div className="border-b border-line bg-surface px-5 py-2 text-[12px]">
          {genState.error && <span className="text-danger">{genState.error}</span>}
          {genState.notice && <span className="text-gate-text">{genState.notice}</span>}
        </div>
      )}

      <div className="bg-[#F4F5F9] p-5">
        {/* ── Gerinc + dokk ── */}
        {rule(t("spineLabel"))}
        <div className="overflow-x-auto pb-1">
          <div
            className="grid min-w-fit gap-3"
            style={{ gridTemplateColumns: `repeat(${Math.max(steps.length, 1)}, minmax(215px, 1fr))` }}
          >
            {steps.map((s) => (
              <div
                key={s.nodeId}
                data-testid={`spine-${s.num}`}
                className="rounded-tile border border-[#CBD9F9] bg-surface px-3.5 py-2.5 shadow-card-sm"
              >
                <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-action-deep">
                  {t("stepChip", { num: s.num })}
                </div>
                <div className="mt-0.5 truncate text-[13px] font-bold leading-snug" title={s.title}>
                  {s.title}
                </div>
              </div>
            ))}
            {/* dokk-sor: kötés-vonal + dokkolt folyamat-komponensek */}
            {steps.map((s) => {
              const docked = dockedComponents(s.nodeId, components, links);
              return (
                <div key={`dock-${s.nodeId}`} className="flex min-w-0 flex-col items-stretch">
                  <div className="mx-auto h-4 w-px bg-[#B9CCF7]" />
                  {docked.length > 0 ? (
                    <div className="flex flex-col gap-2.5">
                      {docked.map((c) => (
                        <ComponentCard
                          key={c.id}
                          projectId={projectId}
                          component={c}
                          options={options}
                          coverageChip={null}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-tile border-[1.5px] border-dashed border-neutral-350 bg-[#FBFBFD] px-3 py-4 text-center">
                      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-tertiary">
                        {t("emptyDock")}
                      </span>
                      {!empty && (
                        <button
                          type="button"
                          onClick={() => setPanelOpen(true)}
                          className="rounded-3 border border-[#B9CCF7] bg-surface px-2 py-0.5 font-mono text-[9.5px] font-bold text-action-deep hover:bg-accent-tint"
                        >
                          +
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {empty ? (
          /* ── Üres állapot (5. jelenet): CTA az első komponensre ── */
          <div className="mt-6 flex flex-col items-center gap-3 rounded-shell border-[1.5px] border-dashed border-[#B9CCF7] bg-[#F7FAFE] px-5 py-8 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-shell bg-tint-action text-[18px] font-bold text-action">+</span>
            <span className="text-[15px] font-extrabold tracking-[-0.01em]">{t("emptyTitle")}</span>
            <p className="max-w-[560px] text-[12.5px] leading-[1.5] text-ink-secondary">{t("emptyText")}</p>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => setPanelOpen(true)}
                className="rounded-control bg-action px-4 py-2 text-[12.5px] font-bold text-white"
              >
                + {t("emptyAddCta")}
              </button>
              <form action={genAction}>
                <button
                  type="submit"
                  disabled={genPending}
                  className="rounded-control border border-[#B9CCF7] bg-surface px-4 py-2 text-[12.5px] font-semibold text-action-deep hover:bg-accent-tint disabled:opacity-60"
                >
                  {genPending ? t("generating") : `✦ ${t("emptyGenCta")}`}
                </button>
              </form>
            </div>
            <p className="font-mono text-[10.5px] text-ink-tertiary">{t("emptyGenHint", { steps: steps.length })}</p>
          </div>
        ) : (
          <>
            {/* ── Infrastruktúra-sáv ── */}
            {infra.length > 0 && (
              <>
                {rule(t("infraLabel"))}
                <div className="flex flex-col gap-2.5">
                  {infra.map((c) => {
                    const cov = coverageOf(c.id, links, steps);
                    const chip = cov.all
                      ? `↔ ${t("servesAll")}`
                      : cov.nums.length > 0
                        ? `↕ ${t("servesLabel", { range: cov.range ?? cov.nums.join(", ") })}`
                        : null;
                    return (
                      <ComponentCard
                        key={c.id}
                        projectId={projectId}
                        component={c}
                        options={options}
                        coverageChip={chip}
                        wide
                      />
                    );
                  })}
                </div>
              </>
            )}

            {/* ── Személyi / szervezeti sáv ── */}
            {personnel.length > 0 && (
              <>
                {rule(t("personnelLabel"))}
                <div className="grid gap-2.5 min-[900px]:grid-cols-2">
                  {personnel.map((c) => {
                    const bound = linkedStepsOf(c.id, links, steps);
                    const chip =
                      bound.length > 0
                        ? `↕ ${t("boundTo", { num: bound.map((s) => s.num).join(", ") })}`
                        : t("notBound");
                    return (
                      <ComponentCard
                        key={c.id}
                        projectId={projectId}
                        component={c}
                        options={options}
                        coverageChip={chip}
                        wide
                      />
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {panelOpen && (
        <AddComponentPanel projectId={projectId} steps={steps} onClose={() => setPanelOpen(false)} />
      )}
    </div>
  );
}

// ── Komponens-kártya (dokkolt / sáv-beli) ────────────────────

function ComponentCard({
  projectId,
  component,
  options,
  coverageChip,
  wide,
}: {
  projectId: string;
  component: SolutionComponentRow;
  options: ComponentOptionRow[];
  coverageChip: string | null;
  wide?: boolean;
}) {
  const t = useTranslations("solution");
  const tone = typeTone(component.type);
  const opts = optionsOf(component.id, options);
  const selected = selectedOption(component.id, options);
  const typeLabel =
    component.type === "process"
      ? t("typeProcess")
      : component.type === "infrastructure"
        ? t("typeInfra")
        : t("typePersonnel");

  const [, confirmAct, confirmPending] = useActionState(
    confirmComponentAction.bind(null, projectId, component.id),
    INITIAL,
  );
  const [, rejectAct, rejectPending] = useActionState(
    rejectComponentAction.bind(null, projectId, component.id),
    INITIAL,
  );

  return (
    <div
      data-testid={`comp-${component.name}`}
      className={`flex min-w-0 flex-col gap-1.5 rounded-tile border border-line border-l-4 bg-surface p-3.5 shadow-card-sm ${tone.border}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`rounded-3 px-1.5 py-px font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] ${tone.chipBg} ${tone.text}`}>
          {typeLabel}
        </span>
        {component.state === "ai_suggested" && (
          <span className="rounded-3 bg-tint-action px-1.5 py-px font-mono text-[8.5px] font-bold text-action-deep">
            ✦ {t("aiBadge")}
          </span>
        )}
        {coverageChip && (
          <span className="ml-auto rounded-3 bg-sunken px-1.5 py-px font-mono text-[9px] font-bold text-ink-secondary">
            {coverageChip}
          </span>
        )}
      </div>
      <span className={`text-[13.5px] font-bold leading-snug ${wide ? "" : "truncate"}`} title={component.name}>
        {component.name}
      </span>
      {component.description && (
        <span className={`text-[11.5px] leading-[1.45] text-ink-secondary ${wide ? "" : "line-clamp-2"}`}>
          {component.description}
        </span>
      )}
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
        {selected ? (
          <span className="max-w-full truncate rounded-3 border border-[#CDE7DA] bg-tint-done px-1.5 py-px font-mono text-[9px] font-bold text-done-text">
            ✓ {selected.name}
          </span>
        ) : (
          <span className="rounded-3 border border-[#EADFC0] bg-tint-gate px-1.5 py-px font-mono text-[9px] font-bold text-gate-text">
            ● {t("decisionWaiting")}
          </span>
        )}
        <span className="font-mono text-[9.5px] text-ink-tertiary">{t("optionCount", { n: opts.length })}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {component.state === "ai_suggested" && (
            <>
              <form action={confirmAct}>
                <button
                  type="submit"
                  disabled={confirmPending || rejectPending}
                  className="rounded-3 bg-done px-1.5 py-px font-mono text-[8.5px] font-bold text-white disabled:opacity-60"
                >
                  ✓ {t("confirmCta")}
                </button>
              </form>
              <form action={rejectAct}>
                <button
                  type="submit"
                  disabled={confirmPending || rejectPending}
                  className="rounded-3 border border-neutral-350 bg-surface px-1.5 py-px font-mono text-[8.5px] font-bold text-ink-secondary disabled:opacity-60"
                >
                  {t("rejectCta")}
                </button>
              </form>
            </>
          )}
          <Link
            href={`/project/${projectId}/solution/c/${component.id}`}
            className="font-mono text-[9px] font-semibold text-action-deep hover:underline"
          >
            {t("detailLink")} ↗
          </Link>
        </span>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  addControlAction,
  addLinkAction,
  addPromptAction,
  confirmControlAction,
  generateBuildDocAction,
  rejectControlAction,
  syncDocAction,
  updatePromptAction,
  rejectPromptAction,
} from "@/app/builddoc-actions";
import { BuildComponentDetail } from "@/components/BuildComponentDetail";
import { BuildAddPanel, type SeedItem } from "@/components/BuildAddPanel";
import { coverageRows, elementIndex, linksOfComponent, resolveLink, byDisplayId, type PlanElement } from "@/lib/builddoc/model";
import type { FormState } from "@/app/actions";
import type {
  ArtifactStatus,
  BuildComponentRow,
  ControlPointRow,
  ImplLinkRow,
  ImplTargetType,
  PromptItemRow,
} from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Megoldás-dok. board (#15): 1. áttekintő (5 szekció-csempe + komponens-
// tábla a KÉT kötés-oszloppal) · 3. kétirányú lefedettség (PASSZÍV tükör —
// nincs pontszám) · 4. prompt-könyvtár · 5. kontrollpontok · 7. üres
// állapot. A 2. (részlet ★) és 6. (felvétel) jelenet overlay-komponens.
// ─────────────────────────────────────────────────────────────

const INITIAL: FormState = { ok: true, error: null };

export interface SpineOption {
  nodeId: string;
  label: string;
  title: string;
}

export interface BuildDocBoardProps {
  projectId: string;
  projectLabel: string;
  components: BuildComponentRow[];
  links: ImplLinkRow[];
  prompts: PromptItemRow[];
  controls: ControlPointRow[];
  seeds: SeedItem[];
  /** komponens-id → P2-komponens név (eredet-felirat). */
  originLabels: Record<string, string>;
  elements: PlanElement[];
  spine: SpineOption[];
  doc: { id: string; status: ArtifactStatus } | null;
  docExtras: { architektura: boolean; integracio: boolean };
  sourceCount: number;
}

export function LayerChip({ layer }: { layer: BuildComponentRow["layer_type"] }) {
  const t = useTranslations("builddoc");
  const cls =
    layer === "process"
      ? "border-[#B9CCF7] bg-accent-fill text-action-deep"
      : layer === "infrastructure"
        ? "border-[#C7DEEF] bg-tint-sky text-pivot"
        : "border-[#EADFC0] bg-tint-gate text-gate-text";
  return (
    <span className={`rounded-3 border px-1.5 py-px font-mono text-[9px] font-bold ${cls}`}>
      {t(`layer.${layer}`)}
    </span>
  );
}

export function AiBadge() {
  const t = useTranslations("builddoc");
  return (
    <span className="rounded-3 bg-tint-action px-1.5 py-px font-mono text-[8.5px] font-bold text-action-deep">
      ✦ {t("aiBadge")}
    </span>
  );
}

export function StatusBadge({ status }: { status: ArtifactStatus }) {
  const t = useTranslations("artifacts");
  const cls =
    status === "approved"
      ? "border-[#CDE7DA] bg-tint-done text-done-text"
      : status === "in_review"
        ? "border-[#EADFC0] bg-tint-gate text-gate-text"
        : "border-line bg-soft text-ink-secondary";
  return (
    <span className={`rounded-pill border px-2.5 py-0.5 font-mono text-[10px] font-bold ${cls}`}>
      {t(`status.${status}`)}
    </span>
  );
}

/** Terv-elem chip — kattintható (kétirányú bejárás: a lefedettség-nézetre
 *  ugrik és kiemeli a cél-típust). */
function TargetChip({
  element,
  suggested,
  onNavigate,
}: {
  element: PlanElement;
  suggested?: boolean;
  onNavigate?: () => void;
}) {
  const cls = suggested
    ? "border-dashed border-[#8FAcee] bg-tint-action text-action-deep"
    : element.targetType === "tobe_node"
      ? "border-[#C7DEEF] bg-tint-sky text-pivot"
      : element.targetType === "pain_point"
        ? "border-[#EADFC0] bg-tint-gate text-gate-text"
        : "border-[#B9CCF7] bg-surface text-action-deep";
  return (
    <button
      type="button"
      onClick={onNavigate}
      title={element.title}
      className={`rounded-3 border px-1.5 py-px font-mono text-[9.5px] font-bold ${cls} ${onNavigate ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
    >
      {suggested ? "✦ " : ""}
      {element.label}
    </button>
  );
}

type ViewKey = "components" | "coverage" | "prompts" | "controls";

export function BuildDocBoard({
  projectId,
  projectLabel,
  components,
  links,
  prompts,
  controls,
  seeds,
  originLabels,
  elements,
  spine,
  doc,
  docExtras,
  sourceCount,
}: BuildDocBoardProps) {
  const t = useTranslations("builddoc");
  const [view, setView] = useState<ViewKey>("components");
  const [coverageType, setCoverageType] = useState<ImplTargetType>("requirement");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [genState, genAction, genPending] = useActionState(
    generateBuildDocAction.bind(null, projectId),
    INITIAL,
  );
  const [syncState, syncAct, syncPending] = useActionState(syncDocAction.bind(null, projectId), INITIAL);

  const sorted = byDisplayId(components);
  const empty = components.length === 0;
  const index = elementIndex(elements);
  const detail = detailId ? sorted.find((c) => c.id === detailId) ?? null : null;

  /** Kétirányú bejárás: elem-chipről a lefedettség-nézetre. */
  const jumpToElement = (el: PlanElement) => {
    setDetailId(null);
    setCoverageType(el.targetType);
    setView("coverage");
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── Fejléc ── */}
      <div className="overflow-hidden rounded-shell border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-tertiary">
              {projectLabel}
              <span className="rounded-3 bg-tint-action px-1.5 py-px font-bold text-action-deep">{t("subLabel")}</span>
            </div>
            <h1 className="mt-0.5 text-[19px] font-extrabold tracking-[-0.01em]">{t("title")}</h1>
          </div>
          <div className="flex-1" />
          {/* Draft → In review → Approved lánc-kijelző */}
          <span className="flex items-center gap-1.5 rounded-pill border border-line bg-soft px-3 py-1 font-mono text-[10px] text-ink-tertiary">
            {doc ? <StatusBadge status={doc.status} /> : <i>{t("noDocYet")}</i>}
          </span>
          <form action={syncAct}>
            <button
              type="submit"
              disabled={syncPending}
              className="rounded-control border border-[#B9CCF7] bg-surface px-3 py-1.5 text-[11.5px] font-semibold text-action-deep hover:bg-accent-tint disabled:opacity-60"
            >
              {t("syncCta")}
            </button>
          </form>
          {doc && (
            <Link
              href={`/project/${projectId}/artifact/${doc.id}`}
              className="rounded-control border border-neutral-350 bg-surface px-3 py-1.5 text-[11.5px] font-semibold text-ink-secondary hover:bg-soft"
            >
              {t("openDocCta")} ↗
            </Link>
          )}
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="rounded-control bg-action px-3 py-1.5 text-[12px] font-semibold text-white"
          >
            + {t("addComponentCta")}
          </button>
        </div>

        {(genState.error || genState.notice || syncState.error) && (
          <div className="border-b border-line px-5 py-2 text-[12px]">
            {(genState.error ?? syncState.error) && (
              <span className="text-danger">{genState.error ?? syncState.error}</span>
            )}
            {genState.notice && <span className="text-gate-text">{genState.notice}</span>}
          </div>
        )}

        {!empty && (
          <>
            {/* ── 5 szekció-csempe (1. jelenet) ── */}
            <div className="grid grid-cols-2 gap-0 border-b border-line min-[980px]:grid-cols-5">
              {(
                [
                  ["architektura", docExtras.architektura ? t("secFilled") : t("secMissing"), null],
                  ["komponensek", t("secCount", { n: components.length }), "components"],
                  ["promptKonyvtar", t("secCount", { n: prompts.length }), "prompts"],
                  ["kontrollpontok", t("secCount", { n: controls.length }), "controls"],
                  ["integracio", docExtras.integracio ? t("secFilled") : t("secMissing"), null],
                ] as const
              ).map(([key, sub, target], i) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => target && setView(target)}
                  className={`flex flex-col items-start gap-0.5 border-line px-4 py-3 text-left ${i < 4 ? "min-[980px]:border-r" : ""} ${
                    target ? "cursor-pointer hover:bg-soft" : "cursor-default"
                  } ${target && view === target ? "bg-accent-tint" : ""}`}
                >
                  <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
                    {i + 1} · {t(`sec.${key}`)}
                  </span>
                  <span className="text-[12px] font-semibold text-ink-secondary">{sub}</span>
                </button>
              ))}
            </div>

            {/* nézet-váltó */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-5 py-2.5">
              {(
                [
                  ["components", t("viewComponents", { n: components.length })],
                  ["coverage", t("viewCoverage")],
                  ["prompts", t("viewPrompts", { n: prompts.length })],
                  ["controls", t("viewControls", { n: controls.length })],
                ] as const
              ).map(([key, lbl]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  className={`rounded-pill border px-3 py-1 text-[11.5px] font-semibold ${
                    view === key
                      ? "border-action bg-action text-white"
                      : "border-neutral-350 bg-surface text-ink-secondary hover:bg-soft"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </>
        )}

        {empty ? (
          /* ── 7. jelenet: üres állapot ── */
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-shell bg-tint-action text-[18px] font-bold text-action">⌂</span>
            <h2 className="text-[16px] font-extrabold tracking-[-0.01em]">{t("emptyTitle")}</h2>
            <p className="max-w-[580px] text-[12.5px] leading-[1.55] text-ink-secondary">{t("emptyText")}</p>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="rounded-control bg-action px-4 py-2 text-[12.5px] font-bold text-white"
              >
                {t("emptySeedCta")}
                {seeds.length > 0 && (
                  <span className="ml-1.5 font-mono text-[10px] opacity-80">
                    {t("emptySeedCount", { n: seeds.length })}
                  </span>
                )}
              </button>
              <form action={genAction}>
                <button
                  type="submit"
                  disabled={genPending || sourceCount === 0}
                  title={sourceCount === 0 ? t("emptyNoSources") : undefined}
                  className="rounded-control border border-[#B9CCF7] bg-surface px-4 py-2 text-[12.5px] font-semibold text-action-deep hover:bg-accent-tint disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {genPending ? t("generating") : `✦ ${t("emptyGenCta")}`}
                </button>
              </form>
              <Link
                href={`/project/${projectId}/sources`}
                className="rounded-control border border-neutral-350 bg-surface px-4 py-2 text-[12.5px] font-semibold text-ink-secondary hover:bg-soft"
              >
                ↥ {t("emptyUploadCta")}
              </Link>
            </div>
            <p className="max-w-[560px] text-[11.5px] leading-[1.5] text-ink-tertiary">{t("emptyNote")}</p>
          </div>
        ) : view === "components" ? (
          /* ── 1. jelenet: komponens-tábla a KÉT kötés-oszloppal ── */
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-sunken font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
                <th className="px-5 py-2">{t("colComponent")}</th>
                <th className="px-3 py-2">{t("colOrigin")}</th>
                <th className="px-5 py-2">{t("colImplements")}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const grouped = linksOfComponent(c.id, links);
                const all = [...grouped.requirement, ...grouped.story, ...grouped.tobe_node, ...grouped.pain_point];
                const active = all.filter((l) => l.state !== "ai_suggested");
                const suggested = all.length - active.length;
                const origin = originLabels[c.id] ?? null;
                return (
                  <tr
                    key={c.id}
                    data-testid={`row-${c.display_id}`}
                    onClick={() => setDetailId(c.id)}
                    className="cursor-pointer border-b border-line-row hover:bg-soft"
                  >
                    <td className="px-5 py-2.5 align-top">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-bold text-pivot">{c.display_id}</span>
                        <LayerChip layer={c.layer_type} />
                        {c.state === "ai_suggested" && <AiBadge />}
                        <span className="text-[12.5px] font-semibold">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      {origin ? (
                        <span className="rounded-3 border border-[#CDE7DA] bg-tint-done px-1.5 py-px font-mono text-[9.5px] font-bold text-done-text">
                          P2 · {origin}
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] italic text-ink-tertiary">{t("originManual")}</span>
                      )}
                    </td>
                    <td className="px-5 py-2.5 align-top">
                      <div className="flex flex-wrap items-center gap-1">
                        {active.length === 0 && suggested === 0 && (
                          <span className="font-mono text-[10px] italic text-ink-tertiary">{t("noImplLinks")}</span>
                        )}
                        {active.map((l) => {
                          const el = resolveLink(l, index);
                          return el ? <TargetChip key={l.id} element={el} /> : null;
                        })}
                        {suggested > 0 && (
                          <span className="rounded-3 border border-dashed border-[#8FACEE] bg-tint-action px-1.5 py-px font-mono text-[9px] font-bold text-action-deep">
                            ✦ +{suggested} {t("suggestedShort")}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : view === "coverage" ? (
          <CoverageView
            elements={elements}
            links={links}
            components={sorted}
            coverageType={coverageType}
            setCoverageType={setCoverageType}
            projectId={projectId}
            onOpenComponent={(id) => setDetailId(id)}
          />
        ) : view === "prompts" ? (
          <PromptLibrary projectId={projectId} prompts={prompts} components={sorted} />
        ) : (
          <ControlsView projectId={projectId} controls={controls} spine={spine} index={index} />
        )}
      </div>

      {detail && (
        <BuildComponentDetail
          projectId={projectId}
          component={detail}
          links={links.filter((l) => l.component_id === detail.id)}
          prompts={prompts.filter((p) => p.component_id === detail.id)}
          originLabel={originLabels[detail.id] ?? null}
          elements={elements}
          onNavigate={jumpToElement}
          onClose={() => setDetailId(null)}
        />
      )}
      {addOpen && (
        <BuildAddPanel projectId={projectId} seeds={seeds} onClose={() => setAddOpen(false)} />
      )}
    </div>
  );
}

// ── 3. jelenet: kétirányú lefedettség (PASSZÍV tükör) ────────

function CoverageView({
  elements,
  links,
  components,
  coverageType,
  setCoverageType,
  projectId,
  onOpenComponent,
}: {
  elements: PlanElement[];
  links: ImplLinkRow[];
  components: BuildComponentRow[];
  coverageType: ImplTargetType;
  setCoverageType: (t: ImplTargetType) => void;
  projectId: string;
  onOpenComponent: (id: string) => void;
}) {
  const t = useTranslations("builddoc");
  const rows = coverageRows(
    elements.filter((e) => e.targetType === coverageType),
    links,
    components,
  );
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-5 py-2.5">
        <span className="mr-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
          {t("coverageLead")}
        </span>
        {(["requirement", "story", "tobe_node", "pain_point"] as ImplTargetType[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setCoverageType(key)}
            className={`rounded-pill border px-3 py-1 text-[11.5px] font-semibold ${
              coverageType === key
                ? "border-action bg-action text-white"
                : "border-neutral-350 bg-surface text-ink-secondary hover:bg-soft"
            }`}
          >
            {t(`target.${key}`)}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2.5 bg-[#F4F5F9] p-4">
        {rows.length === 0 && (
          <p className="px-2 py-4 text-center text-[12px] italic text-ink-tertiary">{t("coverageNoElements")}</p>
        )}
        {rows.map(({ element, components: covering, suggestedCount }) => (
          <div
            key={`${element.targetType}:${element.targetId}`}
            data-testid={`cov-${element.label}`}
            className="rounded-tile border border-line bg-surface p-3.5 shadow-card-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] font-bold text-pivot">{element.label}</span>
              {element.badge && (
                <span className="rounded-3 border border-line bg-sunken px-1.5 py-px font-mono text-[8.5px] font-bold text-ink-secondary">
                  {element.badge}
                </span>
              )}
              <span className="min-w-0 flex-1 text-[12.5px]">{element.title}</span>
            </div>
            {covering.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
                  {t("coveringComponents", { n: covering.length })}
                </span>
                {covering.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onOpenComponent(c.id)}
                    className="flex items-center gap-1.5 rounded-3 border border-[#B9CCF7] bg-surface px-2 py-0.5 text-[11px] font-semibold text-action-deep hover:bg-accent-tint"
                  >
                    <span className="font-mono text-[9.5px] font-bold">{c.display_id}</span>
                    {c.name} ›
                  </button>
                ))}
                {suggestedCount > 0 && (
                  <span className="font-mono text-[9.5px] text-action-deep">✦ +{suggestedCount} {t("suggestedShort")}</span>
                )}
              </div>
            ) : (
              /* AC4: „nincs lefedő komponens" — passzív, pontszám nélkül */
              <div className="mt-2 flex flex-wrap items-center gap-2.5 rounded-tile border border-dashed border-neutral-350 bg-[#FBFBFD] px-3 py-2">
                <span className="min-w-0 flex-1 text-[11.5px] text-ink-tertiary">
                  <b className="text-ink-secondary">{t("noCoverTitle")}</b> — {t("noCoverNote")}
                  {suggestedCount > 0 && (
                    <span className="ml-1 font-mono text-[10px] text-action-deep">✦ +{suggestedCount} {t("suggestedShort")}</span>
                  )}
                </span>
                <ElementBindForm projectId={projectId} element={element} components={components} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Elem-oldali kötés-felvétel (a lefedettség-nézet CTA-ja). */
function ElementBindForm({
  projectId,
  element,
  components,
}: {
  projectId: string;
  element: PlanElement;
  components: BuildComponentRow[];
}) {
  const t = useTranslations("builddoc");
  const [state, action, pending] = useActionState(addLinkAction.bind(null, projectId), INITIAL);
  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="target_type" value={element.targetType} />
      <input type="hidden" name="target_id" value={element.targetId} />
      <select
        name="component_id"
        className="rounded-tile border border-neutral-350 bg-surface px-2 py-1 text-[11px] outline-none focus:border-pivot"
      >
        {components.map((c) => (
          <option key={c.id} value={c.id}>
            {c.display_id} · {c.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending || components.length === 0}
        className="rounded-control border border-[#B9CCF7] bg-surface px-2.5 py-1 text-[11px] font-semibold text-action-deep hover:bg-accent-tint disabled:opacity-60"
      >
        + {t("bindComponentCta")}
      </button>
      {state.error && <span className="text-[10px] text-danger">{state.error}</span>}
    </form>
  );
}

// ── 4. jelenet: prompt-könyvtár ──────────────────────────────

function PromptLibrary({
  projectId,
  prompts,
  components,
}: {
  projectId: string;
  prompts: PromptItemRow[];
  components: BuildComponentRow[];
}) {
  const t = useTranslations("builddoc");
  const sorted = byDisplayId(prompts);
  const [selectedId, setSelectedId] = useState<string | null>(sorted[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const selected = sorted.find((p) => p.id === selectedId) ?? null;
  const compById = new Map(components.map((c) => [c.id, c]));

  return (
    <div className="grid min-[900px]:grid-cols-[320px_minmax(0,1fr)]">
      <div className="flex flex-col border-b border-line min-[900px]:border-b-0 min-[900px]:border-r">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
            {t("promptListTitle", { n: prompts.length })}
          </span>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="ml-auto rounded-control border border-[#B9CCF7] bg-surface px-2 py-1 text-[11px] font-semibold text-action-deep hover:bg-accent-tint"
          >
            + {t("addPromptCta")}
          </button>
        </div>
        <div className="flex max-h-[460px] flex-col overflow-y-auto">
          {sorted.length === 0 && (
            <p className="px-4 py-6 text-center text-[12px] italic text-ink-tertiary">{t("promptEmpty")}</p>
          )}
          {sorted.map((p) => {
            const comp = compById.get(p.component_id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => { setSelectedId(p.id); setAdding(false); }}
                className={`flex flex-col gap-0.5 border-b border-line-row px-4 py-2.5 text-left ${
                  selectedId === p.id && !adding ? "bg-accent-tint" : "hover:bg-soft"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] font-bold text-pivot">{p.display_id}</span>
                  <span className="text-[12.5px] font-semibold">{p.name}</span>
                  {p.state === "ai_suggested" && <AiBadge />}
                </span>
                {p.purpose && <span className="line-clamp-1 text-[11px] text-ink-secondary">{p.purpose}</span>}
                {comp && (
                  <span className="font-mono text-[9.5px] text-ink-tertiary">
                    {t("promptBinds")}: <b className="text-action-deep">{comp.display_id}</b>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="p-4">
        {adding ? (
          <PromptForm projectId={projectId} prompt={null} components={components} onDone={() => setAdding(false)} />
        ) : selected ? (
          <PromptDetail projectId={projectId} prompt={selected} component={compById.get(selected.component_id) ?? null} components={components} />
        ) : (
          <p className="py-8 text-center text-[12px] italic text-ink-tertiary">{t("promptPick")}</p>
        )}
      </div>
    </div>
  );
}

function PromptDetail({
  projectId,
  prompt,
  component,
  components,
}: {
  projectId: string;
  prompt: PromptItemRow;
  component: BuildComponentRow | null;
  components: BuildComponentRow[];
}) {
  const t = useTranslations("builddoc");
  const [editing, setEditing] = useState(false);
  const [rejectState, rejectAct, rejectPending] = useActionState(
    rejectPromptAction.bind(null, projectId, prompt.id),
    INITIAL,
  );
  if (editing) {
    return <PromptForm projectId={projectId} prompt={prompt} components={components} onDone={() => setEditing(false)} />;
  }
  return (
    <div className="flex flex-col gap-3" data-testid={`prompt-${prompt.display_id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] font-bold text-pivot">{prompt.display_id}</span>
        <span className="text-[15px] font-extrabold">{prompt.name}</span>
        {prompt.state === "ai_suggested" && <AiBadge />}
        <span className="ml-auto flex gap-1.5">
          {prompt.state === "ai_suggested" && (
            <form action={rejectAct}>
              <button type="submit" disabled={rejectPending} className="rounded-control border border-neutral-350 px-2.5 py-1 text-[11.5px] font-semibold text-ink-secondary hover:bg-soft disabled:opacity-60">
                × {t("rejectCta")}
              </button>
            </form>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-control border border-[#B9CCF7] bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-action-deep hover:bg-accent-tint"
          >
            ✎ {t("editCta")}
          </button>
        </span>
      </div>
      {rejectState.error && <p className="text-[11px] text-danger">{rejectState.error}</p>}
      {prompt.purpose && (
        <div>
          <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">{t("promptPurpose")}</div>
          <p className="mt-0.5 text-[12.5px] leading-[1.5]">{prompt.purpose}</p>
        </div>
      )}
      {component && (
        <div className="font-mono text-[10.5px] text-ink-secondary">
          {t("promptComponent")}: <b className="text-action-deep">{component.display_id} · {component.name}</b>
        </div>
      )}
      <div>
        <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">{t("promptText")}</div>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-tile border border-line bg-[#23262F] px-3.5 py-3 font-mono text-[11.5px] leading-[1.6] text-[#D6E4D6]">
          {prompt.prompt_text || t("promptTextEmpty")}
        </pre>
        <p className="mt-1 text-[10.5px] text-ink-tertiary">{t("promptHitlNote")}</p>
      </div>
    </div>
  );
}

function PromptForm({
  projectId,
  prompt,
  components,
  onDone,
}: {
  projectId: string;
  prompt: PromptItemRow | null;
  components: BuildComponentRow[];
  onDone: () => void;
}) {
  const t = useTranslations("builddoc");
  const action = prompt
    ? updatePromptAction.bind(null, projectId, prompt.id)
    : addPromptAction.bind(null, projectId);
  const [state, act, pending] = useActionState(
    async (prev: FormState, formData: FormData) => {
      const result = await action(prev, formData);
      if (result.ok && !result.error) onDone();
      return result;
    },
    INITIAL,
  );
  return (
    <form action={act} className="flex flex-col gap-2.5">
      <div className="grid gap-2.5 min-[700px]:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">{t("fName")}</span>
          <input name="name" defaultValue={prompt?.name ?? ""} className="rounded-tile border border-neutral-350 px-3 py-1.5 text-[12.5px] outline-none focus:border-pivot" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">{t("promptComponent")}</span>
          <select
            name="component_id"
            defaultValue={prompt?.component_id ?? components[0]?.id ?? ""}
            disabled={prompt !== null}
            className="rounded-tile border border-neutral-350 bg-surface px-3 py-1.5 text-[12.5px] outline-none focus:border-pivot disabled:opacity-60"
          >
            {components.map((c) => (
              <option key={c.id} value={c.id}>{c.display_id} · {c.name}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">{t("promptPurpose")}</span>
        <input name="purpose" defaultValue={prompt?.purpose ?? ""} className="rounded-tile border border-neutral-350 px-3 py-1.5 text-[12.5px] outline-none focus:border-pivot" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">{t("promptText")}</span>
        <textarea
          name="prompt_text"
          rows={7}
          defaultValue={prompt?.prompt_text ?? ""}
          className="rounded-tile border border-neutral-350 px-3 py-2 font-mono text-[11.5px] leading-[1.55] outline-none focus:border-pivot"
        />
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

// ── 5. jelenet: kontrollpontok ───────────────────────────────

function ControlsView({
  projectId,
  controls,
  spine,
  index,
}: {
  projectId: string;
  controls: ControlPointRow[];
  spine: SpineOption[];
  index: Map<string, PlanElement>;
}) {
  const t = useTranslations("builddoc");
  const [adding, setAdding] = useState(false);
  const suggested = controls.filter((c) => c.state === "ai_suggested").length;
  const ordered = [...controls].sort((a, b) => a.ord - b.ord);

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-2.5">
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
          {t("controlsTitle", { n: controls.length })}
        </span>
        {suggested > 0 && (
          <span className="rounded-3 bg-tint-action px-2 py-px font-mono text-[9.5px] font-bold text-action-deep">
            ✦ {t("controlsSuggested", { n: suggested })}
          </span>
        )}
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="ml-auto rounded-control border border-[#B9CCF7] bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-action-deep hover:bg-accent-tint"
        >
          + {t("addControlCta")}
        </button>
      </div>
      {adding && <ControlForm projectId={projectId} spine={spine} onDone={() => setAdding(false)} />}
      <div className="flex flex-col">
        {ordered.length === 0 && (
          <p className="px-5 py-6 text-center text-[12px] italic text-ink-tertiary">{t("controlsEmpty")}</p>
        )}
        {ordered.map((c) => (
          <ControlRow key={c.id} projectId={projectId} control={c} index={index} />
        ))}
      </div>
    </div>
  );
}

function ControlRow({
  projectId,
  control,
  index,
}: {
  projectId: string;
  control: ControlPointRow;
  index: Map<string, PlanElement>;
}) {
  const t = useTranslations("builddoc");
  const [confirmState, confirmAct, confirmPending] = useActionState(
    confirmControlAction.bind(null, projectId, control.id),
    INITIAL,
  );
  const [rejectState, rejectAct, rejectPending] = useActionState(
    rejectControlAction.bind(null, projectId, control.id),
    INITIAL,
  );
  const el = control.node_id ? index.get(`tobe_node:${control.node_id}`) ?? null : null;
  const suggested = control.state === "ai_suggested";

  return (
    <div
      data-testid={`ctrl-${control.name.slice(0, 12)}`}
      className={`flex flex-wrap items-start gap-3 border-b border-line-row px-5 py-3 ${suggested ? "bg-tint-action/40" : ""}`}
    >
      <span
        className={`mt-0.5 shrink-0 rounded-3 border px-2 py-px font-mono text-[9px] font-bold ${
          control.kind === "guardrail"
            ? "border-[#F0CBD3] bg-[#FBECEF] text-[#C0455A]"
            : "border-[#C7DEEF] bg-tint-sky text-pivot"
        }`}
      >
        {t(`kind.${control.kind}`)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12.5px] font-bold">{control.name}</span>
          {suggested && <AiBadge />}
        </div>
        {control.description && (
          <p className="mt-0.5 text-[11.5px] leading-[1.5] text-ink-secondary">{control.description}</p>
        )}
      </div>
      <span className="mt-0.5 shrink-0">
        {el ? (
          <span className="rounded-3 border border-[#C7DEEF] bg-tint-sky px-1.5 py-px font-mono text-[9.5px] font-bold text-pivot" title={el.title}>
            ◆ {el.label}
          </span>
        ) : (
          <span className="font-mono text-[10px] italic text-ink-tertiary">{t("noTobeBinding")}</span>
        )}
      </span>
      <span className="mt-0.5 flex shrink-0 items-center gap-1.5">
        {suggested ? (
          <>
            <form action={confirmAct}>
              <button type="submit" disabled={confirmPending} className="rounded-control bg-action px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-60">
                ✓ {t("confirmCta")}
              </button>
            </form>
            <form action={rejectAct}>
              <button type="submit" disabled={rejectPending} className="rounded-control border border-neutral-350 px-2.5 py-1 text-[11px] font-semibold text-ink-secondary hover:bg-soft disabled:opacity-60">
                × {t("rejectCta")}
              </button>
            </form>
          </>
        ) : (
          <span className="font-mono text-[10px] font-bold text-done-text">✓ {t("confirmedBadge")}</span>
        )}
      </span>
      {(confirmState.error || rejectState.error) && (
        <p className="w-full text-[10.5px] text-danger">{confirmState.error ?? rejectState.error}</p>
      )}
    </div>
  );
}

function ControlForm({
  projectId,
  spine,
  onDone,
}: {
  projectId: string;
  spine: SpineOption[];
  onDone: () => void;
}) {
  const t = useTranslations("builddoc");
  const [state, act, pending] = useActionState(
    async (prev: FormState, formData: FormData) => {
      const result = await addControlAction(projectId, prev, formData);
      if (result.ok && !result.error) onDone();
      return result;
    },
    INITIAL,
  );
  return (
    <form action={act} className="flex flex-col gap-2.5 border-b border-line bg-soft px-5 py-3">
      <div className="grid gap-2.5 min-[860px]:grid-cols-[minmax(0,1fr)_150px_220px]">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">{t("fName")}</span>
          <input name="name" className="rounded-tile border border-neutral-350 px-3 py-1.5 text-[12.5px] outline-none focus:border-pivot" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">{t("fKind")}</span>
          <select name="kind" className="rounded-tile border border-neutral-350 bg-surface px-3 py-1.5 text-[12.5px] outline-none focus:border-pivot">
            <option value="guardrail">{t("kind.guardrail")}</option>
            <option value="hitl">{t("kind.hitl")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">{t("fTobeStep")}</span>
          <select name="node_id" className="rounded-tile border border-neutral-350 bg-surface px-3 py-1.5 text-[12.5px] outline-none focus:border-pivot">
            <option value="">{t("noTobeBinding")}</option>
            {spine.map((s) => (
              <option key={s.nodeId} value={s.nodeId}>{s.label} · {s.title}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">{t("fDescription")}</span>
        <input name="description" className="rounded-tile border border-neutral-350 px-3 py-1.5 text-[12.5px] outline-none focus:border-pivot" />
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

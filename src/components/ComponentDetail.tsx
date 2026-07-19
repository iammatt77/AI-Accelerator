"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  addCriterionAction,
  addOptionAction,
  generateOptionsAction,
  selectOptionAction,
  unselectOptionAction,
} from "@/app/solution-actions";
import { typeTone } from "@/components/SolutionBoard";
import {
  BASE_CRITERIA,
  criteriaKeysOf,
  customCriterionLabel,
  linkedStepsOf,
  parseCriteriaValues,
  selectedOption,
  type SpineStep,
} from "@/lib/solution/model";
import type { FormState } from "@/app/actions";
import type {
  ComponentOptionRow,
  ComponentStepLinkRow,
  SolutionComponentRow,
} from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Komponens-részlet (#12, ref 2./3./4. jelenet):
//  · folyamat-komp. → teljes opció-összevető mátrix (szempont × opció,
//    nyertes oszlop kiemelve, üres cella = „nincs megadva", + szempont)
//  · infra → lefedettség-viz a TO-BE gerincen (✓ a fedett lépéseken)
//  · személyi → ∞ „nem lépéshez kötött" vagy a kötött lépés
//  · HITL-kiválasztás: az AI AJÁNL (✦), de a nyertest az EMBER rögzíti —
//    ki, mikor, indoklás; a döntés forrásig visszavezethető.
// ─────────────────────────────────────────────────────────────

const INITIAL: FormState = { ok: true, error: null };

// Ismert érték → tónus (a ref színnyelvtana); ismeretlen érték semleges mono.
function valueTone(value: string): string | null {
  const v = value.toLowerCase();
  if (["alacsony", "nincs", "kiváló", "jó", "low", "none", "excellent", "good"].includes(v))
    return "border-[#CDE7DA] bg-tint-done text-done-text";
  if (["közepes", "medium"].includes(v)) return "border-[#EADFC0] bg-tint-gate text-gate-text";
  if (["magas", "high"].includes(v)) return "border-[#F0CBD3] bg-[#FBECEF] text-[#C0455A]";
  return null;
}

function fmtDate(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`.trim();
}

function CellValue({ value, note }: { value: string; note?: string }) {
  const t = useTranslations("solution");
  const tone = value ? valueTone(value) : null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {value ? (
        tone ? (
          <span className={`w-fit rounded-3 border px-2 py-px font-mono text-[10px] font-bold ${tone}`}>{value}</span>
        ) : (
          <span className="font-mono text-[12px] font-bold text-ink">{value}</span>
        )
      ) : (
        <span className="font-mono text-[10.5px] italic text-ink-tertiary">— {t("notGiven")}</span>
      )}
      {note && <span className="text-[10.5px] leading-[1.4] text-ink-secondary">{note}</span>}
    </div>
  );
}

export function ComponentDetail({
  projectId,
  projectLabel,
  component,
  steps,
  links,
  options,
  sourceChips,
}: {
  projectId: string;
  projectLabel: string;
  component: SolutionComponentRow;
  steps: SpineStep[];
  links: ComponentStepLinkRow[];
  options: ComponentOptionRow[];
  sourceChips: { n: number; title: string }[];
}) {
  const t = useTranslations("solution");
  const tone = typeTone(component.type);
  const bound = linkedStepsOf(component.id, links, steps);
  const selected = selectedOption(component.id, options);
  const aiOptionCount = options.filter((o) => o.ai_recommended).length > 0 ? options.length : 0;

  const typeLabel =
    component.type === "process"
      ? t("typeProcessFull")
      : component.type === "infrastructure"
        ? t("typeInfra")
        : t("typePersonnel");

  const [genState, genAction, genPending] = useActionState(
    generateOptionsAction.bind(null, projectId, component.id),
    INITIAL,
  );

  return (
    <div className="overflow-hidden rounded-shell border border-line bg-surface shadow-card">
      {/* ── Fejléc: breadcrumb + típus + kötés ── */}
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-[#FBFBFD] px-5 py-3">
        <span className="min-w-0 truncate font-mono text-[10.5px] text-ink-tertiary">
          <Link href={`/project/${projectId}/solution`} className="hover:text-action-deep hover:underline">
            {t("breadcrumbRoot")}
          </Link>
          {bound[0] && <span> → TO-BE {bound[0].num} {bound[0].title}</span>}
          <span> → </span>
        </span>
        <h1 className="text-[17px] font-extrabold tracking-[-0.01em]">{component.name}</h1>
        <span className={`rounded-3 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] ${tone.chipBg} ${tone.text}`}>
          {typeLabel}
        </span>
        {component.state === "ai_suggested" && (
          <span className="rounded-3 bg-tint-action px-1.5 py-px font-mono text-[9px] font-bold text-action-deep">
            ✦ {t("aiBadge")}
          </span>
        )}
        <div className="flex-1" />
        {component.type === "process" && bound[0] && (
          <span className="rounded-pill border border-[#C7DEEF] bg-tint-sky px-2.5 py-1 font-mono text-[10.5px] font-bold text-pivot">
            {t("bindsChip", { num: bound[0].num })}
          </span>
        )}
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-tertiary">{projectLabel}</span>
      </div>

      {/* ── Leírás + AI-jegyzet ── */}
      <div className="flex flex-wrap items-start gap-4 border-b border-line px-5 py-4">
        <p className="min-w-[260px] max-w-[640px] flex-1 text-[13px] leading-[1.55] text-ink-secondary">
          {component.description || "—"}
        </p>
        {options.length > 0 && aiOptionCount > 0 && (
          <div className="flex max-w-[380px] items-start gap-2 rounded-tile border border-[#CBD9F9] bg-tint-action px-3.5 py-2.5 text-[12px] leading-[1.5] text-[#17357F]">
            <span aria-hidden>✦</span>
            <span>{t.rich("aiProposedNote", { n: aiOptionCount, b: (c) => <b>{c}</b> })}</span>
          </div>
        )}
      </div>

      {/* ── Infra: lefedettség-viz · Személyi: kötés-doboz ── */}
      {component.type === "infrastructure" && steps.length > 0 && (
        <div className="border-b border-line px-5 py-4">
          <div className="mb-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink-tertiary">
            {t("coverageLabel")}
          </div>
          <div className="flex flex-wrap gap-2">
            {steps.map((s) => {
              const covered = bound.some((b) => b.nodeId === s.nodeId);
              return (
                <span
                  key={s.nodeId}
                  data-testid={`cov-${s.num}`}
                  className={`rounded-tile border px-4 py-1.5 font-mono text-[11px] font-bold ${
                    covered
                      ? "border-pivot bg-tint-sky text-pivot"
                      : "border-line bg-surface text-ink-tertiary"
                  }`}
                >
                  {s.num}
                  {covered && " ✓"}
                </span>
              );
            })}
          </div>
          {bound.length > 0 && bound.length !== steps.length && (
            <p className="mt-2 text-[12px] text-ink-secondary">
              {t("servesText", { list: bound.map((s) => `${s.num} ${s.title}`).join(" · ") })}
            </p>
          )}
        </div>
      )}
      {component.type === "personnel" && (
        <div className="border-b border-line px-5 py-4">
          <div className="mb-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink-tertiary">
            {t("bindingLabel")}
          </div>
          {bound.length === 0 ? (
            <div className="flex items-start gap-3 rounded-tile border-[1.5px] border-dashed border-[#EADFC0] bg-tint-gate/40 px-4 py-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-4 bg-gate font-mono text-[13px] font-bold text-white">∞</span>
              <p className="text-[12.5px] leading-[1.5] text-ink-secondary">
                <b className="text-ink">{t("unboundTitle")}</b> {t("unboundText")}
              </p>
            </div>
          ) : (
            <span className="rounded-pill border border-[#EADFC0] bg-tint-gate px-2.5 py-1 font-mono text-[10.5px] font-bold text-gate-text">
              ↕ {t("boundTo", { num: bound.map((s) => `${s.num} ${s.title}`).join(", ") })}
            </span>
          )}
        </div>
      )}

      {/* ── Opciók ── */}
      <div className="bg-[#F4F5F9] p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2.5">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink-tertiary">
            {t("optionsLabel", { n: options.length })}
          </span>
          <span className="h-px flex-1 bg-neutral-150" />
          {options.length === 0 && (
            <form action={genAction}>
              <button
                type="submit"
                disabled={genPending}
                className="rounded-control border border-[#B9CCF7] bg-surface px-3 py-1.5 text-[12px] font-semibold text-action-deep hover:bg-accent-tint disabled:opacity-60"
              >
                {genPending ? t("generating") : `✦ ${t("genOptionsCta")}`}
              </button>
            </form>
          )}
          <AddOptionButton projectId={projectId} componentId={component.id} />
        </div>
        {(genState.error || genState.notice) && (
          <div className="mb-3 text-[12px]">
            {genState.error && <span className="text-danger">{genState.error}</span>}
            {genState.notice && <span className="text-gate-text">{genState.notice}</span>}
          </div>
        )}

        {options.length === 0 ? (
          <div className="rounded-tile border-[1.5px] border-dashed border-neutral-350 bg-[#FBFBFD] px-4 py-6 text-center text-[12.5px] text-ink-tertiary">
            {t("noOptionsYet")}
          </div>
        ) : component.type === "process" ? (
          <OptionMatrix projectId={projectId} component={component} options={options} selectedId={selected?.id ?? null} />
        ) : (
          <MiniOptions options={options} selectedId={selected?.id ?? null} />
        )}

        {/* ── Döntés-zóna (HITL) ── */}
        {options.length > 0 && (
          <DecisionZone
            projectId={projectId}
            component={component}
            options={options}
            selected={selected ?? null}
            sourceChips={sourceChips}
          />
        )}
      </div>
    </div>
  );
}

// ── Teljes mátrix (2. jelenet): szempont-sorok × opció-oszlopok ──

function OptionMatrix({
  projectId,
  component,
  options,
  selectedId,
}: {
  projectId: string;
  component: SolutionComponentRow;
  options: ComponentOptionRow[];
  selectedId: string | null;
}) {
  const t = useTranslations("solution");
  const keys = criteriaKeysOf(options);
  const letters = "ABCDEFGH";
  const parsed = options.map((o) => parseCriteriaValues(o.criteria_values));
  const winnerCls = (id: string) => (id === selectedId ? "bg-[#F7FAFE]" : "bg-surface");

  return (
    <div className="overflow-x-auto rounded-tile border border-line bg-surface shadow-card-sm">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            <th className="w-[150px] bg-sunken px-3.5 py-3 align-bottom font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
              {t("matrixCriterion")}
            </th>
            {options.map((o, i) => (
              <th key={o.id} className={`min-w-[200px] border-l border-line px-3.5 py-3 align-top ${winnerCls(o.id)}`}>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-action-deep">
                    {t("optionColLabel", { letter: letters[i] ?? "?" })}
                  </span>
                  {o.id === selectedId && (
                    <span className="rounded-pill bg-action px-2 py-px font-mono text-[8.5px] font-bold text-white">
                      ✓ {t("selectedBadge")}
                    </span>
                  )}
                  {o.ai_recommended && o.id !== selectedId && (
                    <span className="rounded-3 border border-[#CBD9F9] bg-tint-action px-1.5 py-px font-mono text-[8.5px] font-bold text-action-deep">
                      ✦ {t("aiRecommendBadge")}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[14px] font-extrabold leading-tight tracking-[-0.01em]">{o.name}</div>
                {o.description && (
                  <div className="mt-0.5 text-[10.5px] font-normal leading-[1.4] text-ink-secondary">{o.description}</div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const isBase = (BASE_CRITERIA as readonly string[]).includes(key);
            const label = isBase ? t(`criteria.${key}`) : (customCriterionLabel(options, key) ?? key);
            return (
              <tr key={key} className="border-b border-line-soft">
                <td className="bg-sunken px-3.5 py-3 align-top">
                  <span className="font-mono text-[10.5px] font-bold text-ink">{label}</span>
                  {!isBase && (
                    <span className="block font-mono text-[8.5px] text-action-deep">+ {t("addCriterionCta")}</span>
                  )}
                </td>
                {options.map((o, i) => {
                  const cell = parsed[i][key];
                  return (
                    <td key={o.id} className={`border-l border-line px-3.5 py-3 align-top ${winnerCls(o.id)}`}>
                      <CellValue value={cell?.value ?? ""} note={cell?.note} />
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {/* + szempont ghost */}
          <tr className="border-b border-line-soft">
            <td colSpan={options.length + 1} className="bg-surface px-3.5 py-2">
              <AddCriterionForm projectId={projectId} componentId={component.id} options={options} />
            </td>
          </tr>
          {/* Indoklás-sor */}
          {options.some((o) => o.rationale) && (
            <tr>
              <td className="bg-sunken px-3.5 py-3 align-top font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
                {t("rationaleLabel")}
              </td>
              {options.map((o) => (
                <td key={o.id} className={`border-l border-line px-3.5 py-3 align-top text-[11.5px] leading-[1.5] ${winnerCls(o.id)} ${o.id === selectedId ? "font-semibold text-[#17357F]" : "text-ink-secondary"}`}>
                  {o.rationale || "—"}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Mini-összevetés (3. jelenet): infra / személyi opció-kártyák ──

function MiniOptions({ options, selectedId }: { options: ComponentOptionRow[]; selectedId: string | null }) {
  const t = useTranslations("solution");
  return (
    <div className="flex flex-col gap-2.5">
      {options.map((o) => {
        const cv = parseCriteriaValues(o.criteria_values);
        const mini: [string, string][] = [
          [t("criteria.cost"), cv.cost?.value ?? ""],
          [t("miniLeadLabel"), cv.lead_time?.value ?? ""],
          [t("criteria.risk"), cv.risk?.value ?? ""],
        ];
        const isSel = o.id === selectedId;
        return (
          <div
            key={o.id}
            data-testid={`opt-${o.name}`}
            className={`rounded-tile border bg-surface p-3.5 shadow-card-sm ${
              isSel ? "border-[1.5px] border-action-deep" : "border-line"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-[13.5px] font-bold ${isSel ? "text-action-deep" : ""}`}>{o.name}</span>
              {isSel && (
                <span className="rounded-pill bg-action px-2 py-px font-mono text-[8.5px] font-bold text-white">
                  ✓ {t("selectedBadge")}
                </span>
              )}
              {o.ai_recommended && !isSel && (
                <span className="rounded-3 border border-[#CBD9F9] bg-tint-action px-1.5 py-px font-mono text-[8.5px] font-bold text-action-deep">
                  ✦ {t("aiRecommendBadge")}
                </span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
              {mini.map(([label, value]) => (
                <span key={label} className="flex items-center gap-1.5 text-[11px] text-ink-secondary">
                  {label}{" "}
                  {value ? (
                    <b className={`font-mono text-[11px] ${valueTone(value) ? "" : ""}`}>{value}</b>
                  ) : (
                    <i className="font-mono text-[10px] text-ink-tertiary">{t("notGiven")}</i>
                  )}
                </span>
              ))}
            </div>
            {o.description && <p className="mt-1.5 text-[11px] leading-[1.45] text-ink-secondary">{o.description}</p>}
          </div>
        );
      })}
    </div>
  );
}

// ── Döntés-zóna: ELŐTTE (AI ajánl, ember gomb) / UTÁNA (rögzítve) ──

function DecisionZone({
  projectId,
  component,
  options,
  selected,
  sourceChips,
}: {
  projectId: string;
  component: SolutionComponentRow;
  options: ComponentOptionRow[];
  selected: ComponentOptionRow | null;
  sourceChips: { n: number; title: string }[];
}) {
  const t = useTranslations("solution");
  const [unselState, unselAction, unselPending] = useActionState(
    unselectOptionAction.bind(null, projectId, component.id),
    INITIAL,
  );

  if (selected) {
    // UTÁNA (2./4. jelenet): a döntés emberi, rögzített, visszavezethető
    const initials = (selected.selected_by ?? "?")
      .split(/\s+/)
      .map((w) => w[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase();
    const matches = selected.ai_recommended;
    return (
      <div
        data-testid="decision-recorded"
        className="mt-4 flex flex-wrap items-center gap-3 rounded-tile border border-[#CBD9F9] bg-tint-action px-4 py-3"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-action-deep font-mono text-[11px] font-bold text-white">
          {initials}
        </span>
        <span className="min-w-0 flex-1 text-[12.5px] leading-[1.5] text-[#17357F]">
          {t.rich("decisionRecorded", {
            name: selected.name,
            by: selected.selected_by ?? "?",
            date: selected.selected_at ? fmtDate(selected.selected_at) : "?",
            b: (c) => <b>{c}</b>,
          })}{" "}
          <span className="font-mono text-[10.5px]">{matches ? t("matchesAi") : t("differsAi")}</span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center gap-1.5">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-[#1C50CD]">{t("traceLabel")}</span>
          {sourceChips.length > 0 ? (
            sourceChips.map((c) => (
              <span key={c.n} className="rounded-3 border border-[#B9CCF7] bg-surface px-1.5 py-px font-mono text-[9.5px] font-bold text-action-deep">
                [{c.n}] {c.title.slice(0, 28)}
              </span>
            ))
          ) : (
            <span className="font-mono text-[9.5px] italic text-ink-tertiary">{t("traceNone")}</span>
          )}
        </span>
        <form action={unselAction}>
          <button
            type="submit"
            disabled={unselPending}
            className="rounded-control border border-neutral-350 bg-surface px-3 py-1.5 text-[11.5px] font-semibold text-ink-secondary hover:text-ink disabled:opacity-60"
          >
            {t("changeSelectionCta")}
          </button>
        </form>
        {unselState.error && <span className="text-[11px] text-danger">{unselState.error}</span>}
      </div>
    );
  }

  // ELŐTTE (4. jelenet): a rendszer nem választ helyetted — a gomb a tiéd
  const recommended = options.find((o) => o.ai_recommended);
  return (
    <div data-testid="decision-pending" className="mt-4 rounded-tile border border-line bg-surface p-4">
      <div className="mb-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-gate-text">
        ● {t("decideHead", { n: options.length })}
      </div>
      {recommended && (
        <div className="mb-3 flex items-start gap-2 rounded-tile border border-[#CBD9F9] bg-tint-action px-3.5 py-2.5 text-[12px] leading-[1.5] text-[#17357F]">
          <span aria-hidden>✦</span>
          <span>{t.rich("aiRecommendNote", { name: recommended.name, b: (c) => <b>{c}</b> })}</span>
        </div>
      )}
      <SelectForms projectId={projectId} componentId={component.id} options={options} />
    </div>
  );
}

function SelectForms({
  projectId,
  componentId,
  options,
}: {
  projectId: string;
  componentId: string;
  options: ComponentOptionRow[];
}) {
  const t = useTranslations("solution");
  const [pickedId, setPickedId] = useState(options.find((o) => o.ai_recommended)?.id ?? options[0]?.id ?? "");
  const picked = options.find((o) => o.id === pickedId);
  const [state, action, pending] = useActionState(
    selectOptionAction.bind(null, projectId, componentId),
    INITIAL,
  );

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="option_id" value={pickedId} />
      {/* a kiválasztandó opció — az ember dönt, gombbal */}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setPickedId(o.id)}
            className={`rounded-tile border px-3.5 py-2 text-left text-[12.5px] font-semibold ${
              o.id === pickedId
                ? "border-[1.5px] border-action-deep bg-[#F7FAFE] text-action-deep"
                : "border-neutral-350 bg-surface text-ink-secondary hover:bg-soft"
            }`}
          >
            {o.name}
            {o.ai_recommended && <span className="ml-1.5 font-mono text-[9px]">✦</span>}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[180px] flex-col gap-1">
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
            {t("selectorField")}
          </span>
          <input
            name="selected_by"
            placeholder={t("defaultSelector")}
            className="rounded-tile border border-neutral-350 px-3 py-2 text-[12.5px] outline-none focus:border-pivot"
          />
        </label>
        <label className="flex min-w-[240px] flex-1 flex-col gap-1">
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
            {t("rationaleLabel")}
          </span>
          <input
            name="rationale"
            className="rounded-tile border border-neutral-350 px-3 py-2 text-[12.5px] outline-none focus:border-pivot"
          />
        </label>
        <button
          type="submit"
          disabled={pending || !picked}
          data-testid="select-cta"
          className="rounded-control bg-action px-4 py-2.5 text-[12.5px] font-bold text-white disabled:opacity-60"
        >
          {picked ? t("selectCta", { name: picked.name }) : "—"}
        </button>
      </div>
      {state.error && <p className="text-[12px] text-danger">{state.error}</p>}
    </form>
  );
}

// ── „+ szempont" (mátrix-bővítés) ────────────────────────────

function AddCriterionForm({
  projectId,
  componentId,
  options,
}: {
  projectId: string;
  componentId: string;
  options: ComponentOptionRow[];
}) {
  const t = useTranslations("solution");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    addCriterionAction.bind(null, projectId, componentId),
    INITIAL,
  );
  useEffect(() => {
    if (state.ok && state.error === null && state !== INITIAL) setOpen(false);
  }, [state]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-mono text-[10.5px] font-bold text-action-deep hover:underline"
      >
        + {t("addCriterionCta")}
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-end gap-2.5 py-1">
      <label className="flex min-w-[170px] flex-col gap-1">
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
          {t("criterionLabelField")}
        </span>
        <input name="label" required className="rounded-tile border border-neutral-350 px-2.5 py-1.5 text-[12px] outline-none focus:border-pivot" />
      </label>
      {options.map((o) => (
        <label key={o.id} className="flex min-w-[130px] flex-col gap-1">
          <span className="max-w-[140px] truncate font-mono text-[9px] text-ink-tertiary">{o.name}</span>
          <input name={`val_${o.id}`} className="rounded-tile border border-neutral-350 px-2.5 py-1.5 text-[12px] outline-none focus:border-pivot" />
        </label>
      ))}
      <button type="submit" disabled={pending} className="rounded-control bg-action px-3 py-1.5 text-[11.5px] font-bold text-white disabled:opacity-60">
        {t("saveCta")}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="rounded-control border border-neutral-350 px-3 py-1.5 text-[11.5px] font-semibold text-ink-secondary">
        {t("cancelCta")}
      </button>
      {state.error && <span className="text-[11px] text-danger">{state.error}</span>}
      <span className="text-[10px] text-ink-tertiary">{t("criterionValueHint")}</span>
    </form>
  );
}

// ── „+ Opció" (kézi opció-felvétel) ──────────────────────────

function AddOptionButton({ projectId, componentId }: { projectId: string; componentId: string }) {
  const t = useTranslations("solution");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    addOptionAction.bind(null, projectId, componentId),
    INITIAL,
  );
  useEffect(() => {
    if (state.ok && state.error === null && state !== INITIAL) setOpen(false);
  }, [state]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-control border border-neutral-350 bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-secondary hover:text-ink"
      >
        + {t("addOptionCta")}
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-[rgba(35,38,47,0.4)] p-6 pt-16" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-[560px] overflow-hidden rounded-shell border border-line bg-surface shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 border-b border-line bg-tint-sky px-5 py-3">
              <span className="flex h-5 w-5 items-center justify-center rounded-4 bg-pivot font-bold text-white">+</span>
              <span className="text-[14px] font-bold">{t("panelAddOptionTitle")}</span>
              <button type="button" onClick={() => setOpen(false)} className="ml-auto text-[13px] font-semibold text-ink-secondary hover:text-ink">
                ✕
              </button>
            </div>
            <form action={action} className="flex flex-col gap-3.5 p-5">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">{t("fieldName")}</span>
                <input name="name" required className="rounded-tile border border-neutral-350 px-3 py-2 text-[13px] outline-none focus:border-pivot" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">{t("fieldDesc")}</span>
                <input name="description" className="rounded-tile border border-neutral-350 px-3 py-2 text-[13px] outline-none focus:border-pivot" />
              </label>
              <div className="grid gap-2.5 min-[520px]:grid-cols-2">
                {(BASE_CRITERIA as readonly string[]).map((key) => (
                  <label key={key} className="flex flex-col gap-1">
                    <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
                      {t(`criteria.${key}`)} <span className="normal-case">· {t("bindOptional")}</span>
                    </span>
                    <input name={`crit_${key}`} className="rounded-tile border border-neutral-350 px-3 py-1.5 text-[12.5px] outline-none focus:border-pivot" />
                  </label>
                ))}
              </div>
              {state.error && <p className="text-[12px] text-danger">{state.error}</p>}
              <div className="flex items-center justify-end gap-2 border-t border-line-soft pt-3">
                <button type="button" onClick={() => setOpen(false)} className="rounded-control border border-neutral-350 px-3.5 py-2 text-[12.5px] font-semibold text-ink-secondary">
                  {t("cancelCta")}
                </button>
                <button type="submit" disabled={pending} className="rounded-control bg-action px-4 py-2 text-[12.5px] font-bold text-white disabled:opacity-60">
                  {t("saveCta")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

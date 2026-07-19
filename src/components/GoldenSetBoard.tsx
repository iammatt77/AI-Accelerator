"use client";

import Link from "next/link";
import { useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  classifyAction,
  generateEvalCasesAction,
  recordActualAction,
  setOverrideAction,
  setThresholdAction,
  suggestResidualRiskAction,
  suggestVerdictAction,
  syncReportAction,
} from "@/app/goldenset-actions";
import { EvalCaseEditor } from "@/components/EvalCaseEditor";
import {
  caseStatus,
  formatAnswerValue,
  orderedCriteria,
  parseAiCriteria,
  parseAnswerConfig,
  passStats,
  failedCaseLines,
  type CaseStatus,
} from "@/lib/goldenset/model";
import type { FormState } from "@/app/actions";
import type {
  ArtifactStatus,
  EvalCaseRow,
  EvalCriterionRow,
  GoldenSetRow,
  Verdict,
} from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Golden set board (#14): 1. áttekintő (tábla + pass% a küszöbhöz mérve)
// · 3. DINAMIKUS eredmény-rögzítő ★ (a mező a válasz-típushoz idomul —
// a rendszer nem futtat, a tanácsadó írja be) · 4. besorolás (✦ AI ajánl
// a kritériumokra hivatkozva, az EMBER dönt) · 5. Tesztriport-panel ·
// 6. sikerküszöb (EMBERI) + P3 fázis-kapu · 7. üres állapot.
// ─────────────────────────────────────────────────────────────

const INITIAL: FormState = { ok: true, error: null };

export interface GoldenSetBoardProps {
  projectId: string;
  projectLabel: string;
  useCaseTitle: string;
  set: GoldenSetRow | null;
  cases: EvalCaseRow[];
  criteria: EvalCriterionRow[];
  report: { id: string; status: ArtifactStatus; residual: string | null } | null;
  solutionDoc: { status: ArtifactStatus } | null;
  sourceChipsByCase: Record<string, { n: number; title: string }[]>;
}

function VerdictChip({ verdict, small }: { verdict: Verdict | null; small?: boolean }) {
  const t = useTranslations("goldenset");
  const sz = small ? "text-[8.5px] px-1.5" : "text-[9.5px] px-2";
  if (verdict === "passed")
    return <span className={`rounded-3 border border-[#CDE7DA] bg-tint-done font-mono ${sz} py-px font-bold text-done-text`}>✓ {t("verdict.passed")}</span>;
  if (verdict === "partial")
    return <span className={`rounded-3 border border-[#EADFC0] bg-tint-gate font-mono ${sz} py-px font-bold text-gate-text`}>~ {t("verdict.partial")}</span>;
  if (verdict === "failed")
    return <span className={`rounded-3 border border-[#F0CBD3] bg-[#FBECEF] font-mono ${sz} py-px font-bold text-[#C0455A]`}>× {t("verdict.failed")}</span>;
  return <span className="font-mono text-[10px] text-ink-tertiary">—</span>;
}

function StatusChip({ status }: { status: CaseStatus }) {
  const t = useTranslations("goldenset");
  if (status === "classified")
    return <span className="font-mono text-[10.5px] font-bold text-done-text">✓ {t("status.classified")}</span>;
  if (status === "to_classify")
    return <span className="font-mono text-[10.5px] font-bold text-pivot">◔ {t("status.to_classify")}</span>;
  return <span className="font-mono text-[10.5px] font-bold text-gate-text">● {t("status.to_record")}</span>;
}

function TypeChip({ type }: { type: EvalCaseRow["answer_type"] }) {
  const t = useTranslations("goldenset");
  return (
    <span className="rounded-3 border border-line bg-sunken px-2 py-px font-mono text-[9.5px] font-bold text-ink-secondary">
      {t(`type.${type}`)}
    </span>
  );
}

export function GoldenSetBoard({
  projectId,
  projectLabel,
  useCaseTitle,
  set,
  cases,
  criteria,
  report,
  solutionDoc,
  sourceChipsByCase,
}: GoldenSetBoardProps) {
  const t = useTranslations("goldenset");
  const [filter, setFilter] = useState<"all" | "to_record" | "failed">("all");
  const [editorCaseId, setEditorCaseId] = useState<string | "new" | null>(null);
  const [selectedClassifyId, setSelectedClassifyId] = useState<string | null>(null);
  const [genState, genAction, genPending] = useActionState(
    generateEvalCasesAction.bind(null, projectId),
    INITIAL,
  );

  const stats = passStats(cases);
  const empty = cases.length === 0;
  const threshold = set?.pass_threshold ?? null;
  const sorted = [...cases].sort((a, b) => a.display_id.localeCompare(b.display_id));
  const visible = sorted.filter((c) => {
    if (filter === "to_record") return caseStatus(c) === "to_record";
    if (filter === "failed") return c.final_verdict === "failed" || c.final_verdict === "partial";
    return true;
  });
  const toRecord = sorted.filter((c) => caseStatus(c) === "to_record");
  const toClassify = sorted.filter((c) => caseStatus(c) === "to_classify");
  const selectedClassified = selectedClassifyId
    ? sorted.find((c) => c.id === selectedClassifyId && caseStatus(c) === "classified") ?? null
    : null;

  const editorCase = editorCaseId && editorCaseId !== "new" ? sorted.find((c) => c.id === editorCaseId) ?? null : null;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Fejléc-kártya (1. jelenet fölső sávja) ── */}
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
          <span className="rounded-pill border border-line bg-soft px-3 py-1 text-[11.5px] text-ink-secondary">
            {t("useCaseChip")}: <b className="text-ink">{useCaseTitle}</b>
          </span>
          <button
            type="button"
            onClick={() => setEditorCaseId("new")}
            className="rounded-control bg-action px-3 py-1.5 text-[12px] font-semibold text-white"
          >
            + {t("addCaseCta")}
          </button>
        </div>

        {!empty && (
          <div className="grid gap-0 border-b border-line min-[900px]:grid-cols-[180px_minmax(0,1fr)_190px]">
            {/* esetek-számláló */}
            <div className="border-b border-line px-5 py-3.5 min-[900px]:border-b-0 min-[900px]:border-r">
              <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">{t("casesLabel")}</div>
              <div className="mt-0.5 font-mono text-[26px] font-bold leading-none">{stats.total}</div>
              <div className="mt-1 font-mono text-[10.5px] text-ink-tertiary">
                {t("classifiedSub", { c: stats.classified, w: stats.total - stats.classified })}
              </div>
            </div>
            {/* pass% sáv a küszöbhöz mérve */}
            <div className="border-b border-line px-5 py-3.5 min-[900px]:border-b-0 min-[900px]:border-r">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">{t("passLabel")}</span>
                <span data-testid="pass-pct" className={`font-mono text-[22px] font-bold leading-none ${threshold !== null && stats.pct < threshold ? "text-gate-text" : "text-done-text"}`}>
                  {stats.pct}%
                </span>
                <span className="text-[11.5px] text-ink-secondary">
                  {threshold === null
                    ? t("noThresholdLine")
                    : stats.pct < threshold
                      ? t("belowThresholdLine", { t: threshold })
                      : t("aboveThresholdLine", { t: threshold })}
                  {stats.open > 0 && <b className="text-gate-text"> {t("openSuffix", { n: stats.open })}</b>}
                </span>
              </div>
              <div className="relative mt-2 h-[14px] overflow-hidden rounded-pill bg-neutral-150">
                <div
                  className={`h-full rounded-pill ${threshold !== null && stats.pct < threshold ? "bg-done/80" : "bg-done"}`}
                  style={{ width: `${Math.min(stats.pct, 100)}%` }}
                />
                {threshold !== null && (
                  <div
                    className="absolute top-0 h-full w-[2px] bg-gate"
                    style={{ left: `${threshold}%` }}
                    title={t("thresholdChip", { t: threshold })}
                  />
                )}
              </div>
              {threshold !== null && (
                <div className="mt-1 text-right font-mono text-[9.5px] font-bold text-gate-text">{t("thresholdChip", { t: threshold })}</div>
              )}
            </div>
            {/* riport-chip */}
            <div className="px-5 py-3.5">
              <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">{t("reportChip")}</div>
              <div className="mt-1">
                {report ? (
                  <StatusBadge status={report.status} />
                ) : (
                  <span className="font-mono text-[11px] italic text-ink-tertiary">{t("noReportChip")}</span>
                )}
              </div>
              <div className="mt-1 font-mono text-[10px] text-ink-tertiary">
                {report?.status === "approved" && solutionDoc?.status === "approved" ? t("gateOpenShort") : t("gateClosedShort")}
              </div>
            </div>
          </div>
        )}

        {(genState.error || genState.notice) && (
          <div className="border-b border-line px-5 py-2 text-[12px]">
            {genState.error && <span className="text-danger">{genState.error}</span>}
            {genState.notice && <span className="text-gate-text">{genState.notice}</span>}
          </div>
        )}

        {empty ? (
          /* ── 7. jelenet: üres állapot ── */
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-shell bg-tint-action text-[18px] font-bold text-action">✓</span>
            <h2 className="text-[16px] font-extrabold tracking-[-0.01em]">{t("emptyTitle")}</h2>
            <p className="max-w-[560px] text-[12.5px] leading-[1.55] text-ink-secondary">{t("emptyText")}</p>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2.5">
              <form action={genAction}>
                <button
                  type="submit"
                  disabled={genPending}
                  className="rounded-control bg-action px-4 py-2 text-[12.5px] font-bold text-white disabled:opacity-60"
                >
                  {genPending ? t("generating") : `✦ ${t("genCta")}`}
                </button>
              </form>
              <button
                type="button"
                onClick={() => setEditorCaseId("new")}
                className="rounded-control border border-[#B9CCF7] bg-surface px-4 py-2 text-[12.5px] font-semibold text-action-deep hover:bg-accent-tint"
              >
                + {t("addCaseCta")}
              </button>
            </div>
            <p className="max-w-[520px] font-mono text-[10px] text-ink-tertiary">{t("genHint")}</p>
            <p className="max-w-[560px] text-[11.5px] leading-[1.5] text-ink-tertiary">{t("emptyNote")}</p>
          </div>
        ) : (
          <>
            {/* szűrő-chipek */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-5 py-2.5">
              {(
                [
                  ["all", `${t("filterAll")} · ${stats.total}`],
                  ["to_record", `${t("filterToRecord")} · ${toRecord.length}`],
                  ["failed", `${t("filterFailed")} · ${stats.failed + stats.partial}`],
                ] as const
              ).map(([key, lbl]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`rounded-pill border px-3 py-1 text-[11.5px] font-semibold ${
                    filter === key
                      ? "border-action bg-action text-white"
                      : "border-neutral-350 bg-surface text-ink-secondary hover:bg-soft"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            {/* ── 1. jelenet: eset-tábla ── */}
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-sunken font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
                  <th className="px-5 py-2">{t("colCase")}</th>
                  <th className="px-3 py-2">{t("colInput")}</th>
                  <th className="px-3 py-2">{t("colType")}</th>
                  <th className="px-3 py-2">{t("colStatus")}</th>
                  <th className="px-5 py-2">{t("colVerdict")}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => {
                  const st = caseStatus(c);
                  return (
                    <tr
                      key={c.id}
                      data-testid={`row-${c.display_id}`}
                      onClick={() => (st === "classified" ? setSelectedClassifyId(c.id) : setEditorCaseId(c.id))}
                      className="cursor-pointer border-b border-line-row hover:bg-soft"
                    >
                      <td className="px-5 py-2.5 align-top">
                        <span className="font-mono text-[11px] font-bold text-pivot">{c.display_id}</span>
                        {c.state === "ai_suggested" && <span className="ml-1 font-mono text-[9px] text-action-deep">✦</span>}
                      </td>
                      <td className="max-w-[420px] px-3 py-2.5 align-top">
                        <span className="line-clamp-1 text-[12.5px]">{c.input_text}</span>
                      </td>
                      <td className="px-3 py-2.5 align-top"><TypeChip type={c.answer_type} /></td>
                      <td className="px-3 py-2.5 align-top"><StatusChip status={st} /></td>
                      <td className="px-5 py-2.5 align-top"><VerdictChip verdict={c.final_verdict} small /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* ── 3. jelenet ★: dinamikus eredmény-rögzítő ── */}
      {!empty && (
        <div className="overflow-hidden rounded-shell border border-line bg-surface shadow-card">
          <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-[#23262F] px-5 py-2.5 text-[#EDEEF3]">
            <span className="text-[14px] font-extrabold text-white">{t("recorderTitle")}</span>
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-[#9EA2B5]">{t("recorderSub")}</span>
            <span className="rounded-pill bg-[rgba(255,255,255,.08)] px-2.5 py-0.5 font-mono text-[10.5px] text-[#C9CBDA]">
              {t("recordedCount", { done: stats.total - toRecord.length, total: stats.total })}
            </span>
            <span className="rounded-3 border border-[rgba(255,255,255,.2)] px-2 py-0.5 font-mono text-[9.5px] text-[#C9CBDA]">
              {t("noRun")}
            </span>
          </div>
          {toRecord.length === 0 ? (
            <div className="px-5 py-4 text-[12.5px] text-done-text">✓ {t("allRecorded")}</div>
          ) : (
            <div className="grid gap-3 bg-[#F4F5F9] p-4 min-[980px]:grid-cols-2">
              {toRecord.map((c) => (
                <RecorderCard key={c.id} projectId={projectId} caseRow={c} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 4. jelenet: besorolás (HITL) ── */}
      {!empty && (toClassify.length > 0 || selectedClassified) && (
        <div className="overflow-hidden rounded-shell border border-line bg-surface shadow-card">
          <div className="border-b border-line px-5 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink-tertiary">
            {t("classifySection")}
          </div>
          <div className="flex flex-col gap-4 bg-[#F4F5F9] p-4">
            {toClassify.map((c) => (
              <ClassifyPanel
                key={c.id}
                projectId={projectId}
                caseRow={c}
                criteria={criteria}
                sourceChips={sourceChipsByCase[c.id] ?? []}
              />
            ))}
            {selectedClassified && (
              <ClassifyPanel
                projectId={projectId}
                caseRow={selectedClassified}
                criteria={criteria}
                sourceChips={sourceChipsByCase[selectedClassified.id] ?? []}
              />
            )}
          </div>
        </div>
      )}

      {/* ── 5.+6. jelenet: Tesztriport · küszöb · P3 kapu ── */}
      {!empty && set && (
        <div className="grid gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_400px]">
          <ReportPanel projectId={projectId} set={set} cases={cases} report={report} />
          <div className="flex flex-col gap-4">
            <ThresholdPanel projectId={projectId} set={set} pct={stats.pct} />
            <GatePanel projectId={projectId} report={report} solutionDoc={solutionDoc} />
          </div>
        </div>
      )}

      {editorCaseId !== null && (
        <EvalCaseEditor
          projectId={projectId}
          existing={editorCase}
          criteria={criteria}
          sourceChips={editorCase ? (sourceChipsByCase[editorCase.id] ?? []) : []}
          onClose={() => setEditorCaseId(null)}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ArtifactStatus }) {
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

// ── ★ A dinamikus rögzítő-kártya: a mező a válasz-típushoz idomul (AC1) ──

function RecorderCard({ projectId, caseRow }: { projectId: string; caseRow: EvalCaseRow }) {
  const t = useTranslations("goldenset");
  const cfg = parseAnswerConfig(caseRow.answer_config);
  const [state, action, pending] = useActionState(
    recordActualAction.bind(null, projectId, caseRow.id),
    INITIAL,
  );
  const [scaleVal, setScaleVal] = useState(Math.round((cfg.min + cfg.max) / 2));

  return (
    <form
      action={action}
      data-testid={`rec-${caseRow.display_id}`}
      className="flex flex-col gap-2.5 rounded-tile border border-line bg-surface p-4 shadow-card-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] font-bold text-pivot">{caseRow.display_id}</span>
        <TypeChip type={caseRow.answer_type} />
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-secondary" title={caseRow.input_text}>
          {caseRow.input_text}
        </span>
      </div>

      {/* típusidomuló beviteli forma */}
      {caseRow.answer_type === "free_text" && (
        <div>
          <div className="mb-1 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">{t("actualLabel")}</div>
          <textarea
            name="actual_text"
            rows={4}
            className="w-full rounded-tile border border-neutral-350 px-3 py-2.5 text-[12.5px] leading-[1.55] outline-none focus:border-pivot"
          />
        </div>
      )}
      {caseRow.answer_type === "choice_single" && (
        <div className="flex flex-col gap-1.5">
          <div className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
            {cfg.label || t("actualLabel")}
          </div>
          {cfg.options.map((o) => (
            <label key={o} className="flex cursor-pointer items-center gap-2.5 rounded-tile border border-neutral-350 px-3.5 py-2 text-[12.5px] has-[:checked]:border-[1.5px] has-[:checked]:border-action has-[:checked]:bg-accent-fill has-[:checked]:font-bold has-[:checked]:text-action-deep">
              <input type="radio" name="actual_choice" value={o} className="accent-[#1F5AE8]" />
              {o}
            </label>
          ))}
        </div>
      )}
      {caseRow.answer_type === "choice_multi" && (
        <div>
          <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
            {cfg.label || t("actualLabel")}
          </div>
          <input type="hidden" name="actual_multi_present" value="1" />
          <div className="flex flex-wrap gap-1.5">
            {cfg.options.map((o) => (
              <label key={o} className="flex cursor-pointer items-center gap-1.5 rounded-pill border border-neutral-350 px-3 py-1.5 text-[12px] font-semibold has-[:checked]:border-action has-[:checked]:bg-accent-fill has-[:checked]:text-action-deep">
                <input type="checkbox" name="actual_choices" value={o} className="accent-[#1F5AE8]" />
                {o}
              </label>
            ))}
          </div>
        </div>
      )}
      {caseRow.answer_type === "number_scale" && (
        <div>
          <div className="mb-1 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
            {cfg.label || t("actualLabel")} ({cfg.min}–{cfg.max})
          </div>
          <div className="flex items-center gap-3">
            <span className="w-[76px] shrink-0 text-right font-mono text-[24px] font-bold text-action-deep">
              {scaleVal}
              <span className="text-[11px] text-ink-tertiary">/{cfg.max}</span>
            </span>
            <input
              type="range"
              name="actual_value"
              min={cfg.min}
              max={cfg.max}
              value={scaleVal}
              onChange={(e) => setScaleVal(Number(e.target.value))}
              className="min-w-0 flex-1 accent-[#1F5AE8]"
            />
          </div>
          <div className="mt-0.5 flex justify-between font-mono text-[9px] text-ink-tertiary">
            <span>{cfg.min}</span>
            <span>{Math.round((cfg.min + cfg.max) / 2)}</span>
            <span>{cfg.max}</span>
          </div>
        </div>
      )}
      {caseRow.answer_type === "yes_no" && (
        <div>
          <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
            {cfg.label || t("actualLabel")}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-tile border border-neutral-350 px-3 py-2.5 text-[13px] font-bold text-ink-secondary has-[:checked]:border-[1.5px] has-[:checked]:border-done has-[:checked]:bg-tint-done has-[:checked]:text-done-text">
              <input type="radio" name="actual_bool" value="yes" className="sr-only" />
              ✓ {t("yes")}
            </label>
            <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-tile border border-neutral-350 px-3 py-2.5 text-[13px] font-bold text-ink-secondary has-[:checked]:border-[1.5px] has-[:checked]:border-[#C0455A] has-[:checked]:bg-[#FBECEF] has-[:checked]:text-[#C0455A]">
              <input type="radio" name="actual_bool" value="no" className="sr-only" />
              × {t("no")}
            </label>
          </div>
        </div>
      )}

      {state.error && <p className="text-[11.5px] text-danger">{state.error}</p>}
      {state.notice && <p className="text-[11.5px] text-gate-text">{state.notice}</p>}
      <div className="mt-auto flex items-center justify-end gap-2 border-t border-line-soft pt-2.5">
        <button
          type="submit"
          name="with_ai"
          value="0"
          disabled={pending}
          className="rounded-control border border-neutral-350 bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-secondary disabled:opacity-60"
        >
          {t("recordCta")}
        </button>
        <button
          type="submit"
          name="with_ai"
          value="1"
          disabled={pending}
          className="rounded-control bg-action px-3.5 py-1.5 text-[12px] font-bold text-white disabled:opacity-60"
        >
          {pending ? t("generating") : `✦ ${t("recordAiCta")}`}
        </button>
      </div>
    </form>
  );
}

// ── 4. jelenet: besorolás-panel — ✦ AI ajánl, az EMBER dönt (AC3) ──

function ClassifyPanel({
  projectId,
  caseRow,
  criteria,
  sourceChips,
}: {
  projectId: string;
  caseRow: EvalCaseRow;
  criteria: EvalCriterionRow[];
  sourceChips: { n: number; title: string }[];
}) {
  const t = useTranslations("goldenset");
  const ordered = orderedCriteria(caseRow.id, criteria);
  const aiRefs = new Map(parseAiCriteria(caseRow.ai_criteria).map((r) => [r.ord, r.ok]));
  const actual = formatAnswerValue(caseRow.answer_type, caseRow.actual_output);
  const [classifyState, classifyAct, classifyPending] = useActionState(
    classifyAction.bind(null, projectId, caseRow.id),
    INITIAL,
  );
  const [aiState, aiAct, aiPending] = useActionState(
    suggestVerdictAction.bind(null, projectId, caseRow.id),
    INITIAL,
  );
  const [picked, setPicked] = useState<Verdict | null>(caseRow.final_verdict);
  const classified = caseRow.final_verdict !== null;

  return (
    <div
      data-testid={`classify-${caseRow.display_id}`}
      className="overflow-hidden rounded-tile border border-line bg-surface shadow-card-sm"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="font-mono text-[11px] font-bold text-pivot">{caseRow.display_id}</span>
        <TypeChip type={caseRow.answer_type} />
        <span className="text-[13.5px] font-bold">{t("classifyTitle")}</span>
        <span className="ml-auto flex items-center gap-1">
          <span className="font-mono text-[9.5px] text-ink-tertiary">{t("sourceLabel")}:</span>
          {sourceChips.length > 0 ? (
            sourceChips.map((c) => (
              <span key={c.n} className="rounded-3 border border-[#B9CCF7] bg-surface px-1.5 py-px font-mono text-[9.5px] font-bold text-action-deep">
                [{c.n}]
              </span>
            ))
          ) : (
            <span className="font-mono text-[9.5px] italic text-ink-tertiary">—</span>
          )}
        </span>
      </div>
      <div className="grid min-[860px]:grid-cols-2">
        {/* bal: bemenet + tényleges + kritériumok OK/BUKOTT jelzéssel */}
        <div className="border-b border-line p-4 min-[860px]:border-b-0 min-[860px]:border-r">
          <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">{t("inputShort")}</div>
          <p className="mt-1 rounded-tile bg-sunken px-3 py-2 text-[12.5px] leading-[1.5]">{caseRow.input_text}</p>
          <div className="mt-3 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">{t("actualShort")}</div>
          <p className="mt-1 rounded-tile border border-[#F0CBD3]/0 bg-sunken px-3 py-2 font-mono text-[12px] leading-[1.5]">
            {actual ?? "—"}
          </p>
          <div className="mt-3 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">{t("criteriaShort")}</div>
          <div className="mt-1 flex flex-col gap-1.5">
            {ordered.map((k, i) => {
              const ref = aiRefs.get(i + 1);
              return (
                <div
                  key={k.id}
                  className={`flex items-center gap-2 rounded-tile border px-3 py-1.5 ${
                    ref === false ? "border-[#F0CBD3] bg-[#FBECEF]" : ref === true ? "border-[#CDE7DA] bg-tint-done" : "border-line bg-surface"
                  }`}
                >
                  <span className="shrink-0 font-mono text-[10px] font-bold text-pivot">K{i + 1}</span>
                  <span className="min-w-0 flex-1 text-[12px] leading-[1.4]">{k.text}</span>
                  {ref !== undefined && (
                    <span className={`shrink-0 font-mono text-[8.5px] font-bold ${ref ? "text-done-text" : "text-[#C0455A]"}`}>
                      {ref ? t("okBadge") : t("failBadge")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {/* jobb: ✦ AI-ajánlás + emberi döntés */}
        <div className="flex flex-col gap-3 p-4">
          {caseRow.ai_verdict ? (
            <div className="rounded-tile border border-[#B9CCF7] bg-[#F6F9FE] p-3.5">
              <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-action-deep">✦ {t("aiSuggestionLabel")}</div>
              <div className="mt-1.5"><VerdictChip verdict={caseRow.ai_verdict} /></div>
              <p className="mt-2 text-[12px] leading-[1.55] text-ink-secondary">{caseRow.ai_rationale}</p>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-tile border border-dashed border-neutral-350 bg-[#FBFBFD] px-3.5 py-2.5">
              <span className="min-w-0 flex-1 text-[11.5px] text-ink-tertiary">{t("noAiYet")}</span>
              <form action={aiAct}>
                <button type="submit" disabled={aiPending} className="rounded-control border border-[#B9CCF7] bg-surface px-2.5 py-1.5 text-[11.5px] font-semibold text-action-deep hover:bg-accent-tint disabled:opacity-60">
                  {aiPending ? t("generating") : `✦ ${t("askAiCta")}`}
                </button>
              </form>
              {aiState.error && <span className="text-[10.5px] text-danger">{aiState.error}</span>}
            </div>
          )}

          <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-pivot">{t("judgeLine")}</div>
          <form action={classifyAct} className="flex flex-col gap-2.5">
            <input type="hidden" name="verdict" value={picked ?? ""} />
            <div className="grid grid-cols-3 gap-2">
              {(["passed", "partial", "failed"] as Verdict[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setPicked(v)}
                  className={`rounded-tile border px-2 py-2 text-[12.5px] font-bold ${
                    picked === v
                      ? v === "passed"
                        ? "border-[1.5px] border-done bg-tint-done text-done-text"
                        : v === "partial"
                          ? "border-[1.5px] border-gate bg-tint-gate text-gate-text"
                          : "border-[1.5px] border-[#C0455A] bg-[#C0455A] text-white"
                      : "border-neutral-350 bg-surface text-ink-secondary hover:bg-soft"
                  }`}
                >
                  {t(`verdict.${v}`)}
                  {picked === v && " ✓"}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-2.5">
              <label className="flex min-w-[160px] flex-1 flex-col gap-1">
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">{t("judgeField")}</span>
                <input
                  name="verdict_by"
                  defaultValue={caseRow.verdict_by ?? ""}
                  placeholder={t("defaultJudge")}
                  className="rounded-tile border border-neutral-350 px-3 py-1.5 text-[12.5px] outline-none focus:border-pivot"
                />
              </label>
              <button
                type="submit"
                disabled={classifyPending || picked === null}
                data-testid={`judge-${caseRow.display_id}`}
                className="rounded-control bg-action px-4 py-2 text-[12.5px] font-bold text-white disabled:opacity-60"
              >
                {t("saveCta")}
              </button>
            </div>
            {classifyState.error && <p className="text-[11.5px] text-danger">{classifyState.error}</p>}
          </form>

          {classified && (
            <div className="rounded-tile border border-[#CDE7DA] bg-tint-done px-3 py-2 text-[12px] text-done-text">
              ✓{" "}
              {caseRow.ai_verdict === caseRow.final_verdict
                ? t("acceptedLine", { v: t(`verdict.${caseRow.final_verdict}`) })
                : t("overriddenLine", {
                    ai: caseRow.ai_verdict ? t(`verdict.${caseRow.ai_verdict}`) : "—",
                    v: t(`verdict.${caseRow.final_verdict as Verdict}`),
                  })}{" "}
              <b>{caseRow.verdict_by}</b>
              {caseRow.verdict_at && <span className="font-mono text-[10px]"> · {caseRow.verdict_at.slice(0, 10)}</span>}
            </div>
          )}
          <p className="text-[10.5px] leading-[1.5] text-ink-tertiary">{t("overrideHint")}</p>
        </div>
      </div>
    </div>
  );
}

// ── 5. jelenet: Tesztriport-panel ────────────────────────────

function ReportPanel({
  projectId,
  set,
  cases,
  report,
}: {
  projectId: string;
  set: GoldenSetRow;
  cases: EvalCaseRow[];
  report: { id: string; status: ArtifactStatus; residual: string | null } | null;
}) {
  const t = useTranslations("goldenset");
  const stats = passStats(cases);
  const failed = failedCaseLines(cases);
  const [syncState, syncAct, syncPending] = useActionState(syncReportAction.bind(null, projectId), INITIAL);
  const [riskState, riskAct, riskPending] = useActionState(
    suggestResidualRiskAction.bind(null, projectId),
    INITIAL,
  );
  const threshold = set.pass_threshold;

  return (
    <div className="overflow-hidden rounded-shell border border-line bg-surface shadow-card" data-testid="report-panel">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-5 py-3">
        <span className="text-[15px] font-extrabold tracking-[-0.01em]">{t("reportTitle")}</span>
        {report ? <StatusBadge status={report.status} /> : (
          <span className="font-mono text-[10.5px] italic text-ink-tertiary">{t("noReportYet")}</span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <form action={syncAct}>
            <button type="submit" disabled={syncPending} className="rounded-control border border-[#B9CCF7] bg-surface px-3 py-1.5 text-[11.5px] font-semibold text-action-deep hover:bg-accent-tint disabled:opacity-60">
              {t("syncCta")}
            </button>
          </form>
          {report && (
            <Link
              href={`/project/${projectId}/artifact/${report.id}`}
              className="rounded-control bg-action px-3 py-1.5 text-[11.5px] font-bold text-white"
            >
              {t("openEditorCta")} ↗
            </Link>
          )}
        </span>
      </div>
      {(syncState.error || riskState.error || riskState.notice) && (
        <div className="border-b border-line px-5 py-2 text-[12px]">
          {(syncState.error ?? riskState.error) && <span className="text-danger">{syncState.error ?? riskState.error}</span>}
          {riskState.notice && <span className="text-gate-text">{riskState.notice}</span>}
        </div>
      )}
      <div className="p-5">
        {/* figyelmeztetés a küszöbhöz mérve */}
        {threshold !== null && (
          <div
            className={`mb-4 flex items-start gap-2.5 rounded-tile border px-3.5 py-2.5 text-[12px] leading-[1.5] ${
              stats.pct < threshold
                ? "border-[#EADFC0] bg-tint-gate text-gate-text"
                : "border-[#CDE7DA] bg-tint-done text-done-text"
            }`}
          >
            <span className="font-bold">{stats.pct < threshold ? "!" : "✓"}</span>
            <span>
              {stats.pct < threshold ? t("belowWarn", { pct: stats.pct, t: threshold }) : t("aboveOk", { pct: stats.pct, t: threshold })}
              {stats.open > 0 && <b> {t("openCasesWarn", { n: stats.open })}</b>}
            </span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-tile border border-line bg-soft px-3.5 py-2.5">
            <div className="font-mono text-[20px] font-bold">{stats.total}</div>
            <div className="text-[11px] text-ink-tertiary">{t("casesStat")}</div>
          </div>
          <div className="rounded-tile border border-line bg-soft px-3.5 py-2.5">
            <div className="font-mono text-[20px] font-bold text-done-text">{stats.passed}</div>
            <div className="text-[11px] text-ink-tertiary">{t("passedStat")}</div>
          </div>
        </div>
        {/* bukott esetek */}
        <div className="mt-4 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
          {t("failedTitle")} <span className="normal-case">· {t("failedSub", { f: stats.failed, p: stats.partial })}</span>
        </div>
        <div className="mt-1.5 flex flex-col gap-1.5">
          {failed.length === 0 ? (
            <span className="text-[12px] text-ink-tertiary">{t("noFailed")}</span>
          ) : (
            failed.map((f) => (
              <div key={f.displayId} className="flex items-center gap-2 rounded-tile border border-line bg-surface px-3 py-1.5">
                <span className="shrink-0 font-mono text-[10.5px] font-bold text-pivot">{f.displayId}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-secondary">{f.note || "—"}</span>
                <VerdictChip verdict={f.verdict} small />
              </div>
            ))
          )}
        </div>
        {/* maradék kockázat — ✦ javaslat + emberi megerősítés az editorban */}
        <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-tile border border-dashed border-neutral-350 bg-[#FBFBFD] px-3.5 py-2.5">
          <span className="min-w-0 flex-1 text-[11.5px] leading-[1.5] text-ink-secondary">
            {report?.residual ? report.residual : t("residualNote")}
          </span>
          <form action={riskAct}>
            <button type="submit" disabled={riskPending} className="rounded-control border border-[#B9CCF7] bg-surface px-2.5 py-1.5 text-[11.5px] font-semibold text-action-deep hover:bg-accent-tint disabled:opacity-60">
              {riskPending ? t("generating") : `✦ ${t("residualCta")}`}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── 6. jelenet: sikerküszöb (EMBERI) + P3 fázis-kapu ─────────

function ThresholdPanel({ projectId, set, pct }: { projectId: string; set: GoldenSetRow; pct: number }) {
  const t = useTranslations("goldenset");
  const [thState, thAct, thPending] = useActionState(
    setThresholdAction.bind(null, projectId, set.id),
    INITIAL,
  );
  const [ovState, ovAct, ovPending] = useActionState(
    setOverrideAction.bind(null, projectId, set.id),
    INITIAL,
  );
  const [val, setVal] = useState(set.pass_threshold ?? 85);
  const threshold = set.pass_threshold;

  return (
    <div className="overflow-hidden rounded-shell border border-line bg-surface shadow-card" data-testid="threshold-panel">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="text-[13.5px] font-extrabold">{t("thresholdTitle")}</span>
        <span className="rounded-3 bg-tint-sky px-1.5 py-px font-mono text-[8.5px] font-bold uppercase tracking-[0.08em] text-pivot">
          {t("humanBadge")}
        </span>
      </div>
      <div className="p-4">
        <p className="text-[11.5px] leading-[1.5] text-ink-secondary">{t("thresholdText")}</p>
        <form action={thAct} className="mt-3 flex items-center gap-3">
          <span className="font-mono text-[30px] font-bold leading-none text-action-deep">{val}</span>
          <span className="font-mono text-[10.5px] text-ink-tertiary">{t("minPass")}</span>
          <input
            type="range"
            name="threshold"
            min={50}
            max={100}
            value={val}
            onChange={(e) => setVal(Number(e.target.value))}
            className="min-w-0 flex-1 accent-[#1F5AE8]"
          />
          <button type="submit" disabled={thPending} className="rounded-control bg-action px-3 py-1.5 text-[11.5px] font-bold text-white disabled:opacity-60">
            {t("saveCta")}
          </button>
        </form>
        {thState.error && <p className="mt-1 text-[11px] text-danger">{thState.error}</p>}
        <div className="mt-2.5 flex items-center justify-between rounded-tile bg-sunken px-3 py-2 font-mono text-[10.5px]">
          <span className="text-ink-secondary">
            {t("currentRatio")} <b className="text-ink">{pct}%</b>
          </span>
          {threshold === null ? (
            <b className="text-gate-text">{t("thresholdUnset")}</b>
          ) : pct < threshold ? (
            <b className="text-gate-text">{t("missingPts", { n: threshold - pct })}</b>
          ) : (
            <b className="text-done-text">✓</b>
          )}
        </div>
        {/* dokumentált felülírás (AC5 kivétel) */}
        <form action={ovAct} className="mt-3 flex flex-col gap-1.5">
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">{t("overrideLabel")}</span>
          <div className="flex items-center gap-2">
            <input
              name="note"
              defaultValue={set.threshold_override_note}
              placeholder={t("overridePlaceholder")}
              className="min-w-0 flex-1 rounded-tile border border-neutral-350 px-3 py-1.5 text-[11.5px] outline-none focus:border-pivot"
            />
            <button type="submit" disabled={ovPending} className="shrink-0 rounded-control border border-neutral-350 px-2.5 py-1.5 text-[11px] font-semibold text-ink-secondary disabled:opacity-60">
              {t("saveCta")}
            </button>
          </div>
          {set.threshold_override_note && (
            <span className="text-[10.5px] text-gate-text">
              ! {t("overrideActive")} <i>{set.threshold_override_note}</i>
            </span>
          )}
          {ovState.error && <span className="text-[11px] text-danger">{ovState.error}</span>}
        </form>
      </div>
    </div>
  );
}

function GatePanel({
  projectId,
  report,
  solutionDoc,
}: {
  projectId: string;
  report: { status: ArtifactStatus } | null;
  solutionDoc: { status: ArtifactStatus } | null;
}) {
  const t = useTranslations("goldenset");
  const docOk = solutionDoc?.status === "approved";
  const repOk = report?.status === "approved";
  const okCount = (docOk ? 1 : 0) + (repOk ? 1 : 0);
  const open = okCount === 2;

  const row = (label: string, sub: string, ok: boolean, status: ArtifactStatus | null) => (
    <div
      className={`flex items-center gap-2.5 rounded-tile border px-3.5 py-2.5 ${
        ok ? "border-[#CDE7DA] bg-tint-done" : "border-[#EADFC0] bg-tint-gate"
      }`}
    >
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-4 font-mono text-[11px] font-bold text-white ${ok ? "bg-done" : "bg-gate"}`}>
        {ok ? "✓" : "!"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-bold">{label}</span>
        <span className="block text-[10.5px] text-ink-secondary">{sub}</span>
      </span>
      {status ? <StatusBadge status={status} /> : (
        <span className="font-mono text-[10px] italic text-ink-tertiary">{t("missingDoc")}</span>
      )}
    </div>
  );

  return (
    <div className="overflow-hidden rounded-shell border border-line bg-surface shadow-card" data-testid="gate-panel">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className={`flex h-5 w-5 items-center justify-center rounded-4 font-mono text-[11px] font-bold text-white ${open ? "bg-done" : "bg-gate"}`}>
          {open ? "✓" : "!"}
        </span>
        <span className="text-[13.5px] font-extrabold">{t("gateTitle")}</span>
        <span className={`ml-auto rounded-pill border px-2.5 py-0.5 font-mono text-[9.5px] font-bold ${open ? "border-[#CDE7DA] bg-tint-done text-done-text" : "border-[#EADFC0] bg-tint-gate text-gate-text"}`}>
          {open ? t("gateOpenChip") : t("gateClosedChip", { n: okCount })}
        </span>
      </div>
      <div className="flex flex-col gap-2.5 p-4">
        <p className="text-[12px] leading-[1.5] text-ink-secondary">{t("gateText")}</p>
        {row(t("solutionDocLabel"), t("solutionDocSub"), docOk, solutionDoc?.status ?? null)}
        {row(t("testReportLabel"), "", repOk, report?.status ?? null)}
        <div className="rounded-tile border border-[#C7DEEF] bg-tint-sky px-3.5 py-2.5 text-[11.5px] leading-[1.55] text-[#1D4E6E]">
          {t("gatePokaYoke")}
        </div>
        {open ? (
          <Link
            href={`/project/${projectId}`}
            className="rounded-control bg-action px-3 py-2 text-center text-[12.5px] font-bold text-white"
          >
            {t("p4Open")} ↗
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded-control border border-neutral-350 bg-soft px-3 py-2 text-[12.5px] font-semibold text-ink-tertiary"
          >
            🔒 {t("p4Locked")}
          </button>
        )}
      </div>
    </div>
  );
}

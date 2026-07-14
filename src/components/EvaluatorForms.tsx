"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { FormState } from "@/app/actions";
import {
  saveAiActAction,
  saveAiSuitabilityAction,
  saveDataReadinessAction,
} from "@/app/evaluator-actions";
import {
  AI_ACT_QUESTIONS,
  NOTE_MAX_LENGTH,
  READINESS_DIMENSIONS,
  SUITABILITY_CRITERIA,
  isAiActWarnCategory,
  readinessLevel,
  suggestAiActCategory,
  suitabilityVerdict,
  type AiActAssessment,
  type AiActQuestion,
  type AiSuitability,
  type DataReadiness,
} from "@/lib/entities/evaluators";
import { SubmitButton } from "@/components/SubmitButton";

// ─────────────────────────────────────────────────────────────
// Értékelő-űrlapok + összesítő jelvények (#7b) — EMBERI kitöltés, LLM
// nélkül. A megerősített use case kártyájáról nyílnak (details-panel),
// FormState-mintás mentéssel; az összesítés ikon+szöveg jelvény
// (törvény 4). A kanonikus szövegek az i18n szótárban élnek.
// ─────────────────────────────────────────────────────────────

const initialState: FormState = { ok: false, error: null };

function ErrorAlert({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="rounded-tile border border-danger/40 bg-danger/10 px-3 py-2 text-body text-danger"
    >
      {error}
    </p>
  );
}

// ── Jelvény-alap: ikon + szöveg, tónus szerint ───────────────

type BadgeTone = "done" | "gate" | "danger" | "neutral" | "quiet";

const TONE_STYLE: Record<BadgeTone, string> = {
  done: "border-done/40 text-done",
  gate: "border-gate/50 text-gate",
  danger: "border-danger/40 text-danger",
  neutral: "border-line text-ink-secondary",
  quiet: "border-line text-ink-tertiary",
};

function BadgeIcon({ tone }: { tone: BadgeTone }) {
  const common = {
    width: 11,
    height: 11,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (tone) {
    case "done":
      return (
        <svg {...common}>
          <path d="M2.5 8.5l3.5 3.5 7-8" />
        </svg>
      );
    case "gate":
      return (
        <svg {...common}>
          <path d="M8 3v6M8 12v1" />
        </svg>
      );
    case "danger":
      return (
        <svg {...common}>
          <path d="M8 1.8l6.5 11.4H1.5L8 1.8z" />
          <path d="M8 6.5v3M8 11.5v.6" strokeWidth={1.6} />
        </svg>
      );
    case "neutral":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" />
        </svg>
      );
    case "quiet":
      return (
        <svg {...common} strokeDasharray="2.5 2.5">
          <circle cx="8" cy="8" r="5.5" />
        </svg>
      );
  }
}

function EvaluatorBadge({ tone, label }: { tone: BadgeTone; label: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-pill border bg-surface px-2 py-0.5 text-mono-sm ${TONE_STYLE[tone]}`}
    >
      <BadgeIcon tone={tone} />
      {label}
    </span>
  );
}

// ── Összesítő jelvény-sor a use case-kártyán ─────────────────

export interface EvaluatorData {
  aiSuitability: AiSuitability | null;
  dataReadiness: DataReadiness | null;
  aiAct: AiActAssessment | null;
}

export function EvaluatorBadges({ data }: { data: EvaluatorData }) {
  const t = useTranslations("entities.evaluators");

  // 3a — alkalmasság
  const verdict = suitabilityVerdict(data.aiSuitability);
  const suitabilityBadge = verdict
    ? {
        tone: (verdict === "conditional" ? "gate" : "done") as BadgeTone,
        label: t(`verdict.${verdict}`),
      }
    : data.aiSuitability
      ? { tone: "gate" as BadgeTone, label: t("verdict.incomplete") }
      : { tone: "quiet" as BadgeTone, label: t("suitabilityNone") };

  // 3b — adatérettség (láncszem-elv)
  const level = readinessLevel(data.dataReadiness);
  const readinessBadge = level
    ? {
        tone: (level === "high" ? "done" : level === "medium" ? "gate" : "danger") as BadgeTone,
        label: t(`readinessLevel.${level}`),
      }
    : data.dataReadiness
      ? { tone: "gate" as BadgeTone, label: t("verdict.incomplete") }
      : { tone: "quiet" as BadgeTone, label: t("readinessNone") };

  // 3c — AI Act: a megerősített számít; a puszta javaslat jelölten „javaslat"
  const confirmed = data.aiAct?.confirmed_category ?? null;
  const suggested = data.aiAct?.suggested ?? null;
  const aiActBadge = confirmed
    ? {
        tone: (isAiActWarnCategory(confirmed)
          ? "danger"
          : confirmed === "transparency"
            ? "gate"
            : "done") as BadgeTone,
        label: t(`category.${confirmed}`),
      }
    : suggested
      ? {
          tone: (isAiActWarnCategory(suggested) ? "danger" : "gate") as BadgeTone,
          label: t("suggestedBadge", { category: t(`category.${suggested}`) }),
        }
      : { tone: "quiet" as BadgeTone, label: t("aiActNone") };

  return (
    <p className="flex flex-wrap items-center gap-1.5">
      <EvaluatorBadge tone={suitabilityBadge.tone} label={suitabilityBadge.label} />
      <EvaluatorBadge tone={readinessBadge.tone} label={readinessBadge.label} />
      <EvaluatorBadge tone={aiActBadge.tone} label={aiActBadge.label} />
    </p>
  );
}

// ── Közös panel-váz (details) ────────────────────────────────

function PanelShell({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <details className="rounded-tile border border-dashed border-line">
      <summary className="cursor-pointer select-none px-3 py-2 text-body text-ink-secondary hover:text-ink">
        {title}
      </summary>
      <div className="space-y-2 px-3 pb-3">
        <p className="text-mono-sm text-ink-tertiary">{lead}</p>
        {children}
      </div>
    </details>
  );
}

const selectClass =
  "rounded-control border border-line bg-surface px-2 py-1 text-body";
const noteClass =
  "w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary";

// ── 3a. AI-alkalmassági szűrő ────────────────────────────────

export function AiSuitabilityPanel({
  projectId,
  useCaseId,
  current,
}: {
  projectId: string;
  useCaseId: string;
  current: AiSuitability | null;
}) {
  const t = useTranslations("entities.evaluators");
  const [state, formAction] = useActionState(
    saveAiSuitabilityAction.bind(null, projectId, useCaseId),
    initialState,
  );

  return (
    <PanelShell title={t("suitabilityTitle")} lead={t("suitabilityLead")}>
      <form action={formAction} className="space-y-2">
        {SUITABILITY_CRITERIA.map((key) => (
          <label
            key={key}
            className="flex items-center justify-between gap-3 text-body"
          >
            <span className="min-w-0">{t(`criteria.${key}`)}</span>
            <select
              name={key}
              defaultValue={current?.criteria[key] ?? ""}
              className={`${selectClass} shrink-0`}
            >
              <option value="">{t("answer.unset")}</option>
              <option value="yes">{t("answer.yes")}</option>
              <option value="partial">{t("answer.partial")}</option>
              <option value="no">{t("answer.no")}</option>
            </select>
          </label>
        ))}
        <textarea
          key={`n${state.nonce ?? 0}`}
          name="note"
          rows={2}
          maxLength={NOTE_MAX_LENGTH}
          defaultValue={current?.note ?? ""}
          placeholder={t("noteOptional")}
          className={noteClass}
        />
        <ErrorAlert error={state.error} />
        {state.ok && <p className="text-body text-done">{t("saved")}</p>}
        <SubmitButton variant="secondary" pendingLabel={t("saving")}>
          {t("saveCta")}
        </SubmitButton>
      </form>
    </PanelShell>
  );
}

// ── 3b. Adatérettség mini-értékelő ───────────────────────────

export function DataReadinessPanel({
  projectId,
  useCaseId,
  current,
}: {
  projectId: string;
  useCaseId: string;
  current: DataReadiness | null;
}) {
  const t = useTranslations("entities.evaluators");
  const [state, formAction] = useActionState(
    saveDataReadinessAction.bind(null, projectId, useCaseId),
    initialState,
  );

  return (
    <PanelShell title={t("readinessTitle")} lead={t("readinessLead")}>
      <form action={formAction} className="space-y-2">
        {READINESS_DIMENSIONS.map((key) => (
          <label
            key={key}
            className="flex items-center justify-between gap-3 text-body"
          >
            <span className="min-w-0">{t(`dimensions.${key}`)}</span>
            <select
              name={key}
              defaultValue={current?.dimensions[key] ?? ""}
              className={`${selectClass} shrink-0`}
            >
              <option value="">{t("answer.unset")}</option>
              <option value="weak">{t("grade.weak")}</option>
              <option value="partial">{t("grade.partial")}</option>
              <option value="strong">{t("grade.strong")}</option>
            </select>
          </label>
        ))}
        <textarea
          key={`n${state.nonce ?? 0}`}
          name="note"
          rows={2}
          maxLength={NOTE_MAX_LENGTH}
          defaultValue={current?.note ?? ""}
          placeholder={t("noteOptional")}
          className={noteClass}
        />
        <ErrorAlert error={state.error} />
        {state.ok && <p className="text-body text-done">{t("saved")}</p>}
        <SubmitButton variant="secondary" pendingLabel={t("saving")}>
          {t("saveCta")}
        </SubmitButton>
      </form>
    </PanelShell>
  );
}

// ── 3c. AI Act gyorsbesoroló (E1: javaslat → emberi megerősítés) ─

export function AiActPanel({
  projectId,
  useCaseId,
  current,
}: {
  projectId: string;
  useCaseId: string;
  current: AiActAssessment | null;
}) {
  const t = useTranslations("entities.evaluators");
  const [state, formAction] = useActionState(
    saveAiActAction.bind(null, projectId, useCaseId),
    initialState,
  );
  // Élő javaslat-tükör: a checkbox-válaszokból azonnal látszik a javaslat
  // (a mérvadó javaslatot a szerver számítja ugyanazzal a szabállyal).
  // KONTROLLÁLT inputok: a React 19 a server action után reseteli az
  // űrlapot — a hibaágon (pl. hiányzó kötelező megjegyzés) a bejelölt
  // válaszok különben elvesznének, és a második mentés HAMIS javaslatot
  // tárolna (walkthrough-lelet).
  const [answers, setAnswers] = useState<Partial<Record<AiActQuestion, boolean>>>(
    current?.answers ?? {},
  );
  const [confirmedCat, setConfirmedCat] = useState<string>(
    current?.confirmed_category ?? "",
  );
  const liveSuggested = suggestAiActCategory(answers);
  const warn = isAiActWarnCategory(liveSuggested);

  return (
    <PanelShell title={t("aiActTitle")} lead={t("aiActLead")}>
      <form action={formAction} className="space-y-2">
        {AI_ACT_QUESTIONS.map((key) => (
          <label key={key} className="flex items-start gap-2 text-body">
            <input
              type="checkbox"
              name={key}
              checked={answers[key] ?? false}
              onChange={(e) =>
                setAnswers((prev) => ({ ...prev, [key]: e.target.checked }))
              }
              className="mt-1 accent-[var(--action-primary)]"
            />
            <span>{t(`questions.${key}`)}</span>
          </label>
        ))}

        {/* Javaslat (élő tükör) + figyelmeztetés a warn-kategóriákra */}
        <p className="flex flex-wrap items-center gap-2 text-body">
          <span className="text-mono-sm text-ink-tertiary">{t("suggestedLabel")}</span>
          <EvaluatorBadge
            tone={warn ? "danger" : liveSuggested === "transparency" ? "gate" : "done"}
            label={t(`category.${liveSuggested}`)}
          />
        </p>
        {warn && (
          <p
            role="status"
            className="rounded-tile border border-danger/40 bg-danger/10 px-3 py-2 text-body text-danger"
          >
            {t("warnNotice")}
          </p>
        )}

        {/* E1: a besorolást az EMBER erősíti meg */}
        <label className="flex items-center justify-between gap-3 text-body">
          <span>{t("confirmedLabel")}</span>
          <select
            name="confirmedCategory"
            value={confirmedCat}
            onChange={(e) => setConfirmedCat(e.target.value)}
            className={`${selectClass} shrink-0`}
          >
            <option value="">{t("confirmUnset")}</option>
            <option value="prohibited">{t("category.prohibited")}</option>
            <option value="high_risk">{t("category.high_risk")}</option>
            <option value="transparency">{t("category.transparency")}</option>
            <option value="minimal">{t("category.minimal")}</option>
          </select>
        </label>

        <textarea
          key={`n${state.nonce ?? 0}`}
          name="note"
          rows={2}
          maxLength={NOTE_MAX_LENGTH}
          defaultValue={state.values?.fieldValue ?? current?.note ?? ""}
          placeholder={warn ? t("noteRequired") : t("noteOptional")}
          className={noteClass}
        />
        <ErrorAlert error={state.error} />
        {state.ok && <p className="text-body text-done">{t("saved")}</p>}
        <SubmitButton variant="secondary" pendingLabel={t("saving")}>
          {t("saveCta")}
        </SubmitButton>
        {/* Jogi diszkleimer + Digital Omnibus info (a logika nem függ tőle) */}
        <p className="text-mono-sm text-ink-tertiary">{t("disclaimer")}</p>
        <p className="text-mono-sm text-ink-tertiary">{t("omnibusInfo")}</p>
      </form>
    </PanelShell>
  );
}

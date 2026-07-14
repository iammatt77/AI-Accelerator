"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { FormState } from "@/app/actions";
import {
  confirmPainPointAction,
  rejectPainPointAction,
} from "@/app/entity-actions";
import { SubmitButton } from "@/components/SubmitButton";

// ─────────────────────────────────────────────────────────────
// Kompakt drill-in összegzők (Redesign #1, terv „A"): a fájdalompont- és
// use case-sorok összecsukott feje — kód · cím · forrás-jelvények · státusz
// (és use case-nél pontszám-jelvények). A részlet (idézet, akciók) a
// DrillRow-ban nyílik ki. A státusz MINDIG ikon+szöveg (törvény 4).
// ─────────────────────────────────────────────────────────────

const initialState: FormState = { ok: false, error: null };

type Level = "low" | "medium" | "high" | null;
type EntityState = "ai_suggested" | "confirmed" | "manual" | "rejected";

function StatusChip({ state }: { state: EntityState }) {
  const t = useTranslations("entities");
  // v2: a lezárt „Confirmed" TÖMÖR zöld pill (bg-done, fehér); a javaslat
  // borostyán fátyol-pill; a kézi semleges. Törvény 4: mindig ikon + szöveg.
  const cls =
    state === "confirmed"
      ? "bg-done text-white"
      : state === "ai_suggested"
        ? "bg-tint-gate text-gate"
        : "bg-neutral-150 text-ink-secondary";
  const dot = state === "confirmed" ? "✓" : state === "ai_suggested" ? "•" : "✎";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 text-mono-sm font-semibold ${cls}`}
    >
      <span aria-hidden>{dot}</span>
      {t(`state.${state}`)}
    </span>
  );
}

function SourceChips({ indices }: { indices: number[] }) {
  if (indices.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {indices.map((n) => (
        <span
          key={n}
          className="rounded-pill border border-line bg-surface px-1 font-mono text-mono-sm text-pivot"
        >
          [{n}]
        </span>
      ))}
    </span>
  );
}

export function PainSummary({
  code,
  title,
  sourceIndices,
  state,
}: {
  code: string;
  title: string;
  sourceIndices: number[];
  state: EntityState;
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
      <span className="shrink-0 font-mono text-mono-sm text-ink-tertiary">{code}</span>
      <span className="min-w-0 flex-1 basis-40 truncate text-body font-medium">{title}</span>
      <SourceChips indices={sourceIndices} />
      <StatusChip state={state} />
    </span>
  );
}

function RiskChip({ level }: { level: Level }) {
  const t = useTranslations("entities");
  if (!level) return <span className="font-mono text-mono-sm text-ink-tertiary">—</span>;
  const cls =
    level === "high"
      ? "border-danger/40 text-danger"
      : level === "medium"
        ? "border-gate/50 text-gate"
        : "border-done/40 text-done";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-pill border bg-surface px-1.5 font-mono text-mono-sm ${cls}`}
    >
      {t("riskShort")} {t(`riskLetter.${level}`)}
    </span>
  );
}

export function UseCaseSummary({
  code,
  title,
  scoreValue,
  scoreFeasibility,
  risk,
  quickWin,
  listStatus,
  isProposal,
}: {
  code: string;
  title: string;
  scoreValue: number | null;
  scoreFeasibility: number | null;
  risk: Level;
  quickWin: boolean;
  listStatus: "candidate" | "shortlist" | "excluded" | "selected";
  isProposal: boolean;
}) {
  const t = useTranslations("entities");
  const scored = scoreValue !== null && scoreFeasibility !== null;
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
      <span className="shrink-0 font-mono text-mono-sm text-ink-tertiary">{code}</span>
      <span className="min-w-0 flex-1 basis-40 truncate text-body font-medium">{title}</span>
      {scored && (
        <span className="shrink-0 font-mono text-mono-sm text-ink-secondary">
          {t("scoreShortValue")} {scoreValue} · {t("scoreShortFeas")} {scoreFeasibility}
        </span>
      )}
      {scored && <RiskChip level={risk} />}
      {quickWin && (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-pill border border-line bg-surface px-1.5 font-mono text-mono-sm text-ink-secondary">
          <span aria-hidden>★</span>
          {t("quickWinBadge")}
        </span>
      )}
      {!isProposal && listStatus !== "candidate" && (
        <span className="shrink-0 rounded-pill border border-line bg-surface px-1.5 font-mono text-mono-sm text-ink-secondary">
          {t(`listStatus.${listStatus}`)}
        </span>
      )}
      {isProposal && (
        <span className="shrink-0 text-mono-sm font-medium text-gate">
          <span aria-hidden>•</span> {t("state.ai_suggested")}
        </span>
      )}
    </span>
  );
}

// ── Inline confirm/dismiss a „megerősítésre vár" sorokon (1f) ──

export function InlinePainActions({
  projectId,
  painPointId,
}: {
  projectId: string;
  painPointId: string;
}) {
  const tWs = useTranslations("workspace");
  const [confirmState, confirmAction] = useActionState(
    confirmPainPointAction.bind(null, projectId, painPointId),
    initialState,
  );
  const [, rejectAction] = useActionState(
    rejectPainPointAction.bind(null, projectId, painPointId),
    initialState,
  );
  return (
    <>
      <form action={confirmAction}>
        {/* Megerősítés = döntési pont → lila (törvény 3) */}
        <SubmitButton pendingLabel={tWs("confirming")}>{tWs("confirmCta")}</SubmitButton>
      </form>
      <form action={rejectAction}>
        <SubmitButton variant="ghost" pendingLabel={tWs("dismissing")}>
          {tWs("dismissCta")}
        </SubmitButton>
      </form>
      {confirmState.error && (
        <span role="alert" className="text-mono-sm text-danger">
          {confirmState.error}
        </span>
      )}
    </>
  );
}

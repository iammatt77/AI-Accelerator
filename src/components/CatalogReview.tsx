"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { resolveDimensionAction } from "@/app/catalog-actions";
import type { FormState } from "@/app/actions";
import type { DimensionSignal, LabelDimension } from "@/lib/db/types";
import {
  DIM_ORDER,
  Feedback,
  INITIAL,
  LANG_OPTIONS,
  LabelEditForm,
  MODALITY_OPTIONS,
  ModalityChip,
  ORG_OPTIONS,
  originLineParts,
  pct,
  type CatalogAdminItem,
  type StakeholderOption,
} from "@/components/catalogShared";

// ─────────────────────────────────────────────────────────────
// 1b Felülvizsgálat — fókuszált mód: EGY ÍTÉLET egyszerre. A sor a kétes
// (elem × dimenzió) párokból épül BELÉPÉSKOR (pillanatfelvétel), így a
// mentések nem rendezik át menet közben. Billentyűzet: 1–5 választ,
// ⏎ megerősít, S kihagy, ⌫ vissza. A döntés azonnal mentődik
// (resolveDimensionAction → applyLabelCorrection — a logika változatlan);
// a kihagyás nem ír semmit.
// ─────────────────────────────────────────────────────────────

interface Judgment {
  item: CatalogAdminItem;
  dim: LabelDimension;
  signal: DimensionSignal | null;
}

interface Decision {
  /** A megerősített érték címkéje (megjelenítéshez). */
  label: string;
}

/** Az ítélet választási lehetőségei: enum-dimenziónál a teljes készlet
 *  (szavazatokkal, ha vannak); szabad-szöveges dimenziónál a gépi jelölt +
 *  az üresen-hagyás. */
function optionsFor(j: Judgment): { value: string | null; free?: boolean }[] {
  switch (j.dim) {
    case "modality":
      return MODALITY_OPTIONS.map((m) => ({ value: m }));
    case "source":
      return ORG_OPTIONS.map((o) => ({ value: o }));
    case "lang":
      return [...LANG_OPTIONS.map((l) => ({ value: l as string | null })), { value: null }];
    case "scope":
    case "valid_time": {
      const cand = j.signal?.label ?? null;
      return cand ? [{ value: cand, free: true }, { value: null }] : [{ value: null }];
    }
  }
}

export function CatalogReview({
  projectId,
  items,
  stakeholders,
  onExit,
}: {
  projectId: string;
  items: CatalogAdminItem[];
  stakeholders: StakeholderOption[];
  onExit: () => void;
}) {
  const t = useTranslations("catalog");
  const [pending, startTransition] = useTransition();
  const [flash, setFlash] = useState<FormState>(INITIAL);

  // Pillanatfelvétel belépéskor: a kétes (elem × dimenzió) sor. A prop-
  // frissítés (revalidate) NEM építi újra — a haladás stabil marad.
  const [queue] = useState<Judgment[]>(() => {
    const out: Judgment[] = [];
    for (const item of items) {
      if (!item.signal?.doubtful) continue;
      const dims = (item.signal.doubtful_dimensions ?? []) as LabelDimension[];
      for (const dim of DIM_ORDER.filter((d) => dims.includes(d))) {
        out.push({ item, dim, signal: item.signal.signals?.[dim] ?? null });
      }
    }
    return out;
  });

  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState<Map<number, Decision>>(new Map());
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [choice, setChoice] = useState(0);
  const [editing, setEditing] = useState(false);

  const current = queue[index] ?? null;
  const options = useMemo(() => (current ? optionsFor(current) : []), [current]);

  // A gépi jelölt legyen az alapértelmezett kijelölés.
  useEffect(() => {
    if (!current) return;
    const cand = current.signal?.label ?? null;
    const i = options.findIndex((o) => o.value === cand);
    setChoice(i >= 0 ? i : 0);
    setEditing(false);
  }, [index, current, options]);

  const doneCount = decisions.size;
  const labelOf = useCallback(
    (j: Judgment, value: string | null): string => {
      if (value === null) return t("reviewKeepNone");
      if (j.dim === "modality") return t(`modality.${value}`);
      if (j.dim === "source") return t(`org.${value}`);
      return value;
    },
    [t],
  );

  const advance = useCallback(() => {
    setIndex((i) => Math.min(i + 1, queue.length));
  }, [queue.length]);

  const confirm = useCallback(() => {
    if (!current || pending) return;
    const opt = options[choice];
    if (!opt) return;
    const idx = index;
    startTransition(async () => {
      const res = await resolveDimensionAction(projectId, current.item.anchor, current.dim, opt.value);
      if (!res.ok) {
        setFlash(res);
        return;
      }
      setFlash(INITIAL);
      setDecisions((prev) => new Map(prev).set(idx, { label: labelOf(current, opt.value) }));
      setSkipped((prev) => {
        if (!prev.has(idx)) return prev;
        const next = new Set(prev);
        next.delete(idx);
        return next;
      });
      advance();
    });
  }, [current, pending, options, choice, index, projectId, labelOf, advance]);

  const skip = useCallback(() => {
    if (!current || pending) return;
    setSkipped((prev) => new Set(prev).add(index));
    advance();
  }, [current, pending, index, advance]);

  const back = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // Billentyűzet-vezérlés — csak a fókusz-módban, űrlap-mezőn kívül.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (e.key >= "1" && e.key <= "9") {
        const n = Number(e.key) - 1;
        if (n < options.length) {
          e.preventDefault();
          setChoice(n);
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        confirm();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        skip();
      } else if (e.key === "Backspace") {
        e.preventDefault();
        back();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onExit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options.length, confirm, skip, back, onExit]);

  const etaMin = Math.max(1, Math.ceil(((queue.length - doneCount) * 20) / 60));
  const finished = index >= queue.length;

  const voteEntries = (sig: DimensionSignal | null): [string, number][] =>
    sig?.votes ? Object.entries(sig.votes).sort((a, b) => b[1] - a[1]) : [];

  return (
    <div className="flex min-h-0 flex-1">
      {/* ── Sor (queue) ── */}
      <div className="flex w-[320px] flex-shrink-0 flex-col border-r border-neutral-200 bg-surface">
        <div className="border-b border-neutral-200 px-4 py-4">
          <button
            type="button"
            onClick={onExit}
            className="text-[12.5px] font-semibold text-ink-secondary hover:text-ink"
          >
            ← {t("reviewBackCta")}
          </button>
          <div className="mt-2 text-[16px] font-extrabold tracking-[-0.02em]">{t("reviewHeading")}</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-[12px] font-bold">
              {t("reviewProgress", { done: doneCount, total: queue.length })}
            </span>
            <span className="font-mono text-[11px] text-ink-tertiary">
              · {t("reviewEta", { min: etaMin })}
            </span>
          </div>
          <div className="mt-2 h-[5px] overflow-hidden rounded-[3px] bg-neutral-150">
            <div
              className="h-full bg-done transition-all"
              style={{ width: `${queue.length ? (doneCount / queue.length) * 100 : 100}%` }}
            />
          </div>
          {skipped.size > 0 && (
            <div className="mt-1.5 font-mono text-[10.5px] text-ink-tertiary">
              {t("reviewSkippedNote", { n: skipped.size })}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {queue.map((j, i) => {
            const decided = decisions.get(i);
            const isCurrent = i === index;
            return (
              <button
                key={`${j.item.key}:${j.dim}`}
                type="button"
                onClick={() => setIndex(i)}
                className={`flex w-full items-start gap-2.5 border-b px-4 py-2.5 text-left ${
                  isCurrent
                    ? "border-l-[3px] border-l-gate border-tint-gate-border bg-tint-gate-band"
                    : "border-neutral-100 bg-surface hover:bg-neutral-50"
                } ${decided ? "opacity-50" : ""}`}
              >
                <span className="mt-0.5 w-[14px] flex-shrink-0 text-done">
                  {decided ? "✓" : ""}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block truncate text-[13px] leading-[1.4] ${isCurrent ? "font-bold text-ink" : "text-ink"}`}
                  >
                    {j.item.claim}
                  </span>
                  <span
                    className={`mt-0.5 block font-mono text-[10px] ${isCurrent ? "font-bold text-gate-text" : "text-ink-tertiary"}`}
                  >
                    {decided
                      ? `${t(`dim.${j.dim}`)} → ${decided.label}`
                      : [
                          t(`dim.${j.dim}`),
                          voteEntries(j.signal).length > 1
                            ? voteEntries(j.signal)
                                .map(([, n]) => n)
                                .join(" vs ")
                            : skipped.has(i)
                              ? t("reviewSkipCta").toLowerCase()
                              : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="border-t border-neutral-200 bg-neutral-50 px-4 py-3 text-[12.5px] text-ink-secondary">
          {t("reviewSafe")}
        </div>
      </div>

      {/* ── Fókusz-kártya ── */}
      <div className="flex min-w-0 flex-1 flex-col bg-neutral-50">
        {finished || !current ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10">
            <span className="text-[24px] text-done">✓</span>
            <div className="text-[17px] font-bold">{t("reviewAllDone")}</div>
            {skipped.size > 0 && (
              <div className="text-[13px] text-ink-tertiary">{t("reviewSkippedNote", { n: skipped.size })}</div>
            )}
            <button
              type="button"
              onClick={onExit}
              className="mt-2 rounded-control bg-action px-4 py-2 text-[13px] font-bold text-white hover:bg-action-deep"
            >
              ← {t("reviewBackCta")}
            </button>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-10 py-8">
              {/* eredet-sor */}
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-ink-tertiary">
                <b className="font-semibold text-ink-secondary">
                  {current.item.origin.clientName ?? current.item.origin.projectName}
                </b>
                {originLineParts(current.item).length > 0 && "·"}
                <span>{originLineParts(current.item).join(" · ")}</span>
              </div>

              <div className="mt-3 max-w-[760px] text-[24px] font-bold leading-[1.35] tracking-[-0.02em] text-ink">
                {current.item.claim}
              </div>

              {/* bizonyíték */}
              {current.signal?.evidence && (
                <div className="mt-5 max-w-[820px] rounded-tile border border-neutral-200 border-l-[3px] border-l-pivot bg-surface px-4 py-3.5">
                  <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-neutral-450">
                    {t("evidenceLabel")}
                  </div>
                  <div className="text-[14px] leading-[1.7] text-ink-secondary">
                    „{current.signal.evidence}”
                  </div>
                </div>
              )}

              {/* a kérdés */}
              <div className="mt-6 max-w-[820px]">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="rounded-[3px] border border-tint-gate-border bg-tint-gate px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.08em] text-gate-text">
                    {t("reviewDoubtfulDim")}
                  </span>
                  <span className="text-[15px] font-bold">
                    {t("reviewQuestion", { dim: t(`dim.${current.dim}`) })}
                  </span>
                  {current.signal && (
                    <span className="font-mono text-[11px] text-ink-tertiary">
                      {pct(current.signal.confidence)} {t("confidenceLabel")}
                    </span>
                  )}
                </div>
                {/* emberi nyelvű indok, miért kétes (a címkéző reason-je) */}
                {current.signal?.reason && (
                  <div className="mt-2 text-[13.5px] leading-[1.6] text-ink-secondary">
                    {current.signal.reason}
                  </div>
                )}

                {/* választási lehetőségek */}
                <div className="mt-4 flex flex-wrap gap-2.5">
                  {options.map((opt, i) => {
                    const votes = current.signal?.votes?.[opt.value ?? ""] ?? null;
                    const selected = i === choice;
                    const total = current.signal?.samples ?? 0;
                    return (
                      <button
                        key={`${opt.value}`}
                        type="button"
                        onClick={() => setChoice(i)}
                        className={`min-w-[170px] flex-1 rounded-[7px] border bg-surface px-3.5 py-3 text-left ${
                          selected ? "border-[1.5px] border-action shadow-sm" : "border-line"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="rounded-[3px] border border-line px-1.5 font-mono text-[10px] font-bold text-ink-tertiary">
                            {i + 1}
                          </span>
                          <span className={`text-[14px] ${selected ? "font-bold text-ink" : "font-semibold text-ink-secondary"}`}>
                            {labelOf(current, opt.value)}
                          </span>
                          {votes !== null && (
                            <span className={`ml-auto font-mono text-[11px] font-bold ${selected ? "text-action-deep" : "text-ink-tertiary"}`}>
                              {t("reviewVotes", { n: votes })}
                            </span>
                          )}
                        </div>
                        {votes !== null && total > 0 && (
                          <div className="mt-2 h-[4px] overflow-hidden rounded-[2px] bg-neutral-150">
                            <div
                              className={`h-full ${selected ? "bg-action" : "bg-neutral-450"}`}
                              style={{ width: `${(votes / total) * 100}%` }}
                            />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 font-mono text-[10.5px] text-ink-tertiary">{t("reviewOtherOption")}</div>

                {/* a többi dimenzió rendben */}
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-tile bg-neutral-150 px-3.5 py-2.5">
                  <span className="text-done">✓</span>
                  <span className="text-[12.5px] text-ink-secondary">
                    {t("reviewRestOk")}{" "}
                    {DIM_ORDER.filter((d) => d !== current.dim)
                      .map((d) => {
                        const md = current.item.metadata;
                        const v =
                          d === "modality"
                            ? md
                              ? t(`modality.${md.modality}`)
                              : null
                            : d === "scope"
                              ? md?.scope
                              : d === "source"
                                ? md
                                  ? t(`org.${md.sourceOrgLevel}`)
                                  : null
                                : d === "lang"
                                  ? md?.lang
                                  : md?.validTime;
                        return `${t(`dim.${d}`)}: ${v ?? t("notSpecified")}`;
                      })
                      .join(" · ")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditing((v) => !v)}
                    className="ml-auto text-[12.5px] font-semibold text-action hover:underline"
                  >
                    {t("reviewModifyCta")}
                  </button>
                </div>
                {editing && (
                  <LabelEditForm
                    projectId={projectId}
                    item={current.item}
                    stakeholders={stakeholders}
                    onClose={() => setEditing(false)}
                  />
                )}
                <Feedback state={flash} />
              </div>
            </div>

            {/* akciósor */}
            <div className="flex items-center gap-2.5 border-t border-neutral-200 bg-surface px-10 py-3.5">
              <button
                type="button"
                disabled={pending}
                onClick={confirm}
                className="flex items-center gap-2 rounded-control bg-action px-4 py-2.5 text-[14px] font-bold text-white hover:bg-action-deep disabled:opacity-50"
              >
                {t("reviewConfirmCta", { label: labelOf(current, options[choice]?.value ?? null) })}
                <span className="font-mono text-[11px] opacity-70">⏎</span>
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={skip}
                className="flex items-center gap-2 rounded-control border border-line bg-surface px-4 py-2.5 text-[14px] font-semibold text-ink-secondary hover:bg-neutral-100 disabled:opacity-50"
              >
                {t("reviewSkipCta")}
                <span className="font-mono text-[11px] text-neutral-500">S</span>
              </button>
              <span className="ml-auto font-mono text-[11px] text-ink-tertiary">{t("reviewKeys")}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

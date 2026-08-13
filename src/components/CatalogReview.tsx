"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { resolveDimensionAction, resolveDimensionBulkAction } from "@/app/catalog-actions";
import type { FormState } from "@/app/actions";
import type { DimensionSignal, LabelDimension } from "@/lib/db/types";
import { formatValidTime, shortOriginDate } from "@/lib/knowledge/browse";
import {
  DIM_ORDER,
  EVIDENCE_OPTIONS,
  Feedback,
  INITIAL,
  LANG_OPTIONS,
  LabelEditForm,
  MODALITY_GLYPH,
  MODALITY_OPTIONS,
  ORG_OPTIONS,
  originLineParts,
  pct,
  type CatalogAdminItem,
  type StakeholderOption,
} from "@/components/catalogShared";

// ─────────────────────────────────────────────────────────────
// 17v2 Felülvizsgálat — HÁROMHASÁBOS: bal köteg-sáv (kötegek a kétes
// dimenzió szerint + ablak: előző 2 / következő 4, összecsukható), közép
// GÖRGETHETŐ állítás-hasáb (7 sor után kibontható + bizonyíték + komponált
// „miért kétes"), jobb FIX döntés-hasáb — a válaszlehetőségek és a
// megerősítés SOHA nem görögnek el. A MOTOR változatlan (v1): a sor
// belépéskori pillanatfelvétel, a mentés resolveDimensionAction /
// applyLabelCorrection, billentyűzet 1–5 · ⏎ · S · ⌫. ÚJ: forrás-szintű
// tömeges alkalmazás — csak FELAJÁNLÁS, sosem automatikus.
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

interface Batch {
  dim: LabelDimension;
  start: number;
  count: number;
}

/** Az ítélet választási lehetőségei (v1-ből változatlan): enum-dimenziónál a
 *  teljes készlet; szabad-szöveges dimenziónál a gépi jelölt + üresen-hagyás. */
function optionsFor(j: Judgment): { value: string | null; free?: boolean }[] {
  switch (j.dim) {
    case "modality":
      return MODALITY_OPTIONS.map((m) => ({ value: m }));
    case "source":
      return ORG_OPTIONS.map((o) => ({ value: o }));
    case "evidence":
      return EVIDENCE_OPTIONS.map((e) => ({ value: e }));
    case "lang":
      return [...LANG_OPTIONS.map((l) => ({ value: l as string | null })), { value: null }];
    case "scope":
    case "valid_time": {
      const cand = j.signal?.label ?? null;
      return cand ? [{ value: cand, free: true }, { value: null }] : [{ value: null }];
    }
  }
}

/** Az állítás 7 sor után kibontható — a vágás mindig él, a kibontó gomb
 *  viszont MÉRÉSBŐL jön (túlcsordul-e ténylegesen), nem hossz-tippből:
 *  így keskeny hasábon és hosszú szövegen egyaránt őszinte. */
const CLAIM_CLAMP_LINES = 7;

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

  // Pillanatfelvétel belépéskor (v1) — de a sor a KÉTES DIMENZIÓ szerint
  // KÖTEGELT: a kanonikus DIM_ORDER partíciója, kötegen belül a lista
  // sorrendje. A prop-frissítés (revalidate) NEM építi újra.
  const [queue] = useState<Judgment[]>(() => {
    const perDim = new Map<LabelDimension, Judgment[]>();
    for (const item of items) {
      if (!item.signal?.doubtful) continue;
      const dims = (item.signal.doubtful_dimensions ?? []) as LabelDimension[];
      for (const dim of DIM_ORDER.filter((d) => dims.includes(d))) {
        perDim.set(dim, [
          ...(perDim.get(dim) ?? []),
          { item, dim, signal: item.signal.signals?.[dim] ?? null },
        ]);
      }
    }
    return DIM_ORDER.flatMap((d) => perDim.get(d) ?? []);
  });

  const batches: Batch[] = useMemo(() => {
    const out: Batch[] = [];
    for (const dim of DIM_ORDER) {
      const start = queue.findIndex((j) => j.dim === dim);
      if (start < 0) continue;
      out.push({ dim, start, count: queue.filter((j) => j.dim === dim).length });
    }
    return out;
  }, [queue]);

  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState<Map<number, Decision>>(new Map());
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [choice, setChoice] = useState(0);
  const [editing, setEditing] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [claimExpanded, setClaimExpanded] = useState(false);
  const [claimOverflows, setClaimOverflows] = useState(false);
  const claimRef = useRef<HTMLDivElement | null>(null);
  const [bulkChecked, setBulkChecked] = useState(false);
  /** Köteg-kész közjáték: melyik köteg zárult le épp (null = ítélkezés). */
  const [doneBatch, setDoneBatch] = useState<Batch | null>(null);

  // Belépéskor az oldal tetejére — a 100vh-keret a viewporthoz igazodik.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const current = queue[index] ?? null;
  const batch = useMemo(
    () => batches.find((b) => index >= b.start && index < b.start + b.count) ?? null,
    [batches, index],
  );
  const options = useMemo(() => (current ? optionsFor(current) : []), [current]);

  // A gépi jelölt az alapértelmezett kijelölés; a kibontás/bulk elemenként nullázódik.
  useEffect(() => {
    if (!current) return;
    const cand = current.signal?.label ?? null;
    const i = options.findIndex((o) => o.value === cand);
    setChoice(i >= 0 ? i : 0);
    setEditing(false);
    setClaimExpanded(false);
    setBulkChecked(false);
  }, [index, current, options]);

  // Túlcsordulás-mérés: a 7 soros vágás mellett tényleg levágódik-e a
  // szöveg (elem- és ablakméret-függő) — a kibontó gomb ezen múlik.
  useEffect(() => {
    const el = claimRef.current;
    if (!el) return;
    const measure = () => setClaimOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [index, claimExpanded, current?.item.claim]);

  const doneCount = decisions.size;
  const doneInBatch = useCallback(
    (b: Batch) => {
      let n = 0;
      for (let i = b.start; i < b.start + b.count; i++) if (decisions.has(i)) n++;
      return n;
    },
    [decisions],
  );
  const settled = useCallback(
    (i: number) => decisions.has(i) || skipped.has(i),
    [decisions, skipped],
  );

  const labelOf = useCallback(
    (j: Judgment, value: string | null): string => {
      if (value === null) return t("reviewKeepNone");
      if (j.dim === "modality") return t(`modality.${value}`);
      if (j.dim === "source") return t(`org.${value}`);
      if (j.dim === "evidence") return t(`evidence.${value}`);
      return value;
    },
    [t],
  );

  // ── Forrás-szintű tömeges alkalmazás: a jelöltek (csak FELAJÁNLÁS) ──
  // Ugyanaz a köteg (dimenzió) + ugyanaz a forrás (sourceInputId) + még
  // nincs döntés. A kihagyott elem jelölt maradhat — a bulk dönt róla.
  const bulkIdxs = useMemo(() => {
    if (!current || !batch || !current.item.sourceInputId) return [];
    const out: number[] = [];
    for (let i = batch.start; i < batch.start + batch.count; i++) {
      if (i === index || decisions.has(i)) continue;
      if (queue[i].item.sourceInputId === current.item.sourceInputId) out.push(i);
    }
    return out;
  }, [current, batch, index, decisions, queue]);

  /** A köteg lezárult-e (minden ítélet döntött vagy kihagyott). */
  const batchSettled = useCallback(
    (b: Batch, extraDecided: Set<number>) => {
      for (let i = b.start; i < b.start + b.count; i++) {
        if (!decisions.has(i) && !skipped.has(i) && !extraDecided.has(i)) return false;
      }
      return true;
    },
    [decisions, skipped],
  );

  const advance = useCallback(
    (from: number, justDecided: Set<number>) => {
      const b = batches.find((x) => from >= x.start && from < x.start + x.count);
      if (!b) return;
      for (let i = from + 1; i < b.start + b.count; i++) {
        if (!decisions.has(i) && !skipped.has(i) && !justDecided.has(i)) {
          setIndex(i);
          return;
        }
      }
      // A köteg végére értünk: ha minden rendezett → köteg-kész közjáték;
      // különben (kihagyások maradtak) az első nyitottra ugrunk vissza? NEM —
      // a kihagyás szándékos döntés: a köteg így is lezárható (v1-elv).
      setDoneBatch(b);
    },
    [batches, decisions, skipped],
  );

  const confirm = useCallback(() => {
    if (!current || pending) return;
    const opt = options[choice];
    if (!opt) return;
    const idx = index;
    const label = labelOf(current, opt.value);
    const bulk = bulkChecked && bulkIdxs.length > 0;
    startTransition(async () => {
      const res = bulk
        ? await resolveDimensionBulkAction(
            projectId,
            [current.item.anchor, ...bulkIdxs.map((i) => queue[i].item.anchor)],
            current.dim,
            opt.value,
          )
        : await resolveDimensionAction(projectId, current.item.anchor, current.dim, opt.value);
      if (!res.ok) {
        setFlash(res);
        return;
      }
      setFlash(bulk ? res : INITIAL);
      const justDecided = new Set<number>([idx, ...(bulk ? bulkIdxs : [])]);
      setDecisions((prev) => {
        const next = new Map(prev);
        for (const i of justDecided) next.set(i, { label });
        return next;
      });
      setSkipped((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const i of justDecided) if (next.delete(i)) changed = true;
        return changed ? next : prev;
      });
      advance(idx, justDecided);
    });
  }, [current, pending, options, choice, index, projectId, labelOf, advance, bulkChecked, bulkIdxs, queue]);

  const skip = useCallback(() => {
    if (!current || pending) return;
    setSkipped((prev) => new Set(prev).add(index));
    advance(index, new Set([index]));
  }, [current, pending, index, advance]);

  const back = useCallback(() => {
    setDoneBatch(null);
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const jumpToBatch = useCallback(
    (b: Batch) => {
      setDoneBatch(null);
      for (let i = b.start; i < b.start + b.count; i++) {
        if (!decisions.has(i) && !skipped.has(i)) {
          setIndex(i);
          return;
        }
      }
      setIndex(b.start);
    },
    [decisions, skipped],
  );

  const nextOpenBatch = useMemo(
    () => batches.find((b) => !batchSettled(b, new Set())),
    [batches, batchSettled],
  );
  const finished = queue.length > 0 && !nextOpenBatch;

  // Billentyűzet (v1-ből változatlan) — csak ítélkezés közben, űrlapon kívül.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (doneBatch) {
        if (e.key === "Enter" && nextOpenBatch) {
          e.preventDefault();
          jumpToBatch(nextOpenBatch);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onExit();
        }
        return;
      }
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
  }, [options.length, confirm, skip, back, onExit, doneBatch, nextOpenBatch, jumpToBatch]);

  const etaMin = Math.max(1, Math.ceil(((queue.length - doneCount) * 20) / 60));

  const voteEntries = (sig: DimensionSignal | null): [string, number][] =>
    sig?.votes ? Object.entries(sig.votes).sort((a, b) => b[1] - a[1]) : [];

  // ── Komponált „miért kétes" — KIZÁRÓLAG valós mezőkből (compliance 4) ──
  const whyDoubtful = useCallback(
    (j: Judgment): string[] => {
      const parts: string[] = [];
      if (j.signal?.reason) parts.push(j.signal.reason);
      const votes = voteEntries(j.signal);
      if (votes.length > 1 && j.signal?.samples) {
        const dist = votes.map(([l, n]) => `${n} × ${labelOf(j, l)}`).join(" · ");
        parts.push(t("reviewWhyVotes", { samples: j.signal.samples, dist }));
      }
      const src = j.item.origin.sourceTitle;
      if (src) {
        parts.push(
          t("reviewWhySource", {
            source: j.item.origin.personName ? `${src} — ${j.item.origin.personName}` : src,
          }),
        );
      }
      return parts;
    },
    [labelOf, t],
  );

  // ── Kész-állapot: minden köteg lezárva ──
  if (finished && !doneBatch) {
    return (
      <div className="flex min-h-[480px] flex-1 flex-col items-center justify-center gap-3 p-10">
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
    );
  }

  const origin0 = queue[0]?.item.origin;

  return (
    /* Viewport-magasságú keret: e NÉLKÜL az oldal nőne a tartalommal és a
       döntés-hasáb elgörögne — a v2 fő ígérete, hogy SOHA nem görög el.
       Nagyon alacsony ablaknál a jobb hasáb opciólistája görget belül,
       a Megerősítés-láb akkor is látható marad. */
    <div className="flex h-[calc(100vh-215px)] min-h-[430px] overflow-hidden rounded-shell border border-line bg-surface">
      {/* ══ BAL: köteg-sáv (összecsukható) ══ */}
      {navCollapsed ? (
        <div className="flex w-[44px] flex-shrink-0 flex-col items-center border-r border-neutral-200 bg-surface py-3">
          <button
            type="button"
            onClick={() => setNavCollapsed(false)}
            title={t("reviewExpandNav")}
            className="rounded-control px-2 py-1 text-[14px] text-ink-secondary hover:bg-neutral-100"
          >
            »
          </button>
          <span className="mt-3 font-mono text-[10px] font-bold text-ink-tertiary [writing-mode:vertical-rl]">
            {t("reviewProgress", { done: doneCount, total: queue.length })}
          </span>
        </div>
      ) : (
        <div className="flex w-[290px] flex-shrink-0 flex-col border-r border-neutral-200 bg-surface">
          <div className="border-b border-neutral-200 px-4 py-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onExit}
                className="text-[12.5px] font-semibold text-ink-secondary hover:text-ink"
              >
                ← {t("reviewBackCta")}
              </button>
              <button
                type="button"
                onClick={() => setNavCollapsed(true)}
                title={t("reviewCollapseNav")}
                className="ml-auto rounded-control px-2 py-0.5 text-[13px] text-ink-tertiary hover:bg-neutral-100"
              >
                —
              </button>
            </div>
            <div className="mt-2 text-[16px] font-extrabold tracking-[-0.02em]">{t("reviewHeading")}</div>
            {origin0 && (
              <div className="mt-0.5 font-mono text-[10.5px] text-ink-tertiary">
                {[origin0.clientName, origin0.projectName].filter(Boolean).join(" · ")}
              </div>
            )}
            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-mono text-[17px] font-bold tracking-[-0.02em]">{doneCount}</span>
              <span className="font-mono text-[11px] text-ink-tertiary">
                {t("reviewTotals", { total: queue.length, items: items.length })}
              </span>
            </div>
            {/* szegmentált haladás-sáv: egy szegmens = egy köteg */}
            <div className="mt-2 flex h-[5px] gap-[2px]">
              {batches.map((b) => {
                const done = doneInBatch(b);
                return (
                  <div
                    key={b.dim}
                    className="overflow-hidden rounded-[3px] bg-neutral-150"
                    style={{ flex: b.count }}
                  >
                    <div
                      className="h-full bg-done transition-all"
                      style={{ width: `${(done / b.count) * 100}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-1.5 font-mono text-[10px] text-ink-tertiary">
              · {t("reviewEta", { min: etaMin })}
            </div>
          </div>

          {/* kötegek */}
          <div className="px-4 pb-1 pt-3 font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-ink-tertiary">
            {t("reviewBatchesTitle")}
          </div>
          <div className="flex flex-col gap-1 px-3">
            {batches.map((b) => {
              const active = batch?.dim === b.dim && !doneBatch;
              const done = doneInBatch(b);
              return (
                <button
                  key={b.dim}
                  type="button"
                  onClick={() => jumpToBatch(b)}
                  className={`flex items-center gap-2 rounded-tile border px-2.5 py-2 text-left ${
                    active
                      ? "border-accent-tint bg-accent-fill"
                      : "border-transparent bg-surface hover:bg-neutral-50"
                  }`}
                >
                  <span
                    className={`h-[7px] w-[7px] flex-shrink-0 rounded-full ${
                      done === b.count ? "bg-done" : active ? "bg-action" : "bg-neutral-300"
                    }`}
                  />
                  <span
                    className={`text-[13px] ${active ? "font-bold text-action-deep" : "font-semibold text-ink-secondary"}`}
                  >
                    {t(`dim.${b.dim}`)}
                  </span>
                  <span
                    className={`ml-auto font-mono text-[11px] ${active ? "font-bold text-action-deep" : "text-ink-tertiary"}`}
                  >
                    {done}/{b.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ablak: előző 2 · MOST · következő 4 a kötegben */}
          {batch && !doneBatch && (
            <>
              <div className="mx-4 mt-3 h-px bg-neutral-150" />
              <div className="px-4 pb-1 pt-3 font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-ink-tertiary">
                {t("reviewWindowTitle", { dim: t(`dim.${batch.dim}`) })}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                {(() => {
                  const from = Math.max(batch.start, index - 2);
                  const to = Math.min(batch.start + batch.count, index + 5);
                  const rest = batch.start + batch.count - to;
                  const rows = [];
                  for (let i = from; i < to; i++) {
                    const j = queue[i];
                    const dec = decisions.get(i);
                    const isCur = i === index;
                    rows.push(
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setDoneBatch(null);
                          setIndex(i);
                        }}
                        className={`flex w-full items-start gap-2 px-4 py-2 text-left ${
                          isCur
                            ? "border-y border-l-[3px] border-tint-gate-border border-l-gate bg-tint-gate-band"
                            : dec
                              ? "opacity-45"
                              : "hover:bg-neutral-50"
                        }`}
                      >
                        <span className="mt-0.5 w-[16px] flex-shrink-0 font-mono text-[10px] text-ink-tertiary">
                          {dec ? <span className="text-done">✓</span> : isCur ? "" : i - batch.start + 1}
                        </span>
                        <span className="min-w-0">
                          <span
                            className={`block truncate text-[12.5px] leading-[1.4] ${isCur ? "font-bold text-ink" : "text-ink-secondary"}`}
                          >
                            {/* 0020: elavult címke — ⟳ az ablak-sorban is */}
                            {j.item.labelStale && (
                              <span aria-hidden className="mr-1 text-gate-text" title={t("staleTooltip")}>
                                ⟳
                              </span>
                            )}
                            {j.item.claim}
                          </span>
                          <span className="mt-0.5 block font-mono text-[9.5px] text-ink-tertiary">
                            {isCur
                              ? [
                                  t("reviewNowMarker"),
                                  voteEntries(j.signal).length > 1
                                    ? voteEntries(j.signal)
                                        .map(([, n]) => n)
                                        .join(" vs ")
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")
                              : dec
                                ? `→ ${dec.label}`
                                : skipped.has(i)
                                  ? t("reviewSkipCta").toLowerCase()
                                  : ""}
                          </span>
                        </span>
                      </button>,
                    );
                  }
                  return (
                    <>
                      {rows}
                      {rest > 0 && (
                        <div className="px-4 py-2 font-mono text-[10px] text-ink-tertiary">
                          {t("reviewWindowMore", { n: rest })}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </>
          )}
          {(!batch || doneBatch) && <div className="flex-1" />}

          <div className="border-t border-neutral-200 bg-neutral-50 px-4 py-3 text-[12px] text-ink-secondary">
            {t("reviewSafe")}
          </div>
        </div>
      )}

      {/* ══ KÖZÉP + JOBB ══ */}
      {doneBatch ? (
        /* ── Köteg-kész közjáték ── */
        <div className="flex min-w-0 flex-1 items-center justify-center bg-neutral-50 p-10">
          <div className="w-[440px] rounded-shell border border-line bg-surface p-6 shadow-card">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-tile bg-tint-done text-done">✓</span>
              <div>
                <div className="text-[16px] font-extrabold tracking-[-0.02em]">
                  {t("reviewBatchDoneTitle", { dim: t(`dim.${doneBatch.dim}`) })}
                </div>
                <div className="font-mono text-[10.5px] text-ink-tertiary">
                  {t("reviewBatchDoneStats", {
                    decided: doneInBatch(doneBatch),
                    skipped: Array.from({ length: doneBatch.count }).filter(
                      (_, k) => skipped.has(doneBatch.start + k) && !decisions.has(doneBatch.start + k),
                    ).length,
                  })}
                </div>
              </div>
            </div>
            {/* döntés-összegzés címkénként — a kliens-oldali decisions-ből */}
            <div className="mt-4 flex flex-wrap gap-2">
              {(() => {
                const counts = new Map<string, number>();
                for (let i = doneBatch.start; i < doneBatch.start + doneBatch.count; i++) {
                  const d = decisions.get(i);
                  if (d) counts.set(d.label, (counts.get(d.label) ?? 0) + 1);
                }
                return [...counts.entries()].map(([label, n]) => (
                  <div key={label} className="flex-1 rounded-tile border border-line bg-sunken px-3 py-2">
                    <div className="font-mono text-[16px] font-bold tracking-[-0.02em]">{n}</div>
                    <div className="mt-0.5 text-[11.5px] text-ink-tertiary">{label}</div>
                  </div>
                ));
              })()}
            </div>
            <div className="mt-4 flex gap-2">
              {nextOpenBatch ? (
                <button
                  type="button"
                  onClick={() => jumpToBatch(nextOpenBatch)}
                  className="flex-1 rounded-control bg-action px-4 py-2.5 text-[13.5px] font-bold text-white hover:bg-action-deep"
                >
                  {t("reviewNextBatchCta", {
                    dim: t(`dim.${nextOpenBatch.dim}`),
                    n: nextOpenBatch.count - doneInBatch(nextOpenBatch),
                  })}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onExit}
                className="rounded-control border border-line bg-surface px-4 py-2.5 text-[13.5px] font-semibold text-ink-secondary hover:bg-neutral-100"
              >
                {t("reviewBackToListCta")}
              </button>
            </div>
          </div>
        </div>
      ) : !current ? null : (
        <>
          {/* ── KÖZÉP: az állítás (görög) ── */}
          <div className="flex min-w-0 flex-1 flex-col bg-neutral-50">
            <div className="flex flex-shrink-0 items-center gap-2.5 border-b border-neutral-200 bg-surface px-7 py-2.5">
              <span className="font-mono text-[11px] text-ink-tertiary">
                {originLineParts(current.item).join(" · ") || t("notSpecified")}
              </span>
              <Link
                href={`/project/${projectId}/sources`}
                className="ml-auto flex-shrink-0 text-[12.5px] font-semibold text-action hover:underline"
              >
                {t("openSourceCta")}
              </Link>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
              {/* 0020: itt születik a döntés — ha a címke elavult, azt a
                  fókusz-kártya tetején kell tudni, a szavazatok előtt. */}
              {current.item.labelStale && (
                <div className="mb-4 flex items-start gap-2 rounded-tile border border-tint-gate-border bg-tint-gate px-3.5 py-2.5">
                  <span aria-hidden className="mt-px text-[12px] text-gate-text">
                    ⟳
                  </span>
                  <span className="text-[12.5px] leading-[1.55] text-gate-text">
                    <b>{t("staleReaderTitle")}</b> — {t("staleReviewNote")}
                  </span>
                </div>
              )}
              <div className="font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-neutral-450">
                {t("reviewClaimTitle")}
              </div>
              <div
                ref={claimRef}
                className="mt-2 max-w-[680px] text-[22px] font-bold leading-[1.4] tracking-[-0.02em] text-ink"
                style={
                  !claimExpanded
                    ? {
                        display: "-webkit-box",
                        WebkitLineClamp: CLAIM_CLAMP_LINES,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }
                    : undefined
                }
              >
                {current.item.claim}
              </div>
              {(claimOverflows || claimExpanded) && (
                <button
                  type="button"
                  onClick={() => setClaimExpanded((v) => !v)}
                  className="mt-2 text-[12.5px] font-semibold text-action hover:underline"
                >
                  {claimExpanded ? t("reviewCollapseClaim") : t("reviewExpandClaim")} {claimExpanded ? "▴" : "▾"}
                </button>
              )}

              {/* bizonyíték */}
              {current.signal?.evidence && (
                <div className="mt-5 max-w-[760px] rounded-tile border border-neutral-200 border-l-[3px] border-l-pivot bg-surface px-4 py-3.5">
                  <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-neutral-450">
                    {t("reviewEvidenceTitle")}
                  </div>
                  <div className="text-[14px] leading-[1.7] text-ink-secondary">
                    „{current.signal.evidence}”
                  </div>
                </div>
              )}

              {/* miért kétes — komponált, valós mezőkből */}
              <div className="mt-4 max-w-[760px] rounded-tile border border-neutral-200 bg-surface px-4 py-3.5">
                <div className="mb-1.5 flex items-baseline gap-2">
                  <span className="font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-neutral-450">
                    {t("reviewWhyTitle")}
                  </span>
                  {current.signal && (
                    <span className="font-mono text-[10.5px] text-ink-tertiary">
                      {pct(current.signal.confidence)} {t("confidenceLabel")}
                    </span>
                  )}
                </div>
                <div className="text-[13.5px] leading-[1.65] text-ink-secondary">
                  {whyDoubtful(current).join(" ")}
                </div>
              </div>

              {/* a többi dimenzió rendben + Módosítás */}
              <div className="mt-4 flex max-w-[760px] flex-wrap items-center gap-2 rounded-tile bg-neutral-150 px-3.5 py-2.5">
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
                              : d === "evidence"
                                ? md
                                  ? t(`evidence.${md.evidenceKind}`)
                                  : null
                                : d === "lang"
                                  ? md?.lang
                                  : formatValidTime(md?.validTime ?? null);
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
                <div className="max-w-[760px]">
                  <LabelEditForm
                    projectId={projectId}
                    item={current.item}
                    stakeholders={stakeholders}
                    onClose={() => setEditing(false)}
                  />
                </div>
              )}

              {/* eredet */}
              <div className="mt-4 flex max-w-[760px] flex-wrap items-center gap-2">
                <span className="font-mono text-[10.5px] text-ink-tertiary">{t("reviewOriginLabel")}</span>
                <span className="text-[12.5px] text-ink-secondary">
                  {[
                    current.item.origin.clientName,
                    current.item.origin.artifactLabel,
                    current.item.origin.sourceTitle,
                    current.item.origin.personName
                      ? current.item.origin.personRole
                        ? `${current.item.origin.personName} (${current.item.origin.personRole})`
                        : current.item.origin.personName
                      : null,
                    shortOriginDate(current.item.origin.sourceDate),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            </div>
          </div>

          {/* ── JOBB: FIX döntés-hasáb (nem görög) ── */}
          <div className="flex w-[360px] flex-shrink-0 flex-col border-l border-neutral-200 bg-surface">
            <div className="flex-shrink-0 border-b border-tint-gate-border bg-tint-gate px-5 py-3.5">
              <span className="inline-flex items-center rounded-[3px] border border-tint-gate-border bg-surface px-2 py-0.5 font-mono text-[9.5px] font-bold tracking-[0.08em] text-gate-text">
                {t("reviewDoubtfulDim")} · {batch ? `${doneInBatch(batch)}/${batch.count}` : ""}
              </span>
              <div className="mt-2 text-[18px] font-extrabold tracking-[-0.02em]">
                {t(`dim.${current.dim}`)}
              </div>
              <div className="mt-1 text-[12.5px] leading-[1.55] text-gate-text">
                {t(`reviewQ.${current.dim}`)}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-5 py-4">
              {options.map((opt, i) => {
                const votes = current.signal?.votes?.[opt.value ?? ""] ?? null;
                const selected = i === choice;
                const total = current.signal?.samples ?? 0;
                const glyph =
                  current.dim === "modality" ? MODALITY_GLYPH[opt.value ?? ""] ?? null : null;
                return (
                  <button
                    key={`${opt.value}`}
                    type="button"
                    onClick={() => setChoice(i)}
                    className={`rounded-[7px] border bg-surface px-3 py-2.5 text-left ${
                      selected ? "border-[1.5px] border-action shadow-sm" : "border-line"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-[3px] px-1.5 font-mono text-[10.5px] font-bold ${
                          selected ? "bg-accent-fill text-action-deep" : "bg-neutral-100 text-ink-tertiary"
                        }`}
                      >
                        {i + 1}
                      </span>
                      <span
                        className={`text-[13.5px] ${selected ? "font-bold text-ink" : "font-semibold text-ink-secondary"}`}
                      >
                        {glyph && <span className="mr-1 opacity-60">{glyph}</span>}
                        {labelOf(current, opt.value)}
                      </span>
                      {votes !== null && (
                        <span
                          className={`ml-auto font-mono text-[10.5px] font-bold ${selected ? "text-action-deep" : "text-ink-tertiary"}`}
                        >
                          {votes} / {total}
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
              <div className="font-mono text-[10px] text-ink-tertiary">{t("reviewOtherOption")}</div>

              {/* forrás-szintű tömeges alkalmazás — csak FELAJÁNLÁS */}
              {bulkIdxs.length > 0 && (
                <label className="mt-1 flex cursor-pointer items-start gap-2 rounded-tile bg-accent-fill px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={bulkChecked}
                    onChange={(e) => setBulkChecked(e.target.checked)}
                    className="mt-0.5 accent-[var(--action-primary)]"
                  />
                  <span className="text-[12px] leading-[1.5] text-action-deep">
                    {t("bulkOfferText", { n: bulkIdxs.length })}
                  </span>
                </label>
              )}
            </div>

            <div className="flex-shrink-0 border-t border-neutral-200 bg-surface px-5 py-3.5">
              <button
                type="button"
                disabled={pending}
                onClick={confirm}
                className="flex w-full items-center justify-center gap-2 rounded-control bg-action px-4 py-2.5 text-[14px] font-bold text-white hover:bg-action-deep disabled:opacity-50"
              >
                {t("reviewConfirmCta", { label: labelOf(current, options[choice]?.value ?? null) })}
                <span className="font-mono text-[11px] opacity-70">⏎</span>
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={skip}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-control border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink-secondary hover:bg-neutral-100 disabled:opacity-50"
              >
                {t("reviewSkipCta")}
                <span className="font-mono text-[10.5px] text-neutral-500">S</span>
              </button>
              <Feedback state={flash} />
              <div className="mt-2 text-center font-mono text-[10px] text-ink-tertiary">
                {t("reviewKeys")}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

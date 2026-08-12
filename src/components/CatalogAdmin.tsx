"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { labelCatalogBatchAction, relabelItemAction } from "@/app/catalog-actions";
import type { FormState } from "@/app/actions";
import type { CorrectionStats } from "@/lib/knowledge/labeling";
import type { LabelDimension } from "@/lib/db/types";
import {
  CatalogBrowser,
  EMPTY_FILTERS,
  filterPredicates,
  type BrowseFilters,
  type Density,
} from "@/components/CatalogBrowser";
import { CatalogReview } from "@/components/CatalogReview";
import {
  Feedback,
  INITIAL,
  MODALITY_OPTIONS,
  ORG_OPTIONS,
  LANG_OPTIONS,
  anchorKeyOf,
  type CatalogAdminItem,
  type StakeholderOption,
} from "@/components/catalogShared";

export type { CatalogAdminItem } from "@/components/catalogShared";

// ─────────────────────────────────────────────────────────────
// Tudáselem-katalógus héj (17): fejléc (cím · darabszám · keresés ·
// címkézés-futtatás) + mód-fülek (Böngészés / Felülvizsgálat / Konfliktusok
// helyhagyó) + szűrősor + a két mód. A kötegelt címkézés-futtatás és a
// javítás-napló kiolvasás VÁLTOZATLAN (timeout-fix szerint); az üres
// katalógus teljes-oldalas magyarázó állapot.
// ─────────────────────────────────────────────────────────────

type Mode = "browse" | "review";

export function CatalogAdmin({
  projectId,
  projectName,
  clientName,
  items,
  stakeholders,
  tuning,
  sourceCount,
  lastLabeledAt,
  headerTitle,
}: {
  projectId: string;
  projectName: string;
  clientName: string | null;
  items: CatalogAdminItem[];
  stakeholders: StakeholderOption[];
  tuning: CorrectionStats;
  sourceCount: number;
  lastLabeledAt: string | null;
  headerTitle: string;
}) {
  const t = useTranslations("catalog");
  const [mode, setMode] = useState<Mode>("browse");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<BrowseFilters>(EMPTY_FILTERS);
  const [density, setDensity] = useState<Density>("comfortable");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [runFlash, setRunFlash] = useState<FormState>(INITIAL);
  const [runProgress, setRunProgress] = useState<{ done: number; total: number } | null>(null);
  const [flash, setFlash] = useState<FormState>(INITIAL);
  const [pending, startTransition] = useTransition();

  const doubtfulTotal = items.filter((i) => i.signal?.doubtful).length;

  const filtered = useMemo(() => {
    const preds = filterPredicates(filters, search);
    return items.filter((i) => preds.every((p) => p.predicate(i)));
  }, [items, filters, search]);

  const scopes = useMemo(
    () =>
      [...new Set(items.map((i) => i.metadata?.scope).filter((s): s is string => !!s))].sort(
        (a, b) => a.localeCompare(b, "hu"),
      ),
    [items],
  );
  const phases = useMemo(
    () => [...new Set(items.map((i) => i.phase).filter((p): p is string => !!p))].sort(),
    [items],
  );

  // ── Kötegelt címkézés-futtatás (VÁLTOZATLAN a timeout-fix óta) ──
  const MAX_BATCH_ITERATIONS = 500;
  const runLabeling = () => {
    setRunFlash(INITIAL);
    startTransition(async () => {
      let doneSoFar = 0;
      let doubtfulSoFar = 0;
      let failedSoFar = 0;
      let total: number | null = null;
      let remaining = 0;
      let lastError: string | null = null;
      let crashed = false;
      const skipKeys = new Set<string>();
      for (let i = 0; i < MAX_BATCH_ITERATIONS; i++) {
        let res;
        try {
          res = await labelCatalogBatchAction(projectId, [...skipKeys]);
        } catch (e) {
          crashed = true;
          lastError = e instanceof Error ? e.message : String(e);
          break;
        }
        if (total === null) total = res.totalTodo;
        doneSoFar += res.done;
        doubtfulSoFar += res.doubtful;
        failedSoFar += res.failed + res.embeddingFailed;
        if (res.firstError && !lastError) lastError = res.firstError;
        for (const a of res.failedAnchors) skipKeys.add(anchorKeyOf(a));
        remaining = res.remaining;
        setRunProgress({ done: doneSoFar, total: total ?? 0 });
        if (res.remaining <= 0 || res.processed === 0) break;
      }
      setRunProgress(null);
      if (total === 0) {
        setRunFlash({ ok: true, error: null, notice: t("runNothingToLabel") });
      } else if (failedSoFar > 0) {
        setRunFlash({
          ok: false,
          error: t("runPartialError", { done: doneSoFar, failed: failedSoFar, message: lastError ?? "?" }),
        });
      } else if (crashed || remaining > 0) {
        setRunFlash({
          ok: true,
          error: null,
          notice: t("runInterrupted", { done: doneSoFar, total: total ?? doneSoFar }),
        });
      } else {
        setRunFlash({ ok: true, error: null, notice: t("runDone", { done: doneSoFar, doubtful: doubtfulSoFar }) });
      }
    });
  };

  const relabel = (item: CatalogAdminItem) => {
    startTransition(async () => {
      const res = await relabelItemAction(projectId, item.anchor, item.cedulaText);
      setFlash(res);
    });
  };

  const dropFilters = (keys: string[]) => {
    setFilters((prev) => {
      const next = { ...prev };
      for (const k of keys) {
        if (k === "search") continue;
        (next as Record<string, string>)[k] = "";
      }
      return next;
    });
    if (keys.includes("search")) setSearch("");
  };
  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setSearch("");
  };

  const sel = "rounded-control border border-line bg-surface px-2 py-1.5 text-[12px] text-ink-secondary";

  // ── Üres katalógus — teljes-oldalas magyarázó állapot ──
  if (items.length === 0) {
    return (
      <div className="surface-card flex flex-col overflow-hidden">
        <div className="border-b border-neutral-200 px-5 py-4">
          <span className="text-[15px] font-extrabold tracking-[-0.02em]">{headerTitle}</span>
          <span className="ml-2 font-mono text-[11px] text-ink-tertiary">
            {[clientName, projectName].filter(Boolean).join(" · ")}
          </span>
        </div>
        <div className="flex flex-col items-start bg-neutral-50 px-7 py-9">
          <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[8px] bg-neutral-150 text-[18px] text-ink-tertiary">
            ▤
          </div>
          <div className="mt-3.5 text-[17px] font-bold tracking-[-0.02em]">{t("emptyTitle")}</div>
          <div className="mt-2 max-w-[560px] text-[13.5px] leading-[1.65] text-ink-secondary">
            {t("emptyBody")}
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-control bg-accent-fill px-3 py-2">
            <span className="text-[13px] font-semibold text-action-deep">
              {sourceCount > 0 ? t("emptySources", { n: sourceCount }) : t("emptySourcesNone")}
            </span>
          </div>
          <div className="mt-4 flex gap-2.5">
            <Link
              href={`/project/${projectId}/sources`}
              className="rounded-control bg-action px-4 py-2 text-[13px] font-bold text-white hover:bg-action-deep"
            >
              {t("emptyOpenSources")}
            </Link>
            <Link
              href={`/project/${projectId}`}
              className="rounded-control border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink-secondary hover:bg-neutral-100"
            >
              {t("emptyOpenWorkspace")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="surface-card flex min-h-[640px] flex-col overflow-hidden">
      {/* ── Fejléc ── */}
      <div className="border-b border-neutral-200 bg-surface px-5 pt-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2.5">
              <span className="text-[20px] font-extrabold tracking-[-0.025em]">{headerTitle}</span>
              <span className="font-mono text-[12px] text-ink-tertiary">
                {t("headerCount", { n: items.length })} · {[clientName, projectName].filter(Boolean).join(" · ")}
              </span>
            </div>
            <div className="mt-0.5 text-[12.5px] text-ink-tertiary">
              {t("headerSubtitle")}
              {lastLabeledAt &&
                ` ${t("headerLastLabeled", { date: new Date(lastLabeledAt).toLocaleString("hu-HU", { dateStyle: "medium", timeStyle: "short" }) })}`}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchClaims")}
              className="w-[260px] rounded-control border border-line bg-surface px-3 py-2 text-[13px] placeholder:text-neutral-500"
            />
            {runProgress && (
              <span className="font-mono text-[11px] text-ink-tertiary">
                {t("runProgress", { done: runProgress.done, total: runProgress.total })}
              </span>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={runLabeling}
              className="rounded-control bg-action px-3 py-2 text-[13px] font-semibold text-white hover:bg-action-deep disabled:opacity-50"
            >
              {pending && runProgress ? t("runningLabel") : t("runCta")} ✦
            </button>
          </div>
        </div>
        <Feedback state={runFlash} />
        <Feedback state={flash} />

        {/* mód-fülek */}
        <div className="mt-3 flex items-end gap-6">
          <button
            type="button"
            onClick={() => setMode("browse")}
            className={`border-b-2 px-0.5 pb-2.5 text-[14px] ${
              mode === "browse"
                ? "border-action font-bold text-action-deep"
                : "border-transparent font-semibold text-ink-secondary hover:text-ink"
            }`}
          >
            {t("browseTab")}
          </button>
          <button
            type="button"
            onClick={() => setMode("review")}
            className={`flex items-center gap-2 border-b-2 px-0.5 pb-2.5 text-[14px] ${
              mode === "review"
                ? "border-action font-bold text-action-deep"
                : "border-transparent font-semibold text-ink-secondary hover:text-ink"
            }`}
          >
            {t("reviewTab")}
            {doubtfulTotal > 0 && (
              <span className="rounded-pill border border-tint-gate-border bg-tint-gate px-1.5 py-px font-mono text-[10.5px] font-bold text-gate-text">
                {doubtfulTotal}
              </span>
            )}
          </button>
          {/* Konfliktusok — helyhagyó, a 4.3 (felismerés) területe; nem épül meg */}
          <span
            className="cursor-default border-b-2 border-transparent px-0.5 pb-2.5 text-[14px] font-semibold text-neutral-450"
            title="4.3"
          >
            {t("conflictsTab")}
          </span>
        </div>
      </div>

      {mode === "browse" && (
        /* 17v2-fix: a böngészés-mód is VIEWPORT-MAGASSÁGÚ keretben él —
           ugyanaz a mérték, mint a Felülvizsgálaton (215px felette a
           fejléc+fülek azonos magasak, mindkét mód ugyanide, a fejléc alá
           kerül). Enélkül a lap a lista hosszával nő, és a jobb oldali
           olvasó-panel a lappal együtt görgetett — a szűrősor (fix) és a
           javítás-napló sáv (fix) között csak a lista+panel görög belül. */
        <div className="flex h-[calc(100vh-215px)] min-h-[430px] flex-col overflow-hidden">
          {/* ── Szűrősor (fix) ── */}
          <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-neutral-200 bg-surface px-5 py-2.5">
            <select
              value={filters.modality}
              onChange={(e) => setFilters((f) => ({ ...f, modality: e.target.value }))}
              aria-label={t("filterModality")}
              className={sel}
            >
              <option value="">{t("filterModality")}: {t("filterAll")}</option>
              {MODALITY_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {t(`modality.${m}`)}
                </option>
              ))}
            </select>
            <select
              value={filters.scope}
              onChange={(e) => setFilters((f) => ({ ...f, scope: e.target.value }))}
              aria-label={t("filterScope")}
              className={sel}
            >
              <option value="">{t("filterScope")}: {t("filterAll")}</option>
              {scopes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={filters.phase}
              onChange={(e) => setFilters((f) => ({ ...f, phase: e.target.value }))}
              aria-label={t("filterPhase")}
              className={sel}
            >
              <option value="">{t("filterPhase")}: {t("filterAll")}</option>
              {phases.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              value={filters.org}
              onChange={(e) => setFilters((f) => ({ ...f, org: e.target.value }))}
              aria-label={t("filterOrg")}
              className={sel}
            >
              <option value="">{t("filterOrg")}: {t("filterAll")}</option>
              {ORG_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {t(`org.${o}`)}
                </option>
              ))}
            </select>
            <select
              value={filters.lang}
              onChange={(e) => setFilters((f) => ({ ...f, lang: e.target.value }))}
              aria-label={t("filterLang")}
              className={sel}
            >
              <option value="">{t("filterLang")}: {t("filterAll")}</option>
              {LANG_OPTIONS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <select
              value={filters.validity}
              onChange={(e) =>
                setFilters((f) => ({ ...f, validity: e.target.value as BrowseFilters["validity"] }))
              }
              aria-label={t("filterValidity")}
              className={sel}
            >
              <option value="">{t("filterValidity")}: {t("filterAll")}</option>
              <option value="has">{t("validityHas")}</option>
              <option value="none">{t("validityNone")}</option>
            </select>
            <select
              value={filters.status}
              onChange={(e) =>
                setFilters((f) => ({ ...f, status: e.target.value as BrowseFilters["status"] }))
              }
              aria-label={t("filterStatus")}
              className={sel}
            >
              <option value="">{t("filterStatus")}: {t("filterAll")}</option>
              <option value="doubtful">{t("statusDoubtful")}</option>
              <option value="confident">{t("statusConfident")}</option>
              <option value="unlabeled">{t("statusUnlabeled")}</option>
            </select>
            <div className="ml-auto flex items-center gap-2.5">
              <span className="font-mono text-[11px] text-ink-tertiary">
                {t("resultCount", { n: filtered.length })}
              </span>
              <div className="h-[18px] w-px bg-neutral-200" />
              <span className="font-mono text-[10.5px] font-bold text-ink-tertiary uppercase">
                {t("densityLabel")}
              </span>
              <button
                type="button"
                onClick={() => setDensity("comfortable")}
                className={`rounded-control px-2 py-0.5 font-mono text-[10.5px] font-bold ${
                  density === "comfortable" ? "bg-action text-white" : "bg-neutral-100 text-ink-secondary"
                }`}
              >
                {t("densityComfortable")}
              </button>
              <button
                type="button"
                onClick={() => setDensity("compact")}
                className={`rounded-control px-2 py-0.5 font-mono text-[10.5px] font-bold ${
                  density === "compact" ? "bg-action text-white" : "bg-neutral-100 text-ink-secondary"
                }`}
              >
                {t("densityCompact")}
              </button>
            </div>
          </div>

          <CatalogBrowser
            projectId={projectId}
            items={items}
            filtered={filtered}
            filters={filters}
            search={search}
            density={density}
            stakeholders={stakeholders}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            onDropFilters={dropFilters}
            onClearFilters={clearFilters}
            onStartReview={() => setMode("review")}
            onRelabel={relabel}
            relabelPending={pending}
          />

          {/* Javítás-napló összegzés (fix) — a küszöb-hangolás iránya (4.2-d, változatlan) */}
          <div className="flex-shrink-0 border-t border-neutral-100 bg-neutral-50 px-5 py-2">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-ink-tertiary">
              {t("tuningTitle")}
            </span>
            {tuning.total === 0 ? (
              <span className="ml-2 text-[11.5px] text-ink-tertiary">{t("tuningEmpty")}</span>
            ) : (
              <span className="ml-2 text-[11.5px] text-ink-secondary">
                {Object.entries(tuning.byDimension)
                  .map(
                    ([dim, s]) =>
                      `${t(`dim.${dim as LabelDimension}`)}: ${t("tuningTooBold", { n: s.tooBold })} · ${t("tuningTooCautious", { n: s.tooCautious })} · ${t("tuningJustified", { n: s.justifiedDoubt })}`,
                  )
                  .join("  |  ")}
              </span>
            )}
          </div>
        </div>
      )}

      {/* A felülvizsgálat sora BELÉPÉSKOR készül pillanatfelvételként (a
          CatalogReview mount-olásakor) — mentés közben nem rendeződik át;
          kilépés + újra-belépés friss sort ad. */}
      {mode === "review" && (
        <CatalogReview
          projectId={projectId}
          items={items}
          stakeholders={stakeholders}
          onExit={() => setMode("browse")}
        />
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { LabelDimension } from "@/lib/db/types";
import {
  formatValidTime,
  groupByScope,
  majorityValues,
  zeroResultSuggestions,
  type FilterSuggestion,
} from "@/lib/knowledge/browse";
import {
  DoubtTag,
  HumanTag,
  StaleLabelTag,
  LabelEditForm,
  MODALITY_GLYPH,
  ModalityChip,
  originLineParts,
  pct,
  primaryDoubt,
  isHumanTouched,
  type CatalogAdminItem,
  type StakeholderOption,
} from "@/components/catalogShared";

// ─────────────────────────────────────────────────────────────
// 1a Böngészés — hatókör szerint csoportosított lista + olvasó-panel, és
// 1c szélsőségek (nulla találat javaslatokkal, hosszú szöveg, sűrűség).
// A sor-anatómia: az ÁLLÍTÁS dominál; alatta modalitás + eredet; a
// többségi alapérték nem kap chipet (adat-vezérelt elnyomás); a kétes
// jelvény megnevezi az érintett dimenziót.
// ─────────────────────────────────────────────────────────────

export type Density = "comfortable" | "compact";

export interface BrowseFilters {
  modality: string;
  scope: string;
  phase: string;
  org: string;
  lang: string;
  validity: "" | "has" | "none";
  status: "" | "doubtful" | "confident" | "unlabeled" | "stale";
}

export const EMPTY_FILTERS: BrowseFilters = {
  modality: "",
  scope: "",
  phase: "",
  org: "",
  lang: "",
  validity: "",
  status: "",
};

type FilterKey = keyof BrowseFilters | "search";

export function filterPredicates(
  filters: BrowseFilters,
  search: string,
): { key: FilterKey; label: string; predicate: (i: CatalogAdminItem) => boolean }[] {
  const preds: { key: FilterKey; label: string; predicate: (i: CatalogAdminItem) => boolean }[] = [];
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    preds.push({
      key: "search",
      label: `„${search.trim()}”`,
      predicate: (i) =>
        i.claim.toLowerCase().includes(q) ||
        i.title.toLowerCase().includes(q) ||
        (i.excerpt ?? "").toLowerCase().includes(q),
    });
  }
  if (filters.modality)
    preds.push({
      key: "modality",
      label: filters.modality,
      predicate: (i) => (i.metadata?.modality ?? "") === filters.modality,
    });
  if (filters.scope)
    preds.push({
      key: "scope",
      label: filters.scope,
      predicate: (i) => (i.metadata?.scope ?? "") === filters.scope,
    });
  if (filters.phase)
    preds.push({
      key: "phase",
      label: filters.phase,
      predicate: (i) => (i.phase ?? "") === filters.phase,
    });
  if (filters.org)
    preds.push({
      key: "org",
      label: filters.org,
      predicate: (i) => (i.metadata?.sourceOrgLevel ?? "") === filters.org,
    });
  if (filters.lang)
    preds.push({
      key: "lang",
      label: filters.lang,
      predicate: (i) => (i.metadata?.lang ?? "") === filters.lang,
    });
  if (filters.validity)
    preds.push({
      key: "validity",
      label: filters.validity,
      predicate: (i) =>
        filters.validity === "has" ? !!i.metadata?.validTime : !i.metadata?.validTime,
    });
  if (filters.status)
    preds.push({
      key: "status",
      label: filters.status,
      predicate: (i) =>
        filters.status === "doubtful"
          ? !!i.signal?.doubtful
          : filters.status === "confident"
            ? !!i.signal && !i.signal.doubtful
            : filters.status === "stale"
              ? i.labelStale
              : !i.signal,
    });
  return preds;
}

/** Hosszú állítás küszöbe — e fölött kap kibontás/összecsukás vezérlőt. */
const LONG_CLAIM = 220;

function BrowseRow({
  item,
  selected,
  density,
  suppression,
  onSelect,
}: {
  item: CatalogAdminItem;
  selected: boolean;
  density: Density;
  suppression: { sourceOrgLevel: string | null; lang: string | null };
  onSelect: () => void;
}) {
  const t = useTranslations("catalog");
  const [expanded, setExpanded] = useState(false);
  const doubt = primaryDoubt(item);
  const human = isHumanTouched(item);
  const long = item.claim.length > LONG_CLAIM;
  const m = item.metadata;

  if (density === "compact") {
    return (
      <div
        onClick={onSelect}
        className={`flex cursor-pointer items-center gap-2.5 border-b border-neutral-100 px-4 py-1.5 ${
          selected ? "bg-accent-tint" : "bg-surface hover:bg-neutral-50"
        }`}
      >
        <ModalityChip modality={m?.modality ?? null} compact />
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{item.claim}</span>
        <span className="flex-shrink-0 font-mono text-[10px] text-ink-tertiary">
          {[item.origin.phase, item.origin.sourceTitle].filter(Boolean).join(" · ")}
        </span>
        <span
          className={`h-[9px] w-[9px] flex-shrink-0 rounded-full ${doubt ? "bg-gate" : "bg-transparent"}`}
          title={doubt ? t("doubtfulTag", { dim: t(`dim.${doubt.dim}`).toUpperCase() }) : undefined}
        />
      </div>
    );
  }

  // 17v2: KÁRTYA — minden elem külön fehér lap; a bal sáv hordozza a
  // modalitást és a kétes/kiválasztott állapot színét, így az egyenetlen
  // szöveghossznál is látszik, hol ér véget egy elem.
  const railTone = doubt
    ? "border-tint-gate-border bg-tint-gate"
    : selected
      ? "border-accent-tint bg-accent-fill"
      : "border-neutral-100 bg-neutral-50";
  return (
    <div
      onClick={onSelect}
      className={`flex cursor-pointer overflow-hidden rounded-tile border bg-surface ${
        selected
          ? "border-action shadow-sm"
          : doubt
            ? "border-tint-gate-border hover:shadow-sm"
            : "border-line hover:shadow-sm"
      }`}
    >
      <div className={`flex w-[84px] flex-shrink-0 flex-col gap-1 border-r px-2.5 py-3 ${railTone}`}>
        <span
          className={`font-mono text-[9.5px] font-bold uppercase tracking-[0.05em] ${
            doubt ? "text-gate-text" : selected ? "text-action-deep" : "text-ink-secondary"
          }`}
        >
          <span className="mr-0.5 opacity-70">{MODALITY_GLYPH[m?.modality ?? "ismeretlen"] ?? "?"}</span>
          {t(`modality.${m?.modality ?? "ismeretlen"}`).split(" ")[0]}
        </span>
        {human && !doubt && <span className="font-mono text-[9px] font-bold text-done">✓</span>}
      </div>
      <div className="min-w-0 flex-1 px-4 py-3">
        <div
          className={`text-[14.5px] leading-[1.5] text-ink ${selected ? "font-semibold" : "font-medium"} ${
            long && !expanded ? "line-clamp-3" : ""
          }`}
        >
          {item.claim}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate font-mono text-[11px] text-ink-tertiary">
            <b className="font-semibold text-ink-secondary">{item.origin.clientName ?? item.origin.projectName}</b>
            {originLineParts(item).length > 0 && " · "}
            {originLineParts(item).join(" · ")}
          </span>
          {m?.validTime && (
            <span className="flex-shrink-0 rounded-[3px] border border-line px-1.5 py-px font-mono text-[10px] font-semibold text-ink-tertiary">
              {formatValidTime(m.validTime)}
            </span>
          )}
          {m && m.sourceOrgLevel !== "ismeretlen" && m.sourceOrgLevel !== suppression.sourceOrgLevel && (
            <span className="flex-shrink-0 rounded-[3px] bg-tint-sky px-1.5 py-px font-mono text-[10px] font-bold text-pivot">
              {t(`org.${m.sourceOrgLevel}`)}
            </span>
          )}
          {m?.lang && m.lang !== suppression.lang && (
            <span className="flex-shrink-0 rounded-[3px] border border-line px-1.5 py-px font-mono text-[10px] font-semibold text-ink-tertiary">
              {m.lang}
            </span>
          )}
          {!item.signal && (
            <span className="flex-shrink-0 rounded-pill border border-line bg-surface px-2 py-px font-mono text-[10px] text-ink-tertiary">
              {t("unlabeledChip")}
            </span>
          )}
          {long && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
              className="flex-shrink-0 font-mono text-[10.5px] font-semibold text-action hover:underline"
            >
              {expanded ? t("collapseRow") : t("expandRow")}
            </button>
          )}
          <span className="ml-auto flex flex-shrink-0 items-center gap-2">
            {item.labelStale && <StaleLabelTag />}
            {human && !doubt && <HumanTag />}
            {doubt && <DoubtTag dim={doubt.dim} extra={doubt.extra} />}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Olvasó-panel ─────────────────────────────────────────────
function ReaderPanel({
  projectId,
  item,
  index,
  total,
  stakeholders,
  onClose,
  onRelabel,
  relabelPending,
}: {
  projectId: string;
  item: CatalogAdminItem;
  index: number;
  total: number;
  stakeholders: StakeholderOption[];
  onClose: () => void;
  onRelabel: (item: CatalogAdminItem) => void;
  relabelPending: boolean;
}) {
  const t = useTranslations("catalog");
  const [editing, setEditing] = useState(false);
  const doubt = primaryDoubt(item);
  const human = isHumanTouched(item);
  const m = item.metadata;
  const sig = item.signal?.signals;
  const modalitySig = sig?.modality;
  const evidenceDim: LabelDimension = doubt?.dim ?? "modality";
  const evidence = sig?.[evidenceDim]?.evidence ?? modalitySig?.evidence ?? null;
  const reason = sig?.[evidenceDim]?.reason ?? null;
  const o = item.origin;

  const agreement =
    modalitySig?.votes && modalitySig.samples
      ? { agree: Math.max(...Object.values(modalitySig.votes)), total: modalitySig.samples }
      : modalitySig?.samples
        ? { agree: modalitySig.samples, total: modalitySig.samples }
        : null;

  const dimRow = (label: string, value: string | null, emphasize: boolean) => (
    <div className="flex items-center border-b border-neutral-100 px-3.5 py-2 last:border-b-0">
      <span className="w-[112px] flex-shrink-0 font-mono text-[10.5px] text-ink-tertiary">{label}</span>
      {value ? (
        <span className={`text-[13px] ${emphasize ? "font-semibold text-ink" : "text-ink-secondary"}`}>{value}</span>
      ) : (
        <span className="text-[13px] text-ink-tertiary">{t("notSpecified")}</span>
      )}
    </div>
  );

  return (
    <div className="flex w-[380px] flex-shrink-0 flex-col overflow-y-auto border-l border-neutral-200 bg-neutral-50">
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-surface px-4 py-3">
        <span className="font-mono text-[10.5px] font-bold tracking-[0.1em] text-ink-tertiary uppercase">
          {item.blockType}
        </span>
        <span className="ml-auto font-mono text-[11px] text-ink-tertiary">
          {t("readerIndex", { i: index + 1, n: total })}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("closeEditCta")}
          className="rounded-control px-1.5 text-[14px] text-ink-tertiary hover:bg-neutral-100"
        >
          ×
        </button>
      </div>

      <div className="px-4 pt-4">
        <div className="text-[16px] font-bold leading-[1.5] tracking-[-0.01em] text-ink">{item.claim}</div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <ModalityChip modality={m?.modality ?? null} />
          {item.labelStale && <StaleLabelTag />}
          {doubt ? (
            <DoubtTag dim={doubt.dim} extra={doubt.extra} />
          ) : human ? (
            <HumanTag />
          ) : agreement ? (
            <span className="font-mono text-[10px] font-bold tracking-[0.05em] text-done">
              ✓ {t("readerAgreement", { agree: agreement.agree, total: agreement.total })}
            </span>
          ) : null}
        </div>
        {human && <div className="mt-1.5 text-[11.5px] text-ink-tertiary">{t("readerHumanNote")}</div>}
        {/* 0020: a régi címke LÁTHATÓ marad — a magyarázat mondja meg, hogy
            elavult, és mi oldja fel (a következő címkézés-futtatás). */}
        {item.labelStale && (
          <div className="mt-2.5 rounded-tile border border-tint-gate-border bg-tint-gate px-3 py-2">
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-gate-text">
              ⟳ {t("staleReaderTitle")}
            </div>
            <div className="mt-1 text-[12px] leading-[1.55] text-gate-text">
              {t("staleReaderBody")}
            </div>
          </div>
        )}
      </div>

      {/* Eredet */}
      <div className="px-4 pt-4">
        <div className="mb-2 font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-neutral-450">
          {t("originTitle")}
        </div>
        <div className="flex flex-col gap-2 rounded-tile border border-neutral-200 bg-surface p-3">
          <div className="min-w-0">
            <div className="text-[13px] font-bold">
              {[o.clientName, o.projectName].filter(Boolean).join(" · ")}
            </div>
            {o.phase && <div className="font-mono text-[10.5px] text-ink-tertiary">{o.phase}</div>}
          </div>
          {(o.sourceTitle || o.personName || o.artifactLabel) ? (
            <>
              <div className="h-px bg-neutral-100" />
              <div className="min-w-0">
                {o.artifactLabel && <div className="text-[13px] font-semibold">{o.artifactLabel}</div>}
                {o.sourceTitle && <div className="text-[13px] font-semibold">{o.sourceTitle}</div>}
                <div className="font-mono text-[10.5px] text-ink-tertiary">
                  {[o.personName ? `${o.personName}${o.personRole ? ` (${o.personRole})` : ""}` : null,
                    o.sourceDate ? new Date(o.sourceDate).toLocaleDateString("hu-HU") : null]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
            </>
          ) : (
            <div className="text-[12px] text-ink-tertiary">{t("originUnknown")}</div>
          )}
        </div>
      </div>

      {/* Bizonyíték */}
      <div className="px-4 pt-4">
        <div className="mb-2 font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-neutral-450">
          {t("evidenceTitle")}
        </div>
        {evidence ? (
          <div className="rounded-tile border border-neutral-200 border-l-[3px] border-l-pivot bg-surface p-3 text-[13px] leading-[1.65] text-ink-secondary">
            „{evidence}”
            {reason && <div className="mt-2 font-mono text-[10.5px] text-ink-tertiary">{reason}</div>}
          </div>
        ) : (
          <div className="text-[12px] text-ink-tertiary">{t("evidenceNone")}</div>
        )}
      </div>

      {/* Besorolás — minden dimenzió, a hiányzókkal együtt */}
      <div className="px-4 pt-4 pb-4">
        <div className="mb-2 font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-neutral-450">
          {t("classificationTitle")}
        </div>
        <div className="overflow-hidden rounded-tile border border-neutral-200 bg-surface">
          {dimRow(t("dim.modality"), m ? t(`modality.${m.modality}`) : null, true)}
          {dimRow(t("dim.scope"), m?.scope ?? null, true)}
          {dimRow(t("dim.source"), m ? t(`org.${m.sourceOrgLevel}`) : null, false)}
          {dimRow(
            t("dim.evidence"),
            m && m.evidenceKind !== "ismeretlen" ? t(`evidence.${m.evidenceKind}`) : null,
            false,
          )}
          {dimRow(t("dim.lang"), m?.lang ?? null, false)}
          {dimRow(t("dim.valid_time"), formatValidTime(m?.validTime ?? null), false)}
        </div>
        {sig && doubt && sig[doubt.dim]?.confidence !== undefined && (
          <div className="mt-2 font-mono text-[10.5px] text-gate-text">
            {t(`dim.${doubt.dim}`)}: {pct(sig[doubt.dim]!.confidence)} {t("confidenceLabel")}
            {sig[doubt.dim]?.votes && (
              <>
                {" · "}
                {Object.entries(sig[doubt.dim]!.votes!)
                  .sort((a, b) => b[1] - a[1])
                  .map(([l, n]) => t("voteItem", { n, label: l }))
                  .join(" · ")}
              </>
            )}
          </div>
        )}
        {editing && (
          <LabelEditForm
            projectId={projectId}
            item={item}
            stakeholders={stakeholders}
            onClose={() => setEditing(false)}
          />
        )}
      </div>

      <div className="mt-auto flex gap-2 border-t border-neutral-200 bg-surface px-4 py-3">
        <Link
          href={`/project/${projectId}/sources`}
          className="flex-1 rounded-control bg-action px-3 py-2 text-center text-[13px] font-bold text-white hover:bg-action-deep"
        >
          {t("openSourceCta")}
        </Link>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="rounded-control border border-line bg-surface px-3 py-2 text-[13px] font-semibold text-ink-secondary hover:bg-neutral-100"
        >
          {t("fixLabelsCta")}
        </button>
        <button
          type="button"
          disabled={relabelPending}
          onClick={() => onRelabel(item)}
          className="rounded-control border border-line bg-surface px-3 py-2 text-[13px] font-semibold text-ink-secondary hover:bg-neutral-100 disabled:opacity-50"
        >
          {item.signal ? t("relabelCta") : t("labelOneCta")} ✦
        </button>
      </div>
    </div>
  );
}

// ── Nulla-találat állapot ────────────────────────────────────
function ZeroResults({
  items,
  filters,
  search,
  filterLabels,
  onDrop,
  onClearAll,
}: {
  items: CatalogAdminItem[];
  filters: BrowseFilters;
  search: string;
  filterLabels: Record<FilterKey, string>;
  onDrop: (keys: FilterKey[]) => void;
  onClearAll: () => void;
}) {
  const t = useTranslations("catalog");
  const preds = filterPredicates(filters, search);
  const suggestions: FilterSuggestion<FilterKey>[] = zeroResultSuggestions(items, preds);
  const nameOf = (k: FilterKey) => filterLabels[k] ?? k;
  const culprit = suggestions[0]?.drop[0];

  return (
    <div className="flex flex-1 flex-col items-start justify-center bg-neutral-50 px-8 py-10">
      <div className="font-mono text-[11px] font-bold uppercase tracking-[0.13em] text-neutral-450">
        {t("zeroMeta", { n: preds.length })}
      </div>
      <div className="mt-2 text-[17px] font-bold tracking-[-0.02em]">{t("zeroTitle")}</div>
      {culprit && (
        <div className="mt-2 text-[13.5px] leading-[1.65] text-ink-secondary">
          {t("zeroBody", { filter: nameOf(culprit) })}
        </div>
      )}
      <div className="mt-4 flex w-full max-w-[420px] flex-col gap-2">
        {suggestions.map((s) => (
          <button
            key={s.drop.join("+")}
            type="button"
            onClick={() => onDrop(s.drop)}
            className="flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-2 text-left hover:bg-neutral-50"
          >
            <span className="text-[13px] text-ink">
              {s.drop.length === 1
                ? t("zeroDropOne", { a: nameOf(s.drop[0]) })
                : t("zeroDropTwo", { a: nameOf(s.drop[0]), b: nameOf(s.drop[1]) })}
            </span>
            <span className="ml-auto font-mono text-[11px] font-bold text-action">
              {t("zeroHits", { n: s.count })}
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onClearAll}
        className="mt-3.5 rounded-control border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink-secondary hover:bg-neutral-100"
      >
        {t("zeroClearAll")}
      </button>
    </div>
  );
}

// ── A böngészés-nézet fő komponense ──────────────────────────
export function CatalogBrowser({
  projectId,
  items,
  filtered,
  filters,
  search,
  density,
  stakeholders,
  selectedKey,
  onSelect,
  onDropFilters,
  onClearFilters,
  onStartReview,
  onRelabel,
  relabelPending,
}: {
  projectId: string;
  items: CatalogAdminItem[];
  filtered: CatalogAdminItem[];
  filters: BrowseFilters;
  search: string;
  density: Density;
  stakeholders: StakeholderOption[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onDropFilters: (keys: FilterKey[]) => void;
  onClearFilters: () => void;
  onStartReview: () => void;
  onRelabel: (item: CatalogAdminItem) => void;
  relabelPending: boolean;
}) {
  const t = useTranslations("catalog");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const suppression = useMemo(() => majorityValues(filtered), [filtered]);
  const groups = useMemo(() => groupByScope(filtered), [filtered]);
  const doubtfulCount = filtered.filter((i) => i.signal?.doubtful).length;
  const staleCount = filtered.filter((i) => i.labelStale).length;
  const selected = filtered.find((i) => i.key === selectedKey) ?? null;
  const selectedIndex = selected ? filtered.indexOf(selected) : -1;

  const filterLabels: Record<FilterKey, string> = {
    search: t("searchPlaceholder"),
    modality: filters.modality ? t(`modality.${filters.modality}`) : t("filterModality"),
    scope: filters.scope || t("filterScope"),
    phase: filters.phase || t("filterPhase"),
    org: filters.org ? t(`org.${filters.org}`) : t("filterOrg"),
    lang: filters.lang || t("filterLang"),
    validity: filters.validity === "has" ? t("validityHas") : t("validityNone"),
    status:
      filters.status === "doubtful"
        ? t("statusDoubtful")
        : filters.status === "confident"
          ? t("statusConfident")
          : filters.status === "stale"
            ? t("staleFilter")
            : t("statusUnlabeled"),
  };

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex min-h-0 flex-1">
      {/* 17v2: kártya-nézetben az alap süllyesztett — a fehér lapok elválnak */}
      <div
        className={`flex min-w-0 flex-1 flex-col overflow-y-auto ${
          density === "comfortable" ? "bg-sunken" : "bg-surface"
        }`}
      >
        {/* Felülvizsgálat-hívó sáv */}
        {doubtfulCount > 0 && (
          <div className="flex items-center gap-3 border-b border-tint-gate-border bg-tint-gate-band px-4 py-2.5">
            <span className="text-[13px] text-gate-text">
              <b>{t("reviewNudge", { n: doubtfulCount })}</b>
            </span>
            <button
              type="button"
              onClick={onStartReview}
              className="ml-auto flex-shrink-0 rounded-control bg-gate px-3 py-1.5 text-[12.5px] font-bold text-white hover:opacity-90"
            >
              {t("reviewNudgeCta")} ›
            </button>
          </div>
        )}
        {/* 0020: elavult besorolások — a feloldás nem felülvizsgálat, hanem
            a címkézés-futtatás (az az elcsúszottakat magától beveszi). */}
        {staleCount > 0 && (
          <div className="flex items-center gap-2.5 border-b border-tint-gate-border bg-tint-gate px-4 py-2">
            <span aria-hidden className="text-[12px] text-gate-text">⟳</span>
            <span className="text-[12.5px] text-gate-text">{t("staleNudge", { n: staleCount })}</span>
          </div>
        )}

        {filtered.length === 0 ? (
          <ZeroResults
            items={items}
            filters={filters}
            search={search}
            filterLabels={filterLabels}
            onDrop={onDropFilters}
            onClearAll={onClearFilters}
          />
        ) : (
          <>
            {groups.map((group) => {
              const gkey = group.scope ?? "__none__";
              const isCollapsed = collapsed.has(gkey);
              const cards = density === "comfortable";
              return (
                <div key={gkey} className={cards ? "px-3 pt-2" : undefined}>
                  {/* 17v2: kártya-nézetben a csoport-fejléc lebegő sor
                      hajszál-vonallal — a kártyák süllyesztett alapon ülnek */}
                  <button
                    type="button"
                    onClick={() => toggleGroup(gkey)}
                    className={
                      cards
                        ? "flex w-full items-center gap-2 px-1 py-2 text-left"
                        : "flex w-full items-center gap-2 border-b border-neutral-100 bg-neutral-50 px-4 py-2 text-left"
                    }
                  >
                    <span className={`text-[10px] text-ink-tertiary transition-transform ${isCollapsed ? "-rotate-90" : ""}`}>
                      ▾
                    </span>
                    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-ink-secondary">
                      {group.scope ?? t("groupUnscoped")}
                    </span>
                    <span className="font-mono text-[10px] text-neutral-450">
                      {group.doubtfulCount > 0
                        ? t("groupCountDoubtful", { n: group.items.length, d: group.doubtfulCount })
                        : t("groupCount", { n: group.items.length })}
                    </span>
                    {cards && <span className="ml-2 h-px flex-1 bg-neutral-200" />}
                  </button>
                  {!isCollapsed && (
                    <div className={cards ? "flex flex-col gap-2 pb-1" : undefined}>
                      {group.items.map((item) => (
                        <BrowseRow
                          key={item.key}
                          item={item}
                          selected={item.key === selectedKey}
                          density={density}
                          suppression={suppression}
                          onSelect={() => onSelect(item.key === selectedKey ? null : item.key)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="mt-auto border-t border-neutral-100 bg-neutral-50 px-4 py-2 font-mono text-[11px] text-ink-tertiary">
              {t("listRange", { shown: filtered.length, total: items.length })}
            </div>
          </>
        )}
      </div>

      {selected && (
        <ReaderPanel
          projectId={projectId}
          item={selected}
          index={selectedIndex}
          total={filtered.length}
          stakeholders={stakeholders}
          onClose={() => onSelect(null)}
          onRelabel={onRelabel}
          relabelPending={relabelPending}
        />
      )}
    </div>
  );
}

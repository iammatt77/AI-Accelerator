"use client";

import { useActionState, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  approveDoubtfulAction,
  labelCatalogBatchAction,
  relabelItemAction,
  saveLabelsAction,
} from "@/app/catalog-actions";
import type { FormState } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import type {
  DimensionSignal,
  KnowledgeLabelSignalRow,
  LabelDimension,
} from "@/lib/db/types";
import type { KnowledgeAnchor } from "@/lib/knowledge/anchor";
import type { CorrectionStats } from "@/lib/knowledge/labeling";

// ─────────────────────────────────────────────────────────────
// Tudáskatalógus admin (4.2-e) — két zóna:
//   ① Felülvizsgálati sor: a kétes elemek, ELSŐDLEGES kétes dimenzió
//     szerint csoportosítva. Tételenként látszik, MIÉRT kétes
//     (szavazatmegoszlás + indok + bizonyíték-idézet). Billentyűzet:
//     ↑↓ lépkedés, Enter = jóváhagyás a gépi jelöltekkel; csoport-batch.
//   ② Katalógus-böngésző: keresés + szűrés (modalitás/hatókör/forrás/
//     státusz), MINDEN elem címkéje szerkeszthető (kétes és biztos is).
// A nulla-állapot a normális: üres felülvizsgálati sor = egy csendes sor,
// nem tátongó szekció. Meglévő tokenek, nincs dekoráció.
// ─────────────────────────────────────────────────────────────

const INITIAL: FormState = { ok: true, error: null };
const DIM_ORDER: readonly LabelDimension[] = [
  "modality",
  "valid_time",
  "scope",
  "source",
  "lang",
];
const MODALITY_OPTIONS = ["historikus", "as_is", "normativ", "to_be", "ismeretlen"];
const ORG_OPTIONS = ["hq", "helyi", "kulso", "ismeretlen"];
const KIND_OPTIONS = ["dokumentum", "interju", "megfigyeles", "rendszeradat"];
const LANG_OPTIONS = ["hu", "en", "hu-en"];

/** Kliens-biztos horgony-kulcs — az anchor.ts anchorKey()-jét NEM importáljuk
 *  ide, mert az a modul node:crypto-t is használ (contentFingerprint); a
 *  formátum (NUL-elválasztó, ütközésmentes) PONTOSAN megegyezik vele —
 *  kizárólag a kötegelt futtatás run-menti skip-listájához kell (l.
 *  runLabeling). */
function anchorKeyOf(a: KnowledgeAnchor): string {
  return [a.block_type, a.block_id ?? "", a.artifact_id ?? "", a.field_key ?? ""].join("\0");
}

export interface CatalogAdminItem {
  key: string;
  anchor: KnowledgeAnchor;
  title: string;
  excerpt: string | null;
  phase: string | null;
  blockType: string;
  cedulaText: string;
  metadata: {
    modality: string;
    validTime: string | null;
    lang: string | null;
    scope: string | null;
    sourceOrgLevel: string;
    sourceKind: string | null;
    sourcePersonStakeholderId: string | null;
  } | null;
  signal: KnowledgeLabelSignalRow | null;
}

interface StakeholderOption {
  id: string;
  name: string;
}

function Feedback({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p className="mt-2 rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="mt-2 rounded-control border border-tint-gate-border bg-tint-gate px-3 py-2 text-[12px] text-gate-text">
        {state.notice}
      </p>
    );
  }
  return null;
}

function pct(c: number): string {
  return `${Math.round(c * 100)}%`;
}

/** Egy dimenzió megjelenítendő JELÖLTJE: kétesnél a signal-jelölt, egyébként
 *  a tárolt metaadat (emberi vagy elfogadott gépi címke). */
function candidateOf(item: CatalogAdminItem, dim: LabelDimension): string {
  const sig = item.signal?.signals?.[dim];
  if (sig && !sig.accepted && sig.source === "gep") return sig.label ?? "";
  const m = item.metadata;
  if (!m) return sig?.label ?? "";
  switch (dim) {
    case "modality":
      return m.modality;
    case "valid_time":
      return m.validTime ?? "";
    case "scope":
      return m.scope ?? "";
    case "source":
      return m.sourceOrgLevel;
    case "lang":
      return m.lang ?? "";
  }
}

// ── Címke-szerkesztő űrlap (minden elemre — kétes és biztos is) ──
function LabelEditForm({
  projectId,
  item,
  stakeholders,
  onClose,
}: {
  projectId: string;
  item: CatalogAdminItem;
  stakeholders: StakeholderOption[];
  onClose: () => void;
}) {
  const t = useTranslations("catalog");
  const [state, formAction] = useActionState(
    saveLabelsAction.bind(null, projectId, item.anchor),
    INITIAL,
  );
  const sig = item.signal?.signals;
  const sel =
    "rounded-control border border-line bg-surface px-2 py-1.5 text-[12.5px]";
  const lbl = "font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-ink-tertiary";
  const personDefault =
    item.metadata?.sourcePersonStakeholderId ??
    stakeholders.find((s) => s.name === (sig?.source?.person_name ?? ""))?.id ??
    "";

  return (
    <form action={formAction} className="mt-2 rounded-tile border border-line bg-sunken p-3">
      <div className="grid grid-cols-2 gap-3 min-[860px]:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className={lbl}>{t("fieldModality")}</span>
          <select name="modality" defaultValue={candidateOf(item, "modality") || "ismeretlen"} className={sel}>
            {MODALITY_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {t(`modality.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={lbl}>{t("fieldValidTime")}</span>
          <input
            name="validTime"
            defaultValue={candidateOf(item, "valid_time")}
            placeholder={t("validTimePlaceholder")}
            className={sel}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={lbl}>{t("fieldScope")}</span>
          <input
            name="scope"
            defaultValue={candidateOf(item, "scope")}
            placeholder={t("scopePlaceholder")}
            className={sel}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={lbl}>{t("fieldLang")}</span>
          <select name="lang" defaultValue={candidateOf(item, "lang")} className={sel}>
            <option value="">{t("langNone")}</option>
            {LANG_OPTIONS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={lbl}>{t("fieldOrgLevel")}</span>
          <select
            name="sourceOrgLevel"
            defaultValue={candidateOf(item, "source") || "ismeretlen"}
            className={sel}
          >
            {ORG_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {t(`org.${o}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={lbl}>{t("fieldKind")}</span>
          <select
            name="sourceKind"
            defaultValue={sig?.source?.kind ?? item.metadata?.sourceKind ?? ""}
            className={sel}
          >
            <option value="">{t("kindNone")}</option>
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={lbl}>{t("fieldPerson")}</span>
          <select name="sourcePersonStakeholderId" defaultValue={personDefault} className={sel}>
            <option value="">{t("personNone")}</option>
            {stakeholders.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Feedback state={state} />
      <div className="mt-3 flex items-center gap-2">
        <SubmitButton variant="secondary" pendingLabel={t("savingLabel")}>
          {t("saveCta")}
        </SubmitButton>
        <button
          type="button"
          onClick={onClose}
          className="rounded-control px-3 py-2 text-[12.5px] text-ink-secondary hover:bg-neutral-100"
        >
          {t("closeEditCta")}
        </button>
      </div>
    </form>
  );
}

// ── Miért kétes? — szavazatmegoszlás + indok + bizonyíték ────
function DoubtDetail({ dim, sig }: { dim: LabelDimension; sig: DimensionSignal }) {
  const t = useTranslations("catalog");
  const voteLabel = (l: string) =>
    MODALITY_OPTIONS.includes(l) ? t(`modality.${l}`) : l;
  return (
    <div className="rounded-tile border border-tint-gate-border bg-tint-gate px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-gate-text">
          {t(`dim.${dim}`)}
        </span>
        <span className="font-mono text-[10.5px] text-gate-text">
          {sig.label ?? t("validTimeNone")} · {pct(sig.confidence)} {t("confidenceLabel")}
        </span>
        {sig.votes && (
          <span className="text-[11.5px] text-gate-text">
            {t("votesLabel", { n: sig.samples ?? 0 })}{" "}
            {Object.entries(sig.votes)
              .sort((a, b) => b[1] - a[1])
              .map(([l, n]) => t("voteItem", { n, label: voteLabel(l) }))
              .join(" · ")}
          </span>
        )}
      </div>
      {sig.reason && (
        <p className="mt-1 text-[11.5px] text-gate-text">
          <span className="font-semibold">{t("reasonLabel")}</span> {sig.reason}
        </p>
      )}
      {sig.evidence && (
        <p className="mt-0.5 text-[11.5px] italic text-gate-text">
          <span className="font-semibold not-italic">{t("evidenceLabel")}</span> „{sig.evidence}”
          {sig.evidence_verbatim === false && (
            <span className="ml-1 not-italic text-[10px]">({t("evidenceNotVerbatim")})</span>
          )}
        </p>
      )}
    </div>
  );
}

export function CatalogAdmin({
  projectId,
  items,
  stakeholders,
  tuning,
}: {
  projectId: string;
  items: CatalogAdminItem[];
  stakeholders: StakeholderOption[];
  tuning: CorrectionStats;
}) {
  const t = useTranslations("catalog");
  const [runFlash, setRunFlash] = useState<FormState>(INITIAL);
  const [runProgress, setRunProgress] = useState<{ done: number; total: number } | null>(null);
  const [flash, setFlash] = useState<FormState>(INITIAL);
  const [pending, startTransition] = useTransition();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [fModality, setFModality] = useState("");
  const [fScope, setFScope] = useState("");
  const [fOrg, setFOrg] = useState("");
  const [fStatus, setFStatus] = useState("");
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const labeledCount = items.filter((i) => i.signal).length;
  const doubtfulItems = items.filter((i) => i.signal?.doubtful);

  // Csoportosítás az ELSŐDLEGES (kanonikus sorrendben első) kétes dimenzió
  // szerint; a tétel minden kétes dimenziója látszik a részletekben.
  const groups = useMemo(() => {
    const g = new Map<LabelDimension, CatalogAdminItem[]>();
    for (const item of doubtfulItems) {
      const dims = (item.signal?.doubtful_dimensions ?? []) as LabelDimension[];
      const primary = DIM_ORDER.find((d) => dims.includes(d)) ?? "modality";
      g.set(primary, [...(g.get(primary) ?? []), item]);
    }
    return DIM_ORDER.filter((d) => g.has(d)).map((d) => ({ dim: d, items: g.get(d)! }));
  }, [doubtfulItems]);

  const flatReview = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Kötegelt futtatás: a szerver egyszerre csak egy KONZERVATÍV köteget
  // dolgoz fel (labelBatchSize), hogy egyetlen hívás se lépje túl a
  // serverless funkció-időkorlátot. A kliens addig hívja újra, amíg a
  // szerver 0 hátralévőt nem jelez — a haladás élőben látszik. Megszakadás
  // (hálózati hiba, oldal-bezárás) esetén a már feldolgozott elemek
  // megmaradnak (minden köteg elölről lekérdezi a még címkézetlen
  // listát) — a következő futtatás onnan folytatja.
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
      // Az EZEN a futtatáson belül hibázott elemek horgony-kulcsai — a
      // szerver ezeket kihagyja a következő kötegből, így egy tartósan
      // hibázó elem (pl. üres cédula-szöveg) nem foglal le minden kötegből
      // egy helyet a ciklus végéig (l. labelCatalogBatchAction doksi).
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
        // A hibaszám mindig pontosan látszik — a skip-lista miatt nem
        // sokszorozódik ugyanaz az elem.
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

  const approve = (anchors: KnowledgeAnchor[]) => {
    startTransition(async () => {
      const res = await approveDoubtfulAction(projectId, anchors);
      setFlash(res);
    });
  };
  const relabel = (item: CatalogAdminItem) => {
    startTransition(async () => {
      const res = await relabelItemAction(projectId, item.anchor, item.cedulaText);
      setFlash(res);
    });
  };

  const onReviewKey = (e: React.KeyboardEvent, idx: number, item: CatalogAdminItem) => {
    if (e.key === "Enter" && !pending) {
      e.preventDefault();
      approve([item.anchor]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      rowRefs.current[idx + 1]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      rowRefs.current[idx - 1]?.focus();
    }
  };

  const scopes = useMemo(
    () =>
      [...new Set(items.map((i) => i.metadata?.scope).filter((s): s is string => !!s))].sort(),
    [items],
  );

  const filtered = items.filter((i) => {
    if (search) {
      const q = search.toLowerCase();
      if (!i.title.toLowerCase().includes(q) && !(i.excerpt ?? "").toLowerCase().includes(q))
        return false;
    }
    if (fModality && (i.metadata?.modality ?? "") !== fModality) return false;
    if (fScope && (i.metadata?.scope ?? "") !== fScope) return false;
    if (fOrg && (i.metadata?.sourceOrgLevel ?? "") !== fOrg) return false;
    if (fStatus === "doubtful" && !i.signal?.doubtful) return false;
    if (fStatus === "confident" && !(i.signal && !i.signal.doubtful)) return false;
    if (fStatus === "unlabeled" && i.signal) return false;
    return true;
  });

  const chip =
    "inline-flex items-center rounded-pill border border-line bg-surface px-2 py-0.5 font-mono text-[10.5px] text-ink-secondary";
  let reviewIdx = -1;

  return (
    <div className="space-y-5">
      {/* ── Fejléc-sáv: számlálók + futtatás ── */}
      <section className="surface-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-2">
            <span className={chip}>{t("statItems", { n: items.length })}</span>
            <span className={chip}>{t("statLabeled", { n: labeledCount })}</span>
            <span
              className={
                doubtfulItems.length > 0
                  ? "inline-flex items-center rounded-pill border border-tint-gate-border bg-tint-gate px-2 py-0.5 font-mono text-[10.5px] text-gate-text"
                  : chip
              }
            >
              {t("statDoubtful", { n: doubtfulItems.length })}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
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
        {/* Javítás-napló összegzés — a küszöb-hangolás iránya (4.2-d) */}
        <div className="mt-3 border-t border-line-soft pt-2.5">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-ink-tertiary">
            {t("tuningTitle")}
          </span>
          {tuning.total === 0 ? (
            <span className="ml-2 text-[11.5px] text-ink-tertiary">{t("tuningEmpty")}</span>
          ) : (
            <span className="ml-2 flex-wrap text-[11.5px] text-ink-secondary">
              {Object.entries(tuning.byDimension)
                .map(
                  ([dim, s]) =>
                    `${t(`dim.${dim as LabelDimension}`)}: ${t("tuningTooBold", { n: s.tooBold })} · ${t("tuningTooCautious", { n: s.tooCautious })} · ${t("tuningJustified", { n: s.justifiedDoubt })}`,
                )
                .join("  |  ")}
            </span>
          )}
        </div>
      </section>

      {/* ── ① Felülvizsgálati sor ── */}
      {doubtfulItems.length === 0 ? (
        <p className="flex items-center gap-2 px-1 text-[12.5px] text-ink-tertiary">
          <span className="text-done">✓</span> {t("reviewEmpty")}
        </p>
      ) : (
        <section className="surface-card p-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-body font-bold">{t("reviewTitle")}</h2>
            <span className="text-[11.5px] text-ink-tertiary">{t("reviewSubtitle")}</span>
            <span className="ml-auto font-mono text-[10px] text-ink-tertiary">
              {t("reviewKeyHint")}
            </span>
          </div>
          <div className="mt-3 space-y-4">
            {groups.map((group) => (
              <div key={group.dim}>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
                    {t(`dim.${group.dim}`)} · {group.items.length}
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => approve(group.items.map((i) => i.anchor))}
                    className="rounded-control border border-line bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink-secondary hover:bg-neutral-100 disabled:opacity-50"
                  >
                    {t("groupApprove", { n: group.items.length })}
                  </button>
                </div>
                <div className="space-y-2">
                  {group.items.map((item) => {
                    reviewIdx++;
                    const idx = reviewIdx;
                    const dims = (item.signal?.doubtful_dimensions ?? []) as LabelDimension[];
                    return (
                      <div
                        key={item.key}
                        ref={(el) => {
                          rowRefs.current[idx] = el;
                        }}
                        tabIndex={0}
                        onKeyDown={(e) => onReviewKey(e, idx, item)}
                        className="rounded-tile border border-l-2 border-line border-l-gate bg-surface p-3 outline-none focus:ring-2 focus:ring-action/40"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 flex-1 text-body font-medium">
                            {item.title}
                          </span>
                          <span className={chip}>{item.blockType}</span>
                          {item.phase && <span className={chip}>{item.phase}</span>}
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => approve([item.anchor])}
                            className="rounded-control bg-action px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-action-deep disabled:opacity-50"
                          >
                            {t("approveCta")}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setEditingKey(editingKey === item.key ? null : item.key)
                            }
                            className="rounded-control border border-line bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-ink-secondary hover:bg-neutral-100"
                          >
                            {t("editCta")}
                          </button>
                        </div>
                        {item.excerpt && (
                          <p className="mt-1 text-[12px] text-ink-secondary">{item.excerpt}</p>
                        )}
                        <div className="mt-2 space-y-1.5">
                          {dims.map((d) => {
                            const sig = item.signal?.signals?.[d];
                            return sig ? <DoubtDetail key={d} dim={d} sig={sig} /> : null;
                          })}
                        </div>
                        {editingKey === item.key && (
                          <LabelEditForm
                            projectId={projectId}
                            item={item}
                            stakeholders={stakeholders}
                            onClose={() => setEditingKey(null)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── ② Katalógus-böngésző ── */}
      <section className="surface-card p-4">
        <h2 className="text-body font-bold">{t("browserTitle")}</h2>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="min-w-[220px] flex-1 rounded-control border border-line bg-surface px-3 py-1.5 text-[12.5px] placeholder:text-ink-tertiary"
          />
          <select
            value={fModality}
            onChange={(e) => setFModality(e.target.value)}
            className="rounded-control border border-line bg-surface px-2 py-1.5 text-[12px]"
            aria-label={t("filterModality")}
          >
            <option value="">
              {t("filterModality")}: {t("filterAll")}
            </option>
            {MODALITY_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {t(`modality.${m}`)}
              </option>
            ))}
          </select>
          <select
            value={fScope}
            onChange={(e) => setFScope(e.target.value)}
            className="rounded-control border border-line bg-surface px-2 py-1.5 text-[12px]"
            aria-label={t("filterScope")}
          >
            <option value="">
              {t("filterScope")}: {t("filterAll")}
            </option>
            {scopes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={fOrg}
            onChange={(e) => setFOrg(e.target.value)}
            className="rounded-control border border-line bg-surface px-2 py-1.5 text-[12px]"
            aria-label={t("filterOrg")}
          >
            <option value="">
              {t("filterOrg")}: {t("filterAll")}
            </option>
            {ORG_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {t(`org.${o}`)}
              </option>
            ))}
          </select>
          <select
            value={fStatus}
            onChange={(e) => setFStatus(e.target.value)}
            className="rounded-control border border-line bg-surface px-2 py-1.5 text-[12px]"
            aria-label={t("filterStatus")}
          >
            <option value="">
              {t("filterStatus")}: {t("filterAll")}
            </option>
            <option value="doubtful">{t("statusDoubtful")}</option>
            <option value="confident">{t("statusConfident")}</option>
            <option value="unlabeled">{t("statusUnlabeled")}</option>
          </select>
        </div>

        {items.length === 0 ? (
          <p className="mt-4 text-[12.5px] text-ink-tertiary">{t("emptyCatalog")}</p>
        ) : filtered.length === 0 ? (
          <p className="mt-4 text-[12.5px] text-ink-tertiary">{t("emptyFiltered")}</p>
        ) : (
          <div className="mt-3 space-y-1.5">
            {filtered.map((item) => {
              const m = item.metadata;
              const humanTouched = DIM_ORDER.some(
                (d) => item.signal?.signals?.[d]?.source === "ember",
              );
              return (
                <div key={item.key} className="rounded-tile border border-line bg-surface p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                      {item.title}
                    </span>
                    {!item.signal && <span className={chip}>{t("unlabeledChip")}</span>}
                    {item.signal?.doubtful && (
                      <span className="inline-flex items-center rounded-pill border border-tint-gate-border bg-tint-gate px-2 py-0.5 font-mono text-[10.5px] text-gate-text">
                        {t("doubtfulChip")}
                      </span>
                    )}
                    {humanTouched && <span className={chip}>{t("humanChip")}</span>}
                    {item.signal && m && (
                      <>
                        <span className={chip}>{t(`modality.${m.modality}`)}</span>
                        {m.scope && <span className={chip}>{m.scope}</span>}
                        <span className={chip}>{t(`org.${m.sourceOrgLevel}`)}</span>
                        {m.lang && <span className={chip}>{m.lang}</span>}
                        <span className={chip}>{m.validTime ?? t("validTimeNone")}</span>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditingKey(editingKey === item.key ? null : item.key)}
                      className="rounded-control border border-line bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink-secondary hover:bg-neutral-100"
                    >
                      {editingKey === item.key ? t("closeEditCta") : t("editCta")}
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => relabel(item)}
                      className="rounded-control border border-line bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink-secondary hover:bg-neutral-100 disabled:opacity-50"
                    >
                      {item.signal ? t("relabelCta") : t("labelOneCta")} ✦
                    </button>
                  </div>
                  {editingKey === item.key && (
                    <LabelEditForm
                      projectId={projectId}
                      item={item}
                      stakeholders={stakeholders}
                      onClose={() => setEditingKey(null)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

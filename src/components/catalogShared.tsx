"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { saveLabelsAction } from "@/app/catalog-actions";
import type { FormState } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import type { KnowledgeLabelSignalRow, LabelDimension } from "@/lib/db/types";
import type { KnowledgeAnchor } from "@/lib/knowledge/anchor";
import type { CatalogOrigin } from "@/lib/knowledge/browse";
import { shortOriginDate } from "@/lib/knowledge/browse";

// ─────────────────────────────────────────────────────────────
// Katalógus — közös építőkövek (17): típusok, chipek, eredet-sor,
// címke-szerkesztő űrlap. A CatalogAdmin (héj), a CatalogBrowser (1a) és a
// CatalogReview (1b) innen importál — a címkézés LOGIKÁJA a lib-ben és az
// actionökben, itt csak megjelenítés.
// ─────────────────────────────────────────────────────────────

export const INITIAL: FormState = { ok: true, error: null };

export const DIM_ORDER: readonly LabelDimension[] = [
  "modality",
  "valid_time",
  "scope",
  "source",
  "evidence",
  "lang",
];
export const MODALITY_OPTIONS = ["historikus", "as_is", "normativ", "to_be", "ismeretlen"];
export const ORG_OPTIONS = ["hq", "helyi", "kulso", "ismeretlen"];
export const KIND_OPTIONS = ["dokumentum", "interju", "megfigyeles", "rendszeradat"];
export const EVIDENCE_OPTIONS = [
  "mert_adat",
  "megfigyeles",
  "velekedes",
  "hivatkozas",
  "ismeretlen",
];
export const LANG_OPTIONS = ["hu", "en", "hu-en"];

/** A modalitás piktogramja a design szerint (◆ megfigyelés · § előírás ·
 *  → terv · ↺ historikus · ? ismeretlen). */
export const MODALITY_GLYPH: Record<string, string> = {
  as_is: "◆",
  normativ: "§",
  to_be: "→",
  historikus: "↺",
  ismeretlen: "?",
};

export interface CatalogAdminItem {
  key: string;
  anchor: KnowledgeAnchor;
  title: string;
  excerpt: string | null;
  phase: string | null;
  blockType: string;
  cedulaText: string;
  /** Az ÁLLÍTÁS szövege (claimOf) — a sor domináns szövege. */
  claim: string;
  /** Igaz, ha az állítás a tartalomból jött (a cím technikai). */
  claimFromExcerpt: boolean;
  origin: CatalogOrigin;
  metadata: {
    modality: string;
    validTime: string | null;
    lang: string | null;
    scope: string | null;
    sourceOrgLevel: string;
    sourceKind: string | null;
    sourcePersonStakeholderId: string | null;
    evidenceKind: string;
  } | null;
  signal: KnowledgeLabelSignalRow | null;
}

export interface StakeholderOption {
  id: string;
  name: string;
}

/** Kliens-biztos horgony-kulcs — formátuma PONTOSAN az anchor.ts
 *  anchorKey()-e (NUL-elválasztó); az anchor.ts-t nem importáljuk, mert
 *  node:crypto-t is használ. */
export function anchorKeyOf(a: KnowledgeAnchor): string {
  return [a.block_type, a.block_id ?? "", a.artifact_id ?? "", a.field_key ?? ""].join("\0");
}

export function pct(c: number): string {
  return `${Math.round(c * 100)}%`;
}

/** Az elem ELSŐDLEGES kétes dimenziója (kanonikus sorrendben első) + hány
 *  további kétes dimenzió van. */
export function primaryDoubt(item: CatalogAdminItem): {
  dim: LabelDimension;
  extra: number;
} | null {
  const dims = (item.signal?.doubtful_dimensions ?? []) as LabelDimension[];
  if (!item.signal?.doubtful || dims.length === 0) return null;
  const ordered = DIM_ORDER.filter((d) => dims.includes(d));
  return { dim: ordered[0] ?? dims[0], extra: ordered.length - 1 };
}

export function isHumanTouched(item: CatalogAdminItem): boolean {
  return DIM_ORDER.some((d) => item.signal?.signals?.[d]?.source === "ember");
}

export function Feedback({ state }: { state: FormState }) {
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

/** Modalitás-chip (mindig látszik a soron): piktogram + megnevezés. */
export function ModalityChip({
  modality,
  compact = false,
}: {
  modality: string | null;
  compact?: boolean;
}) {
  const t = useTranslations("catalog");
  const m = modality ?? "ismeretlen";
  const unknown = m === "ismeretlen";
  const plan = m === "to_be";
  const hist = m === "historikus";
  const cls = unknown
    ? "border border-dashed border-line text-ink-tertiary"
    : plan
      ? "bg-accent-fill text-action-deep"
      : hist
        ? "bg-neutral-100 text-ink-tertiary"
        : "bg-neutral-150 text-ink-secondary";
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center gap-1 rounded-[3px] px-1.5 py-px font-mono text-[10px] font-bold uppercase tracking-[0.06em] ${cls} ${compact ? "w-[86px] justify-center" : ""}`}
    >
      <span className="opacity-60">{MODALITY_GLYPH[m] ?? "?"}</span>
      {compact ? t(`modality.${m}`).split(" ")[0] : t(`modality.${m}`)}
    </span>
  );
}

/** A kétes jelvény: megnevezi, MELYIK dimenzió kétes. */
export function DoubtTag({ dim, extra = 0 }: { dim: LabelDimension; extra?: number }) {
  const t = useTranslations("catalog");
  return (
    <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-[3px] border border-tint-gate-border bg-tint-gate px-2 py-px font-mono text-[10px] font-bold tracking-[0.05em] text-gate-text">
      {t("doubtfulTag", { dim: t(`dim.${dim}`).toUpperCase() })}
      {extra > 0 && ` +${extra}`}
    </span>
  );
}

export function HumanTag() {
  const t = useTranslations("catalog");
  return (
    <span className="inline-flex flex-shrink-0 items-center gap-1 font-mono text-[10px] font-bold tracking-[0.05em] text-done">
      ✓ {t("humanTag")}
    </span>
  );
}

/** Az eredet-sor egy sorban: projekt · fázis · forrás — személy · dátum.
 *  A technikai című soroknál (mező-kulcs / display-id) a cím ide kerül. */
export function originLineParts(item: CatalogAdminItem): string[] {
  const o = item.origin;
  const parts: string[] = [];
  if (o.phase) parts.push(o.phase);
  if (o.artifactLabel) parts.push(o.artifactLabel);
  else if (item.claimFromExcerpt) parts.push(item.title);
  if (o.sourceTitle) {
    parts.push(o.personName ? `${o.sourceTitle} — ${o.personName}` : o.sourceTitle);
  } else if (o.personName) {
    parts.push(o.personName);
  }
  const d = shortOriginDate(o.sourceDate);
  if (d) parts.push(d);
  return parts;
}

// ── Címke-szerkesztő űrlap (változatlan mezőkészlet, saveLabelsAction) ──
export function LabelEditForm({
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
  const candidateOf = (dim: LabelDimension): string => {
    const s = sig?.[dim];
    if (s && !s.accepted && s.source === "gep") return s.label ?? "";
    const m = item.metadata;
    if (!m) return s?.label ?? "";
    switch (dim) {
      case "modality":
        return m.modality;
      case "valid_time":
        return m.validTime ?? "";
      case "scope":
        return m.scope ?? "";
      case "source":
        return m.sourceOrgLevel;
      case "evidence":
        return m.evidenceKind;
      case "lang":
        return m.lang ?? "";
    }
  };
  const sel = "rounded-control border border-line bg-surface px-2 py-1.5 text-[12.5px]";
  const lbl = "font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-ink-tertiary";
  const personDefault =
    item.metadata?.sourcePersonStakeholderId ??
    stakeholders.find((s) => s.name === (sig?.source?.person_name ?? ""))?.id ??
    "";

  return (
    <form action={formAction} className="mt-2 rounded-tile border border-line bg-sunken p-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={lbl}>{t("fieldModality")}</span>
          <select name="modality" defaultValue={candidateOf("modality") || "ismeretlen"} className={sel}>
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
            defaultValue={candidateOf("valid_time")}
            placeholder={t("validTimePlaceholder")}
            className={sel}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={lbl}>{t("fieldScope")}</span>
          <input
            name="scope"
            defaultValue={candidateOf("scope")}
            placeholder={t("scopePlaceholder")}
            className={sel}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={lbl}>{t("fieldLang")}</span>
          <select name="lang" defaultValue={candidateOf("lang")} className={sel}>
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
          <select name="sourceOrgLevel" defaultValue={candidateOf("source") || "ismeretlen"} className={sel}>
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
          <span className={lbl}>{t("fieldEvidence")}</span>
          <select
            name="evidenceKind"
            defaultValue={candidateOf("evidence") || "ismeretlen"}
            className={sel}
          >
            {EVIDENCE_OPTIONS.map((e) => (
              <option key={e} value={e}>
                {t(`evidence.${e}`)}
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

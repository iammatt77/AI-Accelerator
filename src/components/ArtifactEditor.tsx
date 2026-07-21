"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { FormState } from "@/app/actions";
import {
  approveArtifactAction,
  backToDraftAction,
  newVersionAction,
  saveArtifactBody,
  sendToReviewAction,
} from "@/app/artifact-actions";
import type { ArtifactFieldValue } from "@/lib/artifacts/config";
import type { ArtifactStatus } from "@/lib/db/types";
import { EditorFieldAccordion } from "@/components/EditorField";
import { StatusFlow } from "@/components/StatusFlow";
import { StatusPill } from "@/components/StatusPill";
import { SubmitButton } from "@/components/SubmitButton";
import { IconCheck } from "@/components/icons";

// ─────────────────────────────────────────────────────────────
// Dokumentum-szerkesztő v3 (Master 5 + §06): a mezők a nézet forrása.
//   fejléc: breadcrumb + cím + státuszlánc-pillek + Történet/Export
//   → állapot-összefoglaló sáv + Szerkesztés/Előnézet MODE-TOGGLE
//   → EDIT: 3-pane (mezőtérkép 216 · mező-ACCORDION [egy nyitott] ·
//     források 316) — nincs kiterített szövegfal;
//   → PREVIEW: a mezőkből komponált, olvasható dokumentum (~760px)
//     bal oldali szakasz-navval — nem külön tartalom.
//   → lábléc: mentés + HITL jegyzet · státusz-akciók (meglévő actionök).
// ADATMODELL-FLAG (§06/§07): a strukturált mező-tömbök (rank/érték/
// kockázat tételenként) + a „markdown-fal törölve" adatmodell-változás —
// a body megmarad egy CSUKOTT accordion-sorként (funkció nem vész el),
// az előnézet Bevezetőjeként renderel.
// ─────────────────────────────────────────────────────────────

const initialState: FormState = { ok: false, error: null };

export interface EditorFieldData {
  key: string;
  label: string;
  required: boolean;
  field: ArtifactFieldValue;
  /** Csomag A (A1): modul-birtokolt mező — a szerkesztőben read-only. */
  moduleOwned?: boolean;
}

export interface EditorSource {
  index: number;
  title: string;
  text: string;
  date?: string;
}

export interface EditorVersion {
  id: string;
  version: number;
  status: ArtifactStatus;
  statusLabel: string;
  label: string;
  current: boolean;
}

function ErrorAlert({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-mono-sm text-danger">
      {error}
    </p>
  );
}

export function ArtifactEditor({
  projectId,
  artifactId,
  status,
  isHead,
  fields,
  requiredCount,
  body,
  editable,
  sources,
  missingRequiredLabels,
  versions,
  approvedDate,
  phaseHref,
  exportHref,
  clientName,
  phaseLabel,
  typeName,
  version,
  inputsCount,
  nextVersion,
  savedAtLabel,
  syncedAtLabel,
  structuredFields,
}: {
  projectId: string;
  artifactId: string;
  status: ArtifactStatus;
  isHead: boolean;
  fields: EditorFieldData[];
  requiredCount: number;
  body: string;
  editable: boolean;
  sources: EditorSource[];
  missingRequiredLabels: string[];
  versions: EditorVersion[];
  approvedDate: string | null;
  phaseHref: string;
  exportHref: string;
  clientName: string;
  phaseLabel: string;
  typeName: string;
  version: number;
  inputsCount: number;
  nextVersion: number;
  savedAtLabel: string;
  /** Csomag A (A1): az utolsó modul-szinkron formázott bélyege (null = még
   *  nem volt sync) — a modul-birtokolt mezők read-only sorában jelenik meg. */
  syncedAtLabel?: string | null;
  /** P2 (#9): mező-kulcs → strukturált törzs (kalkulátor / sikerdefiníció),
   *  a sima textarea helyett a nyitott accordion-mezőben. */
  structuredFields?: Record<string, React.ReactNode>;
}) {
  const t = useTranslations("editor");
  const tChain = useTranslations("chain");
  const router = useRouter();

  const firstOpen =
    fields.find((f) => f.required && !f.field.value)?.key ?? fields[0]?.key ?? null;
  const [mode, setMode] = useState<"edit" | "preview">(status === "approved" ? "preview" : "edit");
  const [openField, setOpenField] = useState<string | null>(firstOpen);
  const [bodyOpen, setBodyOpen] = useState(fields.length === 0);
  const [activeSource, setActiveSource] = useState<number | null>(null);
  const [editingBody, setEditingBody] = useState(false);
  const sourceRefs = useRef<Map<number, HTMLElement>>(new Map());
  const editorRef = useRef<HTMLDivElement>(null);
  // Fordított irány (forrás → doksi): egy forrásra kattintva a rá hivatkozó
  // [n] jelölők felvillannak. A `flash` egy nonce-olt cél; a useEffect a
  // renderelés után DOM-lekérdezéssel villantja + odagördíti őket.
  const [flash, setFlash] = useState<{ n: number; k: number } | null>(null);

  const [saveState, saveAction] = useActionState(
    saveArtifactBody.bind(null, projectId, artifactId),
    initialState,
  );
  const [reviewState, reviewAction] = useActionState(
    sendToReviewAction.bind(null, projectId, artifactId),
    initialState,
  );
  const [backState, backAction] = useActionState(
    backToDraftAction.bind(null, projectId, artifactId),
    initialState,
  );
  const [approveState, approveAction] = useActionState(
    approveArtifactAction.bind(null, projectId, artifactId),
    initialState,
  );
  const [versionState, versionAction] = useActionState(
    newVersionAction.bind(null, projectId, artifactId),
    initialState as FormState & { newArtifactId?: string },
  );
  useEffect(() => {
    if (versionState.ok && versionState.newArtifactId) {
      router.push(`/project/${projectId}/artifact/${versionState.newArtifactId}`);
    }
  }, [versionState.ok, versionState.newArtifactId, projectId, router]);

  const validIndices = new Set(sources.map((s) => s.index));
  const citationCount = (
    [body, ...fields.map((f) => f.field.value ?? "")].join(" ").match(/\[(\d+)\]/g) ?? []
  ).filter((m) => validIndices.has(parseInt(m.slice(1, -1), 10))).length;

  const requiredConfirmed = fields.filter(
    (f) =>
      f.required &&
      Boolean(f.field.value) &&
      (f.field.state === "confirmed" || f.field.state === "manual"),
  ).length;
  const optionalEmpty = fields.filter((f) => !f.required && !f.field.value);
  const allReady = requiredCount > 0 && requiredConfirmed === requiredCount;
  const missingCount = missingRequiredLabels.length;

  const jumpToSource = (n: number) => {
    setActiveSource(n);
    sourceRefs.current.get(n)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const openAndScroll = (key: string) => {
    setOpenField(key);
    window.setTimeout(() => {
      document.getElementById(`fld-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  };

  // Forrás → doksi: a forrás-kártyát kiemeljük, kinyitjuk a hivatkozó mezőt
  // (edit-módban, egy-nyitott accordion) + a body-t, majd villantunk (useEffect).
  const flashCitations = (n: number) => {
    setActiveSource(n);
    if (mode === "edit") {
      // a hivatkozó mező: inline [n] az értékben VAGY mező-szintű forrás-index
      // (a „Források:" sor is kattintható [n]-t renderel) → nyíljon ki.
      const refField = fields.find(
        (f) => (f.field.value ?? "").includes(`[${n}]`) || f.field.source_indices.includes(n),
      );
      if (refField) setOpenField(refField.key);
      if (body.includes(`[${n}]`)) setBodyOpen(true);
    }
    setFlash((prev) => ({ n, k: (prev?.k ?? 0) + 1 }));
  };

  useEffect(() => {
    if (!flash) return;
    const { n } = flash;
    const id = window.setTimeout(() => {
      const root = editorRef.current;
      if (!root) return;
      const els = Array.from(root.querySelectorAll<HTMLElement>(`[data-cite="${n}"]`));
      if (els.length === 0) return;
      // az első felvillanó hely legfelülre (a többi kilóghat lefelé)
      els[0].scrollIntoView({ behavior: "smooth", block: "start" });
      for (const el of els) {
        el.animate(
          [
            { boxShadow: "0 0 0 0 rgba(46,119,168,0)", backgroundColor: "rgba(46,119,168,0.34)" },
            {
              boxShadow: "0 0 0 5px rgba(46,119,168,0.28)",
              backgroundColor: "rgba(46,119,168,0.34)",
              offset: 0.35,
            },
            { boxShadow: "0 0 0 0 rgba(46,119,168,0)", backgroundColor: "rgba(46,119,168,0)" },
          ],
          { duration: 1150, easing: "ease-out" },
        );
      }
    }, 90);
    return () => window.clearTimeout(id);
  }, [flash]);

  const renderWithCitations = (text: string) =>
    text.split(/(\[\d+\])/g).map((part, i) => {
      const m = part.match(/^\[(\d+)\]$/);
      const n = m ? parseInt(m[1], 10) : NaN;
      if (m && validIndices.has(n)) {
        return (
          <button
            key={i}
            type="button"
            data-cite={n}
            onClick={() => jumpToSource(n)}
            className="mx-0.5 inline-flex items-center rounded-3 bg-tint-pivot px-1.5 align-baseline font-mono text-[11px] text-pivot hover:underline"
          >
            [{n}]
          </button>
        );
      }
      return <span key={i}>{part}</span>;
    });

  // ── Mezőtérkép sín (bal) ──
  const fieldMap = (
    <aside className="border-b border-line-soft bg-soft p-3 lg:border-b-0 lg:border-r">
      <div className="px-1.5 pb-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
        {t("fieldMapTitle")} · {requiredConfirmed}/{requiredCount} {t("requiredTag")}
      </div>
      <div className="flex flex-col gap-[3px]">
        {fields
          .filter((f) => f.required)
          .map((f) => (
            <FieldMapRow
              key={f.key}
              label={f.label}
              done={Boolean(f.field.value)}
              active={mode === "edit" && openField === f.key}
              onClick={() => openAndScroll(f.key)}
            />
          ))}
        {fields.some((f) => !f.required) && (
          <>
            <div className="mx-1 my-1.5 h-px bg-line-soft" />
            <div className="px-1.5 pb-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-450">
              {t("optionalSection")}
            </div>
            {fields
              .filter((f) => !f.required)
              .map((f) => (
                <FieldMapRow
                  key={f.key}
                  label={f.label}
                  done={Boolean(f.field.value)}
                  active={mode === "edit" && openField === f.key}
                  onClick={() => openAndScroll(f.key)}
                />
              ))}
          </>
        )}
      </div>
    </aside>
  );

  // ── Források sín (jobb) ──
  const sourcesRail = (
    <aside className="border-t border-line-soft bg-soft p-4 lg:border-l lg:border-t-0">
      <div className="mb-2.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
        {t("sourcesCountLabel", { sources: sources.length, citations: citationCount })}
      </div>
      {sources.length === 0 ? (
        <p className="text-body text-ink-tertiary">{t("noSources")}</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {sources.map((s) => {
            const cited = activeSource === s.index;
            return (
              <button
                key={s.index}
                type="button"
                title={t("sourceTileHint")}
                onClick={() => flashCitations(s.index)}
                ref={(el) => {
                  if (el) sourceRefs.current.set(s.index, el);
                  else sourceRefs.current.delete(s.index);
                }}
                className={`w-full rounded-control bg-surface p-[11px_13px] text-left ${
                  cited
                    ? "border-[1.5px] border-pivot shadow-card-sm"
                    : "border border-line-soft hover:border-pivot/50 hover:bg-neutral-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="shrink-0 font-mono text-[10.5px] font-bold text-pivot">
                    [{s.index}]
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
                    {s.title}
                  </span>
                  {s.date && (
                    <span className="shrink-0 font-mono text-[9.5px] text-ink-tertiary">
                      {s.date}
                    </span>
                  )}
                </div>
                <p
                  className={`mt-1.5 text-[12px] leading-relaxed text-ink-secondary ${cited ? "italic" : "line-clamp-2"}`}
                >
                  {cited ? `„${s.text}”` : s.text}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );

  // ── Kompakt források-panel (előnézet / kész-doksi) ──
  // A tár kész-doksi nézetében (approved → preview) és a draft-előnézetben is
  // ott a forrás-panel, hogy a [n] mindkét irányban működjön: [n] → csempe
  // kiemelés, csempe → doksi [n]-felvillanás. Kompakt: [n] + rövid cím.
  const compactSources = (
    <aside className="border-t border-line-soft bg-soft p-4 lg:border-l lg:border-t-0">
      <div className="mb-2.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
        {t("sourcesCountLabel", { sources: sources.length, citations: citationCount })}
      </div>
      {sources.length === 0 ? (
        <p className="text-body text-ink-tertiary">{t("noSources")}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {sources.map((s) => {
            const cited = activeSource === s.index;
            return (
              <button
                key={s.index}
                type="button"
                title={t("sourceTileHint")}
                onClick={() => flashCitations(s.index)}
                ref={(el) => {
                  if (el) sourceRefs.current.set(s.index, el);
                  else sourceRefs.current.delete(s.index);
                }}
                className={`flex w-full items-center gap-2 rounded-control bg-surface px-2.5 py-2 text-left ${
                  cited
                    ? "border-[1.5px] border-pivot shadow-card-sm"
                    : "border border-line-soft hover:border-pivot/50 hover:bg-neutral-50"
                }`}
              >
                <span className="shrink-0 font-mono text-[10.5px] font-bold text-pivot">
                  [{s.index}]
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{s.title}</span>
                {s.date && (
                  <span className="shrink-0 font-mono text-[9px] text-ink-tertiary">{s.date}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );

  // ── Verzió-sín (approved) ──
  const versionsRail = (
    <aside className="border-t border-line-soft bg-soft p-4 lg:border-l lg:border-t-0">
      <div className="mb-2.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
        {t("versionsTitle")} · {versions.length}
      </div>
      <div className="flex flex-col gap-2">
        {versions.map((v) => (
          <Link
            key={v.id}
            href={`/project/${projectId}/artifact/${v.id}`}
            className={`flex items-center gap-2 rounded-control px-2.5 py-2 text-[12px] ${
              v.current
                ? "border border-tint-done-border bg-tint-done-band"
                : "border border-line-soft bg-surface hover:bg-neutral-50"
            }`}
          >
            <span
              className={`font-mono text-[10.5px] font-bold ${v.current ? "text-done-text" : "text-ink-tertiary"}`}
            >
              v{v.version}
            </span>
            <span className="min-w-0 flex-1 truncate">{v.label}</span>
            <StatusPill variant={v.status} label={v.statusLabel} title={v.statusLabel} />
          </Link>
        ))}
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-tertiary">{t("compareVersions")}</p>
    </aside>
  );

  const filledFields = fields.filter((f) => f.field.value);

  return (
    <div
      ref={editorRef}
      className="overflow-hidden rounded-shell border border-line bg-neutral-50 shadow-shell"
    >
      {/* ── Fejléc ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line-soft bg-surface px-6 py-3.5">
        <div className="min-w-0">
          <Link
            href={phaseHref}
            className="block truncate font-mono text-[11px] text-ink-tertiary hover:text-ink-secondary hover:underline"
          >
            {clientName} / {phaseLabel} / {t("documentsCrumb")}
          </Link>
          <div className="mt-0.5 flex items-baseline gap-2">
            <h1 className="truncate text-[19px] font-bold tracking-tight">{typeName}</h1>
            <span className="font-mono text-[12px] font-semibold text-ink-tertiary">
              v{version}
              {status === "approved" ? ` · ${t("finalTag")}` : ""}
            </span>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <StatusFlow status={status} />
          {status === "approved" ? (
            <a
              href={exportHref}
              className="rounded-control bg-action px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-action hover:bg-action-hover"
            >
              {t("exportPdf")}
            </a>
          ) : (
            <span className="rounded-control border border-neutral-350 bg-surface px-3 py-2 font-mono text-[11px] font-semibold text-ink-secondary">
              {t("historyLabel", { count: versions.length })}
            </span>
          )}
        </div>
      </div>

      {/* ── Állapot-összefoglaló + mode toggle ── */}
      {status === "approved" ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-tint-done-border bg-tint-done-band px-6 py-2.5">
          <IconCheck size={11} className="shrink-0 text-done" />
          <p className="min-w-0 flex-1 text-[12.5px] font-semibold text-done-text">
            {approvedDate ? t("approvedOn", { date: approvedDate }) : t("approvedTitle")}
          </p>
          <Link
            href={phaseHref}
            className="rounded-control bg-action px-3 py-1.5 text-[12px] font-semibold text-white shadow-action hover:bg-action-hover"
          >
            {t("goToGate")} →
          </Link>
        </div>
      ) : (
        <div
          className={`flex flex-wrap items-center gap-3 border-b px-6 py-2.5 ${
            allReady
              ? "border-tint-done-border bg-tint-done-band"
              : "border-tint-gate-border bg-tint-gate-band"
          }`}
        >
          {allReady ? (
            <>
              <IconCheck size={11} className="shrink-0 text-done" />
              <p className="min-w-0 flex-1 text-[13px] leading-snug text-done-text">
                <b className="text-ink">{t("summaryReady", { n: requiredCount })}</b>{" "}
                {optionalEmpty.length > 0 &&
                  t("summaryOptional", {
                    n: optionalEmpty.length,
                    fields: optionalEmpty.map((f) => f.label).join(", "),
                  })}
              </p>
            </>
          ) : (
            <>
              <span aria-hidden className="shrink-0 text-gate-text">
                ◇
              </span>
              <p className="min-w-0 flex-1 text-[13px] leading-snug text-gate-text">
                <b>
                  {status === "in_review"
                    ? t("blockedTitle", { count: missingCount })
                    : t("summaryDraft", { done: requiredConfirmed, total: requiredCount })}
                </b>{" "}
                {missingRequiredLabels.length > 0 && missingRequiredLabels.join(" · ")}
              </p>
            </>
          )}
          <div className="flex shrink-0 rounded-tile border border-neutral-350 bg-surface p-0.5">
            <button
              type="button"
              onClick={() => setMode("edit")}
              aria-pressed={mode === "edit"}
              className={`rounded-3 px-3 py-[5px] text-[12px] font-semibold ${
                mode === "edit" ? "bg-action text-white" : "text-ink-secondary hover:text-ink"
              }`}
            >
              {t("modeEdit")}
            </button>
            <button
              type="button"
              onClick={() => setMode("preview")}
              aria-pressed={mode === "preview"}
              className={`rounded-3 px-3 py-[5px] text-[12px] font-semibold ${
                mode === "preview" ? "bg-action text-white" : "text-ink-secondary hover:text-ink"
              }`}
            >
              {t("modePreview")}
            </button>
          </div>
        </div>
      )}

      {/* ── Törzs ── */}
      {mode === "edit" ? (
        <div className="grid grid-cols-1 lg:grid-cols-[216px_minmax(0,1fr)_316px]">
          {fieldMap}
          <div className="flex flex-col gap-2.5 bg-neutral-50 p-4">
            {fields.map((f) => (
              <EditorFieldAccordion
                key={f.key}
                projectId={projectId}
                artifactId={artifactId}
                fieldKey={f.key}
                label={f.label}
                required={f.required}
                field={f.field}
                editable={editable}
                open={openField === f.key}
                onToggle={() => setOpenField(openField === f.key ? null : f.key)}
                moduleOwned={f.moduleOwned}
                syncedAtLabel={syncedAtLabel}
                customBody={structuredFields?.[f.key]}
                renderCitations={renderWithCitations}
              />
            ))}

            {/* Body (markdown) — CSUKOTT accordion-sor: a meglévő
                mentés/generálás funkció nem vész el (adatmodell-FLAG). */}
            <div
              className={
                bodyOpen
                  ? "overflow-hidden rounded-shell border border-line bg-surface shadow-card-sm"
                  : ""
              }
            >
              <button
                type="button"
                onClick={() => setBodyOpen((o) => !o)}
                aria-expanded={bodyOpen}
                className={`flex w-full items-center gap-2.5 px-4 py-[13px] text-left ${
                  bodyOpen
                    ? "border-b border-neutral-100 bg-soft"
                    : "rounded-shell border border-line bg-surface shadow-card-sm hover:bg-neutral-50"
                }`}
              >
                <span
                  aria-hidden
                  className={`shrink-0 text-ink-tertiary ${bodyOpen ? "rotate-90" : ""}`}
                >
                  ›
                </span>
                <span className="text-[13.5px] font-bold">{t("bodyTitle")}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-tertiary">
                  {body.trim() === "" ? t("noBody") : body}
                </span>
              </button>
              {bodyOpen && (
                <div className="space-y-2.5 p-4">
                  {editingBody && editable ? (
                    <form action={saveAction} className="space-y-2">
                      <textarea
                        key={saveState.nonce ?? 0}
                        name="body"
                        rows={10}
                        defaultValue={saveState.values?.body ?? body}
                        placeholder={t("bodyPlaceholder")}
                        className="w-full rounded-control border border-line bg-surface px-3 py-2 font-mono text-mono-sm"
                      />
                      <ErrorAlert error={saveState.error} />
                      {saveState.ok && <p className="text-body text-done">{t("saved")}</p>}
                      <SubmitButton variant="secondary" pendingLabel={t("saving")}>
                        {t("saveCta")}
                      </SubmitButton>
                    </form>
                  ) : (
                    <>
                      {body.trim() === "" ? (
                        <p className="text-body text-ink-tertiary">{t("noBody")}</p>
                      ) : (
                        <div className="card-sunken max-h-56 overflow-y-auto whitespace-pre-wrap p-3 text-body">
                          {renderWithCitations(body)}
                        </div>
                      )}
                      {editable && (
                        <button
                          type="button"
                          onClick={() => setEditingBody(true)}
                          className="rounded-control border border-neutral-350 bg-surface px-3 py-1.5 text-[12px] font-semibold hover:bg-neutral-50"
                        >
                          {t("editCta")}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          {status === "approved" ? versionsRail : sourcesRail}
        </div>
      ) : (
        /* ── Előnézet: a mezőkből komponált dokumentum + kompakt források ── */
        <div
          className={`grid grid-cols-1 ${
            sources.length > 0
              ? "lg:grid-cols-[184px_minmax(0,1fr)_236px]"
              : "lg:grid-cols-[200px_minmax(0,1fr)]"
          }`}
        >
          <aside className="border-b border-line-soft bg-soft p-4 lg:border-b-0 lg:border-r">
            <div className="px-1.5 pb-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
              {t("tocTitle")}
            </div>
            <div className="flex flex-col gap-0.5">
              {body.trim() !== "" && (
                <a
                  href="#pv-intro"
                  className="rounded-3 bg-accent-fill px-2 py-1.5 text-[12px] font-bold text-action-deep"
                >
                  {t("introSection")}
                </a>
              )}
              {filledFields.map((f) => (
                <a
                  key={f.key}
                  href={`#pv-${f.key}`}
                  className="rounded-3 px-2 py-1.5 text-[12px] text-ink-secondary hover:bg-neutral-100"
                >
                  {f.label}
                </a>
              ))}
            </div>
          </aside>
          <div className="max-w-[760px] bg-neutral-50 px-7 py-7 lg:px-10">
            <div className="font-mono text-[12px] text-ink-tertiary">
              {phaseLabel} · {t("deliverableKicker")}
            </div>
            <h2 className="mt-1.5 text-[24px] font-extrabold tracking-tight">{typeName}</h2>
            {body.trim() !== "" && (
              <p
                id="pv-intro"
                className="mt-4 scroll-mt-4 whitespace-pre-wrap text-[13.5px] leading-[1.7] text-ink"
              >
                {renderWithCitations(body)}
              </p>
            )}
            {filledFields.map((f) => (
              <div key={f.key} id={`pv-${f.key}`} className="scroll-mt-4">
                <div className="my-6 h-px bg-neutral-100" />
                <h3 className="text-[16px] font-bold">{f.label}</h3>
                <div className="mt-3 rounded-tile border border-line-soft bg-surface p-[12px_14px]">
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
                    {renderWithCitations(f.field.value ?? "")}
                  </p>
                </div>
              </div>
            ))}
            {filledFields.length === 0 && body.trim() === "" && (
              <p className="mt-5 text-body text-ink-tertiary">{t("previewEmpty")}</p>
            )}
          </div>
          {sources.length > 0 && compactSources}
        </div>
      )}

      {/* ── Lábléc: mentés + HITL · státusz-akciók ── */}
      {status !== "approved" ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line-soft bg-soft px-6 py-3">
          <span className="min-w-0 text-[12px] text-ink-tertiary">
            {t("hitlFooter", { date: savedAtLabel, count: inputsCount })}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {status === "draft" && (
              <>
                <button
                  type="button"
                  onClick={() => setMode(mode === "edit" ? "preview" : "edit")}
                  className="px-2.5 py-2 text-[12.5px] font-semibold text-action hover:underline"
                >
                  {mode === "edit" ? t("modePreview") : t("modeEdit")}
                </button>
                <form action={reviewAction}>
                  <SubmitButton pendingLabel={tChain("sending")}>
                    {tChain("sendToReview")} →
                  </SubmitButton>
                </form>
              </>
            )}
            {status === "in_review" && (
              <>
                <form action={backAction}>
                  <button
                    type="submit"
                    className="rounded-control px-3 py-2 text-[12.5px] font-semibold text-action hover:bg-accent-tint"
                  >
                    {tChain("backToDraft")}
                  </button>
                </form>
                {missingCount > 0 ? (
                  <span
                    aria-disabled
                    className="cursor-not-allowed rounded-control bg-neutral-150 px-4 py-2 text-[12.5px] font-semibold text-ink-tertiary"
                  >
                    {t("approveMissing", { count: missingCount })}
                  </span>
                ) : (
                  <form action={approveAction}>
                    <SubmitButton pendingLabel={tChain("approving")}>
                      {tChain("approveCta")}
                    </SubmitButton>
                  </form>
                )}
              </>
            )}
          </div>
          {(reviewState.error || backState.error || approveState.error) && (
            <p role="alert" className="w-full text-mono-sm text-danger">
              {reviewState.error ?? backState.error ?? approveState.error}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 border-t border-line-soft bg-soft px-6 py-3">
          <span className="text-[11.5px] text-ink-tertiary">
            {t("editingLockedNote", { next: nextVersion })}
          </span>
          {isHead && (
            <form action={versionAction} className="ml-auto">
              <ErrorAlert error={versionState.error} />
              <SubmitButton variant="secondary" pendingLabel={tChain("creatingVersion")}>
                {tChain("newVersionCta")}
              </SubmitButton>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function FieldMapRow({
  label,
  done,
  active,
  onClick,
}: {
  label: string;
  done: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-3 px-2 py-[7px] text-left text-[12px] ${
        active
          ? "bg-accent-fill font-bold text-action-deep"
          : done
            ? "text-ink-secondary hover:bg-neutral-100"
            : "font-bold text-gate-text hover:bg-neutral-100"
      }`}
    >
      {done ? (
        <IconCheck size={9} className="shrink-0 text-done" />
      ) : (
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-[2px] border-[1.5px] border-gate" />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

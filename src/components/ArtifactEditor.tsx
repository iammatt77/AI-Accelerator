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
import { EditorField } from "@/components/EditorField";
import { StatusFlow } from "@/components/StatusFlow";
import { StatusPill } from "@/components/StatusPill";
import { SubmitButton } from "@/components/SubmitButton";

// ─────────────────────────────────────────────────────────────
// Dokumentum-szerkesztő — v2 ref (ref_editor_1a / 1b). EGY üveg-konténer:
//   fejléc (azonosság + státuszlánc-pillek + History/Export)
//   → blokkoló/szalag-sáv
//   → HÁROM oszlop egymás mellett (field-map · dokumentum · sources) —
//     approved-nél két oszlop (dokumentum · verziók)
//   → teljes szélességű lábléc (HITL + Back/Approve).
// A body a KÖZÉPSŐ oszlopban kompakt, görgethető panel (nem kiterített
// szalag). A felület a rendszer surface-card receptje; az olvasó/öröklött
// tartalom süllyesztett (6. törvény). A funkció változatlan: a mező- és
// státusz-akciók a MEGLÉVŐ server actionök; az approve-blokk a szerveren.
// ─────────────────────────────────────────────────────────────

const initialState: FormState = { ok: false, error: null };

export interface EditorFieldData {
  key: string;
  label: string;
  required: boolean;
  field: ArtifactFieldValue;
}

export interface EditorSource {
  index: number;
  title: string;
  text: string;
  /** Rövid dátumbélyeg a források-panelhez (v2: „Jul 9"). */
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
  filled,
  requiredCount,
  body,
  editable,
  sources,
  missingRequiredLabels,
  unconfirmedLabels,
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
}: {
  projectId: string;
  artifactId: string;
  status: ArtifactStatus;
  isHead: boolean;
  fields: EditorFieldData[];
  filled: number;
  requiredCount: number;
  body: string;
  editable: boolean;
  sources: EditorSource[];
  missingRequiredLabels: string[];
  unconfirmedLabels: string[];
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
}) {
  const t = useTranslations("editor");
  const tWs = useTranslations("workspace");
  const tChain = useTranslations("chain");
  const router = useRouter();
  const [activeSource, setActiveSource] = useState<number | null>(null);
  const [editingBody, setEditingBody] = useState(editable && body.trim() === "");
  const sourceRefs = useRef<Map<number, HTMLElement>>(new Map());

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
  const citationCount = (body.match(/\[(\d+)\]/g) ?? []).filter((m) =>
    validIndices.has(parseInt(m.slice(1, -1), 10)),
  ).length;
  const missingCount = missingRequiredLabels.length;

  const jumpToSource = (n: number) => {
    setActiveSource(n);
    sourceRefs.current.get(n)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const jumpToField = (key: string) => {
    const el = document.getElementById(`fld-${key}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-active");
    window.setTimeout(() => el.classList.remove("ring-2", "ring-active"), 2000);
  };

  const renderBodyWithCitations = (text: string) =>
    text.split(/(\[\d+\])/g).map((part, i) => {
      const m = part.match(/^\[(\d+)\]$/);
      const n = m ? parseInt(m[1], 10) : NaN;
      if (m && validIndices.has(n)) {
        return (
          <button
            key={i}
            type="button"
            onClick={() => jumpToSource(n)}
            title={t("citationTitle", { n })}
            className={`mx-0.5 inline-flex items-center rounded-pill border px-1.5 py-0 align-baseline font-mono text-mono-sm transition-colors duration-[var(--motion-base)] ${
              activeSource === n
                ? "border-pivot bg-pivot/10 text-pivot"
                : "border-line bg-surface text-pivot hover:border-pivot/60"
            }`}
          >
            [{n}]
          </button>
        );
      }
      return <span key={i}>{part}</span>;
    });

  // ── FIELD MAP sín (bal) ──────────────────────────────────────
  const fieldMap = (
    <aside className="border-b border-line p-3 lg:border-b-0 lg:border-r">
      <h2 className="px-1.5 pb-2 font-mono text-mono-sm font-bold uppercase tracking-wide text-ink-tertiary">
        {t("fieldMapTitle")} · {filled}/{requiredCount}
      </h2>
      <ul className="space-y-0.5">
        {fields.map((f) => {
          const confirmed = f.field.state === "confirmed" || f.field.state === "manual";
          const emptyReq = f.required && !f.field.value;
          return (
            <li key={f.key}>
              <button
                type="button"
                onClick={() => jumpToField(f.key)}
                className={`flex w-full items-center gap-2 rounded-3 px-2 py-1.5 text-left text-body hover:bg-neutral-100 ${
                  emptyReq ? "bg-tint-gate font-semibold text-gate" : ""
                }`}
              >
                <span
                  aria-hidden
                  className={`shrink-0 font-mono ${confirmed ? "text-done" : emptyReq ? "text-gate" : "text-ink-tertiary"}`}
                >
                  {confirmed ? "✓" : emptyReq ? "☐" : "○"}
                </span>
                <span className="min-w-0 flex-1 truncate">{f.label}</span>
                {!f.required && (
                  <span className="shrink-0 text-mono-sm text-ink-tertiary">
                    {t("optionalShort")}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );

  // ── Kompakt body-panel (a középső oszlop alján) ──────────────
  const bodyPanel = (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-body font-semibold">{t("bodyTitle")}</h3>
        {editable ? (
          <button
            type="button"
            onClick={() => setEditingBody((e) => !e)}
            className="rounded-control border border-line bg-surface px-3 py-1 text-mono-sm font-medium shadow-tile-sm hover:bg-sunken"
          >
            {editingBody ? t("viewCta") : t("editCta")}
          </button>
        ) : (
          <span className="text-mono-sm text-ink-tertiary">{t("readOnly")}</span>
        )}
      </div>
      {editingBody && editable ? (
        <form action={saveAction} className="space-y-2">
          <textarea
            key={saveState.nonce ?? 0}
            name="body"
            rows={12}
            defaultValue={saveState.values?.body ?? body}
            placeholder={t("bodyPlaceholder")}
            className="w-full rounded-tile border border-line bg-surface px-3 py-2 font-mono text-mono-sm"
          />
          <ErrorAlert error={saveState.error} />
          {saveState.ok && <p className="text-body text-done">{t("saved")}</p>}
          <SubmitButton variant="secondary" pendingLabel={t("saving")}>
            {t("saveCta")}
          </SubmitButton>
        </form>
      ) : body.trim() === "" ? (
        <p className="text-body text-ink-tertiary">{t("noBody")}</p>
      ) : (
        <>
          <p className="mb-1.5 text-mono-sm text-ink-tertiary">{t("citationHint")}</p>
          <div className="card-sunken max-h-64 overflow-y-auto whitespace-pre-wrap p-3 text-body">
            {renderBodyWithCitations(body)}
          </div>
        </>
      )}
    </section>
  );

  // ── SOURCES sín (jobb) ───────────────────────────────────────
  const sourcesRail = (
    <aside className="border-t border-line p-4 lg:border-l lg:border-t-0">
      <h2 className="mb-3 font-mono text-mono-sm font-bold uppercase tracking-wide text-ink-tertiary">
        {t("sourcesCountLabel", { sources: sources.length, citations: citationCount })}
      </h2>
      {sources.length === 0 ? (
        <p className="text-body text-ink-tertiary">{t("noSources")}</p>
      ) : (
        <ul className="space-y-2.5">
          {sources.map((source) => {
            const cited = activeSource === source.index;
            return (
              <li
                key={source.index}
                ref={(el) => {
                  if (el) sourceRefs.current.set(source.index, el);
                  else sourceRefs.current.delete(source.index);
                }}
                className={`card-sunken p-3 ${cited ? "border-[1.5px] border-pivot shadow-tile-sm" : ""}`}
              >
                <div className="flex items-start gap-2">
                  <span className="shrink-0 font-mono text-mono-sm font-bold text-pivot">
                    [{source.index}]
                  </span>
                  <span className="min-w-0 flex-1 text-body font-semibold leading-snug">
                    {source.title}
                  </span>
                  {source.date && (
                    <span className="shrink-0 font-mono text-mono-sm text-ink-tertiary">
                      {source.date}
                    </span>
                  )}
                </div>
                {cited ? (
                  <p className="mt-1.5 whitespace-pre-wrap text-body italic text-ink-secondary">
                    {`„${source.text}”`}
                  </p>
                ) : (
                  <p className="mt-1 line-clamp-2 text-mono-sm text-ink-secondary">
                    {source.text}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );

  // ── Verzió-sín (approved) ────────────────────────────────────
  const versionsRail = (
    <aside className="border-t border-line p-4 lg:border-l lg:border-t-0">
      <h2 className="mb-3 font-mono text-mono-sm font-bold uppercase tracking-wide text-ink-tertiary">
        {t("versionsTitle")} · {versions.length}
      </h2>
      <ul className="space-y-1.5">
        {versions.map((v) => (
          <li key={v.id}>
            <Link
              href={`/project/${projectId}/artifact/${v.id}`}
              className={`flex items-center justify-between gap-2 rounded-tile border px-3 py-2 text-body transition-colors duration-[var(--motion-base)] ${
                v.current ? "border-done/50 bg-tint-done" : "border-line bg-surface hover:bg-sunken"
              }`}
            >
              <span className="min-w-0">
                <span
                  className={`font-mono text-mono-sm ${v.current ? "font-bold text-done" : "text-ink-secondary"}`}
                >
                  v{v.version}
                </span>{" "}
                {v.label}
              </span>
              <StatusPill variant={v.status} label={v.statusLabel} title={v.statusLabel} />
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-mono-sm leading-snug text-ink-tertiary">{t("compareVersions")}</p>
    </aside>
  );

  return (
    <div className="surface-card overflow-hidden p-0">
      {/* ── Fejléc: azonosság + státuszlánc + History/Export ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <Link
            href={phaseHref}
            className="block font-mono text-mono-sm text-ink-tertiary hover:text-ink-secondary hover:underline"
          >
            {clientName} / {phaseLabel} / {t("documentsCrumb")}
          </Link>
          <h1 className="mt-0.5 flex items-baseline gap-2 text-title">
            {typeName}
            <span className="font-mono text-body text-ink-tertiary">v{version}</span>
          </h1>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <StatusFlow status={status} />
          {status === "approved" ? (
            <a
              href={exportHref}
              className="rounded-control bg-action px-3.5 py-1.5 text-body font-semibold text-white shadow-action transition-colors duration-[var(--motion-base)] hover:bg-action-hover"
            >
              {t("exportPdf")}
            </a>
          ) : (
            <span className="rounded-control border border-line bg-surface px-3 py-1.5 text-mono-sm font-semibold text-ink-secondary">
              {t("historyLabel", { count: versions.length })}
            </span>
          )}
        </div>
      </div>

      {/* ── Blokkoló / szalag ── */}
      {status === "in_review" && missingCount > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-gate/40 bg-tint-gate px-5 py-2.5 text-body text-gate">
          <span className="font-semibold">
            <span aria-hidden>◇</span> {t("blockedTitle", { count: missingCount })}
          </span>
          {fields
            .filter((f) => f.required && !f.field.value)
            .map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => jumpToField(f.key)}
                className="font-mono text-mono-sm underline decoration-dotted underline-offset-2 hover:text-ink"
              >
                {t("jumpTo", { field: f.label })} ↓
              </button>
            ))}
          <span className="ml-auto font-mono text-mono-sm">
            {tWs("completeness", { filled, required: requiredCount })}
          </span>
        </div>
      ) : status === "approved" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-done/40 bg-tint-done px-5 py-2.5 text-body text-done">
          <span className="font-semibold">
            <span aria-hidden>✓</span>{" "}
            {approvedDate ? t("approvedOn", { date: approvedDate }) : t("approvedTitle")}
          </span>
          <Link
            href={phaseHref}
            className="rounded-control bg-action px-3.5 py-1.5 text-body font-semibold text-white shadow-action transition-colors duration-[var(--motion-base)] hover:bg-action-hover"
          >
            {t("goToGate")} →
          </Link>
        </div>
      ) : (
        <div className="flex items-center gap-3 border-b border-line bg-sunken/60 px-5 py-2">
          <span className="font-mono text-mono-sm text-ink-secondary">
            {tWs("completeness", { filled, required: requiredCount })}
          </span>
          {status === "in_review" && unconfirmedLabels.length > 0 && (
            <span className="font-mono text-mono-sm text-gate">
              · {tChain("unconfirmedWarnTitle")} {unconfirmedLabels.join(", ")}
            </span>
          )}
        </div>
      )}

      {/* ── Oszlopok ── */}
      {status === "approved" ? (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4 p-6">
            {fields.map((f) => (
              <EditorField
                key={f.key}
                projectId={projectId}
                artifactId={artifactId}
                fieldKey={f.key}
                label={f.label}
                required={f.required}
                field={f.field}
                editable={false}
              />
            ))}
            {bodyPanel}
            <div className="border-t border-line pt-3">
              <p className="text-mono-sm text-ink-tertiary">
                {t("editingLockedNote", { next: nextVersion })}
              </p>
              {isHead && (
                <form action={versionAction} className="mt-2">
                  <ErrorAlert error={versionState.error} />
                  <SubmitButton variant="secondary" pendingLabel={tChain("creatingVersion")}>
                    {tChain("newVersionCta")}
                  </SubmitButton>
                </form>
              )}
            </div>
          </div>
          {versionsRail}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)_340px]">
          {fieldMap}
          <div className="space-y-5 p-6">
            {fields.map((f) => (
              <EditorField
                key={f.key}
                projectId={projectId}
                artifactId={artifactId}
                fieldKey={f.key}
                label={f.label}
                required={f.required}
                field={f.field}
                editable={editable}
              />
            ))}
            {bodyPanel}
          </div>
          {sourcesRail}
        </div>
      )}

      {/* ── Lábléc: HITL + státusz-akciók (draft / in review) ── */}
      {status !== "approved" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line bg-sunken/60 px-5 py-3">
          <span className="text-mono-sm text-ink-tertiary">
            {t("hitlFooter", { count: inputsCount })}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {status === "draft" && (
              <form action={reviewAction}>
                <ErrorAlert error={reviewState.error} />
                <SubmitButton variant="secondary" pendingLabel={tChain("sending")}>
                  {tChain("sendToReview")}
                </SubmitButton>
              </form>
            )}
            {status === "in_review" && (
              <>
                <form action={backAction}>
                  <button
                    type="submit"
                    className="rounded-control px-3 py-2 text-body font-semibold text-action hover:bg-tint-action"
                  >
                    {tChain("backToDraft")}
                  </button>
                </form>
                {missingCount > 0 ? (
                  <span
                    aria-disabled
                    className="cursor-not-allowed rounded-control bg-neutral-150 px-4 py-2 text-body font-semibold text-ink-tertiary"
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
          {(backState.error || approveState.error) && (
            <p role="alert" className="w-full text-mono-sm text-danger">
              {backState.error ?? approveState.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

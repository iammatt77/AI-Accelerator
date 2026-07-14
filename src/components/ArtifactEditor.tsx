"use client";

import { useRef, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { FormState } from "@/app/actions";
import { saveArtifactBody } from "@/app/artifact-actions";
import type { ArtifactFieldValue, FieldState } from "@/lib/artifacts/config";
import type { ArtifactStatus } from "@/lib/db/types";
import { FieldCard } from "@/components/WorkspaceForms";
import { StatusChain } from "@/components/StatusChain";
import { StatusFlow } from "@/components/StatusFlow";
import { StatusPill } from "@/components/StatusPill";
import { SubmitButton } from "@/components/SubmitButton";

// ─────────────────────────────────────────────────────────────
// Dokumentum-szerkesztő — Redesign #1 (design 1a/1b): három panel.
//   bal   = FIELD MAP — minden mező állapota + „ugrás oda"; teljesség N/M
//   közép = a dokumentum: mező-szekciók (draft: kitölthető FieldCard,
//           E1-akciókkal) + a body-draft (kattintható [n] citációkkal)
//   jobb  = SOURCES (citált források) — approved-nél VERSIONS-rá vált
// Fent a státusz-folyam + blokkoló-sáv („mi hiányzik" egy pillantásra +
// ugró-linkek). A funkció változatlan: a mező- és státusz-akciók a meglévő
// server actionök; az approve-blokk a szerveren dől el (E1).
// ─────────────────────────────────────────────────────────────

const initialState: FormState = { ok: false, error: null };

export interface EditorField {
  key: string;
  label: string;
  required: boolean;
  field: ArtifactFieldValue;
}

export interface EditorSource {
  index: number;
  title: string;
  text: string;
  /** Rövid dátumbélyeg a források-panelhez (v2: „Jul 9 · 12:41"). */
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

function fieldMapTone(state: FieldState, required: boolean) {
  if (state === "confirmed" || state === "manual")
    return { icon: "✓", cls: "text-done" };
  if (state === "ai_filled") return { icon: "•", cls: "text-gate" };
  if (required) return { icon: "☐", cls: "text-gate" };
  return { icon: "○", cls: "text-ink-tertiary" };
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
}: {
  projectId: string;
  artifactId: string;
  status: ArtifactStatus;
  isHead: boolean;
  fields: EditorField[];
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
}) {
  const t = useTranslations("editor");
  const tWs = useTranslations("workspace");
  const tChain = useTranslations("chain");
  const tGates = useTranslations("gates");
  const [activeSource, setActiveSource] = useState<number | null>(null);
  const [editing, setEditing] = useState(editable && body.trim() === "");
  const sourceRefs = useRef<Map<number, HTMLLIElement>>(new Map());

  const [saveState, saveAction] = useActionState(
    saveArtifactBody.bind(null, projectId, artifactId),
    initialState,
  );

  const validIndices = new Set(sources.map((s) => s.index));
  // v2 források-panel fejléce: „N forrás · M citáció a draftban" — az érvényes
  // [n] jelölők száma a body-ban.
  const citationCount = (body.match(/\[(\d+)\]/g) ?? []).filter((m) =>
    validIndices.has(parseInt(m.slice(1, -1), 10)),
  ).length;

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
                ? "border-active bg-active/10 text-active"
                : "border-line bg-surface text-ink-secondary hover:border-active/50 hover:text-active"
            }`}
          >
            [{n}]
          </button>
        );
      }
      return <span key={i}>{part}</span>;
    });

  return (
    <div className="space-y-4">
      {/* ── Fejléc-folyam + akció-jelzők ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusFlow status={status} />
        <div className="flex items-center gap-2">
          <span className="font-mono text-mono-sm text-ink-tertiary">
            {t("historyLabel", { count: versions.length })}
          </span>
          {status === "approved" && (
            // v2 (locked spec): tömör lila elsődleges CTA.
            <a
              href={exportHref}
              className="rounded-control bg-action px-3.5 py-1.5 text-body font-semibold text-white shadow-action transition-colors duration-[var(--motion-base)] hover:bg-action-hover"
            >
              {t("exportPdf")}
            </a>
          )}
        </div>
      </div>

      {/* ── Blokkoló / állapot-sáv ── */}
      {status === "in_review" && missingRequiredLabels.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-tile border border-gate/40 bg-tint-gate px-4 py-2.5 text-body text-gate">
          <span className="font-medium">
            <span aria-hidden>◇</span>{" "}
            {t("blockedTitle", { count: missingRequiredLabels.length })}
          </span>
          {fields
            .filter((f) => f.required && !f.field.value)
            .map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => jumpToField(f.key)}
                className="underline decoration-dotted underline-offset-2 hover:text-ink"
              >
                {t("jumpTo", { field: f.label })} ↓
              </button>
            ))}
          <span className="ml-auto font-mono text-mono-sm">
            {tWs("completeness", { filled, required: requiredCount })}
          </span>
        </div>
      ) : status === "approved" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-tile border border-done/40 bg-tint-done px-4 py-2.5 text-body text-done">
          <span className="font-medium">
            <span aria-hidden>✓</span>{" "}
            {approvedDate ? t("approvedOn", { date: approvedDate }) : t("approvedTitle")}
          </span>
          {/* v2 (locked spec): tömör lila „a kapuhoz" CTA a jóváhagyott banneren. */}
          <Link
            href={phaseHref}
            className="rounded-control bg-action px-3.5 py-1.5 text-body font-semibold text-white shadow-action transition-colors duration-[var(--motion-base)] hover:bg-action-hover"
          >
            {t("goToGate")} →
          </Link>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-tile border border-line bg-surface px-4 py-2.5">
          <span className="font-mono text-mono-sm text-ink-secondary">
            {tWs("completeness", { filled, required: requiredCount })}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-pill bg-neutral-200">
            {/* Teljesség = információ → semleges kitöltés (törvény 3). */}
            <div
              className="h-full rounded-pill bg-ink-secondary"
              style={{
                width: `${requiredCount > 0 ? Math.round((filled / requiredCount) * 100) : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Nem-blokkoló emlékeztető (a redesign előtt a StatusChain mutatta):
          review alatt a kitöltött, de meg nem erősített (ai_filled) mezők —
          approve előtt érdemes megerősíteni. NEM blokkol (törvény 4: ikon+szöveg). */}
      {status === "in_review" && unconfirmedLabels.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-tile border border-gate/40 bg-surface px-4 py-2 text-body text-gate">
          <span className="font-medium">
            <span aria-hidden>•</span> {tChain("unconfirmedWarnTitle")}
          </span>
          <span className="text-ink-secondary">{unconfirmedLabels.join(", ")}</span>
        </div>
      )}

      {/* ── Három panel (v2: TÖMÖR lapok, nem üveg) ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_minmax(0,1fr)_340px]">
        {/* FIELD MAP */}
        <aside className="h-fit rounded-tile border border-line bg-neutral-50 p-3 lg:sticky lg:top-4">
          <h2 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
            {t("fieldMapTitle")} · {filled}/{requiredCount}
          </h2>
          <ul className="mt-2 space-y-0.5">
            {fields.map((f) => {
              const tone = fieldMapTone(f.field.state, f.required);
              const empty = f.required && !f.field.value;
              return (
                <li key={f.key}>
                  <button
                    type="button"
                    onClick={() => jumpToField(f.key)}
                    className={`flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-body hover:bg-neutral-100 ${
                      empty ? "bg-tint-gate" : ""
                    }`}
                  >
                    <span className={`shrink-0 font-mono ${tone.cls}`}>{tone.icon}</span>
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

        {/* DOCUMENT: mező-szekciók + body (v2: külön tömör lapok mezőnként) */}
        <div className="space-y-4">
          {fields.length > 0 && (
            <div className="space-y-3">
              {fields.map((f) => {
                // v2: az üres kötelező mező szaggatott borostyán dobozt kap —
                // de CSAK draftban (ott tölthető ki); read-only nézetben nem
                // sugallja tévesen a kitöltést (a mezőtérkép jelzi az ürességet).
                const emptyRequired = editable && f.required && !f.field.value;
                return (
                  <div
                    key={f.key}
                    id={`fld-${f.key}`}
                    className={
                      emptyRequired
                        ? "rounded-tile border-[1.5px] border-dashed border-gate/70 bg-tint-gate/50 p-1.5"
                        : "rounded-tile"
                    }
                  >
                    <FieldCard
                      projectId={projectId}
                      artifactId={artifactId}
                      fieldKey={f.key}
                      label={f.label}
                      required={f.required}
                      field={f.field}
                      editable={editable}
                    />
                  </div>
                );
              })}
            </div>
          )}

          <section className="rounded-tile border border-line bg-surface p-4 shadow-tile-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-body font-semibold">{t("bodyTitle")}</h2>
              {editable ? (
                <button
                  type="button"
                  onClick={() => setEditing((e) => !e)}
                  className="rounded-control border border-line bg-surface px-3 py-1.5 text-body font-medium shadow-tile-sm hover:bg-sunken"
                >
                  {editing ? t("viewCta") : t("editCta")}
                </button>
              ) : (
                <span className="text-mono-sm text-ink-tertiary">{t("readOnly")}</span>
              )}
            </div>

            {editing && editable ? (
              <form action={saveAction} className="mt-3 space-y-3">
                <textarea
                  key={saveState.nonce ?? 0}
                  name="body"
                  rows={18}
                  defaultValue={saveState.values?.body ?? body}
                  placeholder={t("bodyPlaceholder")}
                  className="w-full rounded-control border border-line bg-surface px-3 py-2 font-mono text-mono-sm"
                />
                {saveState.error && (
                  <p
                    role="alert"
                    className="rounded-tile border border-danger/40 bg-danger/10 px-3 py-2 text-body text-danger"
                  >
                    {saveState.error}
                  </p>
                )}
                {saveState.ok && <p className="text-body text-done">{t("saved")}</p>}
                <SubmitButton variant="secondary" pendingLabel={t("saving")}>
                  {t("saveCta")}
                </SubmitButton>
              </form>
            ) : body.trim() === "" ? (
              <p className="mt-3 text-body text-ink-tertiary">{t("noBody")}</p>
            ) : (
              <div className="mt-3">
                <p className="mb-2 text-mono-sm text-ink-tertiary">{t("citationHint")}</p>
                <div
                  className={`whitespace-pre-wrap text-body ${!editable ? "card-sunken p-3" : ""}`}
                >
                  {renderBodyWithCitations(body)}
                </div>
              </div>
            )}
          </section>

          {/* Státusz-lánc AKCIÓK (footer) — a lánc nem átugorható (E1) */}
          <StatusChain
            projectId={projectId}
            artifactId={artifactId}
            status={status}
            isHead={isHead}
            missingRequiredLabels={missingRequiredLabels}
            unconfirmedLabels={unconfirmedLabels}
            hideWarnings
          />
        </div>

        {/* SOURCES / VERSIONS (v2: tömör lap, precíz fejléc) */}
        <aside className="h-fit rounded-tile border border-line bg-neutral-50 p-4 lg:sticky lg:top-4">
          {status === "approved" ? (
            <>
              <h2 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
                {t("versionsTitle")} · {versions.length}
              </h2>
              <ul className="mt-3 space-y-1.5">
                {versions.map((v) => (
                  <li key={v.id}>
                    <Link
                      href={`/project/${projectId}/artifact/${v.id}`}
                      className={`flex items-center justify-between gap-2 rounded-tile border px-3 py-2 text-body transition-colors duration-[var(--motion-base)] ${
                        v.current
                          ? "border-done/50 bg-tint-done"
                          : "border-line bg-surface hover:bg-sunken"
                      }`}
                    >
                      <span className="min-w-0">
                        <span
                          className={`font-mono text-mono-sm ${
                            v.current ? "font-bold text-done" : "text-ink-secondary"
                          }`}
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
              <p className="mt-3 text-mono-sm leading-snug text-ink-tertiary">
                {t("compareVersions")}
              </p>
            </>
          ) : (
            <>
              <h2 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
                {t("sourcesCountLabel", { sources: sources.length, citations: citationCount })}
              </h2>
              {sources.length === 0 ? (
                <p className="mt-2 text-body text-ink-tertiary">{t("noSources")}</p>
              ) : (
                <ul className="mt-3 space-y-2.5">
                  {sources.map((source) => {
                    const cited = activeSource === source.index;
                    return (
                      <li
                        key={source.index}
                        ref={(el) => {
                          if (el) sourceRefs.current.set(source.index, el);
                          else sourceRefs.current.delete(source.index);
                        }}
                        className={`rounded-tile bg-surface p-3 transition-shadow duration-[var(--motion-base)] ${
                          cited ? "border-[1.5px] border-pivot shadow-tile-sm" : "border border-line"
                        }`}
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
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

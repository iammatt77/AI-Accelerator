"use client";

import { useRef, useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { FormState } from "@/app/actions";
import { saveArtifactBody } from "@/app/artifact-actions";
import type { FieldState } from "@/lib/artifacts/config";
import { FieldStateBadge } from "@/components/FieldStateBadge";
import { SubmitButton } from "@/components/SubmitButton";

// ─────────────────────────────────────────────────────────────
// Artefaktum-szerkesztő (design 1f, split-view):
//   bal = mező-panel (összecsukható, állapot ikon+szöveggel, teljesség-pill)
//         + body (draft: szerkeszthető md; egyébként olvasó nézet)
//   jobb = számozott források; a body [n] jelölői kattinthatók →
//          a forrás kiemelése + odagörgetés.
// A mező-MŰVELETEK (megerősít/szerkeszt/elvet) a ② zónában élnek (E1);
// itt a mezők olvasó nézete látszik.
// ─────────────────────────────────────────────────────────────

const initialState: FormState = { ok: false, error: null };

export interface EditorField {
  key: string;
  label: string;
  required: boolean;
  value: string | null;
  state: FieldState;
  sourceIndices: number[];
}

export interface EditorSource {
  index: number;
  title: string;
  text: string;
}

export function ArtifactEditor({
  projectId,
  artifactId,
  fields,
  filled,
  requiredCount,
  body,
  editable,
  sources,
}: {
  projectId: string;
  artifactId: string;
  fields: EditorField[];
  filled: number;
  requiredCount: number;
  body: string;
  editable: boolean;
  sources: EditorSource[];
}) {
  const t = useTranslations("editor");
  const tWs = useTranslations("workspace");
  const [activeSource, setActiveSource] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [editing, setEditing] = useState(editable && body.trim() === "");
  const sourceRefs = useRef<Map<number, HTMLLIElement>>(new Map());

  const [saveState, saveAction] = useActionState(
    saveArtifactBody.bind(null, projectId, artifactId),
    initialState,
  );

  const jumpToSource = (n: number) => {
    setActiveSource(n);
    sourceRefs.current.get(n)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const validIndices = new Set(sources.map((s) => s.index));

  /** A body szövege [n] jelölőnként darabolva; az érvényes jelölők
   *  kattintható gombok (a forrás kiemelése — design 1f). */
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
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ── BAL: mező-panel + body ── */}
      <div className="space-y-4">
        {/* Mező-panel (összecsukható) */}
        <section className="glass-tile p-4">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setPanelOpen((open) => !open)}
              aria-expanded={panelOpen}
              className="flex items-center gap-2 text-body font-semibold hover:text-ink-secondary"
            >
              <span
                aria-hidden
                className={`inline-block font-mono text-mono-sm text-ink-tertiary transition-transform duration-[var(--motion-base)] ${panelOpen ? "rotate-90" : ""}`}
              >
                ▸
              </span>
              {t("fieldPanelTitle")}
            </button>
            {/* Teljesség-pill: „x/y kötelező kitöltve" */}
            <span className="rounded-pill border border-line bg-surface px-2 py-0.5 font-mono text-mono-sm text-ink-secondary">
              {tWs("completeness", { filled, required: requiredCount })}
            </span>
          </div>
          {panelOpen && (
            <ul className="mt-3 space-y-2">
              {fields.map((field) => (
                <li
                  key={field.key}
                  className="rounded-tile border border-line bg-surface px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-mono-sm font-medium text-ink-secondary">
                      {field.label}
                      <span className="ml-1.5 font-normal text-ink-tertiary">
                        {field.required ? tWs("requiredMark") : tWs("optionalMark")}
                      </span>
                    </span>
                    <FieldStateBadge
                      state={field.state}
                      label={tWs(`fieldState.${field.state}`)}
                    />
                  </div>
                  {field.value ? (
                    <p className="mt-1 text-body">
                      {field.value}
                      {field.sourceIndices.length > 0 && (
                        <span className="ml-1.5 inline-flex gap-1">
                          {field.sourceIndices
                            .filter((n) => validIndices.has(n))
                            .map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => jumpToSource(n)}
                                className="rounded-pill border border-line bg-surface px-1.5 font-mono text-mono-sm text-ink-secondary hover:border-active/50 hover:text-active"
                              >
                                [{n}]
                              </button>
                            ))}
                        </span>
                      )}
                    </p>
                  ) : (
                    <p className="mt-1 text-body text-ink-tertiary">{tWs("noValue")}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Body: draft → szerkeszthető; egyébként olvasó (immutábilis) */}
        <section className="glass-tile p-4">
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
      </div>

      {/* ── JOBB: számozott források ── */}
      <section className="glass-tile p-4">
        <h2 className="text-body font-semibold">{t("sourcesTitle")}</h2>
        {sources.length === 0 ? (
          <p className="mt-2 text-body text-ink-tertiary">{t("noSources")}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {sources.map((source) => (
              <li
                key={source.index}
                ref={(el) => {
                  if (el) sourceRefs.current.set(source.index, el);
                  else sourceRefs.current.delete(source.index);
                }}
                className={`card-sunken p-3 transition-shadow duration-[var(--motion-base)] ${
                  activeSource === source.index
                    ? "ring-2 ring-active"
                    : ""
                }`}
              >
                <div className="mb-1 flex items-center gap-2 text-mono-sm text-ink-tertiary">
                  <span className="rounded-pill border border-line bg-surface px-1.5 font-mono">
                    [{source.index}]
                  </span>
                  {source.title}
                </div>
                <pre className="whitespace-pre-wrap font-sans text-body">
                  {source.text}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

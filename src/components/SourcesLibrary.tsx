"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  parseTranscript,
  type SourceKind,
  type SourceRow,
} from "@/lib/sources/references";
import { newSourceVersionAction } from "@/app/staleness-actions";
import { bulkSetSourceMetaAction, setSourceMetaAction } from "@/app/source-meta-actions";
import { ORG_LEVELS, SOURCE_KINDS } from "@/lib/sources/meta";
import type { FormState } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";

// ─────────────────────────────────────────────────────────────
// Forrástár — mester–részlet (ref_forrastar.html). Bal: kereshető/szűrhető
// tömör lista; jobb: a kiválasztott forrás olvasó-nézete (metaadat, „HOL
// hivatkozva" chipek, teljes tartalom formázva). Tömör-lapos, 0 blur; a
// tartalom nem vész el, csak a helyén, olvasva jelenik meg. Minden adat a
// meglévő input_items-ből + a szerver fordított aggregációjából jön.
// ─────────────────────────────────────────────────────────────

type Filter = { type: "all" } | { type: "phase"; value: string } | { type: "kind"; value: SourceKind };

function KindIcon({ kind, size = 16 }: { kind: SourceKind; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
  } as const;
  switch (kind) {
    case "transcript":
      return (
        <svg {...common}>
          <path d="M2.5 3.5h11v7h-6l-3 2.5V10.5h-2z" />
        </svg>
      );
    case "list":
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="1.8" />
          <path d="M2 12c0-1.8 1.3-3 3-3s3 1.2 3 3" />
          <path d="M10 5h4M10 8h4M10 11h3" />
        </svg>
      );
    case "data":
      return (
        <svg {...common}>
          <path d="M3 13V7M6.5 13V4M10 13V9M13.5 13V6" />
        </svg>
      );
    case "note":
      return (
        <svg {...common}>
          <path d="M4 3.5h8M4 6.5h8M4 9.5h6M4 12.5h5" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M4 2.5h5l3 3v8H4z" />
          <path d="M9 2.5v3h3" />
        </svg>
      );
  }
}

function kindBox(kind: SourceKind): string {
  if (kind === "transcript") return "bg-tint-pivot text-pivot";
  if (kind === "list") return "bg-tint-action text-action-deep";
  return "bg-neutral-150 text-ink-tertiary";
}

function initialsColor(i: number): string {
  const palette = [
    "bg-tint-action text-action-deep",
    "bg-tint-pivot text-pivot",
    "bg-tint-done text-done-text",
    "bg-tint-gate text-gate-text",
  ];
  return palette[i % palette.length];
}

export function SourcesLibrary({
  projectId,
  projectName,
  rows,
}: {
  projectId: string;
  projectName: string;
  rows: SourceRow[];
}) {
  const t = useTranslations("sourcesPage");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>({ type: "all" });
  const [selectedId, setSelectedId] = useState<string>(rows[0]?.id ?? "");
  const [rawView, setRawView] = useState(false);
  const [copied, setCopied] = useState(false);

  // Szűrő-pillek: fázisok + jelenlévő kategóriák, valós számlálókkal.
  const phases = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) if (r.phase) counts.set(r.phase, (counts.get(r.phase) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);
  const kinds = useMemo(() => {
    const counts = new Map<SourceKind, number>();
    for (const r of rows) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
    return [...counts.entries()].sort(([, a], [, b]) => b - a);
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter.type === "phase" && r.phase !== filter.value) return false;
      if (filter.type === "kind" && r.kind !== filter.value) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.content.toLowerCase().includes(q) ||
        r.preview.toLowerCase().includes(q)
      );
    });
  }, [rows, query, filter]);

  const selected = rows.find((r) => r.id === selectedId) ?? filtered[0] ?? null;

  const isActive = (f: Filter) =>
    f.type === filter.type &&
    (f.type === "all" ||
      (f.type === "phase" && filter.type === "phase" && f.value === filter.value) ||
      (f.type === "kind" && filter.type === "kind" && f.value === filter.value));

  const pill = (f: Filter, label: string, count: number) => (
    <button
      key={`${f.type}-${"value" in f ? f.value : "all"}`}
      type="button"
      onClick={() => setFilter(f)}
      className={`rounded-pill px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors ${
        isActive(f)
          ? "bg-action text-white"
          : "border border-line bg-surface text-ink-secondary hover:bg-soft"
      }`}
    >
      {label} {count}
    </button>
  );

  function selectRow(id: string) {
    setSelectedId(id);
    setRawView(false);
    setCopied(false);
  }

  function copyCitation(index: number) {
    const marker = `[${index}]`;
    void navigator.clipboard?.writeText(marker).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      },
      () => {},
    );
  }

  const missingMeta = rows.filter((r) => !r.sourceKind || !r.orgLevel);

  return (
    <div className="space-y-3">
      {/* 4.2b-a (F1/F2): a metaadat-hiány LÁTHATÓ + kötegben pótolható —
          a pótlás csak a HIÁNYZÓ mezőket tölti, a megadottat nem írja felül. */}
      {missingMeta.length > 0 && (
        <BulkMetaBanner projectId={projectId} missingCount={missingMeta.length} />
      )}
      <div className="flex h-[calc(100vh-7rem)] min-h-[600px] overflow-hidden rounded-shell border border-line bg-surface shadow-card">
      {/* ── Bal: forráslista ── */}
      <div className="flex w-[336px] shrink-0 flex-col border-r border-line bg-soft">
        <div className="border-b border-line px-4 pb-3 pt-4">
          <div className="flex items-baseline gap-2">
            <span className="text-[17px] font-extrabold tracking-tight">{t("title")}</span>
            <span className="font-mono text-mono-sm text-ink-tertiary">
              {rows.length} · {projectName}
            </span>
          </div>
          {/* kereső */}
          <div className="mt-3 flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-2">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 text-ink-tertiary">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5 L14 14" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-ink-tertiary"
            />
          </div>
          {/* szűrők */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {pill({ type: "all" }, t("filterAll"), rows.length)}
            {phases.map(([p, n]) => pill({ type: "phase", value: p }, p, n))}
            {kinds.map(([k, n]) => pill({ type: "kind", value: k }, t(`kind.${k}`), n))}
          </div>
        </div>

        {/* sorok */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-body text-ink-tertiary">{t("noMatch")}</p>
          ) : (
            filtered.map((r) => {
              const active = selected?.id === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => selectRow(r.id)}
                  className={`flex gap-3 border-b border-line-soft px-4 py-3 text-left transition-colors ${
                    active ? "bg-tint-action/60 border-l-[3px] border-l-action" : "hover:bg-soft"
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-4 ${kindBox(r.kind)}`}
                  >
                    <KindIcon kind={r.kind} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] font-bold text-pivot">[{r.index}]</span>
                      <span className="truncate text-[13.5px] font-bold">{r.title}</span>
                      {r.version > 1 && (
                        <span className="shrink-0 rounded-3 bg-tint-done px-1.5 py-px font-mono text-[9px] font-bold text-done-text">
                          v{r.version}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-ink-tertiary">
                      {r.preview}
                    </span>
                    <span className="mt-1.5 flex items-center gap-1.5">
                      {r.phase && (
                        <span className="rounded-3 bg-neutral-150 px-1.5 py-px font-mono text-[9px] font-bold text-ink-secondary">
                          {r.phase}
                        </span>
                      )}
                      {r.fileBadge && (
                        <span className="rounded-3 bg-tint-pivot px-1.5 py-px font-mono text-[9px] font-bold text-pivot">
                          {r.fileBadge}
                        </span>
                      )}
                      {/* 4.2b-a (F1): a hiányzó forrás-metaadat LÁTHATÓ */}
                      {(!r.sourceKind || !r.orgLevel) && (
                        <span className="rounded-3 border border-tint-gate-border bg-tint-gate px-1.5 py-px font-mono text-[9px] font-bold text-gate-text">
                          {t("metaMissingBadge")}
                        </span>
                      )}
                      <span className="font-mono text-[10px] text-ink-tertiary">{r.dateLabel}</span>
                      {r.refCount > 0 && (
                        <span className="font-mono text-[10px] text-ink-tertiary">
                          · {t("refCountShort", { n: r.refCount })}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })
          )}
          <div className="flex-1" />
          <p className="border-t border-line-soft px-4 py-3 text-[11.5px] leading-relaxed text-ink-tertiary">
            {t("addHint")}
          </p>
        </div>
      </div>

      {/* ── Jobb: olvasó ── */}
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-body text-ink-tertiary">
            {t("readerEmpty")}
          </div>
        ) : (
          <ReaderPane
            projectId={projectId}
            row={selected}
            rawView={rawView}
            onToggleRaw={() => setRawView((v) => !v)}
            copied={copied}
            onCopy={() => copyCitation(selected.index)}
          />
        )}
      </div>
      </div>
    </div>
  );
}

function ReaderPane({
  projectId,
  row,
  rawView,
  onToggleRaw,
  copied,
  onCopy,
}: {
  projectId: string;
  row: SourceRow;
  rawView: boolean;
  onToggleRaw: () => void;
  copied: boolean;
  onCopy: () => void;
}) {
  const t = useTranslations("sourcesPage");
  const turns = useMemo(() => (rawView ? null : parseTranscript(row.content)), [row.content, rawView]);

  return (
    <>
      {/* fejléc */}
      <div className="border-b border-line px-8 pb-4 pt-5">
        <div className="flex items-start gap-3.5">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-5 ${kindBox(row.kind)}`}
          >
            <KindIcon kind={row.kind} size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-bold text-pivot">[{row.index}]</span>
              <span className="truncate text-[19px] font-extrabold tracking-tight">{row.title}</span>
              {/* A8: verzió-chip — a kanonikus [n] a csoporté, a chip a
                  megjelenített (legfrissebb) verziót mutatja. */}
              <span className="shrink-0 rounded-4 bg-tint-done px-2 py-0.5 font-mono text-[10.5px] font-bold text-done-text">
                v{row.version}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className={`rounded-4 px-2 py-0.5 font-mono text-[10.5px] font-bold ${kindBox(row.kind)}`}>
                {t(`kind.${row.kind}`).toUpperCase()}
              </span>
              {row.phase && (
                <span className="rounded-4 bg-neutral-150 px-2 py-0.5 font-mono text-[10.5px] font-bold text-ink-secondary">
                  {row.phase}
                </span>
              )}
              <span className="font-mono text-[11px] text-ink-tertiary">
                {t("uploadedOn", { date: row.dateLabel })}
              </span>
              <span className="font-mono text-[11px] text-ink-tertiary">
                · {t("wordCount", { n: row.wordCount })}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onToggleRaw}
              className="rounded-control border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-soft"
            >
              {rawView ? t("viewFormatted") : t("viewRaw")}
            </button>
            <button
              type="button"
              onClick={onCopy}
              className="rounded-control bg-action px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-action-hover"
            >
              {copied ? t("citationCopied") : t("insertCitation")}
            </button>
          </div>
        </div>

        {/* HIVATKOZVA */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-ink-tertiary">
            {t("referencedBy")}
          </span>
          {row.references.length === 0 ? (
            <span className="text-[11.5px] text-ink-tertiary">{t("noReferences")}</span>
          ) : (
            row.references.map((ref) => (
              <Link
                key={ref.key}
                href={ref.href}
                className="inline-flex items-center gap-1.5 rounded-pill border border-line-soft bg-tint-action px-2.5 py-0.5 text-[11.5px] font-semibold text-action-deep hover:bg-tint-action/70"
              >
                {ref.kind === "stakeholder" && <span aria-hidden>◆</span>}
                {ref.label}
              </Link>
            ))
          )}
        </div>

        {/* 4.2b-a: forrás-metaadat (típus + szervezeti szint) — a feltöltő
            tudása, itt pótolható/javítható; a csoport MINDEN verziójára él. */}
        {/* key: CSAK a csoport — forrás-váltásra remountol (friss defaultok),
            de a mentés utáni revalidate nem nyeli el a visszajelzést. */}
        <SourceMetaEditor key={row.groupId} projectId={projectId} row={row} />
      </div>

      {/* törzs */}
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-[760px]">
          {turns ? (
            <div className="flex flex-col gap-4">
              {turns.map((turn, i) => (
                <div key={i}>
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex h-[22px] w-[22px] items-center justify-center rounded-pill font-mono text-[9px] font-extrabold ${initialsColor(i)}`}
                    >
                      {turn.initials}
                    </span>
                    <span className="text-[13px] font-bold">{turn.speaker}</span>
                  </div>
                  <p className="mt-1.5 pl-[30px] text-[13.5px] leading-[1.65] text-ink-secondary">
                    {turn.body}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-[13.5px] leading-[1.7] text-ink-secondary">
              {row.content}
            </pre>
          )}

          {/* ── A8: korábbi verziók (a régi sorok megmaradnak — a [n] a
              csoporté, a citációk élnek) ── */}
          {row.history.length > 0 && (
            <div className="mt-6 border-t border-line pt-4">
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-ink-tertiary">
                {t("historyTitle")} · {row.history.length}
              </div>
              <div className="mt-2 flex flex-col gap-1.5">
                {row.history.map((v) => (
                  <details
                    key={v.id}
                    className="rounded-tile border border-line-soft bg-soft px-3 py-2"
                  >
                    <summary className="flex cursor-pointer list-none items-center gap-2 text-[12px]">
                      <span className="font-mono text-[10.5px] font-bold text-ink-secondary">
                        v{v.version}
                      </span>
                      <span className="font-mono text-[10.5px] text-ink-tertiary">
                        {v.dateLabel}
                      </span>
                      <span className="ml-auto text-[10.5px] text-ink-tertiary">
                        {t("historyOpenHint")}
                      </span>
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap border-t border-line-soft pt-2 font-sans text-[12.5px] leading-[1.6] text-ink-secondary">
                      {v.content}
                    </pre>
                  </details>
                ))}
              </div>
            </div>
          )}

          {/* ── A8: új verzió — a frissítés ÚJ sor a csoportban, a régi
              megmarad; a kanonikus [n] nem mozdul ── */}
          <NewVersionForm key={row.groupId} projectId={projectId} groupId={row.groupId} />
        </div>
      </div>
    </>
  );
}

const initialFormState: FormState = { ok: false, error: null };

// ── 4.2b-a: forrás-metaadat szerkesztő (olvasó-fejléc) ────────
// A hiány LÁTHATÓ (amber keret + „nincs megadva”); a mentés a verzió-
// csoport minden sorára ír (setSourceMetaAction).

function SourceMetaEditor({ projectId, row }: { projectId: string; row: SourceRow }) {
  const t = useTranslations("sourcesPage");
  const tMeta = useTranslations("sourceMeta");
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<FormState>(initialFormState);
  const [kind, setKind] = useState(row.sourceKind ?? "");
  const [level, setLevel] = useState(row.orgLevel ?? "");
  const missing = !row.sourceKind || !row.orgLevel;
  const dirty = kind !== (row.sourceKind ?? "") || level !== (row.orgLevel ?? "");

  const save = () => {
    if (pending) return;
    startTransition(async () => {
      setState(await setSourceMetaAction(projectId, row.groupId, kind, level));
    });
  };

  const sel = "rounded-control border border-line bg-surface px-2 py-1 text-[12px]";
  return (
    <div
      className={`mt-3 flex flex-wrap items-center gap-2 rounded-tile border px-3 py-2 ${
        missing ? "border-tint-gate-border bg-tint-gate" : "border-line-soft bg-soft"
      }`}
    >
      <span
        className={`font-mono text-[10px] font-bold uppercase tracking-[0.08em] ${
          missing ? "text-gate-text" : "text-ink-tertiary"
        }`}
      >
        {missing ? t("metaMissingLabel") : t("metaLabel")}
      </span>
      <label className="flex items-center gap-1.5 text-[11.5px] text-ink-secondary">
        {tMeta("kindLabel")}
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={sel}>
          <option value="">{tMeta("notGiven")}</option>
          {SOURCE_KINDS.map((k) => (
            <option key={k} value={k}>
              {tMeta(`kind.${k}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-[11.5px] text-ink-secondary">
        {tMeta("levelLabel")}
        <select value={level} onChange={(e) => setLevel(e.target.value)} className={sel}>
          <option value="">{tMeta("notGiven")}</option>
          {ORG_LEVELS.map((l) => (
            <option key={l} value={l}>
              {tMeta(`level.${l}`)}
            </option>
          ))}
        </select>
      </label>
      {dirty && (
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="rounded-control bg-action px-3 py-1 text-[12px] font-semibold text-white hover:bg-action-hover disabled:opacity-50"
        >
          {pending ? t("metaSaving") : t("metaSaveCta")}
        </button>
      )}
      {state.error && (
        <span role="alert" className="text-[11.5px] text-danger">
          {state.error}
        </span>
      )}
      {state.ok && state.notice && <span className="text-[11.5px] text-done">{state.notice}</span>}
    </div>
  );
}

// ── 4.2b-a (F2): kötegelt pótlás-sáv — „ne egyesével, ha sok van” ──

function BulkMetaBanner({ projectId, missingCount }: { projectId: string; missingCount: number }) {
  const t = useTranslations("sourcesPage");
  const tMeta = useTranslations("sourceMeta");
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<FormState>(initialFormState);
  const [kind, setKind] = useState("");
  const [level, setLevel] = useState("");

  const apply = () => {
    if (pending || (!kind && !level)) return;
    startTransition(async () => {
      setState(await bulkSetSourceMetaAction(projectId, kind, level));
    });
  };

  const sel = "rounded-control border border-line bg-surface px-2 py-1.5 text-[12px]";
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-tile border border-tint-gate-border bg-tint-gate px-4 py-2.5">
      <span className="text-[12.5px] font-semibold text-gate-text">
        {t("metaBannerText", { n: missingCount })}
      </span>
      <select value={kind} onChange={(e) => setKind(e.target.value)} className={sel}>
        <option value="">{tMeta("kindLabel")}: —</option>
        {SOURCE_KINDS.map((k) => (
          <option key={k} value={k}>
            {tMeta(`kind.${k}`)}
          </option>
        ))}
      </select>
      <select value={level} onChange={(e) => setLevel(e.target.value)} className={sel}>
        <option value="">{tMeta("levelLabel")}: —</option>
        {ORG_LEVELS.map((l) => (
          <option key={l} value={l}>
            {tMeta(`level.${l}`)}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={pending || (!kind && !level)}
        onClick={apply}
        className="rounded-control bg-action px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-action-hover disabled:opacity-50"
      >
        {pending ? t("metaSaving") : t("metaBulkCta")}
      </button>
      <span className="text-[11.5px] text-ink-tertiary">{t("metaBulkHint")}</span>
      {state.error && (
        <span role="alert" className="text-[11.5px] text-danger">
          {state.error}
        </span>
      )}
      {state.ok && state.notice && <span className="text-[11.5px] text-done">{state.notice}</span>}
    </div>
  );
}

function NewVersionForm({ projectId, groupId }: { projectId: string; groupId: string }) {
  const t = useTranslations("sourcesPage");
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(
    newSourceVersionAction.bind(null, projectId, groupId),
    initialFormState,
  );

  return (
    <div className="mt-6 border-t border-line pt-4">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-control border border-neutral-350 bg-surface px-3 py-1.5 text-[12px] font-semibold hover:bg-neutral-50"
        >
          {t("newVersionCta")}
        </button>
      ) : (
        <form action={formAction} className="space-y-2">
          <p className="text-[12px] font-semibold">{t("newVersionTitle")}</p>
          <textarea
            key={state.nonce ?? 0}
            name="rawText"
            required
            rows={6}
            defaultValue={state.values?.rawText ?? ""}
            placeholder={t("newVersionPlaceholder")}
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-ink-tertiary"
          />
          {state.error && (
            <p role="alert" className="text-mono-sm text-danger">
              {state.error}
            </p>
          )}
          {state.ok && <p className="text-body text-done">{t("newVersionDone")}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton variant="secondary" pendingLabel={t("newVersionSaving")}>
              {t("newVersionSave")}
            </SubmitButton>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-control px-3 py-1.5 text-body text-ink-secondary hover:bg-sunken"
            >
              {t("newVersionCancel")}
            </button>
          </div>
          <p className="text-mono-sm text-ink-tertiary">{t("newVersionHint")}</p>
        </form>
      )}
    </div>
  );
}

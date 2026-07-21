import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import {
  completeness,
  getTypeDef,
  missingRequiredFields,
  parseArtifactFields,
  typesForPhase,
  typesForPhaseAll,
  type ArtifactTypeDef,
} from "@/lib/artifacts/config";
import { loadPhaseBoard } from "@/lib/phases/service";
import { PHASE_IDS, type PhaseId } from "@/lib/phases/config";
import {
  RepoSections,
  type RepoPhaseSection,
  type RepoRow,
  type RowStatus,
} from "@/components/RepoSections";
import type { ArtifactRow, ClientRow, ProjectRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

// Document Repository (Master 4/1a+1b) — dokumentum-státusz dashboard:
// készültségi fejléc (sáv + kaput-blokkoló csempe NÉV SZERINTI hiányzó
// mezőkkel + export-csempe) → szűrő-chipek → fázis-szekciók (dot-strip
// ujjlenyomat; az aktív fázis kinyitva, a blokkoló dokumentum dátumozott
// verziótörténettel). Minden meglévő adat/akció; a „bundle-export (PDF)"
// új képesség lenne → az egyetlen-dokumentum md-exportra kötünk (FLAG).

interface ProjectWithClient extends ProjectRow {
  clients: ClientRow | null;
}

export default async function DocumentsHubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createServiceSupabaseClient();

  const [{ data: projectData }, { data: artifactData }, board] = await Promise.all([
    supabase.from("projects").select("*, clients ( * )").eq("id", id).maybeSingle(),
    supabase
      .from("artifacts")
      .select("*")
      .eq("project_id", id)
      .order("version", { ascending: false }),
    loadPhaseBoard(supabase, id),
  ]);
  if (!projectData) notFound();
  const project = projectData as ProjectWithClient;
  const artifacts = (artifactData ?? []) as ArtifactRow[];

  const [locale, t, tPhases, tTypes, tFields, tArtifacts] = await Promise.all([
    getLocale(),
    getTranslations("hub"),
    getTranslations("phases"),
    getTranslations("artifactTypes"),
    getTranslations("fields"),
    getTranslations("artifacts"),
  ]);
  const dateLocale = locale === "hu" ? "hu-HU" : "en-GB";
  const tz = { timeZone: "Europe/Budapest" } as const;
  const shortDate = (iso: string) =>
    new Date(iso).toLocaleDateString(dateLocale, { ...tz, month: "short", day: "numeric" });
  const typeName = (typeDef: ArtifactTypeDef) =>
    tTypes(typeDef.nameKey.replace(/^artifactTypes\./, ""));
  const fieldLabel = (labelKey: string) => tFields(labelKey.replace(/^fields\./, ""));

  const byType = new Map<string, ArtifactRow[]>();
  for (const a of artifacts) {
    const list = byType.get(a.type) ?? [];
    list.push(a);
    byType.set(a.type, list);
  }

  const byPhase = new Map(board.map((e) => [e.phase, e]));
  const activePhase =
    PHASE_IDS.find((p) => {
      const s = byPhase.get(p)?.state;
      return s === "in_progress" || s === "gate_pending";
    }) ??
    PHASE_IDS.find((p) => byPhase.get(p)?.state === "open") ??
    "P0";

  // A kaput blokkoló típusok: az AKTÍV fázis nem teljesülő, typeKey-s kritériumai.
  const blockingTypes = new Set(
    (byPhase.get(activePhase)?.criteria ?? [])
      .filter((c) => !c.satisfied && c.typeKey)
      .map((c) => c.typeKey as string),
  );

  // ── Szekciók + globális számlálók összeállítása ──
  let cApproved = 0;
  let cReview = 0;
  let cDraft = 0;
  let cPlanned = 0;
  let cAttention = 0;
  let blockingRow: { name: string; missing: string[]; headId: string; statusLabel: string } | null =
    null;

  const sections: RepoPhaseSection[] = PHASE_IDS.map((phase) => {
    const entry = byPhase.get(phase);
    const stateRaw = entry?.state;
    const state: RepoPhaseSection["state"] =
      stateRaw === "completed"
        ? "closed"
        : stateRaw === "in_progress" || stateRaw === "gate_pending"
          ? "active"
          : stateRaw === "open"
            ? "open"
            : "locked";
    // Csomag A (A6): a kivezetett (retired) típus a tárban CSAK akkor
    // jelenik meg, ha van meglévő artifact-sora — az adat olvasható marad,
    // de üres „tervezett" sorként nem hirdetjük.
    const configured = typesForPhaseAll(phase).filter(
      (td) => !td.retired || (byType.get(td.key) ?? []).length > 0,
    );

    const rows: RepoRow[] = configured.map((td) => {
      const versions = byType.get(td.key) ?? [];
      const head = versions[0] ?? null;
      const status: RowStatus = head ? (head.status as RowStatus) : "planned";
      const parsed = head ? parseArtifactFields(td, head.fields) : null;
      const done = parsed ? completeness(td, parsed) : { filled: 0, required: td.fields.filter((f) => f.required).length };
      const missing = parsed
        ? missingRequiredFields(td, parsed).map((f) => fieldLabel(f.labelKey))
        : [];
      const blocksGate = blockingTypes.has(td.key) && status !== "approved";

      if (status === "approved") cApproved += 1;
      else if (status === "in_review") cReview += 1;
      else if (status === "draft") cDraft += 1;
      else cPlanned += 1;
      if (blocksGate || missing.length > 0) cAttention += 1;
      if (blocksGate && head && !blockingRow) {
        blockingRow = {
          name: typeName(td),
          missing,
          headId: head.id,
          statusLabel: tArtifacts(`status.${head.status}`),
        };
      }

      const metaLabel = head
        ? `v${head.version} · ${shortDate(head.updated_at ?? head.created_at)} · ${done.filled}/${done.required} ${t("requiredFieldsShort")}`
        : blocksGate
          ? t("notStartedBlocks")
          : t("notStartedOptional");

      return {
        key: td.key,
        name: typeName(td),
        status,
        statusLabel: head ? tArtifacts(`status.${head.status}`) : "",
        metaLabel,
        filled: done.filled,
        required: done.required,
        missingNames: missing,
        blocksGate,
        optionalForGate: !blockingTypes.has(td.key),
        headId: head?.id ?? null,
        versions: versions.map((v) => ({
          id: v.id,
          version: v.version,
          dateLabel: shortDate(v.updated_at ?? v.created_at),
          statusLabel: tArtifacts(`status.${v.status}`),
          current: v.id === head?.id,
        })),
      } satisfies RepoRow;
    });

    return {
      phase,
      name: tPhases(`${phase.toLowerCase()}.short`),
      state,
      approved: rows.filter((r) => r.status === "approved").length,
      total: rows.length,
      dots: rows.map((r) => r.status),
      rows,
    } satisfies RepoPhaseSection;
  }).filter((s) => s.total > 0);

  const totalConfigured = cApproved + cReview + cDraft + cPlanned;
  const latestApproved = artifacts
    .filter((a) => a.status === "approved")
    .sort((a, b) => +new Date(b.updated_at ?? b.created_at) - +new Date(a.updated_at ?? a.created_at))[0];

  // ── Üres állapot (Master 4/1b): a deliverable-térkép előnézete ──
  if (artifacts.length === 0) {
    const p0Types = typesForPhase("P0");
    const restCount = totalConfigured - p0Types.length;
    return (
      <div className="space-y-4">
        <PageHeader project={project} title={t("title")} />
        <div className="flex flex-col items-center gap-2.5 rounded-shell border-[1.5px] border-dashed border-action-light bg-context p-7 text-center">
          <span
            aria-hidden
            className="flex h-10 w-10 items-center justify-center rounded-tile bg-accent-fill text-[18px] text-action"
          >
            ≡
          </span>
          <h2 className="text-[15px] font-bold">{t("emptyTitle")}</h2>
          <p className="max-w-[420px] text-[12.5px] leading-relaxed text-ink-secondary">
            {t("emptyBody")} <b className="text-ink">{t("emptyBodyStrong")}</b>
          </p>
          <Link
            href={`/project/${id}/phase/P0`}
            className="mt-1 rounded-control bg-action px-4 py-2 text-[12.5px] font-semibold text-white shadow-action hover:bg-action-hover"
          >
            {t("emptyCta")}
          </Link>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 rounded-tile border border-line bg-surface px-4 py-[11px]">
            <span className="font-mono text-[11px] font-semibold text-action-deep">P0</span>
            <span className="text-[13px] font-semibold">{tPhases("p0.short")}</span>
            <span className="hidden text-[11.5px] text-ink-tertiary sm:inline">
              {p0Types.map((td) => typeName(td)).join(" · ")}
            </span>
            <span className="ml-auto flex gap-[3px]" aria-hidden>
              {p0Types.map((td) => (
                <span
                  key={td.key}
                  className="h-2.5 w-2.5 rounded-[2px] border border-dashed border-neutral-400"
                />
              ))}
            </span>
            <span className="font-mono text-[11px] text-ink-tertiary">0/{p0Types.length}</span>
          </div>
          <div className="flex items-center gap-3 rounded-tile border border-neutral-200 bg-neutral-100 px-4 py-[11px] text-ink-tertiary">
            <span className="font-mono text-[11px]">P1–P6</span>
            <span className="text-[13px] font-semibold">
              {t("emptyRest", { n: Math.max(0, restCount) })}
            </span>
            <span className="inline-flex items-center gap-1 text-[11.5px]">
              {t("unlockPhaseByPhase")}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      <PageHeader project={project} title={t("title")} />

      {/* Készültségi fejléc — a sáv a domináns elem (P2) */}
      <div className="grid grid-cols-1 gap-3.5 border-b border-line-soft py-4 lg:grid-cols-[1.5fr_1fr_1fr]">
        <div className="rounded-shell border border-line bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink-tertiary">
              {t("readinessTitle")}
            </span>
            <span className="font-mono text-[15px] font-bold">
              {cApproved}
              <span className="text-[12px] text-ink-tertiary"> / {totalConfigured} {t("approvedWord")}</span>
            </span>
          </div>
          <div className="mt-3 flex h-3 overflow-hidden rounded-3 bg-neutral-100">
            <span className="bg-done" style={{ width: `${(cApproved / Math.max(1, totalConfigured)) * 100}%` }} />
            <span className="bg-gate" style={{ width: `${(cReview / Math.max(1, totalConfigured)) * 100}%` }} />
            <span className="bg-neutral-400" style={{ width: `${(cDraft / Math.max(1, totalConfigured)) * 100}%` }} />
          </div>
          <div className="mt-2.5 flex flex-wrap gap-4 text-[11.5px] text-ink-secondary">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-[2px] bg-done" />
              {cApproved} {t("legendApproved")}
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-[2px] bg-gate" />
              {cReview} {t("legendReview")}
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-[2px] bg-neutral-400" />
              {cDraft} {t("legendDraft")}
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-[2px] border border-dashed border-neutral-400" />
              {cPlanned} {t("legendPlanned")}
            </span>
          </div>
        </div>

        {/* A kaput blokkoló csempe — NÉV SZERINTI hiányzó mezőkkel (P5, P4) */}
        <div className="rounded-shell border border-tint-gate-border bg-surface p-4 shadow-card-sm">
          <div className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-gate-text">
            <span aria-hidden>◇</span>
            {t("blockingTitle")}
          </div>
          {blockingRow ? (
            <>
              <div className="mt-2.5 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                  {(blockingRow as { name: string }).name}
                </span>
                <span className="rounded-pill bg-tint-gate px-2 py-px text-[10.5px] font-semibold text-gate-text">
                  {(blockingRow as { statusLabel: string }).statusLabel}
                </span>
              </div>
              {(blockingRow as { missing: string[] }).missing.length > 0 && (
                <p className="mt-[5px] text-[11.5px] font-semibold text-gate-text">
                  {t("blockingFields", {
                    n: (blockingRow as { missing: string[] }).missing.length,
                    fields: (blockingRow as { missing: string[] }).missing.join(" · "),
                  })}
                </p>
              )}
              <Link
                href={`/project/${id}/artifact/${(blockingRow as { headId: string }).headId}`}
                className="mt-2.5 block rounded-control bg-action px-3 py-[7px] text-center text-[12px] font-semibold text-white shadow-action hover:bg-action-hover"
              >
                {t("reviewNow")}
              </Link>
            </>
          ) : (
            <p className="mt-2.5 text-[12.5px] text-ink-tertiary">{t("nothingBlocks")}</p>
          )}
        </div>

        {/* Export-csempe (bundle-export = új képesség → md-exportra kötve) */}
        <div className="rounded-shell border border-line bg-surface p-4 shadow-card-sm">
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink-tertiary">
            {t("exportTitle")}
          </div>
          <div className="mt-2.5 text-[13px] font-semibold">
            {t("exportCount", { n: cApproved })}
          </div>
          <p className="mt-[5px] truncate text-[11.5px] text-ink-tertiary">
            {latestApproved
              ? t("exportLatest", {
                  name: (() => {
                    // getTypeDef a retired típust is feloldja (A6).
                    const td = getTypeDef(latestApproved.type);
                    return td ? typeName(td) : latestApproved.type;
                  })(),
                  v: latestApproved.version,
                  date: shortDate(latestApproved.updated_at ?? latestApproved.created_at),
                })
              : "—"}
          </p>
          {latestApproved ? (
            <a
              href={`/project/${id}/artifact/${latestApproved.id}/export`}
              className="mt-2.5 block rounded-control border border-neutral-350 bg-surface px-3 py-[7px] text-center text-[12px] font-semibold text-ink hover:bg-neutral-50"
            >
              {t("exportCtaMd")}
            </a>
          ) : (
            <span className="mt-2.5 block rounded-control bg-neutral-100 px-3 py-[7px] text-center text-[12px] font-semibold text-ink-tertiary">
              {t("exportNone")}
            </span>
          )}
        </div>
      </div>

      <RepoSections
        projectId={id}
        sections={sections}
        counts={{
          all: totalConfigured,
          attention: cAttention,
          inReview: cReview,
          approved: cApproved,
        }}
      />
    </div>
  );
}

function PageHeader({ project, title }: { project: ProjectWithClient; title: string }) {
  return (
    <div className="border-b border-line-soft pb-4">
      <div className="font-mono text-[11px] text-ink-tertiary">
        {project.clients?.name ?? ""} / {project.name}
      </div>
      <h1 className="mt-0.5 text-[19px] font-bold tracking-tight">{title}</h1>
    </div>
  );
}

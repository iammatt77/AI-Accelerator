import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { countCompleted, loadPhaseBoard } from "@/lib/phases/service";
import { PHASE_IDS, type PhaseId } from "@/lib/phases/config";
import { completeness, getTypeDef, parseArtifactFields, typesForPhase } from "@/lib/artifacts/config";
import { criterionLabel } from "@/lib/phases/criterion-label";
import { StatusPill } from "@/components/StatusPill";
import { FieldStateBadge } from "@/components/FieldStateBadge";
import { IconCheck, IconLock } from "@/components/icons";
import type {
  ArtifactRow,
  ClientRow,
  DecisionRow,
  InputItemRow,
  PainPointRow,
  ProjectRow,
  StakeholderRow,
  UseCaseRow,
} from "@/lib/db/types";

export const dynamic = "force-dynamic";

// Project Cockpit (Master 2/1a): P7 állapot-sor → hero spine (7 tömör
// csempe, aktív lila gyűrűvel + fázison belüli progress + kapu-pontszám) →
// next-best-step kártya mini-úttal → value-dominant statok → artefaktumok;
// jobbra: gate-kártya (a letiltott gomb HORDOZZA az indoklását, P5) +
// dátumozott aktivitás + ügyfél-kártya. Minden adat meglévő forrásból.

interface ProjectWithClient extends ProjectRow {
  clients: ClientRow | null;
}

export default async function ProjectCockpitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createServiceSupabaseClient();

  const { data: projectData } = await supabase
    .from("projects")
    .select("*, clients ( * )")
    .eq("id", id)
    .maybeSingle();
  if (!projectData) notFound();
  const project = projectData as ProjectWithClient;

  const [board, artRes, inRes, ppRes, ucRes, decRes, skRes] = await Promise.all([
    loadPhaseBoard(supabase, id),
    supabase
      .from("artifacts")
      .select("*")
      .eq("project_id", id)
      .order("updated_at", { ascending: false }),
    supabase.from("input_items").select("id, type, created_at").eq("project_id", id),
    supabase.from("pain_points").select("id, state").eq("project_id", id),
    supabase.from("use_cases").select("id, state, list_status").eq("project_id", id),
    supabase
      .from("decisions")
      .select("*")
      .eq("project_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("stakeholders")
      .select("id, name, title, state")
      .eq("project_id", id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);
  const artifacts = (artRes.data ?? []) as ArtifactRow[];
  const inputs = (inRes.data ?? []) as Pick<InputItemRow, "id" | "type" | "created_at">[];
  const pains = (ppRes.data ?? []) as Pick<PainPointRow, "id" | "state">[];
  const ucs = (ucRes.data ?? []) as Pick<UseCaseRow, "id" | "state" | "list_status">[];
  const decisions = (decRes.data ?? []) as DecisionRow[];
  const stakeholders = (skRes.data ?? []) as Pick<
    StakeholderRow,
    "id" | "name" | "title" | "state"
  >[];
  const stakeholdersVisible = stakeholders.filter((s) => s.state !== "rejected");

  const [locale, t, tClients, tArtifacts, tTypes, tPhases, tCriteria, tEmpty, tSt, tEnt] =
    await Promise.all([
      getLocale(),
      getTranslations("cockpit"),
      getTranslations("clients"),
      getTranslations("artifacts"),
      getTranslations("artifactTypes"),
      getTranslations("phases"),
      getTranslations("criteria"),
      getTranslations("empty"),
      getTranslations("stakeholders"),
      getTranslations("entities"),
    ]);
  const dateLocale = locale === "hu" ? "hu-HU" : "en-GB";
  const tz = { timeZone: "Europe/Budapest" } as const;
  const typeName = (type: string) => {
    const def = getTypeDef(type);
    return def ? tTypes(def.nameKey.replace(/^artifactTypes\./, "")) : type;
  };
  const phaseShort = (p: PhaseId) => tPhases(`${p.toLowerCase()}.short`);
  const shortDate = (iso: string) =>
    new Date(iso).toLocaleDateString(dateLocale, { ...tz, month: "short", day: "numeric" });

  const byPhase = new Map(board.map((e) => [e.phase, e]));
  const active =
    board.find((e) => e.state === "in_progress" || e.state === "gate_pending") ??
    board.find((e) => e.state === "open") ??
    null;
  const activePhase = active?.phase ?? "P0";
  const completed = countCompleted(board);
  const week = Math.max(
    1,
    Math.floor((Date.now() - new Date(project.created_at).getTime()) / (7 * 24 * 3600 * 1000)) + 1,
  );

  const unmet = active?.criteria.filter((c) => !c.satisfied) ?? [];
  const met = active?.criteria.filter((c) => c.satisfied) ?? [];
  const gateScore = active ? `${met.length}/${active.criteria.length}` : "";
  const firstUnmetLabel = unmet[0] ? criterionLabel(unmet[0], tCriteria, tTypes) : "";
  const nextUnlock = PHASE_IDS[Math.min(PHASE_IDS.indexOf(activePhase) + 1, 6)];

  // Statok (value-dominant): fájdalompont / shortlist / riport-mezők
  const painConfirmed = pains.filter((p) => p.state === "confirmed" || p.state === "manual").length;
  const painTotal = pains.filter((p) => p.state !== "rejected").length;
  const ucConfirmed = ucs.filter((u) => u.state === "confirmed" || u.state === "manual");
  const ucShortlisted = ucConfirmed.filter(
    (u) => u.list_status === "shortlist" || u.list_status === "selected",
  ).length;
  let fieldsFilled = 0;
  let fieldsRequired = 0;
  for (const td of typesForPhase(activePhase)) {
    const latest = artifacts.find((a) => a.type === td.key);
    if (!latest) continue;
    const c = completeness(td, parseArtifactFields(td, latest.fields));
    fieldsFilled += c.filled;
    fieldsRequired += c.required;
  }

  // Aktivitás (dátumozott, meglévő eseményekből): kapu-döntések +
  // artefaktum-frissítések + utolsó nyersanyag.
  const activity: { date: string; text: string }[] = [];
  for (const d of decisions.slice(0, 2)) {
    activity.push({
      date: shortDate(d.created_at),
      text: t("activityGateClosed", { phase: d.kind }),
    });
  }
  for (const a of artifacts.slice(0, 2)) {
    activity.push({
      date: shortDate(a.updated_at ?? a.created_at),
      text: t("activityArtifact", { name: typeName(a.type), v: a.version }),
    });
  }
  const lastInput = inputs
    .slice()
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0];
  if (lastInput) {
    activity.push({ date: shortDate(lastInput.created_at), text: t("activityInput") });
  }
  const activityRows = activity.slice(0, 3);

  const charter = artifacts.find(
    (a) => getTypeDef(a.type)?.phase === "P0" && a.status === "approved",
  );

  const spineTone = (p: PhaseId) => {
    const s = byPhase.get(p)?.state;
    if (s === "completed") return "done" as const;
    if (s === "in_progress" || s === "gate_pending" || s === "open") {
      return p === activePhase ? ("active" as const) : ("idle" as const);
    }
    return "locked" as const;
  };

  return (
    <div className="space-y-0">
      {/* Fejléc */}
      <div className="flex flex-wrap items-center gap-4 border-b border-line-soft pb-4">
        <div className="min-w-0">
          <nav className="flex items-center gap-1.5 font-mono text-[11px]">
            {project.clients ? (
              <Link
                href={`/clients/${project.clients.id}`}
                className="text-ink-tertiary hover:text-ink-secondary hover:underline"
              >
                {project.clients.name}
              </Link>
            ) : (
              <span className="text-ink-tertiary">{tClients("unknown")}</span>
            )}
            <span className="text-neutral-400">/</span>
            <span className="font-semibold text-action">{project.package ?? project.name}</span>
          </nav>
          <h1 className="mt-0.5 truncate text-[20px] font-bold tracking-tight">{project.name}</h1>
        </div>
        <span className="ml-auto shrink-0 rounded-control border border-line bg-sunken px-2.5 py-[7px] font-mono text-[11px] font-semibold text-ink-secondary">
          {t("weekStarted", {
            week,
            date: new Date(project.created_at).toLocaleDateString(dateLocale, tz),
          })}
        </span>
      </div>

      {/* P7: állapot-összefoglaló sor */}
      {active && (
        <div className="border-b border-line-soft bg-context px-1 py-3">
          <p className="text-[14px] leading-snug text-ink">
            <b>
              {t("summaryLine", {
                phase: activePhase,
                name: phaseShort(activePhase),
                done: met.length,
                total: active.criteria.length,
              })}
            </b>{" "}
            {unmet.length === 1 && (
              <span className="text-ink-secondary">
                {t("summaryOneStep", { next: nextUnlock, criterion: firstUnmetLabel })}
              </span>
            )}
          </p>
        </div>
      )}

      {/* Hero spine — 7 tömör csempe nyíl-összekötőkkel */}
      <div className="border-b border-line-soft py-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink-tertiary">
            {t("spineTitle")}
          </span>
          <span className="font-mono text-[11px] text-ink-secondary">
            {t("spineClosed", { n: completed })}
          </span>
        </div>
        <div className="flex items-stretch">
          {PHASE_IDS.map((p, i) => {
            const tone = spineTone(p);
            const entry = byPhase.get(p);
            const isActive = tone === "active";
            const progress =
              isActive && active && active.criteria.length > 0
                ? Math.round((met.length / active.criteria.length) * 100)
                : 0;
            return (
              <div key={p} className="flex min-w-0 flex-1 items-stretch" style={isActive ? { flexGrow: 1.5 } : undefined}>
                {i > 0 && (
                  <span
                    aria-hidden
                    className={`flex items-center px-[3px] ${tone === "done" || isActive ? "text-action" : "text-neutral-300"}`}
                  >
                    ›
                  </span>
                )}
                <Link
                  href={tone === "locked" ? "#" : `/project/${id}/phase/${p}`}
                  aria-disabled={tone === "locked"}
                  title={tone === "locked" ? tPhases("lockedTooltip") : undefined}
                  className={`relative min-w-0 flex-1 overflow-hidden rounded-control border p-[12px_13px] ${
                    isActive
                      ? "border-[1.5px] border-action bg-accent-tint shadow-accent"
                      : tone === "done"
                        ? "border-line bg-surface"
                        : tone === "idle"
                          ? "border-line bg-surface"
                          : "pointer-events-none border-neutral-200 bg-neutral-100"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`absolute inset-x-0 top-0 h-[3px] ${
                      tone === "done" ? "bg-done" : isActive ? "bg-action" : "bg-neutral-300"
                    }`}
                  />
                  <div className="mt-[3px] flex items-center gap-1.5">
                    <span
                      className={`font-mono text-[10.5px] ${isActive ? "font-semibold text-accent-deeptext" : tone === "locked" ? "text-neutral-450" : "text-ink-tertiary"}`}
                    >
                      {p}
                    </span>
                    {isActive && (
                      <span className="rounded-3 bg-action px-1.5 py-px font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-white">
                        {t("activeBadge")}
                      </span>
                    )}
                    {isActive && active && active.criteria.length > 0 && (
                      <span className="ml-auto font-mono text-[10px] text-action-deep">
                        {t("gateShort", { score: gateScore })}
                      </span>
                    )}
                  </div>
                  <div
                    className={`my-[3px] truncate text-[12.5px] font-semibold ${tone === "locked" ? "text-ink-tertiary" : isActive ? "text-[13.5px] font-bold" : ""}`}
                  >
                    {phaseShort(p)}
                  </div>
                  {isActive ? (
                    <>
                      <div className="mb-1.5 flex h-[5px] overflow-hidden rounded-[2px] bg-accent-box-border">
                        <span className="bg-action" style={{ width: `${progress}%` }} />
                      </div>
                      {unmet[0] && (
                        <div className="truncate text-[11px] font-semibold text-accent-deeptext">
                          {firstUnmetLabel}
                        </div>
                      )}
                    </>
                  ) : tone === "done" ? (
                    <div className="flex items-center gap-1 text-[11px] font-semibold text-done-text">
                      <IconCheck size={10} />
                      {t("closedShort")}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-[11px] text-ink-tertiary">
                      <IconLock size={10} />
                      {tone === "idle" ? tPhases("state.open") : tPhases("state.locked")}
                    </div>
                  )}
                </Link>
              </div>
            );
          })}
        </div>
      </div>

      {/* Törzs */}
      <div className="grid grid-cols-1 gap-5 pt-5 lg:grid-cols-[1.55fr_1fr]">
        <div className="flex flex-col gap-4">
          {/* Next best step (accent-kártya, mini-úttal) */}
          {active && (
            <section className="rounded-shell border-[1.5px] border-action bg-accent-tint p-5 shadow-accent">
              <div className="mb-2.5 flex items-center gap-2">
                <span
                  aria-hidden
                  className="flex h-6 w-6 items-center justify-center rounded-tile bg-action text-white"
                >
                  →
                </span>
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-action-deep">
                  {t("nextBest")}
                </span>
              </div>
              <h2 className="text-[19px] font-bold leading-tight tracking-tight">
                {unmet[0] ? firstUnmetLabel : t("gateReadyTitle", { phase: activePhase })}
              </h2>
              {active.criteria.length > 0 && (
                <div className="mt-3.5 flex flex-wrap items-center">
                  {active.criteria.map((c, i) => (
                    <div key={c.id} className="flex items-center">
                      {i > 0 && <span aria-hidden className="h-px w-3.5 bg-neutral-400" />}
                      <span
                        className={`flex items-center gap-1.5 rounded-control border px-[11px] py-[7px] text-[11.5px] ${
                          c.satisfied
                            ? "border-line bg-surface text-ink-secondary"
                            : "border-[1.5px] border-gate bg-tint-gate font-bold text-gate-text"
                        }`}
                      >
                        {c.satisfied ? (
                          <IconCheck size={10} className="text-done-text" />
                        ) : (
                          <span
                            aria-hidden
                            className="h-[9px] w-[9px] rounded-[2px] border-[1.5px] border-gate"
                          />
                        )}
                        {criterionLabel(c, tCriteria, tTypes)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3.5">
                <Link
                  href={`/project/${id}/phase/${activePhase}`}
                  className="inline-flex items-center gap-1.5 rounded-control bg-action px-4 py-2 text-[13px] font-semibold text-white shadow-action hover:bg-action-hover"
                >
                  {t("openWorkspace", { phase: activePhase })} →
                </Link>
              </div>
            </section>
          )}

          {/* Statok — az érték dominál (P2) */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile
              value={`${painConfirmed}`}
              suffix={`/ ${painTotal}`}
              label={t("statPainConfirmed")}
              pct={painTotal > 0 ? (painConfirmed / painTotal) * 100 : 0}
              tone="done"
            />
            <StatTile
              value={`${ucShortlisted}`}
              suffix={t("ofN", { n: ucConfirmed.length })}
              label={t("statShortlisted")}
              pct={ucConfirmed.length > 0 ? (ucShortlisted / Math.max(ucConfirmed.length, 3)) * 100 : 0}
              tone="pivot"
            />
            <StatTile
              value={`${fieldsFilled}`}
              suffix={`/ ${fieldsRequired}`}
              label={t("statReportFields")}
              pct={fieldsRequired > 0 ? (fieldsFilled / fieldsRequired) * 100 : 0}
              tone="gate"
            />
          </div>

          {/* Artefaktumok */}
          <section className="overflow-hidden rounded-shell border border-line bg-surface shadow-card">
            <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
              <h2 className="text-[13px] font-semibold">{t("recentArtifacts")}</h2>
              <Link
                href={`/project/${id}/documents`}
                className="font-mono text-[11px] text-action hover:underline"
              >
                {t("documentsLink")} →
              </Link>
            </div>
            {artifacts.length === 0 ? (
              <p className="px-4 py-3 text-body text-ink-tertiary">{tEmpty("noArtifact")}</p>
            ) : (
              artifacts.slice(0, 3).map((a, i) => (
                <Link
                  key={a.id}
                  href={`/project/${id}/artifact/${a.id}`}
                  className={`flex items-center gap-3 px-4 py-[11px] hover:bg-neutral-50 ${
                    i > 0 ? "border-t border-line-row" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">
                      {typeName(a.type)}
                    </span>
                    <span className="block font-mono text-[11px] text-ink-tertiary">
                      {getTypeDef(a.type)?.phase ?? ""} · v{a.version} ·{" "}
                      {shortDate(a.updated_at ?? a.created_at)}
                    </span>
                  </span>
                  <StatusPill variant={a.status} label={tArtifacts(`status.${a.status}`)} />
                </Link>
              ))
            )}
          </section>
        </div>

        <div className="flex flex-col gap-4">
          {/* Gate-kártya — a gomb hordozza az indoklását (P5) */}
          {active && active.criteria.length > 0 && (
            <section className="overflow-hidden rounded-shell border border-tint-gate-border bg-surface shadow-card">
              <div className="flex items-center gap-2 border-b border-tint-gate-border bg-tint-gate px-4 py-3">
                <span aria-hidden className="text-gate-text">
                  ◇
                </span>
                <h2 className="text-[13px] font-bold">
                  {t("gateCardTitle", { phase: activePhase })}
                </h2>
                <span className="ml-auto font-mono text-[11px] font-semibold text-gate-text">
                  {gateScore}
                </span>
              </div>
              <div className="flex flex-col gap-2.5 p-4">
                {active.criteria.map((c) =>
                  c.satisfied ? (
                    <div key={c.id} className="flex items-center gap-2.5">
                      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-control bg-done text-white">
                        <IconCheck size={10} />
                      </span>
                      <span className="text-[12.5px] text-ink-secondary">
                        {criterionLabel(c, tCriteria, tTypes)}
                      </span>
                    </div>
                  ) : (
                    <div
                      key={c.id}
                      className="flex items-center gap-2.5 rounded-control border border-tint-gate-border bg-tint-gate-band px-2.5 py-2"
                    >
                      <span
                        aria-hidden
                        className="h-[18px] w-[18px] shrink-0 rounded-control border-[1.5px] border-gate"
                      />
                      <span className="min-w-0 flex-1 text-[12.5px] font-bold text-gate-text">
                        {criterionLabel(c, tCriteria, tTypes)}
                      </span>
                      <span className="shrink-0 font-mono text-[10.5px] font-semibold text-gate-text">
                        {t("gateOpenTag")}
                      </span>
                    </div>
                  ),
                )}
              </div>
              <div className="px-4 pb-3.5">
                {unmet.length > 0 ? (
                  <div className="flex items-center justify-center gap-1.5 rounded-control bg-neutral-100 px-3 py-2 text-center text-[12px] font-semibold leading-tight text-ink-tertiary">
                    <IconLock size={12} className="shrink-0" />
                    {t("gateCloseBlocked", { criterion: firstUnmetLabel })}
                  </div>
                ) : (
                  <Link
                    href={`/project/${id}/phase/${activePhase}`}
                    className="flex items-center justify-center rounded-control bg-action px-3 py-2 text-[12px] font-semibold text-white shadow-action hover:bg-action-hover"
                  >
                    {t("gateCloseReady")} →
                  </Link>
                )}
              </div>
            </section>
          )}

          {/* Stakeholderek (#8) — kattintásra a dedikált nézet */}
          <section className="overflow-hidden rounded-shell border border-line bg-surface shadow-card">
            <div className="border-b border-neutral-100 px-4 py-3">
              <h2 className="text-[13px] font-semibold">{tSt("cockpitTitle")}</h2>
              <p className="mt-0.5 font-mono text-[11px] text-ink-tertiary">{tSt("cockpitLead")}</p>
            </div>
            {stakeholdersVisible.length === 0 ? (
              <p className="px-4 py-3 text-body text-ink-tertiary">{tSt("cockpitEmpty")}</p>
            ) : (
              stakeholdersVisible.map((s, i) => (
                <Link
                  key={s.id}
                  href={`/project/${id}/stakeholder/${s.id}`}
                  className={`flex items-center gap-2.5 px-4 py-[11px] hover:bg-neutral-50 ${
                    i > 0 ? "border-t border-line-row" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{s.name}</span>
                    <span className="block truncate font-mono text-[11px] text-ink-tertiary">
                      {s.title ?? tSt("noTitle")}
                    </span>
                  </span>
                  <FieldStateBadge
                    state={
                      s.state === "ai_suggested"
                        ? "ai_filled"
                        : s.state === "confirmed"
                          ? "confirmed"
                          : "manual"
                    }
                    label={tEnt(`state.${s.state}`)}
                  />
                  <span aria-hidden className="shrink-0 text-ink-tertiary">
                    ›
                  </span>
                </Link>
              ))
            )}
          </section>

          {/* Dátumozott aktivitás */}
          <section className="rounded-shell border border-line bg-surface p-4 shadow-card">
            <h2 className="mb-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink-tertiary">
              {t("thisWeek")}
            </h2>
            {activityRows.length === 0 ? (
              <p className="text-body text-ink-tertiary">{t("noActivity")}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {activityRows.map((row, i) => (
                  <div key={i} className="flex gap-2.5 text-[12px] text-ink-secondary">
                    <span className="w-[52px] shrink-0 font-mono text-[10px] text-ink-tertiary">
                      {row.date}
                    </span>
                    <span className="min-w-0">{row.text}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Ügyfél-kártya (öröklött kontextus — süllyesztett) */}
          <section className="flex flex-col gap-2 rounded-shell border border-line bg-sunken p-4">
            <MetaRow label={t("metaClient")}>
              {project.clients?.name ?? tClients("unknown")}
            </MetaRow>
            <MetaRow label={t("metaIndustry")}>{project.clients?.industry ?? "—"}</MetaRow>
            <MetaRow label={t("metaCharter")}>
              {charter ? (
                <Link
                  href={`/project/${id}/artifact/${charter.id}`}
                  className="font-semibold text-action-deep hover:underline"
                >
                  P0 · {tArtifacts("status.approved")} ↗
                </Link>
              ) : (
                "—"
              )}
            </MetaRow>
          </section>
        </div>
      </div>
    </div>
  );
}

function StatTile({
  value,
  suffix,
  label,
  pct,
  tone,
}: {
  value: string;
  suffix: string;
  label: string;
  pct: number;
  tone: "done" | "pivot" | "gate";
}) {
  const valueCls =
    tone === "done" ? "text-done-text" : tone === "pivot" ? "text-pivot" : "text-gate-text";
  const barCls = tone === "done" ? "bg-done" : tone === "pivot" ? "bg-pivot" : "bg-gate";
  return (
    <div
      className={`rounded-tile border bg-surface p-3.5 shadow-card-sm ${
        tone === "gate" ? "border-tint-gate-border" : "border-line"
      }`}
    >
      <div className="flex items-baseline gap-1.5">
        <span className={`font-mono text-[26px] font-bold leading-none ${valueCls}`}>{value}</span>
        <span className="font-mono text-[12px] text-ink-tertiary">{suffix}</span>
      </div>
      <div
        className={`mt-[3px] text-[11px] ${tone === "gate" ? "font-semibold text-gate-text" : "text-ink-tertiary"}`}
      >
        {label}
      </div>
      <div className="mt-2 flex h-1 overflow-hidden rounded-[2px] bg-neutral-100">
        <span className={barCls} style={{ width: `${Math.min(100, Math.round(pct))}%` }} />
      </div>
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-[12px]">
      <span className="text-ink-tertiary">{label}</span>
      <span className="text-right font-semibold">{children}</span>
    </div>
  );
}

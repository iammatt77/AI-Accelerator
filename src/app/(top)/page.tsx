import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { loadPhaseBoard } from "@/lib/phases/service";
import { PHASE_IDS } from "@/lib/phases/config";
import { criterionLabel } from "@/lib/phases/criterion-label";
import {
  DashboardBoard,
  type DashCardData,
  type DashSummary,
} from "@/components/DashboardBoard";
import type {
  ArtifactRow,
  ClientRow,
  DecisionRow,
  InputItemRow,
  PainPointRow,
  ProjectRow,
  UseCaseRow,
} from "@/lib/db/types";

export const dynamic = "force-dynamic";

// Portfolio Dashboard (Master 1) — a napi belépőpont: „mi vár rám ma?"
// Fejléc (dátum + köszöntés + ⌘K kereső [vizuális] + Új projekt) →
// állapot-összefoglaló sáv (P7) → 4 triage-csempe → projekt-kártyák.
// Minden szám a MEGLÉVŐ adatokból számolt; nincs új akció/adatmodell.

interface ProjectWithClient extends ProjectRow {
  clients: Pick<ClientRow, "name" | "industry"> | null;
}

const STALLED_DAYS = 7;

export default async function DashboardPage() {
  const supabase = createServiceSupabaseClient();
  const [locale, t, tCriteria, tTypes, tErrors] = await Promise.all([
    getLocale(),
    getTranslations("dashboard"),
    getTranslations("criteria"),
    getTranslations("artifactTypes"),
    getTranslations("errors"),
  ]);
  const dateLocale = locale === "hu" ? "hu-HU" : "en-GB";
  const tz = { timeZone: "Europe/Budapest" } as const;

  const { data, error } = await supabase
    .from("projects")
    .select("*, clients ( name, industry )")
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(tErrors("projectsFetchFailed", { message: error.message }));
  }
  const projects = (data ?? []) as ProjectWithClient[];

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

  let sumConfirmations = 0;
  let sumReviews = 0;
  let movedArtifacts = 0;
  let movedGates = 0;
  const gateList: string[] = [];
  const stalledList: string[] = [];
  const needDetails: string[] = [];

  const rawCards = await Promise.all(
    projects.map(async (project) => {
      const [board, artRes, inRes, ppRes, ucRes, decRes] = await Promise.all([
        loadPhaseBoard(supabase, project.id),
        supabase
          .from("artifacts")
          .select("id, status, updated_at, created_at")
          .eq("project_id", project.id),
        supabase.from("input_items").select("id, created_at").eq("project_id", project.id),
        supabase.from("pain_points").select("id, state, created_at").eq("project_id", project.id),
        supabase
          .from("use_cases")
          .select("id, state, updated_at, created_at")
          .eq("project_id", project.id),
        supabase.from("decisions").select("id, created_at").eq("project_id", project.id),
      ]);
      const artifacts = (artRes.data ?? []) as Pick<
        ArtifactRow,
        "id" | "status" | "updated_at" | "created_at"
      >[];
      const inputs = (inRes.data ?? []) as Pick<InputItemRow, "id" | "created_at">[];
      const pains = (ppRes.data ?? []) as Pick<PainPointRow, "id" | "state" | "created_at">[];
      const ucs = (ucRes.data ?? []) as Pick<
        UseCaseRow,
        "id" | "state" | "updated_at" | "created_at"
      >[];
      const decisions = (decRes.data ?? []) as Pick<DecisionRow, "id" | "created_at">[];

      const byPhase = new Map(board.map((e) => [e.phase, e]));
      const activeEntry =
        board.find((e) => e.state === "in_progress" || e.state === "gate_pending") ??
        board.find((e) => e.state === "open") ??
        null;

      // Utolsó érintés = a projekt bármely elemének legutóbbi időbélyege.
      const stamps = [
        project.created_at,
        ...artifacts.map((a) => a.updated_at ?? a.created_at),
        ...inputs.map((i) => i.created_at),
        ...pains.map((p) => p.created_at),
        ...ucs.map((u) => u.updated_at ?? u.created_at),
        ...decisions.map((d) => d.created_at),
      ].filter(Boolean);
      const lastTouch = new Date(
        Math.max(...stamps.map((s) => new Date(s).getTime())),
      );
      const idleDays = Math.floor((now.getTime() - lastTouch.getTime()) / (24 * 3600 * 1000));

      const confirmations =
        pains.filter((p) => p.state === "ai_suggested").length +
        ucs.filter((u) => u.state === "ai_suggested").length;
      const reviews = artifacts.filter((a) => a.status === "in_review").length;

      const gateReady = Boolean(activeEntry?.gateReady) && (activeEntry?.criteria.length ?? 0) > 0;
      const movedHere =
        artifacts.some((a) => new Date(a.updated_at ?? a.created_at) >= weekAgo) ||
        decisions.some((d) => new Date(d.created_at) >= weekAgo);
      movedArtifacts += artifacts.filter(
        (a) => new Date(a.updated_at ?? a.created_at) >= weekAgo,
      ).length;
      movedGates += decisions.filter((d) => new Date(d.created_at) >= weekAgo).length;

      const status: DashCardData["status"] =
        idleDays >= STALLED_DAYS
          ? "stalled"
          : confirmations + reviews > 0
            ? "needs_you"
            : gateReady || activeEntry?.state === "gate_pending"
              ? "gate"
              : "healthy";

      sumConfirmations += confirmations;
      sumReviews += reviews;
      if (gateReady && activeEntry) gateList.push(`${activeEntry.phase} ${project.name}`);
      if (status === "stalled") stalledList.push(project.name);
      if (confirmations > 0)
        needDetails.push(t("detailConfirmations", { n: confirmations, name: project.name }));
      if (reviews > 0) needDetails.push(t("detailReviews", { n: reviews, name: project.name }));
      if (gateReady) needDetails.push(t("detailGateReady", { name: project.name }));

      // Mini-spine tónusok
      const spine = PHASE_IDS.map((p) => {
        const s = byPhase.get(p)?.state;
        return {
          phase: p,
          tone:
            s === "completed"
              ? ("done" as const)
              : s === "in_progress"
                ? ("active" as const)
                : s === "gate_pending"
                  ? ("gate" as const)
                  : ("idle" as const),
        };
      });

      // Blokkoló lépés a kártyán (P5)
      const unmet = activeEntry?.criteria.filter((c) => !c.satisfied) ?? [];
      const gateScore = activeEntry
        ? `${activeEntry.criteria.length - unmet.length}/${activeEntry.criteria.length}`
        : "";
      let blockLabel: string;
      let blockText: string;
      let blockTone: DashCardData["blockTone"];
      if (status === "stalled") {
        blockLabel = t("blockStalled");
        blockText = t("blockStalledText", { days: idleDays });
        blockTone = "muted";
      } else if (gateReady && activeEntry) {
        blockLabel = t("blockGateReady", { score: gateScore });
        blockText = t("blockGateReadyText", { phase: activeEntry.phase });
        blockTone = "gateReady";
      } else if (activeEntry && unmet.length > 0) {
        blockLabel = t("blockGateOpen", { score: gateScore, n: unmet.length });
        blockText = criterionLabel(unmet[0], tCriteria, tTypes);
        blockTone = "accent";
      } else {
        blockLabel = t("blockHealthy");
        blockText = t("blockHealthyText");
        blockTone = "muted";
      }

      const weeks = Math.max(
        1,
        Math.ceil(
          (now.getTime() - new Date(project.created_at).getTime()) / (7 * 24 * 3600 * 1000),
        ),
      );
      const sameDay = lastTouch.toDateString() === now.toDateString();
      const lastTouchLabel =
        status === "stalled"
          ? t("idleLabel", {
              days: idleDays,
              date: lastTouch.toLocaleDateString(dateLocale, {
                ...tz,
                month: "short",
                day: "numeric",
              }),
            })
          : sameDay
            ? t("lastTouchToday", {
                time: lastTouch.toLocaleTimeString(dateLocale, {
                  ...tz,
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              })
            : t("lastTouch", {
                date: lastTouch.toLocaleDateString(dateLocale, {
                  ...tz,
                  month: "short",
                  day: "numeric",
                }),
              });

      const initials = (project.clients?.name ?? project.name)
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

      return {
        id: project.id,
        name: project.name,
        clientName: project.clients?.name ?? "",
        industry: project.clients?.industry ?? "",
        initials,
        spine,
        weekLabel: t("weekLabel", { phase: activeEntry?.phase ?? "P0", week: weeks }),
        lastTouchLabel,
        movedThisWeek: movedHere,
        status,
        blockLabel,
        blockText,
        blockTone,
      } satisfies DashCardData;
    }),
  );

  // Sorrend fixen (Master §02): rád-vár → kapu → elakadt → egészséges.
  const order: Record<DashCardData["status"], number> = {
    needs_you: 0,
    gate: 1,
    stalled: 2,
    healthy: 3,
  };
  const cards = rawCards.sort((a, b) => order[a.status] - order[b.status]);

  const needsYouTotal = sumConfirmations + sumReviews;
  const summary: DashSummary = {
    needsYou: needsYouTotal,
    needsYouSub:
      needsYouTotal > 0
        ? t("tileNeedsSub", { c: sumConfirmations, r: sumReviews })
        : t("tileNothing"),
    gates: gateList.length,
    gatesSub: gateList.length > 0 ? gateList.join(" · ") : t("tileNothing"),
    stalled: stalledList.length,
    stalledSub: stalledList.length > 0 ? stalledList.join(" · ") : t("tileNothing"),
    moved: movedArtifacts + movedGates,
    movedSub: t("tileMovedSub", { a: movedArtifacts, g: movedGates }),
  };

  const hour = parseInt(
    now.toLocaleTimeString("en-GB", { ...tz, hour: "2-digit", hour12: false }),
    10,
  );
  const greeting =
    hour < 10 ? t("greetingMorning") : hour < 18 ? t("greetingDay") : t("greetingEvening");
  const dateLine = now.toLocaleDateString(dateLocale, {
    ...tz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const summarySentence =
    needsYouTotal > 0
      ? t("summaryNeeds", { n: needsYouTotal, p: projects.length })
      : t("summaryNothing", { p: projects.length });
  const summaryDetails = needDetails.slice(0, 3).join(" · ");

  // ── Üres állapot (Master 1b): a következő konkrét lépést nevezi meg ──
  if (projects.length === 0) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-3.5 rounded-shell border border-line bg-neutral-50 p-12 shadow-shell">
        <div className="mb-1.5 flex gap-1" aria-hidden>
          <span className="h-11 w-[34px] rounded-control border border-line bg-surface shadow-card-sm" />
          <span className="h-11 w-[34px] rounded-control border-[1.5px] border-action bg-accent-tint" />
          <span className="h-11 w-[34px] rounded-control border border-neutral-300 bg-neutral-150" />
        </div>
        <h1 className="text-[20px] font-extrabold tracking-tight">{t("emptyTitle")}</h1>
        <p className="max-w-[460px] text-center text-[13px] leading-relaxed text-ink-secondary">
          {t("emptyBody")} <b className="text-ink">{t("emptyBodyStrong")}</b>
        </p>
        <div className="mt-1.5">
          <Link
            href="/projects"
            className="rounded-control bg-action px-4 py-2.5 text-[13px] font-semibold text-white shadow-action hover:bg-action-hover"
          >
            {t("newProject")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {/* Fejléc: dátum + köszöntés + ⌘K (vizuális) + Új projekt */}
      <div className="flex flex-wrap items-center gap-4 border-b border-line-soft pb-4">
        <div>
          <div className="font-mono text-[11px] text-ink-tertiary">{dateLine}</div>
          <h1 className="mt-0.5 text-[20px] font-bold tracking-tight">{greeting}</h1>
        </div>
        <div className="ml-auto hidden min-w-[220px] items-center gap-1.5 rounded-control border border-line bg-sunken px-3 py-[7px] text-[12.5px] text-ink-tertiary sm:flex">
          <span aria-hidden>⌕</span>
          {t("searchPlaceholder")}
          <span className="ml-auto rounded-3 border border-neutral-350 px-1.5 font-mono text-[10px]">
            ⌘K
          </span>
        </div>
        <Link
          href="/projects"
          className="rounded-control bg-action px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-action hover:bg-action-hover"
        >
          {t("newProject")}
        </Link>
      </div>

      {/* P7: állapot-összefoglaló sáv — a csempék ELŐTT */}
      <div className="flex items-center gap-3.5 border-b border-line-soft bg-context px-1 py-3.5">
        <span
          aria-hidden
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-tile bg-action text-white"
        >
          →
        </span>
        <p className="min-w-0 flex-1 text-[14px] leading-snug text-ink">
          <b className="font-bold">{summarySentence}</b>
          {summaryDetails && <span className="text-ink-secondary"> — {summaryDetails}.</span>}
        </p>
        <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-ink-tertiary">
          {t("updatedAt", {
            time: now.toLocaleTimeString(dateLocale, {
              ...tz,
              hour: "2-digit",
              minute: "2-digit",
            }),
          })}
        </span>
      </div>

      <div className="pt-5">
        <DashboardBoard cards={cards} summary={summary} />
      </div>
    </div>
  );
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ComponentLinkRow,
  ComponentOptionRow,
  EvalCaseRow,
  GoldenSetRow,
  InputItemRow,
  ProcessMapRow,
  RequirementLevel,
  RequirementRow,
  SolutionComponentRow,
  StakeholderRow,
  UseCaseRow,
  StaleAckRow,
  BuildComponentRow,
} from "@/lib/db/types";
import type { PhaseId } from "@/lib/phases/config";
import { graphFromJson } from "@/lib/processmap/parse";
import type { ProcessNode } from "@/lib/processmap/model";
import { passStats } from "@/lib/goldenset/model";
import { criteriaKeysOf, customCriterionLabel, parseCriteriaValues } from "@/lib/solution/model";
import { quadrant, hasMatrixPoint, type Quadrant } from "@/lib/stakeholders/matrix";
import {
  activeStaleSince,
  originDriftSince,
  sourceUpdatedSince,
  sourceUpdatedForRows,
} from "@/lib/staleness";

// ─────────────────────────────────────────────────────────────
// Epic 3 · 3.3 — tool-előnézet ADATGYŰJTŐ (server-only, read-only).
// A tool-sáv kártyáinak miniatűr munkafelületeihez fázisonként a
// szükséges MINIMUM adat: a P1-toolok a PhaseWorkspace már betöltött
// entitásaiból számolnak (ctx), a P2/P3-toolok saját (eq-szűrős,
// shim-kompatibilis) lekérdezésekből. Minden szám/nev/pozíció valós
// adat — a kanonikus terv minta-adatai sehol nem jelennek meg.
//
// Tool-szintű ⟳ (elavult): MINDEN jel derivált (compliance check 5. pont):
//   · source_updated — az entitások forrás-verziócsoportjából;
//   · asis_changed — a legfrissebb AS-IS újabb, mint a TO-BE;
//   · origin_drift — build-komponens P2-eredete a seed után változott.
// Ahol nincs derivált jel, nincs ⟳ (nincs hamis pozitív).
// ─────────────────────────────────────────────────────────────

export type StaleReason = "source_updated" | "asis_changed" | "origin_drift";

export type HeatmapDotCls = "quickwin" | "normal" | "hard" | "excluded";
export interface HeatmapPreviewData {
  dots: { value: number; feasibility: number; cls: HeatmapDotCls }[];
  confirmedTotal: number;
  scored: number;
  quickWins: number;
  stale: StaleReason | null;
}

export interface MatrixPreviewData {
  placed: { initials: string; quadrant: Quadrant }[];
  total: number;
  scored: number;
  stale: StaleReason | null;
}

export interface StepPreview {
  title: string;
  /** AS-IS: a lépés nyitott pontjainak száma (a node saját problémajele). */
  open: number;
  kind: "ai" | "hitl" | "other";
}
export interface ProcessPreviewData {
  kind: "as_is" | "to_be";
  steps: StepPreview[];
  stepTotal: number;
  /** AS-IS: Σ nyitott pont a térképen. */
  openTotal: number;
  approved: boolean;
  /** TO-BE: az AS-IS első lépései (előtte-kontraszt) + lépésszáma. */
  asIsSteps: string[];
  asIsCount: number | null;
  stale: StaleReason | null;
}

export interface RequirementsPreviewData {
  /** Szintenként az első követelmény szövege (fa-lépcső) — hiányzó szint = nincs sor. */
  chain: { level: RequirementLevel; text: string }[];
  counts: Record<RequirementLevel, number>;
  acCount: number;
  stale: StaleReason | null;
}

export interface OptionsPreviewData {
  /** A mutatott komponens szempont-feliratai (max 3). */
  criteria: string[];
  /** A mutatott komponens opciói (max 3): jóság-szint szempontonként
   *  (a ComponentDetail valueTone-osztályozásával azonos szemantika). */
  options: { name: string; selected: boolean; levels: (0 | 1 | 2 | 3)[] }[];
  componentTotal: number;
  decidedTotal: number;
  winnerName: string | null;
  stale: StaleReason | null;
}

export interface BuilddocPreviewData {
  components: { name: string; bound: boolean }[];
  targets: { title: string; kind: "ai" | "hitl" | "other" }[];
  total: number;
  boundCount: number;
  linkCount: number;
  stale: StaleReason | null;
}

export interface GoldensetPreviewData {
  cases: { displayId: string; verdict: "passed" | "partial" | "failed" | null }[];
  total: number;
  passed: number;
  failed: number;
  pct: number;
  threshold: number | null;
  stale: StaleReason | null;
}

export interface ToolPreviews {
  heatmap?: HeatmapPreviewData;
  stakeholder_matrix?: MatrixPreviewData;
  process?: ProcessPreviewData;
  requirements?: RequirementsPreviewData;
  solution?: OptionsPreviewData;
  builddoc?: BuilddocPreviewData;
  goldenset?: GoldensetPreviewData;
}

/** A PhaseWorkspace már betöltött adatai — a P1-toolok ebből számolnak,
 *  az `inputs` a forrás-frissülés deriválásához MINDEN fázison kell. */
export interface PreviewContext {
  inputs: InputItemRow[];
  useCases: UseCaseRow[];
  stakeholders: StakeholderRow[];
  staleAcks: StaleAckRow[];
}

type Db = SupabaseClient;

/** Monogram a névből: „Kovács Nándor" → „K.N." (max 2 tag). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => `${[...p][0].toUpperCase()}.`).join("");
}

const isConfirmed = (s: { state: string }) => s.state === "confirmed" || s.state === "manual";

/** Az első aktív (ack-szűrt) source_updated jel az entitás-halmazon. */
function anySourceUpdated(
  rows: { id: string; source_input_ids: string[] }[],
  inputs: InputItemRow[],
  acks: StaleAckRow[],
  subjectType: string,
): boolean {
  const flagged = sourceUpdatedForRows(rows, inputs);
  for (const [id, since] of flagged) {
    if (activeStaleSince(since, acks, subjectType, id, "source_updated")) return true;
  }
  return false;
}

/** A node-ok vizuális lánc-sorrendje (a tárolt layout szerint: felülről le,
 *  balról jobbra) — az előnézet első lépéseihez. */
function chainOrder(nodes: ProcessNode[]): ProcessNode[] {
  return [...nodes].sort((a, b) => a.y - b.y || a.x - b.x);
}

const stepKind = (type: string): "ai" | "hitl" | "other" =>
  type === "ai_intervention" ? "ai" : type === "control_hitl" ? "hitl" : "other";

/** A ComponentDetail valueTone-osztályozásával AZONOS szemantika, sáv-szintté
 *  képezve: 3 = kedvező · 2 = közepes · 1 = kedvezőtlen · 0 = nincs megadva. */
function valueLevel(value: string | undefined): 0 | 1 | 2 | 3 {
  if (!value) return 0;
  const v = value.toLowerCase();
  if (["alacsony", "nincs", "kiváló", "jó", "low", "none", "excellent", "good"].includes(v))
    return 3;
  if (["közepes", "medium"].includes(v)) return 2;
  if (["magas", "high"].includes(v)) return 1;
  return 2; // ismeretlen szöveges érték — kitöltött, semleges közép
}

async function rows<T>(db: Db, table: string, projectId: string | null): Promise<T[]> {
  let q = db.from(table).select("*");
  if (projectId) q = q.eq("project_id", projectId);
  const { data } = await q;
  return (data ?? []) as T[];
}

/** A legfrissebb térkép egy kindre (verzió szerint). */
function latestMap(maps: ProcessMapRow[], kind: "as_is" | "to_be"): ProcessMapRow | null {
  const list = maps
    .filter((m) => m.kind === kind)
    .sort((a, b) => b.version - a.version || (a.updated_at < b.updated_at ? 1 : -1));
  return list[0] ?? null;
}

function asIsPreview(
  maps: ProcessMapRow[],
  inputs: InputItemRow[],
): ProcessPreviewData | undefined {
  const map = latestMap(maps, "as_is");
  if (!map) return { kind: "as_is", steps: [], stepTotal: 0, openTotal: 0, approved: false, asIsSteps: [], asIsCount: null, stale: null };
  const graph = graphFromJson(map.nodes, map.edges);
  const ordered = chainOrder(graph.nodes);
  const steps = ordered.slice(0, 4).map((n) => ({
    title: n.title,
    open: n.open_points.length,
    kind: stepKind(n.type),
  }));
  const openTotal = graph.nodes.reduce((sum, n) => sum + n.open_points.length, 0);
  const stale = map.source_input_id
    ? sourceUpdatedSince([map.source_input_id], inputs)
      ? ("source_updated" as const)
      : null
    : null;
  return {
    kind: "as_is",
    steps,
    stepTotal: graph.nodes.length,
    openTotal,
    approved: map.status === "approved",
    asIsSteps: [],
    asIsCount: null,
    stale,
  };
}

function toBePreview(maps: ProcessMapRow[]): ProcessPreviewData | undefined {
  const toBe = latestMap(maps, "to_be");
  const asIs = latestMap(maps, "as_is");
  const asIsGraph = asIs ? graphFromJson(asIs.nodes, asIs.edges) : null;
  if (!toBe)
    return {
      kind: "to_be",
      steps: [],
      stepTotal: 0,
      openTotal: 0,
      approved: false,
      asIsSteps: [],
      asIsCount: asIsGraph ? asIsGraph.nodes.length : null,
      stale: null,
    };
  const graph = graphFromJson(toBe.nodes, toBe.edges);
  const ordered = chainOrder(graph.nodes);
  // Előtte-kontraszt (compliance 2. eltérés): a VALÓS AS-IS első lépései,
  // kiváltás-tényt lépés-párokra nem állítunk (nincs perzisztált leképezés).
  const asIsSteps = asIsGraph ? chainOrder(asIsGraph.nodes).slice(0, 2).map((n) => n.title) : [];
  const stale =
    asIs && toBe && new Date(asIs.updated_at).getTime() > new Date(toBe.updated_at).getTime()
      ? ("asis_changed" as const)
      : null;
  return {
    kind: "to_be",
    steps: ordered.slice(0, 3).map((n) => ({ title: n.title, open: 0, kind: stepKind(n.type) })),
    stepTotal: graph.nodes.length,
    openTotal: 0,
    approved: toBe.status === "approved",
    asIsSteps,
    asIsCount: asIsGraph ? asIsGraph.nodes.length : null,
    stale,
  };
}

export async function loadToolPreviews(
  db: Db,
  projectId: string,
  phase: PhaseId,
  ctx: PreviewContext,
): Promise<ToolPreviews> {
  const out: ToolPreviews = {};

  if (phase === "P1") {
    // ── Hőtérkép — a betöltött use case-ekből ──
    const confirmed = ctx.useCases.filter(isConfirmed);
    const scoredRows = confirmed.filter(
      (u) => u.score_value !== null && u.score_feasibility !== null,
    );
    out.heatmap = {
      dots: scoredRows.map((u) => ({
        value: u.score_value as number,
        feasibility: u.score_feasibility as number,
        cls:
          u.list_status === "excluded"
            ? "excluded"
            : u.quick_win
              ? "quickwin"
              : u.risk === "high"
                ? "hard"
                : "normal",
      })),
      confirmedTotal: confirmed.length,
      scored: scoredRows.length,
      quickWins: scoredRows.filter((u) => u.quick_win && u.list_status !== "excluded").length,
      stale: anySourceUpdated(confirmed, ctx.inputs, ctx.staleAcks, "use_case")
        ? "source_updated"
        : null,
    };

    // ── Befolyás × érintettség — a betöltött stakeholderekből ──
    const sh = ctx.stakeholders.filter(isConfirmed);
    const placed = sh
      .filter((s) => hasMatrixPoint(s.influence_score, s.impact_score))
      .map((s) => ({
        initials: initialsOf(s.name),
        quadrant: quadrant(s.influence_score as number, s.impact_score as number),
      }));
    out.stakeholder_matrix = {
      placed,
      total: sh.length,
      scored: placed.length,
      stale: anySourceUpdated(sh, ctx.inputs, ctx.staleAcks, "stakeholder")
        ? "source_updated"
        : null,
    };

    // ── Folyamattérkép AS-IS ──
    const maps = await rows<ProcessMapRow>(db, "process_maps", projectId);
    out.process = asIsPreview(maps, ctx.inputs);
  }

  if (phase === "P2") {
    const [maps, reqs, acs, comps, opts] = await Promise.all([
      rows<ProcessMapRow>(db, "process_maps", projectId),
      rows<RequirementRow>(db, "requirements", projectId),
      rows<{ id: string; requirement_id: string }>(db, "acceptance_criteria", null),
      rows<SolutionComponentRow>(db, "solution_components", projectId),
      rows<ComponentOptionRow>(db, "component_options", null),
    ]);

    // ── Folyamattérkép TO-BE ──
    out.process = toBePreview(maps);

    // ── Követelmények (Ü/S/M fa) ──
    const live = reqs.filter((r) => r.state !== "rejected");
    const reqIds = new Set(live.map((r) => r.id));
    const levels: RequirementLevel[] = ["business", "stakeholder", "system"];
    const counts = {
      business: live.filter((r) => r.level === "business").length,
      stakeholder: live.filter((r) => r.level === "stakeholder").length,
      system: live.filter((r) => r.level === "system").length,
    };
    const chain = levels.flatMap((level) => {
      const first = live.find((r) => r.level === level);
      return first ? [{ level, text: first.text }] : [];
    });
    out.requirements = {
      chain,
      counts,
      acCount: acs.filter((a) => reqIds.has(a.requirement_id)).length,
      stale: sourceUpdatedForRows(live, ctx.inputs).size > 0 ? "source_updated" : null,
    };

    // ── Opció-összevető ──
    const liveComps = comps.filter((c) => c.state !== "rejected");
    const compIds = new Set(liveComps.map((c) => c.id));
    const optsByComp = new Map<string, ComponentOptionRow[]>();
    for (const o of opts) {
      if (!compIds.has(o.component_id)) continue;
      const list = optsByComp.get(o.component_id) ?? [];
      list.push(o);
      optsByComp.set(o.component_id, list);
    }
    const decided = liveComps.filter((c) =>
      (optsByComp.get(c.id) ?? []).some((o) => o.is_selected),
    );
    // A mutatott mátrix: az első eldöntött komponens, különben az első opciós.
    const shown =
      decided[0] ?? liveComps.find((c) => (optsByComp.get(c.id) ?? []).length > 0) ?? null;
    const shownOpts = (shown ? (optsByComp.get(shown.id) ?? []) : [])
      .sort((a, b) => a.ord - b.ord)
      .slice(0, 3);
    const keys = criteriaKeysOf(shownOpts)
      .filter((k) => shownOpts.some((o) => parseCriteriaValues(o.criteria_values)[k]?.value))
      .slice(0, 3);
    const winner = shownOpts.find((o) => o.is_selected) ?? null;
    out.solution = {
      criteria: keys.map((k) => customCriterionLabel(shownOpts, k) ?? k),
      options: shownOpts.map((o) => {
        const vals = parseCriteriaValues(o.criteria_values);
        return {
          name: o.name,
          selected: o.is_selected,
          levels: keys.map((k) => valueLevel(vals[k]?.value)),
        };
      }),
      componentTotal: liveComps.length,
      decidedTotal: decided.length,
      winnerName: winner?.name ?? null,
      stale: sourceUpdatedForRows(liveComps, ctx.inputs).size > 0 ? "source_updated" : null,
    };
  }

  if (phase === "P3") {
    const [builds, links, maps, origins, sets, cases] = await Promise.all([
      rows<BuildComponentRow>(db, "build_components", projectId),
      rows<ComponentLinkRow>(db, "component_links", null),
      rows<ProcessMapRow>(db, "process_maps", projectId),
      rows<SolutionComponentRow>(db, "solution_components", projectId),
      rows<GoldenSetRow>(db, "golden_sets", projectId),
      rows<EvalCaseRow>(db, "eval_cases", null),
    ]);

    // ── Megoldás-tervező (kötés-gráf) ──
    const liveBuilds = builds.filter((b) => b.state !== "rejected").sort((a, b) => a.ord - b.ord);
    const buildIds = new Set(liveBuilds.map((b) => b.id));
    const tobeLinks = links.filter(
      (l) =>
        l.build_component_id !== null &&
        buildIds.has(l.build_component_id) &&
        l.target_type === "tobe_node",
    );
    const boundIds = new Set(tobeLinks.map((l) => l.build_component_id as string));
    const toBe = latestMap(maps, "to_be");
    const toBeNodes = toBe ? graphFromJson(toBe.nodes, toBe.edges).nodes : [];
    const nodeById = new Map(toBeNodes.map((n) => [n.id, n]));
    const targetNodes = tobeLinks
      .map((l) => nodeById.get(l.target_id))
      .filter((n): n is ProcessNode => Boolean(n));
    const uniqueTargets = [...new Map(targetNodes.map((n) => [n.id, n])).values()];
    const originById = new Map(origins.map((o) => [o.id, o]));
    const drift = liveBuilds.some((b) =>
      originDriftSince(b.seeded_at, originById.get(b.origin_component_id ?? "")?.updated_at),
    );
    out.builddoc = {
      components: liveBuilds.slice(0, 3).map((b) => ({ name: b.name, bound: boundIds.has(b.id) })),
      targets: uniqueTargets.slice(0, 3).map((n) => ({ title: n.title, kind: stepKind(n.type) })),
      total: liveBuilds.length,
      boundCount: liveBuilds.filter((b) => boundIds.has(b.id)).length,
      linkCount: tobeLinks.length,
      stale: drift
        ? "origin_drift"
        : sourceUpdatedForRows(liveBuilds, ctx.inputs).size > 0
          ? "source_updated"
          : null,
    };

    // ── Golden set & riport ──
    const setIds = new Set(sets.map((s) => s.id));
    const ownCases = cases.filter((c) => setIds.has(c.golden_set_id));
    const stats = passStats(ownCases);
    const thresholds = [...new Set(sets.map((s) => s.pass_threshold).filter((v) => v !== null))];
    out.goldenset = {
      cases: ownCases.slice(0, 3).map((c) => ({ displayId: c.display_id, verdict: c.final_verdict })),
      total: stats.total,
      passed: stats.passed,
      failed: stats.failed,
      pct: stats.pct,
      // Több set eltérő küszöbbel → nincs egyetlen őszinte jelölő (nem átlagolunk).
      threshold: thresholds.length === 1 ? (thresholds[0] as number) : null,
      stale: sourceUpdatedForRows(ownCases, ctx.inputs).size > 0 ? "source_updated" : null,
    };
  }

  return out;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ArtifactRenderLinkRow,
  ArtifactRow,
  ComponentLinkRow,
  ComponentOptionRow,
  EvalCriterionRow,
  GoldenSetRow,
  InputItemRow,
  ProcessMapRow,
  UseCaseRow,
} from "@/lib/db/types";
import { renderStaleSince } from "@/lib/staleness";

// ─────────────────────────────────────────────────────────────
// Tudáselem-katalógus lekérdező modul (Csomag C1, C1.3) — READ-ONLY.
// A B-csomag felülete majd ezt fogyasztja; most UI nélkül, adat-szinten.
//
// „Hol van használva" (usageOf): egy tudáselem ÖSSZES perzisztált
// használata, típus szerint megkülönböztetve:
//   · documents — renderelés-élek (artifact_render_links): mely
//     dokumentum(-mező) rendereli;
//   · entities  — downstream tudáselem-élek (a meglévő FK/kötés-élek:
//     use_case→pain, requirement-fa, story-kötés, origin_component_id,
//     component_links, golden_set→use_case, …);
//   · citations — forrás-citációk: mely sorok hivatkozzák forrásként
//     (source_input_ids / source_input_id / stakeholder_source_id) —
//     ez CSAK input_item alanyra nem-üres, mert a citáció-él mindig a
//     nyers forrásra mutat (audit 5. blokk A).
//
// Fordított irány (renderedBy): egy artifact mely tudáselemeket
// rendereli, mező-bontásban.
//
// ŐSZINTE HATÁR (spec C1.3): a tool-nézetek (hőtérkép, mátrix) élőben
// olvassák az entitásokat — az ő „használatuk" nem perzisztált él, így
// itt nem jelenik meg. A lekérdezések shim-/PostgREST-kompatibilisek:
// eq-szűrés + JS-oldali szűrés (nincs .in()/.contains()).
// ─────────────────────────────────────────────────────────────

/** Egy dokumentum-használat sor (renderelés-él + artifact-kontextus). */
export interface DocumentUsage {
  artifact_id: string;
  artifact_type: string | null;
  artifact_version: number | null;
  field_key: string | null;
  rendered_at: string;
}

/** Egy downstream tudáselem-használat sor. */
export interface EntityUsage {
  /** Melyik él-fajtán át (pl. "use_case.pain_point_ids", "component_links",
   *  "golden_sets.use_case_id", "build_components.origin_component_id"). */
  via: string;
  table: string;
  id: string;
  label: string | null;
}

/** Egy forrás-citáció használat sor (ki hivatkozza forrásként az alanyt). */
export interface CitationUsage {
  table: string;
  id: string;
  label: string | null;
}

export interface UsageResult {
  documents: DocumentUsage[];
  entities: EntityUsage[];
  citations: CitationUsage[];
}

type Db = SupabaseClient;

async function rowsOf<T>(
  db: Db,
  table: string,
  projectScoped: boolean,
  projectId: string,
): Promise<T[]> {
  let q = db.from(table).select("*");
  if (projectScoped) q = q.eq("project_id", projectId);
  const { data } = await q;
  return (data ?? []) as T[];
}

interface NamedRow {
  id: string;
  [k: string]: unknown;
}

const labelOf = (r: NamedRow): string | null =>
  (typeof r.title === "string" && r.title) ||
  (typeof r.name === "string" && r.name) ||
  (typeof r.display_id === "string" && r.display_id) ||
  (typeof r.text === "string" && r.text) ||
  null;

/** Dokumentum-használat: renderelés-élek az alanyra (bármely target_type). */
async function documentUsage(db: Db, projectId: string, blockId: string): Promise<DocumentUsage[]> {
  const edges = (
    await rowsOf<ArtifactRenderLinkRow>(db, "artifact_render_links", true, projectId)
  ).filter((e) => e.target_id === blockId);
  if (edges.length === 0) return [];
  const artifacts = await rowsOf<ArtifactRow>(db, "artifacts", true, projectId);
  const byId = new Map(artifacts.map((a) => [a.id, a]));
  return edges.map((e) => ({
    artifact_id: e.artifact_id,
    artifact_type: byId.get(e.artifact_id)?.type ?? null,
    artifact_version: byId.get(e.artifact_id)?.version ?? null,
    field_key: e.field_key,
    rendered_at: e.rendered_at,
  }));
}

/** Downstream tudáselem-élek az alanyra, block_type szerint. */
async function entityUsage(
  db: Db,
  projectId: string,
  blockType: string,
  blockId: string,
): Promise<EntityUsage[]> {
  const out: EntityUsage[] = [];
  const push = (via: string, table: string, rows: NamedRow[]) => {
    for (const r of rows) out.push({ via, table, id: r.id, label: labelOf(r) });
  };

  // component_links cél-oldala (soft-ref): pain_point / requirement / story
  const linkTargets = async (targetType: string) => {
    const links = (await rowsOf<ComponentLinkRow>(db, "component_links", false, projectId)).filter(
      (l) => l.target_type === targetType && l.target_id === blockId,
    );
    for (const l of links) {
      const ownerTable = l.solution_component_id ? "solution_components" : "build_components";
      const ownerId = l.solution_component_id ?? l.build_component_id;
      if (!ownerId) continue;
      const { data } = await db.from(ownerTable).select("*").eq("id", ownerId).maybeSingle();
      if (data) push("component_links", ownerTable, [data as NamedRow]);
    }
  };

  switch (blockType) {
    case "pain_point": {
      const ucs = (await rowsOf<UseCaseRow>(db, "use_cases", true, projectId)).filter((u) =>
        (u.pain_point_ids ?? []).includes(blockId),
      );
      push("use_cases.pain_point_ids", "use_cases", ucs as unknown as NamedRow[]);
      await linkTargets("pain_point");
      break;
    }
    case "use_case": {
      const sets = (await rowsOf<GoldenSetRow>(db, "golden_sets", true, projectId)).filter(
        (g) => g.use_case_id === blockId,
      );
      push("golden_sets.use_case_id", "golden_sets", sets as unknown as NamedRow[]);
      break;
    }
    case "stakeholder": {
      const pps = (await rowsOf<NamedRow>(db, "pain_point_stakeholders", false, projectId)).filter(
        (r) => r.stakeholder_id === blockId,
      );
      push(
        "pain_point_stakeholders",
        "pain_points",
        pps.map((r) => ({ id: String(r.pain_point_id) })),
      );
      const srs = (await rowsOf<NamedRow>(db, "stakeholder_requirements", false, projectId)).filter(
        (r) => r.stakeholder_id === blockId,
      );
      push(
        "stakeholder_requirements",
        "requirements",
        srs.map((r) => ({ id: String(r.requirement_id) })),
      );
      break;
    }
    case "requirement": {
      const children = (await rowsOf<NamedRow>(db, "requirements", true, projectId)).filter(
        (r) => r.parent_id === blockId,
      );
      push("requirements.parent_id", "requirements", children);
      const acs = (await rowsOf<NamedRow>(db, "acceptance_criteria", false, projectId)).filter(
        (r) => r.requirement_id === blockId,
      );
      push("acceptance_criteria.requirement_id", "acceptance_criteria", acs);
      const rss = (await rowsOf<NamedRow>(db, "requirement_stories", false, projectId)).filter(
        (r) => r.requirement_id === blockId,
      );
      push(
        "requirement_stories",
        "user_stories",
        rss.map((r) => ({ id: String(r.story_id) })),
      );
      const eps = (await rowsOf<NamedRow>(db, "epics", true, projectId)).filter(
        (r) => r.business_requirement_id === blockId,
      );
      push("epics.business_requirement_id", "epics", eps);
      await linkTargets("requirement");
      break;
    }
    case "user_story": {
      await linkTargets("story");
      break;
    }
    case "epic": {
      const stories = (await rowsOf<NamedRow>(db, "user_stories", true, projectId)).filter(
        (r) => r.epic_id === blockId,
      );
      push("user_stories.epic_id", "user_stories", stories);
      break;
    }
    case "solution_component": {
      const seeded = (await rowsOf<NamedRow>(db, "build_components", true, projectId)).filter(
        (r) => r.origin_component_id === blockId,
      );
      push("build_components.origin_component_id", "build_components", seeded);
      const opts = (await rowsOf<ComponentOptionRow>(db, "component_options", false, projectId)).filter(
        (o) => o.component_id === blockId,
      );
      push("component_options.component_id", "component_options", opts as unknown as NamedRow[]);
      break;
    }
    case "build_component": {
      const prompts = (await rowsOf<NamedRow>(db, "prompt_items", true, projectId)).filter(
        (r) => r.component_id === blockId,
      );
      push("prompt_items.component_id", "prompt_items", prompts);
      break;
    }
    case "eval_case": {
      const crits = (await rowsOf<EvalCriterionRow>(db, "eval_criteria", false, projectId)).filter(
        (c) => c.eval_case_id === blockId,
      );
      push("eval_criteria.eval_case_id", "eval_criteria", crits as unknown as NamedRow[]);
      break;
    }
    default:
      break;
  }
  return out;
}

/** Forrás-citációk: mely sorok hivatkozzák az alanyt forrásként. Csak
 *  input_item alanyra nem-üres (a citáció-él mindig a nyers forrásra mutat). */
async function citationUsage(
  db: Db,
  projectId: string,
  blockType: string,
  blockId: string,
): Promise<CitationUsage[]> {
  if (blockType !== "input_item") return [];
  const out: CitationUsage[] = [];
  const scan = async (table: string) => {
    const rows = await rowsOf<NamedRow>(db, table, true, projectId);
    for (const r of rows) {
      const ids = (r.source_input_ids ?? []) as string[];
      if (Array.isArray(ids) && ids.includes(blockId)) {
        out.push({ table, id: r.id, label: labelOf(r) });
      }
    }
  };
  for (const table of [
    "pain_points",
    "use_cases",
    "stakeholders",
    "requirements",
    "user_stories",
    "solution_components",
    "build_components",
    "prompt_items",
    "control_points",
    "artifacts",
  ]) {
    await scan(table);
  }
  // eval_cases: golden_set-en át projekt-szűrt
  const sets = await rowsOf<GoldenSetRow>(db, "golden_sets", true, projectId);
  const setIds = new Set(sets.map((s) => s.id));
  const evalCases = (await rowsOf<NamedRow>(db, "eval_cases", false, projectId)).filter((r) =>
    setIds.has(String(r.golden_set_id)),
  );
  for (const r of evalCases) {
    const ids = (r.source_input_ids ?? []) as string[];
    if (Array.isArray(ids) && ids.includes(blockId)) {
      out.push({ table: "eval_cases", id: r.id, label: labelOf(r) });
    }
  }
  // process_maps: egyetlen forrás-hivatkozás (source_input_id)
  const maps = (await rowsOf<ProcessMapRow>(db, "process_maps", true, projectId)).filter(
    (m) => m.source_input_id === blockId,
  );
  for (const m of maps) out.push({ table: "process_maps", id: m.id, label: m.title });
  return out;
}

/** „Hol van használva" — egy tudáselem összes perzisztált használata,
 *  típus szerint megkülönböztetve (dokumentum / downstream entitás /
 *  forrás-citáció). */
export async function usageOf(
  db: Db,
  projectId: string,
  blockType: string,
  blockId: string,
): Promise<UsageResult> {
  const [documents, entities, citations] = await Promise.all([
    documentUsage(db, projectId, blockId),
    entityUsage(db, projectId, blockType, blockId),
    citationUsage(db, projectId, blockType, blockId),
  ]);
  return { documents, entities, citations };
}

/** Fordított irány: egy artifact mely tudáselemeket rendereli — mező-
 *  bontásban (field_key=null kulcsa: ""). */
export async function renderedBy(
  db: Db,
  artifactId: string,
): Promise<Map<string, ArtifactRenderLinkRow[]>> {
  const { data } = await db
    .from("artifact_render_links")
    .select("*")
    .eq("artifact_id", artifactId);
  const edges = (data ?? []) as ArtifactRenderLinkRow[];
  const byField = new Map<string, ArtifactRenderLinkRow[]>();
  for (const e of edges) {
    const key = e.field_key ?? "";
    const list = byField.get(key) ?? [];
    list.push(e);
    byField.set(key, list);
  }
  return byField;
}

/** render_stale trigger-bélyeg egy artifactra (C1.4): a renderelés-élek
 *  cél-tudáselemeinek friss updated_at-jait veti össze az él rendered_at-
 *  jával. A célok updated_at-ját él-fajtánként tölti be (eq-szűrés,
 *  shim-kompatibilis). Null = nincs elavult renderelt cél. */
export async function renderStaleSinceForArtifact(
  db: Db,
  projectId: string,
  artifactId: string,
): Promise<string | null> {
  const { data } = await db
    .from("artifact_render_links")
    .select("*")
    .eq("artifact_id", artifactId);
  const edges = (data ?? []) as ArtifactRenderLinkRow[];
  if (edges.length === 0) return null;

  const TABLE_OF: Record<string, { table: string; projectScoped: boolean }> = {
    use_case: { table: "use_cases", projectScoped: true },
    solution_component: { table: "solution_components", projectScoped: true },
    component_option: { table: "component_options", projectScoped: false },
    build_component: { table: "build_components", projectScoped: true },
    prompt_item: { table: "prompt_items", projectScoped: true },
    control_point: { table: "control_points", projectScoped: true },
    eval_case: { table: "eval_cases", projectScoped: false },
  };
  const neededTypes = [...new Set(edges.map((e) => e.target_type))];
  const targetUpdatedAt = new Map<string, string>();
  for (const tt of neededTypes) {
    const cfg = TABLE_OF[tt];
    if (!cfg) continue;
    const rows = await rowsOf<NamedRow>(db, cfg.table, cfg.projectScoped, projectId);
    for (const r of rows) {
      // component_options-nak nincs updated_at-ja → created_at a közelítés
      const updated =
        (typeof r.updated_at === "string" && r.updated_at) ||
        (typeof r.created_at === "string" && r.created_at) ||
        null;
      if (updated) targetUpdatedAt.set(`${tt}:${r.id}`, updated);
    }
  }
  return renderStaleSince(edges, targetUpdatedAt);
}

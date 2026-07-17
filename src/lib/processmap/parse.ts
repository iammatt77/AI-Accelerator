// ─────────────────────────────────────────────────────────────
// Folyamattérkép (#10) — defenzív parse: (1) az LLM lépés-javaslat JSON-ja →
// topológia (node-ok + élek, layout NÉLKÜL); (2) a DB jsonb → típusos gráf.
// A parse SOSEM dob a rossz alak miatt: az érvénytelen elemeket kihagyja,
// az értékeket koercionálja (a #6-fix elvei szerint).
// ─────────────────────────────────────────────────────────────

import { stripCodeFences } from "@/lib/llm/parse";
import type {
  OpenPoint,
  OpenPointLevel,
  ProcessEdge,
  ProcessGraph,
  ProcessNode,
  SourceRef,
} from "./model";

// Az LLM-nek kiadott lépés-alak (a prompt example shape-je):
// { "title": "...", "steps": [ { "id": "s1", "title": "...", "sub": "...",
//   "type": "human", "desc": "...", "quote": "...", "loc": "...",
//   "open_points": [{"level":"important","text":"..."}],
//   "next": [{"to":"s2","label":"Igen · ismert"}] } ] }

const LEVELS: OpenPointLevel[] = ["blocker", "important", "clarify"];

function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s === "" ? null : s;
}

function openPoints(v: unknown): OpenPoint[] {
  if (!Array.isArray(v)) return [];
  const result: OpenPoint[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const level = str(o.level).toLowerCase() as OpenPointLevel;
    const text = str(o.text);
    if (!text) continue;
    result.push({ level: LEVELS.includes(level) ? level : "clarify", text });
  }
  return result;
}

export interface ParsedProcess {
  title: string;
  graph: ProcessGraph;
}

/**
 * Az LLM válaszából topológiát épít (x/y=0 — a layouter tölti). A forrás-
 * hivatkozás alapját (quote/loc) a hívó egészíti ki a `[n]` ref-fel.
 */
export function parseProcessProposal(
  raw: string,
  refLabel: string,
  refLocPrefix: string,
): ParsedProcess {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(raw));
  } catch {
    return { title: "", graph: { nodes: [], edges: [] } };
  }
  if (!parsed || typeof parsed !== "object") {
    return { title: "", graph: { nodes: [], edges: [] } };
  }
  const rootObj = parsed as Record<string, unknown>;
  const stepsRaw = Array.isArray(rootObj.steps) ? rootObj.steps : [];

  const nodes: ProcessNode[] = [];
  const nexts: { from: string; to: string; label: string | null }[] = [];
  const seen = new Set<string>();
  stepsRaw.forEach((item, i) => {
    if (!item || typeof item !== "object") return;
    const o = item as Record<string, unknown>;
    const title = str(o.title);
    if (!title) return;
    let id = str(o.id) || `s${i + 1}`;
    while (seen.has(id)) id = `${id}_x`;
    seen.add(id);
    const quote = str(o.quote);
    const loc = str(o.loc);
    const source: SourceRef | null = quote
      ? { ref: refLabel, quote, loc: loc ? `${refLocPrefix} · ${loc}` : refLocPrefix }
      : null;
    nodes.push({
      id,
      title,
      sub: strOrNull(o.sub),
      type: str(o.type) || "human",
      desc: str(o.desc),
      x: 0,
      y: 0,
      w: 300,
      h: 92,
      source_ref: source,
      open_points: openPoints(o.open_points),
      diff: null,
      diff_note: null,
    });
    const nextRaw = Array.isArray(o.next) ? o.next : [];
    for (const n of nextRaw) {
      if (!n || typeof n !== "object") continue;
      const e = n as Record<string, unknown>;
      const to = str(e.to);
      if (!to) continue;
      nexts.push({ from: id, to, label: strOrNull(e.label) });
    }
  });

  const ids = new Set(nodes.map((n) => n.id));
  const edges: ProcessEdge[] = nexts
    .filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
    .map((e, i) => ({
      id: `e${i + 1}`,
      from: e.from,
      to: e.to,
      label: e.label,
      fs: "bottom" as const,
      ts: "top" as const,
      via: [],
    }));

  return { title: str(rootObj.title), graph: { nodes, edges } };
}

// ── DB jsonb → típusos gráf (a betöltés defenzív oldala) ────

function nodeFromJson(v: unknown): ProcessNode | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id);
  const title = str(o.title);
  if (!id || !title) return null;
  const srcRaw = o.source_ref;
  let source_ref: SourceRef | null = null;
  if (srcRaw && typeof srcRaw === "object") {
    const s = srcRaw as Record<string, unknown>;
    const quote = str(s.quote);
    if (quote) source_ref = { ref: str(s.ref) || "?", quote, loc: str(s.loc) };
  }
  const diff = o.diff === "new" || o.diff === "mod" ? o.diff : null;
  return {
    id,
    title,
    sub: strOrNull(o.sub),
    type: str(o.type) || "human",
    desc: str(o.desc),
    x: typeof o.x === "number" ? o.x : 0,
    y: typeof o.y === "number" ? o.y : 0,
    w: typeof o.w === "number" ? o.w : 300,
    h: typeof o.h === "number" ? o.h : 92,
    source_ref,
    open_points: openPoints(o.open_points),
    diff,
    diff_note: strOrNull(o.diff_note),
  };
}

function edgeFromJson(v: unknown, i: number): ProcessEdge | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const from = str(o.from);
  const to = str(o.to);
  if (!from || !to) return null;
  const sides = ["top", "bottom", "left", "right"];
  const via = Array.isArray(o.via)
    ? (o.via.filter(
        (p) => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number",
      ) as [number, number][])
    : [];
  return {
    id: str(o.id) || `e${i + 1}`,
    from,
    to,
    label: strOrNull(o.label),
    fs: sides.includes(str(o.fs)) ? (str(o.fs) as ProcessEdge["fs"]) : "bottom",
    ts: sides.includes(str(o.ts)) ? (str(o.ts) as ProcessEdge["ts"]) : "top",
    via,
  };
}

export function graphFromJson(nodesRaw: unknown, edgesRaw: unknown): ProcessGraph {
  const nodes = (Array.isArray(nodesRaw) ? nodesRaw : [])
    .map(nodeFromJson)
    .filter((n): n is ProcessNode => n !== null);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (Array.isArray(edgesRaw) ? edgesRaw : [])
    .map(edgeFromJson)
    .filter((e): e is ProcessEdge => e !== null && ids.has(e.from) && ids.has(e.to));
  return { nodes, edges };
}

/** original_snapshot jsonb → gráf ({} → üres). */
export function snapshotFromJson(raw: unknown): ProcessGraph {
  if (!raw || typeof raw !== "object") return { nodes: [], edges: [] };
  const o = raw as Record<string, unknown>;
  return graphFromJson(o.nodes, o.edges);
}

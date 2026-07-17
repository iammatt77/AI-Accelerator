// ─────────────────────────────────────────────────────────────
// Folyamattérkép (#10) — tiszta modell (nincs React/DB): típusok +
// TÍPUS-STÍLUS regiszter + determinisztikus layouter + él-geometria +
// diff-számítás. A ref_folyamatterv.html adatszerkezetét képezi le.
//
// A node-TÍPUS-KÉSZLET NEM fix: a regiszterben az ismert üzleti készlet él
// (start_end/human/system/decide/ai_intervention/control_hitl), ismeretlen
// típus a semleges (human-szerű) stílusra esik vissza — a készlet a folyamat
// jellegéhez idomulva bővíthető anélkül, hogy a renderer eltörne.
// ─────────────────────────────────────────────────────────────

export type OpenPointLevel = "blocker" | "important" | "clarify";

export interface SourceRef {
  /** A hivatkozás címkéje — `[n]` a citáció-rendszerrel konzisztensen, vagy CHAT. */
  ref: string;
  /** Szó szerinti idézet a nyers leiratból (vagy az eredet-megjelölés). */
  quote: string;
  /** Hely a leiratban (pl. „Teams-jegyzőkönyv · kickoff · 14:05”). */
  loc: string;
}

export interface OpenPoint {
  level: OpenPointLevel;
  text: string;
}

export interface ProcessNode {
  id: string;
  title: string;
  sub: string | null;
  /** Ismert készlet + bővíthető (ismeretlen → semleges stílus). */
  type: string;
  desc: string;
  x: number;
  y: number;
  w: number;
  h: number;
  source_ref: SourceRef | null;
  open_points: OpenPoint[];
  /** Változás-jelzés az eredeti AI-verzióhoz képest (a diff számolja / a chat írja). */
  diff: "new" | "mod" | null;
  diff_note: string | null;
}

export type EdgeSide = "top" | "bottom" | "left" | "right";

export interface ProcessEdge {
  id: string;
  from: string;
  to: string;
  /** Ág-felirat (döntésnél az ág neve). */
  label: string | null;
  fs: EdgeSide;
  ts: EdgeSide;
  via: [number, number][];
}

export interface ProcessGraph {
  nodes: ProcessNode[];
  edges: ProcessEdge[];
}

// ── Típus-stílus regiszter (a ref T objektuma) ───────────────

export interface NodeTypeStyle {
  c: string;
  bg: string;
  line: string;
  fg: string;
  /** i18n-kulcs a processMap.nodeType.* névtérben. */
  labelKey: string;
  shape: "pill" | "diamond" | "card";
}

const NEUTRAL: NodeTypeStyle = {
  c: "#8B90A3",
  bg: "#F4F5F9",
  line: "#C7CAD6",
  fg: "#55596B",
  labelKey: "human",
  shape: "card",
};

export const NODE_TYPE_STYLES: Record<string, NodeTypeStyle> = {
  start_end: { c: "#3E9E6E", bg: "#E9F5EF", line: "#B6DFCB", fg: "#3E9E6E", labelKey: "start_end", shape: "pill" },
  human: { ...NEUTRAL },
  system: { c: "#256087", bg: "#E6F1F8", line: "#AAD0E6", fg: "#256087", labelKey: "system", shape: "card" },
  decide: { c: "#2E77A8", bg: "#DDF0F7", line: "#AAD0E6", fg: "#2E77A8", labelKey: "decide", shape: "diamond" },
  ai_intervention: { c: "#8458B3", bg: "#F0EBF9", line: "#CBB8E8", fg: "#7A4FB0", labelKey: "ai_intervention", shape: "card" },
  control_hitl: { c: "#B4801E", bg: "#FBF3E0", line: "#E6D2A0", fg: "#9A6A12", labelKey: "control_hitl", shape: "card" },
};

/** Stílus-feloldás fallback-kel — ismeretlen típus nem töri el a renderert. */
export function styleOf(type: string): NodeTypeStyle {
  return NODE_TYPE_STYLES[type] ?? { ...NEUTRAL, labelKey: "unknown" };
}

// ── Determinisztikus layout (a ref elrendezés-mintája) ───────
//
// A generálás TOPOLÓGIÁT ad (lépések + next-élek); a layouter BFS-mélység
// szerint sorokba rendez: 1 node/sor → x=700; 2 → 360/1040; 3 → 360/700/1040.
// Az y kumulatív (sor-magasság + rés). Él-oldalak: azonos x → bottom→top;
// döntésből oldalra → left/right + via a döntés sorában; visszacsatlakozás
// → bottom → left/right + via a cél sorában (a ref EA/EB mintája).

export const WORLD_W = 1400;
const CENTER_X = 700;
const SIDE_X: Record<number, number[]> = {
  1: [CENTER_X],
  2: [360, 1040],
  3: [360, CENTER_X, 1040],
};
const ROW_GAP = 110;
const TOP_Y = 80;

function sizeOf(node: Pick<ProcessNode, "type" | "title">): { w: number; h: number } {
  const shape = styleOf(node.type).shape;
  if (shape === "diamond") return { w: 190, h: 190 };
  if (shape === "pill") return { w: Math.max(280, Math.min(340, node.title.length * 11 + 120)), h: 64 };
  return { w: Math.max(300, Math.min(340, node.title.length * 9 + 140)), h: 92 };
}

/**
 * Pozíciók + él-geometria hozzárendelése a topológiához. A bemeneti nodes
 * x/y/w/h értékét felülírja; az edges fs/ts/via mezőit tölti. Tiszta függvény.
 */
export function layoutGraph(nodes: ProcessNode[], edges: ProcessEdge[]): ProcessGraph {
  if (nodes.length === 0) return { nodes: [], edges: [] };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) indeg.set(n.id, 0);
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  // BFS-mélység a start(ok)ból (indeg=0; fallback: első node).
  const roots = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const queue = roots.length ? roots : [nodes[0].id];
  const depth = new Map<string, number>();
  queue.forEach((id) => depth.set(id, 0));
  const bfs = [...queue];
  while (bfs.length) {
    const id = bfs.shift()!;
    for (const next of out.get(id) ?? []) {
      const d = (depth.get(id) ?? 0) + 1;
      if (!depth.has(next) || d > (depth.get(next) ?? 0)) {
        depth.set(next, d);
        bfs.push(next);
      }
    }
  }
  // Sorok mélység szerint, a node-sorrend megtartásával.
  const maxDepth = Math.max(...nodes.map((n) => depth.get(n.id) ?? 0));
  const rows: ProcessNode[][] = [];
  for (let d = 0; d <= maxDepth; d++) {
    rows.push(nodes.filter((n) => (depth.get(n.id) ?? 0) === d));
  }
  let y = TOP_Y;
  for (const row of rows) {
    if (row.length === 0) continue;
    const xs = SIDE_X[Math.min(row.length, 3)] ?? SIDE_X[3];
    let rowH = 0;
    row.forEach((n, i) => {
      const { w, h } = sizeOf(n);
      n.w = w;
      n.h = h;
      n.x = xs[Math.min(i, xs.length - 1)];
      rowH = Math.max(rowH, h);
    });
    row.forEach((n) => {
      n.y = y + rowH / 2;
    });
    y += rowH + ROW_GAP;
  }
  // Él-oldalak + via (a ref mintája).
  for (const e of edges) {
    const s = byId.get(e.from);
    const t = byId.get(e.to);
    if (!s || !t) continue;
    if (s.x === t.x) {
      e.fs = "bottom";
      e.ts = "top";
      e.via = [];
    } else if (styleOf(s.type).shape === "diamond") {
      e.fs = t.x < s.x ? "left" : "right";
      e.ts = "top";
      e.via = [[t.x, s.y]];
    } else {
      e.fs = "bottom";
      e.ts = s.x < t.x ? "left" : "right";
      e.via = [[s.x, t.y]];
    }
  }
  return { nodes, edges };
}

/** A világ magassága (kamera-fit-hez). */
export function worldHeight(nodes: ProcessNode[]): number {
  if (nodes.length === 0) return 800;
  return Math.max(...nodes.map((n) => n.y + n.h / 2)) + 120;
}

// ── Él-geometria (a ref edgeD/anchor függvénye) ──────────────

function anchor(n: ProcessNode, side: EdgeSide): [number, number] {
  const hw = n.w / 2;
  const hh = n.h / 2;
  if (side === "top") return [n.x, n.y - hh];
  if (side === "bottom") return [n.x, n.y + hh];
  if (side === "left") return [n.x - hw, n.y];
  return [n.x + hw, n.y];
}

export function edgePath(
  nodes: ProcessNode[],
  e: ProcessEdge,
): { d: string; labelAt: [number, number] } | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sN = byId.get(e.from);
  const tN = byId.get(e.to);
  if (!sN || !tN) return null;
  const s = anchor(sN, e.fs);
  const t = anchor(tN, e.ts);
  const mid: [number, number][] = [];
  if (e.via.length) {
    mid.push(...e.via);
  } else if (
    (e.fs === "bottom" || e.fs === "top") &&
    (e.ts === "top" || e.ts === "bottom") &&
    s[0] !== t[0]
  ) {
    const my = (s[1] + t[1]) / 2;
    mid.push([s[0], my], [t[0], my]);
  }
  const pts: [number, number][] = [s, ...mid, t];
  return {
    d: "M" + pts.map((p) => `${p[0]},${p[1]}`).join(" L"),
    labelAt: pts.length > 2 ? pts[1] : [(s[0] + t[0]) / 2, (s[1] + t[1]) / 2],
  };
}

// ── Változáskövetés (eredeti snapshot ↔ szerkesztett) ────────

export interface GraphDiff {
  originalCount: number;
  currentCount: number;
  added: number;
  modified: number;
}

/**
 * Diff az eredeti AI-snapshot és az aktuális node-lista között. A node
 * „new”, ha az id nincs a snapshotban; „mod”, ha a tartalma (title/sub/
 * desc/type) eltér. A flageket a node-okra IS ráírja (megjelenítéshez) —
 * a meglévő diff_note-ot megtartva.
 */
export function computeDiff(current: ProcessNode[], original: ProcessNode[]): GraphDiff {
  const origById = new Map(original.map((n) => [n.id, n]));
  let added = 0;
  let modified = 0;
  for (const n of current) {
    const o = origById.get(n.id);
    if (!o) {
      n.diff = "new";
      added++;
    } else if (o.title !== n.title || (o.sub ?? "") !== (n.sub ?? "") || o.desc !== n.desc || o.type !== n.type) {
      n.diff = "mod";
      modified++;
    } else {
      n.diff = null;
    }
  }
  return {
    originalCount: original.length,
    currentCount: current.length,
    added,
    modified,
  };
}

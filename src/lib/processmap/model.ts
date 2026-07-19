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
  ai_intervention: { c: "#1F5AE8", bg: "#EAF1FE", line: "#BED0F8", fg: "#1E52D4", labelKey: "ai_intervention", shape: "card" },
  control_hitl: { c: "#B4801E", bg: "#FBF3E0", line: "#E6D2A0", fg: "#9A6A12", labelKey: "control_hitl", shape: "card" },
};

/** Stílus-feloldás fallback-kel — ismeretlen típus nem töri el a renderert. */
export function styleOf(type: string): NodeTypeStyle {
  return NODE_TYPE_STYLES[type] ?? { ...NEUTRAL, labelKey: "unknown" };
}

// ── Elágazó 2D-layout (a Task04 mintája, automatikusan számolva) ──
//
// A generálás TOPOLÓGIÁT ad (lépések + next-élek); a layouter réteges
// (Sugiyama-szerű) elrendezést számol, hogy a döntések ágai TÉRBEN
// szétváljanak — nem kézzel megadott koordinátákból, hanem tetszőleges
// generált folyamatra:
//   1) visszaél-detekció (DFS) → a kör megtörik a rétegezéshez;
//   2) réteg (Y): leghosszabb út a gyökerekből az előre-éleken;
//   3) sáv (X): a gyerekek szimmetrikusan szétnyílnak a szülő körül, a
//      merge-node a szülők sáv-átlaga (középre húz), rétegenként ütközés-
//      feloldással (min. 1 sáv rés);
//   4) derékszögű él-útvonalak oldal-horgonyokkal + köztes pontokkal
//      (döntés → oldalág; merge → alsó könyök; visszaél → felső kerülő).
// A layout a TÁROLT node/edge adatból számol — a meglévő térképek
// újrarajzolhatók újragenerálás nélkül.

export const WORLD_W = 1400; // örökölt fit-alapérték; a tényleges szélesség: worldWidth()

const LANE_UNIT = 430; // vízszintes távolság két szomszédos sáv között (px)
const ROW_GAP = 96; // függőleges rés két réteg között (px)
const TOP_Y = 80;
const MARGIN_X = 240; // bal/jobb margó (a legszélesebb node fél-szélessége + tartalék)
const BACK_UP = 66; // visszaél kerülő-magassága a cél teteje felett

function sizeOf(node: Pick<ProcessNode, "type" | "title">): { w: number; h: number } {
  const shape = styleOf(node.type).shape;
  if (shape === "diamond") return { w: 190, h: 190 };
  if (shape === "pill") return { w: Math.max(280, Math.min(340, node.title.length * 11 + 120)), h: 64 };
  return { w: Math.max(300, Math.min(340, node.title.length * 9 + 140)), h: 92 };
}

/**
 * Pozíciók + él-geometria hozzárendelése a topológiához. A bemeneti nodes
 * x/y/w/h értékét felülírja; az edges fs/ts/via mezőit tölti. Tiszta függvény;
 * determinisztikus (bemeneti node/edge-sorrend adja a döntetlen-feloldást).
 */
export function layoutGraph(nodes: ProcessNode[], edges: ProcessEdge[]): ProcessGraph {
  if (nodes.length === 0) return { nodes: [], edges: [] };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outOf = new Map<string, ProcessEdge[]>();
  const inOf = new Map<string, ProcessEdge[]>();
  for (const n of nodes) {
    outOf.set(n.id, []);
    inOf.set(n.id, []);
  }
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    outOf.get(e.from)!.push(e);
    inOf.get(e.to)!.push(e);
  }

  // 1) Visszaél-detekció (DFS szín-jelöléssel) — a kör megtörése a rétegezéshez.
  const backEdges = new Set<ProcessEdge>();
  {
    const color = new Map<string, number>(nodes.map((n) => [n.id, 0])); // 0 fehér, 1 szürke, 2 fekete
    const visitFrom = (s: string) => {
      const stack: { id: string; i: number }[] = [{ id: s, i: 0 }];
      color.set(s, 1);
      while (stack.length) {
        const top = stack[stack.length - 1];
        const es = outOf.get(top.id)!;
        if (top.i >= es.length) {
          color.set(top.id, 2);
          stack.pop();
          continue;
        }
        const e = es[top.i++];
        const c = color.get(e.to);
        if (c === 1) backEdges.add(e); // vissza egy stackben lévő node-ra → visszaél (kör)
        else if (c === 0) {
          color.set(e.to, 1);
          stack.push({ id: e.to, i: 0 });
        }
      }
    };
    const rootIds = nodes.filter((n) => inOf.get(n.id)!.length === 0).map((n) => n.id);
    for (const s of rootIds.length ? rootIds : [nodes[0].id]) if (color.get(s) === 0) visitFrom(s);
    for (const n of nodes) if (color.get(n.id) === 0) visitFrom(n.id); // körben rekedt / izolált
  }
  const fwdOut = (id: string) => outOf.get(id)!.filter((e) => !backEdges.has(e));
  const fwdIn = (id: string) => inOf.get(id)!.filter((e) => !backEdges.has(e));

  // 2) Réteg (Y): leghosszabb út a gyökerekből az előre-éleken (Kahn + longest-path).
  const layer = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, fwdIn(n.id).length]));
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi];
    for (const e of fwdOut(id)) {
      if (layer.get(id)! + 1 > layer.get(e.to)!) layer.set(e.to, layer.get(id)! + 1);
      indeg.set(e.to, indeg.get(e.to)! - 1);
      if (indeg.get(e.to) === 0) queue.push(e.to);
    }
  }
  const maxLayer = Math.max(...nodes.map((n) => layer.get(n.id)!));

  // 3) DFS-sorrend (bal→jobb rendezés az ütközés-feloldás döntetlenéhez).
  const order = new Map<string, number>();
  {
    let idx = 0;
    const seen = new Set<string>();
    const dfs = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      order.set(id, idx++);
      for (const e of fwdOut(id)) dfs(e.to);
    };
    const rootIds = nodes.filter((n) => fwdIn(n.id).length === 0).map((n) => n.id);
    (rootIds.length ? rootIds : [nodes[0].id]).forEach(dfs);
    for (const n of nodes)
      if (!seen.has(n.id)) {
        seen.add(n.id);
        order.set(n.id, idx++);
      }
  }

  // 4) Sáv (X): rétegenként fentről lefelé — a gyerekek szimmetrikusan
  //    szétnyílnak a szülő körül; a merge a szülők átlaga; majd ütközés-feloldás.
  const lane = new Map<string, number>();
  const rows: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const n of nodes) rows[layer.get(n.id)!].push(n.id);
  for (let L = 0; L <= maxLayer; L++) {
    const row = rows[L];
    for (const id of row) {
      const parents = fwdIn(id);
      if (parents.length === 0) {
        lane.set(id, 0);
        continue;
      }
      let sum = 0;
      for (const e of parents) {
        const kids = fwdOut(e.from);
        const k = kids.indexOf(e);
        const offset = k - (kids.length - 1) / 2; // 1 gyerek→0, 2→∓0.5, 3→−1,0,+1
        sum += (lane.get(e.from) ?? 0) + offset;
      }
      lane.set(id, sum / parents.length);
    }
    if (row.length > 1) {
      const meanBefore = row.reduce((a, id) => a + lane.get(id)!, 0) / row.length;
      const sorted = [...row].sort(
        (a, b) => lane.get(a)! - lane.get(b)! || order.get(a)! - order.get(b)!,
      );
      for (let i = 1; i < sorted.length; i++) {
        const min = lane.get(sorted[i - 1])! + 1;
        if (lane.get(sorted[i])! < min) lane.set(sorted[i], min);
      }
      const meanAfter = sorted.reduce((a, id) => a + lane.get(id)!, 0) / sorted.length;
      const shift = meanBefore - meanAfter;
      if (shift !== 0) for (const id of sorted) lane.set(id, lane.get(id)! + shift);
    }
  }

  // 5) Sáv → X (nem-negatív), réteg → Y (kumulatív sor-magasság).
  const minLane = Math.min(...nodes.map((n) => lane.get(n.id)!));
  const rowH = rows.map((row) => Math.max(0, ...row.map((id) => sizeOf(byId.get(id)!).h)));
  const rowY: number[] = [];
  {
    let y = TOP_Y;
    for (let L = 0; L <= maxLayer; L++) {
      rowY.push(y + rowH[L] / 2);
      y += rowH[L] + ROW_GAP;
    }
  }
  for (const n of nodes) {
    const s = sizeOf(n);
    n.w = s.w;
    n.h = s.h;
    n.x = MARGIN_X + (lane.get(n.id)! - minLane) * LANE_UNIT;
    n.y = rowY[layer.get(n.id)!];
  }

  // 6) Él-geometria: oldal-horgonyok + derékszögű köztes pontok.
  for (const e of edges) {
    const s = byId.get(e.from);
    const t = byId.get(e.to);
    if (!s || !t) continue;
    if (backEdges.has(e)) {
      // Visszaél (kör): felül ki, a cél teteje fölé, majd be a cél tetejére.
      const upY = Math.min(s.y - s.h / 2, t.y - t.h / 2) - BACK_UP;
      e.fs = "top";
      e.ts = "top";
      e.via = [
        [s.x, upY],
        [t.x, upY],
      ];
    } else if (Math.abs(s.x - t.x) < 1) {
      // Azonos sáv: egyenes lefelé.
      e.fs = "bottom";
      e.ts = "top";
      e.via = [];
    } else if (styleOf(s.type).shape === "diamond") {
      // Döntés ága: oldalról ki, vízszintesen a cél oszlopig, majd le.
      e.fs = t.x < s.x ? "left" : "right";
      e.ts = "top";
      e.via = [[t.x, s.y]];
    } else {
      // Egyéb (pl. összefutás): alul ki, félmagasságban átlép a cél oszlopba.
      const my = (s.y + s.h / 2 + (t.y - t.h / 2)) / 2;
      e.fs = "bottom";
      e.ts = "top";
      e.via = [
        [s.x, my],
        [t.x, my],
      ];
    }
  }
  return { nodes, edges };
}

/** A világ magassága (kamera-fit-hez). */
export function worldHeight(nodes: ProcessNode[]): number {
  if (nodes.length === 0) return 800;
  return Math.max(...nodes.map((n) => n.y + n.h / 2)) + 120;
}

/** A világ szélessége (kamera-fit-hez) — az elágazó layout dinamikus szélessége. */
export function worldWidth(nodes: ProcessNode[]): number {
  if (nodes.length === 0) return WORLD_W;
  return Math.max(900, Math.max(...nodes.map((n) => n.x + n.w / 2)) + MARGIN_X);
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

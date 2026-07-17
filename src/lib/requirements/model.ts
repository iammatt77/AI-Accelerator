// ─────────────────────────────────────────────────────────────
// Követelmény-modul (#11) — tiszta modell (nincs React/DB):
// display_id-képzés, fa-építés, lineage, származtatott jelzések
// (AC-/story-számok, lefedettség). A "közös AC" elve: az AC a
// requirementen él, a story a requirement→story kötésen át LÁTJA —
// itt ezért nincs AC-másoló segéd, csak kötés-feloldó.
// ─────────────────────────────────────────────────────────────

import type {
  AcceptanceCriterionRow,
  Moscow,
  RequirementLevel,
  RequirementRow,
  RequirementStoryRow,
  RequirementSubtype,
  UserStoryRow,
} from "@/lib/db/types";

/** A felhasználó-facing azonosító prefixe — szint (+ altípus) szerint. */
export function displayPrefix(
  level: RequirementLevel,
  subtype: RequirementSubtype | null,
): "BR" | "SR" | "SYS" | "NFR" {
  if (level === "business") return "BR";
  if (level === "stakeholder") return "SR";
  return subtype === "non_functional" ? "NFR" : "SYS";
}

/**
 * Következő szabad display_id-k egy prefixhez (BR-01, BR-02, …) — a meglévő
 * azonosítókból a legnagyobb sorszám után folytat, kétjegyű paddel.
 */
export function nextDisplayIds(existing: string[], prefix: string, count: number): string[] {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const d of existing) {
    const m = re.exec(d);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return Array.from({ length: count }, (_, i) => `${prefix}-${String(max + i + 1).padStart(2, "0")}`);
}

export const MOSCOW_ORDER: Moscow[] = ["must", "should", "could", "wont"];

/** Rendezés: MoSCoW-súly (must elöl), a kitöltetlen (emberi ítéletre váró) középre-hátra. */
export function moscowRank(m: Moscow | null): number {
  if (m === null) return 2.5;
  return MOSCOW_ORDER.indexOf(m);
}

// ── Fa + lineage ─────────────────────────────────────────────

export interface RequirementTree {
  byId: Map<string, RequirementRow>;
  children: Map<string, RequirementRow[]>;
  roots: RequirementRow[];
}

export function buildTree(rows: RequirementRow[]): RequirementTree {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const children = new Map<string, RequirementRow[]>();
  const roots: RequirementRow[] = [];
  for (const r of rows) {
    if (r.parent_id && byId.has(r.parent_id)) {
      const list = children.get(r.parent_id) ?? [];
      list.push(r);
      children.set(r.parent_id, list);
    } else {
      roots.push(r);
    }
  }
  return { byId, children, roots };
}

/** A lebontási lánc gyökértől az adott elemig (BR → SR → SYS). Kör ellen védett. */
export function lineageOf(req: RequirementRow, byId: Map<string, RequirementRow>): RequirementRow[] {
  const chain: RequirementRow[] = [req];
  const seen = new Set<string>([req.id]);
  let cur = req;
  while (cur.parent_id) {
    const parent = byId.get(cur.parent_id);
    if (!parent || seen.has(parent.id)) break;
    chain.unshift(parent);
    seen.add(parent.id);
    cur = parent;
  }
  return chain;
}

// ── Származtatott jelzések (nem fabrikált — a kötésekből számolt) ──

export interface ReqIndicators {
  acCount: number;
  storyCount: number;
  /** Az al-fa (közvetlen gyerekek) száma — a „↓ N …" jelzéshez. */
  childCount: number;
}

export function reqIndicators(
  req: RequirementRow,
  acs: AcceptanceCriterionRow[],
  links: RequirementStoryRow[],
  tree: RequirementTree,
): ReqIndicators {
  return {
    acCount: acs.filter((a) => a.requirement_id === req.id).length,
    storyCount: links.filter((l) => l.requirement_id === req.id).length,
    childCount: (tree.children.get(req.id) ?? []).length,
  };
}

/** A story által lefedett requirementek (N:M, a kötésből). */
export function coveredRequirements(
  storyId: string,
  links: RequirementStoryRow[],
  byId: Map<string, RequirementRow>,
): RequirementRow[] {
  return links
    .filter((l) => l.story_id === storyId)
    .map((l) => byId.get(l.requirement_id))
    .filter((r): r is RequirementRow => r !== undefined);
}

/** A requirementet megvalósító story-k (N:M, a kötésből). */
export function implementingStories(
  requirementId: string,
  links: RequirementStoryRow[],
  storyById: Map<string, UserStoryRow>,
): UserStoryRow[] {
  return links
    .filter((l) => l.requirement_id === requirementId)
    .map((l) => storyById.get(l.story_id))
    .filter((s): s is UserStoryRow => s !== undefined);
}

/**
 * A story-nál megjelenő KÖZÖS AC-k: a lefedett requirement(ek) AC-i a
 * kötésen át — NEM másolat; ugyanazok a rekordok, requirement-címkével.
 */
export function inheritedAcs(
  storyId: string,
  links: RequirementStoryRow[],
  acs: AcceptanceCriterionRow[],
  byId: Map<string, RequirementRow>,
): { ac: AcceptanceCriterionRow; requirement: RequirementRow }[] {
  const reqIds = links.filter((l) => l.story_id === storyId).map((l) => l.requirement_id);
  const out: { ac: AcceptanceCriterionRow; requirement: RequirementRow }[] = [];
  for (const rid of reqIds) {
    const req = byId.get(rid);
    if (!req) continue;
    for (const ac of acs.filter((a) => a.requirement_id === rid).sort((a, b) => a.ord - b.ord)) {
      out.push({ ac, requirement: req });
    }
  }
  return out;
}

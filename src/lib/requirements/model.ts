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
// ── Lineage-sorok (BA-nézet swimlane-rendezés, tiszta deriváció) ──
// Minden business requirement EGY sort képez a teljes leszármazott-láncával:
// a közvetlen stakeholder-gyerekek, és azok system/NFR unokái. NEM új tábla,
// NEM migráció — a meglévő parent_id-láncból származtatva. A szigorú fa melletti
// adatintegritási hibát (ős-vesztett elem) egy záró gyűjtő-sor fogadja be, hogy
// a nézet ne omoljon össze.

export interface LineageRowStakeholder {
  requirement: RequirementRow;
  /** A stakeholder-igény system/NFR gyerekei (saját sorrendjükben). */
  systems: RequirementRow[];
}

export interface LineageRow {
  /** React-kulcs: a business req id-ja, vagy a gyűjtő-sor szentinelje. */
  key: string;
  /** A sor business requirementje; null CSAK a záró gyűjtő-sornál. */
  business: RequirementRow | null;
  stakeholders: LineageRowStakeholder[];
  /** Stakeholder-szülő nélküli system/NFR elemek (csak a gyűjtő-sorban). */
  looseSystems: RequirementRow[];
}

export const ORPHAN_ROW_KEY = "__orphan__";

/**
 * A BA-nézet swimlane-sorai: business-requirementenként egy sor, a teljes
 * leszármazott-lánccal. A sorrend a business-requirementek megjelenési
 * sorrendje; a soron belül a leszármazottak a saját sorrendjükben. A
 * feloldhatatlan ősű elemeket egy záró gyűjtő-sor fogadja be (defenzív;
 * a szigorú fa mellett nem kellene előfordulnia).
 */
export function buildLineageRows(rows: RequirementRow[]): LineageRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));

  const rowByBiz = new Map<string, LineageRow>();
  const businessRows: LineageRow[] = [];
  for (const r of rows) {
    if (r.level === "business") {
      const row: LineageRow = { key: r.id, business: r, stakeholders: [], looseSystems: [] };
      rowByBiz.set(r.id, row);
      businessRows.push(row);
    }
  }

  const orphan: LineageRow = {
    key: ORPHAN_ROW_KEY,
    business: null,
    stakeholders: [],
    looseSystems: [],
  };

  // Stakeholder-szint → a business-szülő sorába, egyébként a gyűjtő-sorba.
  const shEntryById = new Map<string, LineageRowStakeholder>();
  for (const r of rows) {
    if (r.level !== "stakeholder") continue;
    const parent = r.parent_id ? byId.get(r.parent_id) : undefined;
    const host = parent && parent.level === "business" ? rowByBiz.get(parent.id)! : orphan;
    const entry: LineageRowStakeholder = { requirement: r, systems: [] };
    host.stakeholders.push(entry);
    shEntryById.set(r.id, entry);
  }

  // System-szint → a stakeholder-szülő alá; szülő nélkül a gyűjtő-sor looseSystems-be.
  for (const r of rows) {
    if (r.level !== "system") continue;
    const parent = r.parent_id ? byId.get(r.parent_id) : undefined;
    const entry = parent && parent.level === "stakeholder" ? shEntryById.get(parent.id) : undefined;
    if (entry) entry.systems.push(r);
    else orphan.looseSystems.push(r);
  }

  const out = [...businessRows];
  if (orphan.stakeholders.length > 0 || orphan.looseSystems.length > 0) out.push(orphan);
  return out;
}

/** Egy sor összes system/NFR eleme (a stakeholder-gyerekek unokái + a laza elemek). */
export function rowSystems(row: LineageRow): RequirementRow[] {
  return [...row.stakeholders.flatMap((s) => s.systems), ...row.looseSystems];
}

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

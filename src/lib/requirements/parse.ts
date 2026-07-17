// ─────────────────────────────────────────────────────────────
// Követelmény-modul (#11) — defenzív parse: az LLM javaslat-JSON-jai →
// típusos javaslatok. A parse SOSEM dob rossz alak miatt: az érvénytelen
// elemeket kihagyja, az értékeket koercionálja (a #6-fix elvei szerint).
// A MoSCoW-t NEM defaultolja: ha az LLM nem adott (nincs alap), null marad
// — emberi ítélet (HITL).
// ─────────────────────────────────────────────────────────────

import { stripCodeFences } from "@/lib/llm/parse";
import type { Moscow, RequirementLevel, RequirementSubtype } from "@/lib/db/types";

const LEVELS: RequirementLevel[] = ["business", "stakeholder", "system"];
const SUBTYPES: RequirementSubtype[] = ["functional", "non_functional"];
const MOSCOWS: Moscow[] = ["must", "should", "could", "wont"];

function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function moscowOrNull(v: unknown): Moscow | null {
  const s = str(v).toLowerCase().replace("'", "");
  return (MOSCOWS as string[]).includes(s) ? (s as Moscow) : null;
}

function indices(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "number" ? Math.trunc(x) : parseInt(str(x), 10)))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function names(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(str).filter((s) => s.length > 0);
}

// ── Requirement-fa javaslat ──────────────────────────────────

export interface RequirementProposal {
  tmp: string;
  level: RequirementLevel;
  subtype: RequirementSubtype | null;
  parentTmp: string | null;
  text: string;
  /** null = az AI-nak nem volt alapja — emberi ítélet tölti. */
  moscow: Moscow | null;
  sourceIndices: number[];
  /** Stakeholder-szintnél: a hivatkozott érintett(ek) neve (a #8 entitásra kötjük). */
  stakeholderNames: string[];
}

/**
 * A fa-javaslat parse-a. Érvénytelen szint → kihagyva; subtype csak system
 * szinten marad meg (system + hiányzó altípus → functional); ismeretlen
 * parent_tmp → gyökér (nem dob). A tmp-duplikátum egyedivé tett.
 */
export function parseRequirementProposals(raw: string): RequirementProposal[] {
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFences(raw));
  } catch {
    return [];
  }
  if (!json || typeof json !== "object") return [];
  const list = (json as Record<string, unknown>).requirements;
  if (!Array.isArray(list)) return [];

  const out: RequirementProposal[] = [];
  const seen = new Set<string>();
  list.forEach((item, i) => {
    if (!item || typeof item !== "object") return;
    const o = item as Record<string, unknown>;
    const text = str(o.text);
    const level = str(o.level).toLowerCase() as RequirementLevel;
    if (!text || !LEVELS.includes(level)) return;
    let tmp = str(o.tmp) || `r${i + 1}`;
    while (seen.has(tmp)) tmp = `${tmp}_x`;
    seen.add(tmp);
    const rawSub = str(o.subtype).toLowerCase() as RequirementSubtype;
    const subtype: RequirementSubtype | null =
      level === "system" ? (SUBTYPES.includes(rawSub) ? rawSub : "functional") : null;
    out.push({
      tmp,
      level,
      subtype,
      parentTmp: str(o.parent_tmp) || null,
      text,
      moscow: moscowOrNull(o.moscow),
      sourceIndices: indices(o.source_indices),
      stakeholderNames: names(o.stakeholder_names),
    });
  });
  // ismeretlen parent → gyökér
  const tmps = new Set(out.map((r) => r.tmp));
  for (const r of out) {
    if (r.parentTmp && !tmps.has(r.parentTmp)) r.parentTmp = null;
  }
  return out;
}

// ── Story-javaslat (epic-csomagolással, N:M coverage-dzsel) ──

export interface EpicProposal {
  tmp: string;
  title: string;
  /** A kapcsolt business requirement display_id-je (pl. BR-01) — ha van. */
  businessDisplayId: string | null;
}

export interface StoryProposal {
  tmp: string;
  epicTmp: string | null;
  role: string;
  want: string;
  soThat: string;
  moscow: Moscow | null;
  /** A lefedett SYSTEM requirementek display_id-i — ebből lesz az N:M kötés. */
  coversDisplayIds: string[];
  sourceIndices: number[];
}

export interface StoryPackage {
  epics: EpicProposal[];
  stories: StoryProposal[];
}

export function parseStoryPackage(raw: string): StoryPackage {
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFences(raw));
  } catch {
    return { epics: [], stories: [] };
  }
  if (!json || typeof json !== "object") return { epics: [], stories: [] };
  const o = json as Record<string, unknown>;

  const epics: EpicProposal[] = [];
  const seenE = new Set<string>();
  (Array.isArray(o.epics) ? o.epics : []).forEach((item, i) => {
    if (!item || typeof item !== "object") return;
    const e = item as Record<string, unknown>;
    const title = str(e.title);
    if (!title) return;
    let tmp = str(e.tmp) || `e${i + 1}`;
    while (seenE.has(tmp)) tmp = `${tmp}_x`;
    seenE.add(tmp);
    epics.push({ tmp, title, businessDisplayId: str(e.business_display_id) || null });
  });

  const stories: StoryProposal[] = [];
  const seenS = new Set<string>();
  (Array.isArray(o.stories) ? o.stories : []).forEach((item, i) => {
    if (!item || typeof item !== "object") return;
    const s = item as Record<string, unknown>;
    const role = str(s.role);
    const want = str(s.want);
    if (!role || !want) return;
    let tmp = str(s.tmp) || `s${i + 1}`;
    while (seenS.has(tmp)) tmp = `${tmp}_x`;
    seenS.add(tmp);
    const epicTmp = str(s.epic_tmp) || null;
    stories.push({
      tmp,
      epicTmp: epicTmp && seenE.has(epicTmp) ? epicTmp : null,
      role,
      want,
      soThat: str(s.so_that),
      moscow: moscowOrNull(s.moscow),
      coversDisplayIds: names(s.covers_display_ids),
      sourceIndices: indices(s.source_indices),
    });
  });
  return { epics, stories };
}

// ── AC-vázlat (a requirement-részlet ✦ kitöltéséhez — az ember dönt) ──

export interface AcDraft {
  title: string;
  given: string;
  when: string;
  then: string;
}

export function parseAcDrafts(raw: string): AcDraft[] {
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFences(raw));
  } catch {
    return [];
  }
  if (!json || typeof json !== "object") return [];
  const list = (json as Record<string, unknown>).acs;
  if (!Array.isArray(list)) return [];
  const out: AcDraft[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const given = str(o.given);
    const when = str(o.when);
    const then = str(o.then);
    if (!given || !when || !then) continue;
    out.push({ title: str(o.title) || "AC", given, when, then });
  }
  return out;
}

// ── Story-vázlat (a származtatás-panel ✦ kitöltéséhez) ───────

export interface StoryDraft {
  role: string;
  want: string;
  soThat: string;
  epicTitle: string | null;
}

export function parseStoryDraft(raw: string): StoryDraft | null {
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFences(raw));
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const role = str(o.role);
  const want = str(o.want);
  if (!role || !want) return null;
  return { role, want, soThat: str(o.so_that), epicTitle: str(o.epic_title) || null };
}

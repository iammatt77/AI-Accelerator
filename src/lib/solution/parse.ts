// ─────────────────────────────────────────────────────────────
// Megoldási opció-összevető (#12) — defenzív LLM-parse (a #6-fix elvei:
// koerció, érvénytelen elem kihagyva, SOSEM dob). A c-minta itt kritikus:
// a hiányzó szempont-érték KIMARAD (üres cella), nem fabrikált.
// ─────────────────────────────────────────────────────────────

import { stripCodeFences } from "@/lib/llm/parse";
import type { ComponentType, CriterionValue } from "@/lib/db/types";

function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

const COMPONENT_TYPES: ComponentType[] = ["process", "infrastructure", "personnel"];

export interface ComponentProposal {
  type: ComponentType;
  name: string;
  description: string;
  /** A TO-BE node-id-k, amikhez köt (a megadott listából; lehet üres). */
  step_ids: string[];
  source_indices: number[];
}

/**
 * Komponens-javaslatok parse-a. Csak a megadott node-id-készletből fogad
 * kötést (ismeretlen id kiesik — nem fabrikálunk lépést).
 */
export function parseComponentProposals(raw: string, validNodeIds: Set<string>): ComponentProposal[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(raw));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const list = (parsed as Record<string, unknown>).components;
  if (!Array.isArray(list)) return [];
  const out: ComponentProposal[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const type = str(o.type) as ComponentType;
    const name = str(o.name);
    if (!name || !COMPONENT_TYPES.includes(type)) continue;
    const stepIds = (Array.isArray(o.step_ids) ? o.step_ids : [])
      .map(str)
      .filter((id) => id && validNodeIds.has(id));
    const sourceIndices = (Array.isArray(o.source_indices) ? o.source_indices : [])
      .map((n) => (typeof n === "number" ? Math.trunc(n) : parseInt(str(n), 10)))
      .filter((n) => Number.isFinite(n) && n >= 1);
    out.push({
      type,
      name,
      description: str(o.description),
      // folyamat-komponens legfeljebb EGY lépéshez dokkol
      step_ids: type === "process" ? stepIds.slice(0, 1) : [...new Set(stepIds)],
      source_indices: [...new Set(sourceIndices)],
    });
  }
  return out;
}

export interface OptionProposal {
  name: string;
  description: string;
  /** ✦ AI AJÁNLJA — ajánlás, sosem választás; legfeljebb egy opción. */
  recommended: boolean;
  criteria: Record<string, CriterionValue>;
}

/** Szempont-cellák parse-a: üres érték → a kulcs KIMARAD (c-minta). */
function criteriaFrom(raw: unknown): Record<string, CriterionValue> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, CriterionValue> = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!key.trim()) continue;
    if (typeof v === "string") {
      if (v.trim()) out[key.trim()] = { value: v.trim() };
      continue;
    }
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const value = str(o.value);
    const note = str(o.note);
    const label = str(o.label);
    if (!value && !note) continue; // nincs alap → üres cella, nem fabrikálunk
    out[key.trim()] = {
      value,
      ...(note ? { note } : {}),
      ...(label ? { label } : {}),
    };
  }
  return out;
}

/** Opció-javaslatok parse-a; legfeljebb egy recommended (az első nyer). */
export function parseOptionProposals(raw: string): OptionProposal[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(raw));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const list = (parsed as Record<string, unknown>).options;
  if (!Array.isArray(list)) return [];
  const out: OptionProposal[] = [];
  let recommendedSeen = false;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = str(o.name);
    if (!name) continue;
    let recommended = o.recommended === true;
    if (recommended && recommendedSeen) recommended = false;
    if (recommended) recommendedSeen = true;
    out.push({
      name,
      description: str(o.description),
      recommended,
      criteria: criteriaFrom(o.criteria),
    });
  }
  return out;
}

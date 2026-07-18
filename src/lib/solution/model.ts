// ─────────────────────────────────────────────────────────────
// Megoldási opció-összevető (#12) — tiszta modell (nincs React/DB):
// a jóváhagyott TO-BE gerinc feloldása, komponens↔lépés kötés-feloldók,
// lefedettség, szempont-készlet, nyertes-feloldás, kész-számláló.
//
// A kötés elve: a TO-BE lépések a process_maps jsonb node-jai — a kötés a
// node STABIL `id`-jára hivatkozik (parse dedupol, chat/verzió megőrzi).
// A render a mindenkori jóváhagyott TO-BE node_id-jaira illeszt; az elárvult
// kötés (a node már nincs a jóváhagyott térképen) egyszerűen nem illeszkedik
// — nem dob hibát, nem fabrikál lépést.
// ─────────────────────────────────────────────────────────────

import { graphFromJson } from "@/lib/processmap/parse";
import type {
  ComponentOptionRow,
  ComponentStepLinkRow,
  CriterionValue,
  ProcessMapRow,
  SolutionComponentRow,
} from "@/lib/db/types";

// ── Szempont-készlet (bővíthető) ─────────────────────────────
// Az alap-készlet kulcsai i18n-feliratot kapnak (solution.criteria.*);
// az egyedi szempont a criteria_values-ban hordozza a saját label-jét.

export const BASE_CRITERIA = ["cost", "lead_time", "risk", "data_need", "fit"] as const;
export type BaseCriterion = (typeof BASE_CRITERIA)[number];

/** Defenzív parse: a criteria_values jsonb → kulcs → { value, note, label }. */
export function parseCriteriaValues(raw: unknown): Record<string, CriterionValue> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, CriterionValue> = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!key) continue;
    if (typeof v === "string") {
      if (v.trim()) out[key] = { value: v.trim() };
      continue;
    }
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const value = typeof o.value === "string" ? o.value.trim() : "";
    const note = typeof o.note === "string" && o.note.trim() ? o.note.trim() : undefined;
    const label = typeof o.label === "string" && o.label.trim() ? o.label.trim() : undefined;
    // üres érték de van note/label → tartsuk meg (a cella „nincs megadva" + jegyzet)
    if (value || note || label) out[key] = { value, note, label };
  }
  return out;
}

/**
 * A mátrix sor-kulcsai: az ALAP-készlet mindig (üres cella = „nincs
 * megadva"), plusz az opciókban előforduló egyedi kulcsok, első előfordulás
 * szerinti sorrendben.
 */
export function criteriaKeysOf(options: ComponentOptionRow[]): string[] {
  const keys: string[] = [...BASE_CRITERIA];
  const seen = new Set<string>(keys);
  for (const o of options) {
    for (const k of Object.keys(parseCriteriaValues(o.criteria_values))) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  return keys;
}

/** Az egyedi szempont felirata az opciókból (az első, amelyik hordozza). */
export function customCriterionLabel(options: ComponentOptionRow[], key: string): string | null {
  for (const o of options) {
    const label = parseCriteriaValues(o.criteria_values)[key]?.label;
    if (label) return label;
  }
  return null;
}

// ── A jóváhagyott TO-BE gerinc ───────────────────────────────

export interface SpineStep {
  nodeId: string;
  /** 1-alapú sorszám a tárolt node-sorrendben. */
  ord: number;
  /** Kétjegyű felirat: „01", „02", … */
  num: string;
  title: string;
  type: string;
}

/** A projekt jóváhagyott TO-BE térképe (legmagasabb verzió), vagy null. */
export function resolveApprovedToBe(maps: ProcessMapRow[]): ProcessMapRow | null {
  const approved = maps
    .filter((m) => m.kind === "to_be" && m.status === "approved")
    .sort((a, b) => b.version - a.version);
  return approved[0] ?? null;
}

/** A gerinc lépései a térkép jsonb-jéből, a tárolt node-sorrendben. */
export function spineFromMap(map: ProcessMapRow): SpineStep[] {
  const graph = graphFromJson(map.nodes, map.edges);
  return graph.nodes.map((n, i) => ({
    nodeId: n.id,
    ord: i + 1,
    num: String(i + 1).padStart(2, "0"),
    title: n.title,
    type: n.type,
  }));
}

// ── Kötés-feloldók ───────────────────────────────────────────

/** Egy komponens kötött node-id-jai (a jóváhagyott térképre illesztve). */
export function linkedStepsOf(
  componentId: string,
  links: ComponentStepLinkRow[],
  steps: SpineStep[],
): SpineStep[] {
  const nodeIds = new Set(links.filter((l) => l.component_id === componentId).map((l) => l.node_id));
  return steps.filter((s) => nodeIds.has(s.nodeId));
}

/** Egy lépés alá dokkolt FOLYAMAT-komponensek (a tárolt sorrendben). */
export function dockedComponents(
  nodeId: string,
  components: SolutionComponentRow[],
  links: ComponentStepLinkRow[],
): SolutionComponentRow[] {
  const ids = new Set(links.filter((l) => l.node_id === nodeId).map((l) => l.component_id));
  return components.filter((c) => c.type === "process" && ids.has(c.id));
}

export interface Coverage {
  /** A fedett lépések sorszám-feliratai („02", „03" …). */
  nums: string[];
  /** Minden lépést fed (→ „átfogó · minden lépés"). */
  all: boolean;
  /** Összefüggő tartomány („02–03") — csak ha 2+ lépés és folytonos. */
  range: string | null;
}

/** Infra/személyi lefedettség a gerincen. */
export function coverageOf(
  componentId: string,
  links: ComponentStepLinkRow[],
  steps: SpineStep[],
): Coverage {
  const covered = linkedStepsOf(componentId, links, steps).sort((a, b) => a.ord - b.ord);
  const nums = covered.map((s) => s.num);
  const all = steps.length > 0 && covered.length === steps.length;
  let range: string | null = null;
  if (covered.length >= 2) {
    const contiguous = covered.every((s, i) => i === 0 || s.ord === covered[i - 1].ord + 1);
    if (contiguous) range = `${covered[0].num}–${covered[covered.length - 1].num}`;
  }
  return { nums, all, range };
}

// ── Opciók / kiválasztás ─────────────────────────────────────

/** A komponens opciói tárolt sorrendben (ord, majd created_at). */
export function optionsOf(componentId: string, options: ComponentOptionRow[]): ComponentOptionRow[] {
  return options
    .filter((o) => o.component_id === componentId)
    .sort((a, b) => a.ord - b.ord || a.created_at.localeCompare(b.created_at));
}

/** A nyertes opció (komponensenként legfeljebb egy — DB-kényszer). */
export function selectedOption(
  componentId: string,
  options: ComponentOptionRow[],
): ComponentOptionRow | undefined {
  return options.find((o) => o.component_id === componentId && o.is_selected);
}

export interface SolutionStats {
  total: number;
  done: number;
  /** Döntésre váró komponensek (nincs kiválasztott opció). */
  waiting: SolutionComponentRow[];
  aiSuggestedCount: number;
}

/** „N komponens · M döntés vár" + a figyelmeztetés-sor adatai. */
export function solutionStats(
  components: SolutionComponentRow[],
  options: ComponentOptionRow[],
): SolutionStats {
  const waiting = components.filter((c) => !selectedOption(c.id, options));
  return {
    total: components.length,
    done: components.length - waiting.length,
    waiting,
    aiSuggestedCount: components.filter((c) => c.state === "ai_suggested").length,
  };
}

// ─────────────────────────────────────────────────────────────
// P3 Megoldás-dokumentáció (#15) — defenzív LLM-parse (a #6-fix elvei:
// koerció, érvénytelen elem kihagyva, SOSEM dob). C-minta: kötést /
// eredetet CSAK ott javaslunk, ahol az LLM valós hivatkozást adott —
// ismeretlen display-id / node-id kiesik, semmi nem fabrikálódik.
// ─────────────────────────────────────────────────────────────

import { stripCodeFences } from "@/lib/llm/parse";
import { LAYER_TYPES, TARGET_TYPES } from "./model";
import type { BuildLayerType, ImplTargetType } from "@/lib/db/types";

function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function idxList(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((n) => (typeof n === "number" ? Math.trunc(n) : parseInt(str(n), 10)))
    .filter((n) => Number.isFinite(n) && n >= 1);
}

// ── Építési anyag → struktúra-javaslat (AC3, 7. jelenet CTA) ─

export interface PromptProposal {
  name: string;
  purpose: string;
  prompt_text: string;
}

export interface BuildComponentProposal {
  name: string;
  description: string;
  layer_type: BuildLayerType;
  /** 1-alapú index a P2 seed-jelölt listára — eredet-javaslat; null = nincs. */
  origin_index: number | null;
  prompts: PromptProposal[];
  source_indices: number[];
}

export interface ControlPointProposal {
  name: string;
  kind: "guardrail" | "hitl";
  description: string;
  /** TO-BE lépés 1-alapú sorszáma — csak érvényes hivatkozás marad (c-minta). */
  tobe_ord: number | null;
  source_indices: number[];
}

export interface BuildDocProposal {
  components: BuildComponentProposal[];
  controls: ControlPointProposal[];
}

/** Struktúra-javaslat parse-a. Név nélküli komponens/kontroll kiesik;
 *  érvénytelen réteg/típus kiesik; az origin_index csak 1..p2Count között
 *  marad meg (különben null — nem fabrikálunk eredetet). */
export function parseBuildDocProposal(raw: string, p2Count: number, tobeCount: number): BuildDocProposal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(raw));
  } catch {
    return { components: [], controls: [] };
  }
  if (!parsed || typeof parsed !== "object") return { components: [], controls: [] };
  const obj = parsed as Record<string, unknown>;

  const components: BuildComponentProposal[] = [];
  if (Array.isArray(obj.components)) {
    for (const c of obj.components) {
      if (!c || typeof c !== "object") continue;
      const co = c as Record<string, unknown>;
      const name = str(co.name);
      const layer = str(co.layer_type) as BuildLayerType;
      if (!name || !LAYER_TYPES.includes(layer)) continue;
      const originRaw =
        typeof co.origin_index === "number" ? Math.trunc(co.origin_index) : parseInt(str(co.origin_index), 10);
      const origin = Number.isFinite(originRaw) && originRaw >= 1 && originRaw <= p2Count ? originRaw : null;
      const prompts: PromptProposal[] = [];
      if (Array.isArray(co.prompts)) {
        for (const p of co.prompts) {
          if (!p || typeof p !== "object") continue;
          const po = p as Record<string, unknown>;
          const pName = str(po.name);
          if (!pName) continue;
          prompts.push({ name: pName, purpose: str(po.purpose), prompt_text: str(po.prompt_text) });
        }
      }
      components.push({
        name,
        description: str(co.description),
        layer_type: layer,
        origin_index: origin,
        prompts,
        source_indices: idxList(co.source_indices),
      });
    }
  }

  const controls: ControlPointProposal[] = [];
  if (Array.isArray(obj.controls)) {
    for (const c of obj.controls) {
      if (!c || typeof c !== "object") continue;
      const co = c as Record<string, unknown>;
      const name = str(co.name);
      const kind = str(co.kind);
      if (!name || (kind !== "guardrail" && kind !== "hitl")) continue;
      const ordRaw = typeof co.tobe_ord === "number" ? Math.trunc(co.tobe_ord) : parseInt(str(co.tobe_ord), 10);
      const tobe = Number.isFinite(ordRaw) && ordRaw >= 1 && ordRaw <= tobeCount ? ordRaw : null;
      controls.push({
        name,
        kind,
        description: str(co.description),
        tobe_ord: tobe,
        source_indices: idxList(co.source_indices),
      });
    }
  }
  return { components, controls };
}

// ── Megvalósítás-kötés javaslat (AC3, 2. jelenet ✦) ──────────

export interface ImplLinkSuggestion {
  target_type: ImplTargetType;
  /** A cél LABEL-je (SYS-nn / US-nn / TO-BE·nn / FP-nn) — a hívó oldja
   *  fel valós target_id-ra; ismeretlen label kiesik. */
  label: string;
}

/** Kötés-javaslatok parse-a. CSAK az érvényes label-készletben szereplő
 *  cél marad meg (c-minta: ismeretlen elemre nem fabrikálunk kötést). */
export function parseImplLinkSuggestions(raw: string, validLabels: Set<string>): ImplLinkSuggestion[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(raw));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const list = (parsed as Record<string, unknown>).links;
  if (!Array.isArray(list)) return [];
  const out: ImplLinkSuggestion[] = [];
  const seen = new Set<string>();
  for (const l of list) {
    if (!l || typeof l !== "object") continue;
    const lo = l as Record<string, unknown>;
    const type = str(lo.target_type) as ImplTargetType;
    const label = str(lo.label);
    if (!TARGET_TYPES.includes(type) || !label) continue;
    const key = `${type}:${label}`;
    if (!validLabels.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ target_type: type, label });
  }
  return out;
}

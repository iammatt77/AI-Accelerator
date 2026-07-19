import type {
  BuildComponentRow,
  BuildLayerType,
  ComponentOptionRow,
  ImplLinkRow,
  ImplTargetType,
  PainPointRow,
  RequirementRow,
  SolutionComponentRow,
  UserStoryRow,
} from "@/lib/db/types";
import type { SpineStep } from "@/lib/solution/model";

// ─────────────────────────────────────────────────────────────
// Megoldás-dokumentáció entitás-réteg (#15). A modul lelke a KÉT,
// elkülönített kötés-fajta: EREDET (P2-seed, 1-N) és MEGVALÓSÍTÁS
// (N:M, 4 cél-típus, kétirányú olvasat). A lefedettség PASSZÍV tükör:
// pontszám és hiány-analízis NINCS (non-goal) — csak a kötés hiányának
// jelzése. C-minta végig: alap nélkül semmi nem fabrikálódik.
// ─────────────────────────────────────────────────────────────

export const LAYER_TYPES: BuildLayerType[] = ["process", "infrastructure", "personnel"];
export const TARGET_TYPES: ImplTargetType[] = ["requirement", "story", "tobe_node", "pain_point"];
export const CONTROL_KINDS = ["guardrail", "hitl"] as const;

// ── P2-seed feloldás (AC1) ───────────────────────────────────

export interface SeedCandidate {
  component: SolutionComponentRow;
  /** A P2-ben EMBER által kiválasztott opció (HITL) — ha van. */
  selectedOption: ComponentOptionRow | null;
  /** A belőle már kinyert build-komponensek display_id-i (1-N). */
  extractedAs: string[];
}

/** A P2 opció-összevető kiválasztott komponensei seed-jelöltként.
 *  Elvetett P2-komponens nem jelölt; a már kinyertek jelölve (nem tiltás —
 *  1-N megengedett, a felület dönt a kiemelésről). */
export function seedCandidates(
  p2Components: SolutionComponentRow[],
  options: ComponentOptionRow[],
  buildComponents: BuildComponentRow[],
): SeedCandidate[] {
  const byComponent = new Map<string, ComponentOptionRow>();
  for (const o of options) {
    if (o.is_selected) byComponent.set(o.component_id, o);
  }
  return p2Components
    .filter((c) => c.state !== "rejected")
    .map((c) => ({
      component: c,
      selectedOption: byComponent.get(c.id) ?? null,
      extractedAs: buildComponents
        .filter((b) => b.origin_component_id === c.id)
        .map((b) => b.display_id)
        .sort(),
    }));
}

/** A K-nn eredet-felirata: P2-komponens neve vagy null (manuális). */
export function originLabel(
  component: BuildComponentRow,
  p2Components: SolutionComponentRow[],
): string | null {
  if (!component.origin_component_id) return null;
  return p2Components.find((c) => c.id === component.origin_component_id)?.name ?? null;
}

// ── Terv-elem címtár (a kötés-célok egységes nézete) ─────────

export interface PlanElement {
  targetType: ImplTargetType;
  targetId: string;
  /** Megjelenő azonosító: SYS-nn / US-nn / TO-BE·nn / FP-n. */
  label: string;
  title: string;
  /** MoSCoW / súlyosság — ahol van; máshol null (c-minta). */
  badge: string | null;
}

/** A 4 cél-típus terv-elemei egységes címtárban. A requirement-oldal CSAK
 *  a system-szint (a spec kötés-célja); story/fájdalompont a nem-elvetett
 *  sorok; TO-BE a JÓVÁHAGYOTT térkép lépései (stabil node-id). */
export function planElements(
  requirements: RequirementRow[],
  stories: UserStoryRow[],
  spine: SpineStep[],
  painPoints: PainPointRow[],
): PlanElement[] {
  const out: PlanElement[] = [];
  for (const r of requirements) {
    if (r.level !== "system" || r.state === "rejected") continue;
    out.push({
      targetType: "requirement",
      targetId: r.id,
      label: r.display_id,
      title: r.text,
      badge: r.moscow ? r.moscow.toUpperCase() : null,
    });
  }
  for (const s of stories) {
    if (s.state === "rejected") continue;
    out.push({
      targetType: "story",
      targetId: s.id,
      label: s.display_id,
      title: s.want,
      badge: s.moscow ? s.moscow.toUpperCase() : null,
    });
  }
  for (const step of spine) {
    out.push({
      targetType: "tobe_node",
      targetId: step.nodeId,
      label: `TO-BE·${step.num}`,
      title: step.title,
      badge: null,
    });
  }
  for (const [i, p] of painPoints.entries()) {
    if (p.state === "rejected") continue;
    out.push({
      targetType: "pain_point",
      targetId: p.id,
      label: `FP-${String(i + 1).padStart(2, "0")}`,
      title: p.title,
      badge: p.severity ? p.severity.toUpperCase() : null,
    });
  }
  return out;
}

export function elementIndex(elements: PlanElement[]): Map<string, PlanElement> {
  return new Map(elements.map((e) => [`${e.targetType}:${e.targetId}`, e]));
}

// ── Kétirányú kötés-olvasatok (AC2 + AC4) ────────────────────

/** Komponens → kötések, cél-típusonként csoportosítva (2. jelenet). */
export function linksOfComponent(
  componentId: string,
  links: ImplLinkRow[],
): Record<ImplTargetType, ImplLinkRow[]> {
  const grouped: Record<ImplTargetType, ImplLinkRow[]> = {
    requirement: [],
    story: [],
    tobe_node: [],
    pain_point: [],
  };
  for (const l of links) {
    if (l.component_id === componentId) grouped[l.target_type].push(l);
  }
  return grouped;
}

export interface CoverageRow {
  element: PlanElement;
  /** A FEDŐ komponensek — csak AKTÍV (nem ai_suggested) kötésen át. */
  components: BuildComponentRow[];
  /** ✦ függő AI-javaslatok száma az elemre (még nem aktív kötés). */
  suggestedCount: number;
}

/** Terv-elem → fedő komponensek (3. jelenet, PASSZÍV tükör). Az
 *  ai_suggested kötés még NEM fedés (E1: emberi megerősítésig nem aktív) —
 *  külön számlálóban jelezve. Üres lista = „nincs lefedő komponens". */
export function coverageRows(
  elements: PlanElement[],
  links: ImplLinkRow[],
  components: BuildComponentRow[],
): CoverageRow[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  return elements.map((element) => {
    const related = links.filter(
      (l) => l.target_type === element.targetType && l.target_id === element.targetId,
    );
    const active: BuildComponentRow[] = [];
    let suggested = 0;
    for (const l of related) {
      const c = byId.get(l.component_id);
      if (!c) continue;
      if (l.state === "ai_suggested" || c.state === "ai_suggested") {
        suggested += 1;
        continue;
      }
      active.push(c);
    }
    active.sort((a, b) => a.display_id.localeCompare(b.display_id));
    return { element, components: active, suggestedCount: suggested };
  });
}

/** Egy kötés cél-eleme a címtárból (hiányzó cél → null, a felület jelzi). */
export function resolveLink(
  link: ImplLinkRow,
  index: Map<string, PlanElement>,
): PlanElement | null {
  return index.get(`${link.target_type}:${link.target_id}`) ?? null;
}

// ── Rendezők ─────────────────────────────────────────────────

export function byDisplayId<T extends { display_id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.display_id.localeCompare(b.display_id));
}

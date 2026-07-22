import { getTypeDef, typesForPhase, type ArtifactTypeDef } from "@/lib/artifacts/config";
import type { PhaseId } from "./config";

// ─────────────────────────────────────────────────────────────
// Csomag B1 — fázis TOOL-készlet + kapu-navigációs cél.
// Tiszta modul (kliens és szerver is importálhatja). NINCS séma-változás:
// a tool-készlet és a kritérium→cél leképezés a meglévő konfigból derivált.
// ─────────────────────────────────────────────────────────────

/** Ahogy egy tool a tool-sávból „megnyílik":
 *  - route: átnavigál a tool önálló oldalára (a meglévő route-ok);
 *  - heatmap: a hőtérkép fókusz-mód modálja (P1, nincs önálló route);
 *  - zone: a fázis-munkaterület egy zónájára vált + görget (a tool önálló
 *    nézete még nem létezik — B3; addig a data-szerkesztő felületre visz). */
export type ToolOpenKind = "route" | "heatmap" | "zone";

export interface PhaseToolDef {
  id: string;
  /** i18n: tools.names.<key> */
  nameKey: string;
  /** i18n: tools.desc.<key> */
  descKey: string;
  open: ToolOpenKind;
  /** route: a tool relatív útvonala a projekt-bázishoz (`${base}${path}`). */
  path?: string;
  /** zone: melyik zónára vált (+ opcionális horgony). */
  zone?: string;
  anchor?: string;
  /** Kis jelvény a kártyán (pl. „AS-IS" / „TO-BE"). */
  badge?: string;
}

const HEATMAP: PhaseToolDef = {
  id: "heatmap",
  nameKey: "heatmap",
  descKey: "heatmap",
  open: "heatmap",
};
const STAKEHOLDER_MATRIX: PhaseToolDef = {
  id: "stakeholder_matrix",
  nameKey: "stakeholderMatrix",
  descKey: "stakeholderMatrix",
  open: "zone",
  zone: "workbench",
  anchor: "stakeholders",
};
const PROCESS = (badge: string): PhaseToolDef => ({
  id: "process",
  nameKey: badge === "AS-IS" ? "processAsIs" : "processToBe",
  descKey: badge === "AS-IS" ? "processAsIs" : "processToBe",
  open: "route",
  path: "/process",
  badge,
});
const REQUIREMENTS: PhaseToolDef = {
  id: "requirements",
  nameKey: "requirements",
  descKey: "requirements",
  open: "route",
  path: "/requirements",
};
const SOLUTION: PhaseToolDef = {
  id: "solution",
  nameKey: "solution",
  descKey: "solution",
  open: "route",
  path: "/solution",
};
const BUILDDOC: PhaseToolDef = {
  id: "builddoc",
  nameKey: "builddoc",
  descKey: "builddoc",
  open: "route",
  path: "/builddoc",
};
const GOLDENSET: PhaseToolDef = {
  id: "goldenset",
  nameKey: "goldenset",
  descKey: "goldenset",
  open: "route",
  path: "/goldenset",
};

/** A fázis tool-készlete (spec §2 · B1-a). P0: 0 · P1: 3 · P2: 3 · P3: 2.
 *  P4–P6: egyelőre üres — a szerkezet skálázódik, a B1 csak P0–P3-at tölt. */
export function phaseTools(phase: PhaseId): PhaseToolDef[] {
  switch (phase) {
    case "P1":
      return [HEATMAP, STAKEHOLDER_MATRIX, PROCESS("AS-IS")];
    case "P2":
      return [PROCESS("TO-BE"), REQUIREMENTS, SOLUTION];
    case "P3":
      return [BUILDDOC, GOLDENSET];
    default:
      return [];
  }
}

/** Egy tool route-célja (route-toolok); nem-route toolnál null. */
export function toolPath(toolId: string): string | null {
  const found = ([] as PhaseToolDef[])
    .concat(phaseTools("P1"), phaseTools("P2"), phaseTools("P3"))
    .find((t) => t.id === toolId);
  return found?.open === "route" ? (found.path ?? null) : null;
}

// ── Kapu-feltétel → akció-cél (B1-c) ─────────────────────────

/** Egy nem teljesült kapu-feltétel akció-célja: vagy egy zóna, vagy egy tool. */
export type GateTarget =
  | { kind: "zone"; zone: string }
  | { kind: "tool"; toolId: string; path: string };

/** A modul-szinkronizált (D3) deliverable-ök a saját TOOL-jukhoz visznek —
 *  ott szinkronizálódnak, nem a ③-ban töltődnek kézzel. */
const D3_OWNER_TOOL: Record<string, string> = {
  "Megoldás-dokumentáció": "builddoc",
  Tesztriport: "goldenset",
};

/** Egy deliverable-típus modul-szinkronizált-e (van moduleOwned mezője). */
function isModuleSynced(typeDef: ArtifactTypeDef | null): boolean {
  return Boolean(typeDef?.fields.some((f) => f.moduleOwned));
}

/**
 * A kritérium akció-célja (DERIVÁLT — nincs séma-mező):
 *  - `quick_win_on_shortlist` → ② Feldolgozás (a use case-ek ott pontozódnak);
 *  - `deliverable_approved:<typeKey>` → ha D3 (modul-szinkron) → a saját tool;
 *    egyébként ③ Kimenet (a deliverable ott generálódik/hagyódik jóvá);
 *  - `charter_approved` → ③ Kimenet.
 * Ismeretlen kritériumnál a biztonságos alap ③ Kimenet.
 */
export function criterionTarget(criterionId: string, typeKey?: string): GateTarget {
  if (criterionId === "quick_win_on_shortlist") {
    return { kind: "zone", zone: "workbench" };
  }
  if (typeKey) {
    const ownerTool = D3_OWNER_TOOL[typeKey];
    if (ownerTool && isModuleSynced(getTypeDef(typeKey))) {
      const path = toolPath(ownerTool);
      if (path) return { kind: "tool", toolId: ownerTool, path };
    }
  }
  return { kind: "zone", zone: "output" };
}

/**
 * A fázis ② zónája forráskinyerő-zóna-e (F4 default-számításhoz): P1
 * (entitás-gyártók) VAGY van „tiszta D1" típusa — nem entitás-forrású,
 * nem retired, és EGYETLEN mezője sem modul-birtokolt (a szabad-szöveges
 * field-extract tölti). P0/P1/P2 → true; P3 (mind D3 modul-szinkron) → false.
 */
export function phaseHasSourceExtractor(phase: PhaseId): boolean {
  if (phase === "P1") return true;
  return typesForPhase(phase).some(
    (t) => !t.entitySourced && t.fields.every((f) => !f.moduleOwned),
  );
}

/**
 * A megnyitáskori alapértelmezett zóna (F4):
 *  - nincs feltöltött forrás → ① Források;
 *  - van forrás + a ② forráskinyerő-zóna (P0/P1/P2) → ② Feldolgozás;
 *  - van forrás + a ② szerkezetileg üres (P3) → ③ Kimenet.
 */
export function defaultActiveZone(phase: PhaseId, hasSources: boolean): string {
  if (!hasSources) return "input";
  return phaseHasSourceExtractor(phase) ? "workbench" : "output";
}

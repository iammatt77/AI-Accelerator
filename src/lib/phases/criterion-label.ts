import { getTypeDef } from "@/lib/artifacts/config";
import type { PhaseCriterion } from "./config";

// Kritérium-címke feloldó (#6): a deliverable-alapú kritériumok címkéje a
// lokalizált típusnévből képződik; a fix azonosítójúaké (charter_approved)
// közvetlenül a criteria névtérből. Kliens- és szerver-oldalról egyaránt
// hívható — a fordító-függvényeket a hívó adja.

type Translator = (key: string, values?: Record<string, string>) => string;

export function criterionLabel(
  criterion: Pick<PhaseCriterion, "id" | "typeKey">,
  tCriteria: Translator,
  tTypes: Translator,
): string {
  if (criterion.typeKey) {
    const def = getTypeDef(criterion.typeKey);
    const typeName = def
      ? tTypes(def.nameKey.replace(/^artifactTypes\./, ""))
      : criterion.typeKey;
    return tCriteria("deliverable_approved", { type: typeName });
  }
  return tCriteria(criterion.id);
}

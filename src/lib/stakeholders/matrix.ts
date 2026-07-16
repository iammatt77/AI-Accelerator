// ─────────────────────────────────────────────────────────────
// Stakeholder-mátrix: Befolyás (influence_score, Y) × Érintettség
// (impact_score, X) — a #8 MEGLÉVŐ adatból származtatott vizualizáció +
// verdikt. Tiszta modul (nincs React/DB) → önállóan tesztelhető.
//
// Backend-megfelelés (ellenőrizve): influence_score = BEFOLYÁS,
// impact_score = ÉRINTETTSÉG (a kivonatoló prompt és az i18n is így nevezi)
// → nincs új mező, nincs migráció.
//
// Küszöb: a #7b hőtérkép-konvenciója (3,5) — 1–5 egész skálán a 4–5 „magas",
// az 1–3 „alacsony". A pont helyét a padded skála adja (10–90%), hogy a jelölő
// ne lógjon le a szélén.
// ─────────────────────────────────────────────────────────────

export type Quadrant = "manage_closely" | "keep_satisfied" | "keep_informed" | "monitor";

export const MATRIX_THRESHOLD = 3.5;

/** Magas-e a score (a #7b 3,5-ös küszöbe): 4–5 → magas. */
export function isHigh(score: number): boolean {
  return score >= MATRIX_THRESHOLD;
}

/** A pont %-os helye egy tengelyen: 1→10%, 3→50%, 5→90% (padding a szél ellen). */
export function scorePct(score: number): number {
  const clamped = Math.min(5, Math.max(1, score));
  return 10 + ((clamped - 1) / 4) * 80;
}

/** A kvadráns a két score-ból. Előfeltétel: mindkettő megvan (nem null). */
export function quadrant(influence: number, impact: number): Quadrant {
  const infHigh = isHigh(influence);
  const impHigh = isHigh(impact);
  if (infHigh && impHigh) return "manage_closely"; // SZOROSAN KEZELD (fent-jobb)
  if (infHigh && !impHigh) return "keep_satisfied"; // TARTSD ELÉGEDETTEN (fent-bal)
  if (!infHigh && impHigh) return "keep_informed"; // TARTSD INFORMÁLTAN (lent-jobb)
  return "monitor"; // MONITOROZD (lent-bal)
}

/** A dedikált lap verdiktjéhez: van-e ábrázolható pont (mindkét score megvan). */
export function hasMatrixPoint(
  influence: number | null,
  impact: number | null,
): influence is number {
  return influence !== null && impact !== null;
}

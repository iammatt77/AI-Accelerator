// ─────────────────────────────────────────────────────────────
// LLM extract — TISZTA válasz-feldolgozás (nincs server-only, nincs SDK).
//
// Külön modul, hogy az él-ág parse-logikája ÖNÁLLÓAN tesztelhető legyen
// valós modell-kimenet-mintákkal — a MOCK_LLM fixture ugyanis NEM megy át
// ezen a kódúton, így a fixture-teszt szerkezetileg nem fedi. (A #6 bug:
// a fabrikáció-szűrő túllőtt az élő modell eltérő index-konvencióin.)
// ─────────────────────────────────────────────────────────────

import type { ArtifactTypeDef } from "@/lib/artifacts/config";

/** Számozott forrás (1..n) — a [n] hivatkozások és a source_indices erre
 *  a számozásra mutatnak. */
export interface LlmSource {
  /** 1-alapú sorszám a forrás-listában. */
  index: number;
  title: string;
  text: string;
}

export interface ExtractedField {
  value: string;
  /** Csak olyan forrásszám, amely a megadott számozásban létezik. */
  source_indices: number[];
}

/** Mezőnként javaslat vagy null (= a forrásokban nincs meg → missing). */
export type ExtractResult = Record<string, ExtractedField | null>;

/** Eltávolítja az esetleges ```json ... ``` kódkerítést. */
export function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    return fenced[1].trim();
  }
  return text.trim();
}

/**
 * Parse-védelem + mezőnkénti validálás. Érvénytelen JSON → beszédes Error
 * (a hívó action FormState-hibává alakítja).
 *
 * FONTOS (a #6-fix magja): egy VALÓS (nem üres) mezőértéket SOSEM dobunk el
 * pusztán azért, mert a modell forrás-index-konvenciója eltér (0-alapú,
 * string, tartományon kívüli). A „fabrikált érték" és az „érvényes érték
 * rossz/hiányzó index-szel" külön eset: az utóbbinál a hamis citációt
 * eltávolítjuk (source_indices üres lesz), de az értéket AI-javaslatként
 * megtartjuk — az ember (E1) dönt. A forrás-jelölés hiánya önmagában is
 * jelzés a szemlélőnek; a hallucináció-tiltás a rendszerprompttal + az
 * emberi megerősítéssel érvényesül, nem a valós értékek néma eldobásával.
 */
export function parseExtractResult(
  raw: string,
  sources: LlmSource[],
  typeDef: ArtifactTypeDef,
): ExtractResult {
  let parsed: unknown;
  try {
    // Előbb a nyers választ próbáljuk (a fence-nélküli érvényes JSON a
    // megfelelő eset); a fence-eltávolítás csak fallback — így a mező-
    // értékekben előforduló ``` nem korrumpálja az érvényes választ.
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      parsed = JSON.parse(stripCodeFences(raw));
    }
  } catch {
    throw new Error(
      `A modell válasza nem érvényes JSON (első 120 karakter): ${raw.slice(0, 120)}`,
    );
  }
  const source =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const validIndices = new Set(sources.map((s) => s.index));
  const result: ExtractResult = {};
  for (const fieldDef of typeDef.fields) {
    const candidate = source[fieldDef.key];
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const obj = candidate as Record<string, unknown>;
      const value = typeof obj.value === "string" ? obj.value.trim() : "";
      if (value !== "") {
        result[fieldDef.key] = { value, source_indices: normalizeIndices(obj.source_indices, validIndices) };
        continue;
      }
    }
    // null, hiányzó kulcs, üres érték vagy rontott alak → missing (nem hiba)
    result[fieldDef.key] = null;
  }
  return result;
}

/** Forrás-indexek normalizálása: string→szám koerció (a modell néha "1"-et
 *  ad), érvényesre szűrés a megadott számozásra, dedup. A tartományon kívüli
 *  / nem numerikus / duplikált indexek kiesnek — az ÉRTÉK ettől függetlenül
 *  megmarad (lásd parseExtractResult). */
function normalizeIndices(raw: unknown, validIndices: Set<number>): number[] {
  const arr = Array.isArray(raw) ? raw : [];
  return [
    ...new Set(
      arr
        .map((n) => (typeof n === "string" ? Number(n.trim()) : n))
        .filter((n): n is number => Number.isInteger(n) && validIndices.has(n as number)),
    ),
  ];
}

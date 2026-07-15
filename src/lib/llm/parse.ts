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

/** AI-javasolt fájdalompont (P1 entitás-kivonatolás nyers javaslata). */
export interface PainPointProposal {
  title: string;
  description: string | null;
  /** Szó szerinti idézet a forrásból (ha a modell adott). */
  quote: string | null;
  severity: "low" | "medium" | "high" | null;
  source_indices: number[];
}

/** AI-javasolt use case (megerősített fájdalompontokból származtatva). */
export interface UseCaseProposal {
  title: string;
  description: string | null;
  /** 1-alapú hivatkozások a MEGADOTT megerősített fájdalompont-listára. */
  pain_point_refs: number[];
  source_indices: number[];
}

/** AI-javasolt stakeholder (charter/interjú-kivonatolás nyers javaslata, #8).
 *  A score (influence/impact) csak akkor van kitöltve, ha a forrás konkrét
 *  alapot ad rá — egyébként null (a modell nem tippel). A communication_strategy
 *  SOHA nem szerepel a kivonatolt javaslatban (kizárólag manuális mező). */
export interface StakeholderProposal {
  name: string;
  title: string | null;
  influence_score: number | null;
  impact_score: number | null;
  source_indices: number[];
}

/** Eltávolítja az esetleges ```json ... ``` kódkerítést. */
export function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    return fenced[1].trim();
  }
  return text.trim();
}

/** Nyers-először JSON-parse fence-strip fallbackkal (közös védelem). */
function parseJsonLoose(raw: string): unknown {
  try {
    // Előbb a nyers választ próbáljuk (a fence-nélküli érvényes JSON a
    // megfelelő eset); a fence-eltávolítás csak fallback — így a mező-
    // értékekben előforduló ``` nem korrumpálja az érvényes választ.
    try {
      return JSON.parse(raw.trim());
    } catch {
      return JSON.parse(stripCodeFences(raw));
    }
  } catch {
    throw new Error(
      `A modell válasza nem érvényes JSON (első 120 karakter): ${raw.slice(0, 120)}`,
    );
  }
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
  const parsed = parseJsonLoose(raw);
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

/** Trimmelt string vagy null (üres / nem-string → null). */
function optionalText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

const SEVERITY_VALUES = new Set(["low", "medium", "high"]);

/** A modell tömb-válasza — közvetlen tömb vagy {"<kulcs>": [...]}-burok
 *  (a modellek gyakran objektumba csomagolják a listát). */
function looseArray(parsed: unknown, wrapperKey: string): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const wrapped = (parsed as Record<string, unknown>)[wrapperKey];
    if (Array.isArray(wrapped)) return wrapped;
  }
  return [];
}

/** Szóköz-normalizált, kisbetűs alak a szó szerinti idézet ellenőrzéséhez. */
function normalizeForQuoteCheck(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Fájdalompont-javaslatok feldolgozása. Az extract-mezőkkel AZONOS elvek:
 * a cím nélküli elem kiesik (nincs identitása — az nem „érték rossz
 * index-szel", hanem üres javaslat), de a VALÓS javaslatot rossz/hiányzó
 * forrás-index miatt SOSEM dobjuk el — a hamis citáció lekerül róla
 * (source_indices üres), a döntés az emberé (E1).
 *
 * Az idézet (quote) BIZONYÍTÉK-értékű, ezért verifikált: csak akkor marad
 * a javaslaton, ha (szóköz-normalizálva, kisbetűsen) ténylegesen szerepel
 * valamelyik forrás szövegében — a fabrikált „idézet" lekerül (null), a
 * javaslat maga megmarad (ugyanaz az elv, mint a hamis citációnál).
 */
export function parsePainPointsResult(
  raw: string,
  sources: LlmSource[],
): PainPointProposal[] {
  const items = looseArray(parseJsonLoose(raw), "pain_points");
  const validIndices = new Set(sources.map((s) => s.index));
  const normalizedSources = sources.map((s) => normalizeForQuoteCheck(s.text));
  const result: PainPointProposal[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const title = optionalText(obj.title);
    if (!title) continue;
    const severityRaw =
      typeof obj.severity === "string" ? obj.severity.trim().toLowerCase() : "";
    const rawQuote = optionalText(obj.quote);
    const quoteVerified =
      rawQuote !== null &&
      normalizedSources.some((text) =>
        text.includes(normalizeForQuoteCheck(rawQuote)),
      );
    result.push({
      title,
      description: optionalText(obj.description),
      quote: quoteVerified ? rawQuote : null,
      severity: SEVERITY_VALUES.has(severityRaw)
        ? (severityRaw as PainPointProposal["severity"])
        : null,
      source_indices: normalizeIndices(obj.source_indices, validIndices),
    });
  }
  return result;
}

/**
 * Use case-javaslatok feldolgozása. A pain_point_refs a MEGADOTT megerősített
 * fájdalompont-lista 1-alapú sorszámaira mutat.
 *
 * FONTOS különbségtétel: a source_indices CITÁCIÓ — rossz index esetén az
 * érték marad, a citáció esik (a #6-fix elve). A pain_point_refs viszont a
 * javaslat SZEMANTIKAI TARTALMA (a spec: minden use case legalább egy
 * megadott fájdalompontra válaszol; a modell nem találhat ki fájdalompontot)
 * — a nulla érvényes ref-fel maradó javaslat kontraktus-sértő, ezért kiesik.
 */
export function parseUseCasesResult(
  raw: string,
  sources: LlmSource[],
  painPointCount: number,
): UseCaseProposal[] {
  const items = looseArray(parseJsonLoose(raw), "use_cases");
  const validSourceIndices = new Set(sources.map((s) => s.index));
  const validPainRefs = new Set(
    Array.from({ length: painPointCount }, (_, i) => i + 1),
  );
  const result: UseCaseProposal[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const title = optionalText(obj.title);
    if (!title) continue;
    const pain_point_refs = normalizeIndices(obj.pain_point_refs, validPainRefs);
    if (pain_point_refs.length === 0) continue;
    result.push({
      title,
      description: optionalText(obj.description),
      pain_point_refs,
      source_indices: normalizeIndices(obj.source_indices, validSourceIndices),
    });
  }
  return result;
}

/** 1–5 egész score vagy null (a #8 c-mintája): a modell CSAK akkor adhat
 *  score-t, ha van rá alap; a tartományon kívüli / nem numerikus / hiányzó
 *  érték null lesz (a modell nem tippel — a null a KÍVÁNT viselkedés). A
 *  string-koerció a "4"-alakú válaszokat is fogadja (parse-robusztusság). */
function optionalScore(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 5) return null;
  return n;
}

/**
 * Stakeholder-javaslatok feldolgozása (#8). A fájdalompont-parse elveivel:
 * a név nélküli elem kiesik (nincs identitása), de a VALÓS javaslatot rossz/
 * hiányzó forrás-index miatt SOSEM dobjuk el — a hamis citáció lekerül róla,
 * a döntés az emberé (E1).
 *
 * Score (c-minta): az influence/impact score csak akkor marad a javaslaton,
 * ha érvényes 1–5 egész — a hiányzó vagy tartományon kívüli érték null lesz
 * (a modell nem tippelhet score-t alap nélkül). A communication_strategy-t
 * a parse SOSEM olvassa ki — az kizárólag manuális mező.
 */
export function parseStakeholdersResult(
  raw: string,
  sources: LlmSource[],
): StakeholderProposal[] {
  const items = looseArray(parseJsonLoose(raw), "stakeholders");
  const validIndices = new Set(sources.map((s) => s.index));
  const result: StakeholderProposal[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const name = optionalText(obj.name);
    if (!name) continue;
    result.push({
      name,
      title: optionalText(obj.title),
      influence_score: optionalScore(obj.influence_score),
      impact_score: optionalScore(obj.impact_score),
      source_indices: normalizeIndices(obj.source_indices, validIndices),
    });
  }
  return result;
}

/**
 * llm-parse-check — az extract ÉL-ág válasz-feldolgozásának determinisztikus
 * regresszió-tesztje VALÓS modell-kimenet-mintákkal (API nélkül).
 *
 * MIÉRT: a MOCK_LLM fixture NEM megy át a parseExtractResult-on, így a
 * fixture-alapú walkthrough szerkezetileg nem fedi az él-ág parse-logikáját.
 * Ez a teszt közvetlenül az IGAZI parseExtractResult-ot hajtja (src/lib/llm/
 * parse.ts), és bemutatja a #6-bug gyökerét (a fabrikáció-szűrő túllőtt a
 * modell eltérő index-konvencióin: string / 0-alapú / tartományon kívüli).
 *
 * Futtatás: npm run llm:parse-check   (npx tsx scripts/llm-parse-check.ts)
 */

import {
  parseExtractResult,
  parsePainPointsResult,
  parseUseCasesResult,
  type LlmSource,
} from "../src/lib/llm/parse";

// Charter-alakú típusdefiníció (a parse csak a .fields[].key-t olvassa).
const CHARTER = {
  key: "Projekt-charter",
  fields: [
    { key: "cel" },
    { key: "scope" },
    { key: "szponzor" },
    { key: "idokeret" },
    { key: "sikerkriterium" },
    { key: "stakeholderek" },
  ],
  // a parse számára irreleváns mezők:
} as unknown as Parameters<typeof parseExtractResult>[2];

const SOURCES: LlmSource[] = [
  { index: 1, title: "Interjú-jegyzet", text: "…" },
  { index: 2, title: "Folyamatvázlat", text: "…" },
];

// ── A #5a review-fix (a5cd204) BUGGOS parse-logikája — szó szerint,
//    a before/after bizonyításához (a fabrikáció-null ággal). ──
function parseOld(
  raw: string,
  sources: LlmSource[],
  typeDef: typeof CHARTER,
): Record<string, { value: string; source_indices: number[] } | null> {
  let parsed: unknown;
  try {
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      parsed = JSON.parse(m ? m[1].trim() : raw.trim());
    }
  } catch {
    throw new Error("nem JSON");
  }
  const source =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const validIndices = new Set(sources.map((s) => s.index));
  const result: Record<string, { value: string; source_indices: number[] } | null> = {};
  for (const fieldDef of typeDef.fields) {
    const candidate = source[fieldDef.key];
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const obj = candidate as Record<string, unknown>;
      const value = typeof obj.value === "string" ? obj.value.trim() : "";
      if (value !== "") {
        const rawIndices = Array.isArray(obj.source_indices) ? obj.source_indices : [];
        const source_indices = [
          ...new Set(
            rawIndices.filter(
              (n): n is number => Number.isInteger(n) && validIndices.has(n as number),
            ),
          ),
        ];
        if (rawIndices.length > 0 && source_indices.length === 0) {
          result[fieldDef.key] = null; // ← a bug: valós értéket eldob
          continue;
        }
        result[fieldDef.key] = { value, source_indices };
        continue;
      }
    }
    result[fieldDef.key] = null;
  }
  return result;
}

// ── Valós modell-kimenet-minták (raw string, ahogy az API adná) ──
const V = (indices: string) =>
  `{
  "cel": { "value": "A panaszkezelés AI-alkalmasságának felmérése", "source_indices": ${indices} },
  "scope": { "value": "P0–P2, Felmérés-csomag", "source_indices": ${indices} },
  "szponzor": { "value": "Ügyvezető", "source_indices": ${indices} },
  "idokeret": { "value": "6 hét", "source_indices": ${indices} },
  "sikerkriterium": { "value": "Priorizált shortlist + business case", "source_indices": ${indices} },
  "stakeholderek": null
}`;

interface Case {
  name: string;
  raw: string;
  /** Elvárt: hány mező kap ÉRTÉKET (nem null) az ÚJ logikában. */
  expectNewFilled: number;
  /** Igazoljuk-e, hogy a RÉGI logika eldobta (regresszió-bizonyíték)? */
  oldRegressed?: boolean;
}

const CASES: Case[] = [
  { name: "numerikus, érvényes indexek [1]", raw: V("[1]"), expectNewFilled: 5 },
  { name: "numerikus, [1,2]", raw: V("[1, 2]"), expectNewFilled: 5 },
  { name: "STRING indexek [\"1\"] (gyakori él-eset)", raw: V('["1"]'), expectNewFilled: 5, oldRegressed: true },
  { name: "0-alapú index [0] (a modell 0-tól számol)", raw: V("[0]"), expectNewFilled: 5, oldRegressed: true },
  { name: "tartományon kívüli index [9]", raw: V("[9]"), expectNewFilled: 5, oldRegressed: true },
  { name: "üres source_indices []", raw: V("[]"), expectNewFilled: 5 },
  {
    name: "hiányzó source_indices kulcs",
    raw: `{ "cel": { "value": "X" }, "scope": { "value": "Y" }, "szponzor": null, "idokeret": null, "sikerkriterium": null, "stakeholderek": null }`,
    expectNewFilled: 2,
  },
  { name: "fenced ```json``` blokk, [1]", raw: "```json\n" + V("[1]") + "\n```", expectNewFilled: 5 },
  {
    name: "prose + fenced JSON (fallback strip)",
    raw: "Itt a kinyert JSON:\n```json\n" + V("[1]") + "\n```\nEnnyi.",
    expectNewFilled: 5,
  },
  {
    name: "genuine missing: minden mező null",
    raw: `{ "cel": null, "scope": null, "szponzor": null, "idokeret": null, "sikerkriterium": null, "stakeholderek": null }`,
    expectNewFilled: 0,
  },
];

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
}

console.log("── ÚJ parse (src/lib/llm/parse.ts) — valós modell-kimenet-mintákon ──\n");
for (const c of CASES) {
  const res = parseExtractResult(c.raw, SOURCES, CHARTER);
  const filled = Object.values(res).filter(Boolean).length;
  check(`ÚJ: ${c.name}`, filled === c.expectNewFilled, `${filled} mező kapott értéket (várt: ${c.expectNewFilled})`);

  if (c.oldRegressed) {
    const old = parseOld(c.raw, SOURCES, CHARTER);
    const oldFilled = Object.values(old).filter(Boolean).length;
    check(
      `  RÉGI (buggos) ugyanezen: minden VALÓS érték ELVESZETT`,
      oldFilled === 0,
      `régi: ${oldFilled} mező (a bug: null-ra esett)`,
    );
  }
}

// Célzott ellenőrzés: string-koerció visszanyeri a citációt; a tartományon
// kívüli index eldobódik, de az ÉRTÉK marad, üres source_indices-szal.
const strRes = parseExtractResult(V('["1"]'), SOURCES, CHARTER);
check("string-koerció: cel citációja helyreáll [1]", JSON.stringify(strRes.cel?.source_indices) === "[1]");
const oobRes = parseExtractResult(V("[9]"), SOURCES, CHARTER);
check("tartományon kívüli: érték marad, citáció üres", oobRes.cel?.value !== undefined && JSON.stringify(oobRes.cel?.source_indices) === "[]");

// ── #7a: fájdalompont-parse — ugyanazok az elvek entitás-javaslatokra ──

// A quote-verifikációhoz valós szövegű források (a SOURCES "…" szövege
// szándékosan nem tartalmazza az idézeteket — az a fabrikáció-eset).
const PP_SOURCES: LlmSource[] = [
  {
    index: 1,
    title: "Interjú-jegyzet",
    text: "A panaszkezelésben hetekig ül a panasz, mire bárki ránéz. Sok a kézi munka.",
  },
  { index: 2, title: "Folyamatvázlat", text: "Kétszer rögzítik ugyanazt az adatot." },
];

const PP = (indices: string) =>
  `[
  { "title": "Lassú panasz-átfutás", "description": "Hosszú az átfutás.", "quote": "hetekig ül a panasz", "severity": "high", "source_indices": ${indices} },
  { "title": "Kézi duplikáció", "description": "Kétszer rögzítenek.", "quote": null, "severity": "medium", "source_indices": ${indices} },
  { "title": "Tudás a fejekben", "description": null, "quote": null, "severity": null, "source_indices": ${indices} }
]`;

console.log("\n── parsePainPointsResult (#7a) — entitás-javaslatok ──\n");

const ppValid = parsePainPointsResult(PP("[1]"), PP_SOURCES);
check("PP: numerikus [1] → 3 javaslat, citációval", ppValid.length === 3 && JSON.stringify(ppValid[0].source_indices) === "[1]");
const ppStr = parsePainPointsResult(PP('["1"]'), PP_SOURCES);
check("PP: string [\"1\"] → citáció helyreáll", ppStr.length === 3 && JSON.stringify(ppStr[0].source_indices) === "[1]");
const ppOob = parsePainPointsResult(PP("[9]"), PP_SOURCES);
check("PP: tartományon kívüli [9] → javaslat MARAD, citáció üres", ppOob.length === 3 && ppOob[0].source_indices.length === 0);
const ppWrapped = parsePainPointsResult(`{ "pain_points": ${PP("[2]")} }`, PP_SOURCES);
check("PP: objektum-burok {pain_points: […]} → 3 javaslat", ppWrapped.length === 3);
const ppFenced = parsePainPointsResult("```json\n" + PP("[1]") + "\n```", PP_SOURCES);
check("PP: fenced blokk → 3 javaslat", ppFenced.length === 3);
const ppNoTitle = parsePainPointsResult(
  `[ { "title": "", "description": "cím nélkül" }, { "description": "kulcs sincs" }, { "title": "Valódi", "source_indices": [1] } ]`,
  SOURCES,
);
check("PP: cím nélküli elem kiesik (nincs identitása), a valódi marad", ppNoTitle.length === 1 && ppNoTitle[0].title === "Valódi");
const ppSeverity = parsePainPointsResult(
  `[ { "title": "A", "severity": "HIGH" }, { "title": "B", "severity": "extreme" } ]`,
  SOURCES,
);
check("PP: severity koerció — \"HIGH\"→high, ismeretlen→null", ppSeverity[0].severity === "high" && ppSeverity[1].severity === null);
check("PP: üres tömb → 0 javaslat (→ UX-notice)", parsePainPointsResult("[]", SOURCES).length === 0);
check("PP: nem-tömb válasz → 0 javaslat (nem hiba)", parsePainPointsResult(`{ "foo": "bar" }`, SOURCES).length === 0);
// Quote-verifikáció: a szó szerinti idézet megmarad; a forrásban nem
// szereplő (fabrikált) idézet lekerül, de a javaslat MARAD.
check("PP: valós idézet megmarad (szóköz/kisbetű-normalizálva)", ppValid[0].quote === "hetekig ül a panasz");
const ppFabricated = parsePainPointsResult(
  `[ { "title": "Valós fájdalompont", "quote": "ez a mondat nincs a forrásban", "source_indices": [1] } ]`,
  PP_SOURCES,
);
check("PP: fabrikált idézet lekerül, a javaslat MARAD", ppFabricated.length === 1 && ppFabricated[0].quote === null);
const ppCaseWs = parsePainPointsResult(
  `[ { "title": "A", "quote": "HETEKIG   ÜL a panasz", "source_indices": [1] } ]`,
  PP_SOURCES,
);
check("PP: idézet-egyezés kisbetű+szóköz-toleráns", ppCaseWs[0].quote === "HETEKIG   ÜL a panasz");

// ── #7a: use case-parse — a pain_point_refs SZEMANTIKAI kontraktus ──

const UC = (refs: string, indices: string) =>
  `[
  { "title": "AI-triázs", "description": "Automatikus kategorizálás.", "pain_point_refs": ${refs}, "source_indices": ${indices} },
  { "title": "Kivonatoló asszisztens", "description": null, "pain_point_refs": ${refs}, "source_indices": ${indices} }
]`;

console.log("\n── parseUseCasesResult (#7a) — lánc-hivatkozással ──\n");

const ucValid = parseUseCasesResult(UC("[1, 2]", "[1]"), SOURCES, 3);
check("UC: érvényes refs [1,2] (painCount=3) → 2 javaslat", ucValid.length === 2 && JSON.stringify(ucValid[0].pain_point_refs) === "[1,2]");
const ucStrRef = parseUseCasesResult(UC('["1"]', "[1]"), SOURCES, 3);
check("UC: string ref [\"1\"] → koerció, javaslat marad", ucStrRef.length === 2 && JSON.stringify(ucStrRef[0].pain_point_refs) === "[1]");
const ucNoRef = parseUseCasesResult(UC("[9]", "[1]"), SOURCES, 3);
check("UC: CSAK érvénytelen ref [9] → javaslat KIESIK (szemantikai kontraktus)", ucNoRef.length === 0);
const ucMixedRef = parseUseCasesResult(UC("[1, 9]", "[1]"), SOURCES, 3);
check("UC: vegyes refs [1,9] → marad, csak az érvényes ref [1]", ucMixedRef.length === 2 && JSON.stringify(ucMixedRef[0].pain_point_refs) === "[1]");
const ucBadCite = parseUseCasesResult(UC("[1]", "[9]"), SOURCES, 3);
check("UC: rossz CITÁCIÓ [9] → javaslat MARAD, citáció üres (a #6-fix elve)", ucBadCite.length === 2 && ucBadCite[0].source_indices.length === 0);
const ucWrapped = parseUseCasesResult(`{ "use_cases": ${UC("[1]", "[1]")} }`, SOURCES, 1);
check("UC: objektum-burok {use_cases: […]} → 2 javaslat", ucWrapped.length === 2);
check("UC: üres tömb → 0 javaslat (→ UX-notice)", parseUseCasesResult("[]", SOURCES, 3).length === 0);

console.log(failures === 0 ? "\nPARSE-CHECK: MINDEN PASS" : `\nPARSE-CHECK: ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);

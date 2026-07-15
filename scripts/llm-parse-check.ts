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
  parseBenefitSuggestion,
  parseExtractResult,
  parsePainPointsResult,
  parsePilotSuggestion,
  parseStakeholdersResult,
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

// ── #8: stakeholder-parse — score c-minta + hallucináció-tiltás ──

console.log("\n── parseStakeholdersResult (#8) — stakeholder-javaslatok ──\n");

const SK_SOURCES: LlmSource[] = [
  { index: 1, title: "Charter", text: "Az üzemvezető a folyamatgazda, erős befolyással." },
  { index: 2, title: "Interjú", text: "Az ügyintézők a napi munkát végzik." },
];
const skScored = parseStakeholdersResult(
  `[ { "name": "Üzemvezető", "title": "Folyamatgazda", "influence_score": 5, "impact_score": 4, "source_indices": [1] } ]`,
  SK_SOURCES,
);
check("SK: érvényes score 5/4 megmarad", skScored.length === 1 && skScored[0].influence_score === 5 && skScored[0].impact_score === 4);
const skNoScore = parseStakeholdersResult(
  `[ { "name": "Vezetőség", "title": "Riport-fogadó", "source_indices": [1] } ]`,
  SK_SOURCES,
);
check("SK: score nélkül → influence/impact null (c-minta, nem tippel)", skNoScore.length === 1 && skNoScore[0].influence_score === null && skNoScore[0].impact_score === null);
const skOobScore = parseStakeholdersResult(
  `[ { "name": "X", "influence_score": 9, "impact_score": 0, "source_indices": [1] } ]`,
  SK_SOURCES,
);
check("SK: tartományon kívüli score (9/0) → null (a modell nem tippelhet)", skOobScore[0].influence_score === null && skOobScore[0].impact_score === null);
const skStrScore = parseStakeholdersResult(
  `[ { "name": "Y", "influence_score": "3", "source_indices": ["1"] } ]`,
  SK_SOURCES,
);
check("SK: string score \"3\" → koerció 3; string index \"1\" → citáció helyreáll", skStrScore[0].influence_score === 3 && JSON.stringify(skStrScore[0].source_indices) === "[1]");
const skBadCite = parseStakeholdersResult(
  `[ { "name": "Z", "influence_score": 4, "source_indices": [9] } ]`,
  SK_SOURCES,
);
check("SK: rossz CITÁCIÓ [9] → javaslat MARAD, citáció üres (a #6-fix elve)", skBadCite.length === 1 && skBadCite[0].source_indices.length === 0);
const skNoName = parseStakeholdersResult(
  `[ { "title": "cím van, név nincs" }, { "name": "Valós", "source_indices": [1] } ]`,
  SK_SOURCES,
);
check("SK: név nélküli elem kiesik, a valódi marad", skNoName.length === 1 && skNoName[0].name === "Valós");
const skWrapped = parseStakeholdersResult(
  `{ "stakeholders": [ { "name": "A", "source_indices": [2] } ] }`,
  SK_SOURCES,
);
check("SK: objektum-burok {stakeholders: […]} → 1 javaslat", skWrapped.length === 1);
check("SK: üres tömb → 0 javaslat (→ UX-notice)", parseStakeholdersResult("[]", SK_SOURCES).length === 0);
// A communication_strategy SOHA nem kerül a javaslatba (nincs is a típusban) —
// a parse még ha a modell adna is ilyet, nem olvassa ki.
const skWithStrategy = parseStakeholdersResult(
  `[ { "name": "A", "communication_strategy": "heti egyeztetés", "source_indices": [1] } ]`,
  SK_SOURCES,
);
check("SK: communication_strategy a válaszban → a parse NEM olvassa ki (kizárólag manuális)", skWithStrategy.length === 1 && !("communication_strategy" in skWithStrategy[0]));

// ── #9: P2-javaslat parse — c-minta, a fék/döntési szabály SOHA ──

console.log("\n── parseBenefitSuggestion / parsePilotSuggestion (#9) ──\n");

const P2_SOURCES: LlmSource[] = [
  { index: 1, title: "Kickoff", text: "4 fő operátor, egyenként napi 2 órát tölt kézi kereséssel." },
  { index: 2, title: "AHT", text: "A jelenlegi átlagos kezelési idő 15 perc." },
];
const bcValid = parseBenefitSuggestion(
  `{ "felszabadult_kapacitas_ora_ho": 168, "oradij_ft": 6500, "source_indices": [1] }`,
  P2_SOURCES,
);
check("BC: érvényes bemenetek 168 / 6500 + citáció", bcValid.felszabadult_kapacitas_ora_ho === 168 && bcValid.oradij_ft === 6500 && JSON.stringify(bcValid.source_indices) === "[1]");
const bcStr = parseBenefitSuggestion(`{ "felszabadult_kapacitas_ora_ho": "168", "oradij_ft": "6 500" }`, P2_SOURCES);
check("BC: string-koerció (\"168\", \"6 500\") → szám", bcStr.felszabadult_kapacitas_ora_ho === 168 && bcStr.oradij_ft === 6500);
const bcNoBasis = parseBenefitSuggestion(`{ "felszabadult_kapacitas_ora_ho": null, "oradij_ft": null }`, P2_SOURCES);
check("BC: alap nélkül → null (nem tippel)", bcNoBasis.felszabadult_kapacitas_ora_ho === null && bcNoBasis.oradij_ft === null);
const bcFek = parseBenefitSuggestion(`{ "felszabadult_kapacitas_ora_ho": 168, "realizalhato_szazalek": 40 }`, P2_SOURCES);
check("BC: a modell mégis ad féket → a parse NEM olvassa ki (nincs a shape-ben)", !("realizalhato_szazalek" in bcFek));
const bcNeg = parseBenefitSuggestion(`{ "oradij_ft": -100 }`, P2_SOURCES);
check("BC: nem-pozitív érték → null", bcNeg.oradij_ft === null);

const plValid = parsePilotSuggestion(
  `{ "meresi_metrika": "AHT", "baseline_ertek": 15, "baseline_egyseg": "perc", "kuszob_ertek": 10, "kuszob_egyseg": "perc", "hipotezis": "AHT csökken", "source_indices": [1, 2] }`,
  P2_SOURCES,
);
check("PL: érvényes baseline 15 / küszöb 10 / metrika / hipotézis", plValid.baseline_ertek === 15 && plValid.kuszob_ertek === 10 && plValid.meresi_metrika === "AHT" && plValid.hipotezis === "AHT csökken");
const plRule = parsePilotSuggestion(
  `{ "kuszob_ertek": 10, "dontesi_szabaly": { "scale_feltetel": "x" }, "scale_feltetel": "y" }`,
  P2_SOURCES,
);
check("PL: a modell mégis ad döntési szabályt → a parse NEM olvassa ki (nincs a shape-ben)", !("dontesi_szabaly" in plRule) && !("scale_feltetel" in plRule));
const plNoBasis = parsePilotSuggestion(`{ "baseline_ertek": null, "kuszob_ertek": null }`, P2_SOURCES);
check("PL: alap nélkül → null", plNoBasis.baseline_ertek === null && plNoBasis.kuszob_ertek === null);

console.log(failures === 0 ? "\nPARSE-CHECK: MINDEN PASS" : `\nPARSE-CHECK: ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);

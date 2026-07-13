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

import { parseExtractResult, type LlmSource } from "../src/lib/llm/parse";

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

console.log(failures === 0 ? "\nPARSE-CHECK: MINDEN PASS" : `\nPARSE-CHECK: ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);

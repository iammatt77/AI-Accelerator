// VALÓS LLM smoke-teszt — Epic 4 · 4.2b (forrás-metaadat + atomi kinyerés).
// Máté futtatja; a sandboxból az Anthropic API nem hívható (egress-korlát).
//
// Mit bizonyít (a 4.2b MOCK-kal nem lezárható kérdései):
//   1. ATOMI KINYERÉS: egy kickoff-agenda jellegű forrásból a valós modell
//      NULLA napirendi-pont-elemet ad; a vegyes forrásból CSAK a valódi
//      állítások jönnek (kevesebb, de valódi). A parse törmelék-őre a
//      biztonsági háló — itt az derül ki, kell-e egyáltalán dolgoznia.
//   2. EVIDENCIA-TENGELY: a valós modell értelmesen szétválasztja a mért
//      adatot a vélekedéstől ugyanabban a classify-hívásban.
//   3. FORRÁS-TÍPUS-HINT: a sourceKind kontextussal a borderline modalitás
//      a prior felé húz, de az ellentmondó szöveg felül tudja írni.
//
// Futtatás (a repo gyökeréből, .env.local-ban a valós kulccsal):
//   npx tsx --env-file=.env.local --conditions=react-server scripts/smoke-source-meta.mts
//
// Szükséges env: ANTHROPIC_API_KEY=...  (MOCK_LLM NE legyen beállítva!)
import { classifyKnowledgeItem, extractPainPoints } from "@/lib/llm/index";

if (process.env.MOCK_LLM === "1") {
  console.error("MOCK mód aktív — ez a script a VALÓS hívásokat ellenőrzi. Vedd ki a MOCK_LLM env-et.");
  process.exit(1);
}

let fails = 0;
function verdict(name: string, cond: boolean, detail?: unknown) {
  if (!cond) fails++;
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond && detail !== undefined) console.log("   →", JSON.stringify(detail, null, 2).slice(0, 600));
}

console.log("── 1) Atomi kinyerés: csupa-szerkezet kickoff-agenda ──");
const AGENDA = [
  "Kickoff-agenda — AI-felmérés, 2026. szeptember 4.",
  "1. A helyzetértékelés bemutatása és a felmérési terv (30 perc)",
  "2. A pilot hatóköre, ütemterve és a szeptember 30-i élesítés",
  "3. Döntési pontok, felelősök, következő lépések",
  "Résztvevők: Kovács Nándor (üzemvezető), Nagy Eszter (ügyfélszolgálati vezető)",
  "Előkészületek: szervezeti ábra, panasz-statisztika export",
].join("\n");
const agendaOut = await extractPainPoints([{ index: 1, text: AGENDA }]);
console.log(JSON.stringify(agendaOut, null, 2));
verdict("napirendi pontokból NULLA elem", agendaOut.length === 0, agendaOut);

console.log("\n── 2) Vegyes forrás: kevesebb, de valódi állítás ──");
const MIXED = [
  "Kickoff-jegyzet — panaszkezelés",
  "1. A helyzetértékelés bemutatása (30 perc)",
  "2. A pilot hatóköre és ütemterve",
  "Megbeszélésen elhangzott: a panasz hetekig ül a rendszerben, mire bárki ránéz, és az ügyfél nem kap visszajelzést.",
  "A kollégák ugyanazt az adatot kétszer-háromszor viszik fel kézzel a két külön rendszerbe.",
].join("\n");
const mixedOut = await extractPainPoints([{ index: 1, text: MIXED }]);
console.log(JSON.stringify(mixedOut, null, 2));
verdict("1-3 valódi elem (nem 5+ törmelék)", mixedOut.length >= 1 && mixedOut.length <= 3, mixedOut.length);
verdict(
  "egyik elem sem sorszámozott/csonka",
  mixedOut.every((p) => !/^\s*\d+[\.\)]\s/.test(p.title) && !/\s\d+[\.\)]\s*$/.test(p.description ?? "")),
  mixedOut.map((p) => p.title),
);

console.log("\n── 3) Evidencia-tengely: mért adat vs vélekedés ──");
const MEASURED = "A panasz-export szerint az átlagos átfutási idő 11,4 nap, a visszajelzés nélküli arány 62%.";
const OPINION = "Szerintem a panaszok kezelése túl sokáig tart, az ügyfelek biztos elégedetlenek.";
const sMeasured = await classifyKnowledgeItem(MEASURED, { stakeholderNames: [] });
const sOpinion = await classifyKnowledgeItem(OPINION, { stakeholderNames: [] });
console.log("mért:", JSON.stringify(sMeasured.evidence));
console.log("vélekedés:", JSON.stringify(sOpinion.evidence));
verdict("mért adat felismerve", sMeasured.evidence.label === "mert_adat", sMeasured.evidence);
verdict("vélekedés felismerve", sOpinion.evidence.label === "velekedes", sOpinion.evidence);

console.log("\n── 4) Forrás-típus-hint: prior + felülírás ──");
const BORDERLINE = "Jelenleg minden panaszt a szabályzat szerint kötelező vezetői jóváhagyás után lezárni.";
const withHint = await classifyKnowledgeItem(BORDERLINE, {
  stakeholderNames: [],
  sourceKind: "hivatalos_dokumentacio",
});
console.log("hivatalos-hint:", JSON.stringify(withHint.modality));
verdict(
  "hivatalos dok-hint mellett normatív (vagy magabiztos indoklású eltérés)",
  withHint.modality.label === "normativ" || withHint.modality.confidence >= 0.7,
  withHint.modality,
);
const CONTRA = "Jelenleg minden reggel egy kolléga kézzel dobálja szét a leveleket kategóriákba.";
const contra = await classifyKnowledgeItem(CONTRA, {
  stakeholderNames: [],
  sourceKind: "hivatalos_dokumentacio",
});
console.log("ellentmondó szöveg:", JSON.stringify(contra.modality));
verdict("a tisztán megfigyelő szöveg a hint ellenére as_is", contra.modality.label === "as_is", contra.modality);

console.log(`\n=== smoke-source-meta: ${fails === 0 ? "MINDEN RENDBEN" : fails + " bukás"} ===`);
process.exit(fails === 0 ? 0 : 1);

// VALÓS címkéző + embedding smoke-teszt (Epic 4 · 4.2) — Máté futtatja.
//
// Mit bizonyít:
//   1. A valós LLM (Anthropic, az adapteren át) értelmesen szétválasztja az
//      as_is/normativ határesetet, szó szerinti evidenciával, őszinte
//      konfidenciával (a 4.2-a/b minőségi kérdése).
//   2. A valós embedding-szolgáltató 1024 dimenziós vektort ad (BGE-M3) —
//      ez zárja a 4.1 óta nyitott valós-embedding verifikációt.
//
// Futtatás (a repo gyökeréből, .env.local-ban a valós kulcsokkal):
//   npx tsx --env-file=.env.local --conditions=react-server scripts/smoke-labeling.mts
//
// Szükséges env (.env.local):
//   ANTHROPIC_API_KEY=...            (LLM — szerveroldali kulcs)
//   EMBEDDING_PROVIDER_URL=...      (OpenAI-kompatibilis /embeddings végpont)
//   EMBEDDING_API_KEY=...
//   EMBEDDING_MODEL=BAAI/bge-m3     (szolgáltató-függő modellnév)
//   EMBEDDING_MODEL_VERSION=...     (opcionális)
// FONTOS: MOCK_LLM és MOCK_EMBEDDINGS NE legyen beállítva!
import { classifyKnowledgeItem } from "@/lib/llm/index";
import { embedOne, EMBEDDING_DIM } from "@/lib/embeddings/index";

if (process.env.MOCK_LLM === "1" || process.env.MOCK_EMBEDDINGS === "1") {
  console.error("MOCK mód aktív — ez a script a VALÓS hívásokat ellenőrzi. Vedd ki a MOCK_* env-eket.");
  process.exit(1);
}

// Határeset: megfigyelésként ÉS előírásként is olvasható szöveg + kevert nyelv.
const EDGE_TEXT =
  "Kevert előírás-megfigyelés — Jelenleg minden panaszt a szabályzat szerint " +
  "kötelező 2024 óta kategorizálni, de a gyakorlatban a team gyakran skippeli a review-t.";

console.log("── 1) Valós LLM-címkézés (as_is/normativ határeset) ──");
const sample = await classifyKnowledgeItem(EDGE_TEXT, {
  stakeholderNames: ["Kovács Nándor", "Balogh Tímea"],
});
console.log(JSON.stringify(sample, null, 2));

const verbatim = EDGE_TEXT.replace(/\s+/g, " ").includes(
  (sample.modality.evidence ?? "").replace(/\s+/g, " ").trim(),
);
console.log(`modality=${sample.modality.label} conf=${sample.modality.confidence} borderline=${sample.modality.borderline}`);
console.log(`evidencia szó szerinti: ${verbatim ? "IGEN" : "NEM ← PROBLÉMA"}`);
console.log(`lang=${sample.lang.label} (elvárt: hu-en)`);

console.log("\n── 2) Valós embedding (1024-dim bizonyítás) ──");
const emb = await embedOne(EDGE_TEXT);
console.log(`modell: ${emb.model} (${emb.modelVersion})`);
console.log(`dimenzió: ${emb.vector.length} (elvárt: ${EMBEDDING_DIM}) — ${emb.vector.length === EMBEDDING_DIM ? "OK" : "HIBA"}`);
const norm = Math.sqrt(emb.vector.reduce((a, x) => a + x * x, 0));
console.log(`‖v‖ = ${norm.toFixed(4)}`);

console.log("\nKész. Ha mindkét szakasz hibátlan, a 4.2 valós-hívás verifikációja zárt.");

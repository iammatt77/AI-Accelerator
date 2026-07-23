import "server-only";
import { createHash } from "node:crypto";

// ─────────────────────────────────────────────────────────────
// EMBEDDING-ADAPTER (Epic 4 · 4.1-b) — a governance mintája, mint az
// src/lib/llm. EGYETLEN belépő minden embedding-híváshoz; a hívó nem
// ismeri a szolgáltatót. A jelenlegi implementáció OpenAI-kompatibilis
// /embeddings endpoint (BGE-M3 hosted). Szolgáltató-váltás KIZÁRÓLAG
// konfigurációval (env), a hívó kód érintése nélkül (F4).
//
// A kulcs SOHA nem kerül kliensre (a "server-only" import build-időben
// kikényszeríti). A vektor mellé a hívás VISSZAADJA a modell nevét+verzióját
// — a hívó (server action) ezt tárolja a vektorral (F4: modell-váltáskor
// tudni, mit kell újraszámolni).
//
// MOCK_EMBEDDINGS=1: determinisztikus, hálózat nélküli mód (self-check).
// Ugyanaz a szöveg → ugyanaz a vektor (koszinusz 1.0) — így a hasonlósági
// lekérdezés SQL-alakja és a metaadat-ELŐszűrés érvényesülése lokálisan
// verifikálható, valós szolgáltató nélkül. A VALÓS vektor-dimenzió és
// szemantikai rangsor csak éles BGE-M3-mal ellenőrizhető (spec §6).
// ─────────────────────────────────────────────────────────────

/** BGE-M3 dense dimenzió — a 0017 vector(1024) oszloppal egyezik. */
export const EMBEDDING_DIM = 1024;

const MOCK_MODEL = "mock-bge-m3";
const MOCK_MODEL_VERSION = "mock-1";

export interface EmbeddingResult {
  /** A vektor (hossza EMBEDDING_DIM). */
  vector: number[];
  /** A modell neve (a vektorral tárolandó — F4). */
  model: string;
  /** A modell verziója (a vektorral tárolandó — F4). */
  modelVersion: string;
}

function isMock(): boolean {
  return process.env.MOCK_EMBEDDINGS === "1";
}

function providerConfig(): { url: string; apiKey: string; model: string; version: string } {
  const url = process.env.EMBEDDING_PROVIDER_URL;
  const apiKey = process.env.EMBEDDING_API_KEY;
  const model = process.env.EMBEDDING_MODEL ?? "bge-m3";
  // A modell-verzió a szolgáltatónál nem mindig jön vissza a válaszban;
  // ezért konfigból vesszük (F4: a tárolt vektor mellé kell).
  const version = process.env.EMBEDDING_MODEL_VERSION ?? "unknown";
  if (!url) throw new Error("Hiányzó EMBEDDING_PROVIDER_URL környezeti változó.");
  if (!apiKey) throw new Error("Hiányzó EMBEDDING_API_KEY környezeti változó.");
  return { url, apiKey, model, version };
}

/** Determinisztikus MOCK-vektor: a szöveg sha256-magjából 1024 lebegő-
 *  pontos szám, egységhosszúra normálva. Ugyanaz a szöveg → ugyanaz a
 *  vektor (koszinusz 1.0); eltérő szöveg → eltérő vektor. Nem szemantikus
 *  — a determinizmus a cél (a szűrés-érvényesülés és a rangsor-alak
 *  lokális igazolásához). */
function mockVector(text: string): number[] {
  const normalized = (text ?? "").trim().replace(/\s+/g, " ");
  const out = new Array<number>(EMBEDDING_DIM);
  let norm = 0;
  // 32 bájtos mag blokkokból számoljuk a komponenseket (counter-mód).
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    const h = createHash("sha256")
      .update(`${normalized}#${i}`, "utf8")
      .digest();
    // az első 4 bájt → [-1, 1)
    const u = h.readUInt32BE(0) / 0xffffffff;
    const v = u * 2 - 1;
    out[i] = v;
    norm += v * v;
  }
  const len = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBEDDING_DIM; i++) out[i] /= len;
  return out;
}

/**
 * Embedding-generálás egy vagy több szövegre. A visszatérő tömb elemenként
 * a vektort + a modell nevét/verzióját adja (a bemenettel azonos sorrendben).
 *
 * MOCK módban determinisztikus; élesben OpenAI-kompatibilis batch-hívás.
 */
export async function embed(texts: string[]): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return [];

  if (isMock()) {
    return texts.map((t) => ({
      vector: mockVector(t),
      model: MOCK_MODEL,
      modelVersion: MOCK_MODEL_VERSION,
    }));
  }

  const cfg = providerConfig();
  const res = await fetch(`${cfg.url.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ model: cfg.model, input: texts }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Embedding-hívás sikertelen (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    data?: { embedding?: number[]; index?: number }[];
  };
  const data = json.data ?? [];
  // az index szerint rendezzük (a szolgáltató nem garantálja a sorrendet)
  const byIndex = new Map<number, number[]>();
  data.forEach((d, i) => byIndex.set(d.index ?? i, d.embedding ?? []));
  return texts.map((_, i) => {
    const vector = byIndex.get(i) ?? [];
    if (vector.length !== EMBEDDING_DIM) {
      throw new Error(
        `Váratlan embedding-dimenzió: ${vector.length} (várt: ${EMBEDDING_DIM}). ` +
          `A vector(${EMBEDDING_DIM}) oszlop modell-függő — dimenzió-váltás új migráció.`,
      );
    }
    return { vector, model: cfg.model, modelVersion: cfg.version };
  });
}

/** Egyetlen szöveg embeddingje (kényelmi burkoló). */
export async function embedOne(text: string): Promise<EmbeddingResult> {
  const [r] = await embed([text]);
  return r;
}

/** pgvector szöveg-literál egy vektorból (pl. "[0.1,0.2,...]"). A
 *  supabase-js/PostgREST a vector-t szövegként adja át; az RPC vector(1024)
 *  paramétere ezt elfogadja. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

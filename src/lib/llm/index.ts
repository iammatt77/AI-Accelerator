import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ArtifactTypeDef } from "@/lib/artifacts/config";

// ─────────────────────────────────────────────────────────────
// LLM-ADAPTER — a governance magja.
//
// EGYETLEN belépő minden LLM-híváshoz. A hívó NEM tud az Anthropicről:
// az interfész csatorna-független. A jelenlegi implementáció direkt Anthropic
// API (Commercial Terms). A váltás-trigger (első EU-rezidens ügyfél) esetén a
// Bedrock EU / Vertex EU implementáció UGYANEZEN interfész mögé kerül, a hívó
// kód érintése nélkül.
//
// TILOS az adapteren kívül bárhol Anthropic-hívás. A kulcs sosem kerül kliensre
// (a "server-only" import ezt build-időben kikényszeríti).
//
// i18n-VÉDŐKORLÁT: a generált artefaktum a UI-nyelvtől (hu/en) FÜGGETLENÜL
// magyar — az adapter és a promptjai az i18n-rétegtől érintetlenek.
//
// MOCK_LLM=1: determinisztikus fixture-mód a hálózat nélküli dev/teszt
// futáshoz (self-check). Éles/Preview környezetben a változó nincs beállítva,
// így az éles viselkedést nem érinti.
// ─────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "claude-opus-4-8";

function getModel(): string {
  return process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
}

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Hiányzó ANTHROPIC_API_KEY környezeti változó.");
  }
  return new Anthropic({ apiKey });
}

function isMock(): boolean {
  return process.env.MOCK_LLM === "1";
}

/** A válaszból kinyeri a szöveges (text) blokkok összefűzött tartalmát. */
function textFromMessage(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/** Eltávolítja az esetleges ```json ... ``` kódkerítést. */
function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    return fenced[1].trim();
  }
  return text.trim();
}

// ── Közös bemenet-típusok ────────────────────────────────────

/** Számozott forrás (1..n) — a [n] hivatkozások és a source_indices erre
 *  a számozásra mutatnak. */
export interface LlmSource {
  /** 1-alapú sorszám a forrás-listában. */
  index: number;
  title: string;
  text: string;
}

function renderSources(sources: LlmSource[]): string {
  return sources
    .map((s) => `[${s.index}] ${s.title}\n${s.text}`)
    .join("\n\n---\n\n");
}

// ── generateDraft (#1 örökség — a 4. lépés kivezeti) ─────────
// A cockpit régi „Input & generation" blokkja használja; a fázis-
// munkaterület (extract + generateBody) átvételekor törlendő.

export interface GenerateDraftParams {
  phase: string;
  structuredInputs?: Record<string, unknown>;
  rawMaterial: string;
  templateKey?: string;
}

export interface GenerateDraftResult {
  body: string;
}

export async function generateDraft(
  params: GenerateDraftParams,
): Promise<GenerateDraftResult> {
  const { phase, structuredInputs, rawMaterial, templateKey } = params;

  const system = [
    "Te egy AI-implementációs tanácsadói rendszer generálási motorja vagy.",
    "Feladatod: nyers ügyfélanyagból strukturált, tömör, magyar nyelvű draftot készíteni,",
    "amelyet egy ember tanácsadó ezután áttekint és jóváhagy.",
    "A draft legyen világos, jól tagolt (címsorok, felsorolások), és kizárólag a",
    "megadott forrásanyagra támaszkodjon — ne találj ki tényeket.",
  ].join(" ");

  const contextLines: string[] = [`Fázis: ${phase}`];
  if (templateKey) {
    contextLines.push(`Sablon: ${templateKey}`);
  }
  if (structuredInputs && Object.keys(structuredInputs).length > 0) {
    contextLines.push(
      `Strukturált bemenetek:\n${JSON.stringify(structuredInputs, null, 2)}`,
    );
  }

  const userPrompt = [
    contextLines.join("\n"),
    "",
    "── Nyers forrásanyag ──",
    rawMaterial,
    "",
    "Készíts ebből egy strukturált draftot a fázis céljának megfelelően.",
  ].join("\n");

  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });

  const body = textFromMessage(message);
  return { body };
}

// ── extract: nyers források → mezőjavaslatok ─────────────────

export interface ExtractedField {
  value: string;
  /** Csak olyan forrásszám, amelyből az érték ténylegesen származik. */
  source_indices: number[];
}

/** Mezőnként javaslat vagy null (= a forrásokban nincs meg → missing). */
export type ExtractResult = Record<string, ExtractedField | null>;

/**
 * Mező-kivonatolás (E1 első fele): a számozott forrásokból a típusdefiníció
 * mezőire javaslatot ad forrás-index-listával. Amit a forrás nem tartalmaz,
 * az null — a missing a KÍVÁNT viselkedés hiányzó adatnál, nem hiba.
 * A megerősítés (confirmed) mindig emberi lépés, nem itt történik.
 */
export async function extract(
  sources: LlmSource[],
  typeDef: ArtifactTypeDef,
): Promise<ExtractResult> {
  if (isMock()) {
    return mockExtract(sources, typeDef);
  }

  const system = [
    "Strukturált információ-kinyerő vagy egy AI-implementációs tanácsadói rendszerben.",
    "KIZÁRÓLAG érvényes JSON-t adsz vissza, semmilyen preambulumot vagy magyarázatot nem.",
    "SZIGORÚ SZABÁLY: ha egy mező információja a megadott forrásokban nem található meg,",
    "a mező értéke null. TILOS kitalálni, kikövetkeztetni, általános tudásból pótolni",
    "vagy plauzibilis értéket gyártani. A null a KÍVÁNT viselkedés hiányzó adatnál, nem hiba.",
    "A source_indices mezőben csak olyan forrás sorszáma szerepelhet, amelyből az érték",
    "ténylegesen származik.",
    "A kinyert értékek magyarul készülnek.",
  ].join(" ");

  const fieldLines = typeDef.fields
    .map((f) => `- "${f.key}": ${f.promptHint}`)
    .join("\n");
  const exampleShape = `{ ${typeDef.fields
    .map((f) => `"${f.key}": { "value": "<szöveg>", "source_indices": [1] } | null`)
    .join(", ")} }`;

  const userPrompt = [
    `Artefaktum-típus: ${typeDef.key}`,
    "",
    "Kinyerendő mezők:",
    fieldLines,
    "",
    "── Számozott források ──",
    renderSources(sources),
    "",
    "Add vissza pontosan ebben a JSON-alakban (minden mező-kulcs szerepeljen):",
    exampleShape,
    "Ha egy mezőhöz nincs információ a forrásokban: null. Csak JSON-t adj vissza.",
  ].join("\n");

  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });

  return parseExtractResult(textFromMessage(message), sources, typeDef);
}

/**
 * Parse-védelem: fence-eltávolítás + JSON.parse + mezőnkénti validálás.
 * Érvénytelen JSON → beszédes Error (a hívó action FormState-hibává alakítja).
 */
function parseExtractResult(
  raw: string,
  sources: LlmSource[],
  typeDef: ArtifactTypeDef,
): ExtractResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(raw));
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
        const source_indices = Array.isArray(obj.source_indices)
          ? obj.source_indices.filter(
              (n): n is number => Number.isInteger(n) && validIndices.has(n as number),
            )
          : [];
        result[fieldDef.key] = { value, source_indices };
        continue;
      }
    }
    // null, hiányzó kulcs vagy rontott alak → missing (nem hiba)
    result[fieldDef.key] = null;
  }
  return result;
}

// ── generateBody: megerősített mezők + sablon → md body ──────

export interface ConfirmedField {
  key: string;
  label: string;
  value: string;
}

/**
 * Sablon-vezérelt draft-generálás (E2): a megerősített mezőértékek TÉNYKÉNT
 * kezelendők; a body a típus-sablon szekció-vázát követi; [n] hivatkozás
 * KIZÁRÓLAG a megadott forrás-számozásból. Kimenet magyar, UI-nyelvtől
 * függetlenül.
 */
export async function generateBody(
  confirmedFields: ConfirmedField[],
  sources: LlmSource[],
  typeDef: ArtifactTypeDef,
): Promise<string> {
  if (isMock()) {
    return mockGenerateBody(confirmedFields, sources, typeDef);
  }

  const system = [
    "Te egy AI-implementációs tanácsadói rendszer generálási motorja vagy.",
    "Magyar nyelvű, tömör, szakmai artefaktum-draftot írsz markdown formátumban,",
    "amelyet egy ember tanácsadó ezután áttekint és jóváhagy.",
    "A megadott, megerősített mezőértékeket TÉNYKÉNT kezeled — nem írod felül",
    "és nem mondasz nekik ellent.",
    "Forráshivatkozás: [n] jelölőt KIZÁRÓLAG a megadott számozott forrásokra",
    "használhatsz, és csak ott, ahol az állítás ténylegesen abból a forrásból",
    "származik. Forrás nélküli kiegészítést minimalizálj — ami nem a mezőkből",
    "vagy a forrásokból jön, azt hagyd el.",
    "A kimenet NYELVE MAGYAR, függetlenül a bemenet nyelvétől.",
  ].join(" ");

  const fieldLines = confirmedFields
    .map((f) => `- ${f.label} (${f.key}): ${f.value}`)
    .join("\n");
  const sectionLines = typeDef.template.sections
    .map((s) => `## ${s.title}\n(instrukció: ${s.instruction})`)
    .join("\n\n");

  const userPrompt = [
    `Artefaktum-típus: ${typeDef.key}`,
    typeDef.template.instruction,
    "",
    "── Megerősített mezőértékek (tényként kezelendők) ──",
    fieldLines || "(nincs megerősített mező)",
    "",
    "── Számozott források ([n] hivatkozás csak ezekre) ──",
    renderSources(sources),
    "",
    "── Kötelező szekció-váz (pontosan ezekkel a ## címekkel, ebben a sorrendben) ──",
    sectionLines,
    "",
    "Írd meg a teljes markdown body-t. Csak a dokumentumot add vissza,",
    "az (instrukció: …) sorok nélkül.",
  ].join("\n");

  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });

  return textFromMessage(message);
}

// ── MOCK_LLM fixture (determinisztikus, hálózat nélkül) ──────

// Charter-mezők fixture-értékei. A `szponzor` és a `stakeholderek`
// SZÁNDÉKOSAN hiányzik (null): a self-check ezzel bizonyítja, hogy a
// hiányzó adat missing marad, és hogy az approve-blokk működik.
const MOCK_FIELD_VALUES: Record<string, { value: string; source_indices: number[] }> = {
  cel: {
    value: "A panaszkezelési folyamat AI-alkalmasságának felmérése",
    source_indices: [1],
  },
  scope: {
    value: "P0–P2, Felmérés-csomag",
    source_indices: [1, 2],
  },
  idokeret: {
    value: "6 hét",
    source_indices: [2],
  },
  sikerkriterium: {
    value: "Priorizált use case-shortlist + business case",
    source_indices: [3],
  },
};

function mockExtract(sources: LlmSource[], typeDef: ArtifactTypeDef): ExtractResult {
  const validIndices = new Set(sources.map((s) => s.index));
  const result: ExtractResult = {};
  for (const fieldDef of typeDef.fields) {
    const fixture = MOCK_FIELD_VALUES[fieldDef.key];
    if (!fixture) {
      result[fieldDef.key] = null;
      continue;
    }
    const source_indices = fixture.source_indices.filter((n) => validIndices.has(n));
    result[fieldDef.key] = { value: fixture.value, source_indices };
  }
  return result;
}

function mockGenerateBody(
  confirmedFields: ConfirmedField[],
  sources: LlmSource[],
  typeDef: ArtifactTypeDef,
): string {
  const byKey = new Map(confirmedFields.map((f) => [f.key, f]));
  const cite = (n: number) => (sources.some((s) => s.index === n) ? ` [${n}]` : "");
  const sections = typeDef.template.sections.map((section, i) => {
    // A szekcióhoz tartozó mezőértékek determinisztikus beemelése.
    const matching = confirmedFields.filter((f) =>
      section.instruction.includes(`\`${f.key}\``),
    );
    const lines =
      matching.length > 0
        ? matching.map((f) => `${f.value}${cite((i % 2) + 1)}`).join("\n\n")
        : "(fixture: ehhez a szekcióhoz nincs megerősített mező)";
    return `## ${section.title}\n\n${lines}`;
  });
  const fieldSummary = confirmedFields.length
    ? confirmedFields.map((f) => f.label).join(", ")
    : "nincs";
  return [
    `# ${typeDef.key} (fixture-draft)`,
    "",
    `_MOCK_LLM fixture — determinisztikus teszt-body. Megerősített mezők: ${fieldSummary}. Első forrás:${cite(1) || " nincs"}${cite(2)}_`,
    "",
    ...sections,
    "",
    `_Vége — ${byKey.size} megerősített mező, ${sources.length} forrás._`,
  ].join("\n");
}

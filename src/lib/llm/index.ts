import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { resolveTemplate, type ArtifactTypeDef } from "@/lib/artifacts/config";
import {
  parseExtractResult,
  parsePainPointsResult,
  parseUseCasesResult,
  type ExtractResult,
  type LlmSource,
  type PainPointProposal,
  type UseCaseProposal,
} from "./parse";

// A parse-réteg típusait innen is re-exportáljuk (a hívók @/lib/llm-ből
// importálnak). A tiszta válasz-feldolgozás a ./parse-ban él, hogy
// server-only/SDK nélkül, önállóan tesztelhető legyen (a #6-fix vakfolt).
export type {
  LlmSource,
  ExtractedField,
  ExtractResult,
  PainPointProposal,
  UseCaseProposal,
} from "./parse";

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

// ── Közös bemenet-típusok ────────────────────────────────────

function renderSources(sources: LlmSource[]): string {
  return sources
    .map((s) => `[${s.index}] ${s.title}\n${s.text}`)
    .join("\n\n---\n\n");
}

// ── extract: nyers források → mezőjavaslatok ─────────────────

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

// A tiszta válasz-feldolgozás (parseExtractResult + fabrikáció-kezelés)
// a ./parse modulban él — l. ott a #6-fix magyarázatát.

// ── extractPainPoints: P1 inputok → fájdalompont-javaslatok ──

/**
 * Fájdalompont-kivonatolás (P1, E1 első fele): a számozott forrásokból
 * fájdalompont-JAVASLATOKAT ad (cím + leírás + szó szerinti idézet +
 * súlyosság + forrás-indexek). Minden javaslat ai_suggested-ként landol —
 * a megerősítés emberi lépés. Üres eredmény = a forrásokban nincs
 * azonosítható fájdalompont (a hívó notice-t ad, nem hibát).
 */
export async function extractPainPoints(
  sources: LlmSource[],
): Promise<PainPointProposal[]> {
  if (isMock()) {
    return mockExtractPainPoints(sources);
  }

  const system = [
    "Fájdalompont-azonosító vagy egy AI-implementációs tanácsadói rendszerben.",
    "A megadott számozott forrásokból (interjúk, jegyzetek) üzleti fájdalompontokat",
    "azonosítasz. KIZÁRÓLAG érvényes JSON-tömböt adsz vissza, preambulum és",
    "magyarázat nélkül.",
    "SZIGORÚ SZABÁLY: csak olyan fájdalompontot adhatsz vissza, amely a forrásokban",
    "ténylegesen megjelenik. TILOS kitalálni, általánosítani vagy általános tudásból",
    "pótolni. Ha a források nem tartalmaznak fájdalompontot, üres tömböt adsz vissza",
    "— az üres tömb a KÍVÁNT viselkedés ilyenkor, nem hiba.",
    "A quote mező SZÓ SZERINTI idézet a forrásból — nem átfogalmazás; ha nincs",
    "alkalmas idézet, legyen null.",
    "A source_indices mezőben csak olyan forrás sorszáma szerepelhet, amelyből a",
    "fájdalompont ténylegesen származik.",
    "A kimenet magyarul készül.",
  ].join(" ");

  const userPrompt = [
    "Azonosítsd a forrásokban megjelenő üzleti fájdalompontokat.",
    "",
    "── Számozott források ──",
    renderSources(sources),
    "",
    "Add vissza pontosan ebben a JSON-alakban (tömb, elemenként):",
    `[{ "title": "<rövid cím>", "description": "<1-2 mondatos leírás>", "quote": "<szó szerinti idézet vagy null>", "severity": "low" | "medium" | "high" | null, "source_indices": [1] }]`,
    "Csak JSON-t adj vissza.",
  ].join("\n");

  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });

  return parsePainPointsResult(textFromMessage(message), sources);
}

// ── deriveUseCases: megerősített fájdalompontok → use case-javaslatok ──

/** Számozott (1..n), MEGERŐSÍTETT fájdalompont a származtatás bemenetén. */
export interface NumberedPainPoint {
  /** 1-alapú sorszám a modellnek átadott listában. */
  index: number;
  title: string;
  description: string | null;
  quote: string | null;
}

function renderPainPoints(painPoints: NumberedPainPoint[]): string {
  return painPoints
    .map((p) => {
      const parts = [`(${p.index}) ${p.title}`];
      if (p.description) parts.push(p.description);
      if (p.quote) parts.push(`Idézet: „${p.quote}”`);
      return parts.join("\n");
    })
    .join("\n\n");
}

/**
 * Use case-származtatás (P1, E1 első fele): a MEGERŐSÍTETT fájdalompontokból
 * AI use case-javaslatokat ad. Minden javaslat megjelöli, mely fájdalompont(ok)ra
 * válaszol (pain_point_refs — 1-alapú hivatkozás a megadott listára, m:n).
 * A modell NEM találhat ki új fájdalompontot; a ref nélküli javaslatot a parse
 * eldobja (szemantikai kontraktus, l. parseUseCasesResult).
 */
export async function deriveUseCases(
  painPoints: NumberedPainPoint[],
  sources: LlmSource[],
): Promise<UseCaseProposal[]> {
  if (isMock()) {
    return mockDeriveUseCases(painPoints, sources);
  }

  const system = [
    "AI use case-tervező vagy egy AI-implementációs tanácsadói rendszerben.",
    "A megadott, emberileg MEGERŐSÍTETT fájdalompontokból AI-alapú use case-",
    "javaslatokat készítesz. KIZÁRÓLAG érvényes JSON-tömböt adsz vissza,",
    "preambulum és magyarázat nélkül.",
    "SZIGORÚ SZABÁLYOK: minden use case legalább egy megadott fájdalompontra",
    "válaszol — a pain_point_refs a fájdalompont-lista zárójeles sorszámaira",
    "hivatkozik. TILOS a listán kívüli fájdalompontot kitalálni vagy arra",
    "hivatkozni. Egy use case több fájdalompontot is címezhet.",
    "A source_indices mezőben csak olyan forrás sorszáma szerepelhet, amely a",
    "use case-t ténylegesen alátámasztja; ha nincs ilyen, legyen üres tömb.",
    "A kimenet magyarul készül.",
  ].join(" ");

  const userPrompt = [
    "Készíts AI use case-javaslatokat a megerősített fájdalompontokból.",
    "",
    "── Megerősített fájdalompontok (sorszámozva) ──",
    renderPainPoints(painPoints),
    "",
    "── Számozott források (source_indices csak ezekre) ──",
    renderSources(sources),
    "",
    "Add vissza pontosan ebben a JSON-alakban (tömb, elemenként):",
    `[{ "title": "<rövid cím>", "description": "<1-2 mondatos leírás>", "pain_point_refs": [1], "source_indices": [1] }]`,
    "Csak JSON-t adj vissza.",
  ].join("\n");

  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });

  return parseUseCasesResult(textFromMessage(message), sources, painPoints.length);
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
  const template = resolveTemplate(typeDef);
  const sectionLines = template.sections
    .map((s) => `## ${s.title}\n(instrukció: ${s.instruction})`)
    .join("\n\n");

  const userPrompt = [
    `Artefaktum-típus: ${typeDef.key}`,
    template.instruction,
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

// Charter-mezők fixture-értékei. A `szponzor`, `sikerkriterium` és
// `stakeholderek` SZÁNDÉKOSAN hiányzik (null): a self-check ezzel
// bizonyítja, hogy a hiányzó adat missing marad, és hogy az approve-blokk
// működik (2 hiányzó kötelező → 3/5 teljesség).
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
};

function mockExtract(sources: LlmSource[], typeDef: ArtifactTypeDef): ExtractResult {
  const validIndices = new Set(sources.map((s) => s.index));
  const result: ExtractResult = {};
  for (const fieldDef of typeDef.fields) {
    // A charter-fixture SPECIÁLIS: a missing-viselkedést demonstrálja
    // (szponzor/sikerkritérium/stakeholderek nincs → missing).
    if (typeDef.key === "Projekt-charter") {
      const fixture = MOCK_FIELD_VALUES[fieldDef.key];
      if (!fixture) {
        result[fieldDef.key] = null;
        continue;
      }
      result[fieldDef.key] = {
        value: fixture.value,
        source_indices: [...new Set(fixture.source_indices.filter((n) => validIndices.has(n)))],
      };
      continue;
    }
    // Generikus fixture (#6): BÁRMELY típusdefiníció mezője determinisztikus
    // értéket kap [1]-es forrás-hivatkozással (ha van forrás).
    result[fieldDef.key] = {
      value: `${fieldDef.labelHu} — fixture-érték a forrásanyagból`,
      source_indices: validIndices.has(1) ? [1] : [],
    };
  }
  return result;
}

// Fájdalompont-fixture: 3 determinisztikus javaslat (idézettel, súlyosság-
// szórással); a forrás-indexek a tényleges számozásra szűrve. A 3. javaslat
// szándékosan idézet és severity nélkül jön (a null-ág is látszik).
// A 0-találat ág (→ látható notice) is determinisztikusan tesztelhető:
// ha MINDEN forrás triviálisan rövid (<40 karakter), a fixture üres
// listát ad — az „irreleváns bemenet" él-esetének megfelelője.
function mockExtractPainPoints(sources: LlmSource[]): PainPointProposal[] {
  if (sources.every((s) => s.text.trim().length < 40)) {
    return [];
  }
  const validIndices = new Set(sources.map((s) => s.index));
  const cite = (indices: number[]) => indices.filter((n) => validIndices.has(n));
  return [
    {
      title: "Lassú panasz-átfutás",
      description:
        "A panaszok átfutási ideje hosszú, a státuszról nincs visszajelzés az ügyfél felé.",
      quote: "hetekig ül a panasz, mire bárki ránéz",
      severity: "high",
      source_indices: cite([1]),
    },
    {
      title: "Kézi adatrögzítés duplikációja",
      description:
        "Ugyanazt az adatot több rendszerbe kézzel rögzítik, ami hibaforrás.",
      quote: "kétszer-háromszor visszük fel ugyanazt",
      severity: "medium",
      source_indices: cite([1, 2]),
    },
    {
      title: "Tudás a fejekben",
      description:
        "A folyamattudás nincs dokumentálva, egy-egy kollégán múlik a működés.",
      quote: null,
      severity: null,
      source_indices: cite([2]),
    },
  ];
}

// Use case-fixture: 2 determinisztikus javaslat lánc-hivatkozással; a
// pain_point_refs a ténylegesen átadott lista hosszára szűrve (minden ref
// érvényes marad 1 megerősített fájdalompont esetén is).
function mockDeriveUseCases(
  painPoints: NumberedPainPoint[],
  sources: LlmSource[],
): UseCaseProposal[] {
  const validSource = new Set(sources.map((s) => s.index));
  const refs = (candidates: number[]) =>
    candidates.filter((r) => r >= 1 && r <= painPoints.length);
  const proposals: UseCaseProposal[] = [
    {
      title: "AI-alapú panasz-triázs és státusz-értesítés",
      description:
        "A beérkező panaszok automatikus kategorizálása és priorizálása, státusz-értesítéssel.",
      pain_point_refs: refs([1, 2]),
      source_indices: [1].filter((n) => validSource.has(n)),
    },
    {
      title: "Dokumentum-kivonatoló asszisztens a rögzítéshez",
      description:
        "A bejövő dokumentumokból strukturált adatok kinyerése, egyszeri rögzítéssel.",
      pain_point_refs: refs([2]),
      source_indices: [2].filter((n) => validSource.has(n)),
    },
  ];
  // A parse-kontraktus tükrözése: ref nélkül nincs javaslat.
  return proposals.filter((p) => p.pain_point_refs.length > 0);
}

function mockGenerateBody(
  confirmedFields: ConfirmedField[],
  sources: LlmSource[],
  typeDef: ArtifactTypeDef,
): string {
  const byKey = new Map(confirmedFields.map((f) => [f.key, f]));
  const cite = (n: number) => (sources.some((s) => s.index === n) ? ` [${n}]` : "");
  const sections = resolveTemplate(typeDef).sections.map((section, i) => {
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

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { resolveTemplate, type ArtifactTypeDef } from "@/lib/artifacts/config";
import {
  parseBenefitSuggestion,
  parseExtractResult,
  parsePainPointsResult,
  parsePilotSuggestion,
  parseStakeholdersResult,
  parseUseCasesResult,
  type BenefitSuggestion,
  type ExtractResult,
  type LlmSource,
  type PainPointProposal,
  type PilotSuggestion,
  type StakeholderProposal,
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
  StakeholderProposal,
  UseCaseProposal,
  BenefitSuggestion,
  PilotSuggestion,
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

  // Csomag A (A1/A2): a modul-tulajdonú mezők NEM részei az extract-
  // sémának — azokat kizárólag a modul-sync írja.
  const extractable = typeDef.fields.filter((f) => !f.moduleOwned);
  const fieldLines = extractable
    .map((f) => `- "${f.key}": ${f.promptHint}`)
    .join("\n");
  const exampleShape = `{ ${extractable
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

// ── extractStakeholders: charter/interjú → stakeholder-javaslatok (#8) ──

/**
 * Stakeholder-kivonatolás (E1 első fele): a számozott forrásokból (charter
 * „stakeholderek" mező, interjú-inputok) stakeholder-JAVASLATOKAT ad (név +
 * titulus + forrás-indexek + opcionális influence/impact score). Minden
 * javaslat ai_suggested-ként landol — a megerősítés emberi lépés.
 *
 * SCORE (c-minta): az influence/impact score CSAK akkor szerepel, ha a forrás
 * konkrét befolyás/hatás-alapot ad rá; ha nincs alap, a mező KIMARAD (null
 * lesz) — a modell nem tippel score-t alap nélkül.
 *
 * A communication_strategy SOHA nem szerepel a kivonatolt válaszban —
 * kizárólag manuális mező (a rendszerprompt is tiltja).
 */
export async function extractStakeholders(
  sources: LlmSource[],
): Promise<StakeholderProposal[]> {
  if (isMock()) {
    return mockExtractStakeholders(sources);
  }

  const system = [
    "Stakeholder-azonosító vagy egy AI-implementációs tanácsadói rendszerben.",
    "A megadott számozott forrásokból (Projekt-charter, interjúk, jegyzetek)",
    "a projektben érintett stakeholdereket (személyek, szerepkörök) azonosítasz.",
    "KIZÁRÓLAG érvényes JSON-tömböt adsz vissza, preambulum és magyarázat nélkül.",
    "SZIGORÚ SZABÁLY: csak olyan stakeholdert adhatsz vissza, aki a forrásokban",
    "TÉNYLEGESEN szerepel. TILOS kitalálni, általánosítani vagy általános tudásból",
    "pótolni. Ha a források nem tartalmaznak stakeholdert, üres tömböt adsz vissza",
    "— az üres tömb a KÍVÁNT viselkedés ilyenkor, nem hiba.",
    "SCORE-SZABÁLY: az influence_score (befolyás) és impact_score (érintettség)",
    "1–5 egész, és CSAK akkor szerepeljen, ha a forrás konkrét alapot ad rá",
    "(befolyás/hatás-utalás). Ha nincs ilyen alap, HAGYD KI a mezőt — tilos",
    "tippelni. A source_indices csak olyan forrás sorszáma lehet, amelyből a",
    "stakeholder ténylegesen származik.",
    "A kommunikációs stratégiát SOHA ne add meg — az kizárólag emberi, manuális mező.",
    "A kimenet magyarul készül.",
  ].join(" ");

  const userPrompt = [
    "Azonosítsd a forrásokban megjelenő stakeholdereket (érintett személyek, szerepkörök).",
    "",
    "── Számozott források ──",
    renderSources(sources),
    "",
    "Add vissza pontosan ebben a JSON-alakban (tömb, elemenként):",
    `[{ "name": "<név vagy szerepkör>", "title": "<titulus/szerep vagy null>", "influence_score": 1-5 (csak ha van alap, egyébként hagyd ki), "impact_score": 1-5 (csak ha van alap, egyébként hagyd ki), "source_indices": [1] }]`,
    "Csak JSON-t adj vissza. A communication_strategy mezőt NE add meg.",
  ].join("\n");

  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });

  return parseStakeholdersResult(textFromMessage(message), sources);
}

// ── suggestBenefitInputs / suggestPilotDefinition: P2-mélység (#9) ──

/**
 * A Business case haszon-kalkulátor BEMENET-javaslata (#9, E1 első fele): a
 * P1-outputból / a forrásokból javasol felszabadult kapacitást és óradíjat —
 * c-minta: CSAK ha konkrét alap van (pl. „4 fő, napi 2 óra"); ha nincs, a mező
 * null (a modell nem tippel). A „fék" (realizálható %) SOHA nem javasolt —
 * kizárólag emberi döntés (a rendszerprompt is tiltja).
 */
export async function suggestBenefitInputs(
  sources: LlmSource[],
): Promise<BenefitSuggestion> {
  if (isMock()) {
    return mockSuggestBenefit(sources);
  }
  const system = [
    "Business case haszon-elemző vagy egy AI-implementációs tanácsadói rendszerben.",
    "A forrásokból KIZÁRÓLAG a felszabaduló kapacitást (óra/hó) és a terhelt",
    "óradíjat (Ft/óra) becsülöd, ha van rá KONKRÉT alap a forrásban (pl. létszám,",
    "napi óraszám, munkanapok, bérszint). Ha nincs alap, a mező null — TILOS tippelni.",
    "A realizálható %-ot (a „féket”) SOHA nem adod meg — az kizárólag emberi",
    "üzleti ítélet. KIZÁRÓLAG érvényes JSON-t adsz vissza.",
    "A source_indices csak olyan forrás sorszáma, amelyből a becslés származik.",
  ].join(" ");
  const userPrompt = [
    "Becsüld a haszon-kalkulátor bemeneteit a forrásokból.",
    "",
    "── Számozott források ──",
    renderSources(sources),
    "",
    "Add vissza pontosan ebben a JSON-alakban:",
    `{ "felszabadult_kapacitas_ora_ho": <szám vagy null>, "oradij_ft": <szám vagy null>, "source_indices": [1] }`,
    "A realizálható %-ot NE add meg. Csak JSON-t adj vissza.",
  ].join("\n");
  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 1000,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });
  return parseBenefitSuggestion(textFromMessage(message), sources);
}

/**
 * A Pilot-terv sikerdefiníció MÉRHETŐ részének javaslata (#9): mérési metrika,
 * baseline, siker-küszöb, hipotézis — c-minta, alap nélkül null. A döntési
 * szabály (scale/pivot/stop) SOHA nem javasolt — emberi ítélet.
 */
export async function suggestPilotDefinition(
  sources: LlmSource[],
): Promise<PilotSuggestion> {
  if (isMock()) {
    return mockSuggestPilot(sources);
  }
  const system = [
    "Pilot-tervező vagy egy AI-implementációs tanácsadói rendszerben.",
    "A forrásokból javaslod a mérhető sikerdefiníciót: a mérési metrikát, a",
    "baseline (kiinduló) értéket egységgel, a siker-küszöböt egységgel, és a",
    "tesztelt hipotézist — CSAK ha van rá konkrét alap; ha nincs, a mező null",
    "(nem tippelsz). A döntési szabályt (scale/pivot/stop) SOHA nem adod meg —",
    "az kizárólag emberi ítélet. KIZÁRÓLAG érvényes JSON-t adsz vissza.",
  ].join(" ");
  const userPrompt = [
    "Javasold a pilot mérhető sikerdefinícióját a forrásokból.",
    "",
    "── Számozott források ──",
    renderSources(sources),
    "",
    "Add vissza pontosan ebben a JSON-alakban:",
    `{ "meresi_metrika": "<metrika vagy null>", "baseline_ertek": <szám vagy null>, "baseline_egyseg": "<egység vagy null>", "kuszob_ertek": <szám vagy null>, "kuszob_egyseg": "<egység vagy null>", "hipotezis": "<hipotézis vagy null>", "source_indices": [1] }`,
    "A scale/pivot/stop döntési szabályt NE add meg. Csak JSON-t adj vissza.",
  ].join("\n");
  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 1500,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });
  return parsePilotSuggestion(textFromMessage(message), sources);
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
    // A1/A2 partíció: modul-mezőre a mock sem javasol (extract-séma szűrés).
    if (fieldDef.moduleOwned) {
      result[fieldDef.key] = null;
      continue;
    }
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

// Stakeholder-fixture (#8): 3 determinisztikus javaslat. A c-minta
// demonstrálása: az első KETTŐ score-ral jön (a forrás befolyás/hatás-alapot
// ad), a HARMADIK szándékosan score NÉLKÜL (nincs alap → null marad, a modell
// nem tippel — negatív teszt (a)). A communication_strategy SEHOL nem szerepel
// (negatív teszt (b): kizárólag manuális). A 0-találat ág (→ látható notice)
// is determinisztikus: ha MINDEN forrás triviálisan rövid (<40 karakter), a
// fixture üres listát ad.
function mockExtractStakeholders(sources: LlmSource[]): StakeholderProposal[] {
  if (sources.every((s) => s.text.trim().length < 40)) {
    return [];
  }
  const validIndices = new Set(sources.map((s) => s.index));
  const cite = (indices: number[]) => indices.filter((n) => validIndices.has(n));
  return [
    {
      name: "Üzemvezető",
      title: "Panaszkezelési folyamatgazda",
      influence_score: 5,
      impact_score: 4,
      source_indices: cite([1]),
    },
    {
      name: "Ügyintézői csapat",
      title: "Panasz-válaszadók",
      influence_score: 2,
      impact_score: 5,
      source_indices: cite([1, 2]),
    },
    {
      // Score NÉLKÜL: a forrás csak megemlíti, de nincs befolyás/hatás-alap
      // → influence/impact null (a modell nem tippel — c-minta, (a) teszt).
      name: "Vezetőség",
      title: "Riport-fogadó",
      influence_score: null,
      impact_score: null,
      source_indices: cite([1]),
    },
  ];
}

// P2 haszon-kalkulátor bemenet-fixture (#9): a c-minta demonstrálása. Ha van
// használható forrás (nem triviálisan rövid), a kapacitást és az óradíjat
// javasolja (a referencia 168 ó/hó · 6 500 Ft/óra értékeivel); ha MINDEN
// forrás rövid (<40 kar.), üres javaslat (nincs alap → az AI nem tippel,
// negatív teszt). A féket SOHA nem adja (nincs is a shape-ben).
function mockSuggestBenefit(sources: LlmSource[]): BenefitSuggestion {
  if (sources.every((s) => s.text.trim().length < 40)) {
    return { felszabadult_kapacitas_ora_ho: null, oradij_ft: null, source_indices: [] };
  }
  const valid = new Set(sources.map((s) => s.index));
  return {
    felszabadult_kapacitas_ora_ho: 168,
    oradij_ft: 6500,
    source_indices: [1].filter((n) => valid.has(n)),
  };
}

// P2 pilot sikerdefiníció-fixture (#9): metrika + baseline + küszöb +
// hipotézis a referencia szerint (AHT 15 → <10 perc). A scale/pivot/stop
// döntési szabályt SOHA nem adja (emberi ítélet). Rövid források → üres.
function mockSuggestPilot(sources: LlmSource[]): PilotSuggestion {
  if (sources.every((s) => s.text.trim().length < 40)) {
    return {
      meresi_metrika: null,
      baseline_ertek: null,
      baseline_egyseg: null,
      kuszob_ertek: null,
      kuszob_egyseg: null,
      hipotezis: null,
      source_indices: [],
    };
  }
  const valid = new Set(sources.map((s) => s.index));
  return {
    meresi_metrika: "AHT — átlagos kezelési idő",
    baseline_ertek: 15,
    baseline_egyseg: "perc",
    kuszob_ertek: 10,
    kuszob_egyseg: "perc",
    hipotezis:
      "Ha az AI-asszisztens előszűr és válasz-javaslatot ad, az AHT 15 → 10 perc alá csökken.",
    source_indices: [1, 2].filter((n) => valid.has(n)),
  };
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

// ── Folyamattérkép (#10): AS-IS kivonatolás + TO-BE tervezés ──

// A folyamat-javaslat parse-a a lib/processmap/parse-ban él (tiszta,
// önállóan tesztelt). Itt csak a prompt + a determinisztikus mock.
import { parseProcessProposal, type ParsedProcess } from "@/lib/processmap/parse";
export type { ParsedProcess } from "@/lib/processmap/parse";

// A shape maga DEMONSTRÁLJA az elágazást ÉS az összefutást (merge): a döntési
// (decide) node-nak KÉT kimenő next-eleme van, két KÜLÖNBÖZŐ cél-node-ba, majd
// a két ág UGYANARRA a merge-node-ra fut vissza. Ez a minta gátolja a hamis
// linearitást (a #10-layout gyökérok: a modell a régi 1-elemű next-mintát
// utánozta, ezért minden lépés egy oszlopba került).
const PROCESS_SHAPE = [
  `{ "title": "<a folyamat rövid címe>", "steps": [`,
  `{ "id": "s1", "title": "<első lépés>", "sub": "<rövid metaadat vagy null>",`,
  `"type": "start_end", "desc": "<1-2 mondat>", "quote": "<szó szerinti idézet>",`,
  `"loc": "<hely a leiratban vagy üres>", "open_points": [], "next": [{"to":"s2","label":null}] },`,
  `{ "id": "s2", "title": "<döntési kérdés>",`,
  `"type": "decide", "desc": "<mit dönt el>", "quote": "<idézet>", "loc": "<hely>",`,
  `"open_points": [{"level":"blocker"|"important"|"clarify","text":"<nyitott kérdés>"}],`,
  `"next": [{"to":"s3","label":"<1. ág feltétele, pl. Igen>"}, {"to":"s4","label":"<2. ág feltétele, pl. Nem>"}] },`,
  `{ "id": "s3", "title": "<1. ág lépése>", "sub": null, "type": "human", "desc": "<…>",`,
  `"quote": "<idézet>", "loc": "<hely>", "open_points": [], "next": [{"to":"s5","label":null}] },`,
  `{ "id": "s4", "title": "<2. ág lépése>", "sub": null, "type": "human", "desc": "<…>",`,
  `"quote": "<idézet>", "loc": "<hely>", "open_points": [], "next": [{"to":"s5","label":null}] },`,
  `{ "id": "s5", "title": "<közös záró lépés — a két ág ide fut össze>", "sub": null,`,
  `"type": "start_end", "desc": "<…>", "quote": "<idézet>", "loc": "<hely>", "open_points": [], "next": [] }`,
  `] }`,
  `A "type" a fenti készletből választandó (start_end / human / system / decide /`,
  `ai_intervention / control_hitl); ha egyik sem illik, kisbetűs snake_case új típus.`,
].join(" ");

/**
 * Folyamat-kivonatolás (#10, E1 első fele): EGY nyers leiratból bejárható
 * lépéslistát épít (node-topológia + élek). Minden lépés forrás-hivatkozással
 * (szó szerinti idézet + hely) — ami a leiratban nincs benne, az NEM kerül a
 * térképre. A megerősítés/jóváhagyás emberi lépés. AS-IS-hez és bevitt
 * TO-BE-leirathoz ugyanez a belépő (a kind a hívónál dől el).
 */
export async function extractProcessMap(
  source: LlmSource,
  refLabel: string,
): Promise<ParsedProcess> {
  if (isMock()) {
    return mockExtractProcessMap(source, refLabel);
  }

  const system = [
    "Üzleti folyamat-elemző vagy egy AI-implementációs tanácsadói rendszerben.",
    "A megadott nyers leiratból a LEÍRT folyamat lépéseit rekonstruálod, bejárható",
    "gráfként. KIZÁRÓLAG érvényes JSON-t adsz vissza. SZIGORÚ SZABÁLY: csak olyan",
    "lépést vehetsz fel, amelyre a leiratban tényleges alap van; a quote mező",
    "SZÓ SZERINTI idézet a forrásból (rövidíthetsz …-tal, de nem fogalmazhatsz át).",
    "TILOS lépést kitalálni vagy általános folyamat-tudásból pótolni.",
    "A type az adott készletből választandó; ha egyik sem illik, használhatsz új,",
    "kisbetűs snake_case típust — a készlet a folyamat jellegéhez idomul.",
    "ELÁGAZÁS (kötelező, ha a folyamatban van): minden döntési (decide) node-nak",
    "LEGALÁBB KÉT kimenő next-eleme legyen, KÜLÖNBÖZŐ cél-node-okba — ezek a döntés",
    "PÁRHUZAMOS ágai, NEM egymást követő lépések. Az ágak label-je az ág",
    "feltétele/kimenete (pl. „Igen”, „Nem · túl bonyolult”). Ha az ágak később közös",
    "lépésre futnak, MINDKÉT ág next-je UGYANARRA a merge-node-ra mutasson — a közös",
    "lépést NE ismételd meg két külön node-ként. Ha egy ág a végéig külön fut (nincs",
    "merge), az is rendben. Kerüld a HAMIS LINEARITÁST: a leirat „ha X, akkor…,",
    "egyébként…” szerkezetét elágazó next-ekkel add vissza, ne egymás utáni",
    "lépésekként. DE ne találj ki elágazást ott, ahol a folyamat valóban lineáris.",
    "A kezdő és a záró állapot type-ja start_end. Az eredmény magyarul készül.",
  ].join(" ");

  const userPrompt = [
    "── Nyers leirat ──",
    `${refLabel} ${source.title}`,
    source.text,
    "",
    "Add vissza pontosan ebben a JSON-alakban:",
    PROCESS_SHAPE,
    "Csak JSON-t adj vissza.",
  ].join("\n");

  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 6000,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });
  return parseProcessProposal(textFromMessage(message), refLabel, source.title);
}

export interface ProcessBasisPain {
  title: string;
  description: string | null;
}

export interface AsIsStepSummary {
  title: string;
  type: string;
  desc: string;
}

/**
 * TO-BE tervezés (#10, AI-javasolt eredet): a MEGERŐSÍTETT fájdalompontokból
 * + az AS-IS lépéslistából jövőbeli folyamatot javasol — ai_intervention
 * (hol lép be az AI) és control_hitl (hol kötelező emberi kontroll) node-okkal.
 * Ez TERVEZÉS (emberi ítélet is kell) — minden lépés quote-ja az eredet-
 * megjelölés (mely fájdalompont/AS-IS lépés az alapja), nem leirat-idézet.
 * A javaslat draft — a tanácsadó iterál rajta és egyben hagyja jóvá.
 */
export async function suggestToBeProcess(
  asIsSteps: AsIsStepSummary[],
  pains: ProcessBasisPain[],
): Promise<ParsedProcess> {
  if (isMock()) {
    return mockSuggestToBeProcess(asIsSteps, pains);
  }

  const system = [
    "AI-implementációs folyamat-tervező vagy. A feladat: az ügyfél MAI (AS-IS)",
    "folyamatából és a feltárt fájdalompontokból JÖVŐBELI (TO-BE) folyamatot",
    "tervezni. KIZÁRÓLAG érvényes JSON-t adsz vissza.",
    "Szabályok: ai_intervention type-ú lépés oda kerül, ahol az AI ténylegesen",
    "kivált vagy támogat egy mai lépést; control_hitl oda, ahol emberi kontroll",
    "KÖTELEZŐ (kimenő automata tartalom emberi jóváhagyás nélkül tilos).",
    "A quote mező itt EREDET-MEGJELÖLÉS: nevezd meg, melyik fájdalompontból",
    "és/vagy melyik AS-IS lépésből vezetted le a lépést, és jelöld, hogy",
    "felülvizsgálandó javaslat. TILOS számszerű hatást (időt, százalékot,",
    "költséget) kitalálni — ha a bemenetben nincs szám, a lépés sub-ja ne",
    "tartalmazzon számot.",
    "ELÁGAZÁS: minden döntési (decide) node-nak LEGALÁBB KÉT kimenő next-eleme",
    "legyen, KÜLÖNBÖZŐ cél-node-okba (a döntés párhuzamos ágai, nem egymást követő",
    "lépések), ág-label-lel; ahol az ágak közös lépésre futnak, mindkettő next-je",
    "UGYANARRA a merge-node-ra mutasson (a közös lépést ne duplikáld). Kerüld a",
    "hamis linearitást, de elágazást csak ott adj, ahol a folyamat tényleg elágazik.",
    "Az eredmény magyarul készül.",
  ].join(" ");

  const painLines =
    pains.length > 0
      ? pains
          .map((p, i) => `${i + 1}. ${p.title}${p.description ? ` — ${p.description}` : ""}`)
          .join("\n")
      : "(nincs megerősített fájdalompont — az AS-IS gyenge pontjaiból indulj ki)";
  const stepLines = asIsSteps
    .map((s, i) => `${i + 1}. [${s.type}] ${s.title} — ${s.desc}`)
    .join("\n");

  const userPrompt = [
    "── Fájdalompontok ──",
    painLines,
    "",
    "── AS-IS lépések ──",
    stepLines,
    "",
    "Tervezd meg a TO-BE folyamatot. Add vissza pontosan ebben a JSON-alakban:",
    PROCESS_SHAPE,
    "A loc mező maradjon üres. Csak JSON-t adj vissza.",
  ].join("\n");

  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 6000,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });
  return parseProcessProposal(textFromMessage(message), "AI", "eredet: AI-terv");
}

// ── Folyamattérkép mock-fixture-ök (determinisztikus) ────────

// A demo panaszkezelés-leiratához igazított AS-IS: lineáris lánc + egy
// kétágú döntés, ami visszacsatlakozik (a bejárás/ág-választás tesztelhető).
// Az idézetek SZÓ SZERINT a reset-demo transzkriptjéből valók, hogy a
// nyers-leirat overlay kiemelése működjön. Rövid forrásnál (<40 kar.) üres
// (nincs alap → az AI nem tippel — negatív teszt).
function mockExtractProcessMap(source: LlmSource, refLabel: string): ParsedProcess {
  if (source.text.trim().length < 40) {
    return { title: "", graph: { nodes: [], edges: [] } };
  }
  const steps = [
    { id: "s1", title: "Panasz beérkezik", sub: "email · központi cím", type: "start_end", desc: "A panaszok egy központi címre érkeznek, napi ~40 darab, hullámzó eloszlással.", quote: "Napi negyven körül jön be, hullámzik.", loc: "04:12", open_points: [], next: [{ to: "s2", label: null }] },
    { id: "s2", title: "Kézi szétosztás kategóriákba", sub: "1 fő · akár másfél nap", type: "human", desc: "Egy kolléga reggelente kézzel osztja szét a leveleket kategóriákba — a szétosztás akár másfél napig tart.", quote: "minden reggel egy kolléga végigmegy a leveleken és szétdobálja őket kategóriákba", loc: "04:12", open_points: [{ level: "clarify", text: "Végleges kategória-lista egyeztetendő." }], next: [{ to: "s3", label: null }] },
    { id: "s3", title: "Sürgős reklamáció?", sub: null, type: "decide", desc: "Nincs előszűrés — a sürgős reklamáció ugyanabban a sorban áll, mint a sima érdeklődés; a megkülönböztetés az ügyintézőre marad.", quote: "A sürgős reklamációk is ugyanabban a sorban állnak, mint a sima érdeklődés. Nincs előszűrés.", loc: "09:48", open_points: [], next: [{ to: "s4", label: "Igen · sürgős" }, { to: "s5", label: "Nem · normál" }] },
    { id: "s4", title: "Azonnali kézi válasz", sub: "sürgős ág", type: "human", desc: "A sürgősnek felismert reklamációt az ügyintéző soron kívül, kézzel válaszolja meg.", quote: "A sürgős reklamációk is ugyanabban a sorban állnak, mint a sima érdeklődés.", loc: "09:48", open_points: [{ level: "blocker", text: "Sürgősség-kritérium nincs leírva — ki dönti el?" }], next: [{ to: "s6", label: null }] },
    { id: "s5", title: "Válasz sablon nélkül", sub: "ügyintézőnként eltérő", type: "human", desc: "Nincs egységes sablon — mindenki a maga módján ír, a hangnem és a terjedelem ingadozik.", quote: "nincs egységes sablonunk, mindenki úgy ír, ahogy tud", loc: "18:37", open_points: [{ level: "important", text: "Sablon-készlet hiányzik — ki a gazdája?" }], next: [{ to: "s6", label: null }] },
    { id: "s6", title: "Havi riport kézzel Excelben", sub: "vezetőség felé", type: "system", desc: "A vezetőség havi riportot kér a panasz-okokról; ezt most kézzel számolják Excelben.", quote: "A vezetőség havi riportot kér a panasz-okokról, azt most kézzel számoljuk Excelben.", loc: "24:05", open_points: [], next: [{ to: "s7", label: null }] },
    { id: "s7", title: "Jegy lezárva", sub: null, type: "start_end", desc: "A panasz megválaszolva, az ügy lezárva.", quote: "Napi negyven körül jön be, hullámzik.", loc: "04:12", open_points: [], next: [] },
  ];
  return parseProcessProposal(
    JSON.stringify({ title: "Panaszkezelés — jelenlegi folyamat", steps }),
    refLabel,
    source.title,
  );
}

// TO-BE fixture: a fájdalompontokból + AS-IS-ből tervezett folyamat —
// ai_intervention + control_hitl node-okkal, eredet-megjelöléses quote-tal
// (nem fabrikál számot). Üres AS-IS-nél üres (nincs alap).
function mockSuggestToBeProcess(
  asIsSteps: AsIsStepSummary[],
  pains: ProcessBasisPain[],
): ParsedProcess {
  if (asIsSteps.length === 0) {
    return { title: "", graph: { nodes: [], edges: [] } };
  }
  const pain = (i: number) => pains[i]?.title ?? pains[0]?.title ?? "az AS-IS gyenge pontja";
  const basis = (p: string, s: string) =>
    `AI-javaslat — a(z) „${p}” fájdalompontból és az AS-IS „${s}” lépéséből levezetve. Felülvizsgálandó.`;
  const steps = [
    { id: "t1", title: "Panasz beérkezik", sub: "változatlan csatorna", type: "start_end", desc: "A beérkezés változatlan — a folyamat az érkezés után válik el az AS-IS-től.", quote: basis(pain(0), "Panasz beérkezik"), loc: "", open_points: [], next: [{ to: "t2", label: null }] },
    { id: "t2", title: "AI-előszűrés és kategorizálás", sub: "automatikus", type: "ai_intervention", desc: "Az AI egységes taxonómia szerint kategorizál és sürgősséget jelöl — a kézi szétosztás kiváltása.", quote: basis(pain(0), "Kézi szétosztás kategóriákba"), loc: "", open_points: [], next: [{ to: "t3", label: null }] },
    { id: "t3", title: "AI válasz-javaslat", sub: "sablon-alapú", type: "ai_intervention", desc: "Az AI a jóváhagyott sablonkészletből állít össze válasz-javaslatot az ügyintézőnek.", quote: basis(pain(1), "Válasz sablon nélkül"), loc: "", open_points: [{ level: "important", text: "Sablon-készlet összeállítása a bevezetés előtt." }], next: [{ to: "t4", label: null }] },
    { id: "t4", title: "Megbízható a javaslat?", sub: null, type: "decide", desc: "A javaslat megbízhatósága dönt: megfelelő javaslat ügyintézői jóváhagyásra megy, egyébként kézi válasz készül.", quote: basis(pain(1), "Sürgős reklamáció?"), loc: "", open_points: [], next: [{ to: "t5", label: "Igen · jóváhagyásra" }, { to: "t6", label: "Nem · kézi válasz" }] },
    { id: "t5", title: "Ügyintéző jóváhagyja / szerkeszti", sub: "HITL", type: "control_hitl", desc: "Automata válasz SOHA nem megy ki emberi jóváhagyás nélkül — az ügyintéző elfogadja, szerkeszti vagy elveti a javaslatot.", quote: basis(pain(1), "Válasz sablon nélkül"), loc: "", open_points: [], next: [{ to: "t7", label: null }] },
    { id: "t6", title: "Kézi válasz (edge case)", sub: "AI-javaslat háttérként", type: "human", desc: "Bizonytalan javaslatnál az ügyintéző kézzel válaszol — az AI-javaslat háttéranyagként elérhető.", quote: basis(pain(1), "Válasz sablon nélkül"), loc: "", open_points: [], next: [{ to: "t7", label: null }] },
    { id: "t7", title: "Riport automatikusan", sub: "AI-címkékből", type: "system", desc: "A havi vezetői riport az AI-címkékből áll össze — a kézi Excel-számolás kiváltása.", quote: basis(pain(0), "Havi riport kézzel Excelben"), loc: "", open_points: [], next: [{ to: "t8", label: null }] },
    { id: "t8", title: "Jegy lezárva + visszacsatolás", sub: "javaslat-minőség mérése", type: "start_end", desc: "A lezárás mellett az ügyintézői szerkesztések visszacsatolása méri a javaslatok minőségét.", quote: basis(pain(0), "Jegy lezárva"), loc: "", open_points: [], next: [] },
  ];
  return parseProcessProposal(
    JSON.stringify({ title: "Panaszkezelés — TO-BE (AI-javasolt)", steps }),
    "AI",
    "eredet: AI-terv",
  );
}

// ─────────────────────────────────────────────────────────────
// Folyamattérkép chat-szerkesztő (#10, Fázis 4)
// ─────────────────────────────────────────────────────────────

// A javaslat parse-a a lib/processmap/chat-ben él (tiszta, tesztelhető).
import { parseChatProposal, type ChatProposal } from "@/lib/processmap/chat";
export type { ChatProposal } from "@/lib/processmap/chat";

export interface ChatStepSummary {
  id: string;
  title: string;
  sub: string | null;
  type: string;
  desc: string;
}

const CHAT_SHAPE = [
  `{ "reply": "<rövid magyar válasz a tanácsadónak — mit készítettél elő>",`,
  `"changes": [`,
  `{ "op": "insert_after", "after_id": "<meglévő lépés id>", "title": "<új lépés címe>",`,
  `"sub": "<rövid metaadat vagy null>", "type": "<lépés-típus>", "desc": "<1-2 mondat>",`,
  `"note": "<mit és miért — a változás-jegyzethez>" },`,
  `{ "op": "update", "id": "<lépés id>", "title": "<opcionális>", "sub": "<opcionális>",`,
  `"desc": "<opcionális>", "type": "<opcionális>", "note": "<eredeti → módosított, miért>" },`,
  `{ "op": "remove", "id": "<lépés id>", "note": "<miért esik ki>" } ] }`,
].join(" ");

/**
 * Chat-szerkesztés (#10, HITL): a tanácsadó kérésére az asszisztens a
 * STRUKTURÁLT lépéslistára tesz változás-javaslatot — a nyers forrást SOHA
 * nem érinti. A javaslat NEM kerül automatikusan az ábrára: pendingként
 * tárolódik, az ember alkalmazza vagy elveti.
 */
export async function chatEditProcess(
  steps: ChatStepSummary[],
  userMessage: string,
): Promise<ChatProposal> {
  if (isMock()) {
    return mockChatEditProcess(steps, userMessage);
  }

  const system = [
    "Folyamat-szerkesztő asszisztens vagy egy AI-implementációs tanácsadói",
    "rendszerben. A tanácsadó kérésére a MEGADOTT lépéslistán javasolsz",
    "változásokat (insert_after / update / remove). KIZÁRÓLAG érvényes JSON-t",
    "adsz vissza. SZIGORÚ SZABÁLYOK: a nyers forrás-leiratot nem módosíthatod",
    "és nem is látod — csak a strukturált lépéslistát. Csak azt változtasd,",
    "amit a kérés ténylegesen kér; TILOS számszerű hatást (időt, százalékot,",
    "költséget) kitalálni. A type a meglévő készletből választandó",
    "(start_end/human/system/decide/ai_intervention/control_hitl), vagy új",
    "kisbetűs snake_case típus, ha egyik sem illik. Minden change note-ja",
    "1 mondatban rögzíti, mi és miért változott (eredeti → módosított).",
    "A reply rövid magyar összefoglaló; a javaslatot az ember alkalmazza.",
    "Ha a kérés nem igényel változást, a changes üres lista.",
  ].join(" ");

  const stepLines = steps
    .map((s) => `${s.id} [${s.type}] ${s.title}${s.sub ? ` (${s.sub})` : ""} — ${s.desc}`)
    .join("\n");

  const userPrompt = [
    "── Jelenlegi lépéslista ──",
    stepLines,
    "",
    "── A tanácsadó kérése ──",
    userMessage,
    "",
    "Add vissza pontosan ebben a JSON-alakban:",
    CHAT_SHAPE,
    "Csak JSON-t adj vissza.",
  ].join("\n");

  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });
  return parseChatProposal(textFromMessage(message));
}

// Chat-fixture (determinisztikus): a ref forgatókönyve — ① új HITL-lépés
// az AI-előszűrés után („Kockázatos kategóriák kézi ellenőrzése"), ② az
// „AI válasz-javaslat" lépés kiegészítése: mindig citációkkal. A célpontokat
// a lépéslistából keresi (nem drótozott id), így AS-IS-en is lefut értelmes
// fallback-kel; ha nincs találat, üres changes (nincs alap → nem tippel).
function mockChatEditProcess(steps: ChatStepSummary[], _userMessage: string): ChatProposal {
  const anchor = steps.find((s) => s.type === "ai_intervention") ?? null;
  const target = steps.find((s) => s.title.toLowerCase().startsWith("ai válasz")) ?? null;
  const changes: ChatProposal["changes"] = [];
  if (anchor) {
    changes.push({
      op: "insert_after",
      after_id: anchor.id,
      title: "Kockázatos kategóriák kézi ellenőrzése",
      sub: "garancia · jogi · HITL",
      type: "control_hitl",
      desc: "Chat-szerkesztéssel beszúrt kötelező kontrollpont: a garanciális és jogi kategóriájú panaszok az előszűrés után mindig emberi ellenőrzésre mennek — automata válasz ezekben tilos.",
      note: "Beszúrva: kötelező emberi ellenőrzés a kockázatos (garanciális/jogi) kategóriákra az AI-előszűrés után (chat-szerkesztés).",
    });
  }
  if (target) {
    changes.push({
      op: "update",
      id: target.id,
      sub: `${target.sub ? `${target.sub} · ` : ""}mindig citációkkal`,
      note: `Eredeti: „${target.sub ?? "—"}” → Módosított: a javaslat mindig forrás-citációkkal jön (chat-szerkesztés).`,
    });
  }
  const reply =
    changes.length === 0
      ? "Ehhez a tervhez nem találtam a kéréshez illő lépést — pontosítsd, melyik lépést módosítsam."
      : "Két módosítást készítettem elő: ① új HITL-lépés: „Kockázatos kategóriák kézi ellenőrzése” — az AI-előszűrés után; ② az „AI válasz-javaslat” lépés kiegészítve: mindig citációkkal. Előnézet kész — alkalmazod az ábrán?";
  return { reply, changes };
}

// ─────────────────────────────────────────────────────────────
// Követelmény-modul (#11): requirement-fa + story-származtatás + vázlatok
// ─────────────────────────────────────────────────────────────

import {
  parseAcDrafts,
  parseRequirementProposals,
  parseStoryDraft,
  parseStoryPackage,
  type AcDraft,
  type RequirementProposal,
  type StoryDraft,
  type StoryPackage,
} from "@/lib/requirements/parse";
import type { Moscow, RequirementSubtype } from "@/lib/db/types";
export type {
  AcDraft,
  RequirementProposal,
  StoryDraft,
  StoryPackage,
} from "@/lib/requirements/parse";

import {
  parseComponentProposals,
  parseOptionProposals,
  type ComponentProposal,
  type OptionProposal,
} from "@/lib/solution/parse";
export type { ComponentProposal, OptionProposal } from "@/lib/solution/parse";

export interface RequirementBasisPain {
  title: string;
  description: string | null;
}

export interface RequirementBasisStep {
  title: string;
  type: string;
  desc: string;
}

export interface RequirementBasisStakeholder {
  name: string;
  title: string | null;
}

const REQ_SHAPE = [
  `{ "requirements": [ { "tmp": "r1", "level": "business" | "stakeholder" | "system",`,
  `"subtype": "functional" | "non_functional" | null,`,
  `"parent_tmp": "<a szülő tmp-je vagy null>", "text": "<a követelmény szövege>",`,
  `"moscow": "must" | "should" | "could" | "wont" | null,`,
  `"source_indices": [<forrás-sorszámok, pl. 1>],`,
  `"stakeholder_names": ["<érintett neve a megadott listából — csak stakeholder szinten>"] } ] }`,
].join(" ");

/**
 * Requirement-fa javaslat (#11, E1): a megerősített fájdalompontokból, a
 * TO-BE folyamat lépéseiből és az érintettekből háromszintű requirement-fát
 * javasol (business → stakeholder → system, a system szinten funkcionális /
 * nem-funkcionális bontással), forrás-hivatkozással. A MoSCoW-t CSAK
 * egyértelmű alappal tölti (egyébként null — emberi ítélet); ai_suggested
 * → az ember erősíti meg.
 */
export async function suggestRequirements(
  sources: LlmSource[],
  pains: RequirementBasisPain[],
  toBeSteps: RequirementBasisStep[],
  stakeholders: RequirementBasisStakeholder[],
): Promise<RequirementProposal[]> {
  if (isMock()) {
    return mockSuggestRequirements(sources, pains, toBeSteps, stakeholders);
  }

  const system = [
    "Üzleti elemző (BA) vagy egy AI-implementációs tanácsadói rendszerben.",
    "A megadott alapanyagból (fájdalompontok, TO-BE folyamat lépései, érintettek,",
    "számozott források) HÁROMSZINTŰ requirement-fát javasolsz: business →",
    "stakeholder → system; a system szinten functional / non_functional altípussal.",
    "KIZÁRÓLAG érvényes JSON-t adsz vissza. SZIGORÚ SZABÁLYOK: minden stakeholder-",
    "szintű elem parent_tmp-je egy business elem, minden system elemé egy",
    "stakeholder elem. Csak olyan követelményt vehetsz fel, amelyre az alapanyagban",
    "tényleges alap van — a source_indices a támasztó forrás(ok) sorszáma; TILOS",
    "követelményt kitalálni. A moscow mezőt CSAK akkor töltsd, ha az alapanyagból",
    "egyértelmű a prioritás — egyébként null (emberi ítélet dönti el).",
    "STAKEHOLDER-AZONOSÍTÁS: minden STAKEHOLDER szintű követelménynél azonosítsd,",
    "melyik érintett(ek)től ered vagy kit szolgál, és a stakeholder_names-be az",
    "adott érintett(ek) nevét írd — PONTOSAN a megadott érintett-listából másolva,",
    "át nem fogalmazva. Ha nincs egyértelmű alap, hagyd üresen (ne tippelj); a",
    "kötés opcionális, sosem kötelező. Az eredmény magyarul készül.",
  ].join(" ");

  const painLines = pains.length
    ? pains.map((p, i) => `${i + 1}. ${p.title}${p.description ? ` — ${p.description}` : ""}`).join("\n")
    : "(nincs)";
  const stepLines = toBeSteps.length
    ? toBeSteps.map((s, i) => `${i + 1}. [${s.type}] ${s.title} — ${s.desc}`).join("\n")
    : "(nincs)";
  const shLines = stakeholders.length
    ? stakeholders.map((s) => `- ${s.name}${s.title ? ` (${s.title})` : ""}`).join("\n")
    : "(nincs)";
  const srcLines = sources.map((s) => `[${s.index}] ${s.title}`).join("\n");

  const userPrompt = [
    "── Fájdalompontok ──",
    painLines,
    "",
    "── TO-BE folyamat lépései ──",
    stepLines,
    "",
    "── Érintettek ──",
    shLines,
    "",
    "── Számozott források ──",
    srcLines,
    "",
    "Add vissza pontosan ebben a JSON-alakban:",
    REQ_SHAPE,
    "Csak JSON-t adj vissza.",
  ].join("\n");

  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 6000,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });
  return parseRequirementProposals(textFromMessage(message));
}

export interface StoryBasisRequirement {
  displayId: string;
  text: string;
  subtype: RequirementSubtype | null;
  moscow: Moscow | null;
}

const STORY_SHAPE = [
  `{ "epics": [ { "tmp": "e1", "title": "<epic címe>",`,
  `"business_display_id": "<BR-nn vagy null>" } ],`,
  `"stories": [ { "tmp": "s1", "epic_tmp": "e1",`,
  `"role": "<szerep>", "want": "<cél>", "so_that": "<ok>",`,
  `"moscow": "must" | "should" | "could" | "wont" | null,`,
  `"covers_display_ids": ["<a lefedett system requirement display_id-je>"],`,
  `"source_indices": [] } ] }`,
].join(" ");

/**
 * Story-származtatás (#11, E1): a SYSTEM requirementekből user story-kat
 * javasol epic-csomagolással. Az irány KÖTÖTT: requirement → story; a
 * covers_display_ids adja az N:M kötést. AC-t NEM generál — a story a
 * lefedett requirement(ek) AC-jét a kötésen át örökli (közös AC).
 */
export async function suggestStories(
  systemReqs: StoryBasisRequirement[],
  businessReqs: { displayId: string; text: string }[],
): Promise<StoryPackage> {
  if (isMock()) {
    return mockSuggestStories(systemReqs, businessReqs);
  }

  const system = [
    "Agile delivery-tervező vagy egy AI-implementációs tanácsadói rendszerben.",
    "A megadott SYSTEM szintű requirementekből user story-kat javasolsz",
    "(„[szerep]ként szeretnék [cél], hogy [ok]”), epic-ekbe szervezve.",
    "KIZÁRÓLAG érvényes JSON-t adsz vissza. SZIGORÚ SZABÁLYOK: minden story",
    "KIZÁRÓLAG a megadott requirementekből származhat — a covers_display_ids",
    "CSAK a listában szereplő display_id-ket tartalmazhatja (az irány kötött:",
    "requirement → story). Egy story több requirementet is fedhet (N:M), ha",
    "azok egy delivery-egységbe tartoznak — de NE ismételd a requirement",
    "szövegét, csomagold delivery-nézetbe. Acceptance criteriát NE generálj",
    "— a story a lefedett requirement AC-jét örökli. A moscow a lefedett",
    "requirement(ek) moscow-jából vehető át, ha egyértelmű — egyébként null.",
    "Az epic business_display_id-je a megadott business listából való (vagy",
    "null). Az eredmény magyarul készül.",
  ].join(" ");

  const reqLines = systemReqs
    .map((r) => `${r.displayId} [${r.subtype ?? "functional"}${r.moscow ? ` · ${r.moscow}` : ""}] ${r.text}`)
    .join("\n");
  const brLines = businessReqs.length
    ? businessReqs.map((r) => `${r.displayId} ${r.text}`).join("\n")
    : "(nincs)";

  const userPrompt = [
    "── System requirementek (a származtatás forrása) ──",
    reqLines,
    "",
    "── Business requirementek (epic-kötéshez) ──",
    brLines,
    "",
    "Add vissza pontosan ebben a JSON-alakban:",
    STORY_SHAPE,
    "Csak JSON-t adj vissza.",
  ].join("\n");

  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 6000,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });
  return parseStoryPackage(textFromMessage(message));
}

const AC_SHAPE = `{ "acs": [ { "title": "<rövid cím>", "given": "<előfeltétel>", "when": "<esemény>", "then": "<elvárt kimenet>" } ] }`;

/**
 * AC-vázlat (#11, HITL): egy system requirementhez 1-2 Given–When–Then
 * vázlatot javasol — a vázlat a szerkesztő-űrlapba kerül, az EMBER dönt
 * és ment. Nem ír adatbázist.
 */
export async function suggestAcDraft(requirementText: string): Promise<AcDraft[]> {
  if (isMock()) {
    return mockSuggestAcDraft(requirementText);
  }
  const system = [
    "Üzleti elemző vagy. A megadott system-követelményhez 1-2 tömör",
    "Given–When–Then acceptance criteriát vázolsz. KIZÁRÓLAG érvényes JSON-t",
    "adsz vissza. Csak a követelmény szövegéből indulj ki — TILOS új",
    "funkcionalitást vagy számot kitalálni, ami nincs benne. Ez vázlat:",
    "az ember szerkeszti és dönt. Magyarul.",
  ].join(" ");
  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 1500,
    system,
    messages: [
      {
        role: "user",
        content: `── Követelmény ──\n${requirementText}\n\nAdd vissza pontosan ebben a JSON-alakban:\n${AC_SHAPE}\nCsak JSON-t adj vissza.`,
      },
    ],
  });
  return parseAcDrafts(textFromMessage(message));
}

const STORY_DRAFT_SHAPE = `{ "role": "<szerep>", "want": "<cél>", "so_that": "<ok>", "epic_title": "<javasolt epic-cím vagy null>" }`;

/**
 * Story-vázlat (#11, HITL): a kijelölt (lefedendő) requirement(ek)ből
 * egyetlen story-vázlatot javasol a származtatás-űrlapba — az EMBER
 * véglegesíti. Nem ír adatbázist.
 */
export async function suggestStoryDraft(
  coveredReqs: { displayId: string; text: string }[],
): Promise<StoryDraft | null> {
  if (isMock()) {
    return mockSuggestStoryDraft(coveredReqs);
  }
  const system = [
    "Agile delivery-tervező vagy. A megadott (lefedendő) requirementekből",
    "EGY user story-vázlatot adsz („[szerep]ként szeretnék [cél], hogy [ok]”).",
    "KIZÁRÓLAG érvényes JSON-t adsz vissza. Csak a megadott követelményekből",
    "indulj ki. Ez vázlat: az ember szerkeszti és dönt. Magyarul.",
  ].join(" ");
  const reqLines = coveredReqs.map((r) => `${r.displayId} ${r.text}`).join("\n");
  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 800,
    system,
    messages: [
      {
        role: "user",
        content: `── Lefedendő requirementek ──\n${reqLines}\n\nAdd vissza pontosan ebben a JSON-alakban:\n${STORY_DRAFT_SHAPE}\nCsak JSON-t adj vissza.`,
      },
    ],
  });
  return parseStoryDraft(textFromMessage(message));
}

// ── Követelmény-mockok (determinisztikus; c-minta: alap nélkül üres) ──

// A demo (panaszkezelés) láncához igazított fa — a ref jelenetei szerint.
// A MoSCoW szándékosan NEM mindenhol kitöltött (br2, sys3, sr3): a mock is
// demonstrálja, hogy alap nélkül az AI nem tölti (emberi ítélet).
function mockSuggestRequirements(
  sources: LlmSource[],
  pains: RequirementBasisPain[],
  toBeSteps: RequirementBasisStep[],
  stakeholders: RequirementBasisStakeholder[],
): RequirementProposal[] {
  if (pains.length === 0 && toBeSteps.length === 0) {
    return []; // nincs alap → nem talál ki (negatív teszt)
  }
  const src = (i: number) => (sources[i - 1] ? [i] : sources.length ? [1] : []);
  const sh = (i: number) => (stakeholders[i] ? [stakeholders[i].name] : stakeholders[0] ? [stakeholders[0].name] : []);
  const raw = {
    requirements: [
      { tmp: "br1", level: "business", parent_tmp: null, text: "Csökkentsük a panaszkezelés átfutási idejét.", moscow: "must", source_indices: src(1), stakeholder_names: [] },
      { tmp: "br2", level: "business", parent_tmp: null, text: "Növeljük az első kontaktusnál lezárt panaszok arányát.", moscow: null, source_indices: src(1), stakeholder_names: [] },
      { tmp: "sr1", level: "stakeholder", parent_tmp: "br1", text: "Az ügyintéző lássa a javasolt választ, mielőtt jóváhagyja.", moscow: "must", source_indices: src(2), stakeholder_names: sh(0) },
      { tmp: "sr2", level: "stakeholder", parent_tmp: "br1", text: "A vezetőség lássa az eszkalációk okát és gyakoriságát.", moscow: "should", source_indices: src(2), stakeholder_names: sh(2) },
      { tmp: "sr3", level: "stakeholder", parent_tmp: "br2", text: "Az ügyfél kapjon azonnali visszaigazolást a rögzítésről.", moscow: null, source_indices: src(1), stakeholder_names: [] },
      { tmp: "sys1", level: "system", subtype: "functional", parent_tmp: "sr1", text: "A rendszer minden bejövő panaszhoz válasz-javaslatot generál.", moscow: "must", source_indices: src(2), stakeholder_names: [] },
      { tmp: "sys2", level: "system", subtype: "functional", parent_tmp: "sr1", text: "Az ügyintéző egy kattintással jóváhagyhatja vagy átírhatja a javaslatot.", moscow: "must", source_indices: src(2), stakeholder_names: [] },
      { tmp: "sys3", level: "system", subtype: "functional", parent_tmp: "sr2", text: "Eszkalációs kimutatás: ok és gyakoriság szerinti bontás.", moscow: null, source_indices: src(1), stakeholder_names: [] },
      { tmp: "nfr1", level: "system", subtype: "non_functional", parent_tmp: "sr1", text: "A panaszszöveg nem hagyhatja el az EU-adatrégiót (GDPR).", moscow: "must", source_indices: src(1), stakeholder_names: [] },
      { tmp: "nfr2", level: "system", subtype: "non_functional", parent_tmp: "sr1", text: "A válasz-javaslat késleltetése maradjon az ügyintézői munkát nem zavaró szinten.", moscow: null, source_indices: src(2), stakeholder_names: [] },
    ],
  };
  return parseRequirementProposals(JSON.stringify(raw));
}

// Story-mock: az ÁTADOTT display_id-kból építkezik (nem drótozott SYS-01):
// az 1. story az első system reqet fedi, a 2. az első KETTŐT (N:M demó),
// a 3. moscow nélkül. Üres bemenet → üres csomag (nincs alap → nem tippel).
function mockSuggestStories(
  systemReqs: StoryBasisRequirement[],
  businessReqs: { displayId: string; text: string }[],
): StoryPackage {
  if (systemReqs.length === 0) return { epics: [], stories: [] };
  const d = (i: number) => systemReqs[Math.min(i, systemReqs.length - 1)].displayId;
  const nfr = systemReqs.find((r) => r.subtype === "non_functional");
  const raw = {
    epics: [
      { tmp: "e1", title: "Ügyintézői válasz-asszisztens", business_display_id: businessReqs[0]?.displayId ?? null },
      { tmp: "e2", title: "Megfelelőség és audit", business_display_id: null },
    ],
    stories: [
      { tmp: "s1", epic_tmp: "e1", role: "ügyfélszolgálati ügyintéző", want: "minden panaszhoz automatikus válasz-javaslatot kapni", so_that: "ne kelljen nulláról fogalmaznom", moscow: "must", covers_display_ids: [d(0)], source_indices: [] },
      { tmp: "s2", epic_tmp: "e1", role: "ügyfélszolgálati ügyintéző", want: "egy kattintással jóváhagyni vagy átírni a javaslatot", so_that: "gyorsan és egységes minőségben zárhassam le a panaszt", moscow: "must", covers_display_ids: [d(0), d(1)], source_indices: [] },
      { tmp: "s3", epic_tmp: "e1", role: "ügyfélszolgálati ügyintéző", want: "látni a javaslat forrás-cikkét", so_that: "ellenőrizhessem a helyességét", moscow: null, covers_display_ids: [d(0)], source_indices: [] },
      ...(nfr
        ? [{ tmp: "s4", epic_tmp: "e2", role: "compliance-felelős", want: "hogy a panaszszöveg ne hagyja el az EU-t", so_that: "megfeleljünk a GDPR-nek", moscow: "must", covers_display_ids: [nfr.displayId], source_indices: [] }]
        : []),
    ],
  };
  return parseStoryPackage(JSON.stringify(raw));
}

function mockSuggestAcDraft(requirementText: string): AcDraft[] {
  if (requirementText.trim().length < 10) return [];
  const raw = {
    acs: [
      { title: "Sikeres javaslat-generálás beérkezéskor", given: "egy új panasz érkezik, és a tudásbázis elérhető,", when: "a rendszer feldolgozza a panasz szövegét,", then: "válasz-javaslatot jelenít meg forrás-hivatkozással a tudásbázis-cikkre." },
      { title: "Nincs megbízható javaslat", given: "a rendszer egyetlen ismert esethez sem tudja kötni a panaszt,", when: "nem tud megbízható javaslatot adni,", then: "„kézi feldolgozás” jelöléssel az ügyintézőhöz irányítja, javaslat nélkül." },
    ],
  };
  return parseAcDrafts(JSON.stringify(raw));
}

function mockSuggestStoryDraft(
  coveredReqs: { displayId: string; text: string }[],
): StoryDraft | null {
  if (coveredReqs.length === 0) return null;
  const raw = {
    role: "ügyfélszolgálati ügyintéző",
    want: "egy kattintással jóváhagyni vagy átírni a rendszer válasz-javaslatát",
    so_that: "gyorsan és egységes minőségben zárhassam le a panaszt",
    epic_title: "Ügyintézői válasz-asszisztens",
  };
  return parseStoryDraft(JSON.stringify(raw));
}

// ═════════════════ Megoldási opció-összevető (#12) ═════════════════

export interface SolutionBasisStep {
  /** A process_map jsonb-n belüli STABIL node-id — a kötés erre épül. */
  nodeId: string;
  num: string;
  title: string;
  type: string;
  desc: string;
}

const COMPONENT_SHAPE = [
  `{ "components": [ { "type": "process" | "infrastructure" | "personnel",`,
  `"name": "<komponens neve>", "description": "<mit valósít meg — 1-2 mondat>",`,
  `"step_ids": ["<a kötött TO-BE lépés node-id-je a megadott listából>"],`,
  `"source_indices": [<támasztó forrás sorszáma>] } ] }`,
].join(" ");

/**
 * Komponens-javaslat (#12, E1): a jóváhagyott TO-BE lépésekből + a
 * fájdalompontokból javasol megoldás-komponenseket. A kötés a lépés STABIL
 * node-id-jére mutat; process → pontosan egy lépés, infrastructure → több,
 * personnel → nulla vagy egy. A javaslat ai_suggested — az ember erősít meg.
 */
export async function suggestComponents(
  sources: LlmSource[],
  pains: RequirementBasisPain[],
  toBeSteps: SolutionBasisStep[],
): Promise<ComponentProposal[]> {
  const validIds = new Set(toBeSteps.map((s) => s.nodeId));
  if (isMock()) {
    return mockSuggestComponents(sources, toBeSteps);
  }

  const system = [
    "Megoldás-architekt vagy egy AI-implementációs tanácsadói rendszerben.",
    "A jóváhagyott TO-BE folyamat lépéseihez javasolsz megvalósító",
    "KOMPONENSEKET három típusban: process (egy konkrét lépést valósít meg —",
    "step_ids PONTOSAN EGY node-id), infrastructure (átfogó, több lépést",
    "szolgál — step_ids a kiszolgált lépések node-id-jai; ha minden lépést,",
    "sorold fel mindet), personnel (change-elem — step_ids üres, vagy egy",
    "lépés, ha konkrétan ahhoz kötődik, pl. betanítás egy HITL-lépéshez).",
    "KIZÁRÓLAG érvényes JSON-t adsz vissza. A step_ids CSAK a megadott",
    "node-id-listából vehet értéket. Csak olyan komponenst javasolj, amelyre",
    "a TO-BE lépésekből vagy a fájdalompontokból tényleges alap van — TILOS",
    "kitalálni; a source_indices a támasztó forrás(ok) sorszáma. NEM választasz",
    "megoldást és NEM adsz opciókat — csak a komponens-készletet javaslod.",
    "Az eredmény magyarul készül.",
  ].join(" ");

  const stepLines = toBeSteps.length
    ? toBeSteps.map((s) => `- node_id: ${s.nodeId} · TO-BE ${s.num} [${s.type}] ${s.title}${s.desc ? ` — ${s.desc}` : ""}`).join("\n")
    : "(nincs)";
  const painLines = pains.length
    ? pains.map((p, i) => `${i + 1}. ${p.title}${p.description ? ` — ${p.description}` : ""}`).join("\n")
    : "(nincs)";
  const srcLines = sources.map((s) => `[${s.index}] ${s.title}`).join("\n");

  const userPrompt = [
    "── A jóváhagyott TO-BE folyamat lépései (stabil node-id-kkal) ──",
    stepLines,
    "",
    "── Fájdalompontok ──",
    painLines,
    "",
    "── Számozott források ──",
    srcLines,
    "",
    "Add vissza pontosan ebben a JSON-alakban:",
    COMPONENT_SHAPE,
    "Csak JSON-t adj vissza.",
  ].join("\n");

  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });
  return parseComponentProposals(textFromMessage(message), validIds);
}

const OPTION_SHAPE = [
  `{ "options": [ { "name": "<opció neve>", "description": "<1 mondat>",`,
  `"recommended": true | false,`,
  `"criteria": { "cost": { "value": "<pl. Magas>", "note": "<pl. ~6,5 M Ft egyszeri>" },`,
  `"lead_time": { "value": "<pl. 4 hét>" }, "risk": { "value": "...", "note": "..." },`,
  `"data_need": { "value": "...", "note": "..." }, "fit": { "value": "..." },`,
  `"<egyedi_kulcs>": { "label": "<egyedi szempont neve>", "value": "..." } } } ] }`,
].join(" ");

/**
 * Opció-javaslat egy komponenshez (#12, E1): alternatívák + szempont-értékek.
 * c-minta: ahol nincs alap egy szempont-értékre, a kulcs KIMARAD (üres cella
 * lesz — „nincs megadva"), szám/érték fabrikálása TILOS. Legfeljebb egy
 * recommended=true (✦ AI AJÁNLJA) — az ajánlás SOSEM választás, a nyertest
 * az ember jelöli ki.
 */
export async function suggestOptions(
  component: { name: string; type: string; description: string; stepTitles: string[] },
  sources: LlmSource[],
  pains: RequirementBasisPain[],
): Promise<OptionProposal[]> {
  if (isMock()) {
    return mockSuggestOptions(component);
  }

  const system = [
    "Megoldás-architekt vagy egy AI-implementációs tanácsadói rendszerben.",
    "Egy megoldás-KOMPONENSHEZ javasolsz 2-3 megvalósítási ALTERNATÍVÁT",
    "(opciót), szempontonkénti értékeléssel. Alap-szempontok: cost (költség),",
    "lead_time (bevezetési idő), risk (kockázat), data_need (adatigény),",
    "fit (illeszkedés/testreszabhatóság); indokolt esetben adhatsz egyedi",
    "szempontot label-lel (pl. szállítói függőség). SZIGORÚ SZABÁLY: ahol az",
    "alapanyagból NINCS alap egy szempont-értékre, a kulcsot HAGYD KI — üres",
    "cella lesz; számot, árat, időt fabrikálni TILOS. Konkrét összeget CSAK",
    "akkor írj a note-ba, ha a forrásokban szerepel. Legfeljebb EGY opción",
    "lehet recommended=true, rövid ténybeli alapon — de a rendszer nem választ:",
    "a nyertest az ember jelöli ki. KIZÁRÓLAG érvényes JSON-t adsz vissza.",
    "Az eredmény magyarul készül.",
  ].join(" ");

  const painLines = pains.length
    ? pains.map((p, i) => `${i + 1}. ${p.title}${p.description ? ` — ${p.description}` : ""}`).join("\n")
    : "(nincs)";
  const srcLines = sources.length ? sources.map((s) => `[${s.index}] ${s.title}`).join("\n") : "(nincs)";

  const userPrompt = [
    "── A komponens ──",
    `Név: ${component.name}`,
    `Típus: ${component.type}`,
    component.description ? `Leírás: ${component.description}` : "",
    component.stepTitles.length ? `Kötött TO-BE lépés(ek): ${component.stepTitles.join(", ")}` : "Nem lépéshez kötött.",
    "",
    "── Fájdalompontok (kontextus) ──",
    painLines,
    "",
    "── Számozott források ──",
    srcLines,
    "",
    "Add vissza pontosan ebben a JSON-alakban:",
    OPTION_SHAPE,
    "Csak JSON-t adj vissza.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });
  return parseOptionProposals(textFromMessage(message));
}

// ── #12 mockok (determinisztikus MOCK_LLM fixture-ök) ────────

function mockSuggestComponents(
  sources: LlmSource[],
  toBeSteps: SolutionBasisStep[],
): ComponentProposal[] {
  if (toBeSteps.length === 0) return [];
  const src = sources.length ? [sources[0].index] : [];
  const out: { type: string; name: string; description: string; step_ids: string[]; source_indices: number[] }[] = [];

  // folyamat-komponens az első 2 nem-kezdő/záró, nem-döntés lépéshez
  const eligible = toBeSteps.filter((s) => s.type !== "start_end" && s.type !== "decide");
  eligible.slice(0, 2).forEach((s, i) => {
    out.push({
      type: "process",
      name: i === 0 ? `Osztályozó modell (${s.num})` : `Hibakód-azonosító AI (${s.num})`,
      description: i === 0 ? "Bejövő panasz témába sorolása." : "Panaszszövegből a hibakód kikövetkeztetése.",
      step_ids: [s.nodeId],
      source_indices: src,
    });
  });
  // infra: az első két eligible lépést szolgálja
  if (eligible.length >= 2) {
    out.push({
      type: "infrastructure",
      name: "Vektoradatbázis / tudásbázis",
      description: "Hibakód-leírások és korábbi megoldások embeddingjei.",
      step_ids: eligible.slice(0, 2).map((s) => s.nodeId),
      source_indices: src,
    });
  }
  // infra: átfogó — minden lépés
  out.push({
    type: "infrastructure",
    name: "Integrációs réteg (CRM-konnektor)",
    description: "A meglévő ügyfélszolgálati rendszerhez köti a folyamat minden lépését.",
    step_ids: toBeSteps.map((s) => s.nodeId),
    source_indices: src,
  });
  // személyi: nem kötött + egy HITL-lépéshez kötött (ha van)
  out.push({
    type: "personnel",
    name: "AI-champion szerep",
    description: "Ügyféloldali felelős, aki a bevezetést és az adaptációt gazdálja.",
    step_ids: [],
    source_indices: [],
  });
  const hitl = toBeSteps.find((s) => s.type === "control_hitl");
  if (hitl) {
    out.push({
      type: "personnel",
      name: "Operátor-betanítás",
      description: "A HITL-jóváhagyó felülethez kötött tréning.",
      step_ids: [hitl.nodeId],
      source_indices: src,
    });
  }
  return parseComponentProposals(
    JSON.stringify({ components: out }),
    new Set(toBeSteps.map((s) => s.nodeId)),
  );
}

function mockSuggestOptions(component: { name: string; type: string }): OptionProposal[] {
  if (component.type === "process") {
    const raw = {
      options: [
        {
          name: "Saját fine-tuned modell",
          description: "Maximális testreszabás, teljes kontroll.",
          recommended: false,
          criteria: {
            cost: { value: "Magas" },
            lead_time: { value: "8–10 hét" },
            risk: { value: "Közepes", note: "Modell-karbantartás saját erőforrással." },
            data_need: { value: "Magas", note: "5 000+ címkézett eset" },
            fit: { value: "Kiváló" },
            vendor_lock: { label: "Szállítói függőség", value: "Nincs" },
          },
        },
        {
          name: "Off-the-shelf API",
          description: "Kész szolgáltatás, gyors indulás.",
          recommended: false,
          criteria: {
            cost: { value: "Alacsony" },
            lead_time: { value: "2 hét" },
            risk: { value: "Alacsony", note: "Érett szolgáltatás, SLA-val." },
            data_need: { value: "Alacsony", note: "Nincs saját tanítóadat." },
            fit: { value: "Közepes" },
            vendor_lock: { label: "Szállítói függőség", value: "Magas" },
          },
        },
        {
          name: "Hibrid (API + finomhangolt prompt)",
          description: "Kész modell, projektre hangolt prompt-réteggel.",
          recommended: true,
          criteria: {
            cost: { value: "Közepes" },
            lead_time: { value: "4 hét" },
            risk: { value: "Alacsony", note: "Kevés egyedi kód, könnyű visszaállás." },
            data_need: { value: "Közepes", note: "~300 példa a prompt-réteghez." },
            fit: { value: "Jó" },
            // vendor_lock szándékosan kihagyva → üres cella ([]„nincs megadva")
          },
        },
      ],
    };
    return parseOptionProposals(JSON.stringify(raw));
  }
  if (component.type === "infrastructure") {
    const raw = {
      options: [
        {
          name: "Managed (felhő) szolgáltatás",
          description: "Üzemeltetés a szolgáltatónál.",
          recommended: true,
          criteria: {
            cost: { value: "Közepes" },
            lead_time: { value: "1 hét" },
            risk: { value: "Alacsony" },
          },
        },
        {
          name: "Saját üzemeltetés",
          description: "Helyben futtatott komponens.",
          recommended: false,
          criteria: {
            // cost szándékosan kihagyva → üres cella
            lead_time: { value: "3–4 hét" },
            risk: { value: "Közepes" },
          },
        },
      ],
    };
    return parseOptionProposals(JSON.stringify(raw));
  }
  const raw = {
    options: [
      {
        name: "Belső kinevezés (meglévő teamlead)",
        description: "Ismeri a folyamatot; kapacitás-kockázat a napi feladatai mellett.",
        recommended: false,
        criteria: {
          cost: { value: "~0,2 FTE" },
          lead_time: { value: "azonnal" },
          risk: { value: "Közepes" },
        },
      },
      {
        name: "Új, dedikált szerep",
        description: "Toborzott, teljes idejű felelős.",
        recommended: false,
        criteria: {
          cost: { value: "1,0 FTE" },
          lead_time: { value: "6–8 hét toborzás" },
          risk: { value: "Alacsony" },
        },
      },
    ],
  };
  return parseOptionProposals(JSON.stringify(raw));
}

// ═════════════════ P3 Golden set + Tesztriport (#14) ═════════════════

import {
  parseEvalCaseProposals,
  parseVerdictSuggestion,
  parseResidualRisk,
  type EvalCaseProposal,
  type VerdictSuggestion,
  type ResidualRiskSuggestion,
} from "@/lib/goldenset/parse";
export type {
  EvalCaseProposal,
  VerdictSuggestion,
  ResidualRiskSuggestion,
} from "@/lib/goldenset/parse";

const EVAL_CASES_SHAPE = [
  `{ "cases": [ { "input": "<teszt-bemenet, a use case tényleges bemenet-formájában>",`,
  `"answer_type": "free_text" | "choice_single" | "choice_multi" | "number_scale" | "yes_no",`,
  `"answer_config": { "options": ["<opció>", "..."] } VAGY { "min": 0, "max": 100, "label": "<mit mér>" } VAGY {},`,
  `"criteria": ["<elfogadási kritérium — mikor jó a válasz>", "..."],`,
  `"expected": { "text"|"choice"|"choices"|"value": ... } | null,`,
  `"source_indices": [<támasztó forrás sorszáma>] } ] }`,
].join(" ");

/**
 * Golden set javaslat (#14, AC2 — E1): az Approved P2 use case-ből +
 * forrásokból tesztesetek (bemenet + 1-N kritérium + válasz-típus +
 * OPCIONÁLIS elvárt kimenet). A javaslat ai_suggested — semmi nem kerül
 * aktív állapotba emberi megerősítés nélkül. c-minta: expected CSAK
 * egyértelmű egyetlen-jó-válasz esetén; nyílt esetnél null.
 */
export async function suggestEvalCases(
  sources: LlmSource[],
  useCase: { title: string; description: string | null },
): Promise<EvalCaseProposal[]> {
  if (isMock()) {
    return mockSuggestEvalCases(sources);
  }

  const system = [
    "Minőségbiztosítási (QA) tervező vagy egy AI-implementációs tanácsadói",
    "rendszerben. Egy megépített AI-megoldáshoz állítasz össze GOLDEN SET",
    "teszteseteket a use case és a források alapján. Minden esethez: input",
    "(realisztikus teszt-bemenet), 1-N criteria (elfogadási kritérium — a",
    "pass/fail fő alapja), answer_type (a megoldás kimenetének formája:",
    "free_text=szabad szöveg · choice_single=egy kategória · choice_multi=",
    "több címke · number_scale=szám egy skálán · yes_no=kétállású döntés),",
    "és a típushoz tartozó answer_config (választósnál legalább 2 opció;",
    "skálánál min/max/label). SZIGORÚ SZABÁLY: az expected (elvárt kimenet)",
    "CSAK akkor tölthető, ha EGYETLEN jó válasz van (pl. a helyes kategória)",
    "— nyílt/szabad-szöveges esetnél null, a kritérium dönt; értéket",
    "fabrikálni TILOS. Vegyes típus-összetételt adj, a use case kockázatos",
    "viselkedéseit (eszkaláció, hangnem, határesetek) is fedd le. A",
    "source_indices a támasztó forrás(ok) sorszáma. KIZÁRÓLAG érvényes",
    "JSON-t adsz vissza, magyarul.",
  ].join(" ");

  const srcLines = sources.map((s) => `[${s.index}] ${s.title}\n${s.text.slice(0, 1500)}`).join("\n\n");
  const userPrompt = [
    "── A use case ──",
    `Cím: ${useCase.title}`,
    useCase.description ? `Leírás: ${useCase.description}` : "",
    "",
    "── Számozott források ──",
    srcLines,
    "",
    "Adj 6-10 tesztesetet pontosan ebben a JSON-alakban:",
    EVAL_CASES_SHAPE,
    "Csak JSON-t adj vissza.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 6000,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });
  return parseEvalCaseProposals(textFromMessage(message));
}

const VERDICT_SHAPE = [
  `{ "verdict": "passed" | "partial" | "failed",`,
  `"rationale": "<indok — a kritériumokra hivatkozva (K1, K2, ...)>",`,
  `"criteria": [ { "ord": 1, "ok": true | false } ] }`,
].join(" ");

/**
 * Besorolás-ajánlás (#14, AC3 — E1): a rögzített TÉNYLEGES kimenetet a
 * kritériumokhoz méri. Az ajánlás KÜLÖN mezőbe kerül — a végső ítélet
 * mindig emberi (elfogadás vagy felülírás).
 */
export async function suggestVerdict(input: {
  inputText: string;
  answerTypeLabel: string;
  criteria: string[];
  actualFormatted: string;
  expectedFormatted: string | null;
}): Promise<VerdictSuggestion | null> {
  if (isMock()) {
    return mockSuggestVerdict(input);
  }

  const system = [
    "Minőségbiztosítási bíráló vagy egy AI-implementációs tanácsadói",
    "rendszerben. Egy teszteset RÖGZÍTETT tényleges kimenetét mered az",
    "elfogadási kritériumokhoz. Besorolás: passed (minden lényegi kritérium",
    "teljesül) · partial (részben teljesül) · failed (lényegi kritérium",
    "sérül). Az indoklás KONKRÉTAN a kritériumokra hivatkozik (K1, K2, …),",
    "és a criteria tömbben kritériumonként jelzöd: ok=true/false. Ha van",
    "elvárt kimenet, az eltérés releváns; ha nincs, KIZÁRÓLAG a kritériumok",
    "döntenek. Ez AJÁNLÁS — a végső ítélet a tanácsadóé. KIZÁRÓLAG érvényes",
    "JSON-t adsz vissza, magyarul.",
  ].join(" ");

  const critLines = input.criteria.map((c, i) => `K${i + 1}: ${c}`).join("\n");
  const userPrompt = [
    "── A teszteset ──",
    `Bemenet: ${input.inputText}`,
    `Válasz-típus: ${input.answerTypeLabel}`,
    "",
    "── Elfogadási kritériumok ──",
    critLines,
    "",
    input.expectedFormatted ? `── Elvárt kimenet ──\n${input.expectedFormatted}\n` : "",
    "── TÉNYLEGES kimenet (a megoldás kívül futtatott válasza) ──",
    input.actualFormatted,
    "",
    "Add vissza pontosan ebben a JSON-alakban:",
    VERDICT_SHAPE,
    "Csak JSON-t adj vissza.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 1500,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });
  return parseVerdictSuggestion(textFromMessage(message));
}

const RESIDUAL_SHAPE = `{ "level": "alacsony" | "közepes" | "magas", "text": "<1-3 mondat: mi a maradék kockázat és kezelhető-e pilotban>" }`;

/**
 * Maradék kockázat javaslat a Tesztriporthoz (#14, §7/3 — E1): a bukott
 * esetekből. Emberi megerősítéssel kerül a riport-mezőbe.
 */
export async function suggestResidualRisk(
  failed: { displayId: string; verdict: string; note: string }[],
  stats: { pct: number; threshold: number | null },
): Promise<ResidualRiskSuggestion | null> {
  if (isMock()) {
    return mockSuggestResidualRisk(failed);
  }

  const system = [
    "Minőségbiztosítási tanácsadó vagy. A golden set bukott eseteiből",
    "fogalmazol MARADÉK KOCKÁZAT összefoglalót a Tesztriporthoz: mi a",
    "kockázat mintázata, és pilotban (emberi felügyelet mellett) kezelhető-e.",
    "CSAK a megadott bukásokból dolgozz — új hibát kitalálni TILOS. Ez",
    "javaslat, emberi megerősítéssel kerül a riportba. KIZÁRÓLAG érvényes",
    "JSON-t adsz vissza, magyarul.",
  ].join(" ");

  const failLines = failed.length
    ? failed.map((f) => `${f.displayId} (${f.verdict}): ${f.note}`).join("\n")
    : "(nincs bukott eset)";
  const userPrompt = [
    "── Bukott esetek ──",
    failLines,
    "",
    `── Arány ── ${stats.pct}%${stats.threshold !== null ? ` (küszöb: ${stats.threshold}%)` : ""}`,
    "",
    "Add vissza pontosan ebben a JSON-alakban:",
    RESIDUAL_SHAPE,
    "Csak JSON-t adj vissza.",
  ].join("\n");

  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 800,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });
  return parseResidualRisk(textFromMessage(message));
}

// ── #14 mockok (determinisztikus — mind az 5 válasz-típus lefedve) ──

function mockSuggestEvalCases(sources: LlmSource[]): EvalCaseProposal[] {
  const src = sources.length ? [sources[0].index] : [];
  const raw = {
    cases: [
      {
        input: "„A rendelésem (#48210) két hete nem érkezett meg, kérek választ.”",
        answer_type: "free_text",
        answer_config: {},
        criteria: [
          "A válasz udvarias és bocsánatot kér a késedelemért.",
          "Konkrét következő lépést ad (státusz-ellenőrzés vagy határidő).",
        ],
        expected: null,
        source_indices: src,
      },
      {
        input: "„Hibás a kazán kijelzője, garanciában van még?”",
        answer_type: "choice_single",
        answer_config: { options: ["Számlázás", "Szállítás", "Termékhiba", "Garancia", "Egyéb"] },
        criteria: ["A megoldás a Garancia kategóriát adja."],
        expected: { choice: "Garancia" },
        source_indices: src,
      },
      {
        input: "„Ez egy szégyen, azonnal intézzék, vagy feljelentem magukat!”",
        answer_type: "yes_no",
        answer_config: { label: "Durva hangnál eszkalált-e élő ügyintézőnek?" },
        criteria: [
          "Durva hangnál eszkalál élő ügyintézőnek.",
          "Nem ígér jogilag kötelező érvényűt.",
        ],
        expected: { value: true },
        source_indices: src,
      },
      {
        input: "„Már harmadszor írok a szivárgó radiátor ügyében, kártérítést kérek.”",
        answer_type: "choice_multi",
        answer_config: { options: ["sürgős", "kártérítés-igény", "ismételt panasz"] },
        criteria: [
          "A válasz felismeri az ismétlődő panaszt (nem első kontaktusként kezeli).",
          "Elismeri a kártérítési igényt és jelzi a továbbítást.",
        ],
        expected: null,
        source_indices: src,
      },
      {
        input: "„Mennyire biztos a rendszer a besorolásban? (konfidencia)”",
        answer_type: "number_scale",
        answer_config: { min: 0, max: 100, label: "A megoldás konfidenciája a besorolásban" },
        criteria: ["A konfidencia legalább 70, egyértelmű bemenetnél."],
        expected: null,
        source_indices: src,
      },
      {
        input: "„Kérek egy udvarias választ a késett alkatrész-szállításra.”",
        answer_type: "free_text",
        answer_config: {},
        criteria: ["Udvarias, empatikus hangnem.", "Konkrét várható időpontot vagy értesítést ígér."],
        expected: null,
        source_indices: src,
      },
    ],
  };
  return parseEvalCaseProposals(JSON.stringify(raw));
}

function mockSuggestVerdict(input: {
  criteria: string[];
  actualFormatted: string;
}): VerdictSuggestion | null {
  const crits = input.criteria.map((_, i) => ({ ord: i + 1, ok: true }));
  const actual = input.actualFormatted.toLowerCase();
  // determinisztikus: „nem" kétállású bukás → failed; „hiány" → partial; egyébként passed
  if (actual === "nem") {
    if (crits.length > 0) crits[0] = { ord: 1, ok: false };
    return parseVerdictSuggestion(
      JSON.stringify({
        verdict: "failed",
        rationale:
          "A tényleges kimenet sérti a K1-et: durva/fenyegető hang esetén a megoldásnak élő ügyintézőnek kell eszkalálnia, de nem tette. A többi kritérium teljesül, de a K1 kritikus — a besorolás nem.",
        criteria: crits,
      }),
    );
  }
  if (actual.includes("hiány") || (actual.includes(",") && !actual.includes("ismételt"))) {
    if (crits.length > 0) crits[0] = { ord: 1, ok: false };
    return parseVerdictSuggestion(
      JSON.stringify({
        verdict: "partial",
        rationale:
          "A kimenet részben fedi a kritériumokat: a K1 (ismételt panasz felismerése) sérül, a többi teljesül — a besorolás részleges.",
        criteria: crits,
      }),
    );
  }
  return parseVerdictSuggestion(
    JSON.stringify({
      verdict: "passed",
      rationale: "A tényleges kimenet minden kritériumot teljesít (K1–K" + crits.length + " OK).",
      criteria: crits,
    }),
  );
}

function mockSuggestResidualRisk(
  failed: { displayId: string; verdict: string; note: string }[],
): ResidualRiskSuggestion | null {
  if (failed.length === 0) {
    return parseResidualRisk(
      JSON.stringify({ level: "alacsony", text: "A golden set nem tárt fel maradék kockázatot." }),
    );
  }
  return parseResidualRisk(
    JSON.stringify({
      level: "közepes",
      text: `Az eszkalációs logika megbízhatatlan (${failed.map((f) => f.displayId).join(", ")}). Pilotban emberi felügyelet mellett kezelhető, de éles bevezetés előtt javítandó.`,
    }),
  );
}

// ═════════════════════════════════════════════════════════════
// P3 Megoldás-dokumentáció (#15) — struktúra-javaslat az építési
// anyagból + megvalósítás-kötés javaslat. E1 végig: minden javaslat
// ✦ ai_suggested, aktívvá CSAK emberi megerősítéssel válik.
// ═════════════════════════════════════════════════════════════

import {
  parseBuildDocProposal,
  parseImplLinkSuggestions,
  type BuildDocProposal,
  type ImplLinkSuggestion,
} from "@/lib/builddoc/parse";
export type {
  BuildDocProposal,
  BuildComponentProposal,
  ControlPointProposal,
  PromptProposal,
  ImplLinkSuggestion,
} from "@/lib/builddoc/parse";

const BUILD_DOC_SHAPE = [
  `{ "components": [ { "name": "<komponens>", "description": "<leírás>",`,
  `"layer_type": "process" | "infrastructure" | "personnel",`,
  `"origin_index": <1-alapú P2-komponens sorszám VAGY null>,`,
  `"prompts": [ { "name": "<prompt-elem>", "purpose": "<cél>", "prompt_text": "<szöveg>" } ],`,
  `"source_indices": [<forrás-sorszámok>] } ],`,
  `"controls": [ { "name": "<kontrollpont>", "kind": "guardrail" | "hitl",`,
  `"description": "<leírás>", "tobe_ord": <1-alapú TO-BE lépés-sorszám VAGY null>,`,
  `"source_indices": [<forrás-sorszámok>] } ] }`,
].join(" ");

/**
 * Struktúra-javaslat a feltöltött építési anyagból (#15, AC3 — E1):
 * komponensek (P2-eredettel, ahol felismerhető), prompt-elemek,
 * kontrollpontok. A tanácsadó szerkeszt és erősít meg.
 */
export async function suggestBuildDoc(
  sources: LlmSource[],
  ctx: {
    p2Components: { name: string; optionName: string | null }[];
    tobeSteps: { num: string; title: string }[];
  },
): Promise<BuildDocProposal> {
  if (isMock()) {
    return mockSuggestBuildDoc(sources, ctx);
  }

  const system = [
    "Megoldás-dokumentáló vagy egy AI-implementációs tanácsadói rendszerben.",
    "A tanácsadó a rendszeren KÍVÜL megépítette a megoldást; a feltöltött",
    "építési anyagból strukturált dokumentációt draftolsz: build-komponensek",
    "(réteg: process=folyamat-elem · infrastructure=átfogó infra ·",
    "personnel=emberi/change elem), komponensenként a felismert prompt-elemek",
    "(név + cél + szó szerinti prompt-szöveg, ha az anyagban szerepel), és",
    "kontrollpontok (guardrail=szabály-korlát · hitl=emberi jóváhagyási",
    "pont). EREDET: ha egy komponens egyértelműen a P2-lista egy eleméből",
    "épült, add meg az origin_index-ét (1-alapú); ha nincs ilyen, null —",
    "eredetet fabrikálni TILOS. A tobe_ord CSAK akkor tölthető, ha a",
    "kontroll egyértelműen egy megadott TO-BE lépéshez tartozik. CSAK az",
    "anyagban ténylegesen szereplő elemeket add vissza — kitalálni semmit",
    "nem szabad. A source_indices a támasztó forrás(ok) sorszáma.",
    "KIZÁRÓLAG érvényes JSON-t adsz vissza, magyarul.",
  ].join(" ");

  const p2Lines = ctx.p2Components.length
    ? ctx.p2Components
        .map((c, i) => `${i + 1}. ${c.name}${c.optionName ? ` (kiválasztva: ${c.optionName})` : ""}`)
        .join("\n")
    : "(nincs P2-komponens)";
  const tobeLines = ctx.tobeSteps.length
    ? ctx.tobeSteps.map((s) => `${s.num}. ${s.title}`).join("\n")
    : "(nincs jóváhagyott TO-BE)";
  const srcLines = sources.map((s) => `[${s.index}] ${s.title}\n${s.text.slice(0, 1500)}`).join("\n\n");
  const userPrompt = [
    "── P2 kiválasztott komponensek (eredet-jelöltek) ──",
    p2Lines,
    "",
    "── TO-BE lépések ──",
    tobeLines,
    "",
    "── Számozott források (építési anyag) ──",
    srcLines,
    "",
    "Add vissza pontosan ebben a JSON-alakban:",
    BUILD_DOC_SHAPE,
    "Csak JSON-t adj vissza.",
  ].join("\n");

  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 6000,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });
  return parseBuildDocProposal(textFromMessage(message), ctx.p2Components.length, ctx.tobeSteps.length);
}

const IMPL_LINKS_SHAPE = [
  `{ "links": [ { "target_type": "requirement" | "story" | "tobe_node" | "pain_point",`,
  `"label": "<a cél megjelölt azonosítója, pl. SYS-02 / US-03 / TO-BE·03 / FP-01>" } ] }`,
].join(" ");

/**
 * Megvalósítás-kötés javaslat egy komponensre (#15, AC2+AC3 — E1):
 * a 4 cél-típus listáiból, KIZÁRÓLAG a felsorolt azonosítókra. A kötés
 * emberi döntés — a javaslat ✦ jelölést kap, ✓/× zárja.
 */
export async function suggestImplLinks(
  component: { name: string; description: string },
  candidates: { targetType: string; label: string; title: string }[],
): Promise<ImplLinkSuggestion[]> {
  if (isMock()) {
    return mockSuggestImplLinks(component, candidates);
  }

  const system = [
    "Megoldás-dokumentáló vagy. Egy build-komponenshez javasolsz",
    "MEGVALÓSÍTÁS-kötéseket a P0–P2 terv elemeire: mely system requirement-et,",
    "user story-t, TO-BE lépést vagy fájdalompontot valósítja meg / kezeli a",
    "komponens. KIZÁRÓLAG a felsorolt azonosítókra hivatkozhatsz; CSAK ott",
    "javasolj, ahol a komponens leírása alapján valós a kapcsolat — kötést",
    "fabrikálni TILOS, az üres lista érvényes válasz. Requirement ÉS story",
    "egyszerre is köthető, ha mindkettőre van alap. KIZÁRÓLAG érvényes",
    "JSON-t adsz vissza.",
  ].join(" ");

  const candLines = candidates.map((c) => `${c.label} [${c.targetType}] — ${c.title}`).join("\n");
  const userPrompt = [
    "── A komponens ──",
    `Név: ${component.name}`,
    component.description ? `Leírás: ${component.description}` : "",
    "",
    "── Köthető terv-elemek ──",
    candLines,
    "",
    "Add vissza pontosan ebben a JSON-alakban:",
    IMPL_LINKS_SHAPE,
    "Csak JSON-t adj vissza.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 1200,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });
  const valid = new Set(candidates.map((c) => `${c.targetType}:${c.label}`));
  return parseImplLinkSuggestions(textFromMessage(message), valid);
}

// ── #15 mockok (determinisztikus MOCK_LLM fixture-ök) ────────

function mockSuggestBuildDoc(
  sources: LlmSource[],
  ctx: { p2Components: { name: string }[]; tobeSteps: { num: string }[] },
): BuildDocProposal {
  const src = sources.length ? [sources[0].index] : [];
  const raw = {
    components: [
      {
        name: "Kategorizáló modul",
        description: "A bejövő panaszt 5 kategória egyikébe sorolja a tudásbázis-kontextussal.",
        layer_type: "process",
        origin_index: ctx.p2Components.length >= 1 ? 1 : null,
        prompts: [
          {
            name: "Kategória-osztályozó",
            purpose: "Panasz témába sorolása 5 kategóriára.",
            prompt_text: "# Szerep\nOsztályozó vagy. Sorold a panaszt: Számlázás · Szállítás · Termékhiba · Garancia · Egyéb.\n# Kimenet\nEgyetlen kategória-név.",
          },
        ],
        source_indices: src,
      },
      {
        name: "Válaszgeneráló prompt-lánc",
        description: "A lekért kontextusból ügyfél-hangnemű válasz-piszkozatot állít elő az operátornak.",
        layer_type: "process",
        origin_index: ctx.p2Components.length >= 2 ? 2 : null,
        prompts: [
          {
            name: "Válasz-fogalmazó",
            purpose: "Ügyfél-hangnemű válasz-piszkozat a lekért kontextusból.",
            prompt_text: "# Szerep\nUdvarias ügyfélszolgálati munkatárs vagy.\n# Feladat\nEmpatikus, tömör válasz-piszkozat; minden tényálláshoz forrás: [KB-####].\n# Kimenet\nMegszólítás · lényegi válasz · zárás. Max 120 szó.",
          },
          {
            name: "Forrás-idézés kényszerítő",
            purpose: "Minden állításhoz tudásbázis-hivatkozást kér.",
            prompt_text: "Minden tényállítás mellé tegyél [KB-####] hivatkozást; forrás nélküli állítás tilos.",
          },
        ],
        source_indices: src,
      },
      {
        name: "Operátor-betanítási vázlat",
        description: "A bevezetéshez tartozó betanítási anyag és felelősségi mátrix.",
        layer_type: "personnel",
        origin_index: null,
        prompts: [],
        source_indices: src,
      },
    ],
    controls: [
      {
        name: "Nincs jogilag kötelező ígéret",
        kind: "guardrail",
        description: "A válasz nem tartalmazhat konkrét kártérítési összeget vagy határidőt jóváhagyás nélkül.",
        tobe_ord: ctx.tobeSteps.length >= 3 ? 3 : null,
        source_indices: src,
      },
      {
        name: "Operátori jóváhagyás kimenő válasz előtt",
        kind: "hitl",
        description: "Minden generált válasz emberi jóváhagyással megy ki — a rendszer nem küld autonóm módon.",
        tobe_ord: null,
        source_indices: src,
      },
    ],
  };
  return parseBuildDocProposal(JSON.stringify(raw), ctx.p2Components.length, ctx.tobeSteps.length);
}

function mockSuggestImplLinks(
  _component: { name: string },
  candidates: { targetType: string; label: string }[],
): ImplLinkSuggestion[] {
  // determinisztikus: cél-típusonként az ELSŐ jelölt (legfeljebb 3 kötés)
  const picked: { target_type: string; label: string }[] = [];
  for (const type of ["requirement", "story", "tobe_node"]) {
    const first = candidates.find((c) => c.targetType === type);
    if (first) picked.push({ target_type: type, label: first.label });
  }
  const valid = new Set(candidates.map((c) => `${c.targetType}:${c.label}`));
  return parseImplLinkSuggestions(JSON.stringify({ links: picked }), valid);
}

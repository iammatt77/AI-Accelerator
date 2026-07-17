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

const PROCESS_SHAPE = [
  `{ "title": "<a folyamat rövid címe>", "steps": [ { "id": "s1",`,
  `"title": "<lépés címe>", "sub": "<rövid metaadat vagy null>",`,
  `"type": "start_end" | "human" | "system" | "decide" | "ai_intervention" | "control_hitl",`,
  `"desc": "<1-2 mondatos magyarázat>", "quote": "<szó szerinti idézet a forrásból>",`,
  `"loc": "<hely a leiratban, pl. időkód, vagy üres>",`,
  `"open_points": [{"level":"blocker"|"important"|"clarify","text":"<nyitott kérdés>"}],`,
  `"next": [{"to":"s2","label":"<ág-felirat döntésnél, egyébként null>"}] } ] }`,
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
    "Elágazásnál (decide) a next-elemek label-je az ág neve. A kezdő és a záró",
    "állapot type-ja start_end. Az eredmény magyarul készül.",
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
    "tartalmazzon számot. Az eredmény magyarul készül.",
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

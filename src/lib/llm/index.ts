import "server-only";
import Anthropic from "@anthropic-ai/sdk";

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

/** A válaszból kinyeri a szöveges (text) blokkok összefűzött tartalmát. */
function textFromMessage(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

// ── generateDraft ────────────────────────────────────────────

export interface GenerateDraftParams {
  /** Fázis azonosító (pl. "P0"). */
  phase: string;
  /** Strukturált bemenetek (opcionális kulcs-érték kontextus). */
  structuredInputs?: Record<string, unknown>;
  /** Nyers forrásanyag, amelyből a draft készül. */
  rawMaterial: string;
  /** Sablon-kulcs, amely a generálás stílusát/formátumát vezérli. */
  templateKey?: string;
}

export interface GenerateDraftResult {
  body: string;
}

/**
 * Draft artefaktum generálása egy fázishoz.
 * Nyers anyag + kontextus → strukturált, ember által jóváhagyható draft.
 */
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

// ── extract ──────────────────────────────────────────────────

export interface ExtractParams {
  /** Nyers anyag, amelyből strukturált elemeket nyerünk ki. */
  rawMaterial: string;
  /** A kinyerendő elemek céltípusa (pl. "requirement", "risk", "stakeholder"). */
  targetType: string;
}

export interface ExtractedItem {
  type: string;
  content: string;
}

export interface ExtractResult {
  items: ExtractedItem[];
}

/**
 * Strukturált elemek kinyerése nyers anyagból egy adott céltípusra.
 * A modellt JSON-kimenetre kérjük, majd defenzíven parse-oljuk.
 */
export async function extract(params: ExtractParams): Promise<ExtractResult> {
  const { rawMaterial, targetType } = params;

  const system =
    "Strukturált információ-kinyerő vagy. A megadott nyers anyagból kinyered a " +
    "kért típusú elemeket, és KIZÁRÓLAG érvényes JSON-t adsz vissza, semmi mást.";

  const userPrompt = [
    `Céltípus: ${targetType}`,
    "",
    "── Nyers anyag ──",
    rawMaterial,
    "",
    'Add vissza a kinyert elemeket pontosan ebben a JSON-formátumban:',
    '{ "items": [ { "type": "<céltípus>", "content": "<elem szövege>" } ] }',
    "Ha nincs releváns elem, üres tömböt adj vissza. Csak JSON-t adj vissza.",
  ].join("\n");

  const client = getClient();
  const message = await client.messages.create({
    model: getModel(),
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });

  const raw = textFromMessage(message);
  const items = parseItems(raw, targetType);
  return { items };
}

/** Kinyeri és validálja az items tömböt a modell szöveges válaszából. */
function parseItems(raw: string, targetType: string): ExtractedItem[] {
  const jsonText = stripCodeFences(raw);
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { items?: unknown }).items)
    ) {
      const rawItems = (parsed as { items: unknown[] }).items;
      return rawItems
        .map((item) => {
          if (item && typeof item === "object") {
            const obj = item as Record<string, unknown>;
            const content =
              typeof obj.content === "string" ? obj.content : String(obj.content ?? "");
            const type = typeof obj.type === "string" ? obj.type : targetType;
            return { type, content };
          }
          return { type: targetType, content: String(item) };
        })
        .filter((item) => item.content.length > 0);
    }
  } catch {
    // esik át a fallbackre
  }
  return [];
}

/** Eltávolítja az esetleges ```json ... ``` kódkerítést. */
function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    return fenced[1].trim();
  }
  return text.trim();
}

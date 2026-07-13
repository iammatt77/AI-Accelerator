// ─────────────────────────────────────────────────────────────
// Artefaktum-típus konfig (Coding-csomag #5a, A melléklet).
// TS-ben él, nem DB-ben. Tiszta modul: kliens és szerver egyaránt
// importálhatja (LLM-hívás és DB-írás a server-only rétegekben).
//
// ÚJ TÍPUS FELVÉTELE = egy új ArtifactTypeDef bejegyzés az
// ARTIFACT_TYPES tömbben (mezőséma + body-sablon) + a mező-labelek
// felvétele a messages/hu.json és en.json `fields` névterébe.
// A motor (extract → megerősítés → generálás → státuszlánc) típus-
// agnosztikus: motorkód-módosítás NEM szükséges.
// ─────────────────────────────────────────────────────────────

import type { PhaseId } from "@/lib/phases/config";

// ── A fields jsonb tárolt alakja (mezőnként) ─────────────────

export const FIELD_STATES = ["ai_filled", "confirmed", "manual", "missing"] as const;
export type FieldState = (typeof FIELD_STATES)[number];

export interface ArtifactFieldValue {
  value: string | null;
  /** 1-alapú forrás-indexek (a számozott forrás-listára mutatnak). */
  source_indices: number[];
  state: FieldState;
}

export type ArtifactFields = Record<string, ArtifactFieldValue>;

// ── Típusdefiníció ───────────────────────────────────────────

export interface ArtifactFieldDef {
  /** A fields jsonb kulcsa. */
  key: string;
  /** i18n label-kulcs (messages `fields` névtér). */
  labelKey: string;
  /** Locale-független magyar label a GENERÁLÁSI prompthoz — az adapter
   *  promptja nem függhet a UI-nyelvtől (i18n-védőkorlát). */
  labelHu: string;
  required: boolean;
  /** Rövid magyar leírás a promptnak: mit jelent a mező. */
  promptHint: string;
}

export interface BodySection {
  /** A generált md szekció-címe (magyar — a body nyelve fix HU). */
  title: string;
  /** Generálási instrukció ehhez a szekcióhoz (magyar, a promptba kerül). */
  instruction: string;
}

export interface ArtifactTypeDef {
  /** AZONOS a DB artifacts.type értékével. */
  key: string;
  /** i18n kulcs a típus UI-megnevezéséhez. */
  nameKey: string;
  /** Fázis-kötés: melyik fázis-munkaterület dolgozik ezzel a típussal. */
  phase: PhaseId;
  fields: ArtifactFieldDef[];
  /** Body-sablon: md szekció-váz + generálási instrukciók. */
  template: {
    /** Átfogó instrukció a generáláshoz (magyar). */
    instruction: string;
    sections: BodySection[];
  };
}

// ── Projekt-charter — referencia-implementáció (P0) ──────────

export const PROJECT_CHARTER: ArtifactTypeDef = {
  key: "Projekt-charter",
  nameKey: "artifactTypes.projektCharter",
  phase: "P0",
  fields: [
    {
      key: "cel",
      labelKey: "fields.charter.cel",
      labelHu: "Cél",
      required: true,
      promptHint:
        "A projekt célja: mit akar elérni az ügyfél ezzel a projekttel (1-2 tömör mondat).",
    },
    {
      key: "scope",
      labelKey: "fields.charter.scope",
      labelHu: "Scope",
      required: true,
      promptHint:
        "A projekt terjedelme: mely fázisok, folyamatok, területek tartoznak bele (és mi nem).",
    },
    {
      key: "szponzor",
      labelKey: "fields.charter.szponzor",
      labelHu: "Szponzor",
      required: true,
      promptHint: "A projekt szponzora az ügyfél szervezetében (szerep vagy név).",
    },
    {
      key: "idokeret",
      labelKey: "fields.charter.idokeret",
      labelHu: "Időkeret",
      required: true,
      promptHint: "A projekt időkerete (időtartam vagy határidő).",
    },
    {
      key: "sikerkriterium",
      labelKey: "fields.charter.sikerkriterium",
      labelHu: "Sikerkritérium",
      required: true,
      promptHint:
        "Mitől számít sikeresnek a projekt: elvárt, lehetőleg mérhető kimenetek.",
    },
    {
      key: "stakeholderek",
      labelKey: "fields.charter.stakeholderek",
      labelHu: "Stakeholderek",
      required: false,
      promptHint:
        "Érintett szereplők az ügyfél oldalán (szerepek, csapatok), ha a forrás említi.",
    },
  ],
  template: {
    instruction:
      "Projekt-charter: a tanácsadói engagement alapdokumentuma. Tömör, szakmai, " +
      "döntéshozónak írt szöveg; a megerősített mezőértékek tényként kezelendők.",
    sections: [
      {
        title: "Cél",
        instruction: "A projekt célja a `cel` mező alapján, 1 rövid bekezdésben.",
      },
      {
        title: "Scope",
        instruction:
          "A terjedelem a `scope` mező alapján; ha a források említenek scope-on kívüli " +
          "területet, az explicit kizárásként jelenjen meg.",
      },
      {
        title: "Szponzor & stakeholderek",
        instruction:
          "A `szponzor` és (ha van) a `stakeholderek` mező alapján; a szerepek felsorolása elég.",
      },
      {
        title: "Időkeret",
        instruction: "Az `idokeret` mező alapján, 1-2 mondatban.",
      },
      {
        title: "Sikerkritériumok",
        instruction:
          "A `sikerkriterium` mező alapján, felsorolásként; csak forrásból bővíthető.",
      },
    ],
  },
};

// ── Regiszter + lekérdezők ───────────────────────────────────

export const ARTIFACT_TYPES: ArtifactTypeDef[] = [PROJECT_CHARTER];

export function getTypeDef(key: string): ArtifactTypeDef | null {
  return ARTIFACT_TYPES.find((t) => t.key === key) ?? null;
}

/** A fázishoz kötött artefaktum-típusok (①–③ zónák ebből dolgoznak). */
export function typesForPhase(phase: PhaseId): ArtifactTypeDef[] {
  return ARTIFACT_TYPES.filter((t) => t.phase === phase);
}

// ── fields jsonb defenzív parse + származtatott kijelzők ────

function isFieldState(value: unknown): value is FieldState {
  return typeof value === "string" && (FIELD_STATES as readonly string[]).includes(value);
}

export const EMPTY_FIELD: ArtifactFieldValue = {
  value: null,
  source_indices: [],
  state: "missing",
};

/**
 * A DB-ből jött fields jsonb defenzív normalizálása a típusdefinícióra:
 * hiányzó/rontott mező → missing; ismeretlen (nem definiált) kulcsok
 * kimaradnak. A visszaadott objektum a def MINDEN mezőjét tartalmazza.
 */
export function parseArtifactFields(
  def: ArtifactTypeDef,
  raw: unknown,
): ArtifactFields {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const result: ArtifactFields = {};
  for (const fieldDef of def.fields) {
    const candidate = source[fieldDef.key];
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const obj = candidate as Record<string, unknown>;
      const value = typeof obj.value === "string" && obj.value.trim() !== "" ? obj.value : null;
      const state = isFieldState(obj.state) ? obj.state : value ? "manual" : "missing";
      const source_indices = Array.isArray(obj.source_indices)
        ? [...new Set(
            obj.source_indices.filter(
              (n): n is number => Number.isInteger(n) && (n as number) > 0,
            ),
          )]
        : [];
      // érték nélkül nem lehet "kitöltött" állapot
      result[fieldDef.key] = value
        ? { value, source_indices, state: state === "missing" ? "manual" : state }
        : { ...EMPTY_FIELD };
    } else {
      result[fieldDef.key] = { ...EMPTY_FIELD };
    }
  }
  return result;
}

/** Kitöltött = van értéke és nem missing (A melléklet). */
export function isFilled(field: ArtifactFieldValue): boolean {
  return field.state !== "missing" && Boolean(field.value && field.value.trim() !== "");
}

/** Hiányzó KÖTELEZŐ mezők (approve kemény blokk alapja). */
export function missingRequiredFields(
  def: ArtifactTypeDef,
  fields: ArtifactFields,
): ArtifactFieldDef[] {
  return def.fields.filter(
    (f) => f.required && !isFilled(fields[f.key] ?? EMPTY_FIELD),
  );
}

/** Nem megerősített (ai_filled) mezők (approve-figyelmeztetés, nem blokk). */
export function unconfirmedFields(
  def: ArtifactTypeDef,
  fields: ArtifactFields,
): ArtifactFieldDef[] {
  return def.fields.filter((f) => (fields[f.key] ?? EMPTY_FIELD).state === "ai_filled");
}

/** Teljesség-pill: „x/y kötelező kitöltve". */
export function completeness(
  def: ArtifactTypeDef,
  fields: ArtifactFields,
): { filled: number; required: number } {
  const required = def.fields.filter((f) => f.required);
  const filled = required.filter((f) => isFilled(fields[f.key] ?? EMPTY_FIELD)).length;
  return { filled, required: required.length };
}

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
  /** Csomag A (A1/A2) D3-partíció: a mező GAZDÁJA a modul-sync
   *  (syncDoc/syncReport) — a field-extract NEM javasol rá, a szerkesztőben
   *  read-only („a modulból frissül"). Doc-mezőn nincs beállítva. */
  moduleOwned?: boolean;
  /** 4.2b (F3-b): a mező DOKUMENTUM-SZERKEZET (napirend, résztvevő-lista,
   *  előkészület-lista), nem tudás-állítás — a tudáselem-katalógus 4.2
   *  FOGYASZTÓI (címkéző köteg, katalógus-oldal) kihagyják. A 2.1
   *  knowledge_catalog nézet érintetlen (védett felület). */
  knowledgeExempt?: boolean;
}

export interface BodySection {
  /** A generált md szekció-címe (magyar — a body nyelve fix HU). */
  title: string;
  /** Generálási instrukció ehhez a szekcióhoz (magyar, a promptba kerül). */
  instruction: string;
}

export interface ArtifactTemplate {
  /** Átfogó instrukció a generáláshoz (magyar). */
  instruction: string;
  sections: BodySection[];
}

export interface ArtifactTypeDef {
  /** AZONOS a DB artifacts.type értékével. */
  key: string;
  /** i18n kulcs a típus UI-megnevezéséhez. */
  nameKey: string;
  /** Fázis-kötés: melyik fázis-munkaterület dolgozik ezzel a típussal. */
  phase: PhaseId;
  /** Kapu-hordozó ([K]): a fázis kapuja e deliverable Approved-jától függ. */
  gate: boolean;
  fields: ArtifactFieldDef[];
  /** Body-sablon: md szekció-váz + generálási instrukciók.
   *  Ha NINCS egyedi sablon, a generikus szabály él (resolveTemplate):
   *  rövid bevezető + a mezők sorrendben mint szekciók. */
  template?: ArtifactTemplate;
  /** #7a: a mezők forrása ENTITÁS (megerősített use case-ek), nem szabad-
   *  szöveges kivonatolás — a ② generikus extract e típusra nem fut, a
   *  mezőket a „…az entitásokból" akció tölti (confirmed állapottal).
   *  A mezőséma változatlan, csak a mezők FORRÁSA más. */
  entitySourced?: boolean;
  /** Csomag A (A6) kivezetés: a típus NEM hozható létre és nem jelenik meg
   *  a fázis-munkaterületen/csempéken, de a getTypeDef feloldja — a meglévő
   *  artifact-sorok a tárban/olvasóban működnek (adat nem törlődik). */
  retired?: boolean;
}

/** Generikus body-sablon szabály (#6): egyedi sablon híján a szekciók =
 *  rövid bevezető + a mezők a definíció sorrendjében. */
export function resolveTemplate(def: ArtifactTypeDef): ArtifactTemplate {
  if (def.template) return def.template;
  return {
    instruction:
      `${def.key}: a fázis deliverable-je. Tömör, szakmai, döntéshozónak írt ` +
      "dokumentum; a megerősített mezőértékek tényként kezelendők.",
    sections: [
      {
        title: "Bevezető",
        instruction:
          "Rövid (2-3 mondatos) bevezető a dokumentum céljáról és kontextusáról.",
      },
      ...def.fields.map((fieldDef) => ({
        title: fieldDef.labelHu,
        instruction: `A(z) \`${fieldDef.key}\` mező alapján. ${fieldDef.promptHint}`,
      })),
    ],
  };
}

// ── Projekt-charter — referencia-implementáció (P0) ──────────

export const PROJECT_CHARTER: ArtifactTypeDef = {
  key: "Projekt-charter",
  nameKey: "artifactTypes.projektCharter",
  phase: "P0",
  gate: true, // [K] — a P0 PUHA kapuja (charter_approved) hordozója
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

// ── Deliverable-térkép P0–P6 (#6, Melléklet A) ───────────────
// A 17 új típus generikus body-sablonnal él (resolveTemplate); a mező-
// labelek a messages `fields.<slug>.<key>` kulcsain, a locale-független
// magyar label a labelHu-n.

/** Mező-builder: labelKey a `fields.<slug>.<key>` konvencióval. */
function f(
  slug: string,
  key: string,
  labelHu: string,
  required: boolean,
  promptHint: string,
  moduleOwned?: boolean,
  knowledgeExempt?: boolean,
): ArtifactFieldDef {
  return {
    key,
    labelKey: `fields.${slug}.${key}`,
    labelHu,
    required,
    promptHint,
    ...(moduleOwned ? { moduleOwned: true } : {}),
    ...(knowledgeExempt ? { knowledgeExempt: true } : {}),
  };
}

function deliverable(
  key: string,
  nameKeySlug: string,
  phase: PhaseId,
  gate: boolean,
  fields: ArtifactFieldDef[],
): ArtifactTypeDef {
  return { key, nameKey: `artifactTypes.${nameKeySlug}`, phase, gate, fields };
}

// P0 — Engagement-setup (kapu változatlan: PUHA charter)
const ENGAGEMENT_TERV = deliverable("Engagement-terv", "engagementTerv", "P0", false, [
  f("engagement", "stakeholder_kor", "Stakeholder-kör", true, "Az engagement érintett stakeholderei és szerepeik."),
  f("engagement", "merfoldkovek", "Mérföldkövek", true, "A projekt fő mérföldkövei dátummal vagy héttel."),
  f("engagement", "kommunikacios_ritmus", "Kommunikációs ritmus", true, "Státusz- és egyeztetési ritmus: fórum, gyakoriság, résztvevők."),
  f("engagement", "munkamodszer", "Munkamódszer", false, "Az együttműködés módja: műhelyek, interjúk, eszközök."),
  f("engagement", "kockazatok", "Kockázatok", false, "Az engagement kockázatai és kezelésük."),
]);

// 4.2b (F3-b): a résztvevő-lista, a napirend és az előkészület-lista
// DOKUMENTUM-SZERKEZET — sorszámozott/felsorolt logisztika, nem tudás-
// állítás. knowledgeExempt: a 4.2 fogyasztói kihagyják (a spec példája:
// a napirendi pontokból „1. A helyzetértékelés… 2. A" törmelék lett).
const KICKOFF_AGENDA = deliverable("Kickoff-agenda", "kickoffAgenda", "P0", false, [
  f("kickoff", "resztvevok", "Résztvevők", true, "A kickoff résztvevői és szerepeik.", undefined, true),
  f("kickoff", "napirend", "Napirend", true, "A kickoff napirendi pontjai időkerettel.", undefined, true),
  f("kickoff", "celok", "Célok", true, "A kickoff elvárt kimenetei."),
  f("kickoff", "elokeszuletek", "Előkészületek", false, "Előzetesen bekérendő anyagok és teendők.", undefined, true),
]);

// P1 — Felderítés & felmérés (kapu: KEMÉNY = shortlist Approved)
// #7a: entitás-forrású — a mezőket a megerősített use case-entitásokból
// tölti a generálás (F4); a mezőséma a #6-ból VÁLTOZATLAN.
const USE_CASE_SHORTLIST: ArtifactTypeDef = {
  ...deliverable("Priorizált use case-shortlist", "useCaseShortlist", "P1", true, [
    f("shortlist", "shortlist", "Shortlist", true, "Rangsorolt use case-lista, elemenként rövid indoklással."),
    f("shortlist", "ertekelesi_szempontok", "Értékelési szempontok", true, "A rangsorolás szempontjai és súlyaik."),
    f("shortlist", "quick_win", "Quick win", true, "A quick win jelölt megnevezése és rövid indoklása."),
    f("shortlist", "kizart_jeloltek", "Kizárt jelöltek", false, "A kizárt use case-ek és a kizárás oka."),
    f("shortlist", "kockazati_jegyzet", "Kockázati jegyzet", false, "A shortlist elemeihez tartozó fő kockázatok."),
  ]),
  entitySourced: true,
};

const FELMERESI_RIPORT = deliverable("Felmérési riport", "felmeresiRiport", "P1", false, [
  f("assessment", "vezetoi_osszefoglalo", "Vezetői összefoglaló", true, "A felmérés fő üzenetei döntéshozói tömörséggel."),
  f("assessment", "as_is_attekintes", "AS-IS áttekintés", true, "A jelenlegi folyamatok és működés áttekintése."),
  f("assessment", "fajdalompontok", "Fájdalompontok", true, "Az azonosított fájdalompontok és hatásuk."),
  f("assessment", "adat_es_ai_erettse", "Adat- és AI-érettség", true, "Az adatok minőségének és a szervezet AI-érettségének értékelése."),
  f("assessment", "megallapitasok", "Megállapítások", false, "További megállapítások és javaslatok."),
]);

// P2 — Priorizálás & megoldás-definíció (kapu: KEMÉNY = Business case + Pilot-terv)
const BUSINESS_CASE = deliverable("Business case", "businessCase", "P2", true, [
  f("businesscase", "problema_es_hatas", "Probléma és hatás", true, "A megoldandó probléma és üzleti hatása."),
  f("businesscase", "megoldas_osszefoglalo", "Megoldás-összefoglaló", true, "A javasolt megoldás tömör leírása."),
  f("businesscase", "haszon_szamitas", "Haszon-számítás", true, "A várt haszon számítása és feltételezései."),
  f("businesscase", "koltsegek", "Költségek", true, "Bevezetési és üzemeltetési költségek."),
  f("businesscase", "outcome_metrika", "Outcome-metrika", true, "A realizált értéket mérő metrika — a felszabadult idő nem azonos a realizált megtakarítással."),
  f("businesscase", "kockazatok", "Kockázatok", false, "Fő kockázatok és mérséklésük."),
]);

// A Rendszer-spec poka-yoke-ja: baseline + számszerű küszöb + döntési
// szabály KÖTELEZŐ mezők — nélkülük az 5a approve-blokk nem enged Approved-ra.
const PILOT_TERV = deliverable("Pilot-terv", "pilotTerv", "P2", true, [
  f("pilotplan", "hipotezis", "Hipotézis", true, "A pilot által tesztelt hipotézis."),
  f("pilotplan", "resztvevok_idotartam", "Résztvevők és időtartam", true, "A pilot résztvevői köre és időtartama."),
  f("pilotplan", "baseline", "Baseline", true, "A kiinduló állapot mért értéke, amihez a pilot mér."),
  f("pilotplan", "szamszeru_kuszob", "Számszerű küszöb", true, "A sikerküszöb számszerűen."),
  f("pilotplan", "dontesi_szabaly", "Döntési szabály", true, "Scale/pivot/stop szabály a küszöb függvényében."),
  f("pilotplan", "meresi_mod", "Mérési mód", true, "Hogyan és milyen forrásból mérünk a pilot alatt."),
]);

// Csomag A (A5): entitás-forrású — a mezőket a JÓVÁHAGYOTT solution_
// components + HITL-nyertes opciók töltik determinisztikusan (D2-átkötés);
// a szabad-szöveges kivonatolási út erre a típusra megszűnt.
const MEGOLDASI_JAVASLAT: ArtifactTypeDef = {
  ...deliverable("Megoldási javaslat", "megoldasiJavaslat", "P2", false, [
    f("solution", "valasztott_use_case", "Választott use case", true, "A kiválasztott use case és a választás háttere."),
    f("solution", "megoldas_leiras", "Megoldás-leírás", true, "A javasolt megoldás működésének leírása."),
    f("solution", "opcio_osszevetes", "Opció-összevetés", true, "A mérlegelt opciók összevetése."),
    f("solution", "dontesi_kriterium", "Döntési kritérium", true, "A döntést vezérlő kritériumok."),
  ]),
  entitySourced: true,
};

// Epic 3 · 3.5: D2-ként visszahozva — a Csomag A (A6) kivezette, mert
// field-extractként a NYERSFORRÁSBÓL kivont, párhuzamosan a TO-BE
// folyamattérképpel (elcsúszás-kockázat). A helyes mechanizmus: a
// jóváhagyott TO-BE térkép egyetlen igazság-forrásból RENDERELŐDIK
// (mint a Use case-rangsor) — nincs önálló kivonás, nincs elcsúszás.
const TO_BE_TERV: ArtifactTypeDef = {
  ...deliverable("TO-BE terv", "toBeTerv", "P2", false, [
    f("tobe", "to_be_lepesek", "TO-BE lépések", true, "A cél-folyamat lépései sorrendben."),
    f("tobe", "beavatkozasi_pontok", "Beavatkozási pontok", true, "Hol változik a folyamat az AS-IS-hez képest."),
    f("tobe", "hitl_kontrollok", "HITL-kontrollok", true, "Az emberi ellenőrzési pontok a folyamatban."),
    f("tobe", "valtozas_hatasa", "Változás hatása", false, "A változás hatása szerepekre és terhelésre."),
  ]),
  entitySourced: true,
};

// P3 — Build (kapu: KEMÉNY, INTERIM = Megoldás-dok. + Tesztriport)
const MEGOLDAS_DOKUMENTACIO = deliverable(
  "Megoldás-dokumentáció", "megoldasDokumentacio", "P3", true, [
  f("solutiondoc", "architektura", "Architektúra", true, "A megoldás architektúrája és fő folyamatai."),
  f("solutiondoc", "komponensek", "Komponensek", true, "A komponensek és felelősségeik.", true),
  f("solutiondoc", "prompt_konyvtar", "Prompt-könyvtár", true, "Hivatkozás a használt promptokra és verziójukra.", true),
  f("solutiondoc", "guardrail_hitl", "Guardrail és HITL", true, "A beépített guardrail-ek és emberi kontrollpontok.", true),
  f("solutiondoc", "uzemeltetesi_jegyzet", "Üzemeltetési jegyzet", false, "Üzemeltetési tudnivalók és függőségek."),
]);

const TESZTRIPORT = deliverable("Tesztriport", "tesztriport", "P3", true, [
  f("testreport", "golden_set_eredmeny", "Golden set eredmény", true, "A golden set futásának eredményei.", true),
  f("testreport", "atmenesi_arany", "Átmenési arány", true, "Az átmenési arány számszerűen.", true),
  f("testreport", "hibak_javitasok", "Hibák és javítások", true, "A talált hibák és a javításuk.", true),
  f("testreport", "maradek_kockazat", "Maradék kockázat", false, "A fennmaradó ismert kockázatok."),
]);

// P4 — Pilot & validáció (kapu: KEMÉNY, INTERIM = Pilot-riport)
const PILOT_RIPORT = deliverable("Pilot-riport", "pilotRiport", "P4", true, [
  f("pilotreport", "mert_eredmenyek", "Mért eredmények", true, "A pilot alatt mért eredmények."),
  f("pilotreport", "delta_vs_baseline", "Delta vs. baseline", true, "A változás a baseline-hoz képest."),
  f("pilotreport", "kuszob_ertekeles", "Küszöb-értékelés", true, "A számszerű küszöb teljesülésének értékelése."),
  f("pilotreport", "visszajelzesek", "Visszajelzések", true, "A résztvevők visszajelzései."),
  f("pilotreport", "tanulsagok", "Tanulságok", false, "A pilot tanulságai."),
]);

const DONTESI_BRIEF = deliverable("Döntési brief", "dontesiBrief", "P4", false, [
  f("decisionbrief", "evidencia_osszefoglalo", "Evidencia-összefoglaló", true, "A döntést megalapozó evidenciák összefoglalása."),
  f("decisionbrief", "javasolt_dontes", "Javasolt döntés", true, "Scale/pivot/stop javaslat."),
  f("decisionbrief", "indoklas", "Indoklás", true, "A javasolt döntés indoklása."),
]);

// P5 — Adopció & skálázás (kapu: KEMÉNY, INTERIM = Rollout + Impact)
const ROLLOUT_TERV = deliverable("Rollout-terv", "rolloutTerv", "P5", true, [
  f("rollout", "utemezes", "Ütemezés", true, "A kiterjesztés ütemezése."),
  f("rollout", "erintett_csoportok", "Érintett csoportok", true, "A rollout által érintett csoportok."),
  f("rollout", "change_beavatkozasok", "Change-beavatkozások", true, "ADKAR szerinti change-beavatkozások."),
  f("rollout", "champion_halozat", "Champion-hálózat", false, "A champion-hálózat felépítése."),
]);

const IMPACT_RIPORT = deliverable("Impact-riport", "impactRiport", "P5", true, [
  f("impact", "baseline_osszefoglalo", "Baseline-összefoglaló", true, "A kiinduló állapot összefoglalása."),
  f("impact", "beavatkozas", "Beavatkozás", true, "A bevezetett változás leírása."),
  f("impact", "mert_delta", "Mért delta", true, "A mért változás számszerűen."),
  f("impact", "emberi_sztori", "Emberi sztori", true, "Egy konkrét felhasználói történet a hatásról."),
  f("impact", "kovetkezo_lepesek", "Következő lépések", false, "A következő lépések."),
]);

const KEPZESI_TERV = deliverable("Képzési terv", "kepzesiTerv", "P5", false, [
  f("training", "celcsoportok", "Célcsoportok", true, "A képzés célcsoportjai."),
  f("training", "alkalmak_utem", "Alkalmak és ütem", true, "A képzési alkalmak és ütemezésük."),
  f("training", "anyagok", "Anyagok", false, "A képzési anyagok."),
]);

// P6 — Üzemeltetés & optimalizálás (kapu változatlan: NINCS)
const HAVI_STATUSZRIPORT = deliverable("Havi státuszriport", "haviStatuszriport", "P6", false, [
  f("status", "idoszak", "Időszak", true, "A riport időszaka."),
  f("status", "uzemeltetesi_osszefoglalo", "Üzemeltetési összefoglaló", true, "Az időszak üzemeltetési összefoglalója."),
  f("status", "incidensek", "Incidensek", true, "Az időszak incidensei és kezelésük."),
  f("status", "backlog_kiemelesek", "Backlog-kiemelések", false, "A backlog kiemelt tételei."),
]);

const JAVASLAT_DOKUMENTUM = deliverable("Javaslat-dokumentum", "javaslatDokumentum", "P6", false, [
  f("proposal", "javaslat", "Javaslat", true, "A javasolt fejlesztés vagy változtatás."),
  f("proposal", "varhato_ertek", "Várható érték", true, "A javaslat várható értéke."),
  f("proposal", "kovetkezo_use_case", "Következő use case", true, "A következő use case jelölt."),
]);

// ── Regiszter + lekérdezők ───────────────────────────────────

export const ARTIFACT_TYPES: ArtifactTypeDef[] = [
  PROJECT_CHARTER,
  ENGAGEMENT_TERV,
  KICKOFF_AGENDA,
  USE_CASE_SHORTLIST,
  FELMERESI_RIPORT,
  BUSINESS_CASE,
  PILOT_TERV,
  MEGOLDASI_JAVASLAT,
  TO_BE_TERV,
  MEGOLDAS_DOKUMENTACIO,
  TESZTRIPORT,
  PILOT_RIPORT,
  DONTESI_BRIEF,
  ROLLOUT_TERV,
  IMPACT_RIPORT,
  KEPZESI_TERV,
  HAVI_STATUSZRIPORT,
  JAVASLAT_DOKUMENTUM,
];

/** A fázis kapu-hordozó ([K]) deliverable-típusai. */
export function gateTypesForPhase(phase: PhaseId): ArtifactTypeDef[] {
  return ARTIFACT_TYPES.filter((t) => t.phase === phase && t.gate);
}

export function getTypeDef(key: string): ArtifactTypeDef | null {
  return ARTIFACT_TYPES.find((t) => t.key === key) ?? null;
}

/** 4.2b (F3-b): szerkezet-mező-e a (típus, mező-kulcs) pár — a tudáselem-
 *  katalógus 4.2 fogyasztói (címkéző köteg, katalógus-oldal) ennek alapján
 *  hagyják ki a cédulát. Ismeretlen típus/mező → NEM kivétel (konzervatív). */
export function isKnowledgeExemptField(artifactType: string, fieldKey: string): boolean {
  const def = getTypeDef(artifactType);
  return def?.fields.find((fd) => fd.key === fieldKey)?.knowledgeExempt === true;
}

/** A fázishoz kötött artefaktum-típusok (①–③ zónák ebből dolgoznak).
 *  A retired típus itt NEM jelenik meg (A6: új példány nem hozható létre). */
export function typesForPhase(phase: PhaseId): ArtifactTypeDef[] {
  return ARTIFACT_TYPES.filter((t) => t.phase === phase && !t.retired);
}

/** A tár nézete: a retired típusokat IS tartalmazza — a meglévő artifact-
 *  sorok olvashatók maradnak (a tár dönt, mutatja-e az üres retired sort). */
export function typesForPhaseAll(phase: PhaseId): ArtifactTypeDef[] {
  return ARTIFACT_TYPES.filter((t) => t.phase === phase);
}

// ── Dokumentum-típus osztályozás (Epic 3 · 3.2) ──────────────
// D1 = szabad-szöveges field-extract (a ② kivonatolja, mezőnként E1);
// D2 = entitásból renderelt (entitySourced — a ③ „generálás" gombja tölti,
//      a ② nem hordoz rá kivonatolást);
// D3 = modul-szinkronizált, mező-partícióval (van moduleOwned mezője —
//      azokat KIZÁRÓLAG a modul-sync írja; a fennmaradó szabad mezőket
//      a ③-kártya beágyazott kivonatolása tölti, mert a ② üres marad).
// A besorolás a típus-tulajdonságokból DERIVÁLT — nincs fázis-specifikus
// hardkód, a szabály bármely jövőbeli típusra/fázisra ugyanígy érvényes.
export type DocType = "D1" | "D2" | "D3";

export function docTypeOf(typeDef: ArtifactTypeDef): DocType {
  if (typeDef.entitySourced) return "D2";
  if (typeDef.fields.some((f) => f.moduleOwned)) return "D3";
  return "D1";
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

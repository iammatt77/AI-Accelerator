# Audit — ✦ Kivonatolás gomb: hol van mögötte tényleges AI-lépés (2026-07-19)

**Típus:** read-only felmérés. **Nincs kód-, séma- vagy migráció-változtatás.** Branch: `dev`. A jelentés a design-agent gomb-visszarakási utasításának alapja.
**Kérdés elemenként:** van-e a háttérben LLM-hívás, amely nyersanyagból / forrásból / előző fázis outputjából **mezőt / besorolást / tartalom-javaslatot** állít elő (az E1-lánc AI-fele)? → **KELL** a ✦ Kivonatolás gomb. Ha kézi / számított / forrás → **NEM KELL**.

> **Fogalmi elhatárolás (fontos):** a rendszerben KÉT külön AI-akció van. **✦ Kivonatolás** = forrás → mező/besorolás/javaslat (E1 első fele, `extract*`/`suggest*` az adapterben). **✦ Generálás** = a MÁR megerősített mezőkből body/dokumentum (`generateBody`). Ez az audit **kizárólag a ✦ Kivonatolásról** szól — a ✦ Generálás külön gomb, nem tárgya.

Az egyetlen AI-belépő: `src/lib/llm/index.ts` (governance-adapter). A valódi `messages.create`-et tartalmazó függvények az „AI-lépés" bizonyítékai; a `mock*` párjuk csak a `MOCK_LLM=1` fixture.

---

## 1. Tool-leltár (② Munkaeszközök) — van-e AI-lépés, hol

| Tool (fázis) | AI-lépés a kódban (függvény) | LLM-hívás | Jelleg |
|---|---|---|---|
| **Fájdalompontok** (P1) | `extractPainPoints` → `extractPainPointsAction` | **igen** | forrás → entitás-javaslat (E1) |
| **Use case-ek** (P1) | `deriveUseCases` → `deriveUseCasesAction` | **igen** | fájdalompont+forrás → use case-javaslat (E1) |
| **Stakeholderek** (P1) | `extractStakeholders` → `extractStakeholdersAction` | **igen** | forrás → stakeholder-javaslat (E1) |
| **Érték×megvalósíthatóság hőtérkép** (P1, #7a) | — (`scoreUseCaseAction`, `entity-actions.ts:638`) | **nincs** | **tisztán kézi**: `score_value`/`score_feasibility` a `formData`-ból, 1–5 emberi bevitel |
| **Értékelők** (P1/#7b: AI-alkalmasság · adatérettség · AI Act) | `suggestAiActCategory` / `suitabilityVerdict` / `readinessLevel` (`lib/entities/evaluators.ts`) | **nincs** | **kérdőív + szabály-derivált**: emberi válaszokból determinisztikus besorolás, NEM LLM |
| **Folyamattérkép** (P1→P2) | `extractProcessMap` + `suggestToBeProcess` + `chatEditProcess` | **igen (3)** | leiratból AS-IS · dokumentum/AI TO-BE · chat-szerkesztés (E1) |
| **Követelmények** (P2) | `suggestRequirements` + `suggestStories` + `suggestAcDraft` + `suggestStoryDraft` | **igen (4)** | forrás+fájdalompont+TO-BE → követelmény-fa · story · AC-vázlat (E1) |
| **Megoldás-terv** (P2) | `suggestComponents` + `suggestOptions` | **igen (2)** | forrás → komponens- és opció-javaslat (E1) |
| **Megoldás-dok.** (P3) | `suggestBuildDoc` + `suggestImplLinks` | **igen (2)** | építési anyagból komponens/prompt/kontroll · kötés-javaslat (E1) |
| **Golden set & riport** (P3) | `suggestEvalCases` + `suggestVerdict` + `suggestResidualRisk` | **igen (3)** | forrásból teszteset · besorolás-ajánlás · maradék kockázat (E1) |

**A nyitott kérdés lezárva:** az **Érték×megvalósíthatóság mátrix/hőtérkép tisztán KÉZI** — a tengelyek (`score_value` × `score_feasibility`) a `scoreUseCaseAction` emberi űrlapjából jönnek (1–5), nincs mögötte LLM-besorolás. (Az upstream AI-lépés a `deriveUseCases`, amely a use case-eket létrehozza; a pontozást ember végzi.) A **#7b értékelők** nevükben „AI-…", de a kódban **kérdőív + szabály-derivált** (`suggestAiActCategory` egy determinisztikus mapping, nem `messages.create`).

---

## 2. Kimenet-leltár (③ Kimenet / deliverable) — a mezők forrása

A generikus `extract(sources, typeDef)` mögöttes lépése minden field-extract deliverable-nél fut; az `entitySourced` típusnál **szerveroldalon tiltott** (`artifact-actions.ts:144` → `entitySourcedNoExtract`).

| Deliverable (fázis) | Mezők forrása | AI-kivonatolás (`extract`) |
|---|---|---|
| **Projekt-charter** (P0) | forrás → mező | **igen** (field-extract) |
| **Engagement-terv** (P0) | forrás → mező | **igen** |
| **Kickoff-agenda** (P0) | forrás → mező | **igen** |
| **Felmérési riport** (P1) | forrás → mező | **igen** |
| **Priorizált use case-shortlist** (P1) | **megerősített use case entitásokból** származtatott (`entitySourced: true`, config:241) | **NINCS** — a generikus extract szerveroldalon tiltott; a mezők a confirmed entitásokból + a source-uniófából állnak |
| **Business case** (P2) | forrás → mező **+** strukturált `suggestBenefitInputs` (haszon-kalkulátor) | **igen (2 úton)**: field-extract + BenefitCalculator ✦ |
| **Pilot-terv** (P2) | forrás → mező **+** strukturált `suggestPilotDefinition` (pilot sikerdefiníció) | **igen (2 úton)**: field-extract + PilotSuccessDefinition ✦ |
| **Megoldási javaslat** (P2) | forrás → mező | **igen** |
| **TO-BE terv** (P2) | forrás → mező (a TO-BE *térkép* maga a Folyamattérkép-toolból) | **igen** (a deliverable-mezőkre) |
| **Tesztriport** (P3) | **a Golden set modul szinkronjából** (`syncReportAction`) + ✦ maradék kockázat | field-extract technikailag NEM tiltott, de a **kanonikus AI a Golden set modul** — l. §5 nuance |
| **Megoldás-dokumentáció** (P3) | **a Megoldás-dok. modul szinkronjából** (`syncDocAction`) | field-extract technikailag NEM tiltott, de a **kanonikus AI a Megoldás-dok. modul** — l. §5 nuance |

---

## 3. Verdikt-tábla — KELL / NEM KELL a ✦ Kivonatolás gomb

### ② Munkaeszközök
| Elem | Verdikt | Indok (mögöttes lépés) |
|---|---|---|
| Fájdalompontok (P1) | **KELL** | `extractPainPoints` — forrás→entitás-javaslat |
| Use case-ek (P1) | **KELL** | `deriveUseCases` — fájdalompont→use case-javaslat |
| Stakeholderek (P1) | **KELL** | `extractStakeholders` — forrás→stakeholder-javaslat |
| **Hőtérkép (érték×megvalósíthatóság)** | **NEM KELL** | tisztán kézi pontozás (1–5), nincs LLM |
| **Értékelők (#7b AI-alkalmasság/adatérettség/AI Act)** | **NEM KELL** (✦ Kivonatolás értelemben) | kérdőív + szabály-derivált; nincs `messages.create`. (Külön „✦ javaslat"-gombja lehet a besoroló-derivációnak, de az NEM forrás-kivonatolás.) |
| Folyamattérkép (P1→P2) | **KELL** | `extractProcessMap` + `suggestToBeProcess` + `chatEditProcess` |
| Követelmények (P2) | **KELL** | `suggestRequirements` (+story/AC) |
| Megoldás-terv (P2) | **KELL** | `suggestComponents` + `suggestOptions` |
| Megoldás-dok. (P3) | **KELL** | `suggestBuildDoc` + `suggestImplLinks` |
| Golden set (P3) | **KELL** | `suggestEvalCases` (+verdict/residual) |

### ③ Kimenet (deliverable)
| Deliverable | Verdikt | Indok |
|---|---|---|
| Projekt-charter / Engagement-terv / Kickoff-agenda (P0) | **KELL** | field-extract (`extract`) |
| Felmérési riport (P1) | **KELL** | field-extract |
| **Priorizált use case-shortlist (P1)** | **NEM KELL** | `entitySourced` — szerveroldalon tiltott generikus extract; a mezők confirmed entitásokból. A UI itt `entitySourcedHint`-et mutasson, NE ✦ gombot |
| Business case (P2) | **KELL** | field-extract + `suggestBenefitInputs` (strukturált ✦) |
| Pilot-terv (P2) | **KELL** | field-extract + `suggestPilotDefinition` (strukturált ✦) |
| Megoldási javaslat / TO-BE terv (P2) | **KELL** | field-extract |
| Tesztriport (P3) | **KELL, de a Golden set modulban** | a mezők a modul-szinkronból (§5); a deliverable-szintű generikus extract másodlagos |
| Megoldás-dokumentáció (P3) | **KELL, de a Megoldás-dok. modulban** | a mezők a modul-szinkronból (§5) |

---

## 4. Újrafuttatás E1-viselkedése (a gomb másodlagos-akció szemantikájához)

Két, kódban igazolt minta — mindkettő **soha nem írja felül az emberi megerősítést**:

1. **Mező-szintű (`extract` / `extractAction`, `artifact-actions.ts:177–194`):** MERGE. A `confirmed`/`manual` állapotú mező **változatlan marad**; csak az `ai_filled`/`missing` frissül a friss javaslatra. Plusz-őr: csak **draft** artefaktumon fut (`artifactNotDraft` blokk), és `entitySourced` típuson tiltott.
   - Design-következmény: a ✦ Kivonatolás **másodlagos, biztonságos** akció — újrafuttatható; a megerősített mezőket nem veszélyezteti. Approved/in_review állapotban rejtett/tiltott.

2. **Entitás-szintű (`extractPainPoints`/`deriveUseCases`/`extractStakeholders`, `entity-actions.ts:95–137`, 379–422):** CSERE. A korábbi `ai_suggested` javaslatok **törlődnek és újraíródnak**; a `confirmed`/`manual` sorokat guard védi (`.eq("state","ai_suggested")`).
   - Design-következmény: az újrafuttatás a nem-megerősített javaslatokat frissíti, a megerősítetteket megtartja.

3. **Modul-generátorok (Követelmények/Megoldás-terv/Golden set/Megoldás-dok.):** jellemzően **üres-készletre** (pl. Golden set: `errAlreadyHasCases`) vagy **additív, név-deduppal** (Megoldás-dok.: a meglévő nevek kimaradnak) futnak — szintén E1, a megerősítettet nem bántják.

**Egységes szabály a gombhoz:** a ✦ Kivonatolás **idempotens, nem-destruktív másodlagos akció** — bármikor újrafuttatható, mert a megerősített (emberi) tartalmat egyik ág sem írja felül.

---

## 5. Regresszió-jelzés — hol létezik a logika, de hiányozhat a gomb

**A kódban jelenleg MINDEN AI-lépéshez van renderelt gomb** (nincs kód-szintű hiányzó trigger):
- Workspace ②: `ExtractForm` (field), `ExtractPainPointsForm`, `DeriveUseCasesForm`, `ExtractStakeholdersForm` (`WorkspaceForms.tsx`, `EntityForms.tsx`, `StakeholderForms.tsx`).
- Boardok: `RequirementsBoard`(generateRequirements) · `SolutionBoard`(generateComponents) · `GoldenSetBoard`(generateEvalCases) · `BuildDocBoard`(generateBuildDoc).
- Folyamattérkép: `ProcessGenPanels`(generateProcessMap + suggestToBe) · `ProcessChatDrawer`(chat).
- Szerkesztő: `BenefitCalculator`(suggestBenefitInputs) · `PilotSuccessDefinition`(suggestPilotDefinition) · `AcEditor`(generateAc) · `DeriveStoryPanel`(deriveStory/suggestStoryDraft).

**A regresszió tehát a MOCKUP/IA-átrendezés szintjén van, nem a kódban** (a ✦ gomb a ② „Munkaeszközök" tartalmából esett ki a design-átrendezéskor). Az autoritatív visszarakási lista = a §3 „KELL" sorai. **Kritikus figyelmeztetések a design-agentnek**, hogy a visszarakás ne lőjön túl/alá:

- **NE tegyél ✦ Kivonatolás gombot** a **Hőtérképre** (kézi pontozás) — vizuálisan csábító, de nincs mögötte AI.
- **NE tegyél ✦ Kivonatolás gombot** a **Priorizált use case-shortlist** deliverable-re — `entitySourced`, a szerver tiltja; ott az `entitySourcedHint` a helyes felület.
- **A #7b értékelők** besoroló-derivációja NEM ✦ Kivonatolás (kérdőív+szabály) — ha kap belépőt, az nem a forrás-kivonatoló gomb szemantikája.
- **P3 Tesztriport / Megoldás-dokumentáció:** a ✦ AI valódi otthona a **dedikált modul** (Golden set / Megoldás-dok.), nem a deliverable field-work-je. A gombot a modulban kell biztosítani; a deliverable-szintű generikus extract technikailag él, de nem a kanonikus út (a modul-szinkron felülírná).
- **Állapot-feltétel:** a ✦ Kivonatolás csak **draft** állapotban aktív (mező-szint); in_review/approved alatt rejtett/tiltott — a másodlagos-akció megjelenítése kövesse ezt.

---

## 6. Összegzés (egy mondat)
A ✦ Kivonatolás gomb **minden P0–P3 field-extract deliverable-re és minden AI-javasló toolra KELL** (Fájdalompont/Use case/Stakeholder/Folyamattérkép/Követelmények/Megoldás-terv/Megoldás-dok./Golden set), **NEM KELL** a kézi Hőtérképre, a kérdőív-alapú #7b értékelőkre és az `entitySourced` use case-shortlistre; a P3 Tesztriport/Megoldás-dok. AI-ja a dedikált modulban él. A kód minden triggert rendel; a regresszió a mockup-átrendezésé — a §3 a visszarakás autoritatív listája.

**Semmi kód nem változott** — csak ez a jelentés-fájl készült a `docs/state/`-be.

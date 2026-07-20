# Valós leltár — forráskinyerő · tool · dokumentum (P0–P3) (2026-07-20)

**Típus:** read-only tényfeltárás. **Nincs kód-, séma- vagy migráció-változtatás.** Branch: `dev`.
**Elv:** minden P0–P3 fázis-elem a **valódi kódbeli/UI-nevén**, három kategóriába sorolva. Javaslat/átrendezés/átnevezés NÉLKÜL. Ahol a besorolás nem egyértelmű: jelölve.

**A három kategória (a besorolás vezérelve — a kód olvasata szerint):**
- **FORRÁSKINYERŐ** — forrásból (`input_items`) épít reusable **tudáselem-ENTITÁST**, HITL-lel; a ② zóna belső lépése; **nincs** önálló nav-belépője.
- **TOOL** — a jóváhagyott entitásokból **mutat** (vizualizáció) vagy **továbbépít** (új entitás); jellemzően **nav-belépős** modul.
- **DOKUMENTUM** — `artifacts` deliverable (státuszlánc Draft→In review→Approved, jóváhagyható, exportálható).

> **Két név-tisztázás előre (a zavar forrásai):**
> 1. A `/builddoc` **TOOL** nav-neve **„Megoldás-dok." / „Solution doc"**, az általa gyártott **DOKUMENTUM** neve **„Megoldás-dokumentáció" / „Solution documentation"** — majdnem azonos, de két külön dolog.
> 2. A felhasználó által keresett **„Rangsorolt megoldási opciók"** név **NEM létezik** a kódban; a valós név **„Priorizált use case-shortlist" / „Prioritized use case shortlist"** (l. Q2).

---

## P0

| Elem (valódi név HU / EN) | Kategória | Kód (típuskulcs / komponens) | Miből / hová | [K]? |
|---|---|---|---|---|
| **Projekt-charter / Project charter** | DOKUMENTUM (field-extract) | type `Projekt-charter`; ② `ExtractForm`→`extract` tölti a mezőket | forrás: `input_items` (mind, teljes szöveg) → az artifact saját mezőibe | **[K]** (PUHA: charter_approved) |
| **Engagement-terv / Engagement plan** | DOKUMENTUM (field-extract) | type `Engagement-terv` | ua. | nem |
| **Kickoff-agenda / Kickoff agenda** | DOKUMENTUM (field-extract) | type `Kickoff-agenda` | ua. | nem |

*P0-ban nincs önálló FORRÁSKINYERŐ-entitás és nincs TOOL — a ② csak a dokumentum-mezők field-extractja.*

---

## P1

| Elem (valódi név) | Kategória | Kód | Miből / hová | ✦ / [K] |
|---|---|---|---|---|
| **Fájdalompontok** (i18n `entities` / „Pain points") | **FORRÁSKINYERŐ** | ② `EntityForms`; `extractPainPointsAction`→`extractPainPoints` | forrás: `input_items` → **`pain_points`** entitás; HITL (E1) | ✦ |
| **Use case-ek** | **FORRÁSKINYERŐ** | ② `EntityForms`; `deriveUseCasesAction`→`deriveUseCases` | `pain_points` + `input_items` → **`use_cases`** entitás; HITL | ✦ |
| **Stakeholderek** (kinyerő szerep) | **FORRÁSKINYERŐ** | ② `StakeholderForms`; `extractStakeholdersAction`→`extractStakeholders` | forrás: `input_items` → **`stakeholders`** entitás; HITL | ✦ |
| **Befolyás × Érintettség mátrix** (a Stakeholder tool-szerepe) | **TOOL** (vizualizáció) | `/stakeholder/[id]`, `StakeholderPage` (`hasMatrixPoint`/`scorePct`, „mátrix a HERO") | jóváhagyott `stakeholders.influence_score`/`impact_score`-ból; **mutat**, nem épít új entitást | nincs ✦ (kézi/derivált pontszám) |
| **Hőtérkép (érték × megvalósíthatóság)** | **TOOL** (vizualizáció) | `WorkbenchHeatmap`/`UseCaseHeatmap` a P1 ② jobb oszlopában (nincs saját route) | jóváhagyott `use_cases.score_value`/`score_feasibility`-ből; **mutat** | nincs ✦ (kézi pontozás) |
| **Felmérési riport / Assessment report** | DOKUMENTUM (field-extract) | type `Felmérési riport` | `input_items` → artifact mezők | nem |
| **Priorizált use case-shortlist / Prioritized use case shortlist** | DOKUMENTUM (**entitás-renderelt**) | type `Priorizált use case-shortlist` (`entitySourced: true`); ③ `GenerateShortlistFieldsForm`→`generateShortlistFromEntitiesAction` | a **jóváhagyott `use_cases` entitásokból** renderelve (nem field-extract; a generikus extract szerver-tiltott) | **[K]** |

*Fontos (Q1): a Fájdalompontok és Use case-ek **nem toolok** — nincs dedikált route (`ls`: nincs `pain`/`usecase`/`heatmap` route), csak a ② kinyerő+lista. A tool-szerep a rájuk épülő Hőtérkép (use case) és Befolyás×Érintettség mátrix (stakeholder).*

---

## P2

| Elem (valódi név HU / EN) | Kategória | Kód | Miből / hová | ✦ / [K] |
|---|---|---|---|---|
| **Folyamattérkép / Process map** (nav) | **TOOL** (+ belső forráskinyerő lépés) | `/process`, `ProcessMapViewer`; `generateProcessMapAction`→`extractProcessMap` (AS-IS), `suggestToBeAction`→`suggestToBeProcess` (TO-BE), `chatEditProcess` | **AS-IS:** `input_items` (1 **választott**) → `process_maps`; **TO-BE:** `process_maps`(AS-IS)+`pain_points` → `process_maps`; **mutat + továbbépít** | ✦ (AS-IS/TO-BE/chat) |
| **Követelmények / Requirements** (nav) | **TOOL** (entitás-építő) | `/requirements`, `RequirementsBoard`; `generateRequirementsAction`→`suggestRequirements`, `generateStoriesAction`→`suggestStories` | `pain_points`+`process_maps`(TO-BE)+`stakeholders` (+ forrás csak **címként**) → `requirements`/`user_stories` | ✦ |
| **Megoldás-terv / Solution plan** (nav) | **TOOL** (entitás-építő) | `/solution`, `SolutionBoard`; `generateComponentsAction`→`suggestComponents`, `generateOptionsAction`→`suggestOptions` | jóváhagyott TO-BE (`process_maps`)+`pain_points` (+ forrás **címként**) → `solution_components`/`component_options` | ✦ |
| **Business case / Business case** | DOKUMENTUM (field-extract + strukturált ✦) | type `Business case`; `BenefitCalculator` (`suggestBenefitInputsAction`) | `input_items` → artifact mezők + `benefit_calc` jsonb | **[K]** |
| **Pilot-terv / Pilot plan** | DOKUMENTUM (field-extract + strukturált ✦) | type `Pilot-terv`; `PilotSuccessDefinition` (`suggestPilotDefinitionAction`) | `input_items` → artifact mezők + `pilot_success` jsonb | **[K]** |
| **Megoldási javaslat / Solution proposal** | DOKUMENTUM (field-extract) | type `Megoldási javaslat` | `input_items` → artifact mezők | nem |
| **TO-BE terv / TO-BE plan** | DOKUMENTUM (field-extract) | type `TO-BE terv` | `input_items` → artifact mezők (l. Q4 — **nincs kötve** a Folyamattérkép/Megoldás-terv toolhoz) | nem |

---

## P3

| Elem (valódi név HU / EN) | Kategória | Kód | Miből / hová | ✦ / [K] |
|---|---|---|---|---|
| **Megoldás-dok. / Solution doc** (nav = a TOOL neve) | **TOOL** (entitás-építő) | `/builddoc`, `BuildDocBoard`; `seedFromP2Action`, `generateBuildDocAction`→`suggestBuildDoc`, `suggestImplLinks` | P2 `solution_components` (seed) + `input_items` (**teljes szöveg**) + TO-BE/req/story/pain → `build_components`/`impl_links`/`prompt_items`/`control_points` | ✦ |
| **Golden set & riport / Golden set & report** (nav = a TOOL neve) | **TOOL** (entitás-építő) | `/goldenset`, `GoldenSetBoard`; `generateEvalCasesAction`→`suggestEvalCases`, `suggestVerdict`, `suggestResidualRisk` | `use_cases` (cím+leírás) + `input_items` (**teljes szöveg**) → `eval_cases`/`eval_criteria` | ✦ |
| **Megoldás-dokumentáció / Solution documentation** | DOKUMENTUM (**entitás-render** `syncDocAction` + versengő field-extract) | type `Megoldás-dokumentáció` | a `/builddoc` entitásaiból `syncDocAction`-nel renderelve (3 mező); ± generikus ② extract | **[K]** |
| **Tesztriport / Test report** | DOKUMENTUM (**entitás-render** `syncReportAction`) | type `Tesztriport` | a `/goldenset` `eval_cases` entitásaiból renderelve | **[K]** |

---

## Az 5 nevesített kérdés — pontos válaszok

### Q1 — P1 Fájdalompontok és Use case-ek: forráskinyerők vagy toolok?
**FORRÁSKINYERŐK, a ② belső lépései.** Nincs dedikált route egyikhez sem (`ls src/app/project/[id]/`: nincs `pain`/`usecase`/`heatmap` mappa) — csak a P1 ② `EntityForms` kinyerő-űrlap + E1-lista. **Nincs** külön „tool"-felületük. A rájuk épülő **tool** a **Hőtérkép** (a `use_cases` pontszámait vizualizálja, a ② jobb oszlopában) — de az a Hőtérkép, nem a Use case-ek maga.

### Q2 — A P1 „shortlist" [K] dokumentum: valódi neve és helye
**Valódi név: „Priorizált use case-shortlist" / „Prioritized use case shortlist"** (type-kulcs: `Priorizált use case-shortlist`, nameKey `useCaseShortlist`). A keresett **„Rangsorolt megoldási opciók" név NEM létezik** a kódban. **[K]** kapu-deliverable, `entitySourced: true`. **Hol jelenik meg:** a P1 ③ **Kimenet** zónában (`OutputCard` → **„Priorizált use case-shortlist" kártya**, `GenerateShortlistFieldsForm` gombbal), a **Dokumentumok** tárban (P1 szekció), és a szerkesztőben (`/artifact/:id`). A **jóváhagyott `use_cases` entitásokból** renderelődik (nem field-extract). *Ha a felhasználó nem találja: a ② „tudáselem-építés" zónában NINCS — a ③ Kimenetben / a Dokumentumok tárban van.*

### Q3 — A P3 dokumentumok valódi nevei
A kódbeli **EN megjelenő nevek** `„solution documentation"` és `„test report"` = a **HU type-kulcsok** `„Megoldás-dokumentáció"` és `„Tesztriport"` (ugyanaz, más locale). **Ezek a két P3 [K] kapu-deliverable.** **NINCS** külön „Kiértékelési riport" vagy „Solution Design" nevű dokumentum a kódban — azok nem léteznek; a két valós dokumentum a Megoldás-dokumentáció (Solution documentation) és a Tesztriport (Test report). *(A „Megoldás-dok. / Solution doc" a `/builddoc` TOOL nav-neve, nem a dokumentumé — l. a fenti figyelmeztetés.)*

### Q4 — A „TO-BE terv" dokumentum kötései
- **(a) a Folyamattérkép TO-BE toolhoz:** **NINCS kötés.** A Folyamattérkép TO-BE a `process_maps` (kind=to_be) **entitásba** ír; a „TO-BE terv" **artifact** külön, generikus field-extracttal (`input_items`) töltődik. Nincs sync `process_maps` → „TO-BE terv" artifact egyik irányban sem.
- **(b) a Megoldás-terv toolhoz:** **NINCS kötés.** A Megoldás-terv a `process_maps` (jóváhagyott TO-BE **entitás**) gerincére dokkol; a „TO-BE terv" artifactot nem olvassa/írja.
- **Forrás-választóként:** a Folyamattérkép generálás a **`input_items` sorokat** kínálja (l. Q5), NEM artifactokat — így a „TO-BE terv" dokumentum **nem választható** forrásként a folyamattérképhez (és fordítva sincs ilyen).
- **Következtetés:** a „TO-BE terv" dokumentum a `process_maps` TO-BE **entitással redundáns, összekötetlen** reprezentáció — a kód szintjén **dead end** mindkét tool felé.

### Q5 — Forrásdokumentum-választós generálás — hol van ilyen választó?
**Egyetlen forrás-választó van a rendszerben:** a **Folyamattérkép** generálásnál (`ProcessGenPanels` `<select name="inputId">`, az AS-IS és a „TO-BE Dokumentumból" belépőn). **DE ez `input_items` sorokat listáz** (`inputOptions = inputs.map(...)` a `input_items`-ből), tehát **nyers forrást választ, NEM létrejött dokumentumot.** A „Dokumentumból" felirat egy **`input_items` dokumentum-TÍPUSú sorra** utal (feltöltött nyers anyag), nem egy jóváhagyott artifactra.
→ **Egyetlen modul sem enged létrejött dokumentumot (artifact body/mező) bemenetként választani a generáláshoz.** A többi forráskinyerő/tool automatikusan a teljes `input_items`-et + entitásokat húzza, választó nélkül. (Kód-igazolt: a `generate*`/`suggest*` akciók egyike sem olvas artifactot inputként.)

---

## Több szerepű fogalmak (mindkét szerep külön)
- **Stakeholder** — (1) **FORRÁSKINYERŐ** ALUL: `extractStakeholders` → `stakeholders` entitás (P1 ②); (2) **TOOL** FELÜL: Befolyás × Érintettség **mátrix** a `/stakeholder/:id` HERO-jában (a jóváhagyott pontszámok vizualizációja).
- **Use case** — (1) **FORRÁSKINYERŐ**: `deriveUseCases` → `use_cases` entitás (P1 ②); (2) a rá épülő **TOOL**: a **Hőtérkép** (érték×megvalósíthatóság) vizualizáció.
- **Folyamattérkép** — egy nav-**TOOL**, amely **belső forráskinyerő lépést** is tartalmaz (AS-IS a nyers leiratból, forrás-választóval); a TO-BE már entitás-alapú.
- **Megoldás-dok. (Solution doc) TOOL** ↔ **Megoldás-dokumentáció (Solution documentation) DOKUMENTUM** — külön elemek, majdnem azonos névvel; a tool az entitásokat építi, a dokumentum az entitásokból renderelt artifact.

---

**Semmi kód nem változott** — csak ez a jelentés-fájl készült a `docs/state/`-be. A nevek a `config.ts` `deliverable(...)` definícióiból (type-kulcs) és a `messages/hu.json`+`messages/en.json` `artifactTypes`/`nav` névtereiből (megjelenő HU/EN nevek) származnak; a besorolás a `*-actions.ts` olvasás/írás-céljaiból és a route-fából.

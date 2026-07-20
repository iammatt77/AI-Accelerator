# Forrás-választás & entitás-elsőség audit (2026-07-20)

**Típus:** read-only tényfeltárás. **Nincs kód-, séma- vagy migráció-változtatás.** Branch: `dev`.
**Előzmény:** `2026-07-20-adatfolyam-audit.md` (forrás → entitás → Y-elágazás). Ez a követő-audit modulonként bontja: mit húz be **automatikusan**, mit lehet **választani**, és hol sérül az **entitás-elsőség** (invariáns: minden ráépülő modul AI-feldolgozása a jóváhagyott ENTITÁSOKRA épüljön; a nyers forrás csak kiegészítő kontextus/hivatkozás).
**Ne javasolj javítást** — a „hol sérül" pontokat jelöli, nem javítja. Ahol nem egyértelmű: jelölve.

> **A döntő technikai megkülönböztetés:** minden `suggest*` a forrásokat kétféleképp adhatja át az LLM-nek — **(i) csak `[index] title`** (citációs hivatkozás, a tartalom az entitásokból jön = entitás-első) VAGY **(ii) teljes `s.text` szövegtömb** (a nyers forrás a tartalmi input = nyers-primer). Ez a sor dönt, nem a paraméter-sorrend.

---

## 1. Modulonkénti input-tábla

| Modul (action → LLM-fn) | Automatikus **entitás**-input (tábla) | Automatikus **nyers**-forrás-input | Forrás **választható**? | Minta |
|---|---|---|---|---|
| **Folyamattérkép AS-IS** (`generateProcessMapAction` → `extractProcessMap`) | — (bootstrap: nincs upstream entitás) | `input_items` **1 kiválasztott, TELJES szöveg** | **IGEN** — `<select name="inputId">` (UI, `ProcessGenPanels`), az action `inputId` paramétert kap | **A** |
| **Folyamattérkép TO-BE** (`suggestToBeAction` → `suggestToBeProcess`) | `process_maps` (AS-IS lépések) + `pain_points` | — (nyers forrást NEM olvas) | nincs (auto: az AS-IS + fájdalompontok) | **B** |
| **Folyamattérkép chat** (`processChatAction` → `chatEditProcess`) | `process_maps` (aktuális térkép) | — | nincs (a térképen dolgozik) | **B** |
| **Követelmények — fa** (`generateRequirementsAction` → `suggestRequirements`) | `pain_points` + `process_maps` (TO-BE) + `stakeholders` | `input_items` **MIND, csak `[index] title`** (citáció) | nincs (auto: minden forrás címként) | **B** |
| **Követelmények — story** (`generateStoriesAction` → `suggestStories`) | `requirements` (system) + `epics` | — (forrást NEM olvas) | nincs | **B** |
| **Megoldás-terv — komponens** (`generateComponentsAction` → `suggestComponents`) | `process_maps` (jóváhagyott TO-BE gerinc) + `pain_points` + `solution_components` | `input_items` **MIND, csak `[index] title`** | nincs | **B** |
| **Megoldás-terv — opció** (`generateOptionsAction` → `suggestOptions`) | `solution_components` + `component_options` + TO-BE lépések | `input_items` **MIND, csak `[index] title`** | nincs | **B** |
| **Megoldás-dok. — P2-seed** (`seedFromP2Action`) | `solution_components` (a P2 komponensek) | — | **részben** — a felhasználó választja, **mely komponens-ENTITÁST** emeli be (nem forrás-, hanem entitás-választás) | **B** |
| **Megoldás-dok. — struktúra** (`generateBuildDocAction` → `suggestBuildDoc`) | `solution_components` (seed) + TO-BE/`requirements`/`user_stories`/`pain_points` | `input_items` **MIND, TELJES `s.text` (1500 kar.)** | nincs | **C** |
| **Golden set — esetek** (`generateEvalCasesAction` → `suggestEvalCases`) | `use_cases` (kiválasztott: csak cím + leírás) | `input_items` **MIND, TELJES `s.text` (1500 kar.)** | nincs | **C** |

**Minta-legenda:** **A** = forrás-választó + nyers-primer (bootstrap). **B** = auto-minden-forrás **csak címként** (citáció) → tartalmi alap az entitásokból = **entitás-első**. **C** = auto-minden-forrás **teljes szöveggel** → a nyers forrás a tartalmi input = **nyers-primer (sérülés)**.

---

## 2. (c) Egységesség — NEM egységes, három minta

| Minta | Modulok | Forrás-választás | Nyers forrás szerepe |
|---|---|---|---|
| **A** | Folyamattérkép AS-IS | **van** (1 input a select-ből) | **primer, de bootstrap** (nincs upstream entitás — nem sérülés) |
| **B** | Folyamattérkép TO-BE/chat · Követelmények (fa/story) · Megoldás-terv (komponens/opció) | nincs (auto) | **csak citáció** (`[n] title`) — a tartalom entitásokból = **entitás-első ✓** |
| **C** | Megoldás-dok. (struktúra) · Golden set (esetek) | nincs (auto) | **teljes szöveg = tartalmi primer** — **entitás-elsőség SÉRÜL** |

→ A modulok **háromféleképp** viselkednek. Csak a Folyamattérkép ad **forrás-választót** (és ott indokolt: az AS-IS a nyersből bootstrap-el). A B-minta modulok mindent behúznak, de a forrást csak hivatkozásként — a tartalom a jóváhagyott entitásokból. A C-minta modulok mindent behúznak **teljes szöveggel**, és abból dolgoznak elsődlegesen.

---

## 3. (d) Entitás-elsőség sérülés-lista

Ahol a nyers `input_items` **teljes szövege** az elsődleges tartalmi input (nem csak citáció), pedig az invariáns szerint a jóváhagyott entitásból kéne:

| # | Modul + action | Mit olvas MOST (kód) | Mi lenne az elvárt (entitás-első) |
|---|---|---|---|
| **S1** | **Megoldás-dok.** — `generateBuildDocAction` → `suggestBuildDoc` (`llm/index.ts`: `srcLines = [index] title\n{text.slice(0,1500)}`) | a **nyers `input_items` teljes szövege** az elsődleges tartalom; a P2 komponensek + TO-BE csak vékony kontextusként (nevek/címek) mennek | az elsődleges tartalom a **jóváhagyott `solution_components`** (a megépített megoldás komponens-entitásai) legyen; a nyers forrás csak kiegészítő hivatkozás |
| **S2** | **Golden set** — `generateEvalCasesAction` → `suggestEvalCases` (`srcLines = [index] title\n{text.slice(0,1500)}`) | a **nyers `input_items` teljes szövege** az elsődleges tartalom; a `use_cases` csak `title + description`-ként megy kontextusnak | az elsődleges alap a **jóváhagyott `use_cases` entitás** (a use case + kritériumai) legyen; a nyers forrás kiegészítő |

**NEM sérülés (indokolt nyers-primer):**
- **Folyamattérkép AS-IS** (`extractProcessMap`): a nyers leirat teljes szövegéből dolgozik — de ez a **lánc belépője**, nincs fölötte entitás. Bootstrap, nem sérülés.

**Entitás-első, helyes (B-minta, kiemelve az ellentét kedvéért):** `suggestRequirements`, `suggestStories`, `suggestComponents`, `suggestOptions`, `suggestToBeProcess`, `suggestImplLinks` — ezek a forrást csak `[n] title`-ként (vagy egyáltalán nem) adják; a tartalmi alap végig entitás.

**Másodlagos megfigyelés (nem a fő kérdés, de jelezve):** a B-minta modulok az entitás-inputot nem mindenütt szűrik explicit „confirmed" állapotra a lekérdezésben (pl. `pain_points`-ot állapottal együtt olvassák) — hogy a jóváhagyatlan entitás is bemegy-e a promptba, **modulonként külön ellenőrzendő**; ez a jelen audit hatókörén kívül esik, ezért **„nem egyértelmű"-ként jelölve**, nem tippelve.

---

## 4. A két korábban „nem egyértelmű" pont tisztázása

### 4.1 P2 TO-BE-terv / Megoldási-javaslat doc ↔ modul-entitás
**Nincs kapcsolat — tiszta field-extract termékek, modul-entitás nélkül.** A config szerint (`config.ts:273,280`) a **Megoldási javaslat** és a **TO-BE terv** sima `deliverable(...)` mező-listák: **nincs** `entitySourced`, **nincs** `structuredFields`/`benefit_calc`-szerű strukturált csatorna. Az action-réteg oldalán a `process`/`solution`-actions **nulla** artifact-írással dolgoznak (előző audit) — tehát **semmilyen sync nem köti** a `process_maps` (TO-BE entitás) → „TO-BE terv" (artifact) vagy a `solution_components` → „Megoldási javaslat" (artifact) irányt.
→ **Két, egymástól független reprezentáció ugyanarról:** a modul-entitás (folyamattérkép TO-BE / megoldás-komponensek) és a névrokon dokumentum (TO-BE terv / Megoldási javaslat artifact), amit a generikus ② `extractCta` tölt a nyersből. A kettő **nincs összekötve**; a dokumentum nem a modulból renderelődik.

### 4.2 Kétírós Solution Design artifact — ugyanaz az artifact, ütközés = felülírás (adatvesztés-kockázat)
**Igen, ugyanabba a „Megoldás-dokumentáció" artifactba ír mindkettő**, két külön csatornán:
- **Csatorna 1 — generikus `extractCta`** (② FieldWorkBlock, `extract` → `extractAction`): a nyers `input_items`-ből tölti a mezőket. **MERGE-szabály** (`artifact-actions.ts:177–194`): a `confirmed`/`manual` mezőt **megtartja**, csak az `ai_filled`/`missing` frissül.
- **Csatorna 2 — `syncDocAction`** (a `/builddoc` modulból, entitásokból): a `syncField` (`builddoc-actions.ts:691`) **feltétel nélkül felülírja** a mezőt: `{ value, state: "manual" }` (üresnél `missing`) — **függetlenül** a korábbi állapottól. Csak **3 mezőt** ír: `komponensek`, `prompt_konyvtar`, `guardrail_hitl`. Az `architektura` és `uzemeltetesi_jegyzet` **érintetlen** marad.

**Ütközés-viselkedés (aszimmetrikus, adatvesztés-kockázattal):**
- `syncDoc` **mindig felülír** — még egy, a szerkesztőben **emberi kézzel megerősített** (`confirmed`) mezőt is felülír entitás-renderrel, `state`-et `manual`-ra állítva. → **Ha a felhasználó a szerkesztőben megerősít egy mezőt, majd rányomja a „Dok. frissítése az entitásokból" gombra, a megerősített tartalom csendben elveszik.**
- Fordítva: ha `syncDoc` írt egy mezőt (`manual`), egy **későbbi `extractCta`** azt **megtartja** (a merge kihagyja a `manual`-t). → az entitás-render túléli a nyers-extractot.
- **Nettó:** `syncDoc` „mindig nyer" (felülír), `extract` „enged" a manual-nak. Az artifact **vegyes tulajdonú**: 3 mező entitás-renderelt (syncDoc felülírja minden szinkronnál), 2 mező extract/kézi (érintetlen). Ez a felhasználói **„egy dolog háromfelé"** zavar konkrét forrása: ugyanaz a dokumentum három úton (nyers-extract · szerkesztő-HITL · modul-sync) tölthető, és a sync némán felülírja a másik kettőt a maga 3 mezőjén.

→ **Ütközéskor: felülírás (nem merge, nem verzió), a syncDoc javára, a megerősített mezőn is → potenciális adatvesztés.** (Nem javaslok javítást — csak rögzítem.)

---

## 5. Összegzés (a design-agentnek, tényként)
- **Forrás-választó csak a Folyamattérképnél van** (1 input a select-ből); a többi modul mindent auto-behúz.
- **Két AI-hívás sérti az entitás-elsőséget** (nyers forrás teljes szövege a primer): **S1 `suggestBuildDoc`** (Megoldás-dok.) és **S2 `suggestEvalCases`** (Golden set). A többi elemző `suggest*` entitás-első (a forrás csak citáció).
- **A P2 „TO-BE terv" / „Megoldási javaslat" dokumentumok nincsenek a modul-entitásokhoz kötve** — külön field-extract reprezentációk.
- **A Megoldás-dokumentáció artifactba két csatorna ír ugyanoda; a modul-sync felülír (a megerősített mezőt is), 3 mezőn — adatvesztés-kockázattal.**

**Semmi kód nem változott** — csak ez a jelentés-fájl készült a `docs/state/`-be. A megállapítások a `suggest*`/`generate*`/`seed*` lekérdezéseinek és az LLM-prompt forrás-renderelésének (`s.text` vs `s.title`) kód-szintű átvizsgálásából állnak.

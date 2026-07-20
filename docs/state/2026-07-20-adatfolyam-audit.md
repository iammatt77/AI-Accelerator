# Adatfolyam-audit — az elemző modulok honnan olvasnak, hová írnak (2026-07-20)

**Típus:** read-only tényfeltárás (adatfolyam). **Nincs kód-, séma- vagy migráció-változtatás.** Branch: `dev`.
**Központi kérdés:** nem az, hogy mi hol van, hanem az **irány** — minden elemző modul (P1–P3) honnan OLVAS és hová ÍR. A ground truth a kód (`suggest*`/`extract*`/`derive*`/`generate*`/`seed*` akciók olvasás-lekérdezései és írás-céljai), nem a feltételezés.
**Ne javasolj átrendezést** — ez tényfeltárás. Ahol az irány nem egyértelmű, jelölve.

> **A legfontosabb lelet előre:** a `process`/`requirements`/`solution`-actions **egyetlen artifact-olvasást sem** tartalmaznak; a `builddoc`/`goldenset` artifact-hivatkozásai mind a **sync-írás** függvényekben vannak (nem bemenetként). **Egyetlen elemző modul sem olvas jóváhagyott dokumentumot inputként.** Mindegyik a **nyers `input_items`-ből + a korábbi modulok ENTITÁSAIBÓL** dolgozik. Ez **cáfolja** a „források → dokumentumok → elemző modulok" hipotézist (l. §3).

---

## 1. Modulonkénti adatfolyam-tábla

| Modul | Bemeneti forrás (mit olvas — tábla/mező) | Kimenet (hová ír) | Igazság-forrás iránya |
|---|---|---|---|
| **Folyamattérkép — AS-IS** (`generateProcessMapAction` → `extractProcessMap`) | **nyers**: `input_items` (1 kiválasztott, `loadNumberedSources`) | `process_maps` (kind=as_is) | **modul-entitás** — nincs doc érintve |
| **Folyamattérkép — TO-BE** (`suggestToBeAction` → `suggestToBeProcess`) | **más modul entitása**: `process_maps` (AS-IS) + `pain_points` | `process_maps` (kind=to_be) | **modul-entitás** — nincs doc |
| **Folyamattérkép — chat** (`processChatAction` → `chatEditProcess`) | `process_maps` (aktuális térkép) + user-üzenet | `process_maps` (javaslat→apply) | **modul-entitás** — nincs doc |
| **Követelmények — fa** (`generateRequirementsAction` → `suggestRequirements`) | **nyers + entitások**: `input_items` + `pain_points` + `process_maps` (jóváhagyott TO-BE lépések) + `stakeholders` | `requirements` (+ `stakeholder_requirements` kötések) | **modul-entitás** — nincs doc |
| **Követelmények — story** (`generateStoriesAction` → `suggestStories`) | **saját entitás**: `requirements` (+ `epics`) | `user_stories` (+ `requirement_stories` N:M) | **modul-entitás** — nincs doc |
| **Követelmények — AC-vázlat / story-vázlat** (`generateAcAction`/`suggestStoryDraftAction`) | saját entitás (requirement szövege) | `acceptance_criteria` (perzisztál) / űrlap-előtöltés | **modul-entitás** — nincs doc |
| **Megoldás-terv — komponens** (`generateComponentsAction` → `suggestComponents`) | **nyers + entitás**: `input_items` + `process_maps` (jóváhagyott TO-BE gerinc) + `pain_points` | `solution_components` (+ `component_step_links` → TO-BE **node-id**) | **modul-entitás** — nincs doc |
| **Megoldás-terv — opció** (`generateOptionsAction` → `suggestOptions`) | **saját + nyers**: `solution_components` + `component_options` + TO-BE lépések + `input_items` | `component_options` (szempont-értékek) | **modul-entitás** — nincs doc |
| **Megoldás-dok. — P2-seed** (`seedFromP2Action`) | **más modul entitása**: `solution_components` (a P2 kiválasztott komponensek) | `build_components` (`origin_component_id` → P2 komp.) | **modul-entitás** (P2 entitás → build entitás) |
| **Megoldás-dok. — struktúra** (`generateBuildDocAction` → `suggestBuildDoc`) | **nyers + entitások**: `input_items` + `solution_components` (seed) + `component_options` + TO-BE/`requirements`/`user_stories`/`pain_points` | `build_components` + `prompt_items` + `control_points` | **modul-entitás** |
| **Megoldás-dok. — kötés** (`suggestLinksAction` → `suggestImplLinks`) | saját `build_components` + terv-elem címtár (req/story/TO-BE/pain) | `impl_links` (N:M) | **modul-entitás** |
| **Megoldás-dok. — DOC-SZINKRON** (`syncDocAction`) | **saját entitások**: `build_components`/`impl_links`/`prompt_items`/`control_points` | **artifact** „Megoldás-dokumentáció" mezői | **modul → doc (egyirányú, LEFELÉ)** |
| **Golden set — esetek** (`generateEvalCasesAction` → `suggestEvalCases`) | **nyers + entitás**: `input_items` + `use_cases` (kiválasztott) | `eval_cases` + `eval_criteria` | **modul-entitás** |
| **Golden set — DOC-SZINKRON** (`syncReportAction`) | **saját entitások**: `eval_cases` | **artifact** „Tesztriport" mezői | **modul → doc (egyirányú, LEFELÉ)** |
| **Hőtérkép (érték×megvalósíthatóság)** | **derivált**: `use_cases.score_value`/`score_feasibility` (KÉZI pontozás) | — (nem ír) | **derivált nézet** (entitás olvasata) |
| **Befolyás×érintettség mátrix** (StakeholderPage, `hasMatrixPoint`/`scorePct`) | **derivált**: `stakeholders.influence_score`/`impact_score` | — (a pontozás külön akción [`extractStakeholders` javaslat + emberi/`setStakeholderScores`] a `stakeholders`-be ír) | **derivált nézet** (entitás olvasata) |

**Univerzális megállapítás:** minden elemző modul **igazság-forrása a saját strukturált entitás-modellje.** Ahol egyáltalán van dokumentum (csak builddoc + goldenset), az a modul-entitások **lefelé generált renderelése** (modul → doc). **Doc → modul irány SEHOL nincs.** A Folyamattérkép, Követelmények és Megoldás-terv **egyáltalán nem érint dokumentumot** — tisztán entitás-modulok.

---

## 2. A Solution Design (Megoldás-dok.) teljes lánca — a kért konkrét példa

```
NYERS FORRÁS                     1. SZAKASZ (doc-gyártás)            2. SZAKASZ (elemző modul)
─────────────                    ─────────────────────              ─────────────────────
input_items ─┐
             ├─► ② P3 field-extract (extractCta)  ──► artifact "Megoldás-dokumentáció".mezők
             │        extract(sources, typeDef)          (ai_filled, KÖZVETLENÜL a nyersből)
             │                                                    ▲
             │                                                    │  openEditor → /artifact/:id
             │                                                    │  (HITL szerkesztő: Confirm/Edit/Approve)
             │                                                    │
             └─► /builddoc modul ──────────────────────┐         │
                   • seedFromP2Action                  │         │
                        OLVAS: solution_components      │         │
                        (P2 KIVÁLASZTOTT komponensek,   │         │
                         component_options.is_selected) │         │
                        ÍR: build_components             │         │
                   • generateBuildDocAction (suggestBuildDoc)     │
                        OLVAS: input_items (nyers) +    │         │
                         solution_components (seed) +   │         │
                         TO-BE/requirements/story/pain  │         │
                        ÍR: build_components +          │         │
                         prompt_items + control_points  │         │
                   • suggestImplLinks                   │         │
                        OLVAS: build_component + terv-  │         │
                         elemek; ÍR: impl_links         │         │
                   • syncDocAction ────────────────────┴─────────┘
                        OLVAS: build_components/impl_links/prompt_items/control_points
                        ÍR: artifact "Megoldás-dokumentáció".mezők (komponensek/prompt_konyvtar/guardrail_hitl)
                        = modul-entitások → doc (LEFELÉ renderelés)
```

**Amit a `/builddoc` modul beolvas:** a **P2 komponens-ENTITÁSOKAT** (`solution_components`, a `component_options.is_selected` HITL-kiválasztással) + a **nyers `input_items`-et** + a TO-BE/követelmény/story/fájdalompont entitásokat. **NEM olvassa a jóváhagyott dokumentumot.**

**Két versengő író ugyanabba a „Megoldás-dokumentáció" artifactba:**
1. a generikus ② `extractCta` — **nyers forrás → doc mezők** (közvetlen);
2. a modul `syncDocAction` — **build-entitások → doc mezők** (a `komponensek`/`prompt_konyvtar`/`guardrail_hitl` mezőket felülírja).

→ Az igazság-forrás a **build-entitás-modell**; a dokumentum ennek lefelé generált renderelése (modul → doc). A generikus extract-út **párhuzamos/versengő** másodlagos csatorna, nem az entitásokból táplálkozik. (Az `entitySourced` P1-shortlisttől eltérően a Megoldás-dokumentáció szerveroldalon **nincs** letiltva a generikus extractról — ezért lehetséges a két író.)

---

## 3. Kétszakaszos modell verifikáció

**A hipotézis (`források → dokumentumok → elemző modulok → kapu`) NEM állja meg a helyét a „dokumentumok → elemző modulok" szakaszban.** A kód szerinti valós lánc **elágazó, nem lineáris:**

```
                    ┌─►  1. SZAKASZ: doc-gyártás
                    │     input_items ──extract/generateBody──► artifact dokumentumok
                    │     (charter, business case, felmérési riport, megoldási javaslat, TO-BE terv…)
   input_items ─────┤
   (nyers forrás)   │
                    └─►  2. SZAKASZ: elemző modulok
                          input_items + KORÁBBI MODUL-ENTITÁSOK ──► saját entitás-táblák
                          (pain_points → use_cases → requirements → process_maps(TO-BE)
                           → solution_components → build_components → eval_cases)
                          └─ (csak builddoc + goldenset:) entitások ──sync──► saját artifact doc
```

**Ahol a valóság eltér a hipotézistől:**
- **A 2. szakasz NEM a 1. szakasz dokumentumaiból táplálkozik.** Mindkét szakasz **közvetlenül a nyers `input_items`-ből** olvas (párhuzamosan). Egyetlen elemző modul sem olvas artifact-body-t/mezőt bemenetként (kód-igazolt negatív: `process`/`requirements`/`solution`-actions 0 artifact-olvasás; a `builddoc`/`goldenset` artifact-hivatkozásai kizárólag a sync-ÍRÁSBAN).
- **A modulok közti táplálás ENTITÁS → ENTITÁS, nem dokumentumon át.** A lánc: fájdalompont → use case → követelmény → TO-BE node → megoldás-komponens → build-komponens → eval-eset. Ezek mind entitás-hivatkozások (FK / node-id / seed), **nem** dokumentum-visszaolvasás.
- **A Folyamattérkép / Követelmények / Megoldás-terv EGYÁLTALÁN NEM termel dokumentumot.** Nincs „requirements-doc" vagy „process-map-doc" sync — a kimenetük tisztán entitás. A fázis dokumentum-deliverable-jei (pl. „TO-BE terv", „Megoldási javaslat" artifact) **külön, field-extract úton** készülnek a nyersből, és **nincsenek összekötve** a megfelelő modul entitásaival (a TO-BE terv artifact ≠ a `process_maps` TO-BE entitás; két külön reprezentáció).
- **Csak a builddoc + goldenset zárja a kört „modul → doc" iránnyal** (syncDocAction/syncReportAction) — de ez is **egyirányú lefelé**, sosem doc → modul.

**Amit a hipotézis HELYESEN lát:** van két elkülönülő szakasz (doc-gyártás vs elemzés/strukturálás), és a második entitásokat/kötéseket/vizualizációkat épít. Csak a **köztük lévő él iránya** más: nem „doc → modul", hanem **közös nyers-forrás + entitás-lánc**.

---

## 4. Kapu-időzítés — hol zár a kapu a lánchoz képest

A [K] kapu-hordozó deliverable-ök (a `PHASE_CRITERIA` + `gateTypesForPhase` alapján):

| Fázis | [K] kapu-deliverable(ök) | Melyik szakaszból? | A kapu az elemző modulokra vár? |
|---|---|---|---|
| **P1** | Priorizált use case-shortlist **+** megerősített quick win | 2. szakasz (use_cases entitásokból renderelt doc) | **részben** — a shortlist entitás-render; de a P1 elemző nézetek (hőtérkép/értékelők) nem kapu-feltétel |
| **P2** | **Business case** + **Pilot-terv** | **1. SZAKASZ (doc-gyártás)** — field-extract + strukturált kalkulátor a nyersből | **NEM** — a P2 elemző modulok (Folyamattérkép TO-BE, Követelmények, Megoldás-terv) **nem** kapu-hordozók; a kapu zárhat anélkül, hogy ezek elkészülnének |
| **P3** | **Megoldás-dokumentáció** + **Tesztriport** | **2. SZAKASZ** (builddoc/goldenset entitásaiból synchelt doc) | **IGEN** — a kapu-deliverable-ök MAGUK az elemző modulok kimenetei |

**Következtetés a kapu-időzítésre:**
- **P2-ben a kapu TÚL KORÁN zár** a hipotézis értelmében: a [K] deliverable-ök (Business case, Pilot-terv) az **1. szakasz dokumentumai**, a P2 elemző moduljai (folyamattérkép-TO-BE, követelmények, megoldás-terv) pedig **nincsenek kapuzva** — entitásaik hiánya nem blokkolja a kaput. **Itt megerősíthető a hipotézis.**
- **P3-ban a kapu a 2. szakasz UTÁN zár:** a [K] deliverable-ök épp az elemző modulok synchelt dokumentumai (Megoldás-dok., Tesztriport). **Itt a hipotézis NEM áll** — a kapu helyesen az elemzés után van.
- **P1 vegyes:** a kapu-deliverable a use-case-shortlist (entitás-render), de a P1 származtatott nézetek (hőtérkép/értékelők) nem kapu-feltételek.

→ **A „kapu túl korán zár" tézis fázisspecifikus: P2-re igaz, P3-ra nem.** A gyökér-mintázat: a **P2 elemző modulok kimenete (entitások) semmilyen kapu-kritériumhoz nem kötött**, míg a P2 kapu a párhuzamos doc-gyártásra (Business case/Pilot-terv) épül.

---

## 5. „Nem egyértelmű" / jelölésre szoruló pontok
- A **P2 „TO-BE terv" és „Megoldási javaslat" artifact-deliverable-ök** és a megfelelő modul-entitások (`process_maps` TO-BE, `solution_components`) közti kapcsolat a kódban **nincs** — nem egyértelmű, szándékolt-e a két külön reprezentáció, vagy a doc-nak a modulból kellene renderelődnie (mint builddoc/goldenset). **Jelezve, nem tippelve.**
- A Megoldás-dokumentáció artifactba **két csatorna ír** (generikus extract + syncDoc); a kód nem rögzíti, melyik a „hivatalos" — a syncDoc felülír, de az extract előbb futhat. Potenciális ütközés, de az irány egyértelmű (entitás a kanonikus).

---

**Semmi kód nem változott** — csak ez a jelentés-fájl készült a `docs/state/`-be. A lánc a `*-actions.ts` olvasás-lekérdezéseinek és írás-céljainak kód-szintű átvizsgálásából áll össze; a doc-olvasás hiánya explicit negatív-ellenőrzéssel igazolt.

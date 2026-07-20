# P2/P3 „megoldás"-fogalom — redundancia & dead-end audit (2026-07-20)

**Típus:** read-only tényfeltárás. **Nincs kód-, séma- vagy migráció-változtatás.** Branch: `dev`.
**Cél:** a P2/P3 „megoldás"-fogalom körüli entitás-kapcsolatok feltérképezése, a redundanciák / duplikátumok / dead-endek tény-alapú azonosítása. Javítás/átrendezés NÉLKÜL. Ahol a kötés nem egyértelmű: jelölve.

> **Fontos ténykorrekció előre (a feladat-kontextus egy premisszája pontatlan):** a P2 „Business case / Pilot-terv / Megoldási javaslat / TO-BE terv" **NEM hoz létre entitást** — ezek a field-extract a **saját artifact-mezőikbe** ír (± jsonb: `benefit_calc`/`pilot_success` az artifacton). Nincs mögöttük entitás-tábla. A valós P2 **entitásokat** a TOOLOK építik (`process_maps`, `requirements`, `solution_components`), nem ezek a dokumentum-field-extractok. Ezt a §3/§Q3 részletezi.

---

## 1. Entitás-kapcsolati térkép (P2/P3 megoldás-fogalom)

| Elem (valós név) | ÍR (tábla) | OLVAS (tábla) | Mi köti a többihez |
|---|---|---|---|
| **Opció-összevető / Megoldás-terv** (`/solution`, solution-actions) | `solution_components` · `component_options` · `component_step_links` | `process_maps` (jóváhagyott TO-BE) · `pain_points` · `input_items` (címként) | TO-BE node-id-re köt (`component_step_links.node_id`) |
| **Megoldás-tervező** (`/builddoc`, builddoc-actions) | `build_components` · `impl_links` · `prompt_items` · `control_points` · ÉS a **„Megoldás-dokumentáció" artifact** (syncDoc) | `solution_components` (**seed**) · `component_options` · `process_maps`/`requirements`/`user_stories`/`pain_points` · `input_items` (**teljes szöveg**) · `build_components`/`impl_links`/… | **`build_components.origin_component_id` → `solution_components.id`** (P2-seed, 1-N) |
| **„Megoldás-dokumentáció" DOKUMENTUM** (type `Megoldás-dokumentáció`) | (artifact-mezők) | — (tartalmát senki nem olvassa) | **KÉT író**: (a) generikus ② field-extract `input_items`→mezők, (b) `syncDocAction` `build_components`→mezők |
| **„Megoldási javaslat" DOKUMENTUM** (type `Megoldási javaslat`) | (artifact-mezők, field-extract) | — (senki) | **semmi** (nincs entitás mögötte, nincs modul-kötés) |
| **„TO-BE terv" DOKUMENTUM** (type `TO-BE terv`) | (artifact-mezők, field-extract) | — (senki) | **semmi** (nincs kötve a `process_maps` TO-BE entitáshoz — l. §Q4/előző audit) |
| **„Business case" / „Pilot-terv" DOKUMENTUM** | (artifact-mezők + `benefit_calc`/`pilot_success` jsonb) | `input_items` (extract + strukturált suggest) | — (kapu-státusz [K], de tartalmát senki nem olvassa) |
| **Golden set** (`/goldenset`, goldenset-actions) | `golden_sets` · `eval_cases` · `eval_criteria` · ÉS a **„Tesztriport" artifact** (syncReport) | `use_cases` (cím+leírás) · `input_items` (**teljes szöveg**) · `eval_cases`/`eval_criteria` | `golden_sets.use_case_id` → `use_cases.id` |
| **„Tesztriport" DOKUMENTUM** (type `Tesztriport`) | (artifact-mezők) | — | **KÉT író**: (a) generikus ② field-extract, (b) `syncReportAction` `eval_cases`→mezők; **olvasó:** az **approve-őr** (`artifact-actions:518`) a kapuhoz |

**Táblánkénti olvasó/író (grep-igazolt):**
- `solution_components`: ír+olvas **solution-actions**; olvas **builddoc-actions** (seed 103, generate 274, syncDoc origin-név 740) + a két oldal-route. → **a `/builddoc` fogyasztja a `/solution` entitásait.**
- `build_components` / `impl_links` / `prompt_items` / `control_points`: **kizárólag builddoc-actions + builddoc/page** — **semmi más nem olvassa.**
- `eval_cases`: ír+olvas **goldenset-actions** + goldenset/page; **olvas `artifact-actions:518`** (a Tesztriport approve-őr/kapu-poka-yoke).

---

## 2. A nevesített kérdések — pontos válaszok

### Q1 — Megoldásterv forráskinyerő ↔ Megoldás-tervező tool ↔ Megoldásterv dokumentum (`/builddoc` körül)
- **A field-extract forráskinyerő NEM készít entitást a toolnak.** A „Megoldás-dokumentáció" dokumentum ② field-extractja (`extractCta`→`extract`) a **saját artifact-mezőibe** ír (`input_items`→fields). Ez **független** a tooltól — a tool nem olvassa a field-extract kimenetét.
- **A tool a SAJÁT entitás-halmazát építi külön:** `seedFromP2Action` (a `solution_components`-ből → `build_components`), `generateBuildDocAction`/`suggestBuildDoc` (`input_items`+entitások → `build_components`/`prompt_items`/`control_points`), `suggestImplLinks` (→ `impl_links`). Ez **NEM a field-extractból** jön.
- **Ugyanabba az artifactba ír-e mindkettő?** **IGEN — kétírós minta.** A field-extract (`input_items`→mezők) és a `syncDocAction` (`build_components`→ `komponensek`/`prompt_konyvtar`/`guardrail_hitl` mezők) **ugyanabba a „Megoldás-dokumentáció" artifactba** ír. A `syncField` **feltétel nélkül felülír** (`state:"manual"`), a megerősített mezőt is (l. előző audit — adatvesztés-kockázat).
- **Összegzés:** a lánc **NEM** „forráskinyerő → tool → dokumentum" előkészítő sorrend; hanem a **tool az entitásait maga építi** (P2-seed + forrás + AI), a **field-extract párhuzamos, versengő második író** ugyanarra a dokumentumra.

### Q2 — Opció-összevető (solution plan) ↔ Megoldás-tervező (solution doc)
- **KÜLÖN entitás-táblák:** `solution_components` (Opció-összevető) ≠ `build_components` (Megoldás-tervező). Nem ugyanaz a halmaz.
- **VAN kötés, de egyirányú:** `build_components.origin_component_id → solution_components.id` (a `seedFromP2Action` a P2-komponensből **átmásolja** a nevet/leírást/réteget + beállítja a back-refet, 1-N). A `/builddoc` **olvassa** a `solution_components`-et; a `/solution` **NEM olvassa** a `build_components`-et (nincs forward-link).
- **Miért látszik „ugyanaz, de linkeletlen"?** Mert a seed **másolat**: a `build_components` sor a nevet a `solution_components`-ből kapja → **ugyanaz a NÉV jelenik meg mindkét toolban, de két külön SOR két külön táblában.** A kötés (`origin_component_id`) létezik és **build→solution irányban meg is jelenik** (a builddoc-részleten „P2 · {név}" chip + „megnyitás → /solution" link); a **solution oldalon viszont nincs jelzés** a downstream build-komponensekről. Innen a „nincs link" érzet.
- **Duplikáció vagy egy halmaz?** **Egyik sem tisztán:** seed-**másolat** back-linkkel. Következmény: **DRIFT-veszély** — ha a `solution_component`-et a seed után szerkesztik, a `build_component` másolat NEM frissül (nincs sync). A `build_components` ráadásul **bővebb** (manuális + AI-komponensek `origin_component_id=null`-lal), tehát nem tiszta másolata a `solution_components`-nek.
- **Párhuzamos kötés-táblák is:** `component_step_links` (solution→TO-BE node) és `impl_links` (build→requirement/story/TO-BE/pain) — **két külön** N:M kötéstábla, részben átfedő céllal (mindkettő köthet TO-BE node-ra), külön reprezentációban.

### Q2b — Golden set (`/goldenset`) ↔ Tesztriport dokumentum
- **A Golden set tool entitása:** `golden_sets` + `eval_cases` + `eval_criteria` (verdikt, pass% a `passStats`-ból derivált).
- **A Tesztriport ebből renderelődik:** `syncReportAction` `eval_cases` → a „Tesztriport" artifact `golden_set_eredmeny`/`atmenesi_arany`/`hibak_javitasok` mezőibe (entitás→doc, lefelé).
- **KÉTÍRÓS itt is:** a „Tesztriport" **NEM `entitySourced`** (a `config.ts:241` `entitySourced:true` a `useCaseShortlist`-en van, NEM a Tesztriporton) → a generikus ② field-extract **is** írhatja ugyanezt az artifactot. → **ugyanaz a kétírós minta, mint a Megoldás-dokumentációnál** (field-extract vs syncReport, felülírás).
- **Olvassa-e valaki az eval-entitásokat a riporton kívül?** **IGEN — az approve-őr** (`artifact-actions:518`): a Tesztriport jóváhagyásakor a `golden_sets` + `eval_cases`-ből számol pass%/küszöb-poka-yoke-ot (a P3 kapuhoz). Tehát **nem dead end a riporton túl** a P3-on belül (riport-render + kapu-őr). **Downstream (P4+) fogyasztó azonban nincs.**

### Q3 — A P2 forráskinyerők entitást gyártanak-e, és olvassa-e valaki?
**Ténykorrekció:** a Business case / Pilot-terv / Megoldási javaslat / TO-BE terv **NEM gyárt entitást.** Ezek field-extractja a **saját artifact-mezőikbe** ír; a Business case/Pilot-terv strukturált része (`benefit_calc`/`pilot_success`) is **az artifacton** ül, nem entitás-táblában. → **nincs entitás, amit bárki olvashatna vagy ne olvasna.** A tartalmukat (a grep szerint) **downstream senki nem olvassa** — terminális deliverable-ök (ez deliverable-nél normális). A valós P2 **entitásokat** (`process_maps`, `requirements`, `solution_components`) a **toolok** építik, nem ezek a dokumentumok.

### Q4 lásd §3 (c) — a redundancia/dead-end lista.

---

## 3. Redundancia & dead-end lista

### (a) Tiszta DUPLIKÁTUM (két entitás-halmaz ugyanarról, kötés nélkül)
- **Nincs tiszta duplikátum.** A `solution_components` ↔ `build_components` **nem** tiszta duplikátum, mert van back-link (`origin_component_id`) — ez (c) alá esik (seed-másolat).

### (b) DEAD END (létrehozott, de nem olvasott / kötetlen)
- **`build_components` · `impl_links` · `prompt_items` · `control_points`** — **kizárólag a `/builddoc` + `syncDoc` olvassa**; nincs cross-modul vagy downstream (P4+) fogyasztó. A Megoldás-dokumentáció dokumentumon + a saját nézetén túl **nem vezet sehova.** *(Nem szigorúan halott — a dokumentumot táplálja —, de terminális a `/builddoc`-on belül.)*
- **„Megoldási javaslat" dokumentum** — field-extract termék, **tartalmát senki nem olvassa**, és **nincs kötve** a `solution_components` modul-entitáshoz (a megoldást szövegként duplikálja, összekötetlenül).
- **„TO-BE terv" dokumentum** (ismert) — field-extract termék, **tartalmát senki nem olvassa**, **nincs kötve** a `process_maps` TO-BE entitáshoz.
- **`eval_cases` downstream** — a P3 riporton + kapu-őrön túl **nincs P4+ fogyasztó** (a P3-on belül NEM dead end).

### (c) ÖSSZEKÖTETLEN / DRIFT-VESZÉLYES REPREZENTÁCIÓ (ugyanaz az adat két helyen, gyenge/hiányzó link)
- **`solution_components` (Opció-összevető) ↔ `build_components` (Megoldás-tervező)** — seed-**másolat** egyirányú back-linkkel; a név ugyanaz, a sor külön; **szerkesztés után drift** (nincs sync); a `/solution` oldalon nincs forward-jelzés. *(A felhasználó „ugyanazok az entitások, de nincs link" megfigyelése ezt látja: a másolt nevek + a hiányzó forward-link.)*
- **`process_maps` TO-BE entitás ↔ „TO-BE terv" artifact** — két „TO-BE" reprezentáció, **semmilyen kötés** egyik irányban sem.
- **`solution_components` ↔ „Megoldási javaslat" artifact** — a „megoldás" szöveges dokumentuma és az entitás-halmaza **összekötetlen** (a doc field-extract, nem a komponensekből renderelt).
- **„Megoldás-dokumentáció" artifact — KÉT író** (field-extract `input_items`→mezők vs `syncDoc` `build_components`→mezők), ugyanaz a 3 mező; ütközéskor `syncDoc` **felülír** (a megerősítettet is) → adatvesztés-kockázat.
- **„Tesztriport" artifact — KÉT író** (field-extract vs `syncReport`), ugyanaz a minta.
- **`component_step_links` ↔ `impl_links`** — két külön N:M kötéstábla, részben átfedő cél (TO-BE-node-kötés is), külön modulokban — párhuzamos, nem egyesített reprezentáció.

---

## 4. Összegzés (tényként, a design-agentnek)
- A **Megoldás-tervező (`/builddoc`) a saját `build_components` entitás-halmazát építi**, a P2 `solution_components`-ből **seed-MÁSOLATTAL** (`origin_component_id` back-ref, egyirányú, sync nélkül → drift). A field-extract **nem** készíti elő ezt — párhuzamos, versengő második író a dokumentumra.
- **Két kétírós dokumentum:** „Megoldás-dokumentáció" (field-extract + syncDoc) és „Tesztriport" (field-extract + syncReport) — mindkettőnél a modul-sync felülír.
- **A P2 doc-forráskinyerők nem gyártanak entitást** (a saját artifact-mezőikbe írnak) — nincs mit olvasni utánuk.
- **Fő összekötetlenségek:** TO-BE terv ↔ process_maps TO-BE; Megoldási javaslat ↔ solution_components; solution_components ↔ build_components (drift). **`build_components`/`impl_links`/`prompt_items`/`control_points` a `/builddoc`-on túl senkinek.**

**Semmi kód nem változott** — csak ez a jelentés-fájl készült a `docs/state/`-be. A megállapítások minden érintett tábla (`solution_components`/`build_components`/`impl_links`/`eval_cases` + artifact-típusok) összes `.from(...)` olvasó/író pontjának grep-szintű átvizsgálásából állnak; ahol a kötés hiányzik, azt a readerek/writerek teljes listája igazolja (nem tipp).

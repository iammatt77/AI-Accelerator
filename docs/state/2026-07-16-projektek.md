# Coding-csomag — Projektek menü redesign (fázis-pipeline board) (2026-07-16)

**A „Projektek" menü fázis-pipeline boarddá alakítása a `ref_projektek.html`
szerint: 7 oszlop (P0–P6), minden projekt az aktív fázisa oszlopában.** Branch:
`dev`. **Nincs új CRM-adatmodell, nincs migráció** — az élő adat a KÖZÖS
`portfolio.ts`/`state.ts` származtatásból (mint az Ügyfelek-lap); az érték
szürke placeholder. A régi kártyarács a nézetváltó „Lista" mögött él tovább.

## 0. ELSŐ LÉPÉS — backend-ellenőrzés (élő vs. placeholder) + újrahasznosítás

**ÉLŐ (meglévő adat):** projekt neve/ügyfél/iparág (projekt+client rekord),
fázis-pozíció (az állapotgép aktív fázisa = a board oszlopa), kapu-állapot
met/total + következő lépés (a kapu-logikából), stagnálás + utolsó aktivitás
(a `portfolio.ts` küszöbe + `max(created_at, artifacts.updated_at,
decisions.created_at)`), teszt/piszkozat-szűrés.

**PLACEHOLDER (nincs backend → szürke, konzisztens az Ügyfelek-lappal):**
a szerződés-érték a kártyákon és az összesítő — UGYANAZ a CRM-érték, ami az
Ügyfelek-lapon is szürke; itt is „—/hamarosan", nem fabrikált szám.

**Újrahasznált `portfolio.ts` helperek (nem duplikáltam):** `STALL_THRESHOLD_DAYS`
(7 nap), `AttentionLevel`, `attentionRank`, `barClass`, és ÚJ közös elem: a
per-projekt állapot-levezetést kiemeltem a **`lib/projects/state.ts`
`loadProjectStates`** szerver-helperbe, amit MOST **az Ügyfelek-lap IS
használ** (a korábbi inline `deriveProject` helyett) — így a stagnálás/kapu/
utolsó-aktivitás logika egy helyen van. A teszt-szűréshez a `portfolio.ts`-be
tettem az `isTestProject`-et (dokumentált kritérium).

**Nincs migráció.**

## 1. Mi készült el (a ref szerint)

- **`lib/projects/state.ts`** (server-only, KÖZÖS): `loadProjectStates` —
  projektenként aktív fázis, kapu met/total, figyelem-szint, utolsó aktivitás,
  stagnálás, első nem-teljesült kritérium, next-phase. Batch-elt lekérdezés.
- **`lib/clients/portfolio.ts` bővítés**: `isTestProject(projectName,
  clientName)` — teszt/piszkozat-szűrés (lásd 3. pont).
- **`components/ProjectsBoard.tsx`** (kliens): fejléc + **nézetváltó
  (Pipeline ⇄ Lista)** + kereső (név/ügyfél) + „+ Új projekt" (a create-panelt
  nyitja); **slim státusz-sor + legenda**; **7-oszlopos pipeline-board**
  (oszlop-fejléc: fázis-kód + darabszám; kártyák az aktív fázis oszlopában,
  oszlopon belül figyelem szerint rendezve; üres oszlop „—"); a kártya:
  monogram + projektnév + ügyfél + állapot-badge + felső szín-sáv (rád vár=lila,
  kapunál áll=borostyán, áll=piros, kapu kész=zöld, ütemben/lezárt=semleges) +
  a származtatott következő lépés + utolsó aktivitás + **érték-chip (szürke
  placeholder)**; **teszt-projekt footer** („N teszt/piszkozat elrejtve … ·
  Megjelenítés →") + számlálók (aktív · lezárt · érték-placeholder).
- **`app/(top)/projects/page.tsx`** (átírt, szerver): a közös állapotból
  board-kártyákat képez, elkülöníti a teszt-projekteket, oszlopokba rendezi,
  státusz-sort + számlálókat származtat; a **Lista-nézet a régi
  `ProjectListCard`-rács változatlan logikával** (nézetváltó mögött); a
  create-form a „+ Új projekt" panelben.
- **`app/(top)/clients/page.tsx` refaktor**: az inline `deriveProject` helyett a
  közös `loadProjectStates`-t használja (nincs duplikáció; a lap viselkedése
  változatlan).
- **i18n**: 27 új kulcs/nyelv a `projects` névtérben (nézetváltó, státusz-sor,
  legenda, badge-ek, teszt-footer, számlálók); az oszlop-fejlécek a MEGLÉVŐ
  `phases.{p}.short` kulcsokból. **i18n:check OK — 1024 kulcs, HU/EN azonos.**

## 2. Kezelt eltérések / döntések (dokumentálva)

- **Board oszlop-hozzárendelés**: a projekt az állapotgép AKTÍV fázisának
  oszlopában (lezártnál az utolsó completed fázisban).
- **Állapot-badge (variant)**: `blocked` + met>0 → „Rád vár" (lila), `blocked`
  + met=0 → „Kapunál áll" (borostyán), `stalled` → „Áll" (piros), `ready` →
  „Kapu kész" (zöld), `healthy` → „Ütemben", `closed` → „Lezárt" (halvány).
  Ugyanaz az állapot-nyelvtan, mint az Ügyfelek-táblában.
- **Stagnálás-küszöb: 7 nap** (a `portfolio.ts` dokumentált konstansa —
  újrahasznált, nem új varázsszám).
- **Teszt/piszkozat-szűrés kritériuma** (`isTestProject`, dokumentált): a
  projekt VAGY az ügyfél neve tartalmaz teszt-kulcsszót
  (teszt/test/próba/piszkozat/draft/üres/dummy/demo), VAGY a projektnév
  „placeholder-gépelés" — ≤2 karakter, vagy magánhangzó nélküli (pl. „sdfsdf").
  **Tudatos határ:** a magánhangzót tartalmazó rövid token (pl. „asd") NEM
  rejtett automatikusan, hogy a valós rövidítéseket (SAP/CRM/API) ne rejtsük el
  tévesen — az ilyen a kulcsszó/kézi úton kezelhető. A demo valós szemét-
  projektjei (7a/7b-teszt, üres) a kulcsszóra elrejtve.
- **Érték-placeholder**: a kártya érték-chipje + a footer összértéke szürke
  „—/hamarosan" (konzisztens az Ügyfelek-lappal), nem fabrikált szám.

## 3. Verifikáció (lokális PG16 + PostgREST-shim + prod build + MOCK_LLM)

- **`npx tsc --noEmit`** → 0 (strict). **`npm run build`** → zöld.
  **`npm run i18n:check`** → OK, 1024 kulcs, HU/EN azonos.
- **Pure-modul unit-teszt** (`isTestProject`): a teszt/üres/gibberish-nevek
  elrejtve, a valós projektek (AI-felmérés, Ajánlatadó copilot) megtartva; a
  dokumentált határ (magánhangzós rövid token) tudatos.
- **Playwright** (prod, demo + szintetikus cross-phase projektek a több oszlop
  demonstrálásához):
  - **Board**: 7 oszlop (Kickoff…Üzemeltetés) darabszámmal; a kártyák a helyes
    fázis-oszlopban — P1 „Rád vár" (lila) + „Kapunál áll" (borostyán), P2 „Áll"
    (piros, „Áll N napja"), P3 blokkolt, P6 „Lezárt" (halvány); az üres oszlopok
    „—". Az érték-chip szürke „—".
  - **Státusz-sor**: „4 projekt vár rád — 3 kapunál áll, 1 áll. Delta Foods Kft.
    28 napja nem mozdult." + legenda (rád vár/áll/kapu kész/ütemben).
  - **Teszt-footer**: „3 teszt / piszkozat projekt elrejtve (7b-üres projekt,
    7b-teszt projekt, 7a-teszt projekt) · Megjelenítés →"; számlálók „4 aktív ·
    1 lezárt · — (érték placeholder)".
  - **Nézetváltó**: Pipeline ⇄ Lista működik; a Lista a régi `ProjectListCard`-
    rács (progress + státusz-badge), változatlanul.
  - **Kereső** név/ügyfél szerint szűri a board-kártyákat.
  - **`overflowX = 0px`** és **`backdrop-filter` elem = 0**.
  - **Regresszió**: az Ügyfelek-lap a közös helper után is helyesen renderel
    (élő teendők + státusz-sor).

## 4. Nálad zárandó (Preview)

- **Nincs migráció** — azonnal tesztelhető.
- **Preview-teszt:** a Projektek pipeline-board — a fázis-oszlopok, a kártyák a
  helyes oszlopban, az élő teendők/stagnálás, a szürke érték-placeholder, a
  teszt-projektek elrejtése (Megjelenítés →), és a nézetváltó (Pipeline ⇄ Lista,
  a régi rács).
- Megjegyzés: a „Kapu kész" (zöld) variánst a demo nem mutatja természetesen
  (approved deliverable-t igényelne egy nyitott fázison); a variant-levezetés
  helyes, a másik öt állapot látszik.

## 5. Érintett fájlok

- **Új:** `src/lib/projects/state.ts`, `src/components/ProjectsBoard.tsx`,
  `docs/design/ref_projektek.html` (vizuális igazságalap verziózva)
- **Átírt:** `src/app/(top)/projects/page.tsx` (board + nézetváltó + közös
  állapot), `src/app/(top)/clients/page.tsx` (a közös `loadProjectStates`-re
  refaktorálva)
- **Bővített:** `src/lib/clients/portfolio.ts` (`isTestProject`),
  `messages/hu.json`, `messages/en.json` (+27 kulcs/nyelv)

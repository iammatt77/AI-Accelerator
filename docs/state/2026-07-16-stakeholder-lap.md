# Coding-csomag — Stakeholder-lap redesign (2026-07-16)

**Dedikált stakeholder-lap újratervezés a `ref_stakeholder_lap.html` szerint.**
Branch: `dev`. **Nincs migráció, nincs új adatmodell** — a lap kizárólag a #8
MEGLÉVŐ mezőire (`influence_score`, `impact_score`, `communication_strategy`,
`source_input_ids`, `stakeholder_source_id`, `pain_point_stakeholders`) és
akcióira épül. A HERO a **Befolyás × Érintettség mátrix** (a #8 score-jaiból),
mellette a kvadránsból **kliens-oldalon származtatott** verdikt + a manuális
kommunikációs stratégia; alatta a kötött fájdalompontok és az **egyesített
forráslista** (a régi „tőle jövő” + „hozzárendelés” kettős lista megszűnik).
„A referencia a vizuális igazság — ahol a ref és a megérzés ütközik, a ref nyer.”

## 0. Backend-megfelelés ellenőrzés (kötelező első lépés) — MEGFELELT

A csomag hard-követelménye: mielőtt bármit építek, igazoljam, hogy
`influence_score` = **BEFOLYÁS** (Y-tengely) és `impact_score` = **ÉRINTETTSÉG**
(X-tengely), és ne csak csendben adjak hozzá mezőt, ha eltérés van.

- **Kivonatoló prompt** (`lib/llm/index.ts`): a stakeholder-extrakció explicit
  „az **influence_score (befolyás)** és **impact_score (érintettség)**”
  megnevezéssel kéri a modellt → a mezőnevek szemantikája rögzített.
- **i18n**: `stakeholders.impactLabel = "Érintettség"`, `influenceLabel =
  "Befolyás"` már a #8-ban is így.
- **Következtetés:** a megfelelés áll, **nincs szükség új mezőre / migrációra**.
  A mátrix tengely-kiosztása: **X = impact (Érintettség), Y = influence
  (Befolyás)** — a ref elrendezésével egyezően.

## 1. Mi készült el (a referencia szerint)

- **`lib/stakeholders/matrix.ts`** (tiszta modul, nincs React/DB → önállóan
  tesztelhető): `Quadrant` típus, `MATRIX_THRESHOLD = 3.5` (a #7b hőtérkép
  konvenciója: 4–5 = „magas”, 1–3 = „alacsony”), `isHigh`, `scorePct`
  (1→10%, 3→50%, 5→90% — paddinggel, hogy a jelölő ne lógjon le a szélén),
  `quadrant(influence, impact)` (fent-jobb `manage_closely` / fent-bal
  `keep_satisfied` / lent-jobb `keep_informed` / lent-bal `monitor`) és
  `hasMatrixPoint` (van-e ábrázolható pont — mindkét score megvan).
- **Mátrix-HERO** (`MatrixCard`, `StakeholderPage.tsx`): 2×2 inline négyzet-
  csempés kvadráns (a #7b hőtérkép-stílusa, **nincs chart-könyvtár**), kvadráns-
  tintekkel (elégedetten borostyán / szorosan lila / informáltan kék / monitor
  semleges) és sarok-címkékkel (TARTSD ELÉGEDETTEN / SZOROSAN KEZELD / MONITOROZD
  / TARTSD INFORMÁLTAN). A stakeholder-pont a score-okból számolt helyre kerül
  (`left = scorePct(impact)%`, `top = 100 − scorePct(influence)%`), a monogram
  a jelölőn. Tengelycímkék (BEFOLYÁS ↑ / ÉRINTETTSÉG →) + BEFOLYÁS/ÉRINTETTSÉG
  readout (n / 5). **Hiányzó score** → „**score szükséges**” pill a mátrix
  közepén + „**score szerkesztése**” belépő (a MEGLÉVŐ `StakeholderScoreForm`-ot
  nyitja, semmi új logika).
- **Verdikt** (server-oldali, kvadránsból származtatva — **NEM tárolt**): a
  kvadránshoz kötött tag (KULCSSZEREPLŐ/ÉRINTETT/…) + cím + törzs a ref
  hangnemében; hiányzó score-nál dashed „a verdikthez pontszám kell” doboz.
  Kliens-oldali derivált, adatmodellt nem érint.
- **Kommunikációs stratégia** (`StrategyCard`): a MEGLÉVŐ
  `setCommunicationStrategyAction`-t használja, „**Csak emberi · AI nem tölti**”
  jelvénnyel + „a tanácsadó rögzítette” lábbal. Csak ember tölti.
- **Kötött fájdalompontok** (`PainBinder`): a kötött painek kockázat-jelvénnyel
  (MAGAS/KÖZEPES/ALACSONY a `severity`-ből) + „**+ fájdalompont kötése**”
  belépő, ami a nem-kötött painek választóját nyitja (mindegyik „Kötés” gombbal),
  a kötötteken „Feloldás”. Kötés csak `confirmed`/`manual` stakeholderre; addig
  „Előbb erősítsd meg a stakeholdert” terelő.
- **Egyesített forráslista** (`UnifiedSourceList`): a régi két duplikált lista
  helyett **egy** lista szűrő-fülekkel (Mind / Hozzárendelve / Nincs
  hozzárendelve, élő számlálókkal). Hozzárendelt sor **zöld bal-szegéllyel** +
  „hozzárendelve” jelvénnyel + „Feloldás”; a többi „Hozzárendelés” gombbal
  (MEGLÉVŐ `assignInputSourceAction`). A kivonatolási forrás (`source_input_ids`)
  külön „kivonatolási forrás” taggel marad látható (info-vesztés elkerülése).
- **Fejléc + profil** (`ProfileEditor`): monogram-avatar, név, állapot-jelvény
  (megerősítve/AI-javaslat), cím + „**Profil szerkesztése**” (MEGLÉVŐ
  `editStakeholderAction`).
- **i18n**: ~48 új kulcs/nyelv a `stakeholders` névtérben (kvadráns-címkék,
  verdikt tag/cím/törzs ×4, kockázat-szintek, szűrő-fülek, mátrix-feliratok).
  **i18n:check OK — 917 kulcs, HU/EN azonos készlet.**

## 2. Amit szándékosan NEM változtattam (scope-tartás)

- **Nincs migráció / új mező / új tábla.** A backend-check megfelelt, így a lap
  tisztán a meglévő #8 adaton áll.
- **A #8 pontozás-logika, pain-kötés M:N szemantikája, forrás-hozzárendelés
  akciók változatlanok** — a lap csak megjeleníti/vezérli őket.
- **A pilótafülke stakeholder-szekciója érintetlen** (külön csomag).
- **Span-szintű citáció-kiemelés** nem tárgya ennek a csomagnak.

## 3. Kezelt eltérések / döntések (dokumentálva)

- **Tengely:** `impact` → X (Érintettség), `influence` → Y (Befolyás) — a ref és
  a backend-megnevezés egyezik, megerősítve (0. pont).
- **Kockázat-jelvény forrása:** a `pain_points.severity` (low/medium/high)
  mezője adja a kötött painek MAGAS/KÖZEPES/ALACSONY badge-ét — nincs külön
  „risk” mező a painen (az a use_case-eké).
- **„+ fájdalompont kötése” a stakeholder-lapról:** vékony
  `togglePainBindAction`-t adtam a `stakeholder-actions.ts`-hez, amely a MEGLÉVŐ
  `pain_point_stakeholders` M:N táblára ír (idempotens insert/delete, ugyanazok
  az őrök: stakeholder confirmed/manual, pain a projekthez tartozik). A
  fájdalompont-oldali kötés (`setPainStakeholdersAction`) érintetlen — ez csak a
  másik irányú belépő ugyanahhoz a táblához.
- **Küszöb 3,5:** a #7b hőtérkép konvenciója (4–5 magas). A demo-adaton tisztán
  szeparál: Üzemvezető 5/4 (mindkettő magas → SZOROSAN KEZELD), Ügyintézői 2/5
  (alacsony befolyás, magas érintettség → TARTSD INFORMÁLTAN), Vezetőség null
  (pont nélkül → score szükséges).

## 4. Verifikáció (lokális PG16 + PostgREST-shim + prod build + MOCK_LLM)

- **`npx tsc --noEmit`** → 0 hiba (strict).
- **`npm run build`** → zöld (a `/project/[id]/stakeholder/[stakeholderId]`
  route fordul).
- **`npm run i18n:check`** → OK, 917 kulcs, HU/EN azonos.
- **Playwright-végigjárás** (prod szerver, MOCK_LLM, reset-demo → P1 stakeholder-
  extrakció → a három demo-stakeholder):
  - **Üzemvezető** (inf 5 / imp 4, confirmed): ÜZ-pont a **SZOROSAN KEZELD**
    (fent-jobb) kvadránsban; verdikt „Szorosan kezeld — a kételyeit korán
    rendezd”, KULCSSZEREPLŐ tag; stratégia „Csak emberi · AI nem tölti”.
  - **Ügyintézői csapat** (inf 2 / imp 5): ÜC-pont a **TARTSD INFORMÁLTAN**
    (lent-jobb) kvadránsban; verdikt „Tartsd informáltan — a mindennapi hatás
    nála csapódik le”, ÉRINTETT tag; BEFOLYÁS 2/5, ÉRINTETTSÉG 5/5.
  - **Vezetőség** (null/null): „**score szükséges**” pill a mátrixban, dashed
    „a verdikthez pontszám kell” verdikt, —/5 readout; pain-kötés terelve
    („Előbb erősítsd meg…”, mert AI-javaslat).
  - **Pain-kötés end-to-end**: „+ fájdalompont kötése” → választó (3 pain,
    MAGAS/KÖZEPES/ALACSONY badge-ekkel) → „Kötés” → a `pain_point_stakeholders`
    táblában megjelenik a sor, a kötött pain MAGAS badge-dzsel + „Feloldás”
    látszik, a fejléc-számláló 0→1.
  - **Forrás-hozzárendelés end-to-end**: „Hozzárendelés” → az input
    `stakeholder_source_id`-ja beáll, a sor zöld szegélyt + „hozzárendelve”
    jelvényt + „Feloldás”-t kap, a szűrő-fülek számlálói frissülnek
    (Mind 3 / Hozzárendelve 1 / Nincs hozzárendelve 2).
  - **`overflowX = 0px`** és **`backdrop-filter` elem = 0** mindhárom lapon
    (tömör-lapos, 0 blur — a UI-Master modellel egyezően).

## 5. Nálad zárandó (Preview)

- **Nincs migráció** ebben a csomagban — a Preview azonnal tesztelhető a
  meglévő sémán.
- **Preview-teszt:** egy P1-en már kivonatolt stakeholder lapja
  (`/project/:id/stakeholder/:stakeholderId`) — nézd a mátrix-pont helyét a
  score-okhoz, a kvadráns-verdiktet, a „Csak emberi” stratégiát, a kötött
  fájdalompontokat (kockázat-badge, +kötés/Feloldás) és az egyesített
  forráslistát (szűrő-fülek, zöld szegély a hozzárendelten). Score nélküli
  stakeholdernél a „score szükséges” + dashed verdikt jelenik meg.

## 6. Érintett fájlok

- **Új:** `src/lib/stakeholders/matrix.ts`, `src/components/StakeholderPage.tsx`
- **Átírt:** `src/app/project/[id]/stakeholder/[stakeholderId]/page.tsx`
  (server-kompozíció: mátrix-pont + kvadráns + verdikt-stílus + egyesített
  forrás-sorok)
- **Bővített:** `src/app/stakeholder-actions.ts` (`togglePainBindAction`),
  `messages/hu.json`, `messages/en.json`

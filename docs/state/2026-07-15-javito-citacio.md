# Javító-csomag — Kétirányú citáció-traceability + tár forrás-panel + 2 kis javítás (2026-07-15)

Branch: `dev` → Vercel Preview. Négy javítás egy csomagban, mind a
szerkesztő/megjelenítő környékét érinti. **Nincs adatmodell-változás, nincs
migráció, nincs generálási-motor-változás** — a citáció a meglévő
`source_indices`-re épül (span nélkül, ahogy a spec kérte).

## 1. Mi készült el

### 1. Forrás → doksi következetes (a meglévő logika kiterjesztése)
A `[n]` most **mindenhol kattintható** a szerkesztőben, a meglévő
`jumpToSource(n)`-t hívja → a forrás-panel kártyája kiemelődik + odagördül.
Új helyek: a mező-accordion **értékében** ÉS a „Források:" sorában
(`EditorField.tsx` a `renderCitations` propon át kapja a szerkesztő közös
citáció-renderelőjét). A body és a mező-értékek `[n]`-jei már korábban is
kattinthatók voltak — most a mező-kártyák is.

### 2. Doksi → forrás (fordított irány — ÚJ)
A forrás-kártyára/csempére kattintva a dokumentumban **felvillan minden
`[n]`**, ami arra a forrásra hivatkozik (Web Animations API pulzus, a pivot
akcentus-színnel — nincs tartós kiemelés, nincs blur). A logika
(`flashCitations` az `ArtifactEditor`-ban):
- **auto-görgetés** az első felvillanó helyhez (`block: "start"` — legfelülre;
  a többi kilóghat lefelé);
- **accordion-nyitás**: edit-módban kinyitja az első hivatkozó mezőt (inline
  `[n]` VAGY mező-szintű forrás-index alapján) + a body-t, hogy a felvillanás
  látszódjon;
- **adat**: nincs span — a `[n]` jelölők `data-cite={n}` attribútumot kapnak, a
  villantás DOM-lekérdezéssel (`querySelectorAll`) találja meg őket, így
  komponens-határon át is működik.

### 3. Tár kész-doksi forrás-panel (ÚJ)
Az **előnézet-mód** (draft ÉS approved/kész-doksi) mostantól kompakt
forrás-panelt kap (kis csempék egymás alatt: `[n]` + rövid cím + dátum). Ez
egyszerre:
- a tár **kész-doksi** (approved → preview) forrás-panelje (a `[n]` odaugrik, a
  csempe visszavillant) — a spec 3. pontja;
- bezárja az 1. pont **preview-rését**: a `[n]` a draft-előnézetben sem
  „kattintható, de nem történik semmi" többé.
A kétirányú összekötés a kész-doksiban ugyanúgy működik, mint a szerkesztőben,
csak kompaktabb forrás-megjelenítéssel.

### 4. „Fék" átnevezés (business case kalkulátor, #9)
Csak i18n: a STAGE 2 címke **„Realizálható megtakarítás (%)"** (a „A FÉK"
kivezetve), a súgó-sor: *„A felszabaduló kapacitásból mekkora rész válik
ténylegesen költségmegtakarítássá. **Üzleti becslés — te döntöd el.**"* (HU/EN).
A „DÖNTÉSI PONT · CSAK EMBERI · AI NEM TÖLTI" tag és a mező **logikája
változatlan** (kizárólag emberi, az AI sosem tölti).

### 5. Adatérettség-értékelő mentési bug (#7b) + dropdown-sorrend
Mentés után a mezők nem tűnnek el (frissítés nélkül is megmaradnak). A
dropdown sorrend most **erős → részleges → gyenge** (legjobb elöl).

## 2. Az adatérettség-bug gyökéroka (eltérés a spec javasolt megközelítésétől)

A spec a #9-es „useState nem olvassa újra a propot" mintát javasolta
(key-remount). A **tényleges gyökérok más**, amit a lokális walkthrough
műszerezett debuggal derített ki:

- A mentés utáni `current` **helyesen frissül** a szerveren (a kártya-jelvény
  „magas adatérettség"-re vált — server-render), és a kliens `grades` state is
  **helyesen strong** (debug-span bizonyította).
- Mégis a `<select>` DOM-értéke **üres** lett. Ok: a **React 19 `<form action>`
  a mentés után `requestFormReset`-tel alaphelyzetbe állítja a DOM-mezőket**; a
  KONTROLLÁLT select value-ját (változatlan `strong→strong`) React nem írja
  vissza a resetelt DOM-ra → a mező „eltűnik" frissítésig.
- **A javítás a kódbázis MÁR MŰKÖDŐ mintája** (a szomszédos textarea):
  **nem-kontrollált `defaultValue={grades[key]}` + `key={state.nonce}`**. A
  reset a nem-kontrollált mezőt a `defaultValue`-ra (= a `grades`-ben őrzött
  választás) állítja vissza, a nonce-remount újraolvassa; az `onChange`
  továbbra is a `grades`-t frissíti (hibaágon és remounton is megőrzött
  választás). A key-remount (spec-javaslat) itt NEM működött volna, mert a
  `grades` state sosem volt a hibás — a DOM-reset volt az.

**Kapcsolódó, azonos gyökerű (ebbe a csomagba NEM vett) lelet:** az
`AiSuitabilityPanel` (ugyanilyen kontrollált selectek) és az `AiActPanel`
(kontrollált select + checkboxök) **ugyanezt a React-19 form-reset hibát**
hordozzák, ugyanezzel az egysoros javítással orvosolhatók. A spec a task 5-öt
kifejezetten az adatérettségre szűkítette („ne bővítsd a scope-ot") — ezért
**csak az adatérettséget javítottam; a két testvér-panelt itt jelzem** a
következő körre.

## 3. Önellenőrzés (lokális PG16 + PostgREST-shim + prod build + Playwright)

Teszt-fixtúrák a demo-projekten: citációs charter (approved v1 + draft v2,
`[1][2][3]` a body-ban és mezőkben, 3 seedelt forrással) + egy megerősített
use case (adatérettség-panelhez) + egy Business case draft (fék-címkéhez).

- **Task 1 (edit):** a `Cél` mező-kártyában **4 `data-cite`** (2 az értékben +
  2 a „Forrás:" sorban) — mind kattintható; `[2]`-re kattintva a forrás-kártya
  kiemelődik. (`01–02-*.png`)
- **Task 2 (fordított):** a `[1]` forrásra kattintva a hivatkozó mező + body
  kinyílik, **4 `[1]` jelölő** válik láthatóvá és villan; auto-görgetés. (`03`)
- **Preview-rés + Task 3:** draft-előnézet ÉS approved kész-doksi: kompakt
  forrás-panel jelen (`7 citáció`), a `[n]` kattintható, a csempe visszavillant.
  (`04-draft-preview.png`, `05–06-approved-*.png`)
- **Task 4:** a BC-kalkulátor STAGE 2 = „REALIZÁLHATÓ MEGTAKARÍTÁS (%)" + az új
  súgó („…te döntöd el."); „A FÉK" eltűnt; a logika érintetlen. (`09-fek-label.png`)
- **Task 5:** üres readiness → 4 dimenzió „erős" → mentés → **a 4 select MEGMARAD
  „erős"-ön** (a bug előtt: 0/4), a jelvény „✓ magas adatérettség", a panel
  nyitva marad, „Értékelés elmentve"; a DB-ben `level: high`, 4 strong. A
  dropdown sorrend „erős → részleges → gyenge". (`08-readiness-saved.png`)
- **Referencia-hűség:** minden nézeten `backdrop-filter` = **0**, vízszintes
  túlcsordulás = **0**. A citáció-akcentus a rendszer pivot-színe.
- **Build zöld · `tsc --noEmit` exit 0 · `i18n:check` üres (869 kulcs) ·**
  nincs blur/glass a módosított komponensekben · a citáció-mögöttes
  (`jumpToSource`, forrás-index) változatlan · a #9 kalkulátor-logika és a P2
  kapu érintetlen.

## 4. Változott fájlok (5)

- `src/components/ArtifactEditor.tsx` — `data-cite`, `flashCitations` +
  WAAPI-pulzus + auto-scroll + accordion-nyitás, kattintható forrás-kártyák,
  kompakt forrás-panel az előnézetben, `renderCitations` prop továbbadása.
- `src/components/EditorField.tsx` — `renderCitations` prop: a mező-érték és a
  „Források:" sor `[n]`-jei kattinthatók.
- `src/components/EvaluatorForms.tsx` — readiness select: nem-kontrollált
  `defaultValue` + `key={nonce}` (form-reset javítás); dropdown-sorrend
  erős→részleges→gyenge.
- `messages/hu.json`, `messages/en.json` — `editor.sourceTileHint`; a `p2`
  fék-átnevezés (`stage2`, `fekHint`, `fekCredibility`).

## 5. Parkoló-lista

- **Span-szintű kiemelés** (a hivatkozott szövegrészlet kijelölése a
  forrásban) — tudatosan NEM ebben a csomagban (a body strukturált formátumra
  váltását igényelné).
- **`AiSuitabilityPanel` + `AiActPanel` form-reset javítás** (azonos gyökér,
  egysoros fix) — a következő körre, jóváhagyásra.
- **Approved + kézzel „Szerkesztés"-re váltott** nézet: ott a verzió-sáv áll a
  jobb oldalon (nem forrás-panel), így a `[n]` ugrás no-op. A kész-doksi
  alap-nézete (előnézet) teljes; ez az élő-eset marginális.

## 6. Nálad zárandó (Preview)

- **Mindkét irány, mindkét helyen:** szerkesztő (draft) — `[n]` a mezőkben +
  body → forrás kiemelés; forrás-kártya → doksi-felvillanás. Tár kész-doksi
  (approved) — ugyanez a kompakt forrás-panellel.
- **Fék:** a BC-kalkulátor „Realizálható megtakarítás (%)" címmel + súgóval.
- **Adatérettség:** mentés után a mezők NEM tűnnek el (frissítés nélkül is
  megmaradnak); a dropdown „erős" elöl.

# Coding-csomag — Forrástár redesign (2026-07-16)

**A „Források" nézet mester–részletté alakítása a `ref_forrastar.html` szerint.**
Branch: `dev`. **Nincs migráció, nincs új adatmodell** — a végtelen szövegfal
helyére kereshető/szűrhető lista (bal) + olvasó-panel (jobb) kerül, tisztán a
MEGLÉVŐ `input_items` adatból + a citációk fordított aggregációjából. A ref a
vizuális igazságalap; „a tartalom nem vész el, csak a helyén, olvasva jelenik meg".

## 0. ELSŐ LÉPÉS — backend-ellenőrzés (a csomag kötelező nyitánya)

Végigmentem a ref négy „lehet, hogy nincs a backendben" elemén:

1. **„hivatkozva N×" + „HOL hivatkozva"** — **AZ ADAT LÉTEZIK, migráció nem kell.**
   Fordított aggregációt írtam: minden inputra végignézem, mely deliverable-ök
   (`artifacts.source_input_ids` ∪ a `fields[].source_indices` → input-id map) és
   mely stakeholderek (`stakeholders.source_input_ids`, illetve az input
   `stakeholder_source_id`-ja) hivatkoznak rá. Ez tisztán **olvassa** a meglévő
   citációkat — a citáció-rendszert nem írja át. Szerver-oldali, query-szintű.
2. **Forrás-típus (Átirat / .TXT / szűrő)** — **NINCS strukturált típus/formátum
   mező** az `input_items`-en (csak a szabad-szöveges `type`). A prompt két opciót
   adott; az **egyszerűbbet választottam (származtatás, (a) opció)**: a kategóriát
   (`transcript`/`list`/`note`/`data`/`document`) és a fájl-jelvényt (.TXT/.CSV…)
   a `type` szövegből heurisztikával vezetem le (`lib/sources/references.ts`). Ez
   a típus-szűrőt kiszolgálja → **migráció nem kell.**
3. **Szószám / metaadat** — a **szószámot** a tartalomból számolom (kész). A
   **résztvevők száma** típusú, tartalom-értelmezős metaadat nincs strukturáltan
   tárolva → **elhagyva** (nem építettem hozzá NLP-t, a prompt szerint).
4. **Átirat felszólalónként** — legjobb-igyekezet parser: ha a nyers szöveg ≥2
   különböző felszólalót tartalmaz (sorkezdő „Név:" vagy „[időkód] Név:"), akkor
   beszélő-blokkokra bontom; egyébként formázott nyers szövegként mutatom. Nincs
   új adat.

**Összegzés:** az 1. és 2. is megoldható migráció nélkül → **a csomag NEM
igényel migrációt.** A tár tisztán megjelenítés + származtatás.

## 1. Mi készült el (a ref szerint)

- **`lib/sources/references.ts`** (tiszta modul, nincs React/DB → önállóan
  tesztelhető): `deriveSourceKind` (kategória-heurisztika HU+EN),
  `deriveFileBadge` (.CSV/.TXT… a `type`-ból), `wordCount`, `previewLine`,
  `parseTranscript` (felszólalónkénti bontás, folytatósor-fűzéssel; <2 beszélő →
  null). Típusok: `SourceKind`, `ReferenceChip`, `SourceRow`.
- **`components/SourcesLibrary.tsx`** (kliens, mester–részlet):
  - **Bal lista** — fejléc (`N · projekt`), **kereső** (cím+tartalom+előnézet
    fölött), **szűrő-pillek** (Mind + fázisonként + kategóriánként, valós
    számlálókkal, egy-aktív), tömör sorok (`[n]` + kategória-ikon + cím +
    előnézet + fázis-chip + fájl-jelvény + dátum + „hivatkozva N×"); a
    kiválasztott sor lila bal-szegéllyel; „nincs találat" üres állapot; a
    „bemenet-felvétel az Input zónában" halk lábjegyzet.
  - **Jobb olvasó** — fejléc (kategória-avatar + `[n]` + cím), **kategória- és
    fázis-jelvény + „feltöltve {dátum}" + „{N} szó"**, **„Megnyitás ↗"**
    (formázott ↔ nyers váltó) + **„Hivatkozás beszúrása"** (a `[n]` jelölőt a
    vágólapra másolja — „Másolva ✓"), **HIVATKOZVA:** kattintható chipek
    (deliverable → artifact-editor, stakeholder → stakeholder-lap), és a teljes
    tartalom formázva (átirat beszélő-blokkokban vagy formázott nyers szöveg).
    Az olvasó görgethető, a teljes tartalommal (nincs mesterséges levágás).
- **`app/project/[id]/sources/page.tsx`** (átírt, szerver): betölti a projektet,
  a számozott inputokat, az artifactokat (típusonként a legfrissebb verzió a
  link-cél, a hivatkozott input-id-k uniója az összes verzión át) és a
  stakeholdereket; összeállítja a `SourceRow[]`-t a fordított aggregációval;
  üres projektnél a meglévő üres kártya marad.
- **i18n**: 19 új kulcs/nyelv a `sourcesPage` névtérben (kereső, szűrők,
  kategórianevek, olvasó-címkék, „Hivatkozva", szószám, akciók). **i18n:check OK
  — 936 kulcs, HU/EN azonos.**

## 2. Amit szándékosan NEM változtattam (scope-tartás)

- **Nincs migráció / új mező.** A bemenet-felvétel (Fázis-munkafelület Input
  zóna), a forrás-hozzárendelés logikája és az artefaktum-adatmodell változatlan.
- **A „hivatkozva" aggregáció csak OLVASSA** a meglévő `source_input_ids` /
  `fields.source_indices` értékeket — a citáció-rendszert nem írja át.
- **A shell** (globális sidebar + projekt-subnav) a meglévő — csak beillesztettem
  a nézetet, nem építettem újra.

## 3. Kezelt eltérések / döntések (dokumentálva)

- **Típus-származtatás vs migráció:** a `source_type` mező helyett a `type`
  szövegből származtatok (2. pont, (a) opció) — a szűrőt kiszolgálja, migráció
  nélkül. Ha később strukturált típus kell (pl. import-időben), az egy külön,
  idempotens 0008 lehet.
- **Fájlnév-sor az olvasóban:** a ref mutat egy fájlnevet (pl.
  `Teams_Transcript…txt`), de az `input_items` **nem tárol fájlnevet** → a
  fájlnév-sort elhagytam; helyette a `type`-ból származtatott **fájl-jelvény**
  (.CSV/.TXT) jelenik meg a sorban és a kategória-jelvény az olvasóban.
- **„hivatkozva N×" jelentése:** a hivatkozó **deliverable-típusok + stakeholderek**
  száma (a chipekkel megegyezik). A pain/use-case entitások nem külön chipek — a
  citációjuk a shortlist-deliverable-be gördül; ezt a modellt a ref is követi
  (deliverable-chipek + stakeholder-profilok).
- **Résztvevők száma:** elhagyva (nincs strukturált adat, NLP tilos — 0. pont/3).
- **„Hivatkozás beszúrása":** a tárban nincs aktív szerkesztő-kontextus, ezért a
  gomb a `[n]` citáció-jelölőt a **vágólapra másolja** (őszinte, nem-fabrikált
  művelet: bemásolható egy draftba). Az editor-oldali beszúrás külön marad.

## 4. Verifikáció (lokális PG16 + PostgREST-shim + prod build + MOCK_LLM)

- **`npx tsc --noEmit`** → 0 hiba (strict).
- **`npm run build`** → zöld (a `/project/[id]/sources` route fordul).
- **`npm run i18n:check`** → OK, 936 kulcs, HU/EN azonos.
- **Pure-modul unit-teszt** (`references.ts`, 16/16 assert zöld): kategória-
  származtatás (transcript/note/data/list/document), fájl-jelvény (.CSV/.TXT/null),
  szószám, előnézet-csonkolás, és a **többbeszélős átirat-bontás** (3 turn, „SM"
  monogram, folytatósor-fűzés) + az **egybeszélős → null degradáció**.
- **Playwright-végigjárás** (prod, demo panaszkezelés-projekt, 3 forrás + 1
  Projekt-charter deliverable + 1 stakeholder):
  - **Mester–részlet** renderel: bal lista + jobb olvasó a shellben.
  - **Szűrő-pillek**: Mind 3 · P0 2 · P1 1 · Átirat 1 · Jegyzet 1 · Adat 1 (valós
    számlálók); P1 szűrő → csak a .csv forrás; a kereső pozitívan szűkít
    („Excel" → 2 találat, „kategória" → 1) és üres találatnál a „nincs találat"
    állapot jön.
  - **„hivatkozva N×"** helyes: a transzkript 2× (Projekt-charter + Üzemvezető
    stakeholder), a többi 1×.
  - **Olvasó**: kategória- (ÁTIRAT/ADAT) + fázis-jelvény, „feltöltve {dátum}",
    „{N} szó"; **HIVATKOZVA** chipek — a „Projekt-charter" a deliverable-hez, az
    „◆ Üzemvezető" a stakeholder-laphoz vezet.
  - **`overflowX = 0px`** és **`backdrop-filter` elem = 0** (tömör-lapos, 0 blur).

## 5. Nálad zárandó (Preview)

- **Nincs migráció** — a Preview azonnal tesztelhető a meglévő sémán.
- **Preview-teszt:** egy projekt Források nézete (`/project/:id/sources`) —
  kereső + fázis/típus szűrők, egy forrás kiválasztása, az olvasó-panel a teljes
  tartalommal és a „HIVATKOZVA" chipekkel (kattints egyre → a hivatkozó
  dokumentum/stakeholder). Több-forrásos, több-deliverable-ös projekten látszik a
  „hivatkozva N×" és a chip-lista igazán.

## 6. Érintett fájlok

- **Új:** `src/lib/sources/references.ts`, `src/components/SourcesLibrary.tsx`,
  `docs/design/ref_forrastar.html` (a vizuális igazságalap verziózva)
- **Átírt:** `src/app/project/[id]/sources/page.tsx` (mester–részlet +
  fordított citáció-aggregáció)
- **Bővített:** `messages/hu.json`, `messages/en.json` (+19 kulcs/nyelv)

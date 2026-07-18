# Záró jelentés — #11-fix Stakeholder-kötés + forrás-hivatkozás + AC-perzisztencia + AC-túlcsordulás

**Dátum:** 2026-07-17 · **Branch:** dev · **Ref:** ref_kovetelmenyek.html (Preview-ban talált 4 hiba)
**Alap:** #11 Követelmény- és User Story-kezelő (P2) — a modul él, ez a 4 pontos javítás.

A csomag előírta: a 2. és 3. pontnál **először diagnózis, csak utána
javítás**. Alább a pontos gyökérokok, majd a javítások és a verifikáció.

---

## 0) Diagnózis (a javítás előtt) — a két „diagnosztizáld, ne javíts vakon" pont

### 2. pont — a story forrás-hivatkozása mindig `[1]`

**Gyökérok: megjelenítési hiba, a tárolt adat helyes volt.** A
story-részlet nem a kanonikus [n] indexet rajzolta, hanem a
`source_input_ids` tömb **hosszát** formázta zárójelbe:
`[{story.source_input_ids.length}]`. Egyforrású story-nál ez mindig `[1]`,
kétforrásúnál `[2]` — vagyis egy darabszám, nem hivatkozás.

DB-igazolás (walkthrough-adat): US-01/02/03 forrása `…0002` (AS-IS
folyamatvázlat), US-04 forrása `…0001` (interjú-transzkript) — a tárolt
`source_input_ids` **helyes és eltérő** volt. A hiba tisztán a render.

### 3. pont — az ✦ AC-generálás nem perzisztál (reload után eltűnik)

**Gyökérok: az akció sosem írt DB-be — csak kliens-állapotba generált.** A
régi `suggestAcDraftAction` a `suggestAcDraft`-tal vázlatokat állított elő,
és azokat **kizárólag a komponens állapotában** tartotta; egyetlen
`acceptance_criteria` INSERT sem történt. Reloadnál a szerver a DB-ből
rendereli a lapot → a soha be nem írt vázlatok eltűnnek.

**EXPLICIT: ez NEM ugyanaz a bug-osztály, mint a #9 / #7b korábbi
mentés-eltűnések.** Ott a mentés **beírt** a DB-be, de a UI nem frissült
(revalidate-hiány / űrlap-reset a re-render előtt) — a rekord megvolt, csak
nem látszott. Itt fordítva: a rekord **sosem jött létre** — az ✦ generálás
eleve nem volt írási művelet, hanem tervezetten csak űrlap-előtöltés. Két
külön hiba-tő.

### 4. pont — AC-sor vízszintes túlcsordulása

**Gyökérok: hiányzó `min-w-0` a flex/grid gyerekeken.** A CSS-alapértelmezés
`min-width:auto`, ami megakadályozza, hogy a flex/grid item a tartalma alá
zsugorodjon; a hosszú GWT-szöveg így széttolta az `1fr` sávot a konténer
fölé. Adatlogika nem érintett — tisztán CSS.

### 1. pont — stakeholder-kötés hiánya (migráció kell-e?)

**Nem kell migráció.** A `stakeholder_requirements` tábla (0009) csak PK +
2 FK — semmi nem kényszerít kötést, üres kötés = nulla sor, ez érvényes
állapot (c-minta). A hiba az volt, hogy (a) a generálás nem képzett
kötést, (b) nem volt kézi kötés/oldás UI. Sémaváltás nélkül javítható.

---

## 1) Javítások

- **1. pont — stakeholder-kötés.** A `suggestRequirements` rendszerprompt
  megerősítve: minden stakeholder-szintű követelménynél **azonosítsa, melyik
  érintettet szolgálja**, a neveket a megadott listából **pontosan** másolva,
  alap híján üresen hagyva (c-minta — **nem fabrikál**). A generálás-akció
  most `matchStakeholder()`-rel köt: normalizált **pontos** egyezés, majd
  egyértelmű (pontosan egy jelölt, ≥4 karakter) tartalmazás-egyezés, egyébként
  null. Új kézi UI (`StakeholderLinkEditor`): kötés (dropdown + „+ Kötés") és
  oldás (👤 {név} ✕) a stakeholder-szintű requirement részletén. Upsert
  `ignoreDuplicates` — kettős kötés nincs.
- **2. pont — forrás-hivatkozás.** A story-részlet most a
  `loadNumberedSources` + `inputIdsToIndices` kanonikus úton képzi a
  chipeket (`[{c.n}] {cím}`), forrásonként egy chip; forrás híján üres-állapot
  (`noSource`). A [n] számozás a repo egységes citáció-mintája (lib/sources).
- **3. pont — AC-perzisztencia.** A régi `suggestAcDraftAction` helyett
  `generateAcAction`: generál `suggestAcDraft`-tal, majd **minden vázlatot
  `acceptance_criteria` sorként INSERT-el** (növekvő `ord`), és
  revalidate-eli a boardot ÉS a részletet — a rekord perzisztál, reload után
  megvan. Üres generálás → `noticeNoAc`. HITL-hez `AcDeleteButton` (✕): az
  ember elvetheti az AI által beírt AC-t.
- **4. pont — CSS.** `min-w-0` a flex/grid gyerekeken 3 helyen (AC-fejléc
  cím, GWT-sorok szövege, a grid AC-oszlopa), `shrink-0` a fix címkéken/
  badge-eken, `break-words` a szövegen. Adatlogika változatlan.

## 2) Kemény szabályok — igazolás

- **Nem fabrikál kötést:** a `matchStakeholder` bizonytalanságnál `null`-t ad;
  alap nélkül üres a kötés (c-minta) — a mock generálás is csak ott köt, ahol
  a név egyértelműen illik.
- **Nincs új migráció:** a meglévő `stakeholder_requirements` elég (a
  constraint-vizsgálat: csak PK + 2 FK, semmi kötés-kényszer).
- **4. pont tisztán CSS:** semmilyen akció / lekérdezés / adatlogika nem
  változott — csak Tailwind-osztályok.
- **A #9/#7b hiba-osztály kimondva:** a 3. pont **nem** az (fentebb
  részletezve — ott beírt-de-nem-látszott, itt sosem-írt).

## 3) Regresszió — a működő részek érintetlenek

| Ellenőrzés | Eredmény |
|---|---|
| Közös AC (1 rekord, két nézeten — amikor van adat) | ✓ változatlan mechanizmus (`inheritedAcs` ugyanazt a rekordot oldja fel) |
| N:M kötés (requirement ⇄ story, mindkét irány) | ✓ érintetlen |
| Nézet-váltó (BA ⇄ Agile, kijelölés túléli) | ✓ érintetlen |

## 4) Verifikáció (lokális PG16 + PostgREST-shim + prod build + MOCK_LLM)

| Ellenőrzés | Eredmény |
|---|---|
| tsc strict / prod build / i18n:check | 0 hiba / zöld (14.1s) / 1315 kulcs HU=EN ✓ |
| 3. pont — ✦ AC generálás **perzisztál** (reload után is) | ✓ DB: `ac_persisted_in_db=2` a SYS-01-en, reload után rendereli |
| 3. pont — HITL törlés (✕) | ✓ AcDeleteButton elveti az AI-AC-t |
| 2. pont — forrás-chip = kanonikus [n], nem darabszám | ✓ US-01 `[2] AS-IS folyamatvázlat`, US-04 `[1] Interjú-transzkript` (eltérnek) |
| 1. pont — kézi kötés/oldás UI stakeholder-reqen | ✓ SR-03: „👤 Üzemvezető ✕" + „Érintett hozzákötése… + Kötés" (DB: `sr01_stakeholder_links=1`) |
| 1. pont — generálás nem fabrikál kötést alap nélkül | ✓ `matchStakeholder` null-ra esik (c-minta) |
| 4. pont — 0 vízszintes túlcsordulás (3 hely: req-részlet, story-részlet, grid) | ✓ minden jeleneten |
| Regresszió — közös AC / N:M / nézet-váltó | ✓ (3. szakasz) |
| 0 backdrop-blur mindenhol | ✓ |

**FONTOS — valós LLM:** lokálisan nincs éles Anthropic-kulcs, a teljes
walkthrough MOCK_LLM-en futott. A stakeholder-azonosítás és az AC-generálás
**valós modellel mért minőségét a Preview-n kell igazolni** — a promptok
kényszerítik a szabályokat (pontos név-másolás, c-minta, üres híján üres),
de a valós kimenetet itt nem tudtam lefuttatni. A perzisztencia-, render- és
CSS-javítások LLM-függetlenek, azok lokálisan bizonyítottak.

## 5) Nálad zárandó (felhasználói teendő)

Preview-n valós láncból: egy stakeholder-szintű követelmény generálása →
ellenőrzés, hogy a helyes érintett kötődik-e (és hogy alap híján üres marad);
egy system reqre ✦ AC-generálás → **reload** → az AC megvan-e; egy story
megnyitása → a forrás-chip a **valódi** forrást mutatja-e (nem `[1]`
darabszámot); hosszú AC-szöveg → nincs-e vízszintes csúszka.

## 6) Parkoló-lista (változatlan a #11-hez képest)

- Opció-összevető és P2 kapu-integráció (külön csomag).
- AC szerkesztése/átrendezése (most: felvétel + törlés).
- Requirement-szöveg utólagos szerkesztése (#7a edit-minta).
- Won't-szűrő chip.

## 7) Harness-jegyzet (nem repo-kód)

A verifikáció a lokális PostgREST-shimen + PG16-on futott (scratchpad; éles
Supabase-t nem érint). A Playwright-járás néhány `·` middot- és RSC-payload-
zaj miatt hamis-negatívot adott a 2. pontnál; a tényleges renderelt HTML-t
curl-lel és képernyőképpel (p1-stakeholder-bind.png, p4-story-ac.png)
igazoltam — a chipek helyesen `[2]` / `[1]`, a kötés-UI és a perzisztált AC
látszik.

# Záró jelentés — #11 Követelmény- és User Story-kezelő (P2)

**Dátum:** 2026-07-17 · **Branch:** dev · **Ref:** ref_kovetelmenyek.html (8 jelenet)
**Commitok:** `#11/1` 0009 + entitásréteg (822aeb4) · `#11/2` LLM (cff6232) · `#11/3` akciók + BA-nézet (69268f9) · `#11/4` Agile + story-részlet (2a398d5) · `#11/5` nézet-váltó + kiemelés + fix (e518fbd) · `#11/6` jelentés (ez a commit)

Új funkcionális modul: EGY adat, KÉT nézet — a BA-nézet a háromszintű
requirement-fa (a „forrás-igazság"), az Agile-nézet a belőle SZÁRMAZTATOTT
epic→user story delivery-szervezés, N:M kötéssel és KÖZÖS acceptance
criteriával. Az irány kötött: requirement → story. A traceability a gerinc.

---

## 0) Backend-egyezés (a csomag előírt első lépése)

| Réteg | Állapot | Döntés |
|---|---|---|
| Generálás-alap | VOLT — pain_points (E1), process_maps TO-BE, stakeholders (#8) | a fa-javaslat bemenete (nem-elvetett painek + legfrissebb TO-BE lépései + érintettek) |
| Citáció | VOLT — input_items + [n] (lib/sources) | source_input_ids uuid[] a meglévő entitás-minta szerint (a csomag jsonb-t írt, de a minta-illesztést is előírta — a uuid[] a #7a/#8 konvenció; jelentve) |
| E1 + állapot | VOLT — entity_state enum (ai_suggested/confirmed/manual/rejected) | újrahasznosítva mindkét entitáson |
| LLM-csatorna | VOLT — lib/llm adapter + MOCK | 4 új fn ugyanazon az adapteren |
| Követelmény-entitások | NEM VOLT | **0009**: requirements, acceptance_criteria, epics, user_stories, requirement_stories (N:M), stakeholder_requirements |

## 1) A közös AC adatmodell-megoldása (a legkényesebb pont)

**Egy AC = egy sor az `acceptance_criteria` táblában, `requirement_id` FK-val
— az AC KIZÁRÓLAG a requirementen él.** A story-oldal megjelenítése a
`requirement_stories` N:M kötésen át történik: a `inheritedAcs()` segéd a
story kötött requirementjeinek AC-sorait oldja fel — **másolás, duplikálás
nincs sehol a kódban** (story-oldali AC-írás nem létezik). A szerkesztés
(a requirementen) így definíció szerint mindkét helyen „frissül".

**DB-igazolás a walkthrough-ból:** összesen **1** acceptance_criteria sor
(a SYS-01-en felvett); ugyanez az egy rekord renderelődött a requirement-
részleten („közös · a story-kkal", AC-fejlécben ◑ a kötött story-k) ÉS az
US-02 story-részleten („közös · SYS-01-től", ⤴ SYS-01 címkével). 3 story
kötve SYS-01-hez, 5 N:M link összesen. Egységteszt is őrzi: a kötés-feloldó
UGYANAZT az objektumot adja két story-nál (20/20 ✓).

## 2) Fázisonkénti szállítás

- **#11/1 Migráció + réteg.** 0009 (idempotens 2×, notify pgrst): 3-szint
  check + subtype-level constraint (altípus csak system szinten, ott
  kötelező), önhivatkozó parent_id fa, **moscow NULLABLE** (emberi ítélet),
  display_id unique/projekt (BR/SR/SYS/NFR/EP/US + sorszám). Tiszta lib:
  fa/lineage (kör-védett), display-id-képzés, származtatott jelzések,
  kötés-feloldók; defenzív LLM-parse. 20/20 egységteszt.
- **#11/2 LLM.** suggestRequirements (3-szintű fa; source_indices kötelező
  ahol alap van, TILOS kitalálni; **MoSCoW csak egyértelmű alappal**,
  egyébként null; stakeholder_names csak a megadott listából),
  suggestStories (covers_display_ids CSAK a system-listából — az irány
  kötött; N:M megengedett; **AC-t nem generál** — örökli), suggestAcDraft +
  suggestStoryDraft (űrlap-vázlat, DB-t nem ír). Mockok: 10-elemű fa 4
  kitöltetlen MoSCoW-val; story-csomag az átadott display_id-kból; üres
  alap → üres javaslat (c-minta).
- **#11/3 Akciók + BA-nézet.** Generálás CSAK üres készletre (őr:
  errAlreadyHasTree/Stories); E1 confirm/reject (csak ai_suggested
  törölhető); kézi felvétel (manual eredet, szülő kötelező nem-business
  szinten); AC-akciók a requirementen; kézi származtatás (fedés nélkül
  nincs story — errCoverRequired; csak system fedhető). Board: sötét topbar
  nézet-váltóval, lineage-sáv, 3 sáv + System F/NF split, ref-hű kártyák
  (MoSCoW-hierarchia, Won't áthúzva, „—" chip a kitöltetlenre, 👤 chip,
  ✓AC/●Nincs AC/◑story/○0 story), requirement-részlet (2. jelenet).
- **#11/4 Agile + story-részlet.** Epic-swimlane-ek, story-kártyák
  (Lefedi-chipek, örökölt-AC jelzés), „nincs lefedve — story származtatása"
  CTA; story-részlet a közös AC-vel (⤴ SYS-x) és a „Nem másolat" híddal.
- **#11/5 Nézet-váltó + kiemelés.** A kijelölés túléli a váltást, MINDKÉT
  irányból bejárható; Agile zárolt (🔒) system req nélkül; üres állapot
  CTA-kkal (8. jelenet). Fix: a ✦ vázlat-gomb formNoValidate (a required-
  validáció némán blokkolta a vázlat-akciót).

## 3) Kemény szabályok — igazolás

- **Közös AC, nem duplikátum:** 1. pont (DB-ből + egységtesztből igazolva).
- **Irány kötött (requirement → story):** a story-generálás fedés nélküli
  javaslatot eldob; a kézi származtatás covered nélkül hibát ad; a
  story-oldalon requirement-létrehozás nem létezik.
- **HITL + c-minta:** minden AI-kimenet ai_suggested → emberi megerősítés;
  a MoSCoW-t az AI alap nélkül nem tölti (mock: 4 „—" chip, tooltip:
  „emberi ítélet dönti el"); AC/story-vázlat csak űrlapot tölt, az ember ment.
- **Nem fabrikál:** ● Nincs AC / ○ 0 story / üres-sáv jelzések élnek; a
  jelzés-számok kizárólag a kötésekből számoltak.
- **Traceability:** [n] forrás-chipek a részleteken; 👤 stakeholder-kötés;
  ⤴ lineage mindenhol; N:M mindkét irányból.
- **Scope:** opció-összevető és P2 kapu-integráció NEM része (parkolva).

## 4) Verifikáció (lokális PG16 + PostgREST-shim + prod build + MOCK_LLM)

| Ellenőrzés | Eredmény |
|---|---|
| 0009 migráció 2× | exit 0, notify pgrst ✓ |
| Parse+model egységteszt (közös-AC azonosság is) | 20/20 ✓ |
| tsc strict / prod build / i18n:check | 0 hiba / zöld / 1307 kulcs HU=EN ✓ |
| 8. jelenet — üres állapot (zárolt Agile 🔒, sáv-CTA-k) | ✓ |
| 1. jelenet — ✦ AI-fa: 10 elem (BR-01…NFR-02), 4 „—" MoSCoW, 👤 chipek | ✓ |
| E1 — megerősítés/elvetés kártyán (req + story) | ✓ |
| 2. jelenet — részlet: meta, ● Nincs AC → ✦ vázlat → emberi mentés | ✓ |
| 3. jelenet — Agile: 2 epic · 4 story, US-02 Lefedi SYS-01+SYS-02 (N:M) | ✓ |
| 4. jelenet — story-részlet: mondat, N:M·2, KÖZÖS AC ⤴ SYS-01, híd | ✓ |
| 5. jelenet — kiemelés mindkét irányból (3 kiemelt/2 halvány; 2 élénk/9 halvány) | ✓ |
| 6. jelenet — közös AC két helyen | ✓ (DB: 1 rekord) |
| 7. jelenet — + Követelmény (SYS-04 manual) + származtatás (prefill + ✦ kitöltés → US-05) | ✓ |
| 0 backdrop-blur / 0 vízszintes túlcsordulás minden jeleneten | ✓ (egy 4px tranziens az oldalváltás-animáció alatt mérve; leülepedve 0) |

**FONTOS — valós LLM:** lokálisan nincs éles Anthropic-kulcs, a teljes
walkthrough MOCK_LLM-en futott. A generálás MINŐSÉGÉT (fa-szerkezet,
MoSCoW-visszafogottság, N:M csomagolás valós modellel) a **Preview-n kell
igazolni** — a promptok kényszerítik a szabályokat, de a valós kimenetet
nem tudtam itt lefuttatni.

## 5) Nálad zárandó (felhasználói teendő)

1. **Migráció:** `supabase/migrations/0009_requirements.sql` futtatása a
   Supabase SQL-editorban **a Preview előtt** (idempotens).
2. Preview-n valós láncból: P2 → Követelmények → ✦ AI-javaslat a TO-BE-ből
   → megerősítések → Agile-nézet → ✦ Story-k származtatása → nézet-váltó +
   kijelölés-kiemelés → egy AC felvétele egy system reqre → ellenőrzés,
   hogy a story-részleten ugyanaz az AC jelenik meg (közös AC).

## 6) Parkoló-lista

- Opció-összevető (külön csomag, a kiírás szerint).
- P2 kapu-integráció (követelmények a kapu-kritériumokban).
- AC szerkesztése/átrendezése (most: felvétel + törlés; a szerkesztés a
  requirement-oldalon bővíthető).
- Requirement szövegének utólagos szerkesztése (most: E1 confirm/reject +
  MoSCoW-állítás; szöveg-edit a #7a edit-mintájára bővíthető).
- Won't-requirementek szűrő-chipje (a ref Szűrő gombja most placeholder).
- Stakeholder-kötés kézi szerkesztése a részleten (most: generáláskor
  név-egyezésből).

## 7) Harness-jegyzet (nem repo-kód)

A lokális PostgREST-shim TABLES-whitelistje a 6 új táblával bővült
(scratchpad; éles Supabase-t nem érint). A demo-érintettek (3 stakeholder)
SQL-seeddel kerültek be a walkthrough-hoz — élesben a #8 modul E1 folyamata
hozza létre őket.

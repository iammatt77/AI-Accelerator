# Záró jelentés — #12 Megoldási opció-összevető modul (P2, ÚJ entitás)

**Dátum:** 2026-07-18 · **Branch:** dev · **Ref:** ref_opcio_osszevetp.html (5 jelenet)
**Commitok:** `#12/1` 0010 + entitásréteg (1efa778) · `#12/2` LLM (7973f5f) · `#12/3` akciók + áttekintő (4f345c3) · `#12/4` részlet + HITL (24f205e) · `#12/5` nav + verifikáció + jelentés (ez a commit)

A P2 utolsó hiányzó darabja: a jóváhagyott TO-BE folyamatra rétegzett
komponens-terv. Komponens (process / infrastructure / personnel) → opciók →
szempont-mátrix → EMBERI kiválasztás (HITL), forrásig visszavezethetően.
A modul a folyamattérképet NEM módosítja — csak hivatkozik rá.

---

## 0) Backend-ellenőrzés + A KÖTÉS MEGOLDÁSA (a csomag kritikus első lépése)

| Réteg | Állapot | Döntés |
|---|---|---|
| TO-BE gerinc | VOLT — process_maps (0008), a node-ok a jsonb-ben | a gerinc a JÓVÁHAGYOTT to_be térképből renderel |
| Fájdalompontok | VOLT (0004, E1) | a komponens/opció-javaslat kontextusa |
| E1 + c-minta | VOLT — entity_state enum | komponens: ai_suggested→confirmed/manual; opció: ai_recommended ✦ ≠ választás |
| Citáció | VOLT — input_items + [n] (lib/sources) | source_input_ids uuid[] a komponensen; a döntés-sor [n] chipekkel |
| LLM-csatorna | VOLT — lib/llm adapter + MOCK | 2 új fn ugyanazon az adapteren |
| Komponens-entitások | NEM VOLT | **0010**: solution_components, component_step_links, component_options |

**A legkényesebb pont — komponens ↔ TO-BE lépés kötés.** A TO-BE lépések a
`process_maps.nodes` jsonb elemei, NEM önálló sorok. A vizsgálat eredménye:
**a node-oknak VAN stabil `id`-juk** —
1. az LLM-parse (`parseProcessProposal`) minden node-nak id-t ad (`s1…sN`,
   duplikátum `_x`-szel dedupolva);
2. a chat-szerkesztő (`chat.ts`) a meglévő id-kat módosításnál/törlésnél
   MEGŐRZI, az új beszúrás `c1…cN` id-t kap;
3. az új verzió (`newProcessVersionAction`) a node-okat VÁLTOZATLANUL másolja
   (id-stul) — a node-id a verzió-emelést túléli.

**Ezért nem kellett elő-munka**: a kötés `component_step_links (component_id,
process_map_id, node_id text)` — a `node_id` a jsonb-n belüli stabil
azonosító, a `process_map_id` a provenance (melyik térkép-sor ellen jött
létre). A render a MINDENKORI jóváhagyott TO-BE (kind='to_be' AND
status='approved', legmagasabb verzió) node_id-jaira illeszt; az elárvult
kötés (a node már nincs a jóváhagyott térképen) egyszerűen nem illeszkedik —
nem dob hibát, nem fabrikál lépést. N:M: process-komponens pontosan 1 node,
infra több (vagy mind), personnel 0-1 — az akció-réteg kényszeríti.

## 1) Fázisonkénti szállítás

- **#12/1 Migráció + réteg.** 0010 (idempotens 2×, notify pgrst):
  solution_components (3 típus check, entity_state, source_input_ids uuid[]),
  component_step_links (PK component+node), component_options
  (criteria_values jsonb kulcs→{value,note,label}, ai_recommended,
  is_selected + selected_by/at + rationale; **komponensenként max EGY nyertes
  — részleges unique index, DB-szinten igazolva**: a második is_selected
  insert unique_violation). Tiszta lib (solution/model): gerinc-feloldás,
  dokk/lefedettség, szempont-készlet (alap + egyedi label-lel), nyertes,
  kész-számláló — 18/18 egységteszt.
- **#12/2 LLM.** suggestComponents (a TO-BE lépések STABIL node-id-kkal a
  promptban; szabály: process=1 lépés, infra=több/mind, personnel=0-1;
  TILOS komponenst kitalálni; nyertest NEM jelöl) + suggestOptions (2-3
  alternatíva; **ahol nincs alap egy szempont-értékre, a kulcs KIMARAD —
  üres cella; szám/ár/idő fabrikálás TILOS**; max egy recommended ✦ — az
  ajánlás sosem választás). Defenzív parse (10/10 teszt): típus-whitelist,
  kötés csak a megadott node-id-készletből, max-egy-recommended, koerció.
  Mockok az 5 jelenethez (3 típus, lefedettség, kihagyott cella).
- **#12/3 Akciók + Áttekintő.** Generálás CSAK üres készletre + CSAK
  jóváhagyott TO-BE-vel; E1 confirm/reject; kézi felvétel típusfüggő
  kötés-vezérlővel; SolutionBoard (1./5. jelenet): sötét topbar („TO-BE
  folyamat: jóváhagyva · v1" + ↗ Folyamattérkép), döntés-figyelmeztetés
  („addig nem véglegesíthető"), gerinc + dokkolt kártyák kötés-vonallal,
  üres dokk, infra-sáv (↕ kiszolgál: 01–02 / ↔ átfogó · minden lépés),
  személyi-sáv (nem lépéshez kötött / ↕ kötődik: 04), üres állapot CTA-kkal.
  Jóváhagyott TO-BE nélkül poka-yoke zárt lap a Folyamattérképre irányítva.
- **#12/4 Részlet + HITL.** Breadcrumb + „Köti: TO-BE 02"; folyamat-komp. →
  TELJES mátrix (érték-pillek a ref színnyelvtanával + jegyzet, üres cella
  „— nincs megadva", nyertes oszlop ✓ KIVÁLASZTVA kiemelés, ✦ AI ajánlja,
  „+ szempont" opciónkénti értékekkel — érték nélkül nem vesz fel sort,
  indoklás-sor); infra → lefedettség-viz (✓ a fedett lépéseken); személyi →
  ∞ doboz; HITL: ELŐTTE az AI ajánl, de „a rendszer nem választ helyetted —
  a gomb a tiéd" (ki választ + indoklás + emberi gomb), UTÁNA monogram +
  „Rögzítette {név} · {dátum} · a döntés emberi" + egyezik-e az
  AI-ajánlással + [n] forrás-chipek + „Választás módosítása".
- **#12/5 Nav + verifikáció.** Projekt-nav „Megoldás-terv" belépő; teljes
  lokális walkthrough + jelentés.

## 2) Kemény szabályok — igazolás

- **A folyamattérkép érintetlen:** a modul csak SELECT-tel olvassa a
  process_maps-t; egyetlen write sincs rá.
- **HITL:** a generálás SOHA nem ír is_selected-et (DB-ből igazolva: 3
  generált opciónál is_selected=false, csak ai_recommended=✦); a nyertest a
  selectOptionAction rögzíti emberi gombnyomásra — ki/mikor/indoklás.
- **c-minta:** a mock Hibrid opció „Szállítói függőség" cellája üres →
  „— nincs megadva" renderel (screenshot); kézi opciónál az üres mező
  kimarad; „+ szempont" érték nélkül elutasítva.
- **Traceability:** a döntés-sor a komponens source_input_ids-éből képzett
  kanonikus [n] chipeket mutatja („Visszavezethető: [1] Workshop-jegyzet");
  selected_by + selected_at a DB-ben.
- **Scope tartva:** P2 kapu-integráció NEM része (a státusz-sor csak jelzi
  a „N/M kész" állapotot); opció-szerkesztés/törlés parkolva.

## 3) Verifikáció (lokális PG16 + PostgREST-shim + prod build + MOCK_LLM + Playwright)

| Ellenőrzés | Eredmény |
|---|---|
| 0010 migráció 2× + dupla-nyertes elutasítás | exit 0, idempotens; unique_violation ✓ |
| Egységtesztek (model 18 + parse 10) | 28/28 ✓ |
| tsc strict / prod build / i18n:check | 0 hiba / zöld / **1429 kulcs HU=EN** ✓ |
| 5. jelenet — üres állapot (gerinc + üres dokkok + CTA-k) | ✓ |
| ✦ komponens-generálás: 6 komponens (2 process dokk, infra 01–02 + átfogó, személyi ∞ + kötődik: 04), E1 jelvények | ✓ |
| 1. jelenet — figyelmeztetés „0/6 … addig nem véglegesíthető" + ✦ 6 AI-javaslatból | ✓ |
| 2. jelenet — mátrix: 3 oszlop, érték-pillek + jegyzetek, üres cella „nincs megadva", egyedi „Szállítói függőség", + szempont, indoklás-sor | ✓ |
| 4. jelenet — HITL előtte („a rendszer nem választ helyetted") → kiválasztás → utána (rögzítve, egyezik az AI-ajánlással, [1] forrás-chip) | ✓ |
| **DB-igazolás:** is_selected=t + selected_by='Kovács Bálint' + selected_at + rationale; 10 kötés a jóváhagyott térkép stabil node-id-jain (1+1 process, 2+5 infra, 0+1 személyi) | ✓ |
| 3. jelenet — infra lefedettség-viz (01✓ 02✓, 03 nem), személyi ∞ doboz | ✓ |
| E1 megerősítés (✦ 6→5, DB: confirmed) | ✓ |
| Poka-yoke: jóváhagyott TO-BE nélkül zárt lap + irányítás | ✓ |
| Áttekintő státusz-frissülés (1/6 kész, ✓ Hibrid chip a kártyán) | ✓ |
| Nav-belépő („Megoldás-terv") | ✓ |
| 0 backdrop-blur / 0 vízszintes túlcsordulás minden nézeten | ✓ |
| Konzol-hibák | ✓ nincs |

Screenshotok (scratchpad): s12-empty, s12-overview, s12-matrix, s12-decided,
s12-infra, s12-personnel, s12-gate.

**FONTOS — valós LLM:** lokálisan nincs éles Anthropic-kulcs, a teljes
walkthrough **MOCK_LLM-en** futott. A generálás MINŐSÉGÉT (komponens-készlet
relevanciája, node-kötések helyessége, szempont-értékek c-minta fegyelme
valós modellel) a **Preview-n kell igazolni** — a promptok kényszerítik a
szabályokat (stabil node-id-lista, tilos fabrikálni, max egy ✦), de a valós
kimenetet itt nem tudtam lefuttatni.

## 4) Nálad zárandó (felhasználói teendő)

1. **Migráció:** `supabase/migrations/0010_solution_components.sql` futtatása
   a Supabase SQL-editorban **a Preview előtt** (idempotens).
2. Preview-n valós láncból: jóváhagyott TO-BE → Megoldás-terv → ✦
   komponens-generálás → egy folyamat-komponensen ✦ opció-javaslat →
   összevetés a mátrixban → HITL-kiválasztás (név + indoklás) → a nyertes
   rögzül (ki/mikor), forrásig visszavezethető; infra-lefedettség és
   személyi ∞ eset ellenőrzése.

## 5) Parkoló-lista

- P2 kapu-integráció (kész megoldás-terv a kapu-kritériumokban) — a kiírás
  szerint kizárva.
- Opció szerkesztése/törlése; komponens szerkesztése/kötés-módosítás a
  részleten (most: felvételkor kötünk).
- Egyedi szempont + jegyzet a kézi opció-űrlapon (most: alap-szempont
  értékek; egyedi szempont a „+ szempont"-tal).
- Megoldás-terv export (md) a tár-mintára.
- Komponens-sorrend kézi rendezése.

## 6) Harness-jegyzet (nem repo-kód)

A lokális PostgREST-shim a session-váltás miatt újraépült (scratchpad,
generikus: eq/order/limit, insert/patch/delete, jsonb + tömb bind,
single/maybeSingle PGRST116-tal); a TABLES-whitelist a 3 új táblával bővült.
A demo-adat (EcoSupport AI projekt, 2 forrás, 2 fájdalompont, jóváhagyott
TO-BE 5 stabil node-iddal) SQL-seeddel került be. `.env.local` törölve, a
stack leállítva.

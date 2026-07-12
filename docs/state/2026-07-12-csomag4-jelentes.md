# Záró jelentés — Coding-csomag #4: Váz + állapotgép (2026-07-12)

Spec: AICON_Coding_csomag_4_Vaz_allapotgep_v0_1 (Approved). Branch: `dev`.
Épít a #3 rétegeire (tokenek, i18n, seed); a governing spec §11 kapu-térképét
és a Melléklet A átmenet-tábláját implementálja.

## 1. Leszállított lépések (commit-bontás)

| Lépés | Commit | Tartalom |
| --- | --- | --- |
| 1. Migráció | `79b82a8` | `supabase/migrations/0002_phase_state_machine.sql` — `phase_state` enum + élő szöveg-értékek átképezése + `cycle_count` + unique(project_id, phase) + CHECK + tranzakciós `close_gate()` fn + `notify pgrst` |
| 2. Állapotgép | `e83fa4f` | `src/lib/phases/{config,machine,service}.ts` + `src/app/phase-actions.ts` — kritérium-konfig, átmenet-tábla (pivot definiálva, NEM bekötve), olvasáskori szinkron, FormState-akciók |
| 3. Nav-váz | `1bb8a3b` | Oldalsáv: Vezérlőpult · Ügyfelek · Projektek (valós) + Beérkező/Könyvtár/Beállítások („hamarosan"); Dashboard-, projekt-lista-, ügyfél-oldalak |
| 4. Pilótafülke | `ed671b1` | Fülke-nézet: V1 gerinc-stepper (5-állapotú vizuális lexikon, mindig ikon+szöveg), „Következő legjobb lépés" (számított), stat-chipek, friss artefaktumok (max 3), kapu-checklist, projekt-meta |
| 5. Fázis-oldalak | `120bc52` | ×7 állapotfüggő oldal: V2 kompakt stepper, ①–③ címkézett placeholder, ④ MŰKÖDŐ kapu (kritérium-checklist, zárás-flow, Decision-napló), zárt nézet, P6 „nincs kapu" |
| 6. Kísérők | `c57f9b3` | `scripts/reset-demo.sql` (idempotens, böngészőből futtatható) + `scripts/seed.ts` élő fix UUID-kra és enum-állapotokra igazítva |
| 7. Önellenőrzés | (ez a commit) | review-javítások + záró jelentés |

## 2. Önellenőrzés eredményei

Az éles Supabase (Frankfurt) ebből a munkakörnyezetből nem érhető el, ezért
minden bizonyíték a #3-ban felállított **lokális, eldobható stack** ellen
készült: natív PostgreSQL 16 + `0001_init.sql` + `0002_phase_state_machine.sql`
+ PostgREST-kompatibilis minimál-shim (v2: RPC, PATCH+RETURNING, in./limit
szűrők, count-embed) + valós Next.js dev-szerver + Playwright-vezérelt
Chromium.

### Migráció-teszt — az ÉLŐ értékekről indulva

A lokális DB-t az élő állapot pontos másával töltöttük fel (szöveges
`state` oszlop: `completed` / `in_progress` / `not_started` + egy szemetes
érték), majd a 0002-t **egyben** lefuttattuk:

- Átképezés: `completed→completed` · `in_progress→in_progress` ·
  `not_started→locked` · ismeretlen szöveg→`locked` — adatvesztés nélkül.
- Újrafuttatás (idempotencia): a DO-blokkos enum-létrehozás és a feltételes
  oszlop-konverzió miatt a második futás nem hibázik és nem ront el semmit.
- `close_gate()` minden ága bizonyítva: sikeres zárás (completed + következő
  fázis locked→open + Decision-sor egy tranzakcióban), zárt fázis zárása →
  `invalid_transition` hiba, P6 zárása → elutasítás, üres indoklás →
  `note_required`.

### P0→P6 walkthrough — valós böngészővel (33/33 PASS)

`node walkthrough.mjs` (Playwright + Chromium, a seedelt demo-projekten,
alapállapotról indítva):

- **Fülke alapállapot:** „1/7 lezárva", P0 Lezárva, P1 AKTÍV badge,
  „Következő legjobb lépés" = P1 ideiglenes zárás, stat-chipek élő számokkal.
- **P0 (completed):** olvasó nézet + a seedelt kapu-döntés szövege szó
  szerint megjelenik.
- **P2 (locked):** lakat-nézet magyarázattal + „Ugrás: P1" link; zárás-űrlap
  nem elérhető.
- **P1 zárás:** „ideiglenes kézi lezárás" badge; indoklás + megerősítő
  jelölő után completed.
- **Érvénytelen átmenet:** egy második (stale) lapról újra beküldött zárás
  `role="alert"` üzenetet ad („Érvénytelen fázis-átmenet — az állapot
  időközben változhatott…"), **nem 500-at**.
- **Lánc P2→P5:** locked→open automatikus (előző completed) → „Fázis
  indítása" → in_progress → zárás → completed, mind a négy fázison.
- **P6:** P5 zárása után nyitott → indítható → „Ciklikus fázis — nincs
  kapu" nézet, zárás-űrlap nélkül.
- **Fülke végállapot:** „6/7 lezárva", P6 ciklikus következő lépés.

Minden zárás Decision-sort írt: a lánc után 6 `gate_close` sor (1 seedelt +
5 walkthrough, mind `[ideiglenes kézi lezárás] P<n> — …` prefixszel).

### P0 puha kapu — élő kiértékelés mindkét irányban

- P0 `in_progress`-re állítva (charter `approved` a DB-ben) → az oldal
  betöltésekor **gate_pending**, a pill „Döntés vár" (borostyán).
- Charter `draft`-ra állítva → visszaáll **in_progress** („Folyamatban").
- Az állapot-szinkron a DB-be is visszaíródik (optimista guarddal).

### Defenzív degradáció

A `state` oszlopot ideiglenesen text-re állítva és egy fázisnak
`totally_unknown_state` értéket adva: a fázis-oldal és a fülke egyaránt
**HTTP 200**, a fázis zárt (locked) nézetben renderel, nincs törés. Az
optimista guard miatt a gyógyító-írás 0 sort érint (nem korrumpál).

### reset-demo.sql — kétszeri futtatás

| Ellenőrzés | 1. futás | 2. futás |
| --- | --- | --- |
| P0 | completed | completed |
| P1 | in_progress | in_progress |
| P2–P6 | locked (5 sor) | locked (5 sor) |
| cycle_count | mind 1 | mind 1 |
| gate_close döntések törölve | 6 (a seedelt f0…001 marad) | 0 (nincs mit) |

### Build + i18n

- `npm run build`: **zöld** (TypeScript 0 hiba, 10 route).
- `npm run i18n:check`: **üres diff** — „166 kulcs, mindkét nyelven azonos
  készlet".

### Review-workflow (többlencsés, adverszáriális ellenőrzéssel)

6 független review-lencse (állapotgép-korrektség · SQL/migráció-biztonság ·
server actionök/hibakezelés · UI/design-törvények/i18n · adat-integritás ·
regresszió #1–#3 ellen) futott a `0e61f46..HEAD` tartomány felett, minden
leletet külön adverszáriális ellenőrző vizsgált (cáfolásra utasítva). Az
utolsó 5 ellenőrző-futást a havi költségkeret elérése megszakította — az
érintett 4 leletet kézzel, a kód alapján ítéltük meg, azonos mércével.

**11 lelet → 6 megerősítve és javítva, 5 elvetve.** A javítások:

| # | Súly | Lelet | Javítás |
| --- | --- | --- | --- |
| 1 | magas | Beágyazott `<a>`: a dashboard-kártya (Link) interaktív V2 steppert renderelt → hydration-hiba + törött kattintási zóna | `interactive={false}` a fülke-kártyán (`src/app/page.tsx`) |
| 2 | közepes | A kapu-zárás űrlap hibaágon törölte a beírt indoklást (React 19 form-reset; a values/nonce minta hiányzott) | `closeGate` minden hibaága `values.reason` + `nonce`-t ad vissza; a textarea `key`+`defaultValue`-val áll helyre. A megerősítő jelölő szándékosan NEM áll vissza (hiba után újra meg kell erősíteni) |
| 3 | közepes | Fülke kapu-checklist: fázis-állapot és kritérium-státusz csak ikonnal (4. törvény sértés) | Állapot-szöveg (`phases.lexicon`) + „teljesül/nem teljesül" felirat a fülke-checklistben is |
| 4 | közepes | `createClientAndProject` nem ellenőrizte a 7 fázis-sor insertjének hibáját → néma zsákutca-projekt | Hiba-ellenőrzés + fordított hibaüzenet (`errors.phaseActionFailed`) |
| 5 | alacsony | `closeGate` elő-validálása elnyelte a SELECT-hibát → DB-hiba „érvénytelen átmenet"-ként jelent meg, log nélkül | Az olvasási hiba külön ágon, valódi okkal (`phaseActionFailed`) + szerver-log |
| 6 | alacsony | Kritérium-kiértékelési HIBA tartós gate_pending→in_progress visszaminősítést írt a DB-be | A kiértékelő `null`-t ad hibánál; degradált körben nincs tartós állapot-írás (kijelzés: nem teljesül) |

Elvetett leletek (az ellenőrzők cáfolták): a `charter_approved` kritérium
app-flow-ból való kielégíthetetlensége (spec-konform — a valódi charter-
artefaktum a későbbi csomagok scope-ja, a P0 kapu kézzel zárható); a
seed/reset élő UUID-eltérés gyanúja (a Melléklet B szerinti élő azonosítók
a mérvadók); P0-locked zsákutka (élő adaton nem elérhető állapot; az
`ensurePhaseRows` P0-t open-ként pótolja); duplikált beágyazott-anchor
lelet (az 1. javítás lefedi).

A javítások után: build zöld, i18n:check zöld, a teljes walkthrough
újrafuttatva **33/33 PASS** (az új ellenőrzéssel együtt: hibaágon az
indoklás a mezőben marad).

## 3. Kezelt eltérések

- **PostgREST-shim:** a hivatalos PostgREST bináris/csomag letöltését a
  környezet hálózati szabályzata blokkolja → a #3-as shim v2-re bővítve
  (RPC `close_gate`, PATCH+RETURNING, `in.()`/`limit`, embed-count). A
  jelentésben dokumentált helyettesítő; a repóba nem került be.
- **Walkthrough-szkript:** a Next.js route-announcer szintén `role="alert"`
  — a teszt-szelektort szöveg-egyezésre pontosítottuk (harness-oldali
  javítás, nem alkalmazás-hiba).

## 4. Parkoló-lista (nem e csomag scope-ja)

- Pivot-hurok (P6 completed→in_progress) bekötése — #9 csomag aktiválja
  (a definíció és a `PIVOT_LOOP_ENABLED` kapcsoló készen áll).
- ①–③ zónák valós munkaeszközei — következő csomagok.
- Valódi kilépő kritériumok P1–P5-re (a `manual_close` ideiglenes).
- Decision↔fázis kapcsolat sémaszintű (oszloppal) — most note-prefix
  konvenció.
- RLS-szabályzatok (jelenleg service-role, egyfelhasználós).

## 5. Nálad zárandó (Máté)

1. **A 0002 migráció lefuttatása az éles Supabase-en** — a
   `supabase/migrations/0002_phase_state_machine.sql` teljes tartalmát
   **egyben** beillesztve a Supabase SQL-editorba, **MIELŐTT** a Preview-t
   tesztelnéd (enélkül az app hibázik az új oszlopok/fn hiányán).
2. **Walkthrough-teszt a Preview-n:** fülke → P1 zárás (indoklással) → P2
   nyílik → indítás → zárás → … → P6 („ciklikus fázis — nincs kapu");
   közben a Decision-napló töltődik.
3. **Ismételt teszthez:** a `scripts/reset-demo.sql` tartalmát a Supabase
   SQL-editorba illesztve a demo-projekt bármikor visszaáll az
   alapállapotra (P0 lezárva · P1 folyamatban · P2–P6 zárt; a
   teszt-döntések törlődnek, a seedelt megmarad).

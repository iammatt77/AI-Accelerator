# Záró jelentés — Coding-csomag #5a: Generálási motor v2 (2026-07-13)

Spec: AICON_Coding_csomag_5a_Generalasi_motor_v2 (Approved). Branch: `dev`.
A rendszer AI-magja: nyers input → kivonatolás strukturált mezőkbe (emberi
megerősítéssel, E1) → sablon-vezérelt draft-generálás forráshivatkozással →
Draft → In review → Approved lánc verseny-biztos verziózással. A
Projektdokumentáció tár + export a #5b csomag — itt nem épült.

## 1. Leszállított lépések (commit-bontás)

| Lépés | Commit | Tartalom |
| --- | --- | --- |
| 1. Migráció | `381bf22` | `supabase/migrations/0003_generation_engine.sql` — `artifacts.fields jsonb` + `updated_at` + unique(project_id, type, version) beszédes duplikátum-őrrel + `input_items.phase` + a seedelt charter mező-backfillje (csak üres fields-re) + `notify pgrst` |
| 2. Típus-konfig | `ed49bc0` | `src/lib/artifacts/config.ts` — típusdefiníció-séma (mezőséma + body-sablon) + Projekt-charter referencia (5 kötelező + 1 opcionális mező) + defenzív `parseArtifactFields` + teljesség/approve-segédek |
| 3. LLM-réteg | `6371ad6` | `src/lib/llm/index.ts` — `extract(sources, typeDef)` (explicit hallucináció-tiltás, csak-JSON, fence-parse-védelem) + `generateBody(confirmedFields, sources, typeDef)` ([n] csak a megadott számozásból; kimenet magyar) + `MOCK_LLM=1` determinisztikus fixture |
| 4. Zónák | `b9ea079` | ① bemenet-lista + hozzáadás fázis-címkével · ② kivonatolás + E1 mező-megerősítő kártyák (megerősít/szerkeszt/elvet) · ③ kimenet (státusz-pill + generálás + szerkesztő-belépés); a cockpit régi „Input & generation" blokkja kivezetve → munkaterület-CTA |
| 5. Szerkesztő | `38aa521` | Split-view (design 1f): összecsukható mező-panel (állapot ikon+szöveggel, teljesség-pill) + draft-body szerkesztés (`updated_at`) + számozott források + kattintható `[n]` citációk (kiemelés + odagörgetés); Approved: immutábilis olvasó nézet |
| 6. Státusz-lánc | `f5c0a12` | Draft→In review→Approved (nem átugorható); kemény approve-blokk hibalistával; ai_filled borostyán figyelmeztetés (nem blokkol); „Új verzió" `new_artifact_version()` RPC-vel (DB-oldali max+1 + unique-védelem); seed.ts charter-fields |
| 7. Önellenőrzés | (ez a commit) | review-javítások + záró jelentés |

## 2. Új típus felvétele (F2 — dokumentált hogyan)

Új artefaktum-típus = **konfig-bejegyzés, nem motorkód**:

1. `src/lib/artifacts/config.ts`: új `ArtifactTypeDef` objektum az
   `ARTIFACT_TYPES` tömbben — `key` (== a DB `artifacts.type` értéke),
   fázis-kötés, mezőlista (`key`, i18n `labelKey`, `required`,
   `promptHint`), body-sablon (átfogó instrukció + szekció-váz).
2. `messages/hu.json` + `en.json`: a mező-labelek felvétele a `fields`
   névtérbe (+ a típusnév az `artifactTypes` névtérbe).
3. Kész. A motor (extract → megerősítés → generálás → státuszlánc →
   szerkesztő) típus-agnosztikus; a ②–③ zóna a fázis-kötés alapján
   automatikusan felveszi az új típust.

## 3. Önellenőrzés eredményei

Az éles Supabase ebből a munkakörnyezetből nem érhető el, ezért minden
bizonyíték a lokális, eldobható stacken készült: PostgreSQL 16 +
0001+0002+0003 migrációk + PostgREST-kompatibilis minimál-shim (v3: a
`new_artifact_version` RPC-vel és a `.single()` objektum-válasszal
bővítve) + Next.js dev-szerver `MOCK_LLM=1` fixture-móddal + Playwright-
vezérelt Chromium. **Az élő LLM-hívás minőségét a sandbox nem tudja
verifikálni — az a Preview-teszt része (5. szakasz).**

### 0003 migráció — lokális futtatás a #4 utáni sémán

- Kétszeri futtatás: a második kör `IF NOT EXISTS`/`create or replace`
  ágakon fut végig, hiba és adatrontás nélkül; a backfill `UPDATE 1`
  után másodszor `UPDATE 0` (csak üres fields-re ír).
- Backfill-értékek psql-lel ellenőrizve: mind az 5 kötelező mező
  `confirmed`, `source_indices: []`, a Melléklet A szerinti értékekkel.
- Régi bemenetek: `phase = NULL` (3/3 sor), az oszlop hozzáadása nem
  érintette az adatot.
- Duplikátum-őr tesztelve: mesterséges (project, type, version)-ütközés
  mellett a migráció beszédes hibával áll le (felsorolja az ütköző
  sorokat), az ütközés feloldása után zöld.
- `new_artifact_version()`: csak `approved` forrásból klónoz; a
  verseny-teszt eredményét lásd lent.

### Teljes lánc — valós böngészővel, fixture-móddal (35/35 PASS)

`node walkthrough5a.mjs` (Playwright + Chromium, a UI-ból létrehozott
FRISS projekten):

- **Cockpit-blokkcsere:** a régi „Bemenet & generálás" blokk nincs többé;
  a munkaterület-CTA a P0-ra visz.
- **① Bemenet:** két input hozzáadva címmel — mindkettő `P0`
  fázis-címkét kapott, a lista számozva ([1], [2]).
- **② Kivonatolás (E1):** a fixture 4 mezőre ad AI-javaslatot
  forrás-jelöléssel; a szponzor **missing marad** (a hiányzó adat nem
  hiba); az érvénytelen forrás-index (fixture [3], 2 forrás mellett)
  kiszűrve; extract után **nincs confirmed mező** — megerősítés nélkül
  nincs confirmed (E1-hűség bizonyítva); teljesség 4/5.
- **Megerősítés:** mind a 4 javaslat kártyánként megerősítve →
  „megerősítve" állapot ikon+szöveggel.
- **③ Generálás:** a megerősített mezőkből sablon-vezérelt body készül
  (## szekció-váz), Draft · v1 pill.
- **Szerkesztő (1f):** mező-panel teljesség-pillel; **kattintható [n]
  citáció**: az [1] jelölőre kattintva pontosan egy forrás emelődik ki,
  és az a helyes ([1] Interjú-jegyzet); body szerkesztve és mentve.
- **Lánc:** Review-ra küldés → In review; **Approve-kísérlet hiányzó
  kötelező mezővel → kemény blokk**, a hibalista a Szponzort nevezi meg
  (`role="alert"`, nem 500); vissza draftba → szponzor kézi pótlása
  („kézi" állapot, 5/5) → újra review → **Approve** → Approved pill,
  a body **immutábilis** (nincs textarea, „Csak olvasható").
- **Új verzió:** version+1 (v2) draft-klón nyílik meg, a mezők (5/5) és
  a szerkesztett body átvéve.
- **#4-integráció:** az approved charter (v1) zöldíti a P0
  `charter_approved` kritériumot → a fázis-oldal „Döntés vár"
  (gate_pending) állapotot mutat — a kapu-logika változatlanul él.

Decision-napló a lánc után (psql): `create_project` → 2× `add_input`
(fázis-jelöléssel) → `extract` → `generate_draft` → `edit_draft` → 3×
`status_change` → `approve_artifact` → `new_version` — minden lépés
naplózott.

### Verseny-teszt — két párhuzamos „Új verzió"

Két konkurens `new_artifact_version` RPC-hívás ugyanarra az approved
artefaktumra: **az egyik sikerrel** létrehozta a v3 draftot, **a másik
23505** (unique-ütközés) hibát kapott, amelyet az action graceful
FormState-hibává képez („Verzió-ütközés…"). Duplikált verziószám nem
jött létre (psql-lel ellenőrizve: v1 approved · v2 draft · v3 draft).

### Seed — kétszeri futtatás

`npm run seed` kétszer: rekordszámok változatlanok (1/1/7/3/1/1), a
charter `fields` a backfill-értékekkel, duplikáció nélkül.

### Build + i18n

- `npm run build`: **zöld** (TS strict 0 hiba, 11 route — az új
  szerkesztő-útvonallal).
- `npm run i18n:check`: **üres diff** — „244 kulcs, mindkét nyelven
  azonos készlet".

### Review-workflow (többlencsés, adverszáriális ellenőrzéssel)

<!-- REVIEW_SECTION -->

## 4. Kezelt eltérések

- **Workflow-futtató:** a session konténer-újraindításai miatt a
  workflow-orchesztrátor nem indult el — a 6 lencsés review és az
  adverszáriális ellenőrzés párhuzamos al-ügynökökkel futott, azonos
  metodikával.
- **Shim v3:** a lokális PostgREST-helyettesítő a `.single()`
  objektum-válasszal és a `new_artifact_version` RPC-vel bővült (a
  jelentésben dokumentált helyettesítő; nem repo-tartalom).
- **Régi `p0_summary` artefaktumok (élő adat, #1-örökség):** a
  szerkesztő típusdefiníció nélkül is megnyitja őket (mező-panel
  helyett jelzés) — nem törnek.

## 5. Parkoló-lista (nem e csomag scope-ja)

- Mező-szintű minőségi értékelés (most: meglét-check — session-döntés
  szerint tudatosan halasztva).
- Karakter-szintű citation-szemcsézet (v1: input-item szint).
- Markdown-renderelés a szerkesztő olvasó nézetében (most: formázatlan
  szöveg kattintható [n]-ekkel; új runtime-függőség tilos volt).
- A fields jsonb mező-műveletei nem tranzakcionálisak
  (read-modify-write) — egyfelhasználós rendszerben elfogadott; több
  felhasználónál DB-oldali mező-RPC kell.
- Kapu vs. verziók finomítás (bármely approved verzió zöldít — v1-döntés,
  a spec nyitott kérdése).
- `input_items.phase` CHECK-kényszer (most szabad szöveg, a UI csak
  érvényes fáziskódot ír).

## 6. Nálad zárandó (Máté)

1. **A 0003 migráció lefuttatása az éles Supabase-en** — a
   `supabase/migrations/0003_generation_engine.sql` teljes tartalmát
   **egyben** a SQL-editorba illesztve, **MIELŐTT** a Preview-t
   tesztelnéd (enélkül az app az új oszlopok/függvény hiányán hibázik).
2. **Élő LLM-teszt a Preview-n** — a sandbox fixture-rel tesztelt; az
   éles Anthropic-hívást te verifikálod: a P0 munkaterületen valós
   szöveggel futtass kivonatolást (② Feldolgozás) és generálást (③
   Draft generálása), és nézd meg a mezőjavaslatok + a [n] hivatkozások
   minőségét.
3. **A lánc végigjátszása a felületen** — input hozzáadás → extract →
   mező-megerősítés → generálás → szerkesztő → Review-ra küldés →
   Approve (próbáld ki hiányzó kötelező mezővel is: blokkolnia kell) →
   Új verzió.

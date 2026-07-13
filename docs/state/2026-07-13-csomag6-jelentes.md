# Záró jelentés — Coding-csomag #6: Deliverable-térkép P0–P6 + valós kapuk (2026-07-13)

Spec: AICON_Coding_csomag_6 (Approved). Branch: `dev`. Migráció NINCS —
a csomag konfiguráció + a kapu-kritériumok bekötése; Máténak nincs
SQL-teendője.

## 1. Audit-eredmény (0. lépés)

- A fázis-oldal **② és ③ zónája** és a **tár** valóban konfig-vezérelt
  (`typesForPhase` iteráció) — charter-hardcode a megjelenítő rétegben
  NINCS; a 17 új típus kód-módosítás nélkül jelent meg bennük.
- Charter-hivatkozás három helyen él, mindhárom spec-konform: a
  típusdefiníció maga; a P0 `charter_approved` puha kritérium (változatlan
  marad); a kritérium-kiértékelő defenzív `project_charter` alias-a.
- Egy valós UI-hiányt tárt fel az audit: a ② zóna blokkjai TÍPUSNÉV
  nélkül jelentek meg — egytípusos fázisnál láthatatlan hiány, többtípusos
  fázisnál a kivonatolás-gombok megkülönböztethetetlenek. **Feloldva**:
  minden ②-blokk állandó, lokalizált típusnév-fejlécet kapott.
- Az `artifacts/config → phases/config` visszahivatkozás **type-only**
  import, így a kritérium-származtatás (phases/config → artifacts/config
  runtime-import) körkörösség nélkül működik.

## 2. Leszállított lépések (commit-bontás)

| Lépés | Commit | Tartalom |
| --- | --- | --- |
| 1. Típus-konfig | `6272e35` | 17 új deliverable-típus a Melléklet A szerinti mezősémákkal + kapu-hordozó (`gate`) jelölés + generikus body-sablon szabály (`resolveTemplate`: bevezető + mezők sorrendben) + i18n (17 típusnév + minden mezőcímke HU/EN) |
| 2. Kapu-kritériumok | `b0ca908` | P1–P5 kritériumai a típus-konfigból SZÁRMAZNAK (kritériumonként egy [K] deliverable Approved-ja; auto, KEMÉNY; bármely approved verzió — #5a v1-döntés); P3–P5 `interim` jelöléssel; ideiglenes kézi zárás KI; app-szintű zárás-őr a `closeGate`-ben a hiányzó deliverable-ök lokalizált nevével; egy-lekérdezéses kiértékelés; többkritériumos checklist UI interim-badge-dzsel |
| 3. Fixture | `56a53f2` | MOCK_LLM típus-agnosztikusan: bármely típus mezői determinisztikus értéket kapnak [1] forrás-indexszel; a charter-fixture speciális marad (missing + all-invalid demonstráció) |
| 4. ② fejléc | `e8de94b` | Az audit-lelet feloldása: állandó típusnév-fejléc a ② zóna blokkjain |
| 5. Önellenőrzés | (ez a commit) | review + záró jelentés |

**reset-demo.sql (spec 4. lépés):** a követelmény (nem-seedelt artifacts +
input_items + decisions törlése, idempotencia) a **#5a review-javításában
már teljesült** — változtatás nem kellett; kétszeri futtatással újra
bizonyítva (lásd 3. szakasz).

**Rétegzés (dokumentálva a spec kérésére):** a kapu-kritérium őre
APP-SZINTEN él (`closeGate` server action: kiértékelés → elutasítás a
hiányzó deliverable-ök lokalizált nevével); a `close_gate()` DB-függvény
változatlanul az ÁLLAPOT-ÁTMENET tranzakcionális őre (P(n) zárás + P(n+1)
nyitás + Decision egyben). A kritérium-tudás TS-konfigban él, a DB nem
ismeri — új típus felvétele továbbra sem igényel SQL-t.

## 3. Önellenőrzés eredményei

Lokális stack (PostgreSQL 16 + PostgREST-shim + Next.js dev `MOCK_LLM=1` +
Playwright/Chromium); az éles Supabase a sandboxból nem érhető el.

### Teljes P0→P6 walkthrough (41/41 PASS)

`node walkthrough6.mjs` — friss projekten; a deliverable-láncok UI-ját a
P0–P2 fázisokon end-to-end, a P3–P5 kapu-viselkedését DB-szintű
approvalokkal (a lánc UI-mechanikája azonos, a P1–P2 bizonyítja):

- **Tár:** friss projekten mind a **18 deliverable placeholder-sora**
  látszik a teljes P0–P6 térképen; üres-fázis szöveg nincs többé; a lánc
  után az approved sorok teljesség-pillel (shortlist 3/3).
- **③/② több típus fázisonként:** P0 3, P2 4 típus-kártya; a ②-blokkok
  típusnév-fejléccel.
- **P0 (változatlan, PUHA):** a kapu deliverable nélkül is zárható.
- **P1 (valós kapu):** a checklist a „Priorizált use case-shortlist
  jóváhagyva (Approved)" kritériumot mutatja; az „ideiglenes kézi
  lezárás" eltűnt; **NEGATÍV: korai zárás elutasítva a hiányzó shortlist
  nevével**; teljes lánc (extract → generikus fixture minden mezőre [1]
  forrással → megerősítés → generálás → review → approve) → **AUTO
  gate_pending** → zárás → Lezárva.
- **P2 (két [K]):** checklist két kritériummal; Business case approve
  után **NEGATÍV: zárás elutasítva, a hibalista CSAK a hiányzó
  Pilot-tervet nevezi meg**; **Pilot-terv poka-yoke:** a baseline /
  számszerű küszöb / döntési szabály mezők elvetése után az approve-blokk
  mindhárom hiányzó mezőt felsorolja; kézi pótlás után approve → mindkét
  [K] approved → AUTO gate_pending → zárás.
- **P3 (interim):** a kritériumokon **interim-badge**; 1/2 után vegyes
  teljesül/nem teljesül; 2/2 után gate_pending → zárás.
- **P4:** egyetlen [K] approve → gate_pending → zárás.
- **P5:** **NEGATÍV: csak Rollout-terv mellett a zárás a hiányzó
  Impact-riportot nevezi meg**; mindkettő után zárás.
- **P6:** nincs kapu (változatlan).

### Fixture ≥3 típuson

A generikus fixture a walkthrough-ban 3 típuson futott end-to-end UI-val
(shortlist, Business case, Pilot-terv) + a charter speciális fixture-e —
mind determinisztikus, [1] forrás-indexszel, sablon-hű mintabody-val.

### reset-demo.sql — kétszeri futtatás

Kétszer futtatva zöld; a demo-projekt a seed-alapállapotra áll vissza
(artifacts=1: a seedelt charter), a teszt-artefaktumok eltűnnek.

### Build + i18n

- `npm run build`: **zöld** (TS strict 0 hiba).
- `npm run i18n:check`: **üres diff** — 357 kulcs, mindkét nyelven azonos
  készlet.

### Review (többlencsés, adverszáriális ellenőrzéssel)

A 4 független review-lencse (kapu-kritérium-származtatás/állapotgép ·
típus-konfig hűség a Melléklet A-hoz · UI/i18n · regresszió #1–#5b ellen)
párhuzamos al-ügynökökként futott a `723d1f4..HEAD` tartomány felett.
(Az első kört a havi költségkeret elérése szakította meg; a feloldás után
a teljes kör lefutott.)

**Eredmény: EGYETLEN lelet — mind a négy lencse függetlenül ugyanazt
erősítette meg** (a négyszeres konvergencia kiváltotta a külön
adverszáriális kört):

| Súly | Lelet | Javítás |
| --- | --- | --- |
| alacsony | A degradált zárási ág (a kritérium-kiértékelés lekérdezési hibája) nyers „criteria" tokent interpolált a felhasználói hibaüzenetbe | Dedikált lokalizált kulcs (`errors.criteriaEvaluationFailed`): „A kilépő kritériumok kiértékelése sikertelen — a kapu biztonságból nem zárható. Próbáld újra." — a fail-safe viselkedés változatlan |

A lencsék pozitív verifikációi: a konfig mezőre pontosan egyezik a
Melléklet A-val (17 típus, gate-flagek, mező-sorrendek, required-jelölések);
runtime import-kör NINCS (a visszahivatkozás type-only); a degradált
fail-safe működik (null approved-halmaz = minden kemény kritérium
teljesületlen); stale gate_pending nem kerülheti meg az app-őrt (a
closeGate minden híváskor újra kiértékel, és ő az egyetlen RPC-hívó);
a kiértékelés projekt-szűkített; a checklist mindhárom megjelenítési
helye a közös címke-feloldót használja; a `manual_close` maradéktalanul
kivezetve; supabase/, machine.ts, token-értékek, seed, package.json
érintetlen.

## 4. Kezelt eltérések

- **reset-demo.sql:** a spec 4. lépése már a #5a-ban teljesült — e
  csomagban csak újra-bizonyítás történt, változtatás nélkül.
- **P3–P5 walkthrough-approvalok DB-szinten:** a deliverable-lánc UI-ját
  a P1–P2 fázisok bizonyítják end-to-end; a P3–P5 kapu-viselkedés (auto
  gate_pending, negatív zárás, interim-badge) UI-ból tesztelt.
- **Workflow-futtató:** a review-lencsék első körét a havi költségkeret
  elérése szakította meg — a keret feloldása után az azonos metodikájú
  második kör lefutott.

## 5. Parkoló-lista (nem e csomag scope-ja)

- Kanonikus küszöb-kritériumok: golden set átmenési küszöb (evals-register),
  scale/pivot/stop + pivot-hurok, adopciós küszöb (metrika-réteg) — az
  `interim` jelölés ezek helyét tartja.
- AS-IS térképek Process-entitásként + Mermaid-render (P1-mélység).
- Döntési brief automatikus összeállítása (§10/5 — most kézi).
- A `close_gate()` DB-szintű kritérium-tükrözése (most app-szintű őr —
  egyfelhasználós rendszerben elegendő; többfelhasználós/több-kliens
  környezetben DB-oldali duplikálás megfontolandó).

## 6. Nálad zárandó (Máté)

**NINCS SQL-teendő** — a csomag séma-mentes: `git pull` → Preview.

1. **Tár teljes térképe:** egy friss (vagy a demo-) projekt tárában mind
   a 18 deliverable látszik fázis-szekciókban (a legtöbb „Még nincs
   elkezdve" placeholderként).
2. **Egy fázis élő LLM-lánca:** pl. P1 — valós szöveggel: input → ②
   Feldolgozás (shortlist) → mező-megerősítés → ③ generálás → review →
   Approve → a fázis magától „Döntés vár"-ra vált → zárás.
3. **Negatív kapu-teszt:** egy P2-ben álló projekten próbáld a zárást
   úgy, hogy csak az egyik [K] deliverable approved — a hibaüzenetnek a
   hiányzó deliverable nevét kell mutatnia; és a Pilot-terv approve-ját
   üres baseline/küszöb/döntési szabály mellett — blokkolnia kell.

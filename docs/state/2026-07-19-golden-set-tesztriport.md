# Záró jelentés — #14 P3 Golden set + Tesztriport (2026-07-19)

**Csomag:** #14 — Golden set + Tesztriport (P3 minőség-kapu modul)
**Branch:** `dev` · commitok: `75cbff1` (#14/1) → `3ea52e3` (#14/2) → `76d6225` (#14/3+4) → jelen commit (#14/5)
**Spec:** Approved 2026-07-19 · referencia: AICON_14 — Golden set & Tesztriport (7 jelenet)

---

## 1. Mi épült

A P3 minőség-kapu modul: a tanácsadó golden setet (tesztkészletet) állít össze,
a megépült megoldást **a rendszeren kívül** futtatja rajta, a tényleges
kimeneteket itt rögzíti (a rendszer **nem futtat** — „követi, nem hosztolja"),
a rendszer besorolást **javasol** (AI, a kritériumokra hivatkozva, emberi
döntéssel zárva), és mindebből a Tesztriport deliverable nyílik, amely a
P3 fázis-kaput nyitja.

### Rétegek

- **Migráció `0011_golden_set.sql`** — 3 tábla: `golden_sets` (1:1 use case,
  `pass_threshold` EMBERI, `threshold_override_note`), `eval_cases`
  (EC-nn, 5 válasz-típus, `answer_config`/`expected_output`/`actual_output`
  jsonb, **AI-verdikt külön mezőkben** [`ai_verdict`/`ai_rationale`/`ai_criteria`]
  a `final_verdict`-től [+`verdict_by`/`verdict_at`], entity_state),
  `eval_criteria` (eset-kritériumok, E1-állapotokkal). 2× futtatva idempotens.
- **Entitás-réteg `lib/goldenset/model.ts`** — parseAnswerConfig/Value
  (típusonként; üres multi-kijelölés ÉRVÉNYES rögzítés, yes_no `false` érték),
  `caseStatus` (levezetett: rögzítendő→besorolandó→besorolva), `passStats`
  (**SZIGORÚ**: passed/ÖSSZES, partial+failed egyaránt nem-átment),
  `evaluateApprove` (kemény: nincs eset / nincs eredmény; felülírható:
  nyitott eset / nincs küszöb / küszöb alatt). 31/31 unit-teszt.
- **Parse `lib/goldenset/parse.ts`** — 5-típusú whitelist, kritérium nélküli
  javaslat kiesik, choice ≥2 opció, expected csak érvényes típus-formában
  (különben null — c-minta). 10/10 unit-teszt.
- **LLM-adapter** — `suggestEvalCases` (AC2), `suggestVerdict` (AC3),
  `suggestResidualRisk` (§7/3) + determinisztikus MOCK-ok (6 eset, mind az
  5 típus lefedve; expected csak 2 esetnél — c-minta demonstrálva).
- **Akciók `goldenset-actions.ts`** — E1 generálás (csak üres készletre),
  kézi eset + szerkesztés (ai_suggested→confirmed), kritérium-CRUD,
  `recordActualAction` (típusfüggő űrlap-értelmezés, opcionális ✦ AI-verdikt),
  `classifyAction` (VÉGSŐ besorolás emberi), `setThresholdAction` (1–100,
  csak ember), `setOverrideAction` (dokumentált felülírás), `syncReportAction`
  (a MEGLÉVŐ artifacts-láncra ír; approved riportot nem érint),
  `suggestResidualRiskAction` (ai_filled → a meglévő editor-HITL zárja).
- **Approve-őr `artifact-actions.ts`** — Tesztriport-specifikus poka-yoke az
  `evaluateApprove`-ra építve; felülírt jóváhagyás **decision-logba** kerül
  (`approve_override`).
- **UI** — `GoldenSetBoard` (1./3./4./5./6./7. jelenet: tábla + pass%-sáv a
  küszöb-markerrel, dinamikus rögzítő ★, besorolás-panel, Tesztriport-panel,
  küszöb-panel, kapu-panel, üres állapot) + `EvalCaseEditor` (2. jelenet
  overlay). Route: `/project/[id]/goldenset` (use case-horgony poka-yoke
  fallbackkel). Nav: „Golden set & riport" a Megoldás-terv után.
- **i18n** — 147 `goldenset.*` kulcs + 5 `errors.testreport*` + `nav.goldenset`;
  HU/EN paritás: 1590 kulcs.

### AC-lefedés

| AC | Megvalósítás |
|----|--------------|
| AC1 | Rögzítő-kártya űrlapja az `answer_type`-hoz idomul (szabad szöveg / radio / checkbox / csúszka élő értékkel / igen-nem) |
| AC2 | ✦ golden set-javaslat E1-ben, csak üres készletre; forrás-hivatkozással |
| AC3 | AI-verdikt kritériumonkénti OK/BUKOTT jelzéssel, KÜLÖN DB-mezőkben; a végső besorolás mindig emberi (elfogadás vagy felülírás, bíráló + időbélyeg) |
| AC4 | `expected_output` opcionális — üresen marad, ha nincs egyetlen jó válasz (c-minta) |
| AC5 | pass% = passed/ÖSSZES (szigorú); küszöböt csak ember állít; approve-blokk 4 negatív ágon, dokumentált felülírással (decision-log) |
| AC6 | Tesztriport a MEGLÉVŐ artifacts-láncon (Draft→In review→Approved), mező-szinkron a mérésből |
| AC7 | P3 kapu-panel: Megoldás-dokumentáció ÉS Tesztriport Approved → nyitható |

---

## 2. Verifikáció (lokális PG16 + PostgREST-shim + prod build + MOCK_LLM)

Stack: PG16 (55432) + shim (54325, `golden_sets`/`eval_cases`/`eval_criteria`
whitelistelve) + `next build` + `next start` (3117) + Playwright (chromium).

### Pozitív lánc (7 jelenet)

1. **Üres állapot (7.)** — cím + ✦ CTA + kézi CTA + „nem futtatunk" jegyzet ✓
2. **✦ Generálás (AC2)** — 6 eset, mind az 5 típus, 10 kritérium, minden
   `ai_suggested`; expected csak EC-02/EC-03-on (c-minta) ✓
3. **Szerkesztő (2.)** — EC-01 megnyitás → mentés → `confirmed` (DB-ből
   igazolva) ✓
4. **Dinamikus rögzítő ★ (3., AC1)** — mind az 5 típus rögzítve (szöveg,
   radio, checkbox, csúszka, igen-nem); „Minden eset rögzítve" sáv ✓
5. **Besorolás (4., AC3)** — EC-01: AI `partial` → **ember felülírja
   `failed`-re** (bíráló: „M. Tanácsadó"); EC-02/03/04: AI-javaslat elfogadva;
   EC-05/06: AI nélkül, közvetlen emberi döntés. DB: `ai_verdict` ≠
   `final_verdict` az EC-01-en — az E1-szétválasztás bizonyított ✓
6. **Riport (5., AC6)** — szinkron: „67% (4/6) · küszöb 85%", bukott-sor
   EC-01+EC-06, use case-sor; ✦ maradék kockázat → `ai_filled` mező ✓
7. **Küszöb + kapu (6., AC5/AC7)** — küszöb 85 (emberi mentés), pass%-sáv
   marker; felülírás-jegyzet; kapu 1/2 → SQL-lel Approved Megoldás-dok után
   **NYITHATÓ 2/2** + „P4 Pilot nyitása" link ✓
8. **EN nézet** — a board angolul is rendben renderel ✓

### Negatív (poka-yoke) tesztek

| # | Előfeltétel | Művelet | Eredmény |
|---|------------|---------|----------|
| N1 | üres free_text mező | Rögzít | ✓ hibaüzenet, nincs mentés |
| N2 | 3 eset besorolatlan | Approve (in_review-ból) | ✓ blokk: „amíg van besorolatlan eset" — státusz in_review marad |
| N3 | mind besorolva, küszöb nincs | Approve | ✓ blokk: „küszöb nélkül" |
| N4 | 67% < 85% küszöb | Approve | ✓ blokk: „a küszöb alatt" |
| N5 | dokumentált felülírás-jegyzet | Approve | ✓ átmegy; `decisions`-be `approve_override` sor a jegyzettel |

DB-bizonyítékok: `pass_threshold=85`, `threshold_override_note` mentve,
riport `approved`, decision-log sor, `maradek_kockazat.state='ai_filled'`.

### Verifikáció közben talált + javított hibák

- **`hibak_javitasok` kötelező mező vs. 0 bukott eset** — a szinkron `missing`
  állapotot írt volna, így a 100%-os riport sosem lenne Approved-olható.
  Javítás: explicit „nincs hiba" sor (`fieldNoFailures` kulcs, HU/EN).
- **`verdict.failed` HU címke** — „nem" önmagában kétértelmű (ütközik az
  igen-nem rögzítő „Nem" gombjával) → „nem felelt meg".
- **`p4Locked` string-manipulációs hack** a kapu-linken → tiszta `p4Open` kulcs.
- **Shim-whitelist** (harness, nem repo-kód): `golden_sets`/`eval_cases`/
  `eval_criteria` + `phase_instances`/`decisions`/`pain_point_stakeholders`.

### Ellenőrzések

- `npx tsc --noEmit` ✓ · `npm run build` ✓ · `npm run i18n:check` ✓ (1590,
  HU=EN) · migráció 0011 2× idempotens ✓ · unit: model 31/31, parse 10/10 ✓

---

## 3. Őszinte korlátok

- **MOCK_LLM-mel verifikálva.** A ✦ eset-javaslat, ✦ verdikt-ajánlás és
  ✦ maradék kockázat minősége éles Anthropic-hívással a Preview-n ítélhető
  meg. A parse-réteg determinisztikus tesztekkel fedett, de a valós modell-
  kimenet formahűsége Preview-ellenőrzést igényel.
- A P3 kapu-panel a két deliverable Approved-státuszát TÜKRÖZI; a tényleges
  fázis-zárás az állapotgép meglévő kapu-őrén fut (ott a [K] kritériumok
  között a Tesztriport már szerepel).
- A „P4 Pilot nyitása" link a cockpitra visz (a fázis-zárás ott történik) —
  nem zár kaput közvetlenül.

## 4. Scope-fegyelem

- Nem épült eval-runner (non-goal) — a rendszer semmit nem futtat.
- Parkoló-listára: riport-mezők finomhangolása éles LLM-kimenet alapján;
  esetleges eset-sorrend drag&drop (nem volt a specben).

## 5. Takarítás

`.env.local` törölve, shim + next leállítva, PG16 leállítva. A demo-adatok
(EcoSupport golden set) a lokális pgdata-ban maradtak a következő csomaghoz.

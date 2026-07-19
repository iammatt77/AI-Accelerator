# Záró jelentés — #15 P3 Megoldás-dokumentáció (2026-07-19)

**Csomag:** #15 — Megoldás-dokumentáció (P3, a Golden set + Tesztriport párja)
**Branch:** `dev` · commitok: `895b21f` (#15/1) → `48dc98e` (#15/2) → `18d2d02` (#15/3+4) → jelen commit (#15/5)
**Spec:** Approved 2026-07-19 · referencia: AICON_15 — Megoldás-dokumentáció (7 jelenet, kék rebrand)

---

## 1. Backend-megfelelés (a coding első lépése — AC1 kritikus)

**Igazolva:** a P2 opció-összevető (#12, 0010) a kiválasztást STRUKTURÁLTAN
tárolja — `solution_components` (típus/név/leírás/state) + `component_options`
(`is_selected` részleges unique indexszel, `selected_by`/`selected_at` HITL-
mezőkkel). Az eredet-seed ezért automatizálható volt, kézi felvitelre nem
esett vissza. A kötés-célok a MEGLÉVŐ entitásokra mennek (system requirement,
user story, TO-BE stabil node-id a process_maps jsonb-ből, fájdalompont) —
új cél-entitás nem jött létre; a generálási motor és a státuszlánc a meglévő.

## 2. Mi épült

- **Migráció `0012_build_components.sql`** — `build_components` (K-nn,
  réteg-típus, **origin_component_id** → P2 1-N seed, NULL=manuális),
  **`impl_links`** (N:M, 4 cél-típus, TO-BE stabil node-id + provenance,
  E1 state — a két kötés-fajta KÜLÖN táblán/mezőn, ahogy a spec kérte),
  `prompt_items` (PR-nn, komponens 1-N), `control_points` (guardrail/hitl,
  TO-BE-kötés nullable — c-minta). 2× idempotens.
- **`lib/builddoc/model.ts`** — seedCandidates (kiválasztott opcióval +
  „már kinyerve → K-xx" 1-N listával), planElements (4 cél-típus egységes
  címtára; requirement-oldalon CSAK system-szint), linksOfComponent +
  **coverageRows** (kétirányú olvasat — az ai_suggested kötés NEM fedés,
  külön ✦ számláló), originLabel. **`parse.ts`** — struktúra- és kötés-
  javaslat parse (réteg/kind/label whitelist, origin-index határellenőrzés,
  dedup — fabrikálás kizárva). 26/26 unit teszt.
- **LLM-adapter** — `suggestBuildDoc` (építési anyag → komponens + prompt +
  kontroll javaslat; P2-eredet csak felismerhető egyezésnél), `suggestImplLinks`
  (a felsorolt azonosítókra korlátozva; üres lista érvényes) + determinisztikus
  mockok.
- **`builddoc-actions.ts`** — P2-seed (öröklődő réteg + eredet-kötés,
  confirmed), kézi felvétel (+ opcionális ✦ kötés-javaslat mentés után),
  ✦ generálás (név-dedup, additív, minden ai_suggested), kötés-CRUD
  (add mindkét irányból; confirm CSAK ai_suggested-re; cél-validálás a
  címtárból), prompt/kontroll CRUD, **syncDocAction** (komponensek /
  prompt_konyvtar / guardrail_hitl mezők a MEGLÉVŐ artifacts-láncra;
  CSAK aktív entitás kerül bele; architektúra + integráció érintetlen;
  approved dok nem írható felül).
- **UI** — BuildDocBoard (5 szekció-csempe · komponens-tábla a KÉT kötés-
  oszloppal · lefedettség-nézet · prompt-könyvtár · kontrollpontok · üres
  állapot), BuildComponentDetail (2. jelenet ★ — eredet + promptok balra,
  megvalósítás 4 csoportban jobbra, ✦ szaggatott chip ✓/×, kattintható
  kétirányú bejárás), BuildAddPanel (P2-seed + manuális). Route:
  `/project/[id]/builddoc`; nav: „Megoldás-dok." a Megoldás-terv után.
- **i18n** — 131 `builddoc.*` kulcs + `nav.builddoc` (HU/EN paritás, 1722).

### AC-lefedés

| AC | Megvalósítás |
|----|--------------|
| AC1 | P2-seed strukturáltan (origin_component_id, 1-N, réteg-öröklés); manuális felvétel él; „már kinyerve → K-xx" jelölés |
| AC2 | impl_links N:M a 4 cél-típusra; chip mindkét irányból kattintható (részlet ⇄ lefedettség); requirement ÉS story egyszerre köthető |
| AC3 | ✦ ai_suggested (szaggatott) → CSAK ✓-val aktív, ×-szel elvethető; komponens/prompt/kontroll/kötés mind E1 |
| AC4 | „Nincs lefedő komponens" passzív doboz — pontszám/analízis nélkül; az ✦ kötés fedésnek NEM számít |
| AC5 | A deliverable a MEGLÉVŐ láncon (Draft→In review→Approved); szinkron csak nem-approved dokba |
| AC6 | Kontrollpont TO-BE-kötés select-tel; ahol nincs, „nincs TO-BE kötés" (c-minta) |
| AC7 | A #14 kapu-panelje már figyeli a Megoldás-dokumentáció Approved-ját — e modul a dok-felét szolgáltatja |

## 3. Verifikáció (lokális PG16 + shim + prod build + MOCK_LLM + Playwright)

### Pozitív lánc

1. **Üres állapot (7.)** — seed/anyag/generálás CTA-k + „a kötés emberi döntés" jegyzet ✓
2. **✦ Generálás (AC3)** — 3 komponens (2 P2-eredettel), 3 prompt, 2 kontroll
   (1 TO-BE-kötéssel), MIND ai_suggested (DB-ből igazolva) ✓
3. **P2-seed (6., AC1)** — 2 komponens behúzva; K-04/K-05 confirmed, zöld
   eredet-chip „P2 · Osztályozó modell (01)" ✓
4. **Részlet ★ (2., AC2+AC3)** — K-01 megerősítés ✓; ✦ kötés-javaslat →
   SYS-01 ✓-val AKTÍV, US-01 ×-szel elvetve, TO-BE·01 ✦ függőben marad;
   kézi FP-01 kötés a pickerből. DB: confirmed / ai_suggested / manual
   state-ek egymás mellett ✓
5. **Lefedettség (3., AC4)** — SYS-01: „Fedő komponensek · 1 (K-01)";
   SYS-03: „Nincs lefedő komponens" passzív doboz; **TO-BE fülön az ✦
   javaslat „✦ +1 javasolt"-ként látszik, fedésnek NEM számít**;
   elem-oldali kötés-CTA-val SYS-03 → K-05 kötés (kétirányú) ✓
6. **Prompt-könyvtár (4.)** — PR-01 szerkesztés-mentés → confirmed;
   PR-02/03 ✦ marad ✓
7. **Kontrollpontok (5., AC6)** — guardrail ✦ → Megerősít → confirmed;
   HITL ✦ → Elvet → törölve; TO-BE·03 kötés-chip ✓
8. **Dok-szinkron (AC5)** — draft v1, komponensek-mező soronként:
   „K-01 · Kategorizáló modul (folyamat) — eredet: P2 · … — megvalósítja:
   SYS-01, FP-01" ✓ · **EN nézet** renderel ✓

### Negatív (poka-yoke) tesztek

| # | Művelet | Eredmény |
|---|---------|----------|
| N1 | Szinkron CSAK ai_suggested komponensekkel | ✓ blokk: „Nincs megerősített komponens" (E1 — ✦ nem kerül dokba) |
| N2 | Szinkron approved dokumentumba (a #14-ből maradt SQL-demo dok) | ✓ blokk: errDocApproved — az approved nem íródik felül |
| N3 | Review-ra küldés után Approve a hiányzó kötelező architektúra-mezővel | ✓ „Jóváhagyás — mező hiányzik" blokk (meglévő artefaktum-őr) |
| N4 | Kötés nem-létező célra / érvénytelen javaslat | ✓ parse-whitelist + errTargetUnknown (unit-tesztelve, 26/26) |

### Ellenőrzések

- `npx tsc --noEmit` ✓ · `npm run build` ✓ · `npm run i18n:check` ✓
  (1722, HU=EN) · 0012 2× idempotens ✓ · unit 26/26 ✓ · mock-smoke ✓

## 4. Őszinte korlátok

- **MOCK_LLM-mel verifikálva** (a spec §6 szerint deklarálva): a komponens-
  lista, a kétirányú kötés-navigáció, a passzív lefedettség, az üres
  állapotok és a státuszlánc önállóan igazolt; az AI komponens/kötés/prompt/
  kontroll-javaslatok MINŐSÉGE valós-LLM Preview-tesztet igényel.
- A ref 5. szekciója („Integráció") a meglévő `uzemeltetesi_jegyzet`
  mezőre képződik le (a typeDef nem változott — a mező kivonatolással/
  kézzel töltendő); a szekció-csempe ennek kitöltöttségét tükrözi.
- Az áttekintő „Draft" lánc-kijelzője a deliverable státuszát TÜKRÖZI —
  a váltás az artefaktum-oldalon történik (meglévő szerkesztő).

## 5. Scope-fegyelem

- Non-goal tartva: NINCS lefedettség-pontszám / hiány-analízis / golden
  set↔kontroll kereszt-kötés (parkoló).
- Parkoló-listára: riport-szerű export (Could); prompt-elemek átkötése
  másik komponensre; kontrollpont-szerkesztő (most: megerősít/elvet + új).

## 6. Takarítás

`.env.local` törölve, shim + next + PG16 leállítva. Demo-adatok (EcoSupport
build-komponensek + kötések) a lokális pgdata-ban maradtak.

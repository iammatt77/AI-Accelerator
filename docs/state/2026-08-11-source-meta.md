# Záró jelentés — Epic 4 · 4.2b: Forrás-metaadat és atomi kinyerés

**Dátum:** 2026-08-11 · **Branch:** `dev` · **Spec:** Refounded_Epic4_42b_spec_v0_1
**Compliance:** docs/state/2026-08-11-source-meta-compliance.md (NINCS STOP)

## Mi épült meg

**(a) Forrás-metaadat** — `input_items.source_kind` (7 érték) + `org_level`
(4 érték), mindkettő NULLABLE: a NULL „nincs megadva", és a felületen
LÁTHATÓ hiány. A feltöltő űrlapon opcionális selectek (nem teher); a
Források-oldalon soronkénti META?-jelvény, amber pótlás-sáv a hiányzók
számával, kötegelt pótlás (csak a hiányzó mezőt tölti, a megadottat nem
írja felül) és olvasó-fejléc szerkesztő (a verzió-csoport MINDEN sorára
ment). Az új forrás-verzió a csoport metaadatát örökli.

**(b) Atomi kinyerés** — az `extractPainPoints` / `extractStakeholders`
promptokban ATOMICITÁS-KÉNYSZER (egy elem = egy teljes, önmagában megálló
állítás; több-állításos bekezdés bontva) és SZERKEZET-TILALOM (napirendi
pont, címsor, TOC-sor, lista-elem, résztvevő-lista → nem elem; csupa-
szerkezet forrás → üres kimenet). A `parsePainPointsResult` defenzív
törmelék-őre (`isStructuralDebris`) a prompt megkerülése ellen is véd:
sorszámmal kezdődő, TOC-szerű vagy félbevágott elem kiesik.

**(c) Metaadat-vezérelt besorolás** — a `labelOneItem` új `sourceMeta`
paramétert kap; a hívók (címkéző köteg, újracímkézés) az elem
`source_input_ids[0]`-jából oldják fel (kötegenként EGY lekérdezés).
A motorban: forrás-szint dimenzió az `org_level` metaadatból (konf 0.98,
`derived_from:'forras-metaadat'`, NEM kétes); modalitás-prior a típus-
térképből (hivatalos→normatív, rendszeradat/interjú→as_is) — borderline +
prior → a prior dönt eszkaláció NÉLKÜL; a magabiztos, nem-borderline
szöveg felülír (az indok kimondja); ismeretlen típusnál az indok kimondja
a hiányt („A forrás típusa nincs megadva — a besorolás csak a szövegre
támaszkodik") — látható bizonytalanság.

**(d) Evidencia-jelleg** — új, teljes értékű dimenzió (mért adat ·
megfigyelés · vélekedés · hivatkozás · ismeretlen) ugyanabban a classify-
hívásban; `knowledge_metadata.evidence_kind` oszlop; gyenge szöveg-jelnél
a forrás-típus alapértéke old fel (levelezés→vélekedés stb.). A 4.2 UI
minden pontján megjelenik: olvasó-panel Besorolás-táblázat, szerkesztő-
űrlap select, felülvizsgálat-mód opciók, javítás-napló (`'evidence'`
dimenzió a 0018 CHECK-ben).

**(F3-b) Szerkezetből nem lesz tudáselem** — `ArtifactFieldDef.knowledgeExempt`
config-jelölés (Kickoff-agenda: `resztvevok`, `napirend`, `elokeszuletek`);
a katalógus-oldal és a címkéző köteg kihagyja ezek céduláit. **A 2.1
`knowledge_catalog` nézet érintetlen** (védett felület) — a szűrés a 4.2
fogyasztói szintjén él; a 4.3+ fogyasztóknak ugyanez a szűrő kell majd.

## Migráció — MEGÍRVA, ÉLESBEN NEM FUTOTT LE

`supabase/migrations/0019_source_meta_evidence.sql` — idempotens (lokálisan
kétszer futtatva hibátlan). **Máté futtatja kézzel a Supabase SQL-editorban**
a deploy ELŐTT. A `knowledge_metadata.source_kind` (4.1 attribúció) NEM
azonos az új `input_items.source_kind`-dal — a névütközés dokumentált, a
régi mező érintetlen.

## Verifikáció — MI MOCK ÉS MI VALÓS

**MINDEN itteni futás MOCK** (MOCK_LLM=1 + MOCK_EMBEDDINGS=1, lokális
PG16 + PostgREST-shim; a determinisztikus mock a valós parse-úton át ad
választ — MOCK-rés elv, a fixture-ök szerkezeti zajt tartalmaznak:
sorszámozás, címsorok, TOC-sor, több-állításos bekezdés, ismeretlen
típusú forrás). **Valós LLM-hívás ebből a sandboxból nem indítható**
(egress-korlát) — a valós verifikáció Máté runbookja (lent), és a spec
szerint NEM halasztható el a csomag lezárásán túl.

### Headless engine-teszt: 39/39 ✓ (verify42b)

- modalitás-prior: borderline + hivatalos_dokumentacio → normatív,
  eszkaláció NÉLKÜL (samples=1), `derived_from` jelöléssel, NEM kétes
- a magabiztos ellentmondó szöveg felülírja a priort (indok kimondja)
- ismeretlen típus → látható bizonytalanság az indokban + a forrás-szint
  szöveg-tipp marad (kétes)
- evidencia: mért adat/vélekedés/hivatkozás a szövegből; gyenge jel +
  levelezés → vélekedés a priorból (NEM kétes); `evidence_kind` írva
- rövid szöveg: prior nélkül eszkalál (3-5 minta), interjú-priorral NEM
- kétes-arány kontrollcsoporton: 4/4 → 3/4 (ugyanazok a szövegek)
- kickoff-agenda (csupa szerkezet) → NULLA elem; vegyes forrás → pontosan
  a 2 valódi állítás, szó szerinti idézettel, nulla sorszámos törmelék
- parse törmelék-őr: sorszámos cím / TOC-sor / félbevágott elem kiesik,
  a valódi állítás megmarad

### UI-walkthrough: 36/36 ✓ (walk42b, Playwright)

- Források: 3 hiányos forrás → sáv + META?-jelvények; egyedi mentés
  (interjú/helyi) DB-assertekkel; kötegelt pótlás CSAK a hiányzókat tölti
  (a megadott érték nem íródik felül); verzió-öröklés (v2 = a csoport
  metaadata); feltöltő űrlap → `source_kind/org_level` tárolva
- Katalógus: 22 elem (a 3 szerkezet-mező kihagyva — a napirend-törmelék
  „1. A helyzetértékelés…" NINCS a listában, a `celok` valódi állítása
  BENT van); szerkezet-mezőre signal SEM születik
- **Kétes-arány ugyanazon a 22 elemen, két teljes futtatással mérve:**
  - régi dimenziókon kétes elem: **18 → 13**
  - forrás-dimenzió kétes: **13 → 9**
  - **forrás-hivatkozásos elemen forrás-kétes: 0** (mind a 10+ hivatkozó
    elem `derived_from:'forras-metaadat'` jelöléssel, konf 0.98)
  - a maradék kétes a forrás-hivatkozás NÉLKÜLI cédulákon él (charter-
    mezők, stakeholder-sorok — nincs input-ref, nincs metaadat-út), és
    az indok kimondja a hiányt (12 elemen)
  - az ÚJ evidencia-dimenzió saját kétes-készletet hoz (14) — ez nem
    regresszió, hanem az új tengely őszinte bizonytalansága; a teljes
    kétes-szám ezért nem hasonlítható a régi 5-dimenziós számhoz
- Evidencia a felületen: Besorolás-sor, szerkesztő-select (mentés →
  `evidence_kind`, javítás-napló `evidence` sorral, a dimenzió „ember"
  eredetű lesz — F4 védelem él), felülvizsgálat-mód opciók
- Regresszió: a kötegelt címkézés-futtatás változatlanul működik (2×22
  elem, folytatólagos kötegek, pontos zárószám)

### A verifikáció közben talált és javított hibák

- **Mock evidencia-precedencia:** „a szabályzat szerint" a vélemény-regexet
  találta el (csupasz „szerint" névutó) → a hivatkozás-ág előre került.
- **Notice-elnyelés:** a forrás-metaadat szerkesztő kulcsa a mentett
  értéket is tartalmazta → a revalidate remountolta és elnyelte a
  visszajelzést; a kulcs most csak a csoport-id.

## Valós LLM — Máté runbookja (NEM halasztható)

A repo gyökeréből, valós kulccsal a `.env.local`-ban (`ANTHROPIC_API_KEY`;
MOCK_LLM NE legyen beállítva):

```
npx tsx --env-file=.env.local --conditions=react-server scripts/smoke-source-meta.mts
```

A script (4 blokk, mindegyik kiírja a nyers választ és ítéletet ad):
1. kickoff-agenda → NULLA elem; 2. vegyes forrás → 1-3 valódi elem, nulla
sorszámos/csonka; 3. evidencia: mért adat vs vélekedés szétválik;
4. forrás-típus-hint: borderline → normatív a hint felé, a tisztán
megfigyelő szöveg a hint ellenére as_is. A korábbi
`scripts/smoke-labeling.mts` (valós címkézés + embedding) változatlanul
érvényes kiegészítő.

## §6 — A meglévő 88 elem sorsa: költség-felmérés (a döntés Mátéé)

A pontos éles leltárhoz futtasd a compliance-jelentés SQL-jét (read-only;
megmondja, a 88-ból mennyi a szerkezet-mező és a sorszámos töredék).
A lokális mérés alapján várható hatás-sorrend:

1. **0 Ft-os azonnali hatás (deploy + 0019):** a `knowledgeExempt` szűrő a
   szerkezet-cédulákat (napirend, résztvevők, előkészületek) AZONNAL
   kiveszi a 4.2-ből — újrakinyerés nélkül. Ha az éles törmelék zöme ilyen
   (a spec példája az), a katalógus ettől lényegében kitisztul.
2. **Olcsó második lépés:** metaadat-pótlás a Források-oldalon (pár perc
   kézi munka) + újracímkézés a meglévő „Címkézés futtatása" gombbal —
   elemenként 1-5 LLM-hívás + 1 embedding (~88 elemnél nagyságrendileg
   100-450 hívás). A kézi címke-javítások VÉDVE maradnak (F4: az „ember"
   dimenziót a gép nem írja felül), az entitás-megerősítések megmaradnak
   (a cédulák nem jönnek létre újra).
3. **Drága út (csak ha a szöveg-törmelék is jelentős):** újra-kinyerés a
   forrásokból az új atomicitás-prompttal — forrásonként 2-3 hívás + teljes
   újracímkézés; ELVESZNEK az entitás-megerősítések és a kézi javítások.
   Csak akkor éri meg, ha az 1-2. után is sok a csonka szöveg-elem.

**Javaslat (döntésre): 1 + 2, és a 3. csak célzottan, elemenként** (a
rossz elem kézzel törölhető/újrakinyerhető). Döntés Mátéé.

## Parkoló (nem e csomag scope-ja)

- seed.ts friss DB-n `group_id` nélkül szúr be (0013 óta NOT NULL) —
  egysoros repo-fix várakozik (korábbi csomag jelentette).
- A 2.1 nézet 240 karakteres `left()` vágása hosszú mező-értéknél továbbra
  is csonkíthat NEM-exempt mezőt — 2.1-revízió kérdése (jelentve a
  compliance-ben; a 4.2b a szerkezet-mezők kivételével kezeli a fő esetet).
- `deriveSourceKind()` cím-heurisztika (Források-oldal badge) mostantól
  redundáns a valódi `source_kind` mellett — kivezetése UI-döntés.

## Kész-ha státusz

- Forrás-metaadat megadható/pótolható, hiány látható: ✓ (S1–S12)
- Kinyerés atomi, szerkezetből nulla elem: ✓ MOCK (8-10. blokk) — valós
  LLM-en Máté runbookja zárja
- Besorolás metaadat-vezérelt, kétes-arány érdemben csökken: ✓ (18→13 a
  régi dimenziókon; forrás-kétes 13→9; hivatkozó elemeken 0)
- Evidencia-dimenzió minden elemen, felületen, javítható: ✓ (C10–C16)
- 4.2 UI + kötegelt futtatás regresszió-mentes: ✓ (C1–C6, 2 teljes futás)
- Migráció megírva, élesben NEM futtatva: ✓ (0019, idempotens)
- Meglévő elemek sorsa: felmérve, döntés Mátéé: ✓ (§6 fent)

## Takarítás

`.env.local` törölve; lokális PG + shim + dev-szerver leállítva; a
harness-fájlok (shim.mjs, walk42b.mjs, verify42b.mts) a session-scratchpadban
maradtak, a repóba NEM kerültek.

# Záró jelentés — shim `.in()`-támogatás + guard-újraverifikáció

**Dátum:** 2026-07-30
**Branch:** `dev`
**Scope:** (1) a lokális verifikációs harness PostgREST-shimjének `.in()`-támogatása;
(2) a 8 MAGAS kockázatú state-guard VALÓS, kétirányú próbája a javított shim ellen.
**Előzmény:** `docs/state/2026-07-30-input-items-groupid-bugfix.md` — a shim-eltérés
vizsgálat kimutatta, hogy a shim `parseFilters()`-e CSENDBEN eldobta a `.in()`
szűrőket (csak `eq/neq/is`-t ismert), így a lokális self-check zöldet mutathatott
olyan guardokra, amelyeket a lekérdezés valójában sosem kényszerített ki.

---

## Mi változott (és mi NEM)

- **Alkalmazás-kód: SEMMI.** Ebben a csomagban nulla app-kód módosult. A
  `git status` a commit előtt csak a szándékosan törölt ideiglenes harness-fájlt
  mutatta. A leszállított egyetlen repo-változás **ez a jelentés**.
- **Harness (NEM repo-kód): a `shim.mjs` `.in()`-támogatása.** A shim a
  scratchpad-területen él (harness-only), nem része a repónak, ezért nem is
  kerül commitba. A módosítás dokumentálva itt a teljesség kedvéért.

### A shim `.in()`-parse (harness)

A `parseFilters()` mostantól felismeri a supabase-js `.in(col, values)` által
küldött `col=in.(v1,v2,…)` query-paramétert, és `"<col>" in ($1,$2,…)`-re
fordítja a meglévő paraméter-kötési mintával. Egy idézőjel-tudatos
`parseInList()` tiszteletben tartja, hogy a supabase-js a `[,()]` speciális
karaktert tartalmazó értékeket `"…"`-ba csomagolja
(`PostgrestReservedCharsRegexp = /[,()]/`), a többit nyersen küldi.
Az üres `in.()` → `false` (sosem illeszkedik, elkerülve a PG `col in ()`
szintaxishibáját).

**Empirikus bizonyíték a valós Postgres ellen (a fix ELŐTT → UTÁN):**
- Egy `.in("state",["confirmed","manual"])`-t tartalmazó guard-lekérdezés a
  fix előtt 4 sort adott vissza (a `.in()` eldobva → a szűrő nem érvényesült),
  a fix után 1 sort (a szűrő valóban érvényesül).
- Vessző-tartalmú, idézőjelezett érték (`in.(a,"b,c",d)`) pontosan
  `["a","b,c","d"]`-re bomlik — a quote-aware parser igazolva.

---

## 2. rész — a 8 MAGAS kockázatú guard VALÓS próbája

**Módszer (NEM MOCK a döntési úton):** minden guard PONTOS supabase-js
lekérdezését a guard-kódból **szó szerint** átvéve futtattuk a **valós
supabase-js kliens → javított shim → valós Postgres (PG16)** láncon, MINDKÉT
irányban. A `state` szűrés tehát a valós DB-soron dől el, nem mockolt válaszon.

| # | Guard | Fájl:sor | NEG (ai_suggested) | POZ (confirmed) |
|---|-------|----------|--------------------|-----------------|
| G1 | `fetchQuickWinOnShortlist` (P1 kemény kapu) | `src/lib/phases/service.ts:70-82` | 0 sor (kapu nem teljesül) | 1 sor (kapu teljesül) |
| G2 | `scoreUseCaseAction` | `src/app/entity-actions.ts` ~665 | 0 sor módosul → `entityNotConfirmed` | 1 sor módosul |
| G3 | `shortlistUseCaseAction` | `src/app/entity-actions.ts` ~707 | 0 sor | 1 sor |
| G4 | `excludeUseCaseAction` | `src/app/entity-actions.ts` ~752 | 0 sor | 1 sor |
| G5 | `scoreStakeholderAction` | `src/app/stakeholder-actions.ts` ~346 | 0 sor | 1 sor |
| G6 | `setCommunicationStrategyAction` | `src/app/stakeholder-actions.ts` ~376 | 0 sor | 1 sor |
| G7 | `saveEvaluator` | `src/app/evaluator-actions.ts` ~50 | 0 sor | 1 sor |
| G8a | `setPainStakeholdersAction` read-guard | `src/app/stakeholder-actions.ts` ~470 | csak confirmed köthető | — |
| G8b | kézi use case pain-validáció | `src/app/entity-actions.ts` ~602 | csak confirmed hivatkozható | — |
| G8c | `togglePainBindAction` read-guard | `src/app/stakeholder-actions.ts` ~528 | nincs sor (elutasít) | van sor (átmegy) |

**Eredmény: 18/18 OK** — minden guard NEGATÍV iránya 0 sort érint
(a write-guard 0 sort módosít → `entityNotConfirmed`; a read-guard kizárja a
nem-megerősített entitást), minden POZITÍV iránya 1 sort (a jó út nem tört el).

### Valós server-action horgony (végponttól végpontig)

A query-replikáció lehorgonyzására egy VALÓS Next server-action tamper-race is
lefutott (`scoreUseCaseAction`, MOCK_LLM app, javított shim → valós PG):
1. P1 betöltés — egy megerősített use case pontozó-formja renderel.
2. A DB-sort `ai_suggested`-re billentjük **reload nélkül** (a form marad).
3. A már renderelt formot beküldjük (más score-értékkel).
4. **Eredmény:** a valós `scoreUseCaseAction` `entityNotConfirmed` hibát adott,
   a `score_value` **változatlan** maradt (0 sor módosult). **5/5 OK.**

Ez igazolja, hogy nem csak a lekérdezés szűr helyesen, hanem a server-action
burkoló-logikája is (`data.length === 0 → entityNotConfirmed`) valós HTTP-úton.

---

## Priorizált végeredmény — melyik guard helyes, melyik igényel külön javítást

**MINDEGYIK guard KÓDJA HELYES.** A `.in("state",[…])` szűrés a kódban végig
korrektül volt megírva; az egyetlen hiba a **harness shimjében** volt (eldobta a
`.in()`-t), ami VAKFOLTOT okozott a lokális self-checkben — nem a termékkódban.
A javított shim mellett minden guard két irányban bizonyítottan kikényszeríti a
megerősített-állapot feltételt.

- **Külön javítást igénylő guard: NINCS.**
- **STOP-feltétel: nem állt elő** — a 2. rész nem talált valódi kód-hibát.

> Megjegyzés: a korábbi shim-eltérés jelentés MEDIUM/LOW tételei (doc-gen
> input-szűrés, `.upsert()` 3 helyen, over-fetch/over-delete) továbbra is a
> harness-shim korlátai, NEM termékkód-hibák; külön, körülhatárolt harness-
> feladatként kezelendők, ha valaha kellenek. A jelen csomag scope-ján kívül.

---

## Regresszió — a `.in()`-bővítés nem tört el mást

- **group_id-javítás (0caa0cb) érintetlen és működik.** A `.in()`-változás CSAK
  a `parseFilters()` GET/PATCH/DELETE szűrőit érinti; a forrás-hozzáadás POST
  insert — nulla kód-út átfedés. Az `addPhaseInput` **pontos** insertjét
  (`group_id = id`, kliens-oldali id) a javított shim ellen futtatva: **7/7 OK**
  (sor létrejön, `group_id` NOT NULL és `= id`, `version = 1`, `phase = P0`);
  kontrollként a `.in()` GET-szűrő ugyanazon a shimen visszaadja a beszúrt sort
  → a két kód-út együttélése igazolt.

---

## Minőség-kapuk

| Kapu | Eredmény |
|------|----------|
| `tsc --noEmit` | **0 hiba** |
| `npm run i18n:check` | **OK — 1867 kulcs, mindkét nyelven azonos** |
| Prod build (`next build` + `next start`) | **zöld** (a verifikáció a prod build ellen futott, port 3111) |
| Guard-újraverifikáció (18/18) | **zöld** |
| Server-action horgony (5/5) | **zöld** |
| group_id-regresszió (7/7) | **zöld** |

---

## MOCK vs. valós — explicit

- **LLM:** `MOCK_LLM=1` (az app LLM-hívásai mockoltak — a guard-döntéseket ez
  NEM érinti; azok tiszta DB-state-szűrések).
- **Adatréteg:** **valós PG16** (lokális, socket `/tmp`, db `aicon`). A shim egy
  vékony PostgREST-kompat réteg a valós Postgres előtt — **nem** mock-DB.
- **A guard-döntési út végig VALÓS:** valós supabase-js kliens → javított shim →
  valós Postgres. A `.in()` a **valós Postgres** `IN (...)` operátorára fordul;
  a shim-patchelés (a korábbi group_id-kompenzáció) itt **nem** játszik szerepet,
  mert az kizárólag az `input_items` POST-insert ágát érinti, a guardokét nem.
- **A verifikáció tehát a javított shim + valós Postgres constraint/operátor
  ellen futott**, nem lazított teszt-séma vagy mockolt válasz ellen.

# Bugfix — `input_items.group_id` NOT NULL hiba (forrás hozzáadása) + shim-eltérés vizsgálat

**Dátum:** 2026-07-30 · **Branch:** `dev` · **Kapcsolódó dokumentum:** a jóváhagyott diagnózis (előző munkamenet — nincs önálló compliance-check dokumentumban, a diagnózis-válasz maga volt a leltár).

**Verifikáció — MOCK vs valós, explicit:** A javítás **VALÓS Postgres NOT NULL kényszer ellen** verifikálva — a szokásos self-check shim `group_id`-auto-fill kompenzáló patch-e (a bug oka!) **erre a futásra szándékosan ki volt kapcsolva**, hogy a teszt ne adhasson hamis zöldet. A shim-eltérés vizsgálat (2. rész) szintén **valós Postgres/shim ellen, élő próbákkal** történt, nem elméleti kód-olvasással. LLM-hívás egyik részben sem volt (MOCK_LLM irreleváns erre a csomagra).

---

## 1. rész — a javítás

**Fájl:** `src/app/artifact-actions.ts:112–124` (`addPhaseInput`).

```ts
const supabase = createServiceSupabaseClient();
// 0013 (A8): group_id NOT NULL — egy vadonatúj forrás a SAJÁT csoportjának
// v1-e (group_id = id), a migráció backfill-jével azonos szabály, csak
// beszúráskor. Kliens-oldali id, hogy a group_id ugyanazt az értéket kapja.
const id = crypto.randomUUID();
const { error } = await supabase.from("input_items").insert({
  id,
  project_id: projectId,
  type: title || "raw",
  raw_text: rawText,
  phase,
  group_id: id,
});
```

Kizárólag ez az insert-útvonal módosult. `newSourceVersionAction` (`staleness-actions.ts`) **érintetlen** — az explicit átveszi a meglévő csoport `groupId`-jét, ahogy eddig is. Nincs migráció, nincs DB-oldali trigger vagy default — az elemzés megerősítette, hogy a rendszerben ma egyáltalán nincs trigger, és nem indokolt egyet bevezetni egyetlen mező kedvéért.

### Verifikáció (kritikus rész: NEM a shim mögött)

**Módszer:** a lokális harness shim (`shim.mjs`, harness-only, nem repo-kód) `input_items`-re vonatkozó `group_id`-auto-fill ágát (`if (table === "input_items" && obj.group_id === undefined …)`) a futás idejére **`if (false && …)`-re módosítottam** — ez a pontos kompenzáló patch, ami miatt a hiba eddig rejtve maradt. Ezután a beszúrás a **valós Postgres NOT NULL kényszere ellen** fut, semmilyen JS-oldali segítség nélkül — pontosan az élesben tapasztalt viselkedés.

**Pozitív próba (a javítással):** valós Playwright-folyás — P0 fázis, ① FORRÁSOK zóna, `PhaseInputForm` kitöltése és elküldése a valódi `addPhaseInput` server actionön át. **8/8 OK**, két egymást követő futáson:

```
OK  UI: 'Bemenet elmentve.' visszajelzés megjelent (a form nem hibázott)
OK  DB: a sor létrejött (nem null insert-eredmény)
OK  DB: group_id NEM NULL
OK  DB: group_id = id (önhivatkozó, a 0013 v1-szabálya szerint)
OK  DB: version alapértelmezetten 1
OK  DB: phase='P0' átadódott
OK  SÉMA: input_items.group_id NOT NULL a valós Postgres-ben (is_nullable=NO)
OK  SHIM: a group_id auto-fill patch KIKAPCSOLVA ebben a futásban
```

**Negatív kontroll (a javítás nélkül, UGYANAZZAL a kikapcsolt shim-mel):** a fixet ideiglenesen `git stash`-eltem, újraépítettem és újraindítottam az appot, majd **ugyanazt** a Playwright-folyamatot futtattam. Az eredmény **szó szerint reprodukálta a bejelentett hibát**:

```
FAIL: UI: 'Bemenet elmentve.' visszajelzés megjelent (a form nem hibázott)
UI hibaszöveg: Bemenet mentése sikertelen: null value in column "group_id"
  of relation "input_items" violates not-null constraint
```

Ez bizonyítja mindkét irányban: (a) a teszt ténylegesen tud bukni — nem egy örökké-zöld próba —, és (b) pontosan a kódjavítás az, ami a különbséget teszi, nem valami más környezeti tényező. A fix visszaállítása után a pozitív eredmény újra 8/8-ra jött.

**Regresszió:** `npx tsc --noEmit` ✓ · `npm run build` ✓ (minden route fordul) · `npm run i18n:check` ✓ (1867 kulcs, nincs új UI-szöveg ebben a csomagban) · `newSourceVersionAction` fájlja diff-mentes (érintetlen) · P1/P2/P3 munkaterületek HTTP 200-at adnak (nem törtek el).

**Cleanup:** a shim visszaállítva az eredeti (patchelt) állapotára (diff-fel ellenőrizve: pontosan egy sor tér el, vissza is állt), a teszt-sorok törölve, a P0 fázisállapot visszaállítva `completed`-re, a lokális stack leállítva, `.env.local` törölve.

---

## 2. rész — shim-eltérés vizsgálat (DIAGNÓZIS, nincs javítás)

A leltár a shim teljes forrását (`shim.mjs`, 133 sor) átnézte, majd a legfontosabb találatokat **élő próbákkal** (curl a futó shim ellen, valós Postgres-szel) igazolta — nem csak kód-olvasással.

### Módszertan

A shim `parseFilters()` függvénye (`shim.mjs:41–65`) a szűrő-operátoroknak **kizárólag** az `eq`/`neq`/`is` alakját ismeri fel (`/^(eq|neq|is)\.(.*)$/`). A supabase-js `.in(col, values)` hívása `col=in.(v1,v2,…)` alakú query-paramot küld (`node_modules/@supabase/postgrest-js/src/PostgrestFilterBuilder.ts:842`) — ez **nem illeszkedik** a regexre, és a shim **CSENDBEN, hibaüzenet nélkül eldobja** ezt a szűrőt. `.gt/.lt/.gte/.lte/.like/.ilike/.contains/.overlaps/.or/.not` sem támogatott (a kódbázis ezeket szerencsére sehol nem használja — ellenőrizve).

### Empirikus igazolás (élő próbák a futó shim ellen)

**(a) Olvasás — a szűrő eldobása, nem hibázik, csendben túl sokat ad vissza:**
```
GET …/pain_points?project_id=eq.<pid>&state=in.(confirmed,manual)
→ egy ai_suggested (nem megerősített) sor VISSZAJÖTT, holott a szűrőnek ki kellett volna zárnia.
```

**(b) Write-guard defeat (KRITIKUS — ugyanaz a hibaosztály, mint a group_id):**
```
PATCH …/use_cases?id=eq.<X>&project_id=eq.<pid>&state=in.(confirmed,manual)
  body: {score_value: 5, score_feasibility: 5}
→ a PATCH SIKERREL LEFUTOTT egy state='ai_suggested' (NEM megerősített) use case-en.
  Élesben a valós PostgREST helyesen érvényesítené az .in() szűrőt → 0 sor
  módosulna → az app "entityNotConfirmed" hibát adna. Locálisan a guard
  TELJESEN hatástalan.
```

**(c) P1 kemény kapu-kritérium defeat (a legmagasabb kockázatú találat):**
```
a fetchQuickWinOnShortlist (lib/phases/service.ts:70–82) pontos lekérdezését
szimulálva egy quick_win=true, DE state='ai_suggested' ÉS list_status='candidate'
(tehát SEM nem megerősített, SEM nem shortlistelt) use case-re:
GET …/use_cases?id=eq.<X>&quick_win=eq.true&list_status=in.(shortlist,selected)&state=in.(confirmed,manual)
→ A SOR VISSZAJÖTT — holott egyik .in() feltételt sem teljesíti valójában.
```
Ez azt jelenti: a P1 spec szerinti KEMÉNY kritérium ("van-e megerősített quick win a shortliten") a lokális harness-ben **bármely** `quick_win=true` sorra igazat adna, függetlenül az állapotától — a kapu-poka-yoke a self-check-ekben soha nem lett ténylegesen próbára téve.

### Prioritált lista

**MAGAS — silent-pass locálisan, elutasítás élesben (ugyanaz az irány, mint a group_id-bug: a teszt zöldet mutat, éles Supabase helyesen elutasítaná/máshogy viselkedne):**

1. **`fetchQuickWinOnShortlist`** (`src/lib/phases/service.ts:70–82`) — a **P1 kemény kapu-kritérium** maga. Két `.in()` szűrő egyszerre eldobva → a kapu tévesen "teljesítettnek" látszódhat a self-check-ekben nem-shortlistelt/nem-megerősített quick winekre is. **Ez a legmagasabb kockázatú találat**, mert egy spec-kötelezte blokkoló kapu integritását érinti, nem csak egyetlen mutáció-guardot.
2. **Entitás-mutáció write-guardok**, mind az `.update(...).eq(id).eq(project_id).in("state",["confirmed","manual"]).select("id")` + `data.length===0 → entityNotConfirmed` mintát követik:
   - `scoreUseCaseAction`, `shortlistUseCaseAction`, use case kizárás (`src/app/entity-actions.ts:~670, ~707, ~752`)
   - `scoreStakeholderAction`, `setCommunicationStrategyAction` (`src/app/stakeholder-actions.ts:~346, ~376`)
   - `saveEvaluator` — AI-alkalmasság/adatérettség/AI Act mentés közös segédfüggvénye (`src/app/evaluator-actions.ts:~50–58`)
   - Mind a hat útvonal **empirikusan igazoltan** hatástalan guard a lokális harness-ben (lásd (b) próba) — a "csak megerősített entitás módosítható" szabály éles Supabase-en helyesen érvényesül, de a self-check-ek ezt SOSEM tudták ténylegesen ellenőrizni.
   - Ide tartozik két **read-guard is az insert-oldalon**: `setPainStakeholdersAction`/`togglePainBindAction` (`stakeholder-actions.ts:~476, ~528`) és a use case-kézi-felvétel pain-validáció (`entity-actions.ts:~602`) — ezek `.in("state",…)+.in("id",…)` kombinációval szűrik, mely id-k köthetők be; mindkét szűrő eldobása azt jelenti, hogy tamperelt/nem-megerősített referenciák is "érvényesnek" tűnhetnek a helyi tesztekben.

**KÖZEPES — tartalom-helyesség (olvasás, dokumentum-generálásba szivároghat nem-jóváhagyott adat):**

3. Shortlist-dokumentum generálás (`src/app/artifact-actions.ts:~701–706`, kommentben: "KIZÁRÓLAG emberi kontrollon átment… E1, negatív teszt b") és Megoldási javaslat generálás (`~919–923`) — mindkettő `.in("state",…)` (utóbbi `.in("list_status",…)` is) a bemenet-use case-ek szűrésére. Ha ezek a szűrők élesben hibásak lennének, egy `ai_suggested` use case bekerülhetne egy jóváhagyott dokumentumba — de mivel a szűrő maga a valós PostgREST-en helyesen fut, ez CSAK akkor bug, ha a szűrő-kód maga hibás; a lokális teszt viszont sosem tudná elkapni egy ilyen kódhibát, mert a shim mindkét esetben (helyes és hibás szűrő) ugyanazt (mindent) adná vissza.
4. `.upsert(..., {onConflict, ignoreDuplicates:true})` három helyen (`requirements-actions.ts:184, 721`, `lib/phases/service.ts:181`) — a shim POST-ja **nem ismeri** az `on_conflict`-ot, mindig sima INSERT-et futtat. **Ellentétes irányú kockázat**: ha egy már létező párra fut az upsert, élesben helyesen no-op (idempotens), locálisan viszont egyedi-kulcs-ütközési hibát dobna (a `phase_instances` eset ezt csak logolja, el van nyelve; a `stakeholder_requirements` eset hibát adna vissza a felhasználónak). Ez **"hamis piros"**, nem "hamis zöld" — kevésbé veszélyes, mert a hiba iránya fordított (a lokális teszt túl szigorú, nem túl engedékeny), de azt jelenti, hogy az idempotens-újrafuttatás viselkedését ma nem lehet locálisan igazolni.

**ALACSONY (self-korrigáló / kozmetikai):**

5. `PhaseWorkspace.tsx` olvasó `.in("pain_point_id",…)` (~223) és `.in("type",…)` (~168) — ha eldobódnak, csak TÖBB sort adnak vissza (pl. az összes `pain_point_stakeholders` sor projekt-szűrés helyett), ami UI-szinten esetleg észrevehető félrekötés, de nem ad hamis "sikerült" jelzést egy mutáción.
6. Az `oldIds`-alapú takarítás-DELETE-ek (`entity-actions.ts:~135`, `stakeholder-actions.ts:~151`) — `.eq("state","ai_suggested")` (TÁMOGATOTT, `eq`) + `.in("id", oldIds)` (ELDOBOTT). Az eldobás itt **túl-törlést** okozna helyi tesztben (minden `ai_suggested` sor törlődik projektszinten, nem csak a régi kötegé) — ez az ELLENKEZŐ irány (több törlődik lokálisan, mint kellene), ami inkább hangosan buktatna egy assertiont, mint hogy elrejtsen egy hibát.
7. `.select("id")` / narrow projection mindenhol figyelmen kívül hagyva (a shim mindig `select *`-ot futtat) — nulla kockázat, csak extra mezőket ad vissza, amit a hívó kód nem használ fel hibásan.

### Explicit záró megállapítás

**Nem nulla** a további eltérés az író-útvonalakon — a (2) MAGAS kategória (write-guardok + a P1 kemény kapu) **strukturálisan analóg** a group_id-hibával: a self-check ZÖLD-et mutat egy olyan szabályra, amit a helyi infra sosem kényszerít ki ténylegesen, miközben éles Supabase-en a szabály korrekt (feltéve, hogy az alkalmazás-kód maga helyes — ezt viszont a jelenlegi self-check-ek nem tudják igazolni). **Nincs bizonyíték arra**, hogy bármelyik konkrét write-guard KÓDJA hibás lenne — csak arra, hogy **soha nem lett valósan próbára téve**. A tényleges kód-helyesség megerősítéséhez ugyanaz a módszer kellene, mint az 1. részben: a shim `.in()`-támogatásának pótlása (vagy a próba valós Supabase/PostgREST ellen), majd a meglévő negatív tesztek újrafuttatása.

---

## Nem érintett / scope-on kívül

- A shim.mjs-be **nem került végleges javítás** (harness-only fájl, nem repo-kód; a `.in()`-támogatás pótlása külön döntés, ha a csapat úgy ítéli, hogy megéri a self-check-infrastruktúra befektetést).
- A talált MAGAS/KÖZEPES kockázatú write-guard/kapu-eltérések **kód-oldali javítása** nem történt meg — a feladat explicit diagnózist kért, listázást, nem fixet.
- `seed.ts` saját, hasonló `group_id`-hiánya (a `INPUT_ITEMS` konstansban) — ez KÜLÖN, ismert, dokumentált (korábbi munkamenet) gap, teszt-adatot érint, nem éles kódutat; nem lett újra vizsgálva, mert kívül esik a mostani scope-on.

## Ajánlott következő lépés (nem végrehajtva, döntésre vár)

A (2) MAGAS kategória (P1 kemény kapu + 6 write-guard) érdemel egy külön, célzott csomagot: **(a)** a shim `.in()`-támogatásának pótlása (kis, jól körülhatárolt PR a `parseFilters()`-ben — a regex bővítése `in\.\((.*)\)$` mintára + `IN ($1,$2,…)` SQL-generálás), majd **(b)** a meglévő "negatív teszt" walkthrough-ok újrafuttatása a valós szűrő ellen, hogy VALÓBAN igazolják, amit eddig csak állítottak.

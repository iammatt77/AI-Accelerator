# Záró jelentés — TO-BE „dokumentumból" út felzárkóztatása az entitás-útra

**Dátum:** 2026-07-30
**Branch:** `dev`
**Előzmény:** `docs/state/2026-07-30-tobe-doc-path-compliance-check.md` (a két út összevetése).

---

## Összefoglaló

A compliance check kimutatta: a séma (`graph_json`), a parszolás (`parseProcessProposal`) és a
perzisztálás (`layoutGraph` + `.insert()`) **100%-ban közös kód** a két TO-BE út között — sehol
nincs `type: "step"`-féle szűrés (grep-pel megerősítve). A javítás ezért **kizárólag a
dokumentum-út promptját** (`extractProcessMap`, `src/lib/llm/index.ts`) és a hozzá tartozó
hibaközlést érinti. **Az entitás-út (`suggestToBeProcess`/`suggestToBeAction`) egyetlen sora sem
változott.**

## Mi változott

### 1. `extractProcessMap` (`src/lib/llm/index.ts:781-838`)

- **`max_tokens`: 6000 → 16000.** A dokumentum-út egyedi terhelése (a teljes nyers forrás +
  KÖTELEZŐ szó szerinti idézet node-onként) a korábbi kereten csonkolódhatott egy gazdag,
  16-lépéses/több-gateway-es forráson. 16000 a nem-streamelő SDK-hívásoknál biztonságos felső
  határ (Anthropic API — 1M kontextus, 128K max output; a nem-streaming HTTP-időtúllépés elleni
  ajánlott felső korlát ~16K).
- **`stop_reason === "max_tokens"` felismerés.** Ha a válasz csonkolt, a függvény **explicit**
  `PROCESS_MAP_TRUNCATED` hibát dob — ezt korábban a parse némán üres gráfként nyelte volna el,
  megkülönböztethetetlenül a "tényleg nincs folyamat" esettől.
- **Rendszerprompt-bővítés** (kizárólag ennek a függvénynek a saját `system` tömbjében, a
  MEGOSZTOTT `PROCESS_SHAPE` konstans érintetlen):
  - explicit tiltás a JSON-t övező prózára ("magyarázó szöveget... SEM a JSON előtt, SEM utána"),
  - **valódi Parallel Split/Join** (AND-szemantika) megkülönböztetése a döntéstől — dedikált
    `parallel_split`/`parallel_join` típusnév-javaslat, címke NÉLKÜLI ágakkal,
  - **visszaugró él/ciklus** explicit engedélyezése — korábban egyik prompt sem tért ki erre,
  - **több végpont** explicit engedélyezése (több `start_end` node egy gráfban).

### 2. `generateProcessMapAction` (`src/app/process-actions.ts:108-116`)

A `catch` ág megkülönbözteti a `PROCESS_MAP_TRUNCATED` jelzést a többi hibától, és külön
`errTruncated` üzenetet ad — a `suggestToBeAction` (entitás-út) `catch`-ága **változatlan**.

### 3. Hibaüzenetek (i18n, `messages/hu.json` + `messages/en.json`, `processMap` névtér)

- **`noticeNoSteps` átfogalmazva** — konkrétabb, a "tényleg üres" esetre szűkítve, tettre
  ösztönző ("próbálj konkrétabb, lépésekre bontott szöveggel"), a "nézd meg a forrást"
  félrevezető megfogalmazás helyett.
- **Új kulcs: `errTruncated`** — "A modell válasza a forrás terjedelme/összetettsége miatt
  csonkolt lett — bontsd rövidebb szakaszra a forrást, és generáld külön-külön." Ez most fel se
  merül a valódi-üres esettel összetévesztve.

### 4. MOCK-fixture gazdagítása (`src/lib/llm/index.ts`, `mockExtractProcessMap` + új
`mockExtractRichProcessMap`)

A self-check eddig **mindig** ugyanazt az egy-gateway, párhuzam/ciklus/több-típus/több-végpont
NÉLKÜLI 7-lépéses fixture-t adta vissza, függetlenül a forrás struktúrájától — ez volt a
**harmadik bizonyított MOCK-rés** ebben a projektben (a group_id- és a shim-`.in()`-eltérés
után). A javítás: `isGatewayRichSource()` egy durva heurisztikával (10+ számozott lépés a
forrásban) tartalom-érzékennyé teszi a mockot — ha a forrás gateway-gazdag, nem-lineáris
struktúrát ír le, egy ÚJ, 16 node-os fixture-t ad (`mockExtractRichProcessMap`), amely
tartalmazza mindazt, amit a régi fixture nem: **3 gateway** (`decide`) címkézett ágakkal, **1
valódi parallel_split→parallel_join** pár, **1 visszaugró él/ciklus**, **8 különböző
node-típus**, **4 végpont** (`start_end`). A régi, nem-számozott (pl. a demo-transzkript
mintájú) forrásokra a fixture **változatlan** marad — nincs regresszió a meglévő walkthrough-okra.

## Séma-migráció? **NEM történt.** A `graph_json` és a `process_maps` tábla érintetlen.

---

## Verifikáció — **MOCK_LLM=1 alatt futott, NEM valós LLM-en**

A verifikáció kifejezetten **nem-lineáris, gateway-gazdag** fixtúrán futott (a "[7] teszt to be"
szerkezetét idéző, 16 számozott lépéses, saját szerkesztésű forrásszöveg — mivel a tényleges
forrás szövege soha nem érkezett meg egyik korábbi diagnosztikai üzenetben sem, ezért egy hű,
strukturálisan egyenértékű rekonstrukciót használtam).

### 1) Egység-szintű (`extractProcessMap` valós hívása MOCK_LLM alatt) — **10/10 OK**

- nem üres gráf, pontosan 16 node,
- 8 különböző node-típus,
- 3 gateway (`decide`), mindegyik ≥2 CÍMKÉZETT ággal,
- ≥1 `parallel_split` + ≥1 `parallel_join`, a split ágai CÍMKE NÉLKÜLIEK (AND-szemantika),
- ≥1 visszaugró él (`s5→s3`, azonosítva id-sorrend alapján),
- ≥3 `start_end` végpont (ténylegesen 4),
- minden él létező node-ra hivatkozik.

### 2) Végponttól-végpontig (valós Next server action, `generateProcessMapAction(kind="to_be")`, javított shim → valós Postgres) — **11/11 OK**

Playwright: a gateway-gazdag forrás input_item-ként bekerül a DB-be → a "TO-BE generálása a
dokumentumból" gomb kiválasztja → a valós server action lefut → redirect a térkép-nézetre
(NEM marad az index oldalon "nincs lépés" vagy "csonkolt" üzenettel) → DB-oldali bizonyíték:
1 `to_be`/`to_be_origin="document"` `process_maps` sor, 16 node, 8 típus, `parallel_split` +
`parallel_join` mentve, 4 végpont mentve.

### 3) Regresszió — **5/5 OK**

- a régi, NEM-számozott (demo-transzkript-szerű) forrásra a RÉGI, egyszerű 7-lépéses fixture jön
  (a gazdagítás nem szivárgott át más forrásokra),
- a rövid (<40 kar.) forrás továbbra is üres gráfot ad (a meglévő negatív teszt megtartva),
- **az entitás-út (`suggestToBeProcess`) bizonyítottan VÁLTOZATLAN**: ugyanaz a 8-lépéses,
  `ai_intervention`+`control_hitl` node-okat tartalmazó fixture, mint korábban.

### Minőség-kapuk

| Kapu | Eredmény |
|---|---|
| `tsc --noEmit` | **0 hiba** |
| `npm run i18n:check` | **OK — 1868 kulcs, mindkét nyelven azonos** (1 új kulcs: `errTruncated`) |
| Prod build (`next build`) | **zöld** |
| Egység-szintű (gateway-gazdag mock) | **10/10** |
| Végponttól-végpontig (valós server action) | **11/11** |
| Regresszió (egyszerű mock + entitás-út) | **5/5** |

---

## MOCK vs. valós — explicit

**Ez a teljes verifikáció `MOCK_LLM=1` alatt futott.** A `max_tokens`-emelés és a
`stop_reason`-alapú csonkolás-felismerés a valós LLM-ágban él (`extractProcessMap` `:820-838`),
de MOCK alatt ez az ág nem fut le (`isMock()` korai visszatérés) — a mock-fixture-gazdagítás
bizonyítja, hogy a **kód-út** (parse → layout → perzisztálás) helyesen kezeli a gazdag,
nem-lineáris struktúrát, de **nem** bizonyítja, hogy a valós Anthropic-modell ténylegesen ilyen
JSON-t termel a 16000 tokenes keretben egy valódi, "[7] teszt to be"-szerű forrásra.

**A max_tokens-emelés valós hatásának megerősítéséhez** Máténak — ahol van API-elérés — a
korábbi diagnózisban leírt módon kell futtatnia egy valós hívást (`MOCK_LLM=""`,
`extractProcessMap` közvetlen hívása vagy a `stop_reason`/`usage.output_tokens` naplózása egy
valós `client.messages.create`-ből) a TÉNYLEGES "[7] teszt to be" forrásra, és ellenőriznie:
`stop_reason !== "max_tokens"` (nem csonkolt), és a JSON parse sikeres. Ha a 16000-es keret is
kevésnek bizonyul egy különösen nagy forrásra, azt a `stop_reason==="max_tokens"` felismerés
mostantól **explicit, felhasználó-barát `errTruncated` üzenetként** jelzi (nem a félrevezető
"nincs lépés"-ként) — ez a hibaosztály immár megkülönböztethető, függetlenül attól, hogy a konkrét
16000-es érték elegendő-e minden jövőbeli forrásra.

---

## Takarítás

Lokális verifikációs stack (PG16 + PostgREST-shim + Next app) leállítva, `.env.local` törölve.
A verifikációs szkriptek a scratchpad-területen maradtak (harness-only, nem repo-kód). Ez a
commit kizárólag az alkalmazás-kód és a záró jelentés módosításait tartalmazza.

# Epic 4 · 4.1 — Backend compliance check (Elavulás-modell kiterjesztése)

**Dátum:** 2026-07-23 · **Branch:** `dev` · **Spec:** Refounded_Epic4_41_spec v0.1 (Approved) + tervezési dok. v0.2
**Jelleg:** tisztán adat-réteg, felület nélkül (mint a 2.1 / Csomag C1). Ez a dokumentum a kötelező első lépés: **valós leltár, mielőtt bármit módosítok.**

**Összegzés: NINCS STOP.** A leltár a spec minden premisszáját megerősíti. A spec két nyitott kérdését (7.1 horgony-konvenció, 7.2 particionálás vs. iterative scan) a lenti (1) és (5) pont dönti el, dokumentált indoklással.

---

## (1) A `knowledge_catalog` horgony-szerkezete + a `stale_acks` polimorf minta

### A katalógus cédula-szerkezete (0015)
A `knowledge_catalog` **derive-only nézet** (nulla írás), minden ága azonos cédula-oszlopokat ad:
- `block_type` (text) — a tudáselem fajtája (tábla-szintű megkülönböztető: `pain_point`, `use_case`, …, `artifact`, `process_map`, `artifact_field`)
- `block_id` (text) — a hordozó sor uuid-ja szövegként; **`artifact_field` cédulánál NULL**
- `artifact_id` (uuid) + `field_key` (text) — a D1/artifact-mező cédulák horgonya; entitás-cédulánál mindkettő NULL

Vagyis a cédula **négyoszlopos**, és **kétféle** horgony-alak létezik:
- **entitás-cédula:** `block_type` + `block_id` (artifact_id/field_key = NULL)
- **`artifact_field` cédula:** `artifact_id` + `field_key` (block_type=`'artifact_field'`, block_id = NULL)

### A `stale_acks` polimorf minta (0013)
```
stale_acks(project_id, subject_type text, subject_id text, kind, acked_at,
           unique(subject_type, subject_id, kind))
```
**EGY** polimorf szöveg-pár: `subject_type` + `subject_id`. A mai írók (`PhaseWorkspace`, `BuildComponentDetail`, `BuildDocBoard`) mind egyértékű alanyt írnak: `pain_point`/`use_case`/`stakeholder`/`build_component`/`artifact` + a sor uuid-ja. **Fontos: az `artifact` subject_type ma a TELJES artifactot horgonyozza (`subjectId = artifact.id`), sosem egy mezőt.** Vagyis az `artifact_field` (artifact_id + field_key) horgonyt a `stale_acks` **ma nem valósítja meg.**

### Döntés (a spec 7.1 nyitott kérdésére)
A `stale_acks` mintája — polimorf szöveg-alany + `project_id` + `unique` — **konvencióban átvehető, de változatlanul NEM elég**: az `artifact_field` cédula **kétértékű** horgony (artifact_id + field_key), amit egyetlen `subject_id` csak kódolással (`"<artifact_id>::<field_key>"`) tudna hordozni — az pedig törékeny és nem kérdezhető szűrhetően.

**Ezért az új metaadat- (és embedding-, finding-, dismissal-) táblák a `knowledge_catalog` SAJÁT négyoszlopos cédula-alakját veszik át** (`block_type`, `block_id`, `artifact_id`, `field_key`), egy CHECK-kényszerrel, amely pontosan az egyik horgony-alakot engedi (entitás-cédula VAGY artifact_field-cédula, kizárólagosan). Ez a `stale_acks` polimorf szellemének **felfelé kompatibilis kiterjesztése**, és natívan illeszkedik a katalógushoz, amit fogyasztunk. Ez a dokumentált **ok az eltérésre** a spec 7.1 értelmében.

---

## (2) pgvector + meglévő embedding-infrastruktúra

- **pgvector: NINCS engedélyezve.** A migrációkban egyetlen `create extension` van: `pgcrypto` (0001). A `vector` extension sehol. → **A spec §5 ezt EXPLICIT módon várja** („ha nincs engedélyezve, engedélyezendő — extension, nem migrációs kockázat”). Nem STOP.
- **Embedding-infra: NINCS.** A kódbázisban egyetlen „embedding” előfordulás egy MOCK-fixture leírásában van (`llm/index.ts:1625`, egy demó doc-típus szövege) — nincs valódi vektor-generálás, -tárolás vagy -lekérdezés.
- **Lokális harness következmény:** a PG16 harness-ben a `vector` .so/control NINCS telepítve, **de** a `postgresql-16-pgvector` apt-csomag elérhető. A hasonlósági-lekérdezés SQL-alakja így lokálisan verifikálható lesz (extension telepítés + determinisztikus MOCK-embedding), a **valós** vektor-dimenzió és rangsor viszont csak valós szolgáltatóval (BGE-M3) + valós Supabase-szel — lásd a verifikációs tervet lent.

---

## (3) Az `src/lib/llm` adapter mint minta

`src/lib/llm/index.ts` — **egyetlen belépő, csatorna-független interfész**, a governance magja:
- `import "server-only"` (build-időben kikényszeríti: nincs kliensre-szivárgás)
- provider-konfiguráció env-változóval: `getModel()` ← `ANTHROPIC_MODEL`, `getClient()` ← `ANTHROPIC_API_KEY` (hiányzik → dobás)
- `isMock()` ← `MOCK_LLM=1` — determinisztikus fixture-ág minden hívásnál
- a hívó nem ismeri a szolgáltatót; a váltás (Bedrock/Vertex EU) a hívó érintése nélkül történik

**Az embedding-adapter EZT a mintát követi** külön modulban (`src/lib/embeddings/`): `EMBEDDING_PROVIDER_URL` / `EMBEDDING_API_KEY` / `EMBEDDING_MODEL` + `EMBEDDING_MODEL_VERSION` env-változók, `server-only`, `MOCK_EMBEDDINGS=1` determinisztikus ág (a self-check-hez), OpenAI-kompatibilis `/embeddings` endpoint (BGE-M3 hosted). A modell nevét+verzióját a hívás visszaadja, hogy a vektor mellé eltárolható legyen (F4).

---

## (4) Meglévő nyelv-/idő-/forrás-attribúció mezők (újrahasznosítás)

A ~12 forrás-entitás egyike sem hordoz **modalitás / érvényességi idő / nyelv / szervezeti szint / hatókör** mezőt. Ami VAN:
- `source_input_ids: string[]` — **minden** tudáselemen: provenancia a nyers `input_items`-re. (A forrás-attribúció „forrás-típus”/„ki mondta” alapja részben ebből derivál.)
- `input_items.stakeholder_source_id` — melyik stakeholdertől jött a nyers input → a **személy/szerep** attribúció részleges alapja
- `input_items.type` — a nyers forrás fajtája → a **forrás-típus** (dokumentum/interjú/…) részleges alapja

**Következtetés:** a forrás-attribúció **személy** és **forrás-típus** dimenziója részben derivál a meglévő provenanciából; a **szervezeti szint** (`hq`/`helyi`/`külső`/`ismeretlen`), a **modalitás**, az **érvényességi idő**, a **nyelv** és a **hatókör** teljesen új. Ez pontosan megerősíti a spec §2 non-goal-ját („nem töltjük fel visszamenőleg… a mezők léteznek és írhatók”). Nem duplikálunk: a metaadat-tábla a személy-attribúciót a `stakeholders`-re mutató hivatkozásként tárolja (nem másolt névként), a forrás-típusnál pedig az `input_items.type` az alap.

---

## (5) Hasonlósági lekérdezés: particionálás vs. iterative scan (a mi adatméretünknél)

**Adatméret (valós):** egyfelhasználós belső eszköz, projektenként dolgozunk. Tudáselem/projekt: tucattól alacsony pár-százig; összprojekt-szinten alacsony ezres nagyságrend. **Ez pgvector-mértékkel triviálisan kicsi.**

**A HNSW post-filter probléma** (a spec figyelmeztetése): ANN-index (HNSW) esetén a `WHERE` szűrő a szomszéd-kereséS UTÁN érvényesül, így szelektív szűrőnél a `LIMIT k` kevesebb sort adhat vissza a kértnél.

**Döntés (a spec 7.2 nyitott kérdésére): EGYELŐRE NINCS ANN-index — pontos (flat/exact) KNN, `WHERE` metaadat-ELŐszűréssel.**
- Index nélkül a pgvector pontos szomszéd-keresést végez (`ORDER BY embedding <=> $q LIMIT k`), és a `WHERE` (hatókör, modalitás-család) **normál elő-szűrőként** fut le a pontos scan előtt → a szűrés **ténylegesen érvényesül** (F5), a post-filter hiány fogalmilag nem létezik.
- A mi ezres nagyságrendünknél az exact scan sub-milliszekundumos; index nincs, amit karban kellene tartani.
- **Halasztott (skálázáskor):** ha egy projekt tudáseleme sok ezres nagyságrendbe nőne, akkor HNSW-index + **particionálás projektenként** (a `WHERE project_id` amúgy is minden lekérdezésben ott van, tehát a partíció-elmetszés ingyen jár) VAGY pgvector `iterative_scan = strict_order` (pgvector 0.8+). A partíció a mi esetünkben a természetesebb, mert a lekérdezés mindig projekt-hatókörű; az iterative scan verziófüggő. Ezt most **nem** építjük — a scope-ot tartjuk.

Ez azt is jelenti, hogy a hasonlósági lekérdezés egy **RPC-függvény** lesz (a PostgREST/shim nem tud `<=>` operátort URL-ből), ami a lokális shim `/rest/v1/rpc/<fn>` átjáróján verifikálható.

---

## Verifikációs terv (valós vs. MOCK — előre kimondva, a spec §6 szerint)

| Réteg | Hogyan verifikálom | Valós / MOCK |
|---|---|---|
| Metaadat dual-anchor (entitás + artifact_field), modalitás-CHECK, tstzrange, F9 kötelező indoklás | lokális PG16 + server actionök + SQL | **valós relációs** (MOCK-embedding nélkül is) |
| `superseded_by` él (indoklás kötelező, nem-törlés, lekérdezhető ok) | lokális PG16 + server actionök | **valós relációs** |
| Finding entitás + állapotgép (feloldható vs. lelet ág), sticky dismissal + tartalom-lenyomat | lokális PG16 + server actionök | **valós relációs** |
| Embedding hasonlósági-lekérdezés SQL-ALAKJA + metaadat-előszűrés tényleges érvényesülése | lokális PG16 + `postgresql-16-pgvector` telepítés + **determinisztikus MOCK-embedding** | **MOCK-embedding, valós SQL** |
| Embedding-GENERÁLÁS valós BGE-M3-mal, valós vektor-dimenzió + hasonlósági rangsor | **valós BGE-M3 hosted API + valós Supabase pgvector** | **HALASZTOTT — Máté környezete** |

**Előre kimondom (a spec explicit kérése):** a valós embedding-szolgáltató (BGE-M3) és a valós Supabase-pgvector **ebben a coding-környezetben nem elérhető** (nincs BGE-M3 kulcs; a lokális stack shim + PG16). Ezért a záró jelentés úgy fog zárni, mint a migrációknál: a relációs + SQL-alak részek valósan verifikáltak, a **valós-szolgáltatós embedding-generálás + rangsor Máté környezetében futtatandó** (a migrációk kézi-futtatásával egy kategóriában). Ez a spec §6 „mi futott valós szolgáltatóval, mi MOCK-on” követelményének betű szerinti teljesítése.

---

## Migráció + scope

- **Migráció VÁRHATÓ** (új táblák + `create extension vector`). A repo konvenciója szerint megírom, **de nem futtatom élesben** — Máté futtatja a Supabase SQL-editorból (a záró jelentés ezt kimondja). A lokális harness-ben én futtatom a verifikációhoz.
- **NEM érintem:** a 2.1 rétegét (`knowledge_catalog`, `artifact_render_links`, `lib/catalog` — fogyasztva), a meglévő jelölőket (`doc_stale`/`render_stale`/origin drift), a teljes Epic 3 felületet, magát a felismerést (4.2), a modalitás LLM-osztályozását (4.2), a 4.3/4.4/4.5-öt. A 4.1 **mellé**épít.
- **NF2 (metaadat nélkül is működik):** minden új tábla üres-tolerálható; semmi nem válik kötelezővé visszamenőleg. Az egyetlen KÖTELEZŐ-kényszerek az ÍRÁS pillanatában érvényesek (modalitás-CHECK alapérték `ismeretlen`; `superseded_by`/elavítás/dismissal indoklás NOT NULL) — nem a meglévő adatra.

**Következő lépés:** implementáció négy egységben (4.1-a metaadat · 4.1-b embedding · 4.1-c felismerés-tárolók · 4.1-d server actionök), staged commitokban, majd verifikáció a fenti terv szerint + záró jelentés + push.

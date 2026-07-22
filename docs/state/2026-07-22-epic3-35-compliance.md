# Epic 3 · 3.5 — backend compliance check (valós leltár)

**Dátum:** 2026-07-22 · **Branch:** `dev` · **Spec:** Refounded_Epic3_35_spec v0.1
**Eredmény: NINCS STOP.** A renderelés+elavulás-kötéshez szükséges tábla (`artifact_render_links`) **létezik**; egyetlen szűk, additív pontban hiányos — ez migrációt igényel, de **nem új sémát**, hanem egy meglévő CHECK-constraint egy értékkel bővítését (a 0015 saját, korábban már alkalmazott mintája szerint — lásd 3. pont). Ez NEM esik a spec STOP-feltétele alá ("perzisztált él-tábla, ami ma nincs") — a tábla megvan, csak a domain-listája szűk.

---

## (1) A jóváhagyott TO-BE folyamattérkép struktúrája

- **Tábla:** `process_maps` (`kind='to_be'`), oszlopok: `status` (`artifact_status` enum: draft/in_review/**approved**), `version`, `nodes`/`edges` (jsonb), `source_input_id` (uuid|null, EGYETLEN nyers-hivatkozás, nem tömb), `to_be_origin` (`document`|`ai_suggested`|null), `updated_at`.
- **„Jóváhagyott" jelző:** egyértelmű — `status = 'approved'`. A **kiválasztó függvény MÁR LÉTEZIK**: `resolveApprovedToBe(maps)` (`src/lib/solution/model.ts:91`) — a legmagasabb verziójú approved TO-BE sort adja vissza, `null` ha nincs ilyen. Ezt használja ma is a P3 Megoldás-tervező dokkolás (`ComponentDetail`/solution-oldal).
- **Node/él struktúra a rendereléshez:** `graphFromJson(nodes, edges)` (`src/lib/processmap/parse.ts:190`) → `{nodes: ProcessNode[], edges: ProcessEdge[]}`, defenzív parse. `ProcessNode`: `id·title·sub·type·desc·open_points`; a típusok között `ai_intervention`/`control_hitl` (a beavatkozási pontok), `decide` (elágazás). `ProcessEdge`: `from·to·label` — a `decide`-csomópontból induló TÖBB él = elágazás, a `label` az ág felirata. A csomópont-sorrend a tárolt sorrend (Sugiyama-layout eredménye) — **`spineFromMap(map)` (`solution/model.ts:99`) már ezt a sorrendet adja vissza** számozott lépésekként (`SpineStep{nodeId,ord,num,title,type}`).
- **Következtetés:** a rendereléshez szükséges MINDEN adat és a jóváhagyott-lekérdezés MÁR LÉTEZIK, újrahasznosítható (nem a solution modul módosításával, hanem importálással).

## (2) A meglévő D2-renderelő útvonal — hol él, újrahasznosítható-e

Két élő D2 minta, **azonos váz**, mindkettő `src/app/artifact-actions.ts`-ben:
- **Use case-rangsor** — `generateShortlistFromEntitiesAction` (~678. sor): forrás = megerősített `use_cases`; determinisztikus mező-komponálás (HU szöveg, `state:"confirmed"`); mentés draft-frissítés VAGY új sor; **renderelés-élek írása** (`replaceRenderLinks`, field_key=null = teljes-dokumentum); `logDecision`; `revalidateWorkspace`.
- **Megoldási javaslat** — `generateSolutionPlanFromEntitiesAction` (~678→990. sor): forrás = megerősített `solution_components` + HITL-nyertes `component_options`; ugyanaz a váz; render-élek 3 cél-típusra.
- **A minta pontosan újrahasznosítható**: egy harmadik akció (`generateToBePlanFromMapAction`) ugyanezt a vázat követi — forrás `resolveApprovedToBe()` + `spineFromMap()` + `graphFromJson().edges`, egyetlen render-cél (`process_map`, a térkép egésze, field_key=null — mint a shortlistnél).
- **A prózai `body` generálása KÜLÖN lépés, LLM-mel**: `generateBodyAction` (artifact-actions.ts:1140) — típus-agnosztikus, a `typeDef.fields` `confirmed`/`manual` értékeiből épít promptot (`lib/llm.generateBody`, MOCK_LLM-kompatibilis). A TO-BE terv ezt **változtatás nélkül** használja (F5 — nincs új mechanizmus a body-lépéshez).
- **Citáció-korlát (őszinte megállapítás):** a `ProcessNode.source_ref` EGY objektum (`{ref,quote,loc}`) csomópontonként, NEM a `source_input_ids: string[]` + pozicionális `[n]`-rendszer, amit a shortlist/Megoldási javaslat használ (azok `use_cases`/`solution_components` `source_input_ids` tömbjeiből vezetik le a `[n]`-eket). A TO-BE terv mezői ezért **üres `source_indices`-szel** készülnek (nincs numerikus citáció) — ez A CODEBASE-BEN MÁR HASZNÁLT, elfogadott minta (pl. a shortlist `ertekelesi_szempontok` mezője is üres indices-szel megy, mert nincs egyetlen-forrás alapja). Az artifact-szintű `source_input_ids` a térkép saját `source_input_id`-jából tölthető (ha van), tisztán provenancia-jelleggel — nem `[n]`-hivatkozás.

## (3) A `render_stale` réteg (`artifact_render_links`) — kifejezhető-e a térkép→terv él

- **A tábla és a derive-logika megvan** (Csomag C1, 0015. migráció): `artifact_render_links(project_id, artifact_id, field_key, target_type, target_id, rendered_at)` + `renderStaleSinceForArtifact()` (`src/lib/catalog.ts:337`, a cél-táblák `updated_at`-ját veti össze az él `rendered_at`-jával).
- **HIÁNYOSSÁG (szűk, additív):** a `target_type` oszlop CHECK-constraint-je (0015. migráció, 56. sor) ma **7 értéket** enged: `use_case, solution_component, component_option, build_component, prompt_item, control_point, eval_case` — **`process_map` NINCS köztük.** Ugyanez a szűkítés a TS-oldali `RenderTargetType` union-ban (`src/lib/db/types.ts:463`) és a `renderStaleSinceForArtifact` belső `TABLE_OF` leképezésében (`catalog.ts:349`) is megvan.
- **Ez NEM "hiányzó perzisztált él-tábla"** (a spec STOP-feltétele) — a tábla és a mechanizmus létezik, csak a domain-lista szűk. **Ugyanezt a mintát a 0015. migráció maga is alkalmazta**: a `stale_acks.kind` CHECK-et bővítette `render_stale`-lel (`drop constraint` + `add constraint`, idempotens). A 3.5-a/b implementációja **egy 0016. migrációt** ad ehhez: `artifact_render_links.target_type` CHECK bővítése `'process_map'`-pal, ugyanazzal az idempotens drop+add mintával — **egy sor, egy tábla, nincs új tábla/oszlop**. Ez összhangban van a spec 7. pontjának (Nyitott kérdések) saját várakozásával: „ha kell egy sor az `artifact_render_links`-be… a meglévő tábla használata, nem új séma."
- **A TS-oldali `TABLE_OF` bővítése** (`process_map → process_maps`, `projectScoped:true`) szükséges a `renderStaleSinceForArtifact` működéséhez — ez nem migráció, kód-módosítás.

## (4) Maradvány field-extract kód a TO-BE tervhez

- **A típus ma `retired:true`** (`src/lib/artifacts/config.ts:302-312`) — a Csomag A (A6) vezette ki, indoklás a kódkommentben: „a TO-BE igazság-forrása a Folyamattérkép TO-BE entitása; a párhuzamos, összekötetlen dokumentum-reprezentáció megszűnik." A `typesForPhase()` (`config.ts:417`) kiszűri a retired típusokat — a TO-BE terv **ma sehol nem jelenik meg** (sem a ②-ben, sem a ③-ban).
- **Nincs KÜLÖN field-extract kód a TO-BE tervhez** — a régi (kivezetés előtti) mechanizmus a GENERIKUS `extractAction`/`ExtractForm` util volt (ugyanaz, mint bármely D1 típusnál), amit kizárólag a `retired:true` flag rejtett el. Nincs eltávolítandó, TO-BE terv-specifikus extrakciós kód — a típus `entitySourced:true`-ra állítása magától kizárja a generikus extract-utat is (a `docTypeOf()` D2-t ad, a ② zóna a 3.2-ben már `docTypeOf==="D1"` szerint szűr).
- **Grep-ellenőrzés** (`to_be_lepesek`, `beavatkozasi_pontok`, `hitl_kontrollok`, `valtozas_hatasa`, `toBeTerv`): kizárólag `config.ts`-ben fordul elő. Más találat (`process-actions.ts`, `lib/llm/index.ts`) a folyamattérkép TO-BE-**generálásához** tartozik (más funkció — a tool maga, nem a dokumentum) — érintetlen marad.

## Kódolási terv-következmények (a leltárból)

- **0016. migráció** (egyetlen ALTER, idempotens): `artifact_render_links.target_type` CHECK + `'process_map'`.
- **`src/lib/db/types.ts`:** `RenderTargetType` + `"process_map"`.
- **`src/lib/catalog.ts`:** `renderStaleSinceForArtifact` `TABLE_OF` + `process_map: {table:"process_maps", projectScoped:true}`.
- **`src/lib/artifacts/config.ts`:** `TO_BE_TERV` → `retired:false`, `entitySourced:true` (D2-vé válik automatikusan a `docTypeOf()`-ban, kód nélkül).
- **`src/app/artifact-actions.ts`:** új `generateToBePlanFromMapAction` — `resolveApprovedToBe`/`spineFromMap`/`graphFromJson` importtal a `lib/solution/model` és `lib/processmap/parse` modulokból; nincs jóváhagyott térkép → `{ok:false, error: toBePlanNeedsApprovedMap}` (defenzív — az UI a gombot eleve nem mutatja); render-élek 1 célra (`process_map`, a térkép id-ja, field_key=null).
- **`src/components/EntityForms.tsx`:** új `GenerateToBePlanForm` (a két meglévő minta alapján).
- **`src/components/PhaseWorkspace.tsx` (`OutputCard`):** a `typeDef.key === "Megoldási javaslat" ? … : …` háromágúra bővül; a TO-BE terv ágon ELŐBB ellenőrzi van-e jóváhagyott TO-BE térkép (a már betöltött P2 `process_maps`-ból) — ha nincs, függőség-üzenet a `/process` toolra mutató linkkel, a generálás-gomb NEM jelenik meg (F2); a `docStaleBadges` blokk változatlan marad (generikus, a `renderStaleSinceForArtifact`-ot már minden artifactra lefuttatja).
- **i18n:** `errors.toBePlanNeedsApprovedMap`, `entities.generateToBePlanCta/Hint/generatingToBePlan/toBePlanFieldsDone`, `workspace.toBePlanNeedsMap` (a függőség-üzenet szövege) — HU/EN.

# Függés-leltár — minden „A épül B-re" viszony (JAVÍTÁS NÉLKÜL)

**Dátum:** 2026-09-04 · **Branch:** `dev` · **Jelleg:** csak olvasás + valós
DB-lekérdezések. **Egyetlen kódsor sem változott, migráció nem készült,
detektálás nem került bekötésre.**

**Cél:** a 2026-08-26-i audit hét viszonyt talált; a készülő spec F-4
feltételezés-naplója vállalt kockázatként jelöli, hogy nem tudjuk, ez-e a
teljes készlet. Ez a dokumentum lezárja a feltételezést.

**Módszer:** (1) a teljes séma valós PG16-ból kiolvasva — 37 tábla
időbélyeg-oszlopai és mind az 58 idegenkulcs `ON DELETE` szabálya; (2) mind a
**60 `.update()`** és mind a **17 `.delete()`** hívóhely gépi felsorolása és
payload-onkénti átvizsgálása; (3) a 16 server-action fájl és a származtató
lib-ek (`staleness`, `catalog`, `doc-stale`, `render-links`, `sources`,
`builddoc/model`, `solution/model`, `knowledge/*`) olvasása; (4) célzott
DB-próbák a fixtúra-adatbázison, BEGIN/ROLLBACK alatt.

**Eredmény számokban:** **53 viszony** azonosítva. Ebből **13 fedett**,
**6 részlegesen fedett**, **27 fedetlen**, **7 fogalmilag tiszta** (nincs
mit detektálni). A spec hét viszonyából **6 megerősítve** (egy közülük
pontosított mechanizmussal), **1 átfogalmazandó**, egyik sem cáfolva.
**21 fedetlen viszony NEM szerepel a hétben** — ebből **6 magas** prioritású.

---

## 0. Az öt működő detektálás pontos hatóköre

A leltár csak ehhez képest értelmezhető, ezért előbb rögzítem, mit fed MA
mindegyik. Több helyen szűkebb, mint amilyennek látszik.

| Detektálás | Mit hasonlít | Mire van bekötve |
|---|---|---|
| `source_updated` | a hivatkozott forrás-csoportban van-e újabb verzió (`staleness.ts:26-48`) | **kártya-szinten CSAK 3 alanyra:** pain_point, use_case, stakeholder (`PhaseWorkspace.tsx:348, 904, 973`). **Csempe-szinten** (aggregált, ack NÉLKÜL) requirements · solution · builddoc · goldenset (`preview-data.ts:357, 396, 439, 457`). **Dokumentumra SEHOL.** |
| `origin_drift` | `solution_components.updated_at > build_components.seeded_at` | build-komponens kártya + P3 csempe (`builddoc/page.tsx:137-141`, `preview-data.ts:429`) |
| `doc_stale` | `max(entitás.updated_at) > artifacts.synced_at` | **CSAK 3 típusra:** Megoldás-dokumentáció (build_components + prompt_items + control_points), Tesztriport (golden_sets + eval_cases), Megoldási javaslat (solution_components) — `doc-stale.ts:26-61` |
| `render_stale` | `cél.updated_at > artifact_render_links.rendered_at` | 8 cél-típus (`catalog.ts:349-359`); **élt csak a 4 generálás/sync action ír** (`render-links.ts:16-18`) |
| címke-lenyomat | `contentFingerprint(cédula-szöveg) ≠ tárolt lenyomat` | a cédula SZÖVEGE (`labeling.ts:390`, 0020) |

**Két szerkezeti korlát, ami több leletet magyaráz:**

- **Mind az öt detektálás „valamilyen időbélyeg NŐTT" alakú.** A törlés soha
  nem növel maximumot → **egyetlen detektálás sem lát törlést** (részletesen
  a 6. pontban).
- **A `render_stale` a `component_options`-nál `created_at`-ra esik vissza**
  (`catalog.ts:367-371`), mert a táblának nincs `updated_at`-ja. Egy már
  létező sor `created_at`-ja definíció szerint korábbi, mint a rá mutató él
  `rendered_at`-ja → **ezen a cél-típuson a render_stale sosem szólal meg.**

---

## 1. Teljes leltár

Jelölés: ✅ fedett · ⚠️ részleges · ❌ nincs · ⬜ fogalmilag tiszta (nincs mit
detektálni) · **🔎** = bizonytalan, hogy valódi függés-e (nem döntöm el).

### A) forrás → entitás / térkép / dokumentum

| # | Forrás (B) — mi változhat | Ráépülő (A) — mi avul el | Van? | Melyik | Mi hiányzik | Hol dől el |
|---|---|---|---|---|---|---|
| R-01 | input_items új verzió | pain_points | ✅ | source_updated | — | `PhaseWorkspace.tsx:348` |
| R-02 | input_items új verzió | use_cases | ✅ | source_updated | — | `PhaseWorkspace.tsx:904` |
| R-03 | input_items új verzió | stakeholders | ✅ | source_updated | — | `PhaseWorkspace.tsx:973` |
| R-04 | input_items új verzió | requirements | ⚠️ | source_updated (csak csempe, ack nélkül) | sor-szintű jelölés + ack | `preview-data.ts:357` |
| R-05 | input_items új verzió | solution_components | ⚠️ | source_updated (csak csempe) | sor-szintű jelölés + ack | `preview-data.ts:396` |
| R-06 | input_items új verzió | build_components | ⚠️ | source_updated (csak csempe) | sor-szintű jelölés + ack | `preview-data.ts:439` |
| R-07 | input_items új verzió | eval_cases | ⚠️ | source_updated (csak csempe) | sor-szintű jelölés + ack | `preview-data.ts:457` |
| R-08 | input_items új verzió | user_stories (`source_input_ids`) | ❌ | — | csak bekötés (a mező megvan) | `0009` + nincs hívó |
| R-09 | input_items új verzió | prompt_items · control_points (`source_input_ids`) | ❌ | — | csak bekötés (a mező megvan) | `0012` + nincs hívó |
| **R-10** | **input_items új verzió** | **a belőle KIVONATOLT dokumentum-mezők (13 D1-típus: Felmérési riport, Business case, Pilot-terv, Charter, Kickoff, Engagement, Pilot-riport, Döntési brief, Rollout, Impact, Képzési terv, Havi státusz, Javaslat)** | ❌ | — | csak bekötés (`artifacts.source_input_ids` megvan) | `PhaseWorkspace.tsx:1030-1045` — a dokumentum-kártya CSAK doc_stale + render_stale jelölőt kap |
| R-11 | input_items új verzió | process_maps (`source_input_id`) | ❌ | — | csak bekötés | `staleness.ts:90-104` (a helper kifejezetten felkínálja) — **= V4** |
| **R-12** | **input_items.source_kind / org_level utólagos pótlása** | **az érintett cédulák CÍMKÉI** (modalitás-prior, evidencia-prior, forrás-dimenzió) | ❌ | — | időbélyeg (a táblán nincs `updated_at`) **és** bekötés | `source-meta-actions.ts:33-38, 61-78` írja; `sources/meta.ts:33-63` a priorok; a lenyomat csak a szövegre néz (`labeling.ts:390`) |
| R-13 | input_items halmaza/sorrendje | a `[n]` citációk feloldása a mezőkben | ⬜ | — | — | `sources.ts:29-53` — csoport-alapú, append-only, `aliasIndex`: **tervezetten stabil** |

### B) entitás → entitás

| # | Forrás (B) | Ráépülő (A) | Van? | Melyik | Mi hiányzik | Hol dől el |
|---|---|---|---|---|---|---|
| R-14 | pain_points szövege | use_cases (`pain_point_ids`) | ❌ | — | **időbélyeg ÉS bekötés** (`pain_points`-nak nincs `updated_at`-ja) | `entity-actions.ts:243`; a kötés `:402-404` — **= V1** |
| R-15 | pain_points szövege | solution_components + opciók (prompt-bemenet) | ❌ 🔎 | — | nincs perzisztált él; generálás-idejű | `solution-actions.ts:59-70, 97` |
| R-16 | pain_points szövege | TO-BE térkép-javaslat (prompt-bemenet) | ❌ 🔎 | — | nincs perzisztált él; generálás-idejű | `process-actions.ts:145-151` |
| R-17 | use_cases (cím/leírás) | golden_sets → eval_cases | ❌ | — | csak bekötés (`use_cases.updated_at` megvan) | `goldenset-actions.ts:121-126` — **= V7** |
| R-18 | requirements szövege | user_stories (származtatás + forrás-unió pillanatkép) | ❌ | — | bekötés | `requirements-actions.ts:277, 610` |
| R-19 | requirements szövege | acceptance_criteria (az AC a requirement szövegéből készül) | ❌ | — | időbélyeg (`acceptance_criteria`-nak nincs) + bekötés | `requirements-actions.ts:646-693` |
| R-20 | requirements / user_stories | component_links cél-létezés | ❌ | — | bekötés | `builddoc-actions.ts:494-496` |
| R-21 | solution_components | build_components (P2-seed) | ✅ | origin_drift | — | `builddoc/page.tsx:137-141` |
| R-22 | component_options nyertes-váltás | build_components seed-kontextus (`seedCandidates`) | ❌ | — | időbélyeg (opciónak nincs) — az origin_drift csak a komponensét nézi | `builddoc/model.ts:39-58` |
| R-23 | stakeholders | pain_point_stakeholders · stakeholder_requirements kötések | ❌ 🔎 | — | bekötés | `stakeholder-actions.ts:439-504` |
| **R-24** | **stakeholders átnevezése** | **a címkék forrás-dimenziója** (`knowledge_metadata.source_person_stakeholder_id` + a `signals` jsonb-ben tárolt `personName` pillanatkép) | ❌ | — | bekötés (a `stakeholders.updated_at` megvan) | `catalog-actions.ts:74-81` adja át; `labeling.ts` tárolja; a lenyomat nem fedi |
| R-25 | process_maps jóváhagyott TO-BE új verziója | component_links `tobe_node` céljai · control_points.node_id | ❌ | — | bekötés (node-eltűnésnél árva él) | `staleness.ts:73-74` („a törölt cél nem jelöl"), `0010` fejléc |
| R-26 | process_maps | solution_components dokkolás-generálás | ❌ 🔎 | — | generálás-idejű | `solution-actions.ts:91-104` |
| R-27 | requirements / user_stories | epics katalógus-megjelenés (örökölt jóváhagyás) | ⬜ | — | — | `0015` epic-ág: **élő olvasás, nincs pillanatkép** |

### C) entitás / térkép → dokumentum (renderelt tartalom)

| # | Forrás (B) | Ráépülő (A) | Van? | Melyik | Mi hiányzik | Hol dől el |
|---|---|---|---|---|---|---|
| R-28 | use_cases | Priorizált use case-shortlist | ✅ | render_stale | (doc_stale nem fut rá: a shortlist sosem kap `synced_at`-ot) | `artifact-actions.ts:860-866` |
| R-29 | use_cases | Megoldási javaslat (`valasztott_use_case`) | ✅ | render_stale | — | `artifact-actions.ts:1095-1097` |
| R-30 | solution_components | Megoldási javaslat | ✅ | doc_stale + render_stale | — | `doc-stale.ts:55-61` |
| R-31 | component_options **nyertes-váltás** | Megoldási javaslat | ❌ | — | **időbélyeg ÉS parent-bump** (l. 4. és 5. pont) | `solution-actions.ts:432-474` — **= V3** |
| R-32 | process_maps jóváhagyott TO-BE | TO-BE terv | ⚠️ | render_stale (ugyanarra a SORRA igen) | **új jóváhagyott VERZIÓRA nem** (az él a régi sorra mutat) | `artifact-actions.ts:1267-1272` — **= V5, pontosítva** |
| R-33 | build_components | Megoldás-dokumentáció | ✅ | doc_stale + render_stale | — | `doc-stale.ts:26-36` |
| R-34 | prompt_items | Megoldás-dokumentáció | ✅ | doc_stale + render_stale | — | ugyanott |
| R-35 | control_points | Megoldás-dokumentáció | ✅ | doc_stale + render_stale | — | ugyanott |
| **R-36** | **component_links** (kötés felvétele/megerősítése/törlése) | **Megoldás-dokumentáció `komponensek` mezője** — a kötés-feliratok a mezőbe renderelődnek | ❌ | — | **időbélyeg** (`component_links`-nek nincs `updated_at`) **és** parent-bump | `builddoc-actions.ts:771-778` (`syncImplements`), `:498-505, 521, 538` |
| **R-37** | **requirement / story / fájdalompont / TO-BE-node CÍMEI** (és a **pozicionális `FP-nn` / `TO-BE·nn` sorszámok!**) | **Megoldás-dokumentáció kötés-feliratai** | ❌ | — | bekötés; a sorszám ráadásul **pozicionális**: egy fájdalompont felvétele/elvetése ÁTSZÁMOZZA az összes `FP-nn`-t | `builddoc/model.ts:108-127`, renderelve `builddoc-actions.ts:773-777` |
| **R-38** | **solution_components átnevezése** | **Megoldás-dokumentáció eredet-felirata** (`syncOriginP2` a P2-komponens nevét írja a szövegbe) | ❌ | — | bekötés — a doc_stale a Megoldás-dokumentációnál NEM nézi a solution_components-et | `builddoc-actions.ts:768-770`; `doc-stale.ts:26-36` |
| R-39 | golden_sets (küszöb, felülírás-jegyzet) | Tesztriport | ✅ | doc_stale | — | `doc-stale.ts:37-54` |
| R-40 | eval_cases (rögzítés, ítélet) | Tesztriport | ✅ | doc_stale + render_stale | — | ugyanott |
| R-41 | eval_criteria (szöveg-módosítás, felvétel, törlés) | Tesztriport + a tárolt `ai_criteria` pillanatkép | ❌ | — | **időbélyeg ÉS parent-bump** | `goldenset-actions.ts:360-423` — **= V6** |
| R-42 | pain_points szövege | Priorizált use case-shortlist **LÁNCON ÁT** (pain → use_case → doc) | ❌ | — | a lánc első szeme hiányzik (R-14), a második megvan | — **= V2** |
| **R-43** | **artifacts.fields megerősített mezői** | **artifacts.body** (a body a megerősített mezőkből generálódik) | ❌ | — | bekötés (mindkét oldal ugyanazon a soron; `updated_at` van) | `artifact-actions.ts:1356-1372` |

### D) entitás / mező → katalógus, címke, beágyazás

| # | Forrás (B) | Ráépülő (A) | Van? | Melyik | Mi hiányzik | Hol dől el |
|---|---|---|---|---|---|---|
| R-44 | entitás állapota/szövege | knowledge_catalog cédula | ⬜ | — | — | `0015`: **derivált nézet, mindig élő** |
| R-45 | cédula-szöveg | címke (`knowledge_label_signals`) | ✅ | címke-lenyomat | — | `labeling.ts:390`, 0020 |
| R-46 | cédula-szöveg | beágyazás (`knowledge_embeddings`) | ⚠️ | közvetve: az újracímkézés újra-embedel | önálló detektálás nincs; csak a címkézési úton frissül | `labeling.ts:415` |
| **R-47** | **artifact ÚJ VERZIÓ** (`new_artifact_version`) | **az adott típus ÖSSZES mező-cédulája**: a horgony `artifact_id`-t vált → a régi címkék/beágyazások/metaadatok árvák, az új verzió cédulái címkézetlenek, **az emberi címke-javítások elvesznek** | ❌ | — | teljes hiány (a horgony verzió-kötött) | `0003` RPC + `0015` HEAD-szűrés (`a.version = max(...)`) — **valós DB-próbával igazolva, l. 8. pont** |
| R-48 | stakeholder-lista változása | címke forrás-dimenzió (személy-feloldás) | ❌ | — | bekötés | `catalog-actions.ts:74-81` (R-24 párja) |
| R-49 | knowledge_metadata (scope, modalitás) | hasonlósági előszűrés | ⬜ | — | — | `0017:287-336`: **élő olvasás** |
| R-50 | bármely entitás TÖRLÉSE | a rá mutató címke / beágyazás / metaadat (`block_id`-n **nincs FK**) | ❌ | — | teljes hiány | l. 6. pont |

### E) kapu / állapot

| # | Forrás (B) | Ráépülő (A) | Van? | Megjegyzés |
|---|---|---|---|---|
| R-51 | artifacts.status = approved | fázis-kritérium | ⬜ | `service.ts:48-62` — élő lekérdezés minden betöltéskor |
| R-52 | use_cases quick_win + list_status + state | P1 kemény kritérium | ⬜ | `service.ts:67-84` — élő |
| R-53 | golden_sets + eval_cases | Tesztriport approve-őr | ⬜ | `artifact-actions.ts:556-590` — élő, jóváhagyás pillanatában |

---

## 2. A hét ismert viszony — verdikt

| # | A spec állítása | Verdikt | Pontosítás |
|---|---|---|---|
| **V1** | fájdalompont szövege → a belőle származó use case-ek | ✅ **MEGERŐSÍTVE** (R-14) | Kettős hiány: a `pain_points`-nak **nincs `updated_at` oszlopa**, tehát nemcsak a bekötés, az alap is hiányzik. |
| **V2** | fájdalompont szövege → rangsor-dokumentum (láncon át) | ✅ **MEGERŐSÍTVE** (R-42) | A lánc **második** szeme (use_case → shortlist) MŰKÖDIK (render_stale). Csak az **első** szem hiányzik. A javítás tehát V1-gyel azonos; V2 önálló bekötést nem igényel, ha a jelölés a láncon terjed (K-7). |
| **V3** | nyertes opció váltása → Megoldási javaslat | ✅ **MEGERŐSÍTVE** (R-31) | A mechanizmus pontosan: (a) `selectOptionAction` nem üti a komponens `updated_at`-ját → doc_stale vak; (b) a `component_options`-nak nincs `updated_at`-ja, a render_stale `created_at`-ra esik vissza, ami **definíció szerint korábbi** a `rendered_at`-nál → render_stale **szerkezetileg sosem szólal meg ezen a cél-típuson**. Mindkét ág javítandó. |
| **V4** | forrás új verziója → folyamattérkép | ✅ **MEGERŐSÍTVE** (R-11) | Csak bekötés hiányzik: a `sourceUpdatedForRows` helper kommentje (`staleness.ts:90-93`) kifejezetten megnevezi ezt az esetet mint kezelhetőt. |
| **V5** | folyamattérkép változása → TO-BE terv kézi hatáselemzés mezője | ⚠️ **PONTOSÍTANDÓ** (R-32) | Három külön dolog keveredik. (a) A térkép saját változása **ugyanazon a soron** MA IS detektált (render_stale, process_map cél-típus, `0016`). (b) A **valódi rés**: jóváhagyott térkép **nem szerkeszthető**, a folytatás **új sor** (`newIterationAction`) — a renderelés-él a RÉGI sorra mutat, aminek az `updated_at`-ja nem mozdul → **új jóváhagyott TO-BE verzió esetén néma**. (c) A `valtozas_hatasa` mező kiürülése **NEM elavulás, hanem felülírás**: a generálás minden futáskor `EMPTY_FIELD`-re állítja (`artifact-actions.ts:1223`) — ez I4 (egy-író), nem I5, és külön kezelendő. |
| **V6** | értékelési kritérium → Tesztriport | ✅ **MEGERŐSÍTVE** (R-41) | Kettős hiány: az `eval_criteria`-nak **nincs `updated_at`**-ja, ÉS a kritérium-műveletek nem ütik a szülő `eval_cases.updated_at`-ját (a doc_stale ezt olvassa). A törlés-ág (`deleteCriterionAction`) egyik módon sem detektálható. |
| **V7** | use case szerkesztése → golden set | ✅ **MEGERŐSÍTVE** (R-17) | Alap megvan (`use_cases.updated_at` íródik), csak bekötés hiányzik. |

**Összegzés:** 5 megerősítve változatlanul, 1 megerősítve pontosított
mechanizmussal (V3), 1 lényegesen átfogalmazandó (V5). A hét leírásából
egyik sem bizonyult tévesnek.

---

## 3. (a) Időbélyeg-hiány — mely tábláknak nincs `updated_at`-ja

Valós DB-ből, mind a 37 táblára lekérdezve. **Tartalom-hordozó táblák
`updated_at` nélkül — a spec kettőt nevez meg, valójában HÉT van:**

| Tábla | A spec ismeri? | Miért számít |
|---|---|---|
| `pain_points` | ✅ igen | V1/V2 alapja |
| `component_options` | ✅ igen | V3 alapja + a render_stale `created_at`-fallbackja |
| **`eval_criteria`** | ❌ **nem** | V6 alapja |
| **`acceptance_criteria`** | ❌ **nem** | katalógus-cédula (örökölt jóváhagyás); a cédula `approved_at`-ja a SZÜLŐ requirement bélyege (`0015`) |
| **`component_links`** | ❌ **nem** | R-36: a kötés-feliratok a P3 dokumentumba renderelődnek |
| **`epics`** | ❌ **nem** | katalógus-cédula; gyakorlati hatás kicsi (nincs szerkesztő művelet) |
| **`input_items`** | ❌ **nem** | R-12: a `source_kind`/`org_level` **helyben módosul** (nem új verzió!), és semmilyen időbélyeg nem mozdul |

**Nem tartalom-hordozó, ezért nem hiány:** `clients`, `projects`,
`decisions` (append-only napló), `phase_instances`, `stale_acks` (saját
`acked_at`), `artifact_render_links` (saját `rendered_at`),
`knowledge_dismissals` / `knowledge_label_corrections` (append-only),
`knowledge_embeddings` (a `content_text` a lenyomat), a három kötőtábla
(`pain_point_stakeholders`, `requirement_stories`,
`stakeholder_requirements` — tiszta M:N, saját tartalom nélkül).

**Az `input_items` esete külön magyarázatot érdemel:** a hiány itt
TERVEZETT — a verziózás új sorral történik, és a `created_at` a bélyeg
(`0013`). A rés nem a verziózásban van, hanem abban, hogy **a metaadat-mezők
helyben, verzió nélkül módosulnak** (`source-meta-actions.ts` mindkét
akciója), és pont ezek táplálják a címkézés priorjait.

---

## 4. (b) Néma időbélyeg-elmulasztás

Két külön osztályt kell szétválasztani. Mind a 60 `.update()` hívóhelyet
gépileg felsoroltam és payload-onként átnéztem.

### 4.1 „Elfelejtette a saját sorára" — **NULLA eset**

Minden olyan tábla, amelynek VAN `updated_at`-ja, **minden** írási úton meg
is kapja. Ellenőrizve mind a 60 hívóhelyen, a változóba épített payloadokat
is kibontva (`artifact-actions.ts:1421-1427` `bodyUpdate`,
`labeling.ts:384-393` `signalPatch`, `store.ts:110` metadata-`patch`).
**Ez a terület tiszta.**

### 4.2 „Gyermeket ír, szülőt nem üt" — **a spec egyet ismer, valójában 6 család, 13 hívóhely**

Ez a valódi vakfolt-osztály: a művelet módosít egy sort, de nem üti annak a
sornak az időbélyegét, **amelyet a detektálás olvas**.

| # | Művelet(ek) | Írja | Nem üti | Melyik detektálás vakul meg |
|---|---|---|---|---|
| N-1 | `selectOptionAction` **(a spec ismeri)** `:432-474`, továbbá `unselectOptionAction` `:477-494`, `addOptionAction` `:329-371`, `addCriterionAction` `:378-421` | `component_options` | `solution_components.updated_at` | doc_stale (Megoldási javaslat) — **4 hívóhely, nem 1** |
| N-2 | `addCriterionAction` `:360`, `updateCriterionAction` `:385`, `deleteCriterionAction` `:411` | `eval_criteria` | `eval_cases.updated_at` | doc_stale (Tesztriport) = **V6** |
| N-3 | `addLinkAction` `:478`, `confirmLinkAction` `:511`, `deleteLinkAction` `:530`, `runLinkSuggestion` `:439` | `component_links` | `build_components.updated_at` | doc_stale + render_stale (Megoldás-dokumentáció) = **R-36** |
| N-4 | `addAcAction` `:488`, `generateAcAction` `:646`, `deleteAcAction` `:531` | `acceptance_criteria` | `requirements.updated_at` | a cédula `approved_at`-ja (`0015`) hibás marad |
| N-5 | `addStakeholderLinkAction` `:701`, `removeStakeholderLinkAction` `:728` | `stakeholder_requirements` | `requirements.updated_at` | — (ma nincs fogyasztó) 🔎 |
| N-6 | `setPainStakeholdersAction` `:439`, `togglePainBindAction` `:510` | `pain_point_stakeholders` | `pain_points` (nincs is `updated_at`) | — 🔎 |

**Egy harmadik, apró eset:** `preview-data.ts` csempe-szintű `stale`
számítása **ack-szűrés NÉLKÜL** történik (`:357, 396, 439, 457` —
`sourceUpdatedForRows(...).size > 0`), miközben a kártya-szintű jelölők
`activeStaleSince`-t használnak. Egy nyugtázott (`Ellenőrizve`) jelölés
tehát a kártyáról eltűnik, a csempéről nem. Ez nem elavulás-rés, hanem
kijelzés-inkonzisztencia.

---

## 5. (c) Láncok, mélység, ciklus

### 5.1 A gráf alakja

**A függés-gráf ma DAG (irányított körmentes).** Végigvezettem a
kategóriákat: a katalógus/címke/beágyazás réteg minden éle BEFELÉ mutat
(entitás → cédula → címke → vektor), és **egyetlen él sem tér vissza** az
entitás- vagy dokumentum-rétegbe. A 4.3 felismerés-réteg (ma fogyasztó
nélkül) sem ír vissza tudáselemet.

**Egy elméleti kör-jelölt 🔎:** `requirements.parent_id` önhivatkozó, és a
DB nem tiltja a kört (A szülője B, B szülője A). Az `addRequirementAction`
sem ellenőrzi. Ha a jelölés a fa-hierarchián terjedne, ez végtelen ciklust
adna. Nem döntöm el, valós kockázat-e — jelölöm.

### 5.2 A leghosszabb láncok

```
① input_items → pain_point → use_case → golden_set → eval_case
                                → Tesztriport (approved) → artifact-cédula
                                → címke → beágyazás                    [9 szint]

② input_items → pain_point → use_case → Priorizált use case-shortlist
                                → P1 kapu → fázis-állapot              [6 szint]

③ input_items → solution_component → component_option (nyertes)
                                → Megoldási javaslat → cédula → címke  [6 szint]

④ input_items → process_map(AS-IS) → process_map(TO-BE) → component_link
                                → Megoldás-dokumentáció → cédula → címke [7 szint]

⑤ solution_component → build_component → component_link
                                → Megoldás-dokumentáció → cédula → címke [6 szint]
```

**A K-7 követelmény (a jelölés a lánc MINDEN fölöttes szintjére terjedjen)
gyakorlati következménye:** a leghosszabb lánc **9 szintű**, és a
④/⑤ ág **összefut** (a Megoldás-dokumentációba két külön ágon is befut
tartalom). Egy fájdalompont-szerkesztés az ① láncon **hat** szintet érint.

**Ahol a lánc elágazik (fan-out), a terjedés költséges:** egy
`input_items` verzió-emelés potenciálisan MINDEN entitást és minden
dokumentumot érint (a projekt összes sora hivatkozhat rá); egy jóváhagyott
TO-BE térkép-váltás minden dokk-kötést és a P3 dokumentumot.

### 5.3 Ahol a lánc ma megszakad

A ①-es láncban **az első él hiányzik** (R-14), tehát a mögötte lévő öt
szint sosem kap jelzést. A ③-as láncban a **második** él hiányzik (R-31).
A ④-esben a **harmadik** (R-25/R-36). Vagyis: a hosszú láncok mindegyikén
van legalább egy szakadás — **egyik lánc sem terjed ma végig.**

---

## 6. (d) Törlés — mi történik ma a ráépülővel

### 6.1 Alapelv, ami mindent magyaráz

**Mind az öt működő detektálás „nőtt-e egy időbélyeg" alakú. A törlés soha
nem növel maximumot — sőt, a `max(updated_at)` a törléstől CSÖKKENHET.
Következmény: a törlés MA STRUKTURÁLISAN LÁTHATATLAN mind az öt
detektálásnak.** Ez nem hiba egyik jelölőben sem, hanem a mechanizmus
határa. (A `staleness.ts:73-74` ki is mondja: „a törölt cél nem jelöl".)

### 6.2 Hol értelmezhető egyáltalán a törlés

Mind a 17 `.delete()` hívóhelyet felsoroltam. **Négy központi tábla
tartalmát a rendszer SOHA nem törli** — ez explicit tiszta terület:

> **`input_items`, `artifacts`, `process_maps`, `golden_sets`: nincs
> törlő művelet a kódbázisban.** (A forrás és a dokumentum verziózódik, nem
> törlődik.) Következmény: **V4 és V5 törlés-ága fogalmilag nem létezik.**

Törölhető viszont: `pain_points`, `use_cases`, `stakeholders`,
`requirements`, `user_stories`, `solution_components`, `build_components`,
`prompt_items`, `control_points`, `eval_cases` (mind **csak
`ai_suggested`** állapotban), valamint állapot-őr NÉLKÜL:
`eval_criteria`, `acceptance_criteria`, `component_links`, és a két
kötőtábla-sor.

### 6.3 Mi történik ma a ráépülővel — a valós FK-térkép szerint

| Törölt elem | A ráépülő sorsa | Csendes? |
|---|---|---|
| pain_point (ai_suggested) | `pain_point_stakeholders` **CASCADE** → emberi kötések vele halnak | igen |
| **requirement (ai_suggested)** | **`requirements.parent_id` CASCADE → az ÖSSZES leszármazott törlődik, a MEGERŐSÍTETTEK IS**; onnan `acceptance_criteria`, `requirement_stories`, `stakeholder_requirements` CASCADE; `epics.business_requirement_id` SET NULL | **igen — emberi tartalom vész** |
| **build_component (ai_suggested)** | **`prompt_items` CASCADE** → a kézzel írt (manual/confirmed) promptok vele törlődnek | **igen — emberi tartalom vész** |
| **solution_component (ai_suggested)** | `component_options` + `component_links` CASCADE; **`build_components.origin_component_id` SET NULL** → a P3-komponens eredete elveszik, a dokumentum ezután „manuális felvétel"-t ír (`syncOriginManual`), és az `origin_drift` némán kikapcsol | **igen — hamis állítás lesz a doksiban** |
| **stakeholder (ai_suggested)** | `pain_point_stakeholders` + `stakeholder_requirements` CASCADE; **`input_items.stakeholder_source_id` SET NULL** (emberi hozzárendelés vész); **`knowledge_metadata.source_person_stakeholder_id` SET NULL** → egy CÍMKE-DIMENZIÓ némán kiürül | **igen — címke-tartalom vész** |
| eval_case (ai_suggested) | `eval_criteria` CASCADE; a Tesztriport rendered él **árván marad** (nincs FK) | igen |
| eval_criteria / acceptance_criteria | a szülő tartalma megváltozik, semmi nem jelez | igen |
| bármely entitás | **a rá mutató `knowledge_label_signals` / `knowledge_embeddings` / `knowledge_metadata` ÁRVÁN MARAD** — a `block_id` oszlopon **nincs FK** (csak az `artifact_id`-n van CASCADE) | igen |
| bármely render-cél | `artifact_render_links` sor árván marad (a `target_id` soft-ref) | igen |

**Az aszimmetria külön kiemelendő:** a tudás-táblák `artifact_id`-ja
CASCADE-el, a `block_id`-ja viszont nem is FK. Ugyanaz a horgony két
oszlopa két különböző törlés-viselkedést ad.

---

## 7. (e) Teljesítmény — hol lenne költséges a derivált számítás

| Hely | Mit csinál ma | Kockázat |
|---|---|---|
| **`renderStaleSinceForArtifact`** (`catalog.ts:337-376`) | **cél-típusonként a TELJES cél-táblát betölti `select("*")`-gal**, és a `component_options` + `eval_cases` **projekt-szűrés NÉLKÜL** (`projectScoped: false`, `catalog.ts:74-84`) → **más projektek sorai is** | **A legdrágább pont ma.** Dokumentumonként fut (`PhaseWorkspace.tsx:1033-1034`), tehát N dokumentum × M cél-típus × teljes tábla. Skálázódás: rossz. |
| `docStaleSinceForArtifact` | dokumentumonként 2-3 lekérdezés | közepes; dokumentum-számmal lineáris |
| `preview-data.ts` | fázis-betöltésenként 6-8 teljes tábla-olvasás (`rows()`) | közepes |
| katalógus-oldal `isLabelStale` | elemenként egy sha256 (szerveroldal, `node:crypto`) | ma olcsó (élesben ~273 elem), de elem-számmal lineáris |
| **lánc-terjesztés (K-7)** | ma nincs | **itt keletkezne az új költség:** a 9 szintű lánc bejárása minden dokumentum-kártyánál; a fan-out (egy forrás → minden entitás) miatt naiv rekurzióval négyzetes lehet |

**Óvatosságot igénylő pontok:** (1) a `component_options` és `eval_cases`
projekt-szűrés hiánya már ma is helytelen és a lánc-terjesztéssel
sokszorozódna; (2) a `select("*")` ott, ahol csak `id` + `updated_at` kell;
(3) a mély láncoknál a memoizálás nélküli többszörös bejárás.

---

## 8. Futtatott DB-próbák (BEGIN/ROLLBACK, fixtúra-adat érintetlen)

1. **Séma-térkép:** 37 tábla × időbélyeg-oszlopok; 58 FK × `ON DELETE`
   szabály — a 3. és 6. pont ezekből készült.
2. **R-47 bizonyítása** — a `new_artifact_version` RPC-t futtattam pontosan
   úgy, ahogy a `newVersionAction` teszi, a seedelt Projekt-charteren:

   | | előtte | utána |
   |---|---|---|
   | v1 mező-cédula a katalógusban | 5 | **0** |
   | v2 (új horgony) mező-cédula | – | 5 |
   | v2-höz tartozó címke | – | **0** |
   | árva címke (horgonya nincs a katalógusban) | 0 | **5** |

   Vagyis egyetlen „Új verzió" gombnyomás mind az öt mező-címkét árvává
   teszi, és az új verzió teljesen címkézetlenül indul — **az emberi
   címke-javításokkal együtt**. Jelzés: nincs.
3. **Árva-számlálás** a jelen fixtúrán (R-50 aktuális állapota): árva
   címke 0, árva beágyazás 0, árva metaadat 0, lógó render-él 0 — a
   *jelenlegi* adat tiszta, a mechanizmus viszont nem véd.

---

## 9. Az újonnan talált (a hétben NEM szereplő) viszonyok — prioritással

### MAGAS — jóváhagyott tartalom csúszhat el némán

| # | Viszony | Miért magas |
|---|---|---|
| **R-10** | forrás új verziója → a belőle kivonatolt **13 dokumentum-típus** mezői | A dokumentum-kártya **egyáltalán nem kap** `source_updated` jelölőt, csak doc_stale/render_stale-t — azok viszont csak 3, ill. 5 típusra futnak. A D1-dokumentumok többsége (Felmérési riport, Business case, Pilot-terv…) **teljesen fedetlen** a forrás-frissülésre, jóváhagyott állapotban is. |
| **R-47** | artifact új verzió → az összes mező-címke árvul | Valós próbával igazolva; emberi címke-javítás vész el, jelzés nélkül. |
| **R-12** | forrás-metaadat utólagos pótlása → a címkék priorjai | A kötegelt pótlás (`bulkSetSourceMetaAction`) **pont arra való**, hogy utólag töltsük — ám a már elkészült címkék a „metaadat nélküli" ágon maradnak. A funkció rendeltetésszerű használata termel néma elcsúszást. |
| **R-36** | component_links → Megoldás-dokumentáció kötés-feliratai | A kötés felvétele/törlése megváltoztatja a jóváhagyható dokumentum szövegét; sem időbélyeg, sem detektálás. |
| **R-38** | solution_component átnevezése → a P3 dokumentum eredet-felirata | A doc_stale a Megoldás-dokumentációnál nem nézi a P2-komponenseket. |
| **R-37** | **pozicionális `FP-nn` / `TO-BE·nn` sorszámok** → a P3 dokumentumba renderelt kötés-feliratok | Egy fájdalompont felvétele/elvetése **átszámozza az összes FP-nn-t** — a dokumentumban lévő hivatkozás **más elemre kezd mutatni**, változatlan szöveggel. Ez nem elavulás, hanem **néma jelentés-váltás**; a legalattomosabb a listán. |

### KÖZEPES — elavulhat, de kevésbé kockázatos

| # | Viszony |
|---|---|
| R-04…R-07 | requirements / solution_components / build_components / eval_cases: `source_updated` csak **csempe-szinten**, ack nélkül — sor-szintű jelölés nincs |
| R-24 + R-48 | stakeholder átnevezése/törlése → a címkék forrás-dimenziója (tárolt `personName` pillanatkép) |
| R-25 | új jóváhagyott TO-BE verzió → dokk-kötések és `control_points.node_id` (node eltűnésekor árva él) |
| R-22 | nyertes opció váltása → a P2-seed kontextusa |
| R-41 törlés-ága | kritérium **törlése** → Tesztriport (a V6 időbélyeg-javítás sem fedné) |
| R-08, R-09 | user_stories / prompt_items / control_points `source_updated` bekötése (a mező megvan) |
| R-19 | requirement szövege → a belőle generált AC-k |
| R-43 | megerősített mezők → a belőlük generált `body` |
| R-18 | requirement → user_story forrás-unió pillanatkép |

### ALACSONY — elméleti vagy gyakorlati hatás nélkül

| # | Viszony |
|---|---|
| R-20 | requirement/story → component_links cél-létezés (a lényeget a törlés-ág fedi) |
| R-23 🔎 | stakeholder → kötőtáblák |
| R-50 | entitás törlése → árva címke/beágyazás/metaadat — **nem a bekötés hiányzik, hanem a mechanizmus nem lát törlést**; a NY-1 spec-kérdéshez tartozik (6. pont) |
| R-15 🔎 | fájdalompont → komponens/opció-javaslat (generálás-idejű prompt-bemenet) |
| R-16 🔎 | fájdalompont → TO-BE térkép-javaslat (generálás-idejű) |
| R-26 🔎 | folyamattérkép → dokkolás-generálás (generálás-idejű) |

*Nem R-számozott, de ide tartozó apróságok:* N-5/N-6 kötőtábla-írások
szülő-bump nélkül (ma nincs fogyasztójuk); az `epics` `updated_at`-hiánya
(nincs szerkesztő művelet); a `requirements.parent_id` elméleti köre 🔎.

### 🔎 Jelölve — nem döntöm el, valódi függés-e

- **R-15, R-16, R-26** — „generálás-idejű prompt-bemenetek": a fájdalompontok
  a komponens-, opció- és TO-BE-javaslat promptjába kerülnek, de **nincs
  perzisztált él** a bemenet és a kimenet között. Kérdés: elavulás-viszonynak
  tekintjük-e azt, ha egy AI-javaslat olyan bemenetből született, ami azóta
  megváltozott? Ha igen, ez a mai modellben nem is reprezentálható —
  új él-fajta kellene. **Spec-döntés.**
- **R-23, N-5, N-6** — a kötőtáblák változása „tartalom-változás"-e a szülőn.
- **`requirements.parent_id` kör** — védendő-e egyáltalán.

---

## 10. Explicit tiszta területek

Ezeken **nincs mit detektálni**, nem rés:

1. **`knowledge_catalog` (2.1 nézet)** — derivált SQL-nézet, mindig élő;
   pillanatképet nem tárol (`0015`).
2. **Örökölt jóváhagyás** (AC → requirement, epic → requirement/story) —
   a nézet minden olvasáskor élőben számol.
3. **Kapu-kritériumok** (R-51…R-53) — minden betöltéskor élő lekérdezésből
   (`service.ts:48-84`); tárolt kiértékelés nincs, elavulni nem tud.
4. **`[n]` citáció-számozás** (R-13) — a csoport-alapú, append-only
   számozás + `aliasIndex` tervezetten stabil: forrás-frissítés nem tolja el
   a meglévő hivatkozásokat (`sources.ts:29-53`).
5. **Hasonlósági előszűrés** (R-49) — a metaadatot a lekérdezés élőben
   olvassa (`0017:287-336`).
6. **`updated_at` a saját soron** (4.1) — mind a 60 írási úton kitöltve;
   nulla elmulasztás.
7. **Négy központi tábla törlés-mentes** (`input_items`, `artifacts`,
   `process_maps`, `golden_sets`) — a törlés-kérdés rájuk fogalmilag nem áll
   fenn.
8. **A függés-gráf DAG** — a mai kódban nincs valódi kör; a lánc-terjesztés
   terminálásához nem kell ciklus-védelem (egy elméleti kivétellel, l. 9. 🔎).
9. **Árva-állapot a jelen adaton** — 0 árva címke / beágyazás / metaadat /
   render-él (mért).

---

## 11. Összefoglaló számokban

| | |
|---|---|
| Azonosított viszony | **53** |
| Ebből fedett ✅ | 13 |
| Részlegesen fedett ⚠️ | 6 |
| Fedetlen ❌ | 27 |
| Fogalmilag tiszta ⬜ | 7 |
| A spec hét viszonyából megerősítve | 5 változatlanul + 1 pontosított mechanizmussal (V3) |
| Átfogalmazandó | 1 (V5) |
| Cáfolva | 0 |
| **Új, a hétben nem szereplő fedetlen viszony** | **21** (6 magas · 9 közepes · 6 alacsony/jelölt) |
| Ebből 🔎 jelölt (nem döntöm el, valódi függés-e) | 4 (R-15, R-16, R-23, R-26) |
| `updated_at` nélküli tartalom-tábla | **7** (a spec 2-t ismert) |
| Néma szülő-bump elmulasztás | **13 hívóhely, 6 család** (a spec 1-et ismert) |
| Leghosszabb lánc | **9 szint** |
| Valós DB-próba | 3 csomag, BEGIN/ROLLBACK alatt |

**A három legfontosabb, amit a spec F-4 feltételezésének lezárásakor
figyelembe kell venni:**

1. **A hét nem volt teljes — de nem is volt téves.** 18 további fedetlen
   viszony van, ebből hat magas. A legnagyobb egyetlen rés (**R-10**) nem is
   entitás-szintű: **a dokumentumok többsége egyáltalán nem kap
   forrás-frissülés jelölőt**, jóváhagyott állapotban sem.
2. **Két rés nem „elavulás", hanem más osztály** — és ezért más megoldást
   kíván: az **R-37** pozicionális sorszám-eltolódás **jelentés-váltás**
   (a hivatkozás más elemre kezd mutatni), az **R-47** artifact-verzióváltás
   pedig **horgony-vándorlás** (a címke nem elavul, hanem elárvul).
   Időbélyeg-alapú jelöléssel egyik sem fogható meg.
3. **A törlés strukturálisan kívül esik a mai mechanizmuson** (NY-1): mind
   az öt detektálás „nőtt egy időbélyeg" alakú. Ráadásul három CASCADE-út
   (**requirement-fa, build_component → prompt_items, solution_component →
   origin SET NULL**) ma **emberi tartalmat semmisít meg vagy hamis
   állítást hagy a dokumentumban**, jelzés nélkül.

## Megjegyzés

Az audit alatt semmi nem módosult: nincs kódváltozás, nincs migráció, a
DB-próbák `BEGIN`/`ROLLBACK` alatt futottak, a lokális PG a végén leállítva.
A csomag egyetlen fájlt ad a repóhoz: ezt a jelentést.

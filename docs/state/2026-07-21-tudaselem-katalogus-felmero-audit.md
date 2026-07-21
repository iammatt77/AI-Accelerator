# Audit — Tudáselem-katalógus felmérő (entitás- + jóváhagyás-térkép)

**Dátum:** 2026-07-21 · **Branch:** `dev` · **Típus:** read-only tényfeltárás (NEM implementáció, javaslat nélkül)
**Cél:** a C1 katalógus-spec („second brain", B katalógus-út) tény-alapja. Minden állítás a `dev` tényleges kódjából, valós tábla-/mező-/függvénynevekkel.
**Forrás-fájlok:** `supabase/migrations/0001…0014`, `src/lib/db/types.ts`, `src/lib/artifacts/config.ts`, `src/lib/staleness.ts`, `src/app/*-actions.ts`, a `/solution`, `/builddoc`, `/artifact` oldalak.
**Előzmény-auditok beolvasva:** `2026-07-20-adatfolyam-audit.md`, `-forras-valasztas-audit.md`, `-valos-leltar-*.md`, `-p2p3-redundancia-audit.md`, `-d3-mezo-leltar.md`; `2026-07-21-csomag-a.md`, `-csomag-a7.md`.

---

## 1. Entitás-tábla leltár (tudáselem-hordozók)

Oszlopok: **tábla** · **mit reprezentál** · **fázis** · **jóváhagyás-állapot mezője** · **forrás-eredet** · **kereszt-kötések**.

A jóváhagyás-állapot két családban jelenik meg:
- **`entity_state` enum** (`0004`): `ai_suggested` | `confirmed` | `manual` | `rejected`. „Ember által jóváhagyott tudáselem" = `confirmed` (AI-javaslat emberi megerősítése) **vagy** `manual` (emberi kézi felvétel). Ez a P1–P3 entitás-táblák közös mintája.
- **`ArtifactStatus`** (`draft` | `in_review` | `approved`) — a dokumentum-artifactoknál és a folyamattérképnél (lásd 2. blokk / process_maps).

| Tábla | Reprezentál | Fázis | Jóváhagyás-állapot | Forrás-eredet | Kereszt-kötések |
|---|---|---|---|---|---|
| `pain_points` | Fájdalompont | P1 | `state` (entity_state) | `source_input_ids uuid[]` | `pain_point_stakeholders` (↔ stakeholders); use_cases.`pain_point_ids` visszahivatkozik |
| `use_cases` | Use case (érték/megvalósíthatóság-pontozott) | P1 | `state` (entity_state) + `list_status` (candidate/shortlist/excluded/selected — külön axis) | `source_input_ids uuid[]` | `pain_point_ids uuid[]` (→ pain_points); `golden_sets.use_case_id` (→ ide) |
| `stakeholders` | Érintett (ügyfél- ÉS projekt-szinten) | P1 | `state` (entity_state) | `source_input_ids uuid[]` | `pain_point_stakeholders`, `stakeholder_requirements`; `input_items.stakeholder_source_id` visszamutat |
| `process_maps` | AS-IS / TO-BE folyamattérkép (`kind`) | P1 (as_is) / P2 (to_be) | **`status`** (ArtifactStatus) — NEM entity_state; `approveProcessMapAction` állítja `approved`-ra | `source_input_id` (egyetlen leirat, uuid nullable) | a TO-BE node-jai (jsonb-n belüli stabil `id`) a `component_links.target_id` cél-hivatkozás alapja; `control_points.node_id`, `component_links.process_map_id` provenance |
| `requirements` | Háromszintű követelmény-fa (business/stakeholder/system) | P2 (`phase` mező) | `state` (entity_state) | `source_input_ids uuid[]` | `parent_id` (önfa); `acceptance_criteria.requirement_id`; `requirement_stories`; `stakeholder_requirements`; `epics.business_requirement_id` |
| `acceptance_criteria` | GWT elfogadási kritérium (a requirementen él) | P2 | **nincs** külön state — a szülő requirement `state`-je alá tartozik | — (a requirementtől örökli) | `requirement_id` (FK) |
| `epics` | Epic (US-csomagoló) | P2 | **nincs** state-mező | — | `business_requirement_id` (→ requirements); `user_stories.epic_id` |
| `user_stories` | User story (system requirementből származik) | P2 | `state` (entity_state) | `source_input_ids uuid[]` | `epic_id` (→ epics); `requirement_stories` (↔ requirements) |
| `solution_components` | „Mivel valósul meg" megoldáskomponens | P2 | `state` (entity_state) | `source_input_ids uuid[]` | `component_links` (solution-owner → tobe_node dokk); `component_options.component_id`; `build_components.origin_component_id` visszamutat |
| `component_options` | Komponens-alternatíva (nyertest EMBER választ) | P2 | **`is_selected boolean`** (HITL nyertes) + `ai_recommended boolean` (AI ajánlás, sosem választás); `selected_by`/`selected_at`/`rationale` | — (`criteria_values` jsonb az értékelés) | `component_id` (→ solution_components) |
| `build_components` | Megépített megoldás komponense | P3 | `state` (entity_state) | `source_input_ids uuid[]` | `origin_component_id` (→ solution_components, EREDET; NULL=manuális) + `seeded_at`; `component_links` (build-owner → 4 cél-típus, MEGVALÓSÍTÁS); `prompt_items.component_id` |
| `prompt_items` | Prompt-elem (PR-nn), komponenshez kötve | P3 | `state` (entity_state) | `source_input_ids uuid[]` | `component_id` (→ build_components) |
| `control_points` | Guardrail/HITL kontrollpont | P3 | `state` (entity_state) | `source_input_ids uuid[]` | `process_map_id` + `node_id` (opcionális TO-BE lépés; c-minta: lehet NULL) |
| `golden_sets` | Golden set (use case-hez 1:1) | P3 | **nincs** entity_state; `pass_threshold` EMBERI mező (NULL=nincs → riport nem approve-olható) | — | `use_case_id` (→ use_cases) |
| `eval_cases` | Teszteset (EC-nn) | P3 | `state` (entity_state) a teszteset-tudáselemre + **`final_verdict`** (EMBERI végső ítélet, `verdict_by`/`verdict_at`) a besorolásra; `ai_verdict` külön (E1) | `source_input_ids uuid[]` | `golden_set_id` (→ golden_sets); `eval_criteria.eval_case_id` |
| `eval_criteria` | Pass/fail kritérium (K1..) | P3 | `state` (entity_state) | — | `eval_case_id` (→ eval_cases) |
| `component_links` | **Egységes kötéstábla (A7)** — nem tudáselem, hanem él-tábla | P2+P3 | `state` (entity_state; dokk-soron `manual`, megvalósítás-kötésen E1) | — | `solution_component_id` XOR `build_component_id` (owner FK); `target_type`+`target_id` soft-ref (4 cél-típus); `process_map_id` |

**Kötőtáblák (nem önálló tudáselem, kereszt-kötés-hordozók):** `pain_point_stakeholders`, `requirement_stories`, `stakeholder_requirements`, `component_links`.
**Nem tudáselem-tábla, de releváns:** `input_items` (a NYERS forrás — minden `source_input_ids` ide mutat; verzió-csoportos, lásd 4. blokk); `decisions` (append-only döntés-napló: `kind`+`note`, `logDecision()` írja — nincs jóváhagyás-állapota, audit-nyom).

**Lelet (tényszerű):** a jóváhagyás-állapot **nem egységes** a láncon — három különböző mechanizmus: `entity_state` (legtöbb tábla), `ArtifactStatus`/`status` (artifacts + process_maps), és mező-egyedi bool-ok (`component_options.is_selected`, `golden_sets.pass_threshold`, `eval_cases.final_verdict`). Az `acceptance_criteria` és `epics` tudáselemek **nem hordoznak saját jóváhagyás-állapotot** (a szülőtől öröklik / nincs).

---

## 2. D1 dokumentum-mezők mint tudáselem-hordozók (tárolás)

**Hol tárolódnak:** az `artifacts` tábla `fields` **jsonb** oszlopában — NEM külön oszlopok, NEM külön sorok. Egy artifact = egy sor; a mezők a `fields` jsonb-ben kulcsonként. A parse: `parseArtifactFields(typeDef, artifact.fields)` (`src/lib/artifacts/config.ts`).

**Egy mező tárolt alakja** (`ArtifactFieldValue`, config.ts):
```
{ value: string | null,
  source_indices: number[],   // 1-alapú indexek a számozott forrás-listára
  state: "ai_filled" | "confirmed" | "manual" | "missing" }
```

**Mező-szintű jóváhagyás-állapot (E1) — VAN:** a `state` mező. Az átmenetek (`updateField`, artifact-actions.ts):
- `ai_filled → confirmed` (megerősítés, `confirmFieldAction` — csak ai_filled+value erősíthető);
- `→ manual` (kézi szerkesztés, `editFieldAction`);
- `→ missing` (elvetés, `dismissFieldAction`).
Tehát „ember által jóváhagyott mező-tudáselem" = `state ∈ {confirmed, manual}`. **Emellett** artifact-szintű `status` (Draft→In review→Approved) is van — kétszintű jóváhagyás.

**A típus-készlet (D1 field-extract dokumentumok, P0–P3, config.ts):**
- P0: `Projekt-charter` [K], `Engagement-terv`, `Kickoff-agenda`
- P1: `Priorizált use case-shortlist` [K, `entitySourced`], `Felmérési riport`
- P2: `Business case` [K], `Pilot-terv` [K], `Megoldási javaslat` (`entitySourced`, A5), `TO-BE terv` (`retired`, A6)
- P3: `Megoldás-dokumentáció` [K], `Tesztriport` [K]

**Két al-fajta a mező-eredet szerint (D3-partíció, Csomag A):**
- **Szabad-szöveges extract** mezők — a field-extract tölti (`ai_filled`), ember erősít (`confirmed`/`manual`). Ez a „klasszikus" D1.
- **`moduleOwned: true` mezők** — CSAK a modul-sync írja (`syncDocAction`/`syncReportAction`), a szerkesztőben read-only. Konkrétan: `Megoldás-dokumentáció`.{`komponensek`, `prompt_konyvtar`, `guardrail_hitl`} és `Tesztriport`.{`golden_set_eredmeny`, `atmenesi_arany`, `hibak_javitasok`}. Ezek nem hordoznak önálló E1-megerősítést a szerkesztőben — a mögöttes entitás (build_components / eval_cases) confirmed-állapota a jóváhagyás.
- **`entitySourced` típusok** (`Priorizált use case-shortlist`, `Megoldási javaslat`) — a mezők a megerősített entitásokból generálódnak `state: "confirmed"`-del (a szabad-szöveges extract erre a típusra nem fut).

**A legkisebb közös horgony (tényleírás, NEM terv):** ma egy D1 mező egyértelmű címzése = **`artifact.id` + a `fields` jsonb kulcsa** (a `key`). Nincs mező-szintű sor és nincs mező-szintű uuid — a kulcs a típus-konfigból (`ArtifactFieldDef.key`) származik, stabil, de csak az artifact-on belül egyedi. Verzió-dimenzió: az artifact `version` + `type` (unique `project_id,type,version`), a mező-tartalom a `version`-höz kötött. Forrás-eredet mező-szinten: `fields.<key>.source_indices` (a `source_input_ids` számozott listájára mutat).

**Lelet (hol nincs ma mező-szintű jóváhagyás-állapot):**
- A `moduleOwned` mezőkön a mező `state` a sync-től `manual`/örökölt, de a **szerkesztőben nincs külön E1-megerősítés** rájuk (read-only) — a jóváhagyás a mögöttes entitáson történik, a mező csak tükröz.
- A `body` (az artifacts.`body` szöveg-oszlop, a generált md) **nem hordoz mező-szintű state-et** — egyetlen szabad szöveg, csak az artifact `status`-a fedi.
- Nincs olyan azonosító, amivel egy D1 mező-tudáselem a `fields` jsonb-n KÍVÜLről (pl. egy katalógus-sorból) FK-val megfogható lenne — a horgony ma tisztán logikai (`artifact_id` + kulcs-string), nem adatbázis-referencia.

---

## 3. HITL / jóváhagyási író-pontok (fájl + függvény)

Ahol emberi jóváhagyás állapotot ír (a katalógus-hook majd itt köthetne be — most csak a valós író-pontok listája):

**Mező-szintű E1 (D1 dokumentumok) — `src/app/artifact-actions.ts`:**
- `confirmFieldAction` → `updateField(op="confirm")` → `state: "confirmed"`
- `editFieldAction` → `updateField(op="edit")` → `state: "manual"`
- `dismissFieldAction` → `updateField(op="dismiss")` → `missing`

**Artifact-szintű státuszlánc — `src/app/artifact-actions.ts`:**
- `sendToReviewAction` (draft→in_review), `backToDraftAction` (in_review→draft)
- `approveArtifactAction` → `status: "approved"` (a kemény kapu-hordozó; modul-mezős típusnál `synced_at` nélkül blokkol)

**Entitás-confirm (entity_state → confirmed) — akciónként:**
- `entity-actions.ts`: `confirmPainPointAction`, `editPainPointAction` (→manual), `confirmUseCaseAction`, `editUseCaseAction`, `shortlistUseCaseAction`/`excludeUseCaseAction` (list_status), `scoreUseCaseAction`
- `stakeholder-actions.ts`: `confirmStakeholderAction`, `editStakeholderAction`, `scoreStakeholderAction`, `setCommunicationStrategyAction`
- `requirements-actions.ts`: `confirmRequirementAction`, `confirmStoryAction`, `setRequirementMoscowAction`, `setStoryMoscowAction`
- `solution-actions.ts`: `confirmComponentAction`; **`selectOptionAction`** → `is_selected: true` (HITL nyertes-választás; `unselectOptionAction` a visszavonás)
- `builddoc-actions.ts`: `confirmComponentAction`, **`confirmLinkAction`** (kötés ✦→confirmed), `confirmControlAction`, `seedFromP2Action` (behúzás → `state: "confirmed"` + `seeded_at`)
- `goldenset-actions.ts`: **`classifyAction`** → `final_verdict` (emberi végső ítélet), `setThresholdAction`/`setOverrideAction` (küszöb HITL)
- `p2-actions.ts`: `saveBenefitAction`, `savePilotDefinitionAction` → a P2 struktúra kitöltöttségtől `confirmed`/`manual`

**Folyamattérkép-jóváhagyás — `src/app/process-actions.ts`:**
- `approveProcessMapAction` → `status: "approved"`; `applyChatProposalAction` (HITL: AI-javaslat alkalmazása)

**Entitásból-generálás (a megerősített entitásokat `confirmed` mezőkké komponálja) — `artifact-actions.ts`:**
- `generateShortlistFromEntitiesAction`, `generateSolutionPlanFromEntitiesAction`

**Nyugta (elavulás-feloldás) — `src/app/staleness-actions.ts`:** `ackStalenessAction` (nem tudáselem-jóváhagyás, hanem jelölő-feloldás; lásd 4. blokk).

**Lelet:** a jóváhagyási író-pontok **szét vannak szórva** 8 action-fájlban, egységes „jóváhagyás történt" esemény-pont NINCS — minden action közvetlenül a saját tábláját írja (`.update({state/status/is_selected/final_verdict})`). Nincs közös wrapper/hook, amin egy „tudáselem jóváhagyva" esemény átfolyna.

---

## 4. A 0013 verzió-/elavulás-réteg pontos alakja

**Mely táblákon van verzió/jelölő-mező (`0013_versioning_staleness.sql`):**
- `input_items`: **`group_id uuid` + `version int`** (verzió-csoport). Forrás-frissítés = ÚJ sor ugyanabban a `group_id`-ban, `version+1`; a régi sor VÁLTOZATLAN. Backfill: `group_id = id`, `version = 1`. Unique index `(group_id, version)`. Új-verzió író-pont: `newSourceVersionAction` (staleness-actions.ts).
- `build_components`: **`seeded_at timestamptz`** (mikor seedelt a P2-komponensből). Backfill: `created_at` ahol `origin_component_id` van. Az új seed/AI-eredet sorok is írják (`seedFromP2Action`, `generateBuildDocAction` — a csomag A `ed2b4f0` javítás).
- `artifacts`: **`synced_at timestamptz`** (utolsó modul-sync/entitás-generálás bélyege). Írja: `syncDocAction`, `syncReportAction`, `generateSolutionPlanFromEntitiesAction`. NULL = még nem futott.
- `stale_acks`: **polimorf nyugta-napló** — `(subject_type text, subject_id text, kind text ∈ {source_updated, origin_drift, doc_stale}, acked_at)`, unique `(subject_type, subject_id, kind)`. **Csak a feloldás tárolódik**, a jelölő maga NEM.

**Hogyan számítódnak a jelölők (DERIVÁLT, `src/lib/staleness.ts` — jelölő-állapot nincs tárolva, időbélyeg-összevetés):**
- **`source_updated`** (`sourceUpdatedSince`): egy entitás `source_input_ids`-e egy forrás RÉGEBBI verzióját hivatkozza, miközben a `group_id`-csoportban van újabb `version`. Bemenet: entitás `source_input_ids` + a projekt összes `input_items` sora.
- **`origin_drift`** (`originDriftSince`): `solution_components.updated_at > build_components.seeded_at`.
- **`doc_stale`** (`docStaleSince`): a modul-entitások `updated_at`-maximuma (`latestChangeOf`) `> artifacts.synced_at`.
- A nyugta-logika (`isAcked`/`activeStaleSince`): a jelölő aktív, HA `since > acked_at` (az ack UTÁNI újabb változás újra jelöl).

**Hol tárolódik az `ack`:** kizárólag a `stale_acks` táblában, az `ackStalenessAction` (staleness-actions.ts) upsert-eli (`subject_type`/`subject_id`/`kind` + `acked_at`).

**A jelölők tényleges bekötési pontjai (mely subjectre van ma jelölő):**
| kind | subject_type | Hol számítódik/renderel | Mely entitásokra |
|---|---|---|---|
| `source_updated` | `pain_point`, `use_case` | `PhaseWorkspace.tsx` (`sourceUpdatedFlag`), P1 részleteken | CSAK pain_points + use_cases |
| `origin_drift` | `build_component` | `builddoc/page.tsx` + `BuildDocBoard`/`BuildComponentDetail` | build_components |
| `doc_stale` | `artifact` | `artifact/[artifactId]/page.tsx` | CSAK `Megoldás-dokumentáció` (build_components+prompt_items+control_points), `Tesztriport` (golden_sets+eval_cases), `Megoldási javaslat` (solution_components) |

**Lelet (mi hiányzik a lánc-menti lefedettséghez):** a jelölő-mechanika **NEM általánosított a teljes láncra** — ma csak a fenti subjectekre fut:
- `source_updated` jelölő NINCS: `stakeholders`, `requirements`, `user_stories`, `solution_components`, `build_components`, `eval_cases`, `prompt_items`, `control_points` (mind hordoz `source_input_ids`-t, de nincs rájuk forrás-frissült jelölő).
- Nincs **entitás→entitás** drift-jelölő az `origin_drift`-en kívül: pl. use_case→golden_set, requirement→story, pain_point→use_case „a forrás-tudáselem változott" nincs jelezve.
- `doc_stale` csak a 3 felsorolt artifact-típusra van bekötve; a többi D1 dokumentum (charter, engagement, felmérési riport, business case, pilot-terv, shortlist) `synced_at`-ja NULL / nincs entitás-forrás összevetés → nincs elavulás-jelölő.
- A `subject_id` a `stale_acks`-ban **`text`** (nem uuid FK) — polimorf, típus-agnosztikus; a lánc-menti általánosításhoz kész, de integritás-ellenőrzés nélkül.

---

## 5. Használat-térkép nyersanyag („ki-mire-hivatkozik")

**Meglévő élek, amikből a használat összeállítható:**

**A) Forrás-citációk (tudáselem → NYERS input_items):**
- `source_input_ids uuid[]` — minden entitás-táblán (pain_points, use_cases, stakeholders, requirements, user_stories, solution_components, build_components, prompt_items, control_points, eval_cases) + `artifacts.source_input_ids`.
- `fields.<key>.source_indices` (D1 mező-szintű citáció → a számozott forrás-lista → input_items).
- `process_maps.source_input_id` (egyetlen leirat).
- Feloldás: `loadNumberedSources` (`src/lib/sources.ts`) — csoport-alapú kanonikus [n], `aliasIndex` bármely verzió-id → csoport-index.
- **Irány:** tudáselem → forrás (honnan jött). NEM tudáselem → tudáselem.

**B) Entitás → entitás kötések (tudáselem ↔ tudáselem):**
- `use_cases.pain_point_ids uuid[]` → pain_points
- `pain_point_stakeholders` (pain ↔ stakeholder)
- `requirements.parent_id` (fa) · `requirement_stories` (req ↔ story) · `stakeholder_requirements` (stakeholder ↔ req) · `epics.business_requirement_id` · `user_stories.epic_id`
- `acceptance_criteria.requirement_id`, `eval_criteria.eval_case_id`, `prompt_items.component_id`, `component_options.component_id`
- `golden_sets.use_case_id` (P3 tudáselem → P1 use case)
- `build_components.origin_component_id` (seed EREDET → solution_component) + `seeded_at`
- **`component_links` (A7, egységes kötéstábla):** solution_component → tobe_node (P2 dokk); build_component → {requirement, story, tobe_node, pain_point} (P3 megvalósítás). A `target_id` soft-ref (uuid VAGY jsonb-node-id).
- `control_points.node_id` + `process_map_id` (kontroll → TO-BE lépés)

**C) Fordított aggregáció (már létező olvasó, nem tárolt):**
- A Források-oldal (`sources/page.tsx`) MENET KÖZBEN számolja a „hivatkozva N× / HOL" chipeket az artifacts.`source_input_ids` ∪ `fields.source_indices` + stakeholders.`source_input_ids` + `input_items.stakeholder_source_id` uniójából — ez él-nyilvántartás NÉLKÜLI, render-idejű aggregáció.
- A lefedettség-nézet (`/builddoc`) a `component_links` fordított olvasata (passzív tükör).

**Lelet (hol NINCS ma használat-nyilvántartás):**
1. **Dokumentum → renderelt tudáselem: NINCS perzisztens él.** Az `entitySourced` (shortlist, Megoldási javaslat) és `moduleOwned`/sync dokumentumok (Megoldás-dok, Tesztriport) a generáláskor beolvassák a megerősített entitásokat (use_cases / solution_components / build_components / eval_cases / prompt_items / control_points), és a **szöveget** írják a `fields`-be — de **egyetlen sor sem rögzíti, hogy az adott artifact-mező mely entitás-tudáselemet renderelte**. A kapcsolat kizárólag a generálás pillanatában létezik; utólag csak a `source_input_ids`/`source_indices` (a NYERS forrásra, nem a származtatott entitásra) marad. → „melyik dokumentum melyik use case-t/komponenst jeleníti meg" **nem lekérdezhető**.
2. **Tudáselem → tool használat:** a P1 use case-t az értékelők (`ai_suitability`/`data_readiness`/`ai_act` jsonb az use_cases-en) és a hőtérkép fogyasztják, de ez a use_case-en belüli jsonb, nem külön él; a golden_set→use_case az egyetlen explicit „tool-tudáselem → forrás-tudáselem" él.
3. **A `decisions` napló** (`kind`+`note` szöveg) rögzít eseményeket, de **nem gépi-olvasható él** (szabad szöveg, nem FK) — nem alkalmas használat-visszafejtésre.
4. **A `component_links.target_id` soft-ref** (nem FK): a build_component→pain_point/requirement/story kötés uuid-szövegként él, a tobe_node jsonb-node-id — a használat itt nyilvántartott, de nem FK-integritással.

---

## Összegzés (tényszerű állapot, javaslat nélkül)

- **Jóváhagyás-állapot:** három párhuzamos mechanizmus (`entity_state`, `ArtifactStatus`/`status`, mező-bool-ok) — nincs egységes „jóváhagyott tudáselem" jelölő az egész láncon; `acceptance_criteria` és `epics` állapot nélkül.
- **D1 mező-horgony:** ma logikai (`artifact.id` + jsonb-kulcs), nem adatbázis-entitás; a `moduleOwned` mezők és a `body` nem hordoznak önálló mező-szintű megerősítést.
- **HITL író-pontok:** 8 action-fájlban szétszórva, közös esemény-pont nélkül.
- **Verzió/jelölő-réteg (0013):** működik `input_items` verzió-csoportra + 3 jelölő-fajtára, de a jelölő-lefedettség a lánc töredékére (pain/use_case/build_component/3 artifact-típus) korlátozódik; a `stale_acks` polimorf horgonya (`subject_type`+`subject_id text`) kész az általánosításra.
- **Használat-térkép:** az entitás↔entitás és forrás-citáció élek megvannak és lekérdezhetők; a **dokumentum→renderelt-tudáselem él hiányzik** (csak generálás-időben létezik) — ez a legnagyobb hiányzó horgony a „hol van használva" teljességéhez.

*Ez tényfeltárás; a katalógus-réteg tervezése a C1 spec dolga. Semmi kód nem változott — csak ez az egy jelentés-fájl kerül commitba.*

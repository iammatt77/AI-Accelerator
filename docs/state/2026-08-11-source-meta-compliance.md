# Backend compliance check — 4.2b Forrás-metaadat és atomi kinyerés

**Dátum:** 2026-08-11 · **Branch:** `dev` · **Spec:** Refounded_Epic4_42b_spec_v0_1

## (1) input_items: van-e forrás-típus / szervezeti szint mező?

**NINCS.** Oszlopok: `id, project_id, type, raw_text, phase,
stakeholder_source_id, group_id, version, created_at`.

- A **`type` mező a gyakorlatban a forrás CÍME** (szabad szöveg): a
  feltöltő űrlap a title-t írja bele (`addPhaseInput`: `type: title || "raw"`),
  a Források-oldal címként jeleníti meg. NEM típus-enum.
- Létezik egy **megjelenítési heurisztika** (`deriveSourceKind()` a
  sources/references-ben): a címből regex-szel tippel kind-et
  (transcript/data/list/note/document) — csak badge-hez, a címkézés nem
  használja. Ez megerősíti a spec premisszáját: a típus ma tipp, nem adat.
- **Új oszlopok kellenek** (0019 migráció): `source_kind` (7 érték:
  `interju_atirat · hivatalos_dokumentacio · workshop_jegyzokonyv ·
  rendszeradat_riport · levelezes · prezentacio · egyeb`, NULLABLE — a NULL
  = „nincs megadva", láthatóan) és `org_level` (`hq · helyi · kulso ·
  ismeretlen`, NULLABLE).
- **Név-ütközés, dokumentálva:** a `knowledge_metadata.source_kind` (4.1)
  az ATTRIBÚCIÓ jellege (dokumentum/interjú/megfigyelés/rendszeradat) —
  más értékkészlet, marad érintetlen. Az új mező az input_items-en él.
- Verzió-öröklés: az „új verzió" akció (staleness-actions) a type/phase
  mezőket örökli — a két új mezőt is örökölnie kell.

## (2) Hol fut a kinyerés, és mi termeli a törmeléket?

Forrás → tudáselem utak:

- **(a) `extract()` → artefaktum-MEZŐK** (lib/llm, generikus): a mezőket a
  forrásokból tölti; a confirmed mezők a 0015 nézeten át artifact_field
  cédulák. **A user PÉLDÁJA pontosan ez**: a Kickoff-agenda `napirend`
  mezője — napirendi pontok listája —, a nézet `left(...,240)` vágásával
  („…szeptember 30-i élesítés). 2. A"). Két törmelék-mechanizmus egyben:
  a SZERKEZET-MEZŐ tudáselemként való kitettsége + a 240-es vágás.
- **(b) entitás-kinyerők** (`extractPainPoints`, `extractStakeholders`,
  `deriveUseCases`): a promptok fabrikáció-tiltást tartalmaznak, de
  **atomicitás-kényszert NEM** (csak „1-2 mondatos leírás") — napirend-
  jellegű forrásból sorszámozott, több-állításos darabok jöhetnek.

**Feszültség a védett felülettel — feloldás (nem STOP):** a 0015
katalógus-nézet (2.1, „Ne érintsd") MINDEN confirmed mezőt kitesz, a
szerkezet-mezőket is. F3-b („szerkezetből ne legyen tudáselem") a 4.2
FOGYASZTÓI szintjén teljesül: az artefaktum-konfig mezőire config-vezérelt
`knowledgeExempt` jelölés kerül (napirend, resztvevok, elokeszuletek és
társaik), és a katalógus-oldal + a címkéző köteg-akció ezeket KIHAGYJA —
a 2.1 nézet érintetlen. A 4.3+ fogyasztóknak ugyanez a szűrő kell majd;
egy jövőbeli 2.1-revízió a nézetbe emelheti (jelentve, döntés Mátéé).

## (3) A címkéző motor bekötési pontjai

Egyetlen varrat: **`labelOneItem`** (labeling.ts) — a köteg-akció, az
újracímkézés és minden út ezen megy át. Ma:
- forrás-szint: `sample0.source` (a SZÖVEGBŐL tippelve, konf 0.4 ha nincs
  jelzés → ezért kétes szinte minden);
- modalitás: `classifyKnowledgeItem` + borderline/konf-eszkaláció.

Bekötés: a hívók az elem `source_input_ids[0]`-jából feloldott
`{sourceKind, orgLevel}`-t adnak át; a motorban:
- **forrás-szint**: ismert `org_level` → a dimenzió a METAADATBÓL,
  accepted, `derived_from:'forras-metaadat'` jelöléssel (a DimensionSignal
  jsonb — nem kell migráció) — NEM kétes;
- **modalitás-prior** a típus-térképből (hivatalos_dokumentacio→normativ,
  rendszeradat_riport→as_is, interju_atirat→as_is; workshop/levelezés→nincs
  prior); a szöveg-minta felülírhat; borderline + prior → a prior dönt,
  NEM eszkalál, NEM kétes; ismeretlen típus → mai út + a reason kimondja
  a forrás-típus hiányát (látható bizonytalanság);
- **evidencia** (4.2b-d): új tengely ugyanabban a classify-hívásban +
  prior a típusból; `knowledge_metadata.evidence_kind` oszlop (0019) +
  a 0018 corrections CHECK bővítése `'evidence'`-szel; `setMetadata`
  MetadataInput bővítése (tisztán bővíthető, ellenőrizve).

## (4) Érintett elemszám + újrakinyerés-költség

**Az AICON éles Supabase ebből a munkamenetből NEM érhető el** (a Supabase
MCP-fiókban csak egy másik termék projektjei vannak). A spec saját száma:
**88 elem, ~mind kétes ugyanazon dimenzión.** Pontos leltárhoz Máté ezt
futtassa (read-only, SQL-editor):

```sql
select count(*) total,
       count(*) filter (where block_type='artifact_field'
         and field_key in ('napirend','resztvevok','elokeszuletek')) structure_fields,
       count(*) filter (where excerpt ~ '^\s*\d+[\.\)]\s') numbered_fragments
from knowledge_catalog;
select count(*) doubtful from knowledge_label_signals where doubtful;
```

**Költség-modell (döntés Mátéé, §6):**
- *Újrakinyerés:* forrásonként 1-1 LLM-hívás kinyerőnként (~N_forrás × 2-3
  hívás) + újracímkézés (~elemenként 1-5 hívás + 1 embedding) — 88 elemnél
  nagyságrendileg 150-500 LLM-hívás; **elvesznek** az entitás-megerősítések
  (confirmed state) és a kézi címke-javítások.
- *Meghagyás:* 0 költség; a szerkezet-törmelék a `knowledgeExempt` szűrővel
  AZONNAL eltűnik a 4.2-ből újrakinyerés nélkül (a katalógus-nézetben
  megmarad); a maradék rossz elem kézzel javítható/újracímkézhető.
- *Projekt-szintű választás:* a kettő kombinációja, +UI-költség.

**Megjegyzés:** a `knowledgeExempt` szűrő önmagában a 88-as törmelék jó
részét kiveszi (ha az főleg szerkezet-mező) — a fenti SQL első lekérdezése
pontosan megmondja, mennyit.

## Konklúzió: NINCS STOP

A spec premisszái igazolódtak (nincs típus-mező; nincs atomicitás-kényszer;
a forrás-szint szöveg-tipp). Az F3-b és a védett 2.1 nézet közti feszültség
a fogyasztói szintű, config-vezérelt kivétellel oldódik (fent, jelentve).

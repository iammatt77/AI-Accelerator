# Megelőző audit — teljes rendszer-átvizsgálás (javítás NÉLKÜL)

**Dátum:** 2026-08-26 · **Branch:** `dev` (@ a drift-csomag után) · **Jelleg:** csak
olvasás + célzott futtatható próbák. **Egyetlen kódsor sem változott.**

**Mérce:** az öt invariáns (I1 Y-modell · I2 entitás-elsőség · I3 semmi nem lóg ·
I4 egy-író · I5 verzió+elavulás) + a működési szabályok (E1, D1/D2/D3,
zóna-felelősségek, guardok, katalógus-DERIVE, tudáselem-definíció,
címkézés-szabályok, i18n, adapter-elv).

**Módszer:** a teljes server-action réteg (16 fájl, ~7 900 sor) és a kapcsolódó
lib-ek soronkénti átolvasása; a 20 migráció ↔ kód összevetése; ahol lehetett,
**valós Postgres constraint elleni próba** a lokális PG16-on (nem shim mögött):
duplikált verzió-beszúrás, CHECK-készletek kiolvasása, árva-számlálások a
fixtúra-DB-n; futtatott ellenőrzés: `npm run i18n:check`. UI-walkthrough nem
futott (a csomag módosítás-tilalma mellett a statikus + DB-próbák fedték a
kérdéseket).

**Jelmagyarázat:** minden találat: *hely · sértett elv · kockázat · javítás-irány*.
Prioritás: KRITIKUS / MAGAS / KÖZEPES / ALACSONY. A ✅ blokkok a tisztának
talált területek — explicit kimondva.

---

## A) Adat-réteg: guardok, constraintek, migrációk ↔ kód

### A-1 · MAGAS — a process_maps verziózásának nincs DB-őre
- **Hely:** `supabase/migrations/0008_process_maps.sql` (nincs unique);
  `src/app/process-actions.ts:36-50` (nextVersion read-then-insert),
  `:406-454` (newIterationAction).
- **Elv:** I5 (verziólánc-integritás) + a 0003-ban lefektetett minta
  (artifacts: uq index + RPC-őr) itt hiányzik.
- **Kockázat:** **valós DB-próbával igazolva** — ugyanarra a
  (project, kind, version=99) párra KÉT sor beszúrható volt. Ráadásul a
  `newIterationAction` sem `approved`, sem „legfrissebb verzió" őrt nem tartalmaz
  (a kommentje szerint „a jóváhagyott tervből", de draftból és régi verzióból is
  fut) → elágazó verziólánc. Az artifacts-oldalon ugyanezt a `new_artifact_version`
  RPC kizárja.
- **Javítás-irány:** uq index (project_id, kind, version) + approved/latest őr a
  newIterationAction-ben (a 0003 mintájára).

### A-2 · KÖZEPES — projekt-szkópolás hiánya egy action-családban (tamper-rés)
- **Hely:** `goldenset-actions.ts` (updateCase :293, rejectCase :340,
  addCriterion :360, updateCriterion :385, deleteCriterion :411, recordActual
  :457, suggestVerdict :498, classify :527 — mind csak `.eq("id", …)`);
  `builddoc-actions.ts` (addLink :478 — component_id validálatlan,
  suggestLinks :459, confirmLink :511, deleteLink :530, addPrompt :546,
  updateComponent :206, updatePrompt :582, confirmControl :673);
  `requirements-actions.ts` (deleteAc :540 — az AC nem köttetik a projekthez;
  addStakeholderLink :701 — a stakeholder projekt-tartozását és szintjét nem
  ellenőrzi, pedig a komment állítja; deriveStory epicId :561, addRequirement
  parentId :448 — idegen projekt sorára köthet).
- **Elv:** a repo saját guard-mintája (loadOwned* — entity/stakeholder/artifact
  actionökben következetes) + defense-in-depth.
- **Kockázat:** manipulált űrlappal másik projekt sora írható/törölhető, ill.
  kereszt-projekt kötés jön létre. Egyfelhasználós rendszerben mérsékelt, de a
  minta fele a kódbázisnak már követi — a másik fele nem.
- **Javítás-irány:** a loadOwned*-minta kiterjesztése (id + project_id együtt).

### A-3 · KÖZEPES — confirm state-guard nélkül a requirements-oldalon
- **Hely:** `requirements-actions.ts:307-324` (confirmRequirementAction),
  `:367-384` (confirmStoryAction) — nincs `.eq("state","ai_suggested")`.
- **Elv:** E1 eredet-integritás (a #7a minta: megerősíteni csak AI-javaslatot).
- **Kockázat:** `manual` (kézi, emberi) sor `confirmed`-re (= AI-javaslat +
  emberi jóváhagyás) írható át — az eredet-napló hazudik; a hangolási elemzések
  (F5-jellegű) hamis alapot kapnak.
- **Javítás-irány:** state-guard, mint a confirmPainPointAction-ben.

### A-4 · KÖZEPES — a seed a 0013 után friss DB-n elhasal
- **Hely:** `scripts/seed.ts:239-243` — input_items insert `group_id` nélkül;
  a 0013 óta `group_id NOT NULL`, default nélkül.
- **Elv:** migráció ↔ kód konzisztencia.
- **Kockázat:** meglévő sorokra az upsert működik (update-ág), de ÚJ környezet
  seedelése NOT NULL hibával áll le.
- **Javítás-irány:** `group_id: item.id` a seed-sorokba (az addPhaseInput
  mintája).

### A-5 · ALACSONY — néma no-op „siker" a confirm-akciókban
- **Hely:** `solution-actions.ts:223-241` (confirmComponentAction);
  ugyanígy `builddoc-actions.ts:225,511,673`.
- **Elv:** a repo hibajelzés-konvenciója (0 frissült sor → látható hiba, mint
  entity-actions `entityNotSuggested`).
- **Kockázat:** rossz állapotból hívva ok:true megy vissza, a felhasználó
  sikeresnek hiszi.
- **Javítás-irány:** `.select("id")` + 0-sor ág.

### A-6 · ALACSONY — ackStalenessAction szabad subject-tel
- **Hely:** `staleness-actions.ts:96-141` — subject_type/subject_id nem
  validált (kind whitelist van).
- **Elv:** guard-lefedettség.
- **Kockázat:** tetszőleges (akár másik projektbeli) subject nyugtázható.
- **Javítás-irány:** subject_type-whitelist + projekt-tartozás ellenőrzés.

### A-7 · ALACSONY — acceptance_criteria és epics E1-state nélkül
- **Hely:** `0009_requirements.sql` (nincs state oszlop egyiken sem).
- **Elv:** E1 (minden AI-írta sor eredet-jelölt). Következménye a D-4 találat.
- **Javítás-irány:** state oszlop VAGY a jelenlegi „örökölt jóváhagyás"
  szemantika tudatos megerősítése a specben.

**✅ Tiszta (A):** az enum-CHECK-készletek ↔ kód-szótárak bitre egyeznek
(source_kind/org_level/modality/evidence — valós DB-ből kiolvasva és
összevetve `lib/sources/meta.ts` + `catalog-actions.ts` konstansaival); mindkét
input_items-író ad group_id-t; az artifacts-verziózás verseny-biztos (uq index
+ RPC, hibakód-kezeléssel); a knowledge_* táblák horgony-CHECK-jei és unique
indexei fedik a kód feltevéseit; RLS minden táblán; a 0020 lenyomat-oszlop
NULL-szemantikája a kóddal konzisztens.

---

## B) I4 egy-író: dokumentum-mezők írás-térképe

Írók mezőnként: extract (ai_filled, védi a confirmed/manual-t és kihagyja a
moduleOwned-ot ✅) · updateField (emberi confirm/edit/dismiss) · D2-generátorok
(shortlist / Megoldási javaslat / TO-BE terv) · modul-sync (syncDoc /
syncReport) · P2-kalkulátorok (emberi űrlap) · suggest-akciók (state-őrrel ✅).

### B-1 · MAGAS (ISMERT nyitott — most pontos hellyel) — valtozas_hatasa törlése
- **Hely:** `src/app/artifact-actions.ts:1223` —
  `valtozas_hatasa: { ...EMPTY_FIELD }` a generateToBePlanFromMapAction minden
  futásán; a fields-objektum frissen épül (nem merge), az update egészben írja.
- **Elv:** I4 — a mező gazdája az EMBER (a gép sosem ír bele tartalmat), mégis
  a gépi újragenerálás üresre írja.
- **Kockázat:** a kézzel megírt „Változás hatása" tartalom némán elvész minden
  TO-BE terv-újrarenderelésnél.
- **Javítás-irány:** a meglévő fields parse-olása és a nem gép-tulajdonú mező
  megőrzése (extract-merge minta).

### B-2 · KÖZEPES — a D2-generátorok felülírják az emberi mező-szerkesztést
- **Hely:** `artifact-actions.ts:810-816,827-845` (shortlist — kommentben
  dokumentált szándék), `:1030-1078` (Megoldási javaslat), `:1217-1262`
  (TO-BE terv).
- **Elv:** I4. A D2-elv szerint a doksi az entitásokból renderelődik — de a
  szerkesztő ugyanezen mezőket engedi kézzel írni (manual state), és a
  következő generálás figyelmeztetés nélkül lecseréli.
- **Kockázat:** emberi doksi-finomítás néma elvesztése.
- **Javítás-irány:** VAGY a D2-mezők szerkesztésének zárása a felületen (mint a
  moduleOwned), VAGY felülírás-előtti látható megerősítés.

### B-3 · KÖZEPES — a moduleOwned védelem csak a felületen él
- **Hely:** `artifact-actions.ts:352-358` (updateField — nincs moduleOwned
  ellenőrzés); `builddoc-actions.ts:711-721` és `goldenset-actions.ts:607-617`
  (syncField — bármely meglévő state-et feltétel nélkül felülír).
- **Elv:** I4 + a repo „a UI-elrejtés önmagában megkerülhető" saját elve
  (l. extractAction entitySourced szerver-őre, artifact-actions.ts:171-177).
- **Kockázat:** direkt action-hívással modul-mező kézzel írható, majd a sync
  némán visszaírja — versengő két író, döntetlen szabály nélkül.
- **Javítás-irány:** moduleOwned őr a updateField-ben (szerver-oldalon).

### B-4 · KÖZEPES — a gépi sync 'manual' (emberi) eredet-jelzéssel ír
- **Hely:** `builddoc-actions.ts:719`, `goldenset-actions.ts:615` — a
  syncField state: "manual"; ugyanígy az AI-generált dokk-kötések:
  `solution-actions.ts:131-137` (component_links state: "manual" gépi sorokra).
- **Elv:** E1 eredet-hűség. A 0015 nézet a 'manual'-t emberi kapunak tekinti
  (state ∈ confirmed/manual → cédula) — ma a réteg-szűrő (a modul-mezők
  NON_CLIENT-ek) fedi a következményt, de a mechanizmus sérül: gépi szöveg
  emberi jelzéssel ül a DB-ben.
- **Kockázat:** minden jövőbeli fogyasztó, amely a state-ből eredetet olvas
  (napló-elemzés, 4.3+), hamis képet kap.
- **Javítás-irány:** külön 'module_synced' state VAGY a moduleOwned flag
  használata eredet-forrásként (a state ne hazudjon).

### B-5 · ALACSONY — a body két írója state-követés nélkül
- **Hely:** `artifact-actions.ts:1288-1320` (saveArtifactBody, kézi) és
  `:1324-1451` (generateBodyAction, gépi) — a body-nak nincs eredet-állapota.
- **Kockázat:** a kézzel átírt draft-body az újragenerálással némán lecserélődik.
- **Javítás-irány:** legalább felülírás-előtti megerősítés a felületen.

**✅ Tiszta (B):** extract-merge (confirmed/manual + moduleOwned védett) ✓;
suggestResidualRiskAction state-őre mintaszerű (csak üres/ai_filled) ✓;
suggestPilotDefinition a hipotezist csak üresen tölti ✓; a „fék"
(realizálható %) és a scale/pivot/stop kizárólag emberi — a parse-shape-ben
sem szerepel ✓; communication_strategy sosem AI-írt ✓; pass_threshold-ot AI
soha nem állítja ✓.

---

## C) I5 elavulás-lánc: „A épül B-re" viszonyok teljessége

Meglévő detektálások: source_updated (entitások), origin_drift (P3←P2 seed),
doc_stale (3 D3-típus), render_stale (8 cél-típus), címke-lenyomat (0020).
A lánc HIÁNYZÓ élei:

### C-1 · MAGAS — fájdalompont-szerkesztés → a ráépülők nem jelölődnek
- **Hely:** `0004_p1_entities.sql` (pain_points-nak NINCS updated_at oszlopa);
  `entity-actions.ts:209-260` (editPainPointAction — nincs is mit ütnie);
  use_cases.pain_point_ids függés detektálás nélkül.
- **Elv:** I5 — a use case (és rajta a shortlist) a fájdalompontra épül.
- **Kockázat:** megerősített fájdalompont utólagos átírása után a származtatott
  use case-ek és a belőlük renderelt shortlist némán elavul; még időbélyeg-alap
  sincs a jelöléshez.
- **Javítás-irány:** updated_at a pain_points-ra + a use case-kártyán derivált
  jelölő (a doc_stale mintájára).

### C-2 · MAGAS — opció-szintű változás (nyertes-váltás!) minden jelölő számára láthatatlan
- **Hely:** `solution-actions.ts:432-474` (selectOptionAction — sem a
  komponens updated_at-ját nem üti, sem az opciónak nincs updated_at-ja);
  `lib/catalog.ts:367-371` (render_stale: component_options-nál created_at
  közelítés — dokumentált); `lib/artifacts/doc-stale.ts:55-61` (Megoldási
  javaslat ág: csak solution_components.updated_at).
- **Elv:** I5. A Megoldási javaslat a NYERTES opciót hirdeti.
- **Kockázat:** a nyertes utólagos átválasztása (vagy szempont-érték
  módosítása) után a renderelt dokumentum némán mást állít, mint a modul —
  se doc_stale, se render_stale nem szólal meg.
- **Javítás-irány:** updated_at a component_options-ra + selectOption üsse a
  komponens updated_at-ját (ettől mindkét meglévő jelölő működésbe lép).

### C-3 · MAGAS — forrás-frissítés → a folyamattérkép nem jelölődik
- **Hely:** `lib/staleness.ts:90-104` (a sourceUpdatedForRows kommentje
  kifejezetten felkínálja a process_maps.source_input_id esetet) — de
  folyamattérképre sehol nincs hívása (`process/[mapId]/page.tsx:78` csak a
  nyers-leirat overlayhez olvassa).
- **Elv:** I5 — az AS-IS/TO-BE térkép közvetlenül egy forrás-leiratra épül.
- **Kockázat:** a forrás új verziója után a (akár jóváhagyott, kapu-releváns)
  térkép némán elavul, miközben az entitás-kártyák ugyanerre az eseményre
  jelvényt kapnak — inkonzisztens felület.
- **Javítás-irány:** a meglévő helper bekötése a térkép-nézetbe és a
  fázis-listába.

### C-4 · KÖZEPES — kritérium-szerkesztés a Tesztriport számára láthatatlan
- **Hely:** `0011_golden_set.sql` (eval_criteria-nak nincs updated_at);
  `goldenset-actions.ts:385-409` (updateCriterionAction az eval_case
  updated_at-ját sem üti); `doc-stale.ts:37-54` (Tesztriport-ág csak
  golden_sets + eval_cases bélyegeit nézi).
- **Kockázat:** kritérium-átírás után a szinkronizált riport és a tárolt
  ai_criteria pillanatkép némán elavul.
- **Javítás-irány:** updated_at az eval_criteria-ra VAGY case-bélyeg ütése.

### C-5 · KÖZEPES — use case-szerkesztés → golden set nem jelölődik
- **Hely:** az eval-esetek a use case cím/leírásból generálódnak
  (`goldenset-actions.ts:121-126`), visszirányú detektálás nincs.
- **Javítás-irány:** derivált jelölő a golden set fejlécén (use_case.updated_at
  vs golden_set.created_at/updated_at).

### C-6 · KÖZEPES — új jóváhagyott TO-BE verzió → komponens-dokk nem jelez
- **Hely:** component_links tobe_node céljai a „mindenkori jóváhagyott" térkép
  node-jaira illesztenek (0010/0014 doku); node-eltűnésnél az él némán árvul
  (`staleness.ts:73-74`: „a törölt cél nem jelöl" — dokumentált).
- **Kockázat:** verzió-emelés után a dokk-kötések egy része csendben a
  semmibe mutat.
- **Javítás-irány:** jóváhagyáskor egyszeri „árva élek" ellenőrzés + látható
  lista.

### C-7 · ALACSONY — a kapu „bármely approved verzióval" teljesül
- **Hely:** `lib/phases/service.ts:131-134` (dokumentált #5a v1-döntés).
- **Kockázat:** a HEAD draft-verzió mellett egy régi approved is zöldre viszi a
  kritériumot.
- **Javítás-irány:** tudatos döntés megerősítése vagy HEAD-szigorítás.

**✅ Tiszta (C):** source_updated az entitás-kártyákon ✓; origin_drift a
P3-seedre ✓; doc_stale a három D3-típusra ✓; render_stale mind a 8 cél-típusra
(process_map-pal együtt) ✓; a címke-elcsúszás a 0020-szal zárva ✓; az
embedding-elcsúszást az újracímkézés útja frissíti (dokumentált) ✓; az ack
utáni újabb változás újra jelöl (derivált, „nem tud elhazudni") ✓.

---

## D) Tudáselem-lánc végponttól végpontig

### D-1 · MAGAS — a hasonlósági RPC nem szűr elavítottra/kétesre/kivezetettre
- **Hely:** `0017:287-336` (match_knowledge_embeddings) — a metaadat-ELŐszűrés
  csak scope + modality; NEM szűr: `deprecated_at` (F9 elavítás),
  `doubtful` (F3 — a 0018 kommentje szerint „4.3 ezen szűr", de a jel-tábla
  nincs is joinolva), NON_CLIENT horgonyok, és a katalógusból kikerült elemek
  árva vektorai.
- **Elv:** tudáselem-definíció (csak ügyfél-tudás) + F3/F9 + a réteg-döntés.
- **Kockázat:** ma NINCS élő fogyasztója (a wrapper-ök 4.3-ra várnak), tehát
  látens — de a 4.3 első bekötésekor elavított, kétes és nem-ügyfél-tudás
  elemek is találatként jönnének vissza. Ez az ismert „kiszűrt elemek
  embeddingjei az indexben" követő igény teljes, RPC-szintű képe.
- **Javítás-irány:** a 4.3 előtt egyetlen helyen, az RPC-ben zárni (deprecated
  IS NULL + doubtful-join + exempt-lista).

### D-2 · KÖZEPES — kivezetett elemek jele/vektora/metaadata a DB-ben marad
- **Hely:** lokális fixtúra-DB-ből számolva: a kivezetett `artifact`
  block-type-on 7 signal + 7 embedding + 7 metadata sor él (élesben ~31
  artifact-cédula × 3 tábla). A 2.1 nézetben a kivezetett block-type-okon
  további élő cédulák: build_component 1, epic 1, eval_case 1,
  eval_criterion 2, prompt_item 1 (lokálisan).
- **Elv:** réteg-döntés (2026-08-13) — adat nem törlődik (szándékos), de az
  A-opció (mi legyen az árva címkékkel) döntésre vár.
- **Javítás-irány:** Máté határeset-döntései után takarítás VAGY megtartás
  explicit kimondása.

### D-3 · KÖZEPES — atomicitás-kényszer csak két kinyerő úton él
- **Hely:** ATOMICITÁS-KÉNYSZER blokk: extractPainPoints + extractStakeholders
  (4.2b). NINCS: deriveUseCases (`llm/index.ts:246-292`), suggestRequirements,
  suggestComponents, suggestEvalCases, suggestBuildDoc — ezek kimenete is
  cédulává válik. Továbbá az artifact_field cédula szerkezetileg
  többállításos ÉS a 0015 `left(...,240)` némán mondat közepén csonkol.
- **Elv:** tudáselem-definíció (EGY atomi állítás).
- **Kockázat:** többállításos/csonkolt cédulák a katalógusban → a címkézés és
  a jövőbeli felismerés (4.3) pontatlan.
- **Javítás-irány:** az atomicitás-blokk kiterjesztése a többi generáló
  promptra; a 240-es vágás jelölése vagy mondathatárra igazítása.

### D-4 · KÖZEPES — AI-generált AC emberi megerősítés nélkül lesz cédula
- **Hely:** `requirements-actions.ts:646-693` (generateAcAction — közvetlen
  perzisztálás, state nélkül) + 0015 'inherited' ág (az AC a szülő requirement
  jóváhagyásával kerül be).
- **Elv:** E1 + jóváhagyás-kapu (kerülhet-e be nem jóváhagyott tartalom: itt
  IGEN — az AC-t magát senki nem hagyta jóvá).
- **Kockázat:** hallucinált AC tudáselemként; a törlés (deleteAcAction) az
  egyetlen kontroll.
- **Javítás-irány:** state az AC-n (A-7) vagy explicit AC-megerősítő lépés.

### D-5 · KÖZEPES — nem megerősített (és elvetett!) entitás a generálási alapban
- **Hely:** `solution-actions.ts:59-70` (loadPains: csak rejected-et szűr →
  ai_suggested fájdalompontok a komponens/opció-promptban);
  `process-actions.ts:145-151` (suggestToBe ugyanígy);
  `requirements-actions.ts:103-128` (generateRequirements: az ÖSSZES
  stakeholder — a REJECTED is — a promptba kerül, és a névillesztés kötést is
  ír rá); `:219-224` (generateStories: ai_suggested requirementekből is
  származtat).
- **Elv:** E1-lánc (vö. deriveUseCases: „KIZÁRÓLAG confirmed/manual" — a minta
  létezik, csak nem egységes) + entitás-elsőség.
- **Kockázat:** emberi kontrollt megkerülő tartalom-áramlás: az AI a saját, meg
  nem erősített (vagy explicit elvetett) javaslataira építkezik.
- **Javítás-irány:** egységes confirmed/manual szűrés minden generálási
  bemeneten (a deriveUseCases mintája).

### D-6 · ALACSONY — draft-dokumentum megerősített mezője jelzés nélkül cédula
- **Hely:** 0015 artifact_field ág (nincs artifact-status szűrés — korábban
  vizsgált, dokumentált döntés: a mező-state a kapu).
- **Javítás-irány:** nincs teendő VAGY halvány „draft doksiból" jelzés a
  katalógus-olvasóban.

**✅ Tiszta (D):** a NON_CLIENT szűrés a 4.2 mindkét fogyasztójánál él és
azonos logikájú (címkéző köteg `catalog-actions.ts:58-63,177-179` +
katalógus-oldal), ismeretlen mező konzervatívan BENT marad ✓; F4: emberi címke
gépi felülírás ellen védett, a javítás-napló append-only ✓; a 2.1 nézet
érintetlen (DERIVE-elv) ✓; supersession/deprecation indoklás-kényszere DB +
kód szinten ✓; a shortlist-dokumentumba kizárólag confirmed/manual + shortlist
listájú use case kerül ✓.

---

## E) Felület-konzisztencia

### E-1 · ALACSONY — a 0015 fázis-CASE nem fedi a P4–P6 típusokat
- **Hely:** 0015 (két CASE-lista, csak P0–P3 típusok) — a P4–P6 artefaktumok
  cédulái phase=NULL-lal jönnek; a lista a TS-konfig duplikátuma (dokumentált
  korlát).
- **Kockázat:** fázis-alapú csoportosítás/szűrés a katalógusban ezekre üres.
- **Javítás-irány:** a CASE bővítése a P4–P6 típusokkal (vagy nézet-regen a
  konfigból).

### E-2 · ALACSONY — process_map cédula excerptje a nyers 'as_is'/'to_be' kód
- **Hely:** 0015 process_map ág (excerpt = m.kind).
- **Elv:** kevert HU/EN tilalma a felületen.
- **Javítás-irány:** magyar felirat a nézetben vagy a megjelenítőben.

**✅ Tiszta (E):** i18n-paritás futtatva: **2098 kulcs, mindkét nyelv azonos
készlet** ✓; hardcoded magyar UI-szöveg a komponensekben nincs (grep-próba —
csak glifek: ✓ ✦ × ↳) ✓; a kapu-kritériumok jump-célja oda visz, ahol a
feltétel orvosolható (zóna vagy tool — `lib/phases/tools.ts:135-147`, B1-c) ✓;
zóna-alapértelmezés az F4 szerint ✓; a moduleOwned mező a szerkesztőben
zárolva, jelvénnyel ✓; a 17v2 + drift felület-verifikációk (viewport-keret,
stale-jelölés) a korábbi csomagokban zöldek ✓.

---

## F) LLM-lánc

### F-1 · MAGAS — csonkolás-detektálás csak egyetlen hívóhelyen
- **Hely:** `lib/llm/index.ts:903-908` — a `stop_reason === "max_tokens"` őr
  KIZÁRÓLAG az extractProcessMap-ben él (PROCESS_MAP_TRUNCATED). A többi ~23
  hívóhely (extract, deriveUseCases, suggestRequirements/Stories/Components/
  Options/EvalCases/Verdict/BuildDoc/ImplLinks, classifyKnowledgeItem,
  generateBody…) elvágott választ kaphat.
- **Elv:** parse-védelem (a csomag-mérce explicit kérdése).
- **Kockázat:** JSON-kimenetnél „nem érvényes JSON" hibaként landol (zavaró,
  de látható); a generateBody SZÖVEGES kimeneténél viszont a csonkolt body
  némán elmentődik — hosszú éles anyagnál adathiány jelzés nélkül.
- **Javítás-irány:** közös hívás-burkoló, amely minden create() után ellenőrzi
  a stop_reason-t (a process-map minta általánosítása).

### F-2 · KÖZEPES — hosszú, nem streamelt hívások a Vercel-korlát ellen
- **Hely:** `llm/index.ts:899` (max_tokens 16000, extractProcessMap), `:506`
  (8000, generateBody) — egyetlen, nem streamelt kérésben; az embedding-fetch
  (`lib/embeddings/index.ts:97`) timeout/AbortController nélkül.
- **Kockázat:** nagy leiratnál a kimenet generálási ideje a 300 s
  függvény-korlát fölé nyúlhat → 504, feldolgozatlan hibaág. (A címkéző köteg
  NF2-batchelése ezt jól kezeli — más tömeges művelet nincs: a többi action
  hívásonként 1 LLM-kérés.)
- **Javítás-irány:** streamelés vagy köteg-bontás a két nagy hívásra; timeout
  az embedding-fetchre.

### F-3 · KÖZEPES — MOCK-rés (4. példány): az inline parserek fedetlenek
- **Hely:** a mock dokumentáltan megkerüli a parse-réteget (`lib/llm/parse.ts`
  fejléce); a `scripts/llm-parse-check.ts` ezt a parse.ts 6 parserére pótolja —
  de az index.ts-ben INLINE élő parserek (suggestRequirements/Stories/
  Components/Options/EvalCases/Verdict/BuildDoc/ImplLinks) és a
  parseKnowledgeLabelSample regressziós fedés nélkül maradnak.
- **Kockázat:** a valós modell alak-variánsai (wrapper-objektum, string-szám,
  index-konvenció — pont a #6-bug családja) ezeken az utakon élesben érnek
  földet először.
- **Javítás-irány:** a parse-check kiterjesztése az inline parserekre (vagy
  kiemelésük a parse.ts-be).

### F-4 · ALACSONY — MOCK-rés (5. példány jelölt): a body-generálás fegyelme csak élesben mérhető
- **Hely:** mockGenerateBody determinisztikus sablon — sosem ad érvénytelen
  [n]-t, és nem teszteli a „forrás nélküli kiegészítést minimalizálj" puha
  kényszert; D2-típusnál a generateBodyAction a NYERS forrásokat is átadja
  (`artifact-actions.ts:1381-1404`), így a body a mezőkön túli nyers-tartalmat
  is behozhat (D2-elv feszültség).
- **Javítás-irány:** valós-LLM smoke a body-ra (a meglévő runbook-minta) +
  D2-nél a források szűkítése a citációkhoz ténylegesen szükségesekre.

**✅ Tiszta (F):** MINDEN LLM-hívás az adapteren megy át — az Anthropic-import
egyetlen fájlban él (`lib/llm/index.ts`, grep-pel igazolva), server-only ✓;
az embedding-adapter modellnév+verziót tárol, 1024-dimenzió-őrrel ✓; a parse.ts
#6-fix elvei (érték marad, hamis citáció esik; idézet-verifikáció; strukturális
törmelék-szűrő) következetesek ✓; minden exportált hívásnak van determinisztikus
mockja ✓; kulcsok kizárólag env-ből, kliens-bundle-be nem kerülnek ✓.

---

## G) I3 — semmi nem lóg: dead endek, árvák, holt kód

### G-1 · MAGAS — a 'selected' list_status írhatatlan (dead end, funkcionális következménnyel)
- **Hely:** olvasók: `goldenset-actions.ts:55-68` (resolveUseCase — „selected
  előnyben"), `artifact-actions.ts:930,960` (Megoldási javaslat),
  `lib/phases/service.ts:76`, 0004 CHECK. ÍRÓ: **nincs** — a
  shortlist/exclude akciók csak shortlist/excluded-et állítanak, más író a
  kódbázisban nem létezik.
- **Elv:** I3 (kapu-feltétel/branch, amit semmi nem táplál) + I1 (a P2→P3
  láncban nincs kiválasztási lépés).
- **Kockázat:** több shortlist-elemnél a golden set és a Megoldási javaslat
  MINDIG a legkorábban létrehozott elemre esik, némán, választási lehetőség
  nélkül — a preferencia-logika halott kód.
- **Javítás-irány:** „Kiválasztás" akció a P2-n (list_status='selected', HITL)
  — a fogyasztók már készen várják.

### G-2 · KÖZEPES — emberi munka efemer AI-sorokhoz köthető
- **Hely:** pain_point_stakeholders kötés ai_suggested fájdalompontra
  (`stakeholder-actions.ts:456-462` — a pain state-jét nem nézi; cascade-törlés
  újra-kivonatoláskor); input-hozzárendelés ai_suggested stakeholderre
  (`:398-431` assignInputSourceAction — nincs state-szűrés; a csere set
  null-oz); kézi opciók/kritériumok ai_suggested komponensen
  (`solution-actions.ts:329-421` — reject = törlés, opciók vele).
- **Elv:** E1 („a machine-javaslat efemer") ↔ az emberi ráépítés védelme.
- **Kockázat:** az újrafuttatás emberi kötés/hozzárendelés/opció-munkát töröl
  némán.
- **Javítás-irány:** kötés/hozzárendelés csak confirmed/manual sorra (ahogy a
  setPainStakeholdersAction a stakeholder-oldalon már teszi).

### G-3 · ALACSONY — 4.1-wrapper-ek fogyasztó nélkül (terv szerint)
- **Hely:** `knowledge-actions.ts` similarity/finding/supersession/suppression
  wrapper-ei — hívójuk még nincs (4.3/4.4). Nem hiba, de a D-1 zárása előtt ne
  kapjanak fogyasztót.

### G-4 · ALACSONY — holt helper: entityAnchor
- **Hely:** `lib/knowledge/anchor.ts` — hívó nélkül (korábban is
  megállapítva). Javítás-irány: törlés vagy felhasználás a 4.3-ban.

### G-5 · ALACSONY — a seed újrafuttatása visszaírja a demo-tartalmat
- **Hely:** `scripts/seed.ts:245-255` — az artifacts-upsert a charter body-t és
  mezőit a seed-értékekre állítja vissza, az élő szerkesztéseket felülírva
  (az „idempotens" ígéret a duplikációra igaz, a tartalomra nem).
- **Javítás-irány:** upsert helyett insert-if-missing a tartalom-hordozó
  sorokra.

### G-6 · ALACSONY — *_deprecated táblák (0014) — szándékosan megtartva
- Leltári tétel: component_step_links_deprecated + impl_links_deprecated adata
  él (törlés tilos — dokumentált); app-kód nem hivatkozik rájuk ✓.

**✅ Tiszta (G) — valós DB-próbákkal:** a lokális fixtúra-DB-n árva
címke-sor / embedding / metaadat a 2.1 nézethez képest: **0** ✓; lógó
render-él (törölt use case-re): **0** ✓; érvénytelen pain-hivatkozás a
use_case-eken: **0** ✓; a use_cases ↔ catalog ↔ labeling lánc horgony-kulcsai
konzisztensek ✓.

---

## Összefoglaló számokkal

| Prioritás | Darab | Tételek |
|---|---|---|
| KRITIKUS | **0** | — |
| MAGAS | **8** | A-1, B-1 (ismert), C-1, C-2, C-3, D-1, F-1, G-1 |
| KÖZEPES | **16** | A-2, A-3, A-4, B-2, B-3, B-4 (a dokk-kötések eredet-jelzésével együtt), C-4, C-5, C-6, D-2, D-3, D-4, D-5, F-2, F-3, G-2 |
| ALACSONY | **13** | A-5, A-6, A-7, B-5, C-7, D-6, E-1, E-2, F-4, G-3, G-4, G-5, G-6 |
| **Összesen** | **37** | ebből 1 korábban ismert nyitott (B-1), 2 ismert követő igény pontosítva (D-1, D-2) |

Futtatott valós próbák: 6 SQL-próbacsomag a lokális PG16-on (duplikált
process_maps-verzió beszúrása — SIKERÜLT, ez az A-1 bizonyítéka; CHECK-készlet
kiolvasás; 3× árva-számlálás; kivezetett-horgony számlálás) + `npm run
i18n:check` (zöld) + 3 célzott grep-próba (adapter-kizárólagosság, hardcoded
szöveg, 'selected'-írók).

## A három legfontosabb, amit Máténak először látnia kell

1. **G-1 — a „kiválasztott use case" lépés hiányzik a láncból.** A P3 (golden
   set, Megoldási javaslat) „selected előnyben" logikával készül, de 'selected'
   státuszt SEMMI nem tud beállítani — több shortlist-elemnél a rendszer némán
   a legkorábbi elemre építi a teljes P3-at. Egy kis „Kiválasztás" akció zárja;
   a fogyasztó-oldal már készen van.
2. **C-1 + C-2 + C-3 — az elavulás-lánc három néma rése.** Fájdalompont-átírás,
   nyertes-opció-váltás és forrás-frissítés a térkép alatt: mindhárom úgy
   csúsztatja el a ráépülő (akár jóváhagyott) tartalmat, hogy EGYETLEN meglévő
   jelölő sem szólal meg. A meglévő derivált-jelölő minta (A8) kiterjesztése
   egy csomagban fedi mindhármat.
3. **F-1 — csonkolás-védelem csak egy hívóhelyen.** Valós LLM-mel, hosszú éles
   anyagnál a max_tokens-elvágás a generateBody-nál NÉMA tartalom-vesztés, a
   JSON-utakon zavaró álhiba. A process-map-nél már megírt őr közös burkolóba
   emelése olcsó és mindent fed. (Élesítés előtt a D-1 RPC-szűrés zárása is
   ide kívánkozik, mielőtt a 4.3 fogyasztót kap.)

## Megjegyzés

Az audit alatt SEMMI nem módosult: nincs kód-változás, a lokális DB-próbák
BEGIN/ROLLBACK alatt futottak, a fixtúra-adat érintetlen. A jelentésen kívül
ez a csomag egyetlen fájlt sem ad a repóhoz.

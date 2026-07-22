# Epic 3 · 3.2 — Backend compliance check (zóna-tartalom + nevezék + elavulás-jelölők + lezárt fázis)

**Dátum:** 2026-07-22 · **Branch:** `dev` · **Típus:** kötelező előzetes leltár (kód nem változik ebben a lépésben)
**Épül a 3.1-re** (tool-sáv, zóna-váltó, kapu-navigáció — leszállítva, `docs/state/2026-07-22-csomag-b1.md`).

---

## 1. Zóna-nevezék ma (i18n)

A négy zóna neve a `gates` i18n-névtérben él (`PhaseWorkspace.tsx` a `tGates("zoneInput"|"zoneTools"|"zoneOutput"|"zoneGate")` kulcsokból olvassa a flow-strip kártyák feliratát):

| Kulcs | HU (ma) | EN (ma) | Spec-cél |
|---|---|---|---|
| `gates.zoneInput` | „① Bemenet" | „① Input" | „① Források" |
| `gates.zoneTools` | „② Munkaeszközök" | „② Work tools" | „② Feldolgozás" |
| `gates.zoneOutput` | „③ Kimenet" | „③ Output" | változatlan |
| `gates.zoneGate` | „④ Kapu" | „④ Gate" | változatlan |

**Egyéb „Bemenet"/„Munkaeszköz" előfordulás:** a `workspace` névtérben (`addCta: "Bemenet hozzáadása"`, `inputTitlePlaceholder`, `inputsLead: "…az új bemenet a(z) {phase} fázis címkéjét kapja"`, `statRawInputs: "nyers bemenet"`) a „bemenet" szó **generikus** — a nyers forrás-tétel (`input_items` sor) megnevezésére, NEM a zóna nevére. Ez a fogalom (nyersanyag/forrás-tétel) a C1-audit óta már „forrás"-ként is szerepel (`inputsLead` maga is „nyersanyag"-ot mond). **Döntés:** a 3.2-a F1 negatív ellenőrzése („sehol nem marad Bemenet/Munkaeszközök felirat") a NÉGY ZÓNA-NÉVRE vonatkozik (ez az egyetlen tesztelhető AC-forma); a generikus „bemenet hozzáadása" CTA-szöveg **kívül esik** a listed „Érintett fájlok" körén (zóna-panelek/zóna-nevek, nem az input-form copy) — nem módosítom, hogy ne bővítsem a scope-ot egy külön terminológiai csomagra.

**Lelet — stale sidebar-feliratok (NEM a listed AC hatóköre, dokumentálva):** `nav.workbench = "Workbench"` és `nav.heatmap = "Heatmap"` a globális `ProjectContextNav.tsx`-ben (a fázis-munkafelület almenüje) — angol, a B1 ELŐTTI zóna-modell maradványai (a hőtérkép már a tool-sávban van, nem a „workbench" zónában). Nem „Bemenet"/„Munkaeszközök" szó szerint, így az F1 negatív teszt nem üti meg; az „Érintett fájlok" listája sem nevezi meg a globális sidebart. **Nem nyúlok hozzá** — parkoló-lista tétel.

**Megjelenítési nevek (3.2-a lista):**
- „Opció-összevető" (`tools.names.solution`) és „Megoldás-tervező" (`tools.names.builddoc`) **már** a spec szerinti alak (B1-ben így került be) — nincs teendő.
- „Use case-rangsor", „Megoldásterv (Solution Design)", „Kiértékelési riport (Evaluation Report)" **HIÁNYOZNAK** — a DOKUMENTUM-TÍPUS (`artifactTypes.*`) megjelenítési neve ma: `useCaseShortlist` = „Priorizált use case-shortlist", `megoldasDokumentacio` = „Megoldás-dokumentáció", `tesztriport` = „Tesztriport". Ezeket át kell nevezni (**csak i18n-label**, a `typeDef.key`/`artifacts.type` DB-érték VÁLTOZATLAN marad — nincs séma-hatás).
- „tudáselem" — a spec generikus főnévként sorolja fel; a 2.1-katalógus ÚJ UI-elemeinél (3.2-d: elavulás-jelölő, „hol van használva") ezt a szót használom az ÚJ szövegekben. A MEGLÉVŐ „entitás" szóhasználat (pl. `entities` névtér, P1 szekció-címek) NEM tesztelhető AC egyik F-pontban sem — nem indítok teljes „entitás→tudáselem" globális cserét (külön terminológiai csomag lenne, scope-bővítés).
- „kapu-deliverable" (kiírva) — **HIÁNYZIK teljesen**: nincs ilyen badge/felirat sehol ma (`grep` nulla találat). Új i18n kulcs + vizuális jelvény kell minden `typeDef.gate === true` dokumentum-kártyán.

---

## 2. ②/③ tényleges tartalom ma vs. F2/F3 cél

**A ② zóna (`workbenchPanel`, `PhaseWorkspace.tsx`) építése:**
- **P1 ág** (`isP1`): 3 entitás-szekció (Fájdalompontok/Use case-ek/Stakeholderek) MINDIG renderel, majd `fieldTypes.map(FieldWorkBlock)` — `fieldTypes = phaseTypes.filter(!entitySourced)`, ami P1-re `[Felmérési riport]`. **Ez már megfelel a spec céljának** (3 entitás-gyártó + 1 field-extract = 4 blokk).
- **Nem-P1 ág:** `phaseTypes.length === 0 ? üres : phaseTypes.map(FieldWorkBlock)` — **ez a `phaseTypes`-t használja, NEM a `fieldTypes`-t!** Ennek két hibás következménye van:
  - **P2:** `phaseTypes` = [Business case, Pilot-terv, **Megoldási javaslat**] — a Megoldási javaslat **entitySourced** (D2), mégis `FieldWorkBlock`-ként renderel a ②-ben (kivonatolás-hint helyett a `entitySourcedHint` szöveg jelenik meg, DE a mező-kártyák — `FieldCard` lista — is renderelnek alatta, a `latest.fields`-ből). Ez az F2 „a ②-ben nem jelenik meg dokumentum-kártya" elvárással **ütközik** — bár nem az OutputCard-típusú kártya jelenik meg, a mező-szintű dokumentum-tartalom IGEN, egy D2-típusra, ahol a spec ezt kifejezetten tiltja (P2 ②-ben csak 2 field-extract blokk szabad, a Megoldási javaslat NEM). **Valós hiba, javítandó.**
  - **P0:** `phaseTypes` mindhárom típusa nem-entitySourced → `phaseTypes === fieldTypes` ténylegesen, a hiba itt nem jelentkezik (véletlenül helyes).
  - **P3:** `phaseTypes` = [Megoldás-dokumentáció, Tesztriport] — egyik sem `entitySourced`, ezért MINDKETTŐ `FieldWorkBlock`-ot kap: `ExtractForm` (kivonatolás-indító) + a dokumentum ÖSSZES mezőjének `FieldCard`-listája (a `moduleOwned` mezők read-only jelvénnyel, a szabad mezők — `architektura`, `uzemeltetesi_jegyzet`, `maradek_kockazat` — szerkeszthetők/kivonatolhatók). **Ez homlokegyenest ellentmond** a spec céljának: „P3: üres-állapot — a tudáselem-építés a toolokban zajlik".

**Kritikus lánc-vizsgálat (nem STOP, de dokumentálandó tervezési döntés):** a P3 típusok szabad szöveges mezői (`architektura` **KÖTELEZŐ, kapu-blokkoló**, `uzemeltetesi_jegyzet`, `maradek_kockazat`) kivonatolása MA **kizárólag** a ② `ExtractForm`-on át érhető el — az `ArtifactEditor`/`EditorFieldAccordion` (a dedikált szerkesztő, `/artifact/[id]`) csak megerősítést/kézi szerkesztést/elvetést tud (`confirmFieldAction`/`editFieldAction`/`dismissFieldAction` + „Kézi kitöltés"), **AI-kivonatolás triggerét NEM tartalmazza** (`grep` nulla találat `page.tsx`-ben és `ArtifactEditor.tsx`-ben). Ha a P3 ②-t egyszerűen kiürítem, az `architektura` (kapu-kritikus, kötelező mező) elveszíti az egyetlen AI-asszisztált útját — csak kézi írás maradna.

**Döntés (a spec F3 „teljes funkcióval (generálás VAGY kivonatolás)" kitétele alapján):** a P3 ③-kártyák (`OutputCard`) kapják meg — KIZÁRÓLAG a D3 (modul-mezős) típusoknál — a kivonatolás-indítót + a mező-lista beágyazott megjelenítését (a mai `FieldWorkBlock` belső tartalmát átemelve). Ez NEM új logika (a spec explicit tiltja az újat) — a MEGLÉVŐ `ExtractForm`/`FieldCard`/`extractAction` gépezet áthelyezése a ②-ből a ③-ba, kizárólag a D3-típusokra, ahol a ② üres marad. Indoklás: F3 kimondottan felsorolja „generálás vagy kivonatolás" mint a ③-kártya „teljes funkciójának" része — ez pontosan azoknál a típusoknál értelmezhető szó szerint, ahol a ② nem hordozza többé az extract-triggert (D3/P3). D1-típusoknál (P0, P1 Felmérési riport, P2 Business case/Pilot-terv) a kivonatolás VÁLTOZATLANUL a ②-ben marad — ott NEM duplikálom a ③-ba (a spec nem kér ilyen duplikációt, és felesleges is lenne).

**Generalizált szabály (nem fázis-specifikus hardkód):** `docType(typeDef)` osztályozó — D2 ha `entitySourced`, D3 ha van `moduleOwned` mezője, egyébként D1. A ② csak D1-típusokat rendereli `FieldWorkBlock`-ként; ha egy fázisnak ZÉRÓ D1-típusa van (de van egyéb típusa), a ② üres-állapotot mutat a tool-sávra mutató szöveggel. Ez a szabály **P3-ra magától** üres-állapotot ad (mindkét típusa D3), P0/P1/P2-re a helyes blokk-számot (a Megoldási javaslat kikerül P2 ②-jéből D2 lévén) — **nincs `if (phase === "P3")` speciális eset a kódban**, a viselkedés a típus-tulajdonságokból derül.

## 3. A P2 ③ Kimenet zóna-kártya hiányzó számlálója — GYÖKÉROK AZONOSÍTVA (valós hiba)

A flow-strip ③-kártyájának metrikája:
```
metric: outRequired > 0 ? `${outFilled}/${outRequired}` : undefined,
```
ahol `outFilled`/`outRequired` a fázis MINDEN típusának `completeness()`-összegzése — de **csak azokra a típusokra, amelyeknek MÁR VAN legalább egy artifact-sora** (`latestOfType(td) !== null`). Ha egy fázisban MÉG EGYETLEN dokumentum sem lett generálva/kivonatolva (0 artifact-sor mindhárom P2 típusra egy friss projektben), `outRequired` **0 marad**, és a metrika `undefined` — **eltűnik a kártyáról**.

Ez **ELTÉR** a másik három zóna-kártya sémájától: az ① (`metric: sourceRows.length` — feltétel nélkül, „0" is megjelenne), a ② nem-P1 ág (`metric: confirmedFieldCount` — feltétel nélkül) és a ④ (`chip: satisfiedCount/criteria.length` — feltétel nélkül) **SOSEM rejti el a metrikát nullánál**. A ③ az EGYETLEN zóna, ahol a metrika feltételesen `undefined` lehet — **ez valódi inkonzisztencia, nem szándékos üres-állapot** (a spec explicit kéri: „ha a ③ zóna-kártya számlálója hiányzik, pótold, a többi zónával azonos sémában").

**Javítás:** a metrikát dokumentum-szintű, feltétel nélküli számlálóra cserélem: `${docsStarted}/${phaseTypes.length}` (hány fázis-dokumentumnak van már legalább egy verziója / a fázis dokumentum-típusainak száma) — ugyanaz a „darabszám, mindig látszik" séma, mint az ①/②/④ kártyákon.

## 4. A 2.1 katalógus-réteg interfészei — jelenleg FOGYASZTÓ NÉLKÜL

- `src/lib/catalog.ts`: `usageOf(db, projectId, blockType, blockId): Promise<UsageResult>` (dokumentum-élek + entitás-élek + citációk, típus szerint elkülönítve), `renderedBy(db, artifactId)`, `renderStaleSinceForArtifact(db, projectId, artifactId)`. **`grep` nulla UI-hivatkozás** — a C1-csomag óta tisztán szerveroldali API, sosem hívta meg egyetlen komponens sem.
- `src/lib/staleness.ts`: `sourceUpdatedSince`, `docStaleSince`, `renderStaleSince`, `sourceUpdatedForRows`, `activeStaleSince` — ezek **RÉSZBEN** be vannak kötve:
  - `source_updated`: KIZÁRÓLAG `pain_points` és `use_cases` kártyákon (P1 ②, `PhaseWorkspace.tsx` `sourceUpdatedFlag`). **Stakeholder-kártyákon NINCS** bekötve, holott a `sourceUpdatedForRows` (C1) általános, bármely `source_input_ids`-hordozó táblára működik.
  - `doc_stale`: KIZÁRÓLAG a dedikált artifact-editor oldalon (`/artifact/[artifactId]/page.tsx`, `staleBadge` — 3 típusra: Megoldás-dokumentáció/Tesztriport/Megoldási javaslat kézzel felsorolva egy switch-ben). **A ③ zóna-kártyán (OutputCard) NINCS megjelenítve** — a felhasználónak be kell nyitnia a szerkesztőt, hogy lássa.
  - `render_stale`: **SEHOL nincs UI-bekötve** — sem az editoron, sem a workspace-en.
- **Döntés:** a `page.tsx`-ben duplikált `doc_stale`-számító switch-logikát KIEMELEM egy megosztott helperbe (`lib/artifacts/doc-stale.ts` vagy hasonló), amit MIND a szerkesztő-oldal, MIND az új `OutputCard`-beli badge használ — elkerülve a logika-duplikálást (a két hely ma egymástól függetlenül drifthetne). A `render_stale`-t az `OutputCard`-on ÚJONNAN kötöm be (`renderStaleSinceForArtifact`); a `source_updated`-et kiterjesztem a stakeholder-kártyákra is (a meglévő mintát követve, nem új logikával).
- **„Hol van használva":** a `usageOf()` per-hívás több lekérdezést indít (nem batch-elt) — a C1 záró jelentés dokumentálta ezt mint elfogadott korlátot demo-méretű (pár száz elem) projektre. A 3.2-d ezt KIZÁRÓLAG a **jóváhagyott** (confirmed/manual) tudáselem-kártyákon hívja (①②③ nem minden sorára, csak a megerősítettekre) — ez tovább szűkíti a hívásszámot.

## 5. Lezárt fázis nézet-rétege — HIÁNYZIK, ez a 3.2-e feladata (NEM ellentmondás)

`page.tsx` a `state === "completed"` ágban **SOHA nem rendereli a `PhaseWorkspace`-t** — helyette egy KÜLÖN, egyszerűsített összegző nézet fut: „A fázis lezárva" sáv + `PhaseDocumentTiles` (egy MÁSIK, kártyarácsos dokumentum-lista komponens, NEM az `OutputCard`/zóna-alapú ③) + `DecisionHistory`. A tool-sáv, a zóna-váltó, a ② interakciók **NEM érhetők el** egy lezárt fázison — ez PONTOSAN az a hiány, amit a spec §1 problémafelvetése is név szerint megnevez („a lezárt fázisnak nincs olvasható állapota"). **Nem ellentmondás — ez a 3.2-e implementálandó cél**, nem egy blokkoló prekoncepció-ütközés.

**Terv:** a `completed` ág EZENTÚL a `PhaseWorkspace`-t is rendereli, egy új `locked: boolean` prop `true` értékével (a meglévő banner + `PhaseDocumentTiles` + `DecisionHistory` VÁLTOZATLANUL megmarad utána — ugyanaz a minta, mint az aktív ágakban, ahol a `PhaseWorkspace` UTÁN is megjelenik a `PhaseDocumentTiles`, NF2/konzisztencia). A `locked` prop letiltja: ① `PhaseInputForm`, ② `ExtractForm`/entitás-hozzáadás/E1-gombok, ③ generálás/kivonatolás-triggerek (a `OutputCard`-ban), ④ `GateCloseForm` (amúgy is értelmetlen egy már lezárt fázison — a „visszanyitás nincs" korlát garantálásához explicit ki kell zárni, mert a mai feltétel `state !== "open"` HAMIS POZITÍVAN renderelné a zárás-űrlapot egy `completed` fázison, ha a `PhaseWorkspace`-t egyszerűen meghívnám módosítás nélkül). A kapu-kritérium lista + a `GateCriterionAction` navigációs gombok VÁLTOZATLANUL működnek (zónák közti navigáció NEM „visszanyitás" — nem mutáló művelet; egyébként egy lezárt fázison minden kritérium teljesült, tehát nincs is renderelhető akció-gomb).

**Kimondott korlát (a scope-on belül maradva):** a `locked` állapot a `PhaseWorkspace` SAJÁT, helyben beágyazott triggereire vonatkozik. A DEDIKÁLT artifact-szerkesztő oldal (`/artifact/[artifactId]`) editálhatósága TOVÁBBRA IS a `artifact.status === 'draft'` alapján dől el, FÜGGETLENÜL a fázis lezárt állapotától — ez egy előzetesen létező, elkülönült mechanizmus, amit a „fázis-munkafelület zóna-paneljei" explicit fájlkör nem fed le. Elméleti él-eset: egy lezárt fázis nem-kapu dokumentuma (pl. Engagement-terv) MARADHAT draft állapotban (a kapu csak a `[K]`-jelölt deliverable-öket követeli meg), és a szerkesztője a mai logika szerint TOVÁBBRA IS szerkeszthető marad, ha közvetlenül megnyitják. Ez a 3.2 scope-ján kívül esik (külön csomag fedné, ha ez tényleges probléma) — a záró jelentésben limitációként rögzítem.

---

## Összegzés — mit kell módosítani

1. **i18n:** `gates.zoneInput/zoneTools` átnevezés (HU+EN); `artifactTypes.useCaseShortlist/megoldasDokumentacio/tesztriport` átnevezés (HU+EN); új `kapu-deliverable` badge-kulcs.
2. **② tartalom:** `phaseTypes` → `d1Types` (docType-alapú szűrés) a nem-P1 ágban; P3 (és bármely jövőbeli csak-D2/D3 fázis) automatikusan üres-állapotot kap.
3. **③ tartalom:** `OutputCard` bővítése D1/D2/D3 jelzéssel + kapu-deliverable badge-dzsel + (D3-ra) beágyazott mező-partíciós kivonatolással; a zóna-kártya metrikájának javítása (feltétel nélküli dokumentum-számláló).
4. **Katalógus-láthatóság:** megosztott `doc_stale` helper + `render_stale` bekötés az `OutputCard`-on; `source_updated` kiterjesztés stakeholderekre; „hol van használva" badge jóváhagyott tudáselem- és dokumentum-kártyákon.
5. **Lezárt fázis:** `PhaseWorkspace` `locked` prop + `page.tsx` completed-ág átalakítása.

*Ez tényfeltárás + döntés-rögzítés. A kód a következő lépésekben változik.*

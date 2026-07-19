# IA-audit — projekt-szintű navigáció + fázis-munkafelület (2026-07-19)

**Típus:** read-only felmérés (discovery). **Nincs kód-, séma-, migráció- vagy i18n-változtatás.** Branch: `dev`, commit nélkül.
**Cél:** a projekt-szintű információs architektúra (IA) valós struktúrájának kibogozása + indokolt átrendezési javaslat a design-agentnek. A ground truth a kódból, nem képernyőfotóból. A végleges IA-döntés a design-agenté és Mátéé — ez a jelentés enumerál és ajánl.

> **A központi feszültség egy mondatban:** két, egymással átfedő szervező-elv fut párhuzamosan — a fázis-munkafelület **folyamat-kerete** (Bemenet → Munkaeszköz → Kimenet → Kapu) és a projekt-subnav **tool/entitás-listája** —, de a kettő között **egyetlen link sincs**. A subnav-toolok pont abban a zónában (② Munkaeszközök) nem jelennek meg, amely a nevét viseli.

---

## 1. Nav-leltár — a három réteg (route → i18n-címke → komponens)

### 1.A Globális bal-sáv (határ — nem a fókusz)
Komponens: `src/components/SidebarNav.tsx` (`NAV_ITEMS`, 33–40). i18n namespace: `nav`. Lapos, mindig látható, projekt-független.

| # | Route | i18n-kulcs | Címke (HU) |
|---|-------|-----------|------------|
| 1 | `/` | `nav.dashboard` | Vezérlőpult |
| 2 | `/clients` | `nav.clients` | Ügyfelek |
| 3 | `/projects` (`also: /project/`) | `nav.projects` | Projektek |
| 4 | `/inbox` | `nav.inbox` | Beérkező |
| 5 | `/library` | `nav.library` | Könyvtár |
| 6 | `/settings` | `nav.settings` | Beállítások |

### 1.B Projekt-subnav (a fókusz) — `ProjectContextNav.tsx`
Csak `/project/:id/*` útvonalon renderel (a `layout.tsx` illeszti be). i18n namespace: `nav`. Lapos lista; alul a zárolt fázisok tartománya (nem navigáló, csak tooltip). Az aktív fázist és a Dokumentumok-badge-et a `layout.tsx` a `loadPhaseBoard`-ból számolja.

| Sorrend | Route | i18n-kulcs | Címke (HU) | Cél-komponens | Scope |
|---|-------|-----------|------------|---------------|-------|
| 1 | `/project/:id` | `nav.cockpit` | Cockpit | `app/project/[id]/page.tsx` | projekt-globális |
| 2 | `/project/:id/phase/:activePhase` | `nav.phaseWorkspace` | Fázis-munkafelület | `phase/[phase]/page.tsx` → `PhaseWorkspace` | **fázis-scoped** (aktív fázis) |
| 2a | `…/phase/:p` (aktív fázison, sub) | `nav.workbench` | Workbench | ugyanaz | fázis-scoped |
| 2b | `…/phase/:p#heatmap` (aktív fázison, sub) | `nav.heatmap` | Heatmap | ugyanaz (anchor) | fázis-scoped (P1) |
| 3 | `/project/:id/documents` | `nav.documents` | Dokumentumok | `documents/page.tsx` (+badge) | projekt-globális, **fázis-szekciózott** |
| 4 | `/project/:id/sources` | `nav.sources` | Források | `sources/page.tsx` | projekt-globális |
| 5 | `/project/:id/process` | `nav.processMap` | Folyamattérkép | `process/page.tsx` → `ProcessMapViewer` | fázis-implicit (P1 AS-IS → P2 TO-BE) |
| 6 | `/project/:id/requirements` | `nav.requirements` | Követelmények | `requirements/page.tsx` → `RequirementsBoard` | fázis-implicit (P2) |
| 7 | `/project/:id/solution` | `nav.solution` | Megoldás-terv | `solution/page.tsx` → `SolutionBoard` | fázis-implicit (P2) |
| 8 | `/project/:id/builddoc` | `nav.builddoc` | Megoldás-dok. | `builddoc/page.tsx` → `BuildDocBoard` | fázis-implicit (P3) |
| 9 | `/project/:id/goldenset` | `nav.goldenset` | Golden set & riport | `goldenset/page.tsx` → `GoldenSetBoard` | fázis-implicit (P3) |

**Nem szerepel a subnavban, de projekt-szintű route:** `artifact/[artifactId]` (+`/export`), `stakeholder/[stakeholderId]`, `process/[mapId]`, `requirements/r/[reqId]`, `requirements/s/[storyId]`, `solution/c/[componentId]`. Ezek belépői beágyazott linkek (drill-in), nincs önálló nav-elemük.

### 1.C Fázis-munkafelület — négyzónás anatómia (`PhaseWorkspace.tsx`)
A négy zóna a `WorkspaceShell` `ZoneFlowStrip`-jén fülekké válik (egyszerre egy panel). i18n namespace: `gates` (zóna-címkék) + `workspace` (lead/metrika). A `①..④` prefixet a `stripLabel` levágja.

| Zóna | i18n-kulcs | Címke (HU) | Panel | Fő adat-forrás | Kifelé mutató link |
|---|---|---|---|---|---|
| ① Bemenet | `gates.zoneInput` | Bemenet | `inputPanel` (479–512) | `input_items` (project_id, nem fázisra szűrve) | **nincs** (csak beágyazott `PhaseInputForm`) |
| ② Munkaeszközök | `gates.zoneTools` | Munkaeszközök | `workbenchPanel` (517–738) | P1: `pain_points`/`use_cases`/`stakeholders`(+heatmap); nem-P1: `artifacts` (fázis-típusok) | **csak** `…/stakeholder/:id` (P1) |
| ③ Kimenet | `gates.zoneOutput` | Kimenet | `outputPanel` (740–749) | `artifacts` (fázis-típusok) | **csak** `…/artifact/:id` (szerkesztő) |
| ④ Kapu | `gates.zoneGate` | Kapu | `gatePanel` (753–802) | `entry.criteria` (`loadPhaseBoard`) + `GateCloseForm` | **nincs** |

A fázis-oldal a workspace ALATT még megjeleníti a `PhaseDocumentTiles`-t (a fázis deliverable-jei csempeként, `…/artifact/:id` linkkel) és a `DecisionHistory`-t.

---

## 2. Tool-térkép — mi hol érhető el, milyen néven

| Tool / entitás | Kanonikus otthon (route) | Subnav-címke | Megjelenik-e máshol? | Több néven? |
|---|---|---|---|---|
| Nyersanyag / Bemenet | `/sources` | **Források** | Igen: ① **Bemenet** zóna (ugyanaz az `input_items`) | **Igen** — „Források" ⇄ „Bemenet"/„nyersanyag" |
| Deliverable-ek / kimenet | `/documents` | **Dokumentumok** | Igen: ③ **Kimenet** zóna + `PhaseDocumentTiles` (mind `artifacts`) | **Igen** — „Dokumentumok" ⇄ „Kimenet" |
| Fájdalompont / use case / stakeholder | ② Munkaeszközök (P1) | — (nincs subnav-elem) | Stakeholder-detail: `/stakeholder/:id`; cockpit stakeholder-lista | részben (a workbench az egyetlen otthon) |
| Folyamattérkép | `/process` | **Folyamattérkép** | Nem (a fázisoldal NEM linkeli) | nem |
| Követelmények | `/requirements` | **Követelmények** | Nem | nem |
| Megoldás-terv | `/solution` | **Megoldás-terv** | Nem | nem |
| Megoldás-dok. | `/builddoc` | **Megoldás-dok.** | Nem | nem |
| Golden set & riport | `/goldenset` | **Golden set & riport** | Nem | nem |
| Artefaktum-szerkesztő | `/artifact/:id` | — | ③ Kimenet, Dokumentumok, PhaseDocumentTiles, Cockpit mind ide linkel | nem |

**Kulcsészlelés:** az 5 „nagy" tool-modul (Folyamattérkép, Követelmények, Megoldás-terv, Megoldás-dok., Golden set) **kizárólag** a subnavból érhető el — a fázis-munkafelület egyetlen ponton sem hivatkozik rájuk. Fordítva: a P1-entitások (fájdalompont/use case) **kizárólag** a ② Munkaeszközök zónából érhetők el — nincs subnav-belépőjük.

---

## 3. Átfedés / redundancia-térkép

Szétválasztás: **(a)** puszta UI-duplikátum (ugyanaz kétszer, azonosan) · **(b)** terminológiai duplikáció ugyanarra a fogalomra (egy dolog, két név/otthon) · **(c)** valóban külön dolog, csak hasonlónak tűnik.

### 3.1 Bemenet (①) ↔ Források — **(b)**, részleges (c)-árnyalattal
Mindkettő ugyanazt a `input_items` táblát olvassa. A ① Bemenet zóna a nyersanyagok számozott listája + hozzáadás, **fázis-címkével** framezve („az új bemenet a(z) {phase} fázis címkéjét kapja"). A `/sources` ugyanezt a listát adja, de **plusz funkcióval**: fordított citációs index („hivatkozva N× / HOL"). → **Ugyanaz az igazság-forrás két néven** (b); a Sources nem puszta duplikátum, mert a citáció-nézet több (c-árnyalat). Nincs köztük link.

### 3.2 Kimenet (③) ↔ Dokumentumok — **(b)** + egy valódi **(a)**
Mindkettő az `artifacts` táblát mutatja, mindkettő `…/artifact/:id`-re linkel. A ③ Kimenet a fázis típusaira szűrt szelet (+ generálás-akciók); a `/documents` a projekt-globális, **fázis-szekciózott** tár (+ export). → **Ugyanaz az entitás két néven/scope-ban** (b). Ezen felül: a fázis-oldalon a ③ Kimenet-kártyák ÉS a `PhaseDocumentTiles` **ugyanazt a fázis-deliverable-halmazt** rendereli egymás alatt — ez közel **(a)** puszta duplikátum egyetlen oldalon.

### 3.3 Munkaeszköz-zóna (②) ↔ subnav-toolok — **(b)** a keret, DE a tartalom disjunkt
Ez a legfélrevezetőbb átfedés. A ② zóna neve **„Munkaeszközök"** — fogalmilag ez „a toolok helye". A subnav-lista (Folyamattérkép … Golden set) is „a toolok helye". → **A KERET/CÍMKE ütközik** (b: két felület azt állítja, hogy ő a tool-zóna). **De a tényleges tartalom NEM duplikált:** a ② zóna P1-ben entitás-munkát (pain/uc/stakeholder + heatmap), nem-P1-ben generikus mező-kivonatolást tartalmaz; a subnav-toolok viszont a process/requirements/solution/goldenset/builddoc modulok. A két halmaz **disjunkt**, és nincs köztük híd. → Ez tehát **nem adat-duplikáció, hanem terminológiai/hely-kollízió** (b a névre) + strukturális rés (a toolok hiányoznak a saját nevű zónájukból). Ez a jelentés fő megállapítása.

### 3.4 Nem átfedés — **(c)** (tisztázásképp)
- Cockpit ↔ Fázis-munkafelület: külön dolgok. A Cockpit a projekt kapu-fókusza + spine (nem tool-lista, nem zóna); a fázis-oldal a munkavégzés. A Cockpit **nem** linkel egyetlen tool-modulra sem (csak `/phase/:p`, `/artifact/:id`, `/documents`, `/stakeholder/:id`, `/clients/:id`). Helyes elkülönülés.
- Heatmap (2b) ↔ Golden set: külön (P1 use-case hőtérkép vs P3 minőség-riport).

---

## 4. Fázis-scope táblázat — fázis-specifikus vs projekt-globális

| Belépő | Scope | Bizonyíték |
|---|---|---|
| Cockpit | projekt-globális | teljes projekt spine + kapu-fókusz |
| Fázis-munkafelület | **fázis-scoped** (aktív) | `layout.tsx` aktív-fázis számítás; a nav az aktív fázisra mutat |
| Források | projekt-globális | `sources/page.tsx` nem szűr fázisra (az `input_items` fázis-*címkét* hordoz, de a store globális) |
| Dokumentumok | projekt-globális, **fázis-szekciózott** | `documents/page.tsx`: `PHASE_IDS.map(... RepoPhaseSection)` |
| Folyamattérkép | **P1→P2** | `process/page.tsx`: `as_is` (P1) + `to_be` (P2) szekció |
| Követelmények | **P2** | `requirements/page.tsx:79` `projectLabel = "… / P2"` |
| Megoldás-terv | **P2** | `solution/page.tsx:80` `"… / P2"`; a JÓVÁHAGYOTT TO-BE-re épül |
| Megoldás-dok. | **P3** | `builddoc/page.tsx:138` `"… / P3"` |
| Golden set & riport | **P3** | `goldenset/page.tsx:125` `"… / P3"` |

**Ez a kulcs az átfedés feloldásához:** a subnav 5 tool-modulja mind **fázis-specifikus** (P1–P3), de a subnav **laposan, fázis-jelölés nélkül** listázza őket — a P1-ben álló felhasználó a P3-toolokat (Golden set, Megoldás-dok.) egyenrangú súllyal látja. A Források és a Dokumentumok viszont valóban **projekt-globálisak** — ezek jogosan állandóak. Tehát a Bemenet/Kimenet-zónák a globális store-ok **fázis-lencséi**, nem önálló otthonok.

---

## 5. Rés-lista (konkrét hiányok)

**R1 — A fázisoldal nem linkel a fázis-releváns toolokra.** A `PhaseWorkspace.tsx` + a fázis-oldal + a zóna-komponensek **egyetlen** hrefet sem tartalmaznak `/process`, `/requirements`, `/solution`, `/goldenset`, `/builddoc`, `/documents`, `/sources` felé (repo-szintű grep: 0 találat a fázis-fában). Következmény: P2-ben a munkafelület nem ajánlja fel a Folyamattérképet / Követelményeket / Megoldás-tervet; P3-ban a Golden setet / Megoldás-dokot — pedig **ezek maguk a P2/P3 munka**. A nem-P1 ② zóna helyette csak generikus mező-kivonatolást mutat.

**R2 — A subnav elveszti a fázis-kontextust.** A tool-oldalak (`requirements`/`solution`/`goldenset`/`builddoc`) a fázisukat csak **statikus címkeként** hordozzák (`"… / P2"`), de **nem linkelnek vissza** a fázis-munkafelületre. Az egyetlen `/phase/`-link ezekről poka-yoke fallback (goldenset üres-eset → `/phase/P1`; documents → `/phase/P0`), nem kontextus-breadcrumb. A fázis-oldalnak van visszalépője a Cockpitra (`← projektnév`), de a tool-oldalaknak nincs a fázishoz.

**R3 — Lapos, fázis-vak subnav.** A `ProjectContextNav` a 9 belépőt egyetlen lapos listában adja, fázis-csoportosítás/badge nélkül; a fázis-scope (P2/P3) csak a megnyitott oldal címkéjén derül ki. Ez skálázási teher (P4–P6 újabb toolokat hoz — l. §6).

**R4 — Háromszoros deliverable-felület.** A fázis-deliverable-ek egyszerre jelennek meg a ③ Kimenet zónában, a `PhaseDocumentTiles`-ben (ugyanazon az oldalon) és a `/documents` tárban. Legalább az első kettő egy oldalon redundáns (§3.2).

**R5 — Kettős input-felület, híd nélkül.** Az `input_items` a ① Bemenet zónában és a `/sources`-ban is megjelenik, kereszt-link nélkül; a felhasználó nem tudja, hogy ugyanaz.

---

## 6. Indokolt IA-átrendezési javaslat (a design-agentnek)

> A javaslat **enumerál és ajánl**; a vizuális/IA-döntés a design-agenté és Mátéé. A meglévő elvekhez igazodik.

### 6.1 Vezérelvek (a rendszer meglévő elveiből)
1. **A négyzónás anatómia (Bemenet → Munkaeszköz → Kimenet → Kapu) kanonikus és marad.** A kérdés nem az eldobása, hanem hogy a subnav hogyan viszonyul hozzá.
2. **Egy tool = egy kanonikus otthon.** Ahol több helyről elérhető, az **belépő/link, nem másolat**. (Feloldja R4/R5-öt.)
3. **A fázisoldalnak a fázis-releváns toolokat legalább csempeként el kell érnie.** (Feloldja R1-et.) A ② Munkaeszközök zóna a természetes hely: ez az, aminek a neve „toolok".
4. **A cockpit a projekt legfontosabb dolgait + a fázis-sávot mutatja** — marad, nem tool-lista.
5. **Skálázódjon P4–P6-ra** (rollout-tábla, metrika-műszerfal, incidens-napló): az új tool ne egy újabb lapos-lista-elem legyen, hanem a saját fázisa ② zónájába / fázis-csoportjába csússzon be.

### 6.2 Fogalmi tisztázás (mindkét opció alapja)
- **Bemenet = a Források fázis-lencséje**, **Kimenet = a Dokumentumok fázis-lencséje.** A két zóna maradjon szűrt nézet, de kapjon explicit „**összes megtekintése →**" linket a kanonikus `/sources` ill. `/documents` otthonra (R5, R4/§3.2). A `PhaseDocumentTiles` olvadjon be a ③ Kimenetbe (egy felület a fázis-oldalon).
- **A ② Munkaeszközök zóna a tool-belépők otthona.** A fázis-releváns tool-modulok itt jelenjenek meg **launcher-csempeként**, amelyek a kanonikus route-ra linkelnek — nem másolják a tartalmat.

### 6.3 Struktúra — két opció a trade-offokkal

**Opció A — „Fázis-első" (a fázis-munkafelület a hub).**
A ② Munkaeszközök zóna fázisonként a releváns tool-launchereket hordozza (P1: entitások+heatmap [meglévő]; P2: Folyamattérkép·Követelmények·Megoldás-terv; P3: Megoldás-dok.·Golden set; P4–P6: az új toolok). A subnav **lecsupaszodik a projekt-globális elemekre** (Cockpit, Források, Dokumentumok) + egy **fázis-váltó**; a fázis-specifikus toolok **kikerülnek** a lapos subnavból, és csak a saját fázisuk ② zónájában élnek (a subnav helyett a fázisoldal a belépő).
- **Pro:** feloldja a §3.3 kollíziót (a toolok a saját nevű zónájukba kerülnek); a fázis-kontextus soha nem vész el; tisztán skálázódik P4–P6-ra (új tool = új csempe a fázisában); a subnav rövid marad.
- **Kontra:** a toolok „mélyebbre" kerülnek (2 kattintás: fázis → csempe); a power-user elveszti az állandóan látható lapos launchert; a kereszt-fázis ugrás (pl. P3 közben a P2 Követelmények újranézése) a fázis-váltón át megy, nem egy kattintással.

**Opció B — „Kettős otthon + fázis-csoportosítás" (a subnav marad, de rendezve).**
A subnav tool-elemei a **fázisuk szerint csoportosulnak** (kollabálható fázis-szekciók, a `/documents` fázis-szekciózását tükrözve), mindegyik a fázisát jelző badge-dzsel; ÉS a fázis-oldal ② zónája is kap tool-launcher csempéket **ugyanarra a kanonikus route-ra**. A tool-oldalak fázis-kontextus breadcrumbot kapnak („P2 · Követelmények → vissza a P2 munkafelületre"), feloldva R2-t.
- **Pro:** megtartja a gyors, mindig látható elérést; a fázis-csoportosítás kommunikálja a scope-ot (R3); minimális bolygatás; mindkét belépő egyetlen kanonikus otthonra mutató link (elv 2).
- **Kontra:** továbbra is két belépő karbantartása (subnav + csempe); a §3.3 fogalmi átfedés megmarad (enyhítve azzal, hogy MINDKÉT felület csak launcher ugyanabba az otthonba); a subnav hosszabbodik P4–P6-tal (enyhítve a kollabálható fázis-csoportokkal).

### 6.4 Ajánlás
**Kiindulásnak Opció B** — kevésbé bolygató, érintetlenül hagyja a kanonikus négyzónás anatómiát, és minden tool-felületet egyetlen otthonra mutató linkké fokoz le (elv 1+2), miközben azonnal orvosolja a három legélesebb rést (R1 a ② zóna csempéivel, R2 a breadcrumbbal, R3 a fázis-csoportosítással). **Opció A a tisztább hosszútáv**, ha a szándék, hogy a fázis-munkafelület legyen A hub és a subnav csak globális kereté váljon — ez radikálisabb, de a §3.3 kollíziót gyökeresen megszünteti. A kettő nem kizáró: B-vel indulva A felé lehet fejlődni (a fázis-csempék bevezetése után a lapos tool-elemek fokozatosan kivehetők).

**Bármelyik opció, a fogalmi tisztázás (§6.2) közös:** egy store — két lencse (Bemenet=Források, Kimenet=Dokumentumok), „összes megtekintése" linkkel; a `PhaseDocumentTiles` beolvasztása; és a ② Munkaeszközök zóna mint a fázis-releváns tool-launcherek otthona.

---

## 7. Következő lépés
Ez a discovery-lépés. A tényleges átrendezés **spec → design → coding** úton megy: a design-agent a fenti elvekből + a választott opcióból (A/B, Máté döntése) IA/vizuál-specet készít, majd abból zárt Approved specből indul a coding. **Ebben a csomagban semmi kód nem változott.**

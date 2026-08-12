# Záró jelentés — az `artifact` (egész-dokumentum) cédula kivezetése

**Dátum:** 2026-08-13 · **Branch:** `dev` · **Döntés:** Máté, 2026-08-13 (H-6)
**Előzmény:** docs/state/2026-08-13-knowledge-layers.md (réteg-szűrő, `bbc3844`)
**Leltár:** docs/state/2026-08-13-knowledge-layers-inventory.md §2/#10 + §4/H-6

## A döntés és a végrehajtás

Az `artifact` block-type a jóváhagyott dokumentumot EGY cédulaként tette a
katalógusba, a body első 240 karakterével — ami a gyakorlatban
markdown-fejléc („# Projekt-charter — AI-felmérés: panaszkezelés ⏎⏎ ## Cél
⏎ A pan"), nem atomi állítás; a benne lévő valódi tartalom pedig már
mező-cédulaként bent van, tehát duplikál is.

**Élesben 31 elem — a 273 katalógus-elem 11%-a.**

Végrehajtva **ugyanazzal a mechanizmussal**, mint az öt korábbi
entitás-block-type: egyetlen bejegyzés a központi `NON_CLIENT_BLOCK_TYPES`
táblában (`src/lib/artifacts/config.ts`). Nem kellett új kód: a két 4.2
fogyasztó (katalógus-oldal, `labelCatalogBatchAction`) már a
block-type-ágon szűr.

A leltár H-6 szakasza és §2/#10 sora **átvezetve** (HATÁRESET → ELDÖNTVE),
hogy a dokumentum ne mondjon ellent a döntésnek.

## Hivatkozás-ellenőrzés — nem szakadt el semmi

A csomag kötése szerint STOP + jelentés járt volna, ha a kivezetés meglévő
hivatkozást szakít el. **Nem szakít el.** Négy irányból ellenőrizve:

| Vizsgálat | Eredmény |
|---|---|
| **Renderelés-élek célja** | A `RenderTargetType` unió: `use_case · solution_component · component_option · build_component · prompt_item · control_point · eval_case · process_map` — **`artifact` nincs benne**, tehát render-él strukturálisan sem mutathat artifact-cédulára |
| **Renderelés-élek forrása** | Az `artifact_render_links.artifact_id` az **`artifacts` TÁBLÁRA** mutat (nem a cédulára), és a `knowledge_catalog` nézetet nem is olvassa — érintetlen |
| **Javítás-napló** | `knowledge_label_corrections` artifact-cédulán: **0** (lokálisan) — nincs emberi javítás, ami árvává válna |
| **Programozott horgony-építés** | Az `entityAnchor()` helpernek **nincs hívója** a kódbázisban — semmi nem konstruál artifact-horgonyt futásidőben |

A `knowledge_catalog` nézetnek pontosan **három fogyasztója** van, mind a
4.2 rétegben (katalógus-oldal, címkéző köteg, újracímkézés-feloldás) — mind
a szűrt listából dolgozik.

> **Máté ellenőrizze élesen** (a lokális 0 nem garantálja az éleset):
> ```sql
> select count(*) from knowledge_label_corrections where block_type = 'artifact';
> ```
> Ha ez > 0, azok a kézi javítások árvává válnak (nem törlődnek, csak a
> felületről nem érhetők el) — ez nem hiba, de érdemes tudni róla.

## Verifikáció — MI MOCK ÉS MI VALÓS

**MINDEN futás MOCK** (MOCK_LLM=1 + MOCK_EMBEDDINGS=1, lokális PG16 +
PostgREST-shim). A változás **egyetlen konfigurációs bejegyzés**, LLM-hívást
nem érint, ezért valós-LLM verifikációt nem igényel. A lokális fixtúra a
réteg-csomag óta 12 block-type-ot és 6 artefaktum-típust fed, köztük **7
artifact-cédulát** (1 valódi generált body + 6 vegyes dokumentum).

### A) Headless szűrő-teszt (`verify-artifact`): 16/16 ✓

- mind a 7 artifact-cédula kiesett a 4.2 katalógusból; egy sem maradt
- a 2.1 nézetben **megvannak**: 66 = 37 marad + 29 kiesik
- az `artifact_field` cédulák **érintetlenek** — a két hasonló nevű
  block-type nem keveredett össze (külön ellenőrizve)
- ügyfél-tudás bent: `baseline`, `as_is_attekintes`, `adat_es_ai_erettse`,
  `to_be_lepesek`, fájdalompontok, use case-ek, stakeholderek
- a maradék határesetek (`user_story`, `solution_component`) bent
- a címkék nem törlődtek: 7 artifact-címke-sor a DB-ben

### B) UI-walkthrough (`walk-artifact`, Playwright): 13/13 ✓

- a felület **37 elemet** mutat (44-ből), a 2.1 nézet közben 66 sor
- a katalógusban NINCS: „# Projekt-charter", „Kickoff-agenda törzs",
  „pilot törzs", „tobe törzs"
- a **felülvizsgálati sorban sincs** artifact-cédula
- ügyfél-tudás a felületen: pilot baseline, AS-IS áttekintés, TO-BE
  lépések, fájdalompontok
- a címkéző köteg **nem ír új címkét** artifact-cédulára (7 → 7), a
  korábbiak megmaradtak

### Számszerű hatás (LOKÁLIS fixtúra)

| | Elem |
|---|---|
| 2.1 nézet (érintetlen) | 66 |
| 4.2 katalógus a csomag ELŐTT | 44 |
| 4.2 katalógus a csomag UTÁN | **37** |
| Kivezetve most (`artifact`) | **7** (a 44 közel 16%-a) |
| Kiesik összesen (a réteg-szűrővel együtt) | 29 |

**Élesre:** a leltár §5 lekérdezéseit Máté futtatja. A várt hatás
**273 → 242** katalógus-elem (−31, −11%).

## Meglévő adat

Adat **nem törlődött**. Az artifact-cédulák `knowledge_label_signals`,
`_metadata` és `_embeddings` sorai a DB-ben maradnak, csak a felületről
nem érhetők el (árva sorok — a réteg-jelentés (A)/(B)/(C) opciói rájuk is
állnak, a döntés továbbra is Mátéé).

⚠️ Változatlanul él a réteg-jelentésben jelzett **követő igény**: a
kiszűrt elemek beágyazásai a keresési indexben maradnak, ezért a 4.3
felismerő-rétegnek ugyanezt a szűrőt kell alkalmaznia
(`isKnowledgeExemptBlockType` + `isKnowledgeExemptField`) — most már a 31
artifact-cédulára is.

## Tudatosan nyitva maradt

**A P4–P6 dokumentumok 35 besorolatlan mező-cédulája** (Pilot-riport,
Impact-riport, Tesztriport, Rollout-terv, Képzési terv,
Javaslat-dokumentum, Megoldás-dokumentáció, Döntési brief, Havi
státuszriport) — Máté döntése szerint ezek a fázisok még nincsenek
kifejlesztve, a jelenlegi cédulák teszt-adatok; a réteg-besorolás az adott
P-fázis fejlesztési csomagjának lesz a része. **Ebben a csomagban NEM
soroltam be őket.**

*(Megjegyzés: a leltár §3 e mezők egy részére ad besorolást — az ott
szereplő P4–P6 sorok a leltár teljességét szolgálják, de a szűrő
kiterjesztése az adott fázis csomagjában dől el.)*

Változatlanul nyitva: a **H-1…H-5 határeset-csoportok** (16 mező +
5 entitás-block-type).

## Kész-ha státusz

- Az `artifact` block-type kivezetve: ✓ (`NON_CLIENT_BLOCK_TYPES`)
- Az artifact-cédulák eltűntek a katalógusból és a felülvizsgálati sorból: ✓ (A2, A3, A5)
- A 2.1 nézetben megvannak, a szám változatlan: ✓ (66 sor)
- Valódi ügyfél-tudás nem esett ki: ✓ (A4, headless 6–8)
- Nincs elszakadt hivatkozás: ✓ (négy irányból ellenőrizve)
- Adat nem törlődött: ✓ (7 címke-sor megmaradt)
- Számszerű hatás megadva: ✓ (lokális 44 → 37; élesre 273 → 242 várható)

## Takarítás

`.env.local` törölve; PG + shim + dev-szerver leállítva; a verifikációs
fájlok (`verify-artifact`, `walk-artifact`) a session-scratchpadban
maradtak, a repóba nem kerültek.

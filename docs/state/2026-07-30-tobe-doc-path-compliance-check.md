# Backend compliance check — TO-BE „dokumentumból" út felzárkóztatása

**Dátum:** 2026-07-30
**Branch:** `dev`
**Scope:** a két TO-BE-generálási út (entitás-alapú vs. dokumentum-alapú) fájl/sor-szintű
összevetése, mielőtt bármi módosul.

---

## a) Entitás-alapú út — „TO-BE javaslat (fájdalompontok + AS-IS) ✦" (REFERENCIA)

- **UI:** `src/components/ProcessGenPanels.tsx:84-97` `SuggestToBePanel` → `suggestToBeCta`
- **Action:** `src/app/process-actions.ts:120-188` `suggestToBeAction`
- **LLM-hívás:** `src/lib/llm/index.ts:849-907` `suggestToBeProcess`
  - **Prompt-séma:** `PROCESS_SHAPE` (`index.ts:754-772`) — **UGYANAZ a konstans**, mint a
    dokumentum-úton.
  - **Bemenet mérete:** KICSI, előpárolt — csak `asIsSteps.map(s => "${i}. [${type}] ${title} — ${desc}")`
    (`:883-885`) + fájdalompont-címek (`:877-882`). NEM a nyers leiratot küldi.
  - **`quote` szemantika:** itt EREDET-MEGJELÖLÉS (rövid, modell-generált mondat: „melyik
    fájdalompontból/AS-IS lépésből vezetted le" — `:864-865`), NEM szó szerinti forrás-idézet.
  - **`max_tokens`:** **6000** (`:902`) — UGYANAZ, mint a dokumentum-úton.
  - **Parse:** `parseProcessProposal(text, "AI", "eredet: AI-terv")` (`:906`) — **UGYANAZ a
    függvény**, mint a dokumentum-úton.
- **Perzisztálás:** `process-actions.ts:159-181` — `layoutGraph` + `.from("process_maps").insert({...nodes: graph.nodes, edges: graph.edges...})`. **Nincs típus-szűrés.**

## b) Dokumentum-alapú út — „TO-BE generálása a dokumentumból ✦" (BUKÓ)

- **UI:** `src/components/ProcessGenPanels.tsx:39-77` `GenerateFromInputPanel` (`kind="to_be"`) → `generateTobeDocCta`
- **Action:** `src/app/process-actions.ts:57-113` `generateProcessMapAction(…, kind="to_be", …)`
- **LLM-hívás:** `src/lib/llm/index.ts:781-828` `extractProcessMap`
  - **Prompt-séma:** `PROCESS_SHAPE` (`index.ts:754-772`) — **UGYANAZ a konstans**, mint az
    entitás-úton.
  - **Bemenet mérete:** NAGY, korlátlan — a `source.text` (a nyers input_item TELJES szövege,
    csonkítás nélkül — `loadNumberedSources`/`numberSourceRows` nem vág, `src/lib/sources.ts`)
    kerül a promptba (`:812-813`).
  - **`quote` szemantika:** SZÓ SZERINTI forrás-idézet kötelező (`:793`: „quote mező SZÓ SZERINTI
    idézet a forrásból"), minden kinyert lépésnél.
  - **`max_tokens`:** **6000** (`:823`) — UGYANAZ, mint az entitás-úton.
  - **Parse:** `parseProcessProposal(text, refLabel, source.title)` (`:827`) — **UGYANAZ a
    függvény**, mint az entitás-úton (`processmap/parse.ts:60-132`).
- **Perzisztálás:** `process-actions.ts:84-107` — `layoutGraph` + `.from("process_maps").insert({...})`. **Ugyanaz a kód**, mint az entitás-úton (`:161-176`), **nincs típus-szűrés** itt sem.

## c) A KÜLÖNBSÉG pontos megnevezése

**A séma, a parszolás és a perzisztálás 100%-ban KÖZÖS kód** — ellenőrizve:
- `PROCESS_SHAPE` egyetlen konstans, mindkét prompt ugyanoda hivatkozik (`:816` és `:895`).
- `parseProcessProposal` egyetlen függvény, mindkét hívás ugyanoda hivatkozik (`:827` és `:906`).
- A perzisztálás mindkét actionben azonos mintájú `layoutGraph` + `.insert()`, típus-szűrés
  **sehol** a láncban (`grep type === "step"` → 0 találat az egész repóban).
- A típusmodell (`src/lib/processmap/model.ts:28-44`) `type: string` — szabadon bővíthető,
  a layout-algoritmus (`model.ts:150-160`) explicit DFS-alapú **vissza-él (ciklus) detekciót**
  végez — a ciklus-kezelés bizonyítottan működik, függetlenül attól, melyik prompt hívta.

**Az előző (jelen ülésben korábban adott) diagnózis téves volt abban, hogy „csak `type: "step"`
node-ok számítanak beszúráskor" — ilyen szűrés SEHOL nem létezik a kódban.** Ez tévesztés volt;
a tényleges vizsgálat (fenti grep) ezt cáfolja.

**A valódi eltérés KIZÁRÓLAG a PROMPT bemenet/kimenet-terhelésében van:**

| | Entitás-út | Dokumentum-út |
|---|---|---|
| Bemenet mérete | kicsi, előpárolt lépés-lista | teljes nyers leirat, korlátlan |
| `quote` mező | rövid, szabad eredet-jelölés | KÖTELEZŐ szó szerinti idézet a forrásból |
| Kimenet mérete egy gazdag gráfra | mérsékelt (rövid quote-ok) | NAGY (hosszú, szó szerinti idézetek node-onként) |
| `max_tokens` | 6000 | 6000 (AZONOS — de a kimenet szisztematikusan nagyobb) |

A „[7] teszt to be" jellegű forrás (16 lépés, 5 gateway, párhuzamos ág, HITL, ciklus) a
dokumentum-úton **node-onként szó szerinti idézetet** kényszerít ki — ez az, ami a 6000
token-keretet valószínűsíthetően túllépi (csonkolt/érvénytelen JSON → `parseProcessProposal`
`:67-70` némán `{nodes:[],edges:[]}`-t ad vissza → `noticeNoSteps`). Az entitás-út SOSEM
termel ekkora kimenetet, mert nincs szó szerinti idézési kényszere és az input eleve tömör.

**Következtetés — a feladat előírása szerint:** mivel a séma és a perzisztálás bizonyítottan
elég gazdag (az entitás-út UGYANAZON a kódon át gateway/párhuzam/HITL/típusos node-okat termel),
**a javítás KIZÁRÓLAG a dokumentum-út promptját (és védekező parse-t/hibaközlést) érinti** — a
`extractProcessMap` függvényt, NEM a `PROCESS_SHAPE`-et (közös), NEM a `parseProcessProposal`-t
tartalmilag (csak robusztusság-bővítés, ha egyáltalán), NEM a sémát, NEM a perzisztálást, NEM az
entitás-utat.

## Séma-migráció szükséges? **NEM.**

A `graph_json` (nodes/edges jsonb) séma és a `process_maps` tábla változatlan marad. Nincs
migráció ebben a csomagban.

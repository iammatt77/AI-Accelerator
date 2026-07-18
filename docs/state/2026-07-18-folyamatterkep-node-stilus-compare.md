# Záró jelentés — Folyamattérkép: node-típus stílus-konzisztencia a Compare nézetben

**Dátum:** 2026-07-18 · **Branch:** dev · **Jelleg:** vizuális konzisztencia-javítás
egy meglévő, működő modulon — nincs adatmodell-, layout-, chat- vagy verzió-változás.

A node-típusok alak+szín jelölése eltért a Compare (AS-IS ⇄ TO-BE) nézetben a fő
canvashoz képest. A cél: egy kanonikus szabály MINDEN felületen.

---

## 0) Diagnózis (a javítás előtt) — hol volt a duplikáció

- **Kanonikus forrás VAN:** `styleOf(type)` → `NODE_TYPE_STYLES`
  (`src/lib/processmap/model.ts`) adja a hat típushoz a színt (`bg`/`line`/`fg`)
  és az alakot (`pill` / `diamond` / `card`). A layout (`sizeOf`) is ebből
  számol. Ez helyes és egy forrás.
- **A fő canvas** (`ProcessMapViewer.tsx` `Canvas` node-renderelője) helyesen
  használta: rombuszt rajzolt döntésre, és **típus-címke chipet** (`AI-BEAVATKOZÁS`
  stb. `st.fg` színnel) minden node fölé.
- **A Compare-nézet** (`CompareView.mini`) egy **külön, egyszerűsített
  node-renderelő** volt. `styleOf().bg/line`-t olvasott (a szín részben stimmelt),
  DE két ponton eltért a kanonikus nyelvtantól:
  1. **Nem volt rombusz-ág:** `borderRadius: st.shape === "pill" ? 999 : 6` — a
     `diamond` a `6` (lekerekített téglalap) ágra esett → a **döntés téglalapként**
     jelent meg.
  2. **Nem rajzolt típus-címkét:** csak a `n.title`-t. Az AI-beavatkozás halvány
     lila kitöltése (#F0EBF9) mini-méretben, a lila `AI-BEAVATKOZÁS` címke nélkül
     **semleges dobozként** olvasódott. A HITL csak azért maradt helyes, mert a
     borostyán (#FBF3E0) címke nélkül is egyértelmű.

**Gyökérok kimondva:** a Compare mini-renderelő a fő canvas node-komponensének egy
**egyszerűsített, korábbi verziója** volt, amely nem kapta meg a típus-alapú
alak/típus-címke logikát — a színt igen, az ALAKOT és a TÍPUSCÍMKÉT nem.

## 1) A javítás — egy kanonikus node-vizuál, mindenhol újrahasznosítva

Bevezetve: **`ProcessNodeShape`** (`ProcessMapViewer.tsx`) — egyetlen
presentational komponens, amely a `styleOf(type)` alapján rajzol **alakot
(pill/rombusz/kártya) + kitöltést + típus-címkét + színt**. Az állapot-függő
KERET (aktuális/látogatott/új) és a dekorációk (✓ látogatott-pipa, diff-jelvény)
propból jönnek — az ALAK/SZÍN/TÍPUSCÍMKE a komponensben kanonikus.

Újrahasznosítja:
- **a fő canvas** (teljes térkép + bejárás/fókusz mód) — `<button>` wrapper
  (kattintás/pozíció) + `ProcessNodeShape`;
- **a Compare mindkét mini-térképe** (AS-IS és TO-BE) — `<div>` wrapper
  (pozíció) + ugyanaz a `ProcessNodeShape`.

A méret azonos (n.w / rombusz 190×190); a Compare-oldal a **világ-transzformmal
(scale) kicsinyít**, nem külön, nagyított node-stílussal (a korábbi mini 300px /
22px nagyítása megszűnt — az kockázta az átfedést is). Így „ugyanaz a típus,
ugyanaz a vizuális azonosító, csak kisebb méretben".

## 2) Kemény korlátok — igazolás

- **Csak vizuális konzisztencia:** a layout-algoritmus (elágazó Sugiyama), a
  chat-szerkesztő, a jóváhagyás/verziózás, a forrás-hivatkozás **érintetlen** — a
  diff kizárólag a node-renderelést érinti (`ProcessNodeShape` + a két hívóhely).
- **A típus-nyelvtan definíciója változatlan:** `NODE_TYPE_STYLES` (6 típus,
  alak/szín) nem módosult — csak MINDENHOL ugyanaz érvényesül.
- **Nincs i18n-változás:** a `nodeType.*` és diff-jelvény kulcsok már megvoltak.

## 3) Verifikáció (tsc + build + izolált komponens-render + Playwright)

A DB-shim két session közt kiürült; a valós adat helyett a **valódi
ProcessMapViewer-t** rendereltem szintetikus panaszkezelés AS-IS/TO-BE folyamattal
(döntés + 2 AI-beavatkozás + HITL) egy eldobható route-on (`dev-nodes`, NEM
commitolt), prod build + `next start` alatt (a dev HMR a proxy mögött nem
hidratált megbízhatóan), és Playwright-tel mértem a számított stílusokat mindkét
nézetben.

| Node-típus | Fő térkép | Compare (AS-IS+TO-BE mini) | Egyezik? |
|---|---|---|---|
| Döntés (decide) | rombusz (`isDiamond=true`) | rombusz mindkét mini-világban (`isDiamond=true` ×2) | ✓ |
| AI-beavatkozás | lila kitöltés `#F0EBF9`, keret `#CBB8E8` | lila `#F0EBF9` / `#CBB8E8` | ✓ |
| Kontrollpont-HITL | borostyán `#FBF3E0` | borostyán `#FBF3E0` | ✓ |
| Kezdő/záró | zöld pill (`borderRadius 999px`, `#E9F5EF`) | zöld pill (999px, `#E9F5EF`) mindkét világban | ✓ |

| Egyéb ellenőrzés | Eredmény |
|---|---|
| tsc strict / prod build | 0 hiba / zöld (5.2s) |
| Compare aktiválva (⇄ → „AS-IS → TO-BE" inspector) | ✓ |
| 0 vízszintes túlcsordulás / 0 backdrop-blur | ✓ (`hOverflow=0`, `blur=0`) |
| Konzol-hibák a renderben | ✓ nincs |

Screenshotok (scratchpad, nem repo): `nodes-fullmap.png` (teljes TO-BE térkép),
`nodes-compare.png` (Compare — mindkét mini-világban rombusz döntés, lila AI,
borostyán HITL, zöld pill).

**Regresszió:** a fő canvas és a bejárás/fókusz mód stílusa nem változott (az
állapot-függő keret/árnyék/pipa/diff-jelvény propból ugyanúgy jön); a Compare két
mini-térkép elrendezése és mérete nem tört el (a scale-alapú kicsinyítés megmaradt).

## 4) Nálad zárandó (felhasználói teendő)

Preview-n egy valós AS-IS/TO-BE folyamat Compare-nézete: a döntés rombusz-e, az
AI-beavatkozás lila-e, ugyanúgy, mint a teljes térképen (és a HITL borostyán, a
kezdő/záró zöld pill).

## 5) Harness-jegyzet (nem repo-kód)

A verifikáció eldobható `dev-nodes` route-on futott (törölve), a valós
komponenssel + szintetikus (layoutGraph-pozicionált) propokkal — DB nélkül. A
`.env.local` (dummy) törölve, a szerverek leállítva. A dev HMR a proxy mögött nem
hidratált, ezért prod build + `next start` alatt teszteltem.

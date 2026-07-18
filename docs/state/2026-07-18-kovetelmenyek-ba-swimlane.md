# Záró jelentés — BA-nézet swimlane-rendezés (lineage szerinti sorok)

**Dátum:** 2026-07-18 · **Branch:** dev · **Alap:** #11 Követelmény-modul BA-nézet
**Jelleg:** tisztán MEGJELENÍTÉS/RENDEZÉS — nincs migráció, nincs adatmodell-változás.

A BA-nézet három szabadon lebegő oszlopból (Business / Stakeholder / System)
lineage szerinti **sorokba (swimlane)** rendeződik: minden business requirement
egy sort képez a teljes leszármazott-láncával, így a hierarchia egy pillantással
látszik.

---

## 0) Backend-egyezés (a csomag előírt első lépése)

| Réteg | Állapot | Döntés |
|---|---|---|
| Fa-struktúra | VOLT — `parent_id` adjacency-list (0009), business→stakeholder→system | változatlan; a sorok ebből származtatva |
| N:M (requirement↔story) | VOLT | **érintetlen** — nem ezeken a szinteken van |
| Kártya-komponensek (BR/SR/SYS/NFR) | VOLT | **változatlan** — csak az elrendezésük más |
| Kártya-akciók (Megerősít/Elvet/Részletek/✦) | VOLT | **változatlan** |

**Nincs migráció, nincs új tábla.** A sorok tiszta deriváció a meglévő
`parent_id`-láncból (`buildLineageRows`).

## 1) A megoldás

**Tiszta deriváló függvény — `buildLineageRows(requirements)`** (model.ts):
business-requirementenként egy `LineageRow` (business + stakeholder-gyerekek +
azok system/NFR unokái), a business-ek megjelenési sorrendjében; a soron belül a
leszármazottak a saját sorrendjükben. Minden requirement **pontosan egyszer**
kerül be. Mellette `rowSystems(row)` a sor összes system-elemét adja. Se React,
se DB — egységszinten tesztelhető.

**BA-elrendezés (RequirementsBoard.tsx `BaLanes`):**
- Három oszlop marad (Business / Stakeholder / System). A System kártya-szinten
  különbözteti a funkcionálisat (kék `pivot` bal-szegély) a nem-funkcionálistól
  (`gate` bal-szegély) — **nincs soronként ismételt F/NF alcím-sáv**.
- Sorok: 1 business + a teljes lánc. Bal: BR-kártya. Közép: SR-gyerekek egymás
  alatt. Jobb: az SR-ek system/NFR unokái egymás alatt, `⤴ SR-xx` jelöléssel.
- **Sor-magasság tartalom-vezérelt (auto), a cellák a sor tetejéhez igazítva**
  (`items-start`).
- **Üres cella, nem összeomló sor:** ha egy BR-nek nincs SR-gyereke, a
  Stakeholder-cella halk placeholdert mutat („Nincs stakeholder requirement +
  hozzáadás") — a sor megmarad. Ugyanez a System-cellánál. **Nem fabrikál:**
  csak jelzi az űrt, nem talál ki tartalmat.
- **Zebra + elválasztó:** páros/páratlan sor eltérő halvány háttér + alsó vonal.
- **Egyben görgethető rács:** a teljes rács egy függőleges scroll-konténerben
  (`max-h-[72vh] overflow-y-auto`), NEM oszloponként — a sorok illeszkedése nem
  csúszik szét.
- **Sticky oszlopfejlécek:** a fejléc-sor `sticky top-0`, a sorok alatta
  görgethetők; a System-fejléc a func/nfr almennyiséget is mutatja.
- **Defenzív gyűjtő-sor:** ha egy elemnek nincs feloldható business-őse (a
  szigorú fa melletti adatintegritási hiba), egy záró „Nincs hozzárendelt üzleti
  követelmény" sor fogadja be — **nem omlik össze, nem dob hibát**.

## 2) Kemény korlátok — igazolás

- **Csak a BA elrendezése változott:** az Agile-nézet, a nézet-váltó, a közös AC,
  az N:M kötés, a generálás kódja érintetlen (a diff csak `BaLanes`-t, a
  `model.ts` új deriválóját és 5 i18n-kulcsot érint).
- **Nincs migráció / adatmodell-változás:** a `parent_id` lánc már megvolt.
- **Nem fabrikál kapcsolatot:** üres cellánál placeholder, nem kitalált elem; a
  gyűjtő-sor csak a ténylegesen ős-vesztett elemeket mutatja.
- **Kártyák változatlanok:** ugyanaz a `ReqCard` (MoSCoW, ⤴ szülő, ✦ AI-javaslat,
  Megerősít/Elvet, Részletek, 👤 chip, AC/story jelvények).

## 3) Verifikáció (tsc + build + i18n + izolált komponens-render + Playwright)

A DB-shim két session közt kiürült; a valós DB-lánc helyett a **valódi
`RequirementsBoard` komponenst** rendereltem szintetikus demo-propokkal egy
eldobható route-on (`dev-swimlane`, NEM commitolt), és Playwright-tel mértem —
ez pont a layout-változás kockázatos részét (sticky, zebra, illeszkedés,
túlcsordulás) fedi.

| Ellenőrzés | Eredmény |
|---|---|
| `buildLineageRows` egység (szintetikus fa: BR-01 2 SR + 3 SYS; BR-03 üres; BR-04 SR-04+NFR-01; orphan SR-99+SYS-88) | 8/8 lényegi assert ✓ (minden elem 1×, sorrend, orphan-gyűjtés) |
| tsc strict / prod build / i18n:check | 0 hiba / zöld (6.4s) / **1320 kulcs HU=EN** ✓ |
| Swimlane — BR-01 sor: 2 SR + 3 SYS egy sorban | ✓ (6 kártya a sorban: 1 BR + 2 SR + 3 SYS) |
| Üres cella — BR-03: „Nincs stakeholder requirement + hozzáadás", nem omlik | ✓ |
| BR-04 sor: SR-04 + NFR-01 unoka (Won't faded) | ✓ |
| Sticky fejléc (`position: sticky`), func/nfr almennyiség | ✓ |
| Zebra + sor-elválasztók, tetejéhez igazítva | ✓ |
| Defenzív gyűjtő-sor (SR-99 + laza SYS-88), nem omlik, nem hibázik | ✓ |
| 0 backdrop-blur / 0 vízszintes túlcsordulás | ✓ (mindkét képernyőn `hOverflow=0`, `blur=0`) |
| Konzol-hibák a renderben | ✓ nincs |

Screenshotok (scratchpad, nem repo): `swimlane-ba.png` (tiszta demo),
`swimlane-orphan.png` (gyűjtő-sorral).

**Regresszió:** a kártya-akciók, az Agile-nézet, a nézet-váltó, a közös AC és az
N:M kötés kódja nem változott — a swimlane csak a BR/SR/SYS kártyák
konténerét/csoportosítását cseréli.

## 4) Nálad zárandó (felhasználói teendő)

Preview-n a BA-nézet: a sorok helyesen csoportosítják a lineage-t (egy BR + a
teljes lánca egy sorban); üres cellák placeholderrel, nem omlanak össze; a rács
egyben görgethető, a fejlécek stickyk. Valós adaton (több BR, vegyes MoSCoW,
NFR-ek) érdemes ránézni a sor-magasságok illeszkedésére.

## 5) Parkoló-lista (változatlan)

- Won't-szűrő chip; AC szerkesztése/átrendezése; requirement-szöveg utólagos
  edit; opció-összevető és P2 kapu-integráció (külön csomagok).

## 6) Harness-jegyzet (nem repo-kód)

A verifikáció eldobható `dev-swimlane` route-on futott (törölve), a valós
komponenssel + szintetikus propokkal — DB nélkül, mert a lokális PostgREST-shim
a session-váltáskor kiürült. A `.env.local` (dummy) törölve, a dev-szerver
leállítva.

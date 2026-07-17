# Záró jelentés — Javító #10-layout: elágazó 2D folyamattérkép-layout (Task04 minta)

**Dátum:** 2026-07-17 · **Branch:** dev · **Ref:** Task04_Process_Flow.html

## A probléma

A #10 folyamattérkép léptethető bejárása működött, de az áttekintő térkép
minden node-ot ~egy oszlopba fűzött: a döntések ágai a panelben választhatók
voltak, de TÉRBEN nem váltak szét. A régi layouter BFS-mélység szerint sorokba
rendezett, és soronként legfeljebb 3 fix X-oszlopba tett (360/700/1040); az
ágak vízszintes helye a sor-index sorrendjéből adódott, nem az ághoz kötve —
törékeny, és 3+ node/sor esetén átfedett.

## A megoldás — automatikus réteges (Sugiyama-szerű) layout

Új `layoutGraph` a `src/lib/processmap/model.ts`-ben, ami a TÁROLT node/edge
topológiából számol elágazó 2D-elrendezést (tetszőleges generált folyamatra —
a struktúra nincs előre drótozva):

1. **Visszaél-detekció** (DFS szín-jelöléssel) — a körök megtörnek a
   rétegezéshez (retry/visszacsatolás nem akaszt).
2. **Réteg (Y):** leghosszabb út a gyökerekből az előre-éleken (Kahn + longest-path).
3. **Sáv (X):** rétegenként fentről le — a gyerekek **szimmetrikusan
   szétnyílnak** a szülő körül (1 gyerek→egyenes; 2→∓0,5; 3→−1,0,+1), a
   **merge-node** a szülők sáv-átlaga (középre húz), majd rétegenkénti
   **ütközés-feloldás** (min. 1 sáv rés, sor-középre igazítással).
4. **Derékszögű él-útvonalak** oldal-horgonyokkal + köztes pontokkal:
   - döntés ága → oldalról ki, vízszintesen a cél oszlopig, majd le (ág-címkével);
   - összefutás → alul ki, félmagasságban átlép a cél oszlopba (könyök);
   - visszaél → felül ki, a cél teteje fölé, be a cél tetejére (kerülő).

A Task04 gazdag él-modelljét (`fromSide`/`toSide`/`via`/`branch`) a MEGLÉVŐ
edge-jsonb (`fs`/`ts`/`via`/`label`) hordozza — **sémabővítés / migráció nem
kellett**. A Task04 kézzel megadott koordinátáit itt algoritmus számolja.

**Dinamikus world-szélesség:** a rögzített `WORLD_W=1400` helyett a viewer a
`worldWidth(nodes)`-ból számolja a fit-et és a vászon-szélességet (a többoszlopos
térképek szélesebbek); a compare mini-térképek is per-térkép szélességet kapnak.

**Meglévő térképek újrarajzolása:** a layout betöltéskor újraszámolódik
(`toMapData` → `layoutGraph` a gráfra ÉS az `original_snapshot`-ra) — a
korábban generált AS-IS/TO-BE térképek az új elágazó elrendezéssel jelennek meg
**újragenerálás nélkül**. A pozíció tiszta nézet-ügy lett; determinisztikus.

## Miért saját algoritmus, nem lib

A csomag megengedte a lib-et a pozíció-számításhoz, de a saját, tömör
implementáció mellett döntöttem: (a) nincs új függőség és bundle-teher;
(b) a tömör-lapos SVG-renderelés a mienk marad (nem veszünk át renderelő
diagram-könyvtárat — a kikötés szerint tilos a teljes mermaid/reactflow);
(c) a tipikus AICON-folyamat (fő gerinc + néhány 2-utas elágazás merge-dzsel)
erre a heurisztikára jól illik, és determinisztikus. ~150 sor, tesztelt.

## Kemény korlátok — betartva

- Csak a **layout + él-rajzolás + áttekintő nézet** változott. A generálás
  tartalma, a chat-szerkesztő, a jóváhagyás/verziózás, a forrás-hivatkozás, a
  diff, a HITL VÁLTOZATLAN.
- Nem fabrikál ágakat: a layout a tárolt élekből rajzol, újat nem talál ki.
- Tömör-lapos, üvegmentes; a node-típus-színek és a paletta változatlan;
  0 backdrop-blur.
- Nincs regresszió a bejáráson / chaten / jóváhagyáson (lásd lent).

## Verifikáció (lokális PG16 + shim + prod build + MOCK_LLM + Playwright)

| Ellenőrzés | Eredmény |
|---|---|
| Layout egységteszt (elágazás/merge/egyenlőtlen ág/kör/3-utas/lineáris/worldWidth) | **22/22 ✓** |
| tsc strict / prod build / i18n:check | 0 hiba / zöld / 1169 kulcs HU=EN ✓ |
| Meglévő AS-IS v1 (RÉGI koordinátákkal tárolt) újrarajzol | döntés balra (Igen·sürgős→Azonnali kézi válasz) / jobbra (Nem·normál→Válasz sablon nélkül), **merge** a Havi riportnál — újragenerálás nélkül ✓ |
| Ág-címkék a vízszintes szakaszokon | ✓ |
| Node-ok/vonalak nem fednek (min. 1 sáv rés) | ✓ (unit + vizuális) |
| Bejárás fókusz-módban az új pozíciókra | ✓ (kamera a bal ágra fókuszál, lila bejárt út, breadcrumb, 5/7) |
| TO-BE (chat-diffes) — elágazik + diff-sáv (+1 ÚJ·CHAT, 1 MÓDOSÍTVA) ép | ✓ (chat-beszúrt HITL node a gerincen, jóváhagyás/iteráció gombok) |
| ⇄ compare — mindkét mini-térkép elágazik, per-térkép szélesség | ✓ |
| Kör/visszaél nem akaszt (unit) | ✓ (top→top kerülő via) |
| overflow-x / backdrop-blur minden jeleneten | 0 / 0 ✓ |

Képernyőképek (harness): AS-IS áttekintő (elágazó), AS-IS bejárás (fókusz),
TO-BE áttekintő (elágazó + diff), compare (két elágazó mini-térkép).

## Fájlok

- `src/lib/processmap/model.ts` — új `layoutGraph` (réteges elágazó), új
  `worldWidth`; `WORLD_W` megtartva fit-fallback konstansként.
- `src/components/ProcessMapViewer.tsx` — dinamikus `worldW` (fit + vászon +
  compare), a `World` komponens `worldW` propot kap.
- `src/app/project/[id]/process/[mapId]/page.tsx` — `toMapData` betöltéskor
  újralayoutol (gráf + snapshot).

## Nálad zárandó

Nincs migráció. Preview-n: P1 → Folyamattérkép → a panaszkezelés AS-IS
áttekintő nézete — a döntésnél a két ág térben szétválik, és a Havi riportnál
összefut. A korábbi térképek automatikusan az új layouttal jelennek meg.

## Parkoló-lista

- Él-keresztezés-minimalizálás (Sugiyama median/Brandes–Köpf) — a jelenlegi
  barycenter+ütközés-feloldás a tipikus folyamatokra elég; nagyon sűrű,
  sok-merge-es gráfoknál lehet finomítani.
- Nagyon széles (sok párhuzamos ág) térkép vízszintes tömörítése.

# Backend compliance check — Katalógus v2 (17 · második kör)

**Dátum:** 2026-08-12 · **Branch:** `dev` · **Design:** AICON_17_Tudáselemkatalógus_v2.dc
**Scope-emlékeztető:** CSAK felület; címkézés-logika, 4.2b besorolás, adat-réteg,
kötegelt futtatás érintetlen.

## (1) A jelenlegi felülvizsgálat-komponens — mi hasznosítható újra?

A `CatalogReview.tsx` (470 sor) szerkezete kétosztatú (bal sor-lista + fókusz-
kártya), de a MOTORJA hasznosítható változtatás nélkül:

- **Pillanatfelvétel-sor:** a kétes (elem × dimenzió) párok belépéskor épülnek
  (`queue: Judgment[]`), a mentések nem rendezik át — ez marad, csak a
  RENDEZÉSE változik (dimenzió szerint kötegelt, l. (2)).
- **Billentyűzet-vezérlés** (1–9 választ, ⏎ megerősít, S kihagy, ⌫ vissza,
  Esc kilép) — változatlanul átemelhető.
- **Mentés:** `resolveDimensionAction` (egy dimenzió, approveDoubtful:false,
  napló a motorban) — változatlan.
- **`optionsFor` / `labelOf`** (dimenziónkénti opciók + megjelenítés),
  szavazat-sávok, `LabelEditForm` beágyazás („Módosítás") — változatlan.
- **Ami újraépül:** a KERET — háromhasábos elrendezés (köteg-sáv · görgethető
  állítás-hasáb · fix döntés-hasáb), köteg-navigáció, ablak (előző 2 /
  következő 4), 7 soros kibontás, köteg-kész összegzőkártya.

A `CatalogBrowser.tsx` sorai kártyákká alakulnak — a szűrő/csoportosítás/
kereső/eredet-feloldás (browse.ts) érintetlen.

## (2) Kötegelés a kétes dimenzió szerint — tudja-e a mai lekérdezés?

**IGEN, lekérdezés-változtatás nélkül.** A felülvizsgálat sora ma is
kliens-oldalon épül a betöltött `items[]`-ből (`signal.doubtful_dimensions`),
elem × dimenzió párokként. A kötegelés = ugyanennek a sornak a PARTÍCIÓJA
dimenzió szerint, a kanonikus DIM_ORDER sorrendben; a köteg-számlálók
(`12/41`) a pillanatfelvétel + a kliens-oldali `decisions` map-ből
származtathatók (kész = döntött párok a kötegben). Nincs új szerver-út,
nincs séma-igény. Az összesített haladás (`18/70 kész`) ugyanebből jön.

## (3) Forrás-szintű tömeges alkalmazás — megvalósítható-e?

**IGEN, a meglévő adat-réteggel, új migráció nélkül.**

- **Adat:** a `knowledge_catalog` sor hordozza a `source_input_ids`-t; az
  eredet-feloldás (browse.ts) ma is a `[0]` elemből dolgozik, csak az ID-t
  nem tartja meg a kliens-item. Bővítés: `CatalogAdminItem.sourceInputId`
  (a nézet-sorból, semmi új lekérdezés).
- **Ajánlat-feltétel:** ugyanabban a KÖTEGBEN (= ugyanaz a kétes dimenzió),
  még nem döntött, és ugyanaz a `sourceInputId` (nem null). A darabszám a
  kliens-sorból számolható → „A választás ugyanerre a forrásra alkalmazható
  a köteg többi N elemére is."
- **Alkalmazás:** ÚJ server action (`resolveDimensionBulkAction`): a
  meglévő `applyLabelCorrection`-t hívja elemenként, ciklusban — pontosan
  úgy, ahogy a meglévő `approveDoubtfulAction` batch-el. A javítás-napló
  szemantikája VÁLTOZATLAN: minden elem SAJÁT correction-sort kap (a
  motor írja), az „ember" eredet elemenként áll be, a kétes-újraszámítás
  elemenként fut.
- **Nem automatikus:** a felület csak FELAJÁNLJA (checkbox/gomb a döntés-
  hasábban); a megerősítés alkalmazza a kiválasztott elemre + bejelöltnél
  a többire.

## (4) A „miért kétes" indoklás — elég részletes-e a mai adat?

**Generálható a meglévő adatból; a classify-választ NEM kell bővíteni** —
de a design narratívája GAZDAGABB, mint az adat, ezért tudatos szűkítéssel:

Ma a `DimensionSignal` hordozza: `reason` (a classify egy-mondatos indoka,
4.2b óta a forrás-típus-hiányt is kimondja), `votes` + `samples`
(eszkalációnál a szavazatmegoszlás), `confidence`, `evidence` (szó szerinti
idézet-részlet), `derived_from` (metaadat-eredet). Az elem eredete
(forrás-cím, személy, forrás-típus) a kliens-itemen van.

A több mondatos magyarázat ezekből KOMPONÁLHATÓ a felületen:
1. a gépi `reason` mondat;
2. szavazat-mondat a `votes/samples`-ből („öt mintából három előírásnak
   sorolta, kettő tervnek");
3. forrás-kontextus mondat a meglévő eredet-adatból („a forrás:
   Szolgáltatási szerződés-tervezet — hivatalos dokumentáció").

**Amit a design mutat, de az adatban NINCS** (nem találunk ki adatot):
a fájlnév-elemzés („v4_targyalasi"), az „aláírás nélkül" következtetés —
ilyen csak akkor kerülhet a szövegbe, ha a classify adta a reason-ben.
A komponált indoklás KIZÁRÓLAG valós mezőkből épül.

## Tudatos design-eltérések (adathiány / scope miatt)

- **KE-0142-stílusú azonosítók:** a tudáselemeknek nincs display-id-ja
  (v1-ben is jelentve) — a kártya bal sávja modalitást + állapotot mutat,
  KE-ID nélkül.
- **„Elem elvetése" gomb:** a cédulának nincs elvetés-állapota az
  adat-modellben (a katalógus derive-only nézet) — kimarad (v1-döntés áll).
- **„Felbontás" (állítás kettébontása):** kinyerés-műveletet igényelne —
  nem UI-csomag, kimarad (a 2c szélsőség-képernyő opcionális gombja).
- **„Megnyitás a forrásban":** marad a meglévő Források-oldal link
  (openSourceCta) — mély-link a konkrét bekezdésre nincs az adatban.
- A demó-számok (88 elem, 70 kétes, GreenTherm) a designban illusztrációk —
  a felület a valós számokat mutatja.

## Konklúzió: NINCS STOP

Mind a négy premissza teljesíthető a meglévő adat-réteggel; migráció nem
kell; a címkézés-logika és a 4.2b besorolás érintetlen marad. A tömeges
alkalmazás elemenkénti naplózása a meglévő motor-úton adott.

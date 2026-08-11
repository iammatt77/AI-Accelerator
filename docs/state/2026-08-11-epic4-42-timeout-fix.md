# Záró jelentés — Javító csomag: 4.2 címkézés kötegelt futtatása (timeout-fix)

**Dátum:** 2026-08-11 · **Branch:** `dev`

## Diagnózis

Az éles tünet: „Váratlan hiba történt" a Címkézés futtatásakor, de közben néhány elem
felcímkéződött. Ez **kizárásos alapon** serverless funkció-időkorlátra utal, nem
auth/config-hibára — egy hibás kulcs vagy 401/404 az **első** elemnél bukna el, nem
„néhány elem után". A régi `labelCatalogAction` egyetlen szinkron server actionben
dolgozta fel az ÖSSZES jóváhagyott tudáselemet; elemenként 1–5 LLM-hívás (az
önkonzisztencia-eszkaláció miatt) + 1 embedding-hívás — sok tucat elemnél ez könnyen
túllépi a Vercel funkció-időkorlátot (a pontos érték a csomagtól/beállítástól függ).

**Megjegyzés a diagnózis módjáról:** ebben a sandboxban nincs Vercel csapat/projekt a
munkamenethez kötve (`list_teams` üres eredményt adott), ezért a nyers Vercel
runtime-log nem volt elérhető közvetlenül. A diagnózis kód-elemzésen és a tünet-
mintázat kizárásos azonosításán alapul, nem log-megerősítésen.

## Javítás

**A logika (konfidencia, küszöb, önkonzisztencia) változatlan — csak a futtatás módja.**

- `labelCatalogAction` → **`labelCatalogBatchAction`**: egy hívás csak egy
  KONZERVATÍV köteget dolgoz fel (`KNOWLEDGE_LABEL_BATCH_SIZE` env, alapérték 5,
  max 20). Minden hívás elölről lekérdezi a még címkézetlen listát — ez a meglévő
  NF2-inkrementalitás, ami timeout vagy hálózati megszakadás után **automatikus
  folytatást** ad: a következő hívás onnan folytat, ahol a legutóbbi SIKERESEN
  mentett elem volt.
- **Skip-lista egy futtatáson belül:** minden köteg visszaadja a benne hibázott
  elemek horgonyait (`failedAnchors`); a kliens ezeket egy `Set`-ben tartja, és a
  KÖVETKEZŐ köteg-híváskor `skipAnchorKeys`-ként visszaadja. Enélkül egy TARTÓSAN
  hibázó elem (pl. üres cédula-szöveg) minden kötegből elvitt volna egy helyet a
  futtatás végéig, feleslegesen sokszorozva a hibaszámot és az LLM-hívásokat (ezt
  a hibát a verifikáció elején egy szándékosan hibás fixture-rel ki is mutatta —
  lásd lent). Egy ÚJ „Címkézés futtatása" kattintás (friss futtatás, üres
  skip-lista) mindent újra megkísérel, esélyt adva a tranziens hibáknak is.
- **Kliens-vezérelt ciklus + élő haladás:** a CatalogAdmin gomb `useTransition`-ben
  hívja a kötegeket egymás után, és minden köteg után frissíti a „Címkézés…
  X/Y kész" kijelzést.
- **Pontos hibaüzenet:** a végállapot mindig a valós számokat mutatja —
  `runDone` (minden kész), `runPartialError` (N kész, M hibával, az első hiba-
  üzenettel — ez a hibaszám a skip-lista miatt NEM sokszorozódik), vagy
  `runInterrupted` (hálózati megszakadás — „kattints újra a folytatáshoz").

## Verifikáció — **MOCK-alapú** (MOCK_LLM=1 + MOCK_EMBEDDINGS=1)

Lokális PG16 + PostgREST-shim + prod Next-szerver, `KNOWLEDGE_LABEL_BATCH_SIZE=3`
(hogy a 39-40 elemes katalógus ~13 kötegben fusson, valóban gyakorolva a
kötegváltást). Edge-fixture: 39 valós elem + 1 SZÁNDÉKOSAN üres cédula-szövegű
elem (title=" ") — ez garantáltan, tartósan hibázik (`labelOneItem` „Üres
cédula-szöveg" ok:false, sosem kap signal-sort).

**Első kör — hibát talált a saját tervezésemben, javítottam:**
- A `remaining` mező eredetileg a köteg-méretet vonta le a hátralévőből
  (`totalTodo - batch.length`), ami hibás lett volna hibázó elem esetén → javítva
  `totalTodo - done`-ra (csak a SIKERES elemek fogynak le).
- Skip-lista nélkül a tartósan hibázó elem 20+ alkalommal újra bekerült a
  kötegekbe (mert sosem kapott signal-sort, és amíg VOLT mellette sikeres elem a
  kötegben, semmilyen leállító feltétel nem lépett közbe) → a `failedAnchors` +
  kliens-oldali skip-lista bevezetése oldotta meg.
- **Valódi hiba a hibakeresés közben:** a skip-lista első verziója NEM működött,
  mert a kliens-oldali horgony-kulcs függvényem szóközzel (`" "`) illesztette
  össze a mezőket, míg a valódi `anchorKey()` (`src/lib/knowledge/anchor.ts`) NUL-
  bájttal (`"\0"`) — ezt csak konzol-debug hozzáadásával (majd eltávolításával)
  sikerült kideríteni, mert a forráskód-olvasó eszköz a NUL-bájtot vizuálisan
  szóközként jelenítette meg. Javítva: a kliens-oldali `anchorKeyOf` most `"\0"`-t
  használ, PONTOSAN az anchor.ts formátumát követve.

**Végeredmény a javítás után (5/5 ellenőrzés zöld):**
- Elő-állapot: 0 címkézett, 40 cédula.
- Haladás-kijelzés **8 különböző köteg-lépésben** frissült (nem egy ugrás — a
  kötegelt futtatás ténylegesen több hívásban zajlik).
- Végeredmény: **„39 elem címkézve, 1 hibával"** — pontos, nem sokszorozott
  hibaszám, piros sávban (nem elnyelt hiba).

**Regresszió a teljes 4.2 UI-funkcionalitásra (35/35 zöld, változatlan):**
- Playwright 1 (15/15): NF2 elő-állapot, futtatás valós action-úton (39 elem,
  3/2 szavazatmegoszlás), felülvizsgálati sor csoportokkal, 2. futás inkrementális.
- Playwright 2 (20/20): tuning-napló kiolvasás, billentyűzet (↑↓ + Enter),
  szerkesztés+mentés, keresés + szűrők, újracímkézés F4-őrzéssel, **23 elemes
  csoport-jóváhagyás** (batch) — mind hibátlanul fut a kötegelt motoron is.

Build + `tsc --noEmit` + `i18n:check` (1957 kulcs, HU/EN paritás) zöld.

**Ami MOCK:** minden LLM-válasz és embedding-vektor. **Ami valós:** a teljes
köteg-ciklus vezérlés, a skip-lista logika, a haladás-számítás, az akciók és a UI.

## Valós Vercel-környezet — mit nézzen Máté

A javítás a FUTTATÁS mechanizmusát célozza, ezért a végső bizonyíték az, hogy a
Címkézés a teljes katalóguson (akár 40+ elem) timeout nélkül lefut éles/preview
környezetben:
1. Deploy után nyisd meg a Katalógus oldalt egy sok-elemes projekten.
2. Kattints „Címkézés futtatása" — figyeld a „Címkézés… X/Y kész" kijelzést:
   TÖBBSZÖR kell frissülnie (ez bizonyítja, hogy kötegekben fut).
3. Ha korábban timeout volt egy adott elemszámnál, most azon is végig kell
   futnia. Ha MÉGIS timeout van egyetlen kötegen belül (a jelenlegi alapérték 5
   elem/köteg túl sok), csökkentsd a `KNOWLEDGE_LABEL_BATCH_SIZE` env-változót
   (pl. 2-3-ra) a Vercel projekt-beállításokban, redeploy nélkül (a fv. minden
   hívásnál újraolvassa).
4. Ha a Vercel Functions beállításaiban (Settings → Functions) látható a
   konkrét `maxDuration` érték, azt is érdemes feljegyezni a jövőbeli
   köteg-méret hangolásához.

## Nem érintett / parkoló

- A címkéző motor logikája (konfidencia, küszöb, önkonzisztencia) — érintetlen.
- A 4.1 adatréteg, a 2.1 katalógus, az Epic 3 UI — érintetlen.
- Nem vezettünk be háttér-job/queue infrastruktúrát — a kötegelés + kliens-
  vezérelt ciklus elegendő volt.

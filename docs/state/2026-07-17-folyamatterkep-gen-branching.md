# Záró jelentés — Folyamattérkép: a GENERÁLÁS elágazó topológiát kényszerít ki

**Dátum:** 2026-07-17 · **Branch:** dev · Nincs migráció (csak prompt + teszt).

## A gyökérok (megerősített, harmadik menet)

A layout és a layout-hívás rendben van (22 unit-teszt; a generálás ÉS a
betöltés is meghívja a `layoutGraph`-ot). A hiba **upstream, a generálásnál**:
a valós LLM (k)vázi-lineáris lépéslistát adott — a döntésnek nem több,
párhuzamos ágba mutató `next`-e —, ezért a jó layoutnak nincs mit
szétágaztatnia, és egy oszlopba rendezi. Két gyenge láncszem a promptban:

1. A `PROCESS_SHAPE` példa **egyetlen** `next`-elemet mutatott a soron
   következő id-re — lineáris minta, amit a modell utánzott.
2. A system csak annyit mondott, „elágazásnál a next-elemek label-je az ág
   neve" — nem kérte, hogy a döntésnek **több, párhuzamos** ága legyen, és
   nem volt merge/összefutás-utasítás.

**Plusz vakfolt:** a korábbi verifikáció végig MOCK_LLM-mel futott (kézzel
megírt, elágazó fixture), ami elfedte, hogy a valós LLM nem ágaztat. Ezt a
mostani verifikáció szándékosan megfogja (lásd „B" teszteset).

## A javítás (csak a generálás)

**`src/lib/llm/index.ts` — semmi más nem változott.**

- **`PROCESS_SHAPE` átírva úgy, hogy MAGA DEMONSTRÁLJA az elágazást + merge-et:**
  egy `decide` node `next: [{to:s3,label:"Igen"},{to:s4,label:"Nem"}]` (két külön
  ág, két különböző cél), majd s3 ÉS s4 `next:[{to:s5}]` — a két ág ugyanabba a
  záró/merge-node-ba fut. A régi 1-elemű lineáris minta megszűnt.
- **`extractProcessMap` system-szabályok (AS-IS és bevitt TO-BE):** minden
  döntési node-nak LEGALÁBB KÉT kimenő next-eleme legyen, KÜLÖNBÖZŐ cél-node-okba
  (párhuzamos ágak, nem egymást követő lépések); ág-label; közös lépésnél mindkét
  ág UGYANARRA a merge-node-ra mutat (a közös lépést nem duplikáljuk); ha egy ág
  külön fut a végéig, az is rendben; kerüld a HAMIS LINEARITÁST (a „ha X…,
  egyébként…" szerkezetet elágazó next-ekkel add vissza) — **de ne találj ki
  elágazást, ahol a folyamat valóban lineáris**.
- **`suggestToBeProcess` system-szabályok (AI-javasolt TO-BE):** ugyanaz az
  elágazás+merge követelmény, a c-minta / HITL / traceability / „TILOS számot
  kitalálni" változatlanul.

**Parse (`parse.ts`) — kód nem változott, csak megerősítve teszttel:** a
`parseProcessProposal` már minden `next`-elemből külön élt csinál (108–129).
Nem adtam runtime-validációt: a generálás sikerkor átirányít (a FormState-notice
nem jutna a felhasználóhoz), a megjelenítés pedig e csomagban FAGYASZTOTT — így
egy „egy-ágú döntés" jelzésnek nem lenne tiszta felülete. A prompt a valódi
kényszer; a jelzés-igényt a teszt fedi le. (Parkoló-listára tettem, ha később
kell látható jelzés, az a megjelenítésbe való.)

## Verifikáció (NEM csak a meglévő elágazó MOCK-on)

Új parse→layout pipeline-teszt (`branch-gen-unit`, 12/12 ✓):

| Eset | Mit bizonyít |
|---|---|
| **A — elágazó input** (amit az új prompt kikényszerít) | döntés → 2 él, 2 külön cél, merge 2 bejövő éllel, ág-label megőrizve; layout **térben szétválik** (s3.x≠s4.x), merge középen, >1 oszlop |
| **B — naiv lineáris input** (a valós-LLM hiba, amit a régi MOCK ELFEDETT) | döntés csak 1 kimenő éllel → **egy oszlop** → bizonyítja, hogy a javítás a PROMPTnál kell, nem a layoutnál |
| **C — 3-utas döntés** (parse megerősítés) | több-elemű next → 3 él → 3 külön oszlop |
| **D — valóban lineáris folyamat** | egy oszlop marad (nincs fabrikált ág) |

- Regresszió: a **22 layout-teszt** és a meglévő **elágazó MOCK** zöld
  (a mock változatlan; friss MOCK-generálás a döntést `s3`-nál KÉT éllel tárolja:
  `e3→s4 "Igen · sürgős"` bal, `e4→s5 "Nem · normál"` jobb — DB-ből igazolva).
- tsc 0 · prod build zöld · i18n:check 1169 kulcs, HU=EN (nincs új string).

**FONTOS — a valós LLM kimenetét lokálisan NEM tudtam lefuttatni** (nincs éles
Anthropic-kulcs a környezetben; a MOCK a promptot megkerüli). A prompt-változás
tényleges hatását a **Preview-n, valós LLM-mel** kell igazolni. Nem állítom, hogy
a valós generálást igazoltam — csak a parse/layout pipeline-t és a mock-regressziót.

## Kemény korlátok — betartva

- Csak a **generálás** (prompt + shape) változott + parse-megerősítő teszt.
  A layout, megjelenítés, chat, jóváhagyás, verziózás, forrás-hivatkozás,
  c-minta, HITL, traceability **változatlan**.
- Nem fabrikál elágazást: a prompt kifejezetten tiltja az ágat ott, ahol a
  folyamat valóban lineáris („D" teszt is ezt őrzi).
- Nincs migráció.

## Nálad zárandó (Preview, valós LLM — ez az igazi próba)

Generálj AS-IS térképet egy **elágazó** folyamatot tartalmazó leiratból
(pl. panaszkezelés: „Sürgős reklamáció? → Igen: soron kívül / Nem: normál sor",
vagy „Megtalálta a hibakódot? → Igen: lezárás / Nem: eszkaláció"), és ellenőrizd,
hogy az **áttekintő nézet térben szétágazik-e** a döntésnél. A MOCK ezt nem tudja
igazolni — a valós LLM kimenete a mérce.

## Parkoló-lista

- Ha a valós LLM néha mégis egy-ágú döntést ad: látható jelzés a
  megjelenítésben („N döntés · M elágazás nélkül") — külön csomag, mert a
  megjelenítést érinti.
- Esetleg few-shot példa a promptban egy teljes elágazó minifolyamattal, ha a
  szabály önmagában nem lenne elég a valós modellnek (Preview-visszajelzés után).

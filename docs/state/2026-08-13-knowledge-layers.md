# Záró jelentés — a katalógus kizárólag ügyfél-tudás (réteg-szűrő)

**Dátum:** 2026-08-13 · **Branch:** `dev` · **Döntés:** rögzített (2026-08-13)
**Leltár:** docs/state/2026-08-13-knowledge-layers-inventory.md (89416e4)

## Mi készült el

| Lépés | Commit | Tartalom |
|---|---|---|
| 1. Leltár | `89416e4` | 96 forrás besorolva (15 entitás block-type + 81 mező), viselkedés-változás nélkül |
| 2. Szűrés | `969182f` | 50 új mező-kivétel + 5 entitás-block-type kivétel, mindkét 4.2 fogyasztóban |
| 3. Verifikáció | ez a commit | 22 headless + 22 UI ellenőrzés, meglévő-adat elemzés |

## A vágás mező-szintű — bizonyítva

A csomag legfontosabb kockázata az volt, hogy dokumentum-szintű szűréssel
valódi ügyfél-tudás vész el. A fixtúra ezért **vegyes dokumentumokat**
tartalmaz, és a teszt ugyanabból a fájlból méri, mi marad és mi esik ki:

| Dokumentum | MARAD (ügyfél-tudás) | KIESIK (projekt/módszertan) |
|---|---|---|
| **Pilot-terv** | `baseline` — „A panasz-válaszidő jelenleg átlagosan 9,2 nap (2026 Q1, 318 panasz alapján)." | `hipotezis`, `dontesi_szabaly` („scale/pivot/stop"), `meresi_mod` |
| **Use case-shortlist** | `kockazati_jegyzet` (haráteset) | `ertekelesi_szempontok` (**Máté példája**), `shortlist`, `quick_win` |
| **TO-BE terv** | `to_be_lepesek`, `beavatkozasi_pontok` (haráteset) | — |
| **Felmérési riport** | `as_is_attekintes`, `adat_es_ai_erettse` | — |
| **Projekt-charter** | `szponzor` (haráteset) | `cel`, `scope` („P0–P2, Felmérés-csomag"), `idokeret`, `sikerkriterium` |
| **Havi státuszriport** | — | `idoszak`, `incidensek` |

## Verifikáció — MI MOCK ÉS MI VALÓS

**MINDEN futás MOCK** (MOCK_LLM=1 + MOCK_EMBEDDINGS=1, lokális PG16 +
PostgREST-shim). A csomag **nem érint LLM-viselkedést** — a szűrő tisztán
konfiguráció + két fogyasztói predikátum —, ezért **valós-LLM verifikációt
nem igényel**. A 4.2b valós-LLM runbookja (`scripts/smoke-source-meta.mts`)
változatlanul érvényes és továbbra is Máté futtatja.

**MOCK-rés:** a lokális fixtúra a csomag előtt csak 5 block-type-ot
tartalmazott (fájdalompont-nehéz), tehát a szűrő nagy részét nem is
érintette volna. Ezért a verifikáció elé **12 block-type-ra és 6
artefaktum-típusra bővített fixtúra** került, kifejezetten a célzott
esetekkel: `eval_criterion` Máté példájának szó szerinti szövegével,
`prompt_item`, `build_component`, `eval_case`, `epic`, valamint 5 vegyes
dokumentum. Katalógus: **66 nézet-sor**.

### A) Headless szűrő-teszt (`verify-layers`): 22/22 ✓

Ugyanazt a predikátumot futtatja, amit a két fogyasztó, és **tételesen
kilistázza mind a 44 bent maradt és mind a 22 kiesett cédulát**:

- Máté példája (`ertekelesi_szempontok`) és az azonos szövegű
  `eval_criterion` egyaránt kiesett
- mező-szintű vágás igazolva a Pilot-terven és a shortlisten (fent)
- ügyfél-tudás bent: `baseline`, `as_is_attekintes`, `adat_es_ai_erettse`,
  `to_be_lepesek`, valamint mind a 23 fájdalompont, use case, stakeholder
- nem-ügyfél entitások kiestek: `eval_criterion`, `eval_case`,
  `prompt_item`, `build_component`, `epic`
- **határesetek érintetlenül bent**: `artifact`, `user_story`,
  `solution_component`, `beavatkozasi_pontok`, `kockazati_jegyzet`
- a 2.1 nézet érintetlen: 66 = 44 + 22, minden kiesett cédula lekérdezhető

### B) UI-walkthrough (`walk-layers`, Playwright): 22/22 ✓

- a felület **44 elemet** mutat (66 nézet-sorból) — a 2.1 nézet közben
  változatlanul 66 sor
- a felületen NINCS: „Érték (1–5)…", „P0–P2, Felmérés-csomag",
  „priorizált use case-shortlist + business case", „Ha a küszöb teljesül:
  scale", prompt-tétel, build-komponens, `EP-01`, üzemeltetési incidens
- a felületen VAN: a pilot baseline mért értéke, az AS-IS áttekintés, az
  adat-érettség, a TO-BE lépések, a fájdalompontok, a stakeholderek
- a **felülvizsgálati sorban sincs módszertani tudás**
- a címkéző köteg csak a bent maradt elemekre fut; a kiszűrt
  entitás-típusokra **nulla** új címke született
- a 4.2 böngészés/felülvizsgálat funkciók változatlanok

### Számszerű hatás (LOKÁLIS fixtúra)

| | Elem |
|---|---|
| 2.1 nézet (érintetlen) | 66 |
| 4.2 katalógusban marad | **44** |
| Kiesik (nem ügyfél-tudás) | **22** (33%) |
| ebből entitás-cédula | 6 (`eval_criterion` ×2, `eval_case`, `prompt_item`, `build_component`, `epic`) |
| ebből mező-cédula | 16 |
| Haráteset, ÉRINTETLENÜL bent | 12 (8 `artifact` + `user_story` + `solution_component` + 2 haráteset-mező) |

Az éles 88 elemre a leltár §5-ében megadott read-only SQL adja a pontos
számokat (az AICON Supabase ebből a munkamenetből nem érhető el).

## A meglévő adat sorsa (LEÍRVA, NEM VÉGREHAJTVA)

**Mérés (lokális):** a szűrés után **49 címke-sor** van a DB-ben:
44 a bent maradt elemeken (mind a 44 címkézett) + **5 „árva"** a most
kiszűrt elemeken (4 charter-mező + `kickoff.celok`).

Mi történik velük ma:

| | Viselkedés |
|---|---|
| Katalógus-böngészés | Nem jelennek meg (szűrve) ✓ |
| Felülvizsgálati sor | Nem jelennek meg — a sor a szűrt listából épül ✓ (U10) |
| `knowledge_label_signals` / `_metadata` | **A DB-ben maradnak** (nem törlünk) |
| `knowledge_embeddings` | **A DB-ben maradnak** ⚠️ l. lent |
| Javítás-napló összegzés | A korábbi javításaikat továbbra is beleszámolja (kozmetikai) |

### ⚠️ Amit a 4.3-nak tudnia kell (követő igény, nem e csomag scope-ja)

A kiszűrt elemek **beágyazásai (embeddings) a keresési indexben maradnak**.
Ha a 4.3 felismerő-réteg közvetlenül az embedding-táblán keres — nem a
szűrt katalóguson át —, akkor **a módszertani tudás visszajön a hátsó
ajtón**, és pontosan az a hiba áll elő, ami miatt ez a döntés született.
→ A 4.3-nak ugyanezt a szűrőt kell alkalmaznia
(`isKnowledgeExemptBlockType` + `isKnowledgeExemptField`), vagy a szűrt
horgony-listával kell metszenie a találatokat.

### Takarítási opciók (Máté dönt, NEM hajtottam végre)

| Opció | Költség | Következmény |
|---|---|---|
| **(A) Marad minden** | 0 | Az árva sorok a felületen láthatatlanok; a 4.3-nak szűrnie kell (fent). Visszafordítható: ha Máté egy határesetet visszahoz, a címkéje már kész. |
| **(B) Árva sorok törlése** | 1 SQL | Tiszta állapot, de **elvesznek a rajtuk végzett kézi javítások**, és egy későbbi visszahozatal újracímkézést igényel. Nem visszafordítható. |
| **(C) Jelölés törlés helyett** | migráció | Legtisztább, de új oszlop kell — külön csomag. |

**Javaslatom: (A) most**, és a döntés újranézése azután, hogy Máté a
határesetekben (H-1…H-6) állást foglalt — mert azok a döntések
megváltoztatják, mely sorok árvák.

## Ami Mátéra vár

1. **A 6 haráteset-csoport eldöntése** (leltár §4): H-1 követelmény-család,
   H-2 megoldás-terv-család (incl. `beavatkozasi_pontok`), H-3 mérés-család,
   H-4 ügyfél-csoport-család, H-5 vegyes mezők, H-6 egész-dokumentum cédula.
   Amíg nincs döntés, ezek a cédulák **bent maradnak**.
2. **Az éles darabszámok** lefuttatása (leltár §5 SQL-jei).
3. **Az árva-adat opció** kiválasztása (fent).

## Kész-ha státusz

- Teljes, táblázatos leltár minden mezőről, besorolással, valós példákkal: ✓ (89416e4)
- Határesetek külön listán, Máté döntésére várva: ✓ (leltár §4, H-1…H-6)
- Szűrő kiterjesztve a nem-vitatott esetekre: ✓ (969182f — 50 mező + 5 block-type)
- A katalógusban csak ügyfél-tudás, mintavétellel igazolva: ✓ (mind a 44 bent
  maradt cédula tételesen kilistázva és ellenőrizve; 22 UI-állítás)
- Valódi ügyfél-tudás nem esett ki: ✓ (baseline, AS-IS, TO-BE lépések,
  fájdalompontok, use case-ek, stakeholderek — tételesen)
- A 2.1 nézet érintetlen: ✓ (66 sor a szűrés után is)
- Adat nem törlődött: ✓ (49 címke-sor érintetlen)
- Számszerű hatás: ✓ (66 → 44, 22 kiesett; élesre SQL a leltárban)

## Takarítás

`.env.local` törölve; PG + shim + dev-szerver leállítva; a
verifikációs fájlok (`verify-layers`, `walk-layers`, `check-layers`) a
session-scratchpadban maradtak, a repóba nem kerültek. A réteg-fixtúra a
LOKÁLIS teszt-DB-ben él (éles adatot nem érint).

# Leltár — ügyfél-tudás vs. projekt-tudás vs. módszertani tudás

**Dátum:** 2026-08-13 · **Branch:** `dev` · **Döntés:** rögzített (2026-08-13)
**Scope:** LELTÁR ÖNMAGÁBAN — ez a commit NEM változtat viselkedést.

## A döntés, amit ez a leltár szolgál

A tudáselem-katalógus **KIZÁRÓLAG ÜGYFÉL-TUDÁST** tartalmaz: állításokat az
ügyfél valóságáról. Három réteg, és csak az első marad:

| Réteg | Mi ez | Sors |
|---|---|---|
| **ÜGYFÉL-TUDÁS** | Állítás az ügyfél valóságáról („a válaszidő 4 óra", „a raktárkészletet Excelben vezetik") | **BENT** |
| **PROJEKT-TUDÁS** | A mi munkánk az ügyfélen: mit döntöttünk, mi került shortlistre, mikor indul a pilot | KI (egyelőre) |
| **MÓDSZERTANI TUDÁS** | A mi működésünk: értékelési skálák, fázis-definíciók, sablonok | KI |

**Miért:** a 4.3 felismerő-réteg különben a MI módszertanunkat ütköztetné az
ügyfél gyakorlatával. A modalitás-dimenzió (megfigyelés vs. előírás) is csak
ügyfél-tudásra értelmes.

**A vágás MEZŐ-SZINTŰ, nem dokumentum-szintű** — a generált dokumentumok
vegyesek (l. §3 táblázatai).

---

## 1. Mi kerül ma egyáltalán a katalógusba?

A 0015 `knowledge_catalog` nézet **16 block-type**-ot ad:
15 entitás/dokumentum-szintű ág + az `artifact_field` ág, amely a
**18 artefaktum-típus 81 mezőjét** teszi ki cédulaként.
Összesen tehát **15 + 81 = 96 besorolandó forrás**. Mind a 96 alább
besorolva; nincs besorolatlan.

> **Az élesen mért darabszámok nem érhetők el ebből a munkamenetből** (az
> AICON Supabase-hez nincs hozzáférés, l. §5) — a példák a LOKÁLIS
> fixtúra-adatból és a mezők definíciójából (`promptHint`, ami a
> generáláskor a mezőbe kerülő tartalmat előírja) származnak, valamint
> Máté saját, a felülvizsgálati sorból idézett példájából.

---

## 2. Entitás- és dokumentum-szintű cédulák (15)

| # | block_type | Cédula tartalma | Besorolás | Indok | Valós példa |
|---|---|---|---|---|---|
| 1 | `pain_point` | title + description/quote | **ÜGYFÉL** | Állítás az ügyfél működési valóságáról | „A beérkező panaszt az ügyfélszolgálati kolléga egy közös Outlook-postafiókban látja…" (lokális) |
| 2 | `use_case` | title + description | **ÜGYFÉL** | Az ügyfél problémájáról szól (Máté rögzített döntése) | „Riport-automatizálás — A havi riport összeállítása jelenleg kézi munka, két nap." (lokális) |
| 3 | `stakeholder` | name + title | **ÜGYFÉL** | Ki kicsoda az ügyfél szervezetében | „Nagy Eszter — ügyfélszolgálati vezető" (lokális) |
| 4 | `process_map` | title + kind | **ÜGYFÉL** | Az ügyfél AS-IS/TO-BE folyamata | (lokálisan nincs jóváhagyott térkép) |
| 5 | `requirement` | display_id + text | **HATÁRESET** | Business-szintű követelmény gyakran ügyfél-korlát; rendszer-szintű a mi specifikációnk | l. §4/H-1 |
| 6 | `user_story` | display_id + „role — want" | **HATÁRESET** | Az ügyfél felhasználójának igénye, de a mi backlog-formánkban | l. §4/H-1 |
| 7 | `acceptance_criterion` | title + Given/When/Then | **HATÁRESET** | A követelmény elfogadási feltétele — a követelménnyel együtt mozog | l. §4/H-1 |
| 8 | `solution_component` | name + description | **HATÁRESET** | A mi megoldás-tervünk komponense, de az ügyfél jövőbeli rendszerének része lesz | l. §4/H-2 |
| 9 | `control_point` | name + description | **HATÁRESET** | HITL-kontroll: a mi tervezésünk, de az ügyfél jövőbeli folyamatának kontrollja | l. §4/H-2 |
| 10 | `artifact` (egész dokumentum) | „Típus vN" + a body első 240 karaktere | ~~HATÁRESET~~ → **KI (Máté döntése, 2026-08-13)** | Nem atomi állítás, hanem dokumentum-fej; tartalma vegyes, és az atomi állításai már mező-/entitás-cédulaként bent vannak (duplikátum). Élesben 31 elem = a 273 katalógus-elem 11%-a. L. §4/H-6 | „# Projekt-charter — AI-felmérés: panaszkezelés ⏎⏎ ## Cél ⏎ A pan" (lokális — **szó szerint markdown-szerkezet**) |
| 11 | `build_component` | name + description | **PROJEKT** | A mi implementációnk építőeleme (P3) | — |
| 12 | `prompt_item` | name + purpose | **PROJEKT/MÓDSZERTAN** | A mi prompt-könyvtárunk; semmit nem mond az ügyfélről | — |
| 13 | `eval_case` | display_id + input_text | **PROJEKT** | A mi golden set teszt-esetünk (minta, nem állítás) | — |
| 14 | `eval_criterion` | a kritérium szövege | **MÓDSZERTAN** | Értékelési kritérium — **pontosan Máté példájának családja** | — |
| 15 | `epic` | display_id + title (excerpt: NINCS) | **PROJEKT** | Backlog-csoportosító címke, nulla ügyfél-állítással | — |

---

## 3. Artefaktum-mezők (81) — típusonként

Jelölés: **✅ BENT** = ügyfél-tudás · **❌ KI** = projekt- vagy módszertani
tudás · **⚠️ HATÁRESET** = Máté döntése (§4) · *(már KI)* = a 4.2b óta
`knowledgeExempt`.

### P0 · Projekt-charter (6)

| Mező | Besorolás | Indok | Valós példa (lokális) |
|---|---|---|---|
| `cel` | ❌ PROJEKT | A PROJEKT célja („mit akar elérni ezzel a projekttel"), nem az ügyfél működése | „a panaszkezelési folyamat AI-alkalmasságának felmérése" |
| `scope` | ❌ PROJEKT | A projekt terjedelme | **„P0–P2, Felmérés-csomag"** — a mi fázis-nómenklatúránk |
| `idokeret` | ❌ PROJEKT | A projekt időkerete | „6 hét" |
| `sikerkriterium` | ❌ PROJEKT | A projekt sikere, a mi deliverable-jeink | **„priorizált use case-shortlist + business case"** |
| `szponzor` | ⚠️ HATÁRESET | Ügyfél-szerep, de projekt-szerepként | „ügyvezető" |
| `stakeholderek` | ✅ ÜGYFÉL | Az ügyfél szervezetének szereplői | — |

### P0 · Engagement-terv (5)

| Mező | Besorolás | Indok |
|---|---|---|
| `stakeholder_kor` | ⚠️ HATÁRESET | Ügyfél-szereplők, de az engagement kontextusában |
| `merfoldkovek` | ❌ PROJEKT | A projekt mérföldkövei |
| `kommunikacios_ritmus` | ❌ PROJEKT | A MI együttműködési ritmusunk |
| `munkamodszer` | ❌ MÓDSZERTAN | „műhelyek, interjúk, eszközök" — a mi módszertanunk |
| `kockazatok` | ❌ PROJEKT | Az engagement kockázatai |

### P0 · Kickoff-agenda (4)

| Mező | Besorolás | Indok | Példa |
|---|---|---|---|
| `resztvevok` | ❌ *(már KI)* | Szerkezet: résztvevő-lista | „Kovács Nándor (üzemvezető), Nagy Eszter…" |
| `napirend` | ❌ *(már KI)* | Szerkezet: napirendi pontok | „1. A helyzetértékelés bemutatása… 2. A p" |
| `elokeszuletek` | ❌ *(már KI)* | Szerkezet: teendő-lista | „1. Szervezeti ábra bekérése. 2. Panasz-statisztika export." |
| `celok` | ❌ PROJEKT | A kickoff MEGBESZÉLÉS kimenetei | „A kickoff kimenete a jóváhagyott felmérési terv és a kijelölt pilot-felelős." |

### P1 · Priorizált use case-shortlist (5)

| Mező | Besorolás | Indok |
|---|---|---|
| `shortlist` | ❌ PROJEKT | A MI rangsorolási döntésünk (a use case-ek maguk entitás-cédulaként BENT maradnak) |
| `ertekelesi_szempontok` | ❌ MÓDSZERTAN | **Máté idézett példája:** „Érték (1–5)… Megvalósíthatóság (1–5)… Kockázat (alacsony/közepes/magas)" — szó szerint ugyanez lenne bármely másik ügyfélnél |
| `quick_win` | ❌ PROJEKT | A mi jelölésünk |
| `kizart_jeloltek` | ❌ PROJEKT | A mi kizárási döntésünk |
| `kockazati_jegyzet` | ⚠️ HATÁRESET | Vegyes: ügyfél-korlát vagy a mi bevezetési kockázatunk |

### P1 · Felmérési riport (5) — a legügyfél-sűrűbb dokumentum

| Mező | Besorolás | Indok |
|---|---|---|
| `vezetoi_osszefoglalo` | ✅ ÜGYFÉL | A felmérés fő üzenetei az ügyfélről (szintetizált, de ügyfél-tartalom) |
| `as_is_attekintes` | ✅ ÜGYFÉL | Az ügyfél jelenlegi folyamatai |
| `fajdalompontok` | ✅ ÜGYFÉL | Az ügyfél fájdalompontjai |
| `adat_es_ai_erettse` | ✅ ÜGYFÉL | Az ügyfél adatminősége és érettsége |
| `megallapitasok` | ⚠️ HATÁRESET | „megállapítások ÉS javaslatok" — vegyes mező |

### P2 · Business case (6)

| Mező | Besorolás | Indok |
|---|---|---|
| `problema_es_hatas` | ✅ ÜGYFÉL | Az ügyfél problémája és üzleti hatása |
| `megoldas_osszefoglalo` | ⚠️ HATÁRESET | A javasolt megoldás = a mi tervünk / az ügyfél jövője |
| `haszon_szamitas` | ⚠️ HATÁRESET | Ügyfél-baseline számokból, de a mi kalkulációnk |
| `koltsegek` | ❌ PROJEKT | A mi bevezetési/üzemeltetési becslésünk |
| `outcome_metrika` | ❌ MÓDSZERTAN | A mi mérési definíciónk („a felszabadult idő nem azonos a realizált megtakarítással" — módszertani tétel) |
| `kockazatok` | ⚠️ HATÁRESET | Vegyes: ügyfél-korlát vagy projekt-kockázat |

### P2 · Pilot-terv (6)

| Mező | Besorolás | Indok |
|---|---|---|
| `hipotezis` | ❌ PROJEKT | A mi hipotézisünk |
| `resztvevok_idotartam` | ❌ PROJEKT | A pilot logisztikája |
| `baseline` | ✅ ÜGYFÉL | **„A kiinduló állapot MÉRT ÉRTÉKE"** — ügyfél-tény (pl. „az átlagos átfutás 11,4 nap") |
| `szamszeru_kuszob` | ❌ PROJEKT | A mi sikerküszöbünk |
| `dontesi_szabaly` | ❌ MÓDSZERTAN | Scale/pivot/stop — a mi döntési keretünk |
| `meresi_mod` | ❌ MÓDSZERTAN | A mi mérési eljárásunk |

### P2 · Megoldási javaslat (4)

| Mező | Besorolás | Indok |
|---|---|---|
| `valasztott_use_case` | ❌ PROJEKT | A mi választásunk |
| `megoldas_leiras` | ⚠️ HATÁRESET | A megoldás működése = az ügyfél jövőbeli rendszere / a mi tervünk |
| `opcio_osszevetes` | ❌ PROJEKT | A mi mérlegelésünk |
| `dontesi_kriterium` | ❌ MÓDSZERTAN | Döntési kritériumok — az `ertekelesi_szempontok` családja |

### P2 · TO-BE terv (4)

| Mező | Besorolás | Indok |
|---|---|---|
| `to_be_lepesek` | ✅ ÜGYFÉL | Az ügyfél JÖVŐBELI folyamatának lépései (Máté rögzítette: BENT) |
| `beavatkozasi_pontok` | ⚠️ HATÁRESET | **Máté explicit határesete:** a mi tervezésünk az ügyfél folyamatában |
| `hitl_kontrollok` | ⚠️ HATÁRESET | Ugyanaz a család: a mi kontroll-tervünk az ügyfél folyamatában |
| `valtozas_hatasa` | ✅ ÜGYFÉL | A változás hatása az ügyfél szerepeire és terhelésére |

### P3 · Megoldás-dokumentáció (5)

| Mező | Besorolás | Indok |
|---|---|---|
| `architektura` | ❌ PROJEKT | A mi architektúránk |
| `komponensek` | ❌ PROJEKT | A mi komponenseink (modul-birtokolt mező) |
| `prompt_konyvtar` | ❌ PROJEKT/MÓDSZERTAN | A mi prompt-jaink |
| `guardrail_hitl` | ❌ PROJEKT | A mi guardrail-jeink |
| `uzemeltetesi_jegyzet` | ❌ PROJEKT | A mi üzemeltetési jegyzetünk |

### P3 · Tesztriport (4) — teljes egészében a mi QA-nk

| Mező | Besorolás | Indok |
|---|---|---|
| `golden_set_eredmeny` | ❌ PROJEKT | A mi tesztfutásunk eredménye |
| `atmenesi_arany` | ❌ PROJEKT | A mi tesztünk átmenési aránya |
| `hibak_javitasok` | ❌ PROJEKT | A mi hibáink és javításaink |
| `maradek_kockazat` | ❌ PROJEKT | A mi maradék kockázatunk |

### P4 · Pilot-riport (5)

| Mező | Besorolás | Indok |
|---|---|---|
| `mert_eredmenyek` | ⚠️ HATÁRESET | Az ügyfél környezetében mért érték, de a MI megoldásunkról |
| `delta_vs_baseline` | ⚠️ HATÁRESET | Ugyanaz a család |
| `kuszob_ertekeles` | ❌ PROJEKT | A mi küszöbünk teljesülése |
| `visszajelzesek` | ✅ ÜGYFÉL | Az ügyfél munkatársainak visszajelzései |
| `tanulsagok` | ❌ PROJEKT | A mi tanulságaink |

### P4 · Döntési brief (3)

| Mező | Besorolás | Indok |
|---|---|---|
| `evidencia_osszefoglalo` | ⚠️ HATÁRESET | Ügyfél-mérésekből álló összefoglaló, a mi döntésünkhöz |
| `javasolt_dontes` | ❌ PROJEKT | A mi javaslatunk |
| `indoklas` | ❌ PROJEKT | A mi indoklásunk |

### P5 · Rollout-terv (4)

| Mező | Besorolás | Indok |
|---|---|---|
| `utemezes` | ❌ PROJEKT | A mi ütemezésünk |
| `erintett_csoportok` | ⚠️ HATÁRESET | Az ügyfél szervezeti csoportjai, a mi rollout-keretünkben |
| `change_beavatkozasok` | ❌ MÓDSZERTAN | **„ADKAR szerinti"** — nevesített idegen módszertan |
| `champion_halozat` | ❌ PROJEKT | A mi change-struktúránk |

### P5 · Impact-riport (5)

| Mező | Besorolás | Indok |
|---|---|---|
| `baseline_osszefoglalo` | ✅ ÜGYFÉL | Az ügyfél kiinduló állapota |
| `beavatkozas` | ❌ PROJEKT | Amit MI bevezettünk |
| `mert_delta` | ⚠️ HATÁRESET | Mért változás az ügyfélnél, de a mi beavatkozásunkról |
| `emberi_sztori` | ✅ ÜGYFÉL | Egy konkrét ügyfél-felhasználó története |
| `kovetkezo_lepesek` | ❌ PROJEKT | A mi következő lépéseink |

### P5 · Képzési terv (3)

| Mező | Besorolás | Indok |
|---|---|---|
| `celcsoportok` | ⚠️ HATÁRESET | Ügyfél-csoportok, a mi képzési keretünkben |
| `alkalmak_utem` | ❌ PROJEKT | A mi képzési ütemünk |
| `anyagok` | ❌ MÓDSZERTAN | A mi képzési anyagaink |

### P6 · Havi státuszriport (4) — teljes egészében a mi szolgáltatás-riportunk

| Mező | Besorolás | Indok |
|---|---|---|
| `idoszak` | ❌ PROJEKT | Riport-metaadat („2026 Q2") |
| `uzemeltetesi_osszefoglalo` | ❌ PROJEKT | A mi üzemeltetésünk összefoglalója |
| `incidensek` | ❌ PROJEKT | A mi rendszerünk incidensei |
| `backlog_kiemelesek` | ❌ PROJEKT | A mi backlogunk |

### P6 · Javaslat-dokumentum (3)

| Mező | Besorolás | Indok |
|---|---|---|
| `javaslat` | ❌ PROJEKT | A mi javaslatunk |
| `varhato_ertek` | ❌ PROJEKT | A mi becslésünk |
| `kovetkezo_use_case` | ❌ PROJEKT | A mi jelölésünk |

### Mezők összesítése

| | Darab |
|---|---|
| ✅ ÜGYFÉL (BENT) | **12** |
| ❌ KI — új (projekt/módszertan) | **50** |
| ❌ KI — már a 4.2b óta (szerkezet) | **3** |
| ⚠️ HATÁRESET (Máté dönt) | **16** |
| **Összesen** | **81** |

---

## 4. Határesetek — Máté döntésére (NEM döntöttem el, NEM szűröm)

Csoportosítva, mert az egy csoportba tartozókra egyetlen elv dönt.

### H-1 · Követelmény-család (`requirement`, `user_story`, `acceptance_criterion`)
A business-szintű követelmény gyakran ügyfél-korlátot rögzít („2 munkanapon
belül válasz"), a rendszer-szintű viszont a mi specifikációnk. A három
együtt mozog (az AC a requirementtől örökli a jóváhagyást).
**A kérdés:** a specifikáció ügyfél-tudás-e, vagy a mi termékünk?
*Megjegyzés:* a `requirement` enrichmentje hordoz `level` mezőt — ha a
döntés szintfüggő, azon szűrhető.

### H-2 · Megoldás-terv-család (`solution_component`, `control_point`,
`tobe.beavatkozasi_pontok`, `tobe.hitl_kontrollok`, `businesscase.megoldas_osszefoglalo`, `solution.megoldas_leiras`)
Máté a `to_be_lepesek`-et BENT-nek rögzítette (az ügyfél jövőbeli folyamata),
a `beavatkozasi_pontok`-at viszont határesetnek. Ez a hat tétel ugyanazon a
tengelyen van: **a tervezett jövő MELYIK oldala ügyfél-tudás** — a folyamat
(BENT) vagy a beavatkozás (?).

### H-3 · Mérés-család (`pilotreport.mert_eredmenyek`, `pilotreport.delta_vs_baseline`, `impact.mert_delta`, `decisionbrief.evidencia_osszefoglalo`)
Az ügyfél környezetében mért, valós számok — de a MI megoldásunk
teljesítményéről. A `baseline` (BENT) ügyfél-tény; a delta már a mi
beavatkozásunk hatása.
**A kérdés:** a bevezetés utáni mérés az ügyfél új valósága-e?

### H-4 · Ügyfél-csoport-család (`charter.szponzor`, `engagement.stakeholder_kor`, `rollout.erintett_csoportok`, `training.celcsoportok`)
Mind az ügyfél szervezetéről szól, de projekt-szerepként/célcsoportként
keretezve. (A `stakeholder` entitás és a `charter.stakeholderek` külön
BENT — átfedés.)

### H-5 · Vegyes mezők (`assessment.megallapitasok`, `shortlist.kockazati_jegyzet`, `businesscase.kockazatok`, `businesscase.haszon_szamitas`)
Definíció szerint két réteget kevernek egy mezőben („megállapítások **és
javaslatok**"). Mező-szinten nem szétvághatók — vagy bent, vagy kint.

### ~~H-6~~ · Egész-dokumentum cédula (`artifact` block_type) — **ELDÖNTVE**
A jóváhagyott artefaktum EGY cédulaként is megjelenik, a body első 240
karakterével. Lokálisan ez szó szerint: `„# Projekt-charter — AI-felmérés:
panaszkezelés ⏎⏎ ## Cél ⏎ A pan"` — markdown-szerkezet, nem állítás.
Az atomi tartalma már mező-cédulaként bent van.

> **DÖNTÉS (Máté, 2026-08-13): KIVEZETVE.** Élesben 31 elem, a 273
> katalógus-elem 11%-a. Végrehajtva: `NON_CLIENT_BLOCK_TYPES` +
> `artifact`. Hivatkozás-ellenőrzés: nem szakadt el semmi (a
> `RenderTargetType` unió nem tartalmaz `artifact`-ot, tehát render-él
> strukturálisan sem mutathat rá; a render-élek az `artifacts` TÁBLÁRA
> mutatnak, nem a cédulára). Jelentés:
> docs/state/2026-08-13-artifact-cedula.md

---

## 5. Számszerű hatás

### Amit itt mérni tudtam (LOKÁLIS fixtúra-DB, 39 katalógus-sor)

| | Elem |
|---|---|
| Katalógus-sor összesen | 39 |
| Ma megjelenik a 4.2-ben (3 szerkezet-mező már kiszűrve) | 36 |
| **A kiterjesztett szűrő után** | **31** |
| Kiesik (új) | **5** — `charter.cel`, `charter.scope`, `charter.idokeret`, `charter.sikerkriterium`, `kickoff.celok` |
| Határesetként BENT marad | 3 — `charter.szponzor` + 2 `artifact` cédula |

A lokális fixtúra fájdalompont-nehéz, ezért a valós arányt alulbecsli: az
éles 88 elemben a generált dokumentumok mezői sokkal nagyobb súlyt kapnak.

### Amit Mátének kell lefuttatnia az ÉLES adaton (read-only)

```sql
-- (1) mezőnkénti darabszám a katalógusban
select a.type, c.field_key, count(*) as db
from knowledge_catalog c
join artifacts a on a.id = c.artifact_id
where c.block_type = 'artifact_field'
group by 1, 2
order by 1, 2;

-- (2) block-type-onkénti darabszám (entitás-cédulák)
select block_type, count(*) from knowledge_catalog group by 1 order by 2 desc;

-- (3) a kiterjesztett szűrő hatása egy számban:
--     hány cédula esik a KI-listára (a lista a config-ból, l. §3)
select count(*) filter (where c.block_type = 'artifact_field') as mezo_cedulak,
       count(*) filter (where c.block_type in
         ('build_component','prompt_item','eval_case','eval_criterion','epic')) as entitas_ki,
       count(*) as osszes
from knowledge_catalog c;
```

---

## 6. Megfigyelések (nem döntés, de tudni kell)

- **A folyamat-LÉPÉSEK ma nem külön cédulák.** A `process_map` ág csak
  TÉRKÉP-szintű cédulát ad (a node-ok a 4.1 spec szerint v1-ben nem
  cédulák). Az „ügyfél folyamatlépései" tehát ma a `tobe.to_be_lepesek`
  mezőn és a térkép-cédulán át élnek — a szűrő egyiket sem érinti.
- **A `process_map` cédula kivonata maga a `kind` token** („as_is"/„to_be"),
  nem szöveg. Réteg-szempontból ügyfél-tudás (BENT), de a cédula
  információtartalma gyenge — külön (nem e csomagba tartozó) minőségi kérdés.
- **Az `epic` cédulának nincs kivonata** (`null`), csak egy display_id +
  cím. Backlog-címke, nulla ügyfél-állítással.
- **A `use_case` enrichmentje projekt-tudást hordoz** (`list_status`:
  shortlist/excluded/selected, `quick_win`) — de ez ugyanazon a cédulán
  gazdagítás, nem külön elem; a cédula maga ügyfél-tudás marad.
- **Átfedések:** `assessment.fajdalompontok` ↔ `pain_point` entitások,
  `charter.stakeholderek` ↔ `stakeholder` entitások. Mindkettő BENT — a
  duplikáció nem réteg-kérdés, hanem a 4.3 dedup-témája.

---

## 7. Mi következik (a leltár alapján)

1. **Szűrés kiterjesztése a NEM VITATOTT esetekre:** 50 új mező-kivétel +
   5 entitás-block-type (`build_component`, `prompt_item`, `eval_case`,
   `eval_criterion`, `epic`). ✅ kész (969182f)
2. **A határesetek ÉRINTETLENEK maradnak**, amíg Máté nem dönt.
   A H-6 (`artifact`) 2026-08-13-án eldőlt → kivezetve; marad
   **16 mező-határeset + 5 entitás-határeset (H-1…H-5)**.
3. **A 2.1 `knowledge_catalog` nézet változatlan** — a traceability alapja;
   a szűrés a 4.2 fogyasztói szintjén él. Adat nem törlődik.

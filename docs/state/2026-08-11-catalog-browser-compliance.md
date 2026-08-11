# Backend compliance check — Katalógus-böngésző újraépítés (17 · 4.2 UI)

**Dátum:** 2026-08-11 · **Branch:** `dev` · **Referencia:** AICON_17 Tudáselem-katalógus design-HTML (1a/1b/1c)

## (1) A jelenlegi CatalogAdmin.tsx — mi újrahasznosítható?

**Változatlanul újrahasznosítható (nem UI):**
- Mind a 4 server action: `labelCatalogBatchAction` (kötegelt futtatás — a timeout-fix
  szerint), `relabelItemAction`, `saveLabelsAction`, `approveDoubtfulAction`.
- A kliens-oldali kötegelt `runLabeling` ciklus (skip-lista + haladás).
- A `LabelEditForm` (7 mezős szerkesztő) — az új felületen a „Besorolás javítása"
  akció mögé kerül (olvasó-panel + felülvizsgálat „Módosítás").
- A `page.tsx` adatbetöltés + anchorKey-merge váza (bővítendő, l. (2)).
- `candidateOf`, `Feedback`, DIM_ORDER, enum-listák.

**Lecserélendő (UI):** a lapos chip-soros böngésző, az inline csoportos
felülvizsgálati szekció, a szűrősor. Új: sor-anatómia (állítás dominál),
hatókör-csoportok, olvasó-panel, fókuszált felülvizsgálat-mód, sűrűség-váltó,
alapérték-elnyomás, üres/nulla-találat állapotok.

## (2) EREDET (projekt · fázis · forrás-dokumentum · interjúalany) — elérhető? ★

**IGEN, migráció nélkül** — kliens-oldali (server-component-beli) merge-dzsel:

| Design-mező | Forrás | Státusz |
|---|---|---|
| projekt (ügyfél · projekt) | `projects.name` + `clients.name` (client_id FK) | ✓ (1 plusz lekérdezés) |
| fázis | `knowledge_catalog.phase` | ✓ (már betöltve) |
| forrás-dokumentum | `knowledge_catalog.source_input_ids[]` → `input_items` — a megjelenítési konvenció LÉTEZIK: cím = `input.type`, típus = `deriveSourceKind()` (a Források oldal pontosan így csinálja) | ✓ (1 plusz lekérdezés) |
| interjúalany | `input_items.stakeholder_source_id` → `stakeholders.name` (0006 — a forrás szintjén), fallback: `knowledge_metadata.source_person_stakeholder_id` (a címkézett attribúció) | ✓ |
| dátum | `input_items.created_at` (a forrásé), ill. `approved_at` | ✓ |
| artifact_field sorok eredete | `artifact_id` → `artifacts.type` + `field_key` | ✓ (1 plusz lekérdezés) |

Szükséges plusz olvasás a page.tsx-ben: `input_items`, `artifacts`, `clients`
(mind projekt-szűrve) — **csak olvasás, a 4.1 írás-réteg érintetlen.**

**Eltérés a designtól (nem STOP, jelentendő):** a design egy TÖBB-projektes
„Könyvtár → Tudáselemek" nézetet mutat („248 elem · 4 projekt", projekt-szűrő
chip). A katalógus admin-felülete ma projekt-szintű
(`/project/[id]/catalog`), és a globális `/library` route placeholder egy
másik csomag területe. **Ez a csomag a meglévő helyén építi újra a felületet**;
az eredet-sor a projektet is mutatja (a designnal egyező formában), a
projekt-szűrő kimarad (egy projekt van). A globális könyvtár-nézet →
parkoló-lista.

## (3) Bizonyíték-szöveg + szavazatmegoszlás — elérhető? ★

**IGEN.** `knowledge_label_signals.signals[dim]` (4.2-ben verifikálva):
`evidence` (szó szerinti idézet) + `evidence_verbatim` flag, `votes`
(címke→darab), `samples` (N), `confidence`, **`reason`** — ez utóbbi az
„emberi nyelvű indoklás, miért kétes" (a címkéző LLM egymondatos indoka; a
mock determinisztikus indokokat ad, valós LLM-nél a prompt kéri).

**Ami NINCS (nem találunk ki adatot):**
- Bekezdés-szintű lokátor („átirat 41. bekezdés") — az idézet megvan, a
  pozíció nincs tárolva → az olvasó-panel az idézetet mutatja lokátor nélkül;
  a „Megnyitás a forrásban" a Források oldalra visz.
- „KE-0142" jellegű ember-olvasható azonosító — nincs ilyen számozás →
  nem jelenítünk meg kitalált ID-t.
- „Utolsó kinyerés" időbélyeg — kinyerés-futás rekord nincs; a legutóbbi
  `labeled_at` (signals) mutatható „utolsó címkézés"-ként.

## (4) A `nincs címke` technikai sorok (architektura, as_is_attekintes, …)

Ezek a 0015 katalógus-nézet **artifact_field cédulái**: jóváhagyott artefaktum-
mezők, ahol a nézet `title = field_key` (nyers kulcs, pl. `beavatkozasi_pontok`)
és `excerpt = a mező TARTALMA` (≤240 char). Tehát **valódi tudáselemek rossz
megjelenítéssel** — a tartalom (az állítás) el van rejtve, a technikai kulcs
látszik címként.

**Nem kiszűrni kell őket, hanem az új sor-anatómia magától megjavítja:** az
állítás-szöveg (= excerpt, a mező tartalma) dominál, a `field_key` + az
artefaktum típusa az EREDET-sorba kerül („Projekt-charter v1 · cél mező").
Üres tartalmú mezőnél fallback a kulcs-név (nem fordul elő confirmed mezőnél,
de kezelt).

## További design-elem → valóság megfeleltetések

- **„Elem elvetése"** (1b akciósor): a katalógus jóváhagyott entitások derivált
  nézete — elem-törlés nem 4.2-képesség, és a csomag billentyű-specifikációja
  (1-5/⏎/S/⌫) sem tartalmazza → kimarad.
- **Konfliktusok fül**: helyhagyó, letiltott fül — NEM épül meg (4.3 terület).
- **Üres-katalógus CTA** („Kinyerés indítása"): nálunk a cédulák jóváhagyással
  keletkeznek a fázis-munkaterületeken → a CTA a Forrásokra és a
  munkaterületre mutat, a forrás-darabszám valós (`input_items` count).
- **Hatókör-csoportosítás**: `knowledge_metadata.scope` (szabad címke) szerint;
  scope nélküli / címkézetlen elemek „Besorolatlan" csoportba.
- **Alapérték-elnyomás**: adat-vezérelt — az aktuális szűrésben többségi
  érték dimenziónként számolva; csak az eltérés kap chipet (a részletpanel
  mindent mutat, a hiányt is).

## Konklúzió: NINCS STOP

A design minden ADAT-premisszája teljesül meglévő táblákból, migráció nélkül;
a fenti 4 kisebb eltérés (multi-projekt nézet, KE-ID, bekezdés-lokátor,
elem-elvetés) adat-hiány miatti tudatos adaptáció, a záró jelentésben is
szerepelni fog.

**Környezeti megjegyzés:** a sandbox-konténer újraindult a csomagok között — a
lokális verifikációs harness (PG16 user+adatkönyvtár, PostgREST-shim,
node_modules) elveszett, a verifikáció előtt újraépítendő (a repo érintetlen).

# Epic 3 · 3.3+3.4 — backend compliance check (valós leltár)

**Dátum:** 2026-07-22 · **Branch:** `dev` · **Spec:** Refounded_Epic3_33_34_spec v0.1
**Eredmény: NINCS STOP-ot indokló ellentmondás.** Három spec-premissza a valós adatmodelltől eltér — mindhárom a tervezési szabadságon belül, adat-hamisítás nélkül feloldható; lentebb tételesen, a kódolási döntéssel együtt.

---

## (1) A tool-sáv kártyáinak mai szerkezete + bővítési pont

- **Készlet:** `phaseTools(phase)` (`src/lib/phases/tools.ts:86`) — statikus `PhaseToolDef` rekordok: `id · nameKey · descKey · open ∈ {route, heatmap, zone} · path/zone/anchor · badge`. P1: heatmap + stakeholder_matrix (ma `open:"zone"` → ② + `#stakeholders` görgetés) + process AS-IS; P2: process TO-BE + requirements + solution; P3: builddoc + goldenset.
- **Kártya:** `PhaseToolbar` → `ToolCard` (`src/components/PhaseToolbar.tsx`, **kliens-komponens**) — ma név + leírás + „Megnyitás →", nyitás-fajta szerint Link / `HeatmapFocusTrigger` / zóna-gomb. A fájl fejléce explicit mondja: „a gazdag előnézetek a B3 dolga" — ez a csomag AZ.
- **Bővítési pont:** a `PhaseToolbar` már ma is kap szerver-számított adatot (`heatmap` prop a fókusz-modálhoz) a `PhaseWorkspace`-ből (async szerver-komponens, `PhaseWorkspace.tsx:1225`). A természetes bővítés: a szerver oldalon renderelt **előnézet-slot** (`previews: Record<toolId, ReactNode>` prop) — az RSC-határ átengedi a szerver-renderelt elemet kliens-prop-ként; az SVG-előnézetek így szerver-komponensek maradnak (nulla kliens-JS, nem-interaktív F7 konstrukció szerint), a `ToolCard` csak egy 112px-es `tviz` területbe illeszti őket a név fölé.

## (2) Előnézet-adatok lekérdezhetősége toolonként

A fázis-oldal betöltésekor a `PhaseWorkspace` MA ezt tölti: `input_items`, `artifacts` (fázis-típusok), `stale_acks`, és CSAK P1-en: `pain_points`, `use_cases`, `stakeholders`, `pain_point_stakeholders`. **Nem tölti:** process_maps, requirements, acceptance_criteria, solution_components, component_options, component_links, build_components, golden_sets, eval_cases.

| Tool | Kell | Ma betöltve? | Új lekérdezés |
|---|---|---|---|
| Hőtérkép | use_cases (score_value, score_feasibility, quick_win, risk, list_status) | ✅ (a `heatmapPoints` már számolva, `PhaseWorkspace.tsx:391`) | — |
| Befolyás×érintettség | stakeholders (influence_score, impact_score, state) | ✅ P1-en | — |
| Folyamattérkép AS-IS | process_maps (kind=as_is, legfrissebb verzió) + nodes jsonb (`graphFromJson`, `lib/processmap/parse.ts:190`) | ❌ | ✅ 1 query |
| Folyamattérkép TO-BE | process_maps (to_be + as_is legfrissebb, lépésszám-kontraszt) | ❌ | ✅ (ugyanaz a query fedi) |
| Követelmények | requirements (level: business/stakeholder/system, state) + acceptance_criteria darabszám | ❌ | ✅ 2 query |
| Opció-összevető | solution_components + component_options (`criteria_values` → `parseCriteriaValues`, `is_selected`, `criterionKeys` — `lib/solution/model.ts`) | ❌ | ✅ 2 query |
| Megoldás-tervező | build_components (state, seeded_at, origin_component_id) + component_links (build-owner → tobe_node) | ❌ | ✅ 2 query |
| Golden set | golden_sets (pass_threshold) + eval_cases (final_verdict → `passStats`, `lib/goldenset/model.ts:130`) | ❌ | ✅ 2 query |

Minden új lekérdezés read-only, eq-szűrős (shim-/PostgREST-kompatibilis, a `lib/catalog` mintája szerint), és fázis-feltételes (P1 csak az AS-IS-t, P2 a process+req+solution-t, P3 a build+goldenset-et tölti). Új adatgyűjtő modul: `src/lib/phases/preview-data.ts` (server-only).

## (3) A stakeholder-részletlap mátrix-hero — mi emelhető ki

- **Tiszta lib, változtatás nélkül újrahasznosítható:** `src/lib/stakeholders/matrix.ts` — `Quadrant`, `MATRIX_THRESHOLD = 3.5`, `isHigh()`, `scorePct()` (10–90% padded skála), `quadrant()`, `hasMatrixPoint()`. Az összesített nézet ugyanebből számol — nulla új küszöb-logika.
- **A `MatrixCard`** (`src/components/StakeholderPage.tsx:115`) egy-pontos (a saját stakeholder + inline score-szerkesztő) — egészben NEM emelhető át, de a vizuális nyelvtana (negyed-tintek `#FAF4E8/#EEF3FE/#F4F5F8/#EAF1F7`, osztó `#E0E3EC`, negyed-címke színek, monogram-pirula fehér gyűrűvel + halóval, elforgatott tengelycímkék) a formanyelv-horgony az összesítetthez.
- **i18n kész:** `stakeholders.quadrant.*.label`, `axisInfluence`, `axisImpact` léteznek — a spec „részletlap-hero terminológiájával konzisztensen" követelménye kulcs-újrahasználattal teljesül.
- **Kattintás-cél létezik:** `/project/[id]/stakeholder/[stakeholderId]` route.
- **Átfedés-realitás:** a score-ok 1–5 EGÉSZEK → az azonos pontszámú stakeholderek pozíciója PONTOSAN egybeesik (25 lehetséges cella). Az átfedés-kezelés tehát nem él-eset, hanem alapkövetelmény — a döntés: cella-csoportosítás (azonos (befolyás, érintettség) → egy cellába), a cellán belül a pirulák sortörve egymás mellett — minden pirula látható és kattintható, "+N" csonkolás nélkül (F5).

## (4) lockWrap() + Tab-fókusz zárása (FIX-1)

- Ma: `lockWrap()` (`PhaseWorkspace.tsx:140`) `pointer-events-none select-none opacity-60` + `aria-disabled` — a Tab-fókuszt NEM zárja (a 3.2 záró jelentésben dokumentált korlát).
- **Stack-támogatás:** React **19.2.7** (package.json) — a React 19 az `inert` HTML boolean attribútumot natívan támogatja prop-ként (`<div inert>`). Az `inert` a teljes alfát kiveszi a fókusz-sorrendből ÉS az a11y-fából — pontosan a FIX-1 kérése.
- **A navigációs linkek** (szerkesztő megnyitása, verzió-előzmény) a 3.2 konstrukciója szerint a lockWrap-eken KÍVÜL élnek → az `inert` hozzáadása őket nem érinti; külön munka nem kell.

## (5) Tool-szintű elavult-jelzés — mi derivált honnan

A 3.2 jelölő-rétege artifact-/entitás-szintű, **tool-szintű jel MA SEHOL nincs** — minden tool-⟳ derivált (spec §5 puha kapu). A meglévő primitívek (`lib/staleness.ts`): `sourceUpdatedSince` (forrás-verziócsoport), `originDriftSince` (P2-eredet), `docStaleSince`, `renderStaleSince`, `activeStaleSince` (ack-szűrés).

| Tool | ⟳ jel | Deriválás |
|---|---|---|
| Hőtérkép | forrás frissült | use_cases `sourceUpdatedSince`, ack-szűrve (`activeStaleSince` + a már betöltött stale_acks) |
| Befolyás×érintettség | forrás frissült | stakeholders ugyanígy |
| AS-IS | forrás frissült | process_maps.source_input_id (`[id]`-ként a `sourceUpdatedSince`-be — a lib doksija kimondottan említi ezt a hívásmódot) |
| TO-BE | AS-IS változott | derivált: legfrissebb as_is `updated_at` > legfrissebb to_be `updated_at` |
| Követelmények | forrás frissült | requirements `sourceUpdatedSince` |
| Opció-összevető | forrás frissült | solution_components `sourceUpdatedSince` |
| Megoldás-tervező | P2 változott | `originDriftSince` a build_components-en (a jelölő-réteg origin_drift jelének tool-aggregátuma) |
| Golden set | forrás frissült | eval_cases `sourceUpdatedSince` |

Ahol a derivált jel nincs → nincs ⟳ (nincs hamis pozitív). A nem-P1 tábláknál ack-mechanizmus ma nem ír sorokat → a szűrés no-op, a nyers derivált jel az őszinte állapot.

## Spec-premissza eltérések (nem STOP — döntéssel feloldva)

1. **„AS-IS: fájdalompont-kötések"** — a sémában NINCS node↔pain_point kötés (a `component_links.target_type='pain_point'` a komponens→fájdalompont él, nem a folyamat-lépésé). A folyamat-lépés saját „problémás" jele a node-ok **`open_points`** listája (blocker/important/clarify — `lib/processmap/model.ts:23`). **Döntés:** a lépésenkénti borostyán körjelölő = az adott node open_points-száma; a sarok-főszám = Σ nyitott pont; a felirat őszintén „nyitott pont" (i18n), nem „fájdalompont". A formanyelv (lépéslánc + borostyán jelölő) változatlan; adat-hamisítás nincs.
2. **„TO-BE: áthúzott kiváltott lépések"** — perzisztált AS-IS↔TO-BE „kiváltás"-leképezés NINCS (a #10 compare vizuális, nem él-adat); cím-egyeztetéses találgatás = fabrikáció. **Döntés:** a fő lánc a TO-BE valós lépései (✦ = `ai_intervention` típus, zöld = `control_hitl`), alatta halvány-áthúzott sor a VALÓS AS-IS lépésekből („előtte" kontraszt), sarok-főszám „N → M lépés" (valós darabszámok). Az előtte-utána formanyelv megmarad, kiváltás-tényt nem állítunk lépés-párokra.
3. **Galéria-feliratok „USE CASE VÁLTOZOTT" / „KRITÉRIUM VÁLTOZOTT"** — a requirements-nek nincs use_case-hivatkozása, kritérium-változás jel nincs perzisztálva → e két konkrét ok-címke nem derivált. **Döntés:** e toolokon a derivált jel a forrás-frissülés; ha nincs, nincs ⟳ (spec §5 explicit engedi).

## Kódolási terv-következmények (a fenti leltárból)

- Új: `src/lib/phases/preview-data.ts` (server-only adatgyűjtő) + `src/components/ToolPreviews.tsx` (8 SVG szerver-komponens, 380×112 viewBox a kanonikus terv szerint) + `src/app/project/[id]/stakeholder-matrix/page.tsx` (3.4 route — a 3.1 route-tool mintája).
- Módosul: `PhaseToolbar` (előnézet-slot + ⟳/főszám sor), `PhaseWorkspace` (preview-adat betöltés + slot-render), `lib/phases/tools.ts` (STAKEHOLDER_MATRIX `open:"zone"` → `open:"route", path:"/stakeholder-matrix"`), `lockWrap()` (`inert`), i18n (tools.preview.* névtér HU/EN).
- A `criterionTarget` kapu-navigáció NEM változik (egyetlen kritérium sem céloz stakeholder_matrix toolt).

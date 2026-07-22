# Csomag B1 — Backend compliance check (navigációs váz)

**Dátum:** 2026-07-22 · **Branch:** `dev` · **Típus:** kötelező előzetes leltár (kód nem változik ebben a lépésben)
**Cél:** a B1 (tool-sáv · stepper mint zóna-váltó · kapu-navigáció) implementáció TÉNY-alapja — hol élnek ma a tool-belépők, hogyan renderelődik a négy zóna, milyen alakú a kapu-feltétel akció-leírója.

---

## 1. Tool-belépők ma (hol élnek a toolok)

A spec premisszája „a toolok a zónák belsejében élnek" a valóságban **csak a hőtérképre igaz** — a többi tool a GLOBÁLIS oldalsávból (route) érhető el:

| Tool (spec) | Fázis | Mai megvalósulás | Belépő |
|---|---|---|---|
| Hőtérkép | P1 | `WorkbenchHeatmap` INLINE a **workbench zóna** jobb oszlopában (`PhaseWorkspace.tsx` ~788) — compact SVG-előnézet + fókusz-mód modal | oldalsáv `…/phase/P1#heatmap` (nincs `id="heatmap"` a DOM-ban ma → az anchor nem görget sehová) |
| Befolyás × érintettség | P1 | Csak a **stakeholder-részletlapon** (`StakeholderPage.tsx` HERO, „Befolyás × Érintettség mátrix") — NINCS fázis-szintű nézet, NINCS mátrix-landing route | — (csak `…/stakeholder/[id]` detail) |
| Folyamattérkép AS-IS / TO-BE | P1 / P2 | Külön route `…/process` | oldalsáv `nav.processMap` |
| Követelmények | P2 | Külön route `…/requirements` | oldalsáv `nav.requirements` |
| Opció-összevető | P2 | Külön route `…/solution` | oldalsáv `nav.solution` |
| Megoldás-tervező (Solution Builder) | P3 | Külön route `…/builddoc` | oldalsáv `nav.builddoc` |
| Golden set & riport | P3 | Külön route `…/goldenset` | oldalsáv `nav.goldenset` |

**Lelet:** ma NINCS fázis-szintű „tool-sáv". A toolok a globális projekt-oszlopban (`ProjectContextNav.tsx`) sorolódnak, fázis-függetlenül. Az EGYETLEN, zónán belül renderelt tool a **hőtérkép** (workbench). A „Befolyás × érintettség" fázis-tool jelenleg **nem rendelkezik** relokálható, önálló implementációval (a mátrix csak a stakeholder-detail HERO-ban él).

## 2. A négy zóna renderelése

- `PhaseWorkspace` (server) négy panelt épít: **inputPanel · workbenchPanel · outputPanel · gatePanel**, és átadja a `ZoneFlowStrip`-nek (`WorkspaceShell.tsx`, **client**).
- A `ZoneFlowStrip` a négy zóna-kártyát (①②③④) VÍZSZINTES flow-sávként rendereli, és **mind a négy panelt kirendereli**, de az inaktívat `hidden`-nel rejti; az aktív zóna `useState`-ből jön. → **„egyszerre egy zóna, lapújratöltés nélkül" MA IS MŰKÖDIK** (kliens-oldali fül-mechanizmus).
- A megnyitáskori zónát ma a `PhaseWorkspace` `defaultZone` számolja: `open || nincs forrás → input`, `gate_pending → gate`, egyébként `workbench`. **Ez nem az F4** (P3-nál ma is `workbench`, nem `output`).
- A `ZoneFlowStrip` az aktív állapotot BELSŐLEG tartja (`useState`) — a tool-sáv és a kapu-gombok NEM tudják ma kívülről váltani. A B1-hez a zóna-állapotot FÖLÉ kell emelni (közös provider), hogy a stepper fölötti tool-sáv és a gate-gombok is válthassanak.
- A `PhaseStepperV2` (a fejlécben, P0→P6 FÁZIS-navigáció) **más dolog**, mint a négy zóna-kártya — a B1 nem érinti.

## 3. A kapu-feltétel akció-leírója

- `EvaluatedCriterion` = `PhaseCriterion { id, mode, weight, typeKey?, interim? }` + `satisfied` (`service.ts`). A kritériumok fázisonként a **típus-konfigból** származnak (`deliverableCriteria` — minden [K] deliverable Approved-ja egy KEMÉNY kritérium) + a P1 `quick_win_on_shortlist` entitás-kritérium + P0 puha `charter_approved`.
- **NINCS ma akció-cél mező** (`proc`/`out`/`tool`), és a gate-panel a kritériumokat sima checklist-ként rendereli **akció-gomb nélkül** (`PhaseWorkspace.tsx` gatePanel). A spec „mai stepper-zóna célok (proc, out)" a DESIGN-modellre utal, nem meglévő kódra — a B1-c vezeti be a célt + gombot.
- A célt a kritériumból DERIVÁLOM (nincs séma-változás): a `deliverable_approved:<typeKey>` kritérium célja a ③ Kimenet zóna (`out`), KIVÉVE a modul-szinkronizált (D3, `moduleOwned` mezős) deliverable-öket, amelyek a saját tooljukhoz visznek: `Megoldás-dokumentáció → Megoldás-tervező (/builddoc)`, `Tesztriport → Golden set & riport (/goldenset)`. A P1 `quick_win_on_shortlist` → ② Feldolgozás (a use case-ek pontozása/shortlistje ott történik); `charter_approved` → ③ Kimenet.

## 4. Döntések a B1-hez (a fenti tényekből, a scope-on belül)

1. **Zóna-állapot fölé emelése:** új `PhaseZones` kliens-wrapper birtokolja az aktív-zóna állapotot és egy `ZoneNav` contextet ad; a `ZoneFlowStrip` ebből olvas (controlled). Így a tool-sáv és a gate-gombok is válthatnak zónát — lapújratöltés nélkül.
2. **Hőtérkép relokálása:** a `WorkbenchHeatmap` VÁLTOZATLAN tartalommal átkerül a workbench zónából a tool-sávba (spec: „csak áthelyez · a tool-kártyák tartalma változatlan · az előnézetek cseréje B3"). A workbench 2-oszlopos rácsa 1-oszloposra egyszerűsödik (a tool eltávolításának minimális következménye).
3. **Befolyás × érintettség:** önálló mátrix-nézet a kódban NINCS (csak stakeholder-detail HERO). A B1 nem épít újat (scope). A tool-sáv kártyája a stakeholder-szerkesztő felületére visz: ② Feldolgozás zóna + görgetés a Stakeholderek szekcióhoz (`#stakeholders`). Az önálló mátrix-tool-nézet B3.
4. **F4 default-zóna:** `phaseHasSourceExtractor(phase)` DERIVÁLT jel — a fázisnak van-e „tiszta D1" (nem entitás-forrású, nem modul-mezős) field-extract típusa, vagy P1 (entitás-gyártók). P0/P1/P2 → van (②); P3 → nincs (mind D3 modul-szinkron) → ③. A gate_pending→gate default megszűnik (F4 kimondottan a forrás-jelenlétre és a ② természetére alapoz; a kapu egy kattintásra elérhető marad).
5. **Kapu-navigáció:** a cél a kritériumból derivált (3. blokk); zóna-cél → `go(zone)` (kliens váltás), tool-cél → `Link` a tool route-jára.

## 5. Nem érintett (kényszer)

Séma/entitás-réteg (nincs migráció); a zónák TARTALMI szerkezete (② forráskinyerők, ③ dokumentum-elrendezés) — B2; a nevezék kód-szinten, elavulás-jelölők, „hol van használva" — B2; a tool-előnézetek vizuális tartalma és a négy állapot — B3; `PhaseStepperV2` fázis-navigáció; P4–P6 (a tool-sáv szerkezete skálázódik rájuk, de a B1 csak P0–P3-at tölt).

*Ez tényfeltárás + döntés-rögzítés. A kód a következő lépésekben változik.*

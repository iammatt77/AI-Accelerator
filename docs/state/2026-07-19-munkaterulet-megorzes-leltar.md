# Megőrzés-leltár — P0–P3 fázis-munkaterület (mi él MA a UI-on) (2026-07-19)

**Típus:** read-only leltár. **Nincs kód-, séma- vagy migráció-változtatás.** Branch: `dev`. Ez a report a diff-alap: ehhez mérjük a hibás redesign-mockupot, és ebből írjuk a design pontos módosító-utasítását.
**Cél:** hogy a redesign során SEMMI ne essen ki, ami ma funkcionál. Inkább túl részletes.
**Ground truth: a kód.** Ez a leltár **felváltja és magába olvasztja** a korábbi `2026-07-19-extract-gomb-audit.md`-t (a ✦-kérdés itt egy oszlop).

**Jelölés:** ✦ Kivonatolás = forrás→mező/besorolás (LLM `extract*`/`suggest*`). ✦ Generálás = megerősített mezők→body (`generateBody`). „E1" = AI javasol (ai_suggested) → ember megerősít (confirmed)/szerkeszt (manual)/elvet. Minden deliverable státuszlánca **Draft → In review → Approved** az `ArtifactEditor`-on át (univerzális, l. §5).

---

## 0. Univerzális elemek (minden fázisban azonos)

### Fázis-oldal keret — `app/project/[id]/phase/[phase]/page.tsx`
- Breadcrumb `← projektnév` → cockpit; V2 szegmens-stepper (`PhaseStepperV2`).
- Állapotfüggő nézet: **locked** (lakat + `goToPrev`), **completed** (olvasó + kapu-döntés + `PhaseDocumentTiles` + `DecisionHistory`), **open/in_progress/gate_pending** (a négyzónás `PhaseWorkspace` + `PhaseDocumentTiles` + `DecisionHistory`).
- `StartPhaseForm` (`PhaseGateForms.tsx:24`): open→in_progress, `startPhaseCta`. Nem LLM.

### Négyzónás héj — `PhaseWorkspace.tsx` + `WorkspaceShell.tsx`
`ZoneFlowStrip`: 4 stat-kártya (① input · ② workbench · ③ output · ④ gate) fülekként, egyszerre egy panel; summary-sor + „Next" CTA (P1-nél `#pain-points`-ra). Üres állapot (P1, nincs input): csak ① él (dashed), ②③④ zárolt unlock-szöveggel + „Next best step" sáv.

### ① Bemenet (minden fázis) — `inputPanel` (`PhaseWorkspace.tsx:479`)
| Elem | Komponens | Gombok/akciók | Funkcionális elemek | AI | ✦ kell? |
|---|---|---|---|---|---|
| Forrás-lista | `PhaseWorkspace.tsx:487` | — | számozott `[i]` `input_items` sorok: típus + **fázis-címke pill** + dátum | nincs | **nem** |
| Bemenet-hozzáadás | `PhaseInputForm` (`WorkspaceForms.tsx:49`) | `addCta` (submit) | cím + `rawText` (kötelező) mező; „fázis-címke: {phase}" | nincs (`addPhaseInput` — DB insert + `logDecision`) | **nem** |

### ④ Kapu (minden gate-es fázis) — `gatePanel` (`PhaseWorkspace.tsx:753`)
| Elem | Komponens | Gombok/akciók | Funkcionális elemek | AI | ✦ kell? |
|---|---|---|---|---|---|
| Kritérium-checklist | `PhaseWorkspace.tsx:765` | — | teljesült/nyitott ikon + `criterionLabel` + **interim badge** (P3–P5) + állapotszöveg | nincs (`loadPhaseBoard` derivált) | **nem** |
| Kapu-zárás | `GateCloseForm` (`PhaseGateForms.tsx:47`) | `closeGateCta` (submit) | kötelező `reason` textarea + kötelező megerősítő checkbox (poka-yoke); `temporaryBadge` ha kézi zárású | nincs (`closeGate`) | **nem** |
| P6-branch | `PhaseWorkspace.tsx:753` | — | `noGate` üzenet (nincs kapu) | — | — |

### ③ Kimenet-keret (minden fázis) — `OutputCard` (`PhaseWorkspace.tsx:323`)
| Elem | Gombok/akciók | Funkcionális elemek | AI | ✦ kell? |
|---|---|---|---|---|
| Deliverable-kártya | **✦ Generálás** (`GenerateBodyForm`, `generateCta` + felülírás-poka-yoke checkbox) · **Szerkesztő megnyitása** (`openEditor` → `/artifact/:id`) | StatusPill (státusz·v) · teljesség-sáv (`filled/required`) · verzió-történet linkek | **✦ Generálás = LLM** (`generateBody`, megerősített mezők→body) | ✦ **Generálás** igen; ✦ **Kivonatolás** l. ② |
| entity-sourced deliverable (P1 shortlist) | **`generateShortlistCta`** (`GenerateShortlistFieldsForm`) | 5 mező confirmed-ként az entitásokból | **nincs** (deterministic `generateShortlistFromEntitiesAction`) | **nem** |

### ArtifactEditor (a szerkesztő — minden deliverable, §5) röviden itt: státuszlánc-akciók (Review-ra küldés / Vissza draftba / Approve [kemény hiány-blokk] / Új verzió), mező-E1 (Confirm/Edit/Dismiss), Export (approved-only .md).

---

## 1. P0 — Foundation

### ② Munkaeszközök — generikus mező-kivonatolás (nincs dedikált tool-modul)
| Elem | Route/komponens | Gombok/akciók | Funkcionális elemek | AI-kivonatolás | ✦ Kivonatolás kell? |
|---|---|---|---|---|---|
| Projekt-charter mező-munka | `FieldWorkBlock`/`ExtractForm` (`PhaseWorkspace.tsx:426`, `WorkspaceForms.tsx:99`) | **`extractCta` (✦ Kivonatolás)** · mezőnként Confirm/Edit/Dismiss (`FieldCard`) | mező-kártyák E1-állapottal (ai_filled/confirmed/manual/missing), forrás-`[n]` chipek, teljesség-pill | **igen** — `extract(sources,typeDef)` → mezők | **igen** |
| Engagement-terv mező-munka | ua. | ua. | ua. | **igen** — `extract` | **igen** |
| Kickoff-agenda mező-munka | ua. | ua. | ua. | **igen** — `extract` | **igen** |

### ③ Kimenet — deliverable-ök
| Deliverable | Kapu-hordozó | Státuszlánc | Akciók |
|---|---|---|---|
| **Projekt-charter** | [K] (P0 PUHA kapu: charter_approved) | Draft→In review→Approved | ✦ Generálás · Szerkesztő · verzió-történet |
| Engagement-terv | — | Draft→In review→Approved | ua. |
| Kickoff-agenda | — | Draft→In review→Approved | ua. |

### ④ Kapu: `charter_approved` (auto, PUHA). ① Bemenet + ④ Kapu: l. §0.

---

## 2. P1 — Felmérés (a leggazdagabb ② zóna)

### ② Munkaeszközök — entitás-toolok (workspace-beágyazott) + Hőtérkép + Értékelők
Konténer: `PhaseWorkspace.tsx:517` (P1-ág). Bal: entitás-oszlopok; jobb: hőtérkép. Alul: `FieldWorkBlock` a Felmérési riportra.

| Tool | Route/komponens | Gombok/akciók | Funkcionális elemek | AI-kivonatolás | ✦ Kivonatolás kell? |
|---|---|---|---|---|---|
| **Fájdalompontok** | `PhaseWorkspace.tsx:522`, `EntityForms.tsx` | **`extractPainsCta` (✦)** · sor-szint: ✓`confirmCta` / ×`dismissCta` / ✎`editCta` · `addPainCta`(+`addCta`) | PP-nn E1-kártyák (ai_suggested vs confirmed csoport), `SeverityPill`, idézet-blockquote, forrás-`[n]`, `ShowMore`/`CollapsedGroup`, **pain↔stakeholder kötő** (`PainStakeholderBinder`, `bindPainsCta`) | **igen** — `extractPainPoints` | **igen** |
| **Use case-ek** | `PhaseWorkspace.tsx:606`, `EntityForms.tsx` | **`deriveCta` (✦)** · ✓`confirmCta`/×`dismissCta`/✎`editCta` · **`saveScoreCta`** · **`shortlistCta`** · **`excludeCta`**(+indok) · `addUseCaseCta` | UC-nn E1-kártyák; **pontozás 1–5** (`ScoreSelect` érték + megvalósíthatóság), **kockázat-selector**, **quick-win checkbox**, list-status pill, **use case↔pain eredet-chipek**, forrás-`[n]`, `EvaluatorBadges` | **igen** — `deriveUseCases` (a *pontozás* NEM AI) | **igen** (a toolra); a pontozásra **nem** |
| **Hőtérkép (érték×megvalósíthatóság)** | `WorkbenchHeatmap`/`UseCaseHeatmap.tsx` | **`focusMode` (⛶)** · pont-csempe/legend/unscored sorok → use-case kártyára ugrás · fókusz-modál `filterAll`/`filterShortlist` toggle + `exitFocus` | 2×2 kvadráns (Strategic/QuickWin/Avoid/Opportunistic), pont-csempék (számozott, filled=shortlist, kockázat-gyűrű L/M/H, **AI Act ▲ figyelmeztetés**), tengelyek (feasibility×value), számozott index-lista, unscored-panel, fókusz-modál (read-only) | **NINCS** — `score_value`/`score_feasibility` **kézi** (`scoreUseCaseAction`, 1–5); a hőtérkép tisztán számított/prezentációs | **NEM** |
| **Értékelők (#7b)** | `EvaluatorForms.tsx`, `evaluator-actions.ts` | per use case: **`saveCta`** ×3 (AI-alkalmasság / adatérettség / AI Act) | 3 `<details>` kérdőív-panel (select/checkbox), **AI Act élő javasolt-kategória tükör** + warn-notice + emberi `confirmedCategory` select + jogi disclaimer; összegző badge-ek | **NINCS** — kérdőív + determinisztikus szabály (`suitabilityVerdict`/`readinessLevel`/`suggestAiActCategory`), „EMBERI kitöltés, LLM nélkül" | **NEM** (✦ Kivonatolás értelemben) |
| **Felmérési riport mező-munka** | `FieldWorkBlock`/`ExtractForm` | **`extractCta` (✦)** · Confirm/Edit/Dismiss | mező-kártyák E1, forrás-`[n]`, teljesség | **igen** — `extract` | **igen** |

### ③ Kimenet — deliverable-ök
| Deliverable | Kapu-hordozó | Státuszlánc | Akciók / megjegyzés |
|---|---|---|---|
| **Priorizált use case-shortlist** | [K] (P1 KEMÉNY, entitySourced) | Draft→In review→Approved | **`generateShortlistCta`** (entitásokból, NEM ✦ Kivonatolás) + ✦ Generálás; a generikus extract szerveroldalon **tiltott** (`entitySourcedHint`) |
| Felmérési riport | — | Draft→In review→Approved | ✦ Generálás · Szerkesztő |

### ④ Kapu: shortlist Approved **+** megerősített quick win a shortlisten (KEMÉNY, `quick_win_on_shortlist`).

### Dedikált P1-referencia route
- **Stakeholder-nézet** `/stakeholder/[id]` (kanonikus a P1 stakeholder-tool megerősített soraiból + cockpit-belépő): stratégia, pain-kötések, forrás. Nem LLM a nézet.

---

## 3. P2 — Business case & terv (dedikált tool-modulok külön route-on)

> A P2 „munkaeszközei" NAGYRÉSZT külön route-okon élnek (Folyamattérkép/Követelmények/Megoldás-terv), NEM a fázis-workspace ② zónájában (a workspace ② itt a generikus `FieldWorkBlock` + a P2 strukturált kalkulátorok a szerkesztőben). A design-agentnek: ezek P2-toolok, csak a hely külön.

### ② Munkaeszközök — dedikált tool-modulok
| Tool | Route/komponens | Gombok/akciók | Funkcionális elemek | AI-kivonatolás | ✦ Kivonatolás kell? |
|---|---|---|---|---|---|
| **Folyamattérkép** (AS-IS a P1-ből, **TO-BE a P2**) | `/process`, `/process/[mapId]`, `ProcessMapViewer.tsx`, `ProcessGenPanels.tsx`, `ProcessChatDrawer.tsx` | **`generateAsisCta`/`generateTobeDocCta` (✦)** · **`suggestTobeCta` (✦)** · nézet-toggle AS-IS/TO-BE/⇄ · Jelmagyarázat · Teljes térkép · Nyers leirat · **✦ Chat** · node-lépés/branch/next-step/breadcrumb/utolsó döntés/újraindítás · diff „Eredeti/Szerkesztett" · **✓ jóváhagyás** / **Új iteráció** · chat: **Alkalmazás**/**Elvetés**, küldés | verzió-lista (origin ✦AI/dok badge), léptethető canvas (drag-pan, fókusz), inspector (overview/node/compare KPI-k), diff-sáv, compare két mini-map, forrás-overlay idézet-kiemeléssel, chat-drawer javaslat-kártyák (insert/update/remove) | **igen (3):** `extractProcessMap` (AS-IS), `suggestToBeProcess` (TO-BE), `chatEditProcess` (chat) | **igen** (generálás + TO-BE-javaslat + chat) |
| **Követelmények** | `/requirements` (+`/r/:id`,`/s/:id`), `RequirementsBoard.tsx`, `AcEditor.tsx`, `DeriveStoryPanel.tsx` | **BA/Agile nézet-toggle** (Agile 🔒 amíg nincs system req) · **`aiTreeCta` (✦)** BA-fa · **`genStoriesCta` (✦)** story-k · **`panelAiDraftCta` (✦)** story-vázlat · **`acDraftCta` (✦)** AC-vázlat · req/story ✓Megerősít/Elvet · `addReqCta`/`deriveCta`/`acAddCta` + MoSCoW-rádiók (create-kor) · AC törlés · stakeholder bind/unbind · `detailLink` | BA-swimlane (business/stakeholder/system lane-ek, lineage-sorok), Agile epic→story, req↔story N:M kiemelés/dim, E1 `✦aiBadge` kártyák, AC GWT-sorok (megosztott story-kkal), forrás-`[n]`, MoscowChip | **igen (4):** `suggestRequirements`, `suggestStories`, `suggestStoryDraft`, `suggestAcDraft` | **igen** |
| **Megoldás-terv** | `/solution` (+`/c/:id`), `SolutionBoard.tsx`, `ComponentDetail.tsx`, `AddComponentPanel.tsx` | **`addComponentCta`** · **`emptyGenCta`/genComponents (✦)** · komponens ✓`confirmCta`/`rejectCta` · `detailLink` · részlet: **`genOptionsCta` (✦)** · **HITL kiválasztás** (select nyertes) / `changeSelectionCta` · `addOptionCta`/`addCriterionCta` | TO-BE gerinc (jóváhagyott térképre dokkolt), process/infra/personnel sávok, komponens-kártyák E1, **opció-mátrix** (szempont-értékek c-mintával), nyertes-kijelölés (selected_by/at), üres állapot | **igen (2):** `suggestComponents`, `suggestOptions` | **igen** |
| Business case mező-munka | `FieldWorkBlock` + **`BenefitCalculator.tsx`** (szerkesztőben) | **`extractCta` (✦)** mezők · **`suggestCta` (✦)** haszon-bemenetek · **`saveCalcCta`** | mező-kártyák E1; **haszon-kalkulátor**: STAGE1 bemenetek (kapacitás/óradíj ✦-jelölt), STAGE2 **„a fék" (emberi %-csúszka)**, STAGE3 levezetett (bruttó/realizált/nettó/megtérülés — számított) | **igen:** `extract` + `suggestBenefitInputs` (a fék + levezetés NEM AI) | **igen** |
| Pilot-terv mező-munka | `FieldWorkBlock` + **`PilotSuccessDefinition.tsx`** | **`extractCta` (✦)** · **`pilotSuggestCta` (✦)** · **`savePilotCta`** | **pilot sikerdefiníció**: MÉRÉS (metrika/baseline/küszöb + siker-sáv), DÖNTÉSI SZABÁLY (scale/pivot/stop — **emberi**), poka-yoke amíg hiányos | **igen:** `extract` + `suggestPilotDefinition` (a döntési szabály NEM AI) | **igen** |
| Megoldási javaslat mező-munka | `FieldWorkBlock`/`ExtractForm` | **`extractCta` (✦)** · Confirm/Edit/Dismiss | mező-kártyák E1 | **igen** — `extract` | **igen** |
| TO-BE terv mező-munka | `FieldWorkBlock`/`ExtractForm` | **`extractCta` (✦)** · Confirm/Edit/Dismiss | mező-kártyák E1 (a *térkép* maga a Folyamattérkép-tool) | **igen** — `extract` | **igen** |

### ③ Kimenet — deliverable-ök
| Deliverable | Kapu-hordozó | Státuszlánc | Strukturált AI |
|---|---|---|---|
| **Business case** | [K] KEMÉNY | Draft→In review→Approved | `BenefitCalculator` (✦ suggestBenefitInputs) |
| **Pilot-terv** | [K] KEMÉNY | Draft→In review→Approved | `PilotSuccessDefinition` (✦ suggestPilotDefinition) |
| Megoldási javaslat | — | Draft→In review→Approved | — |
| TO-BE terv | — | Draft→In review→Approved | — |

### ④ Kapu: a P2 [K] deliverable-jei (Business case + Pilot-terv) Approved (auto, KEMÉNY).

---

## 4. P3 — Build (dedikált tool-modulok külön route-on)

### ② Munkaeszközök — dedikált tool-modulok
| Tool | Route/komponens | Gombok/akciók | Funkcionális elemek | AI-kivonatolás | ✦ Kivonatolás kell? |
|---|---|---|---|---|---|
| **Golden set & riport** | `/goldenset`, `GoldenSetBoard.tsx`, `EvalCaseEditor.tsx` | **`genCta` (✦)** eset-generálás · `addCaseCta` · **dinamikus rögzítő ★** (`recordCta` / **`recordAiCta` ✦**) · **`askAiCta` (✦)** besorolás · besorolás `saveCta` (emberi végső) · **`syncCta`** riport-szinkron · **`residualCta` (✦)** maradék kockázat · küszöb `saveCta` (emberi) + felülírás · kapu-panel | eset-tábla + pass%-sáv (küszöb-marker), **5 válasz-típusú rögzítő** (szöveg/radio/checkbox/csúszka/igen-nem), besorolás-panel (AI-verdikt KÜLÖN az emberi végsőtől, kritérium OK/BUKOTT), Tesztriport-panel, küszöb-panel, P3 kapu-panel, üres állapot | **igen (3):** `suggestEvalCases`, `suggestVerdict`, `suggestResidualRisk` (a rögzítés + végső besorolás + küszöb NEM AI) | **igen** |
| **Megoldás-dok.** | `/builddoc`, `BuildDocBoard.tsx`, `BuildComponentDetail.tsx`, `BuildAddPanel.tsx` | **`addComponentCta`** · **`emptyGenCta` (✦)** struktúra-javaslat · **`emptySeedCta`** P2-seed · **`syncCta`** dok-szinkron · komponens ✓/✎/× · **`suggestLinksCta` (✦)** kötés-javaslat · kötés ✓/× · `addLinkCta` · prompt `addPromptCta`/szerkesztés · kontroll ✓Megerősít/×Elvet + `addControlCta` | 5 szekció-csempe, komponens-tábla (**két kötés-oszlop**: eredet P2-seed + megvalósítás N:M), kétirányú lefedettség (PASSZÍV tükör, „nincs lefedő komponens"), prompt-könyvtár, kontrollpontok (guardrail/HITL + TO-BE-kötés), P2-seed/manuális felvétel | **igen (2):** `suggestBuildDoc`, `suggestImplLinks` | **igen** |
| Tesztriport mező-munka | `FieldWorkBlock` (workspace) | **`extractCta` (✦)** technikailag él | mező-kártyák E1 | field-extract nem tiltott, **de a kanonikus AI a Golden set modul** (syncReportAction) | ✦ **a modulban** (a deliverable-szintű másodlagos) |
| Megoldás-dok. mező-munka | `FieldWorkBlock` (workspace) | **`extractCta` (✦)** technikailag él | mező-kártyák E1 | field-extract nem tiltott, **de a kanonikus AI a Megoldás-dok. modul** (syncDocAction) | ✦ **a modulban** |

### ③ Kimenet — deliverable-ök
| Deliverable | Kapu-hordozó | Státuszlánc | Kanonikus AI-otthon |
|---|---|---|---|
| **Tesztriport** | [K] KEMÉNY (interim) | Draft→In review→Approved | Golden set modul (+approve-őr: golden set eredmény/küszöb poka-yoke) |
| **Megoldás-dokumentáció** | [K] KEMÉNY (interim) | Draft→In review→Approved | Megoldás-dok. modul |

### ④ Kapu: Megoldás-dokumentáció **ÉS** Tesztriport Approved (auto, KEMÉNY, interim).

---

## 5. ArtifactEditor — a deliverable-szerkesztő (minden fázis, minden deliverable)

`/artifact/[artifactId]`, `ArtifactEditor.tsx`. A ③ Kimenet „Szerkesztő megnyitása" ide visz.

| Terület | Gombok/akciók | Funkcionális elemek | AI |
|---|---|---|---|
| Fejléc | breadcrumb → dok.tár · **Export .md** (approved-only) · verzió-történet | `StatusFlow` (Draft→In review→Approved pillek), v-szám, `finalTag` | — |
| Mezőtérkép (bal) | mező-sorra ugrás | kötelező/opcionális mezők, `{confirmed}/{required}`, kész/aktív állapot | — |
| Mező-accordion (közép) | **Confirm** (ai_filled) · **Edit** (→manual) · **Dismiss** · üres-kötelező „Write manually" | egy-nyitott accordion, egysoros összefoglaló + státusz-pill, kattintható `[n]` citációk, **P2 strukturált beékelés** (`customBody` = Benefit/Pilot) | mező-E1: **nem** LLM (a ✦ Javaslat/mező szándékosan NEM épült — FLAG) |
| Body-sor | **✦ Generálás** (draft) · Edit/Save body | mezőkből komponált előnézet, citációk | ✦ Generálás = `generateBody` |
| Előnézet-mód | Szerkesztés/Előnézet toggle | TOC + komponált dokumentum + tömör források | — |
| Források-sáv | forrás-csempe → `[n]` villantás | `N sources · M citations`, idézet | — |
| Lábléc (státuszlánc) | **Review-ra küldés** · **Vissza draftba** · **Approve** (kemény hiány-blokk: hiányzó kötelező mező tiltja; Tesztriport golden-set poka-yoke) · **Új verzió** (approved+head) | HITL-jegyzet, approve-blokk indoklása | — |

**Deliverable-export:** `/artifact/[id]/export/route.ts` — **approved-only** szerveroldali őr (403 különben), `.md` letöltés (fejléc + body + **Források függelék** a `[n]` sorrendben), ASCII fájlnév, magyar nyelv. Nem LLM.

---

## 6. Fázis-hovatartozás összegzés (a rossz besorolások kiszűréséhez)

| Tool / modul | Tényleges fázis(ok) | Kanonikus otthon | Referencia-elérés |
|---|---|---|---|
| ① Bemenet · ② Munkaeszközök · ③ Kimenet · ④ Kapu (workspace-héj) | **minden fázis** (P0–P6) | fázis-munkafelület | — |
| **Fájdalompontok** | **P1** | P1 ② workspace-beágyazott | — |
| **Use case-ek** | **P1** | P1 ② workspace-beágyazott | — |
| **Stakeholderek** | **P1** | P1 ② workspace-beágyazott | dedikált `/stakeholder/:id` (+cockpit) |
| **Hőtérkép (érték×megvalósíthatóság)** | **P1** | P1 ② (a use case-ek mellett) | — · **kézi pontozás, nincs ✦** |
| **Értékelők (#7b)** | **P1** | P1 ② (use case-kártyán) | — · **kérdőív, nincs ✦** |
| **Folyamattérkép** | **P1 (AS-IS) + P2 (TO-BE)** | dedikált `/process` | AS-IS a P1 leiratból, TO-BE a P2-ben |
| **Követelmények** | **P2** | dedikált `/requirements` | forrás: TO-BE + fájdalompont + stakeholder |
| **Megoldás-terv** | **P2** | dedikált `/solution` | a **jóváhagyott TO-BE** gerincre dokkol |
| **Golden set & riport** | **P3** | dedikált `/goldenset` | a kiválasztott use case-hez |
| **Megoldás-dok.** | **P3** | dedikált `/builddoc` | **P2-seed** a kiválasztott megoldás-komponensekből |
| Business case (Benefit-kalkulátor) | **P2** | ③ deliverable + szerkesztő | — |
| Pilot-terv (Pilot sikerdefiníció) | **P2** | ③ deliverable + szerkesztő | — |
| Artefaktum-szerkesztő | **minden fázis** | `/artifact/:id` | a ③ Kimenetből + dok.tárból + cockpitból |
| Dokumentumok (tár) | **projekt-globális** (fázis-szekciózott) | `/documents` | — |
| Források | **projekt-globális** | `/sources` | (a ① Bemenet ugyanezt az `input_items`-et fázis-lencsézi) |

**Több fázisból elérhető (kanonikus + referencia):**
- **Folyamattérkép** — AS-IS a P1-hez, TO-BE a P2-höz; egy route, két kind (a viewer AS-IS/TO-BE/⇄ toggle-lal).
- **Stakeholderek** — kanonikus a P1 ② toolban; referencia a dedikált `/stakeholder/:id` lapon + a cockpiton.
- **Artefaktum-szerkesztő** — minden fázis bármely deliverable-jéhez; a ③ Kimenetből, a Dokumentumok tárból és a cockpitból egyaránt.

---

## 7. ✦ Kivonatolás-verdikt tömören (a korábbi extract-gomb-audit beolvasztva)

**KELL ✦ Kivonatolás:** P0/P1/P2 field-extract mező-munka (`ExtractForm`); Fájdalompontok; Use case-ek; Folyamattérkép (AS-IS/TO-BE/chat); Követelmények (fa/story/AC/story-vázlat); Megoldás-terv (komponens/opció); Business case (mező + haszon-bemenet); Pilot-terv (mező + sikerdef); Megoldás-dok. (struktúra/kötés); Golden set (eset/verdikt/kockázat).
**NEM KELL:** Hőtérkép (kézi pontozás); #7b Értékelők (kérdőív+szabály); Priorizált use case-shortlist deliverable (`entitySourced`, szerver-tiltott → `entitySourcedHint`).
**Külön: ✦ Generálás** (nem Kivonatolás) minden deliverable ③/szerkesztő body-jára (`generateBody`).
**P3 Tesztriport/Megoldás-dok.:** a ✦ AI a dedikált modulban él, nem a deliverable field-work-jén.

**Újrafuttatás E1-viselkedés (a ✦ gomb másodlagos-akció szemantikájához):** mező-szint **MERGE** (confirmed/manual nem íródik felül; csak draftban); entitás-szint **ai_suggested-CSERE** (megerősítettet guard védi); modul-generátorok **üres-készletre / additív név-dedup**. Idempotens, nem-destruktív.

---

**Semmi kód nem változott** — csak ez a jelentés-fájl készült a `docs/state/`-be. A leltár a kód olvasásából (route/komponens/config/i18n/LLM-adapter) állt össze; ahol a ✦ AI a dedikált modulban él (P3), külön jelölve.

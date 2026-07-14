# Záró jelentés — Coding-csomag: Fázis-dokumentumok megjelenítése a fázis-oldalon (nagy csempék)

**Dátum:** 2026-07-14 · **Branch:** `dev`

## Összefoglaló

A fázis-oldal (nyitott ÉS lezárt állapotban egyaránt) új „Ebben a fázisban készült dokumentumok" szekciót kapott: nagy, lekerekített csempék típusonként — a Projektdokumentáció tár EGYETLEN sorával azonos adaton (típus, verzió, státusz, teljesség), csak nagyobb kártya-formában. Kattintásra a MEGLÉVŐ artefaktum-olvasó/szerkesztő oldal nyílik — ugyanaz a hely, ahonnan a tár „Megnyitás" gombja is hív.

**Nincs új adatmodell, nincs új szerkesztő-logika, nincs új lekérdezés** — a `src/lib/artifacts/config.ts` már meglévő `typesForPhase`/`parseArtifactFields`/`completeness` függvényeit hívja, fázisra szűrve.

## Mit érintett a csomag

| Fájl | Változás |
|---|---|
| `src/lib/artifacts/phase-tiles.ts` | **ÚJ** — `loadPhaseDocTiles(supabase, projectId, phase)`: a tár típusonkénti-sor logikájának fázisra szűrt változata, önálló fájlban (nem importálja/módosítja a `documents/page.tsx`-t) |
| `src/components/PhaseDocumentTiles.tsx` | **ÚJ** — nagy `rounded-shell` csempék (a Dashboard/Repository nagy kártyáinak mintáját követve — ez a rendszer legnagyobb meglévő kártya-rádiusza, nem vezettem be új tokent); típusnév + `StatusPill` (meglévő komponens) + verzió + teljesség-sáv; „még nincs elkezdve" csendes szaggatott csempe a tár placeholder-nyelvén |
| `src/app/project/[id]/phase/[phase]/page.tsx` | A `completed` ág és az `open`/`in_progress`/`gate_pending` ág is megkapja az új szekciót (a kapu-döntés kártya / munkaeszközök alatt, a döntés-napló felett) |
| `messages/hu.json`, `messages/en.json` | +1 kulcs: `phases.documentsTitle`; a szekció többi szövege a tár MEGLÉVŐ kulcsait használja újra (`hub.notStartedBlocks`, `hub.notStartedOptional`, `hub.requiredFieldsShort`, `artifacts.status.*`) |

## Interakció-döntés (a specifikáció adta kereten belül)

A specifikáció három lehetőséget engedett: in-place expand, modal/drawer, vagy „a meglévő olvasó-komponens újrafelhasználásával — hívd meg ugyanabból a helyből, ahonnan a tár Megnyitás gombja is hívja". A tár Megnyitás/Review gombja maga is egy `Link` a `/project/:id/artifact/:artifactId` útvonalra (nem modal) — ezért a csempék ugyanezt a mintát követik: a kitöltött csempe egésze `Link` erre az útvonalra, amely a MEGLÉVŐ, teljes `ArtifactEditor`-t nyitja meg (Approved dokumentumnál olvasó/előnézet nézetben, egyébként a szerkesztőben). Ez szó szerint teljesíti a „ugyanabból a helyből hívd meg" utasítást, és garantáltan nem igényel új szerkesztő-logikát vagy plusz lekérdezést egy beágyazott modálhoz.

## Vizuális igazolás

- **P0 (lezárt fázis)**: 3 csempe, mindegyik „még nincs elkezdve" (a P0 deliverable-jei ehhez a teszt-projekthez nem készültek el) — szaggatott, csendes stílus.
- **P1 (nyitott fázis)**: 2 csempe — „Priorizált use case-shortlist" (még nincs elkezdve · a kapuhoz kell, mert P1 kemény kritériuma) és „Felmérési riport" v2, In review pillel, 4/4 kötelező mező sávval.
- Kattintás a „Felmérési riport" csempére → a meglévő `/project/:id/artifact/:artifactId` oldal nyílik meg, teljes mezőtérkép/accordion/források nézettel — ugyanaz, amit a tár „Review" gombja is nyit.

## Gépi kapuk

- `npx tsc --noEmit` — **0 hiba**
- `npm run build` — **zöld**
- `npm run i18n:check` — **üres diff**, 719 kulcs, HU/EN azonos készlet
- Playwright (prod build, lokális PG16+shim): P0 (lezárt) és P1 (nyitott) fázis-oldal, a tár, a Dashboard, a Cockpit — mindenhol **0px vízszintes overflow**

## Érintetlenség-igazolás

```
git diff --stat 16ec393 -- \
  "src/app/(top)/page.tsx" "src/app/project/[id]/page.tsx" \
  "src/app/project/[id]/documents/page.tsx" "src/app/project/[id]/artifact" \
  "src/app/project/[id]/layout.tsx" "src/app/layout.tsx" \
  "src/components/SidebarNav.tsx" "src/components/ProjectContextNav.tsx" \
  "src/components/DashboardBoard.tsx" "src/components/ArtifactEditor.tsx" \
  "src/components/EditorField.tsx" "src/components/RepoSections.tsx" \
  "src/components/WorkspaceShell.tsx" "src/components/UseCaseHeatmap.tsx" \
  "src/components/PhaseWorkspace.tsx" "src/styles/tokens.css" "src/app/globals.css"
```
→ **üres diff** (16ec393 = a legutóbbi push). A tár, a Dashboard, a Cockpit, az Editor, a sidebar, a token-réteg és a `PhaseWorkspace` belseje egyetlen fájlban sem változott — csak a fázis-oldal (`phase/[phase]/page.tsx`) kapott egy új szekciót, ahogy a scope engedte.

## Scope-on kívüli észrevétel

Semmi nem mutatott a scope-on kívülre.

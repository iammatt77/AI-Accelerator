# Záró jelentés — Coding-csomag: Kimaradt nézetek (Ügyfelek + Projektek lista + placeholderek)

**Dátum:** 2026-07-14 · **Branch:** `dev` · **Referencia:** `AICON_Handoff_Master_READABLE.html` — csak stílus-útmutatóként, e csomag KIZÁRÓLAG a lenti három tételt hozza a lapos-tömör nyelvre.

## Összefoglaló

A rendszer utolsó három, még régi stílusú felülete állt át a lapos-tömör design-nyelvre, a már megépült Portfolio Dashboard / Document Repository kártya- és sor-nyelvét származtatva:

1. **Ügyfelek lista** (`/clients`) + **ügyfél-lap** (`/clients/[id]`) — valós, adatvezérelt
2. **Projektek lista** (`/projects`) — valós, adatvezérelt
3. **Inbox · Könyvtár · Beállítások** — egységes, stílus-hű „hamarosan" placeholder

**A KEMÉNY KORLÁT betartva:** a Dashboard, Cockpit, Phase Workspace, Document Repository, Document Editor, a sidebar és a token-réteg egyetlen fájlja sem módosult.

## Érintetlenség-igazolás (a lezárt öt fő képernyő + sidebar + tokenek)

```
git diff --stat 2fe4ec2 -- \
  "src/app/(top)/page.tsx" "src/app/project/[id]/page.tsx" \
  "src/app/project/[id]/phase" "src/app/project/[id]/documents/page.tsx" \
  "src/app/project/[id]/artifact" "src/app/project/[id]/layout.tsx" \
  "src/app/layout.tsx" "src/components/SidebarNav.tsx" \
  "src/components/ProjectContextNav.tsx" "src/components/DashboardBoard.tsx" \
  "src/components/ArtifactEditor.tsx" "src/components/EditorField.tsx" \
  "src/components/StatusFlow.tsx" "src/components/RepoSections.tsx" \
  "src/components/WorkspaceShell.tsx" "src/components/UseCaseHeatmap.tsx" \
  "src/components/PhaseWorkspace.tsx" "src/styles/tokens.css" "src/app/globals.css"
```
→ **üres diff** (2fe4ec2 = a legutóbbi push, az UI-Master H záró commitja). Egyik fájl sem változott.

## Mit érintett a csomag

| Fájl | Változás |
|---|---|
| `src/lib/projects/list-card.ts` | **ÚJ** — státusz (needs_you/gate/stalled/healthy) + 7-szegmensű spine + „X/7 lezárva" számítás, önállóan (nem importálja/módosítja a Dashboard oldalát) |
| `src/components/ProjectListCard.tsx` | **ÚJ** — a Dashboard projekt-kártya vizuális nyelvén (avatar, státusz-pill, mini-spine), „X/7 lezárva" progresszussal a heti-jelölés helyett |
| `src/app/(top)/projects/page.tsx` | Átírva: valós lista `ProjectListCard`-okkal, a létrehozó-form fehér `surface-shell` kártyába csomagolva |
| `src/app/(top)/clients/page.tsx` | Átírva: sor-kártya lista (avatar-monogram + név + iparág + projekt-szám pill), Repository-sor nyelven |
| `src/app/(top)/clients/[id]/page.tsx` | Átírva: a projekt-lista most `ProjectListCard`-ot használ (ugyanaz mint a Projektek listán); az adat-kártya (`card-sunken`) változatlan, már token-konzisztens volt |
| `src/components/ComingSoon.tsx` | Átírva: fehér `surface-shell` kártya, egy árnyék-token, accent-fill ikon-kör — Inbox/Library/Settings mind ezt hívja, funkció nem került bele |
| `messages/hu.json`, `messages/en.json` | +4 kulcs: `projects.progressLabel`, `projects.activePhaseLabel`, `clients.projectCount`, `clients.projectCountZero` |

## Vizuális konzisztencia-igazolás (hex/token)

A `ProjectListCard` és az Ügyfelek-sor ugyanazokat a token-osztályokat használja, mint a Dashboard projekt-kártyája:

| Elem | Osztály/token | Forrás |
|---|---|---|
| Kártya felület | `bg-surface` (#FFFFFF) + `border-line` + `shadow-card` | azonos a Dashboard kártyájával |
| Avatar-monogram | `bg-sunken` + `border-line`, mono 12px bold | azonos |
| RÁD VÁR pill | `bg-action` (#8458B3) fehér szöveg | azonos komponens-logika (`DashboardBoard.tsx` mintája) |
| KAPU pill | `bg-tint-gate` + `text-gate-text` (#B4801E) | azonos |
| ELAKADT pill | `bg-tint-error` + `text-danger` (#C0455A) | azonos |
| Mini-spine szegmensek | `bg-done`/`bg-action`/`bg-gate`/`bg-neutral-150` | azonos tónus-térkép |
| Placeholder ikon-kör | `bg-accent-fill` + `text-action-deep` | a Master accent-fill jelvény-nyelve (pl. AKTÍV badge a Repository-n) |

## Gépi kapuk

- `npx tsc --noEmit` — **0 hiba**
- `npm run build` — **zöld**
- `npm run i18n:check` — **üres diff**, 718 kulcs, HU/EN azonos készlet
- Playwright (prod build, lokális PG16+shim), 12 nézet 1440px-en: **0px vízszintes overflow, 0 backdrop-filteres elem** mindenhol — a 2 új lista, 3 placeholder ÉS a lezárt öt fő képernyő (Dashboard/Cockpit/Workspace/Repository/Editor) újra lefotózva, változatlan renderrel

## Funkció-megőrzés

- Az ügyfél+projekt-létrehozó flow (`createClientAndProject`) érintetlen, csak a keret-kártya stílusa változott.
- Minden meglévő navigáció (kártya → `/project/:id`, ügyfél-sor → `/clients/:id`) működik.
- Placeholderek maradtak placeholderek: Inbox nem lett értesítés-központ, Settings nem kapott logikát, Library nem kapott tartalmat.

## Nálad zárandó (Máté)

A Preview-n nézd meg az Ügyfelek listát és a Projektek listát — konzisztensek-e a Dashboarddal/Repository-val (kártya-nyelv, paletta, pill-ek) — valamint a három placeholdert.

## Scope-on kívüli észrevétel (nem implementálva)

Semmi nem mutatott a scope-on kívülre; a csomag a három megadott tételre korlátozódott.

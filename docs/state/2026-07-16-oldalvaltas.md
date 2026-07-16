# Coding-csomag — Oldalváltás-animációk (2026-07-16)

**Az AICON Oldalváltás-spec (`AICON - Oldalváltás.dc.html`) éles megvalósítása:
három, szándékosan eltérő átmenet + csúszó menü-jelölősáv + navigálj-előbb
skeleton.** Branch: `dev`. **Nincs adatmodell/migráció** — tisztán megjelenítési/
mozgás-réteg. Csak `transform`/`opacity`/`filter` animálódik (GPU, 60 fps),
layout-tulajdonság SOHA; a `prefers-reduced-motion` tiszteletben.

## A három mozgás (a spec §1 szerint)

- **A · LATERAL** (menüváltás, azonos szint): a menü lila jelölősávja elcsúszik
  az aktív pontra (`transform: translateY`, `--dur-pill` 320 ms, `--ease-pill`);
  a tartalom fel-fade-el (`aiconPageIn` — opacity 0→1, 10 px emelkedés, 3 px
  blur→0).
- **B · DRILL-IN** (sorba kattintás → részlet, mélyebb szint): a tartalom
  jobbról úszik be (`aiconPushIn` — translateX 28px→0, blur 3→0), `--dur-page`
  340 ms.
- **C · VISSZA** (fel a listára): a lista balról jön vissza (`aiconPushBack` —
  translateX −18px→0). Ellentétes irány a drill-innel.

## Implementáció (a spec §3–4 leképezése)

- **Tokenek + keyframe-ek** (`styles/tokens.css` + `app/globals.css`):
  `--ease-enter` (.2,0,0,1), `--ease-pill` (.4,0,.2,1), `--dur-page` 340ms,
  `--dur-pill` 320ms, `--dur-shimmer` 1400ms; a négy keyframe
  (`aiconPageIn`/`aiconPushIn`/`aiconPushBack`/`aiconShimmer` + `aiconBreathe`)
  és a `.anim-page-in`/`.anim-push-in`/`.anim-push-back` osztályok, a
  `.skeleton-bar` (shimmer) és a `prefers-reduced-motion` blokk (minden mozgás
  ~0 ms-ra húzva).
- **`components/PageTransition.tsx`** (a spec „remount kell a be-animhoz"): a
  tartalom `key={pathname}` — a route-váltáskor ÚJRA-MOUNTOL → a CSS-anim
  újrafut. Az irányt az útvonal-mélység + prefix-viszony adja
  (`usePathname` prev vs curr): mélyebbre → `push-in`, feljebb → `push-back`,
  azonos szint → `page-in`. Beépítve a **`(top)/layout.tsx`**-be (initial
  `page-in`) és a **`project/[id]/layout.tsx`**-be (initial `push-in`, mert oda
  mindig befelé lépünk) — a globális sidebar/projekt-subnav STABIL marad, csak a
  tartalom animál.
- **Csúszó menü-jelölősáv** (`components/SidebarNav.tsx`, expanded variáns):
  EGYETLEN, abszolút pozíciójú pill, ami az aktív pontra CSÚSZIK
  (`transform: translateY`, transition `--dur-pill`/`--ease-pill`). A pozíció
  **mérve** (`useLayoutEffect` + `offsetTop`/`offsetHeight`) — divider-biztos,
  nem hardcode-olt lépés. Csak transform animálódik. (A rail variáns tömör,
  per-elem kitöltéssel marad.)
- **Navigálj-előbb + skeleton** (`components/Skeletons.tsx` + `loading.tsx`):
  a Next App Router `loading.tsx` (Suspense-fallback) adja a spec „a navigáció
  SOHA nem vár a fetch-re" viselkedését — a `<Link>` azonnal vált (a
  PageTransition push-inje elindul), a lassú szerver-render helyén
  **skeleton-shimmer** (a négy mező 0/0.1/0.2/0.3 s késleltetéssel) + „adatok
  betöltése…" breathe-pötty. `loading.tsx` a fő drill-in célokra:
  `(top)/clients/[id]` és `project/[id]`.
- **i18n**: `common.loading` (HU/EN). i18n:check OK — 1025 kulcs.

## Kötelező szabályok (a spec §5) — teljesítve

- **Remount a be-animhoz** — `key={pathname}` a PageTransition-ben. ✓
- **Ne blokkold a navigációt a fetch-re** — `loading.tsx` Suspense-fallback, a
  route azonnal vált. ✓
- **Csak `transform`/`opacity`/`filter`** — a keyframe-ek és a pill kizárólag
  ezeket animálják; `top/left/width/height/margin` SOHA. (A `filter: blur` a
  spec szerinti tranziens 3px→0 kiélesedés, nem `backdrop-filter`.) ✓
- **`prefers-reduced-motion`** — globals.css media-blokk minden animációt/
  tranzíciót ~0 ms-ra húz. ✓

## Verifikáció (lokális PG16 + PostgREST-shim + prod build + MOCK_LLM)

- **`npx tsc --noEmit`** → 0. **`npm run build`** → zöld. **`i18n:check`** → OK
  (1025 kulcs, HU/EN azonos).
- **Playwright** (a mozgás strukturális ellenőrzése, mert statikus képen nem
  látszik):
  - **Keyframe-ek** a kiszolgált CSS-ben: aiconPageIn/PushIn/PushBack/Shimmer
    mind jelen. ✓
  - **Csúszó pill**: /clients → translateY(0), /projects → translateY(34,2px) —
    a jelölősáv transzformmal csúszik az aktív pontra. ✓
  - **Irány-osztályok**: lateral (/clients→/projects) = `anim-page-in`;
    drill-in (ügyfél-lista → ügyfél-lap) = `anim-push-in`; vissza =
    `anim-push-back`. ✓
  - **`prefers-reduced-motion`** media-szabály jelen. ✓
  - **`overflowX = 0`**, **`backdrop-filter` elem = 0** (nincs layout-jank, nincs
    üveg-blur).

## Kezelt döntések

- **Két PageTransition-belépő** (top + project layout) — hogy a globális sidebar
  és a projekt-subnav STABIL maradjon, csak a belső tartalom animáljon (nem a
  teljes oszlop). A projekt-layout initial `push-in`-je adja a „projektbe
  belépés = drill-in" érzetet.
- **Mért pill-pozíció** a hardcode-olt 42 px lépés helyett — a valós elem-
  magasságból + a Beállítások előtti divider offsetjéből, így robusztus.
- **Skeleton-fejléc**: a `loading.tsx` teljes-szegmens fallback (fejléc-váz +
  mező-shimmer). A spec „a fejléc [név/iparág] rögtön látszik" finomítása
  (Suspense-határ a mezők körül, a fejléc a route-paraméterből) egy későbbi,
  opcionális lépés — a jelen megoldás teljesíti a „nincs üres képernyő, nincs
  megfagyott kattintás" követelményt.

## Nálad zárandó (Preview)

- **Nincs migráció** — azonnal tesztelhető.
- **Preview-teszt:** kattints a globális menüpontok között (a pill csúszik, a
  tartalom fel-fade-el); egy ügyfél sorába (jobbról úszik be); „← Vissza"
  (balról jön vissza a lista); lassú hálózaton a drill-in azonnal belép, a
  mezők helyén skeleton-villódzás. Csökkentett mozgásnál (OS-beállítás) csak
  opacity marad.

## Érintett fájlok

- **Új:** `src/components/PageTransition.tsx`, `src/components/Skeletons.tsx`,
  `src/app/(top)/clients/[id]/loading.tsx`, `src/app/project/[id]/loading.tsx`,
  `docs/design/ref_oldalvaltas.html` (a spec verziózva)
- **Átírt:** `src/components/SidebarNav.tsx` (csúszó pill)
- **Bővített:** `src/styles/tokens.css` (mozgás-tokenek),
  `src/app/globals.css` (keyframe-ek + skeleton + reduced-motion),
  `src/app/(top)/layout.tsx` + `src/app/project/[id]/layout.tsx`
  (PageTransition), `messages/hu.json` + `messages/en.json` (`common.loading`)

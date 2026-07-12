# Záró jelentés — Coding-csomag #3: Alapozás (2026-07-12)

Spec: AICON_Coding_csomag_3_Alapozas_v0_1 (Approved). Branch: `dev`.
Audit-fájl (0. lépés, a jelentés alapja): [`2026-07-12-audit.md`](./2026-07-12-audit.md).

## 1. Audit-összefoglaló

A 0. lépés auditja megállapította (részletek az audit-fájlban):

- **A #2 csomag (váz + állapotgép) nem található a repóban** — se commit, se
  navigációs váz, se state enum, se állapotgép-motor, se stepper, se
  „Következő legjobb lépés" widget, se kézi fázis-záró gombok. A
  `phase_instances`-be csak P0 kerül projekt-létrehozáskor.
- Tailwind **v4** (4.3.2) → a token-kötés `@theme`-mel a CSS-ben történt
  (nincs tailwind.config).
- Az élő AI-Consulting Supabase-projekt ebből a munkakörnyezetből nem érhető
  el (nincs kulcs; a session MCP-je egy másik termék projektjeit látja).

## 2. Leszállított lépések (commit-bontás)

| Lépés | Commit | Tartalom |
| --- | --- | --- |
| 0. Audit | `e44ae1c` | `docs/state/2026-07-12-audit.md` |
| 1. Tokenek | `bc614f8` | `src/styles/tokens.css` + `@theme` mapping + fontok (next/font, latin-ext) + alap-chrome átállítás + `StatusPill` (ikon+szöveg) + minimál oldalsáv-shell |
| 2. i18n | `374552b` | next-intl routing nélkül (cookie `locale`, default hu), `messages/hu.json`+`en.json` (13 névtér), minden UI-string kulcsosítva (FormState/throw hibák is), HU\|EN pill, `npm run i18n:check`, llm-adapter 1 soros védőkomment |
| 3. Seed | `382b86e` | `scripts/seed.ts` + `npm run seed` (tsx), fix UUID-k + upsert, demo-tartalom szó szerint |
| 4. Önellenőrzés | `75c66c6` | a review-workflow 12 megerősített leletének javítása (lásd 3. szakasz) |
| 5. Jelentés | (ez a commit) | záró jelentés |

## 3. Önellenőrzés eredményei

### Build + típusok + i18n

- `npx next build`: **zöld** (Compiled successfully; TypeScript 0 hiba).
- `npm run i18n:check`: **üres diff** — „87 kulcs, mindkét nyelven azonos készlet".

### Seed — kétszeri futtatás (idempotencia-bizonyíték)

A munkakörnyezetből az éles Supabase nem érhető el, ezért a bizonyíték
**lokális, eldobható stack** ellen készült: natív PostgreSQL 16 + a repo
`0001_init.sql` migrációja + Supabase-egyenértékű szerep-modell
(`service_role` bypassrls) + egy PostgREST-kompatibilis minimál-shim
(a seed által használt upsert/count/olvasó szemantikával; a hivatalos
PostgREST bináris letöltését a környezet hálózati szabályzata blokkolta).

Rekordszámok futásonként (a seed-hatókörre szűkítve):

| Tábla | 1. futás | 2. futás |
| --- | --- | --- |
| clients | 1 | 1 |
| projects | 1 | 1 |
| phase_instances | 7 | 7 |
| input_items | 3 | 3 |
| artifacts | 1 | 1 |
| decisions | 1 | 1 |

**Nincs duplikáció.** Adattartalom psql-lel ellenőrizve: fázis-állapotok
(P0 completed · P1 in_progress · P2–P6 locked), a 3 input `raw_text`-je
karakterre a spec szerinti, charter `approved` v1 (2026-06-19), decision
`gate_closed` (2026-06-19), projekt-kezdés 2026-06-15 (created_at).

Hangos env-hiba ellenőrizve: env nélkül `✖ SEED HIBA: hiányzó SUPABASE_URL …`,
exit code 1.

**Éles futtatás (felhasználói lépés):** `.env.local` kitöltve → `npm run seed`
kétszer; a kiírt rekordszámoknak a két futás után azonosnak kell lenniük
(1/1/7/3/1/1).

### Kézi füst-teszt (ebben a környezetben, a lokális stack ellen lefuttatva)

1. **Nyelvváltó**: cookie nélkül a felület magyar (`<html lang="hu">`,
   „Projektek"); `locale=en` cookie-val angol (`lang="en"`, „Projects",
   „system · P0–P6"). A cookie 1 éves — HU→EN váltás után a reload EN marad.
   Felhasználói ellenőrzés: oldalsáv alján HU | EN pill → EN →
   böngésző-frissítés → a felület angol marad.
2. **Seedelt projekt a felületen**: a főoldalon „AI-felmérés — panaszkezelés"
   (Kovács Nyomda Kft. · Nyomdaipar · Felmérés); a projekt-oldalon a charter
   (Approved · v1 pill, ikonnal), mind a 3 bemenet címmel, számláló:
   „3 bemenet · 1 artefaktum" / EN: „3 inputs · 1 artifact".
3. **Lokalizált 404**: érvénytelen projekt-id → HTTP 404, „Az oldal nem
   található" / „Page not found".
4. **Kontraszt (1. törvény)**: az üveg-felszín effektív színén (rgb 246,246,250)
   a törzs-szöveg (ink/primary) kontrasztja **14,04:1** (≥7:1 ✓);
   ink/secondary 5,9:1 (másodlagos szöveg), ink/tertiary 2,95:1 (csak meta —
   a törvény szerint).

### Többlencsés review (adverszárius verifikációval)

5 párhuzamos lencse (korrektség, i18n-teljesség, token/törvény-megfelelés,
seed-hűség, spec/scope-fegyelem), minden lelet külön adverszárius
verifikátorral — összesen 20 ügynök. Eredmény: **15 lelet → 12 megerősítve,
3 elutasítva**. A seed-hűség és a scope-fegyelem lencse **0 hibát** talált
(a szó szerinti tartalmak, a séma-illeszkedés, az llm-adapter érintetlensége
és a függőség-megkötés igazolva).

Mind a 12 megerősített lelet javítva (`75c66c6`), élőben újra-ellenőrizve:

| Lelet | Javítás |
| --- | --- |
| „ismeretlen hiba" fallback kulcsozatlan (EN-en magyar) | `errors.unknown` kulcs, paraméterezett fallback |
| Supabase env-hibaüzenet magyarul jut az EN UI-ba | semleges technikai üzenet (env-változónevek) |
| `cockpit.counts` EN plural nélkül („1 artifacts") | ICU plural az en.json-ban → „1 artifact" |
| `notFound()` lokalizálatlan angol 404 | `src/app/not-found.tsx` (HU/EN, tokenes) |
| Dobott action-hibák prod-ban olvashatatlan 500-at adnak | `src/app/error.tsx` lokalizált hiba-határ (teljes FormState-átállás → parkoló) |
| React 19 hibaági form-reset: a beillesztett szöveg elveszik | `FormState.values` + nonce-key remount az InputFormban |
| Szerveroldali dátum a szerver (prod: UTC) zónájában | fix `timeZone: "Europe/Budapest"` |
| „Forrás bemenetek" cím forrás nélküli artefaktumnál is | igazmondó fejléc: valós forrásoknál „Forrás bemenetek", különben „Bemenetek" |
| Nyelvváltó aktív gombja lila (3. törvény sérül) | tömör felület-szegmens, lila nélkül |
| Nyelvváltó inaktív felirata tertiary (1. törvény) | ink/secondary |
| Kártya-hover elveszti a fény-élt (2. törvény) | `.glass-tile-interactive`: mélyebb árnyék + megtartott él |
| Oldalsáv default `backdrop-blur-md` a token helyett | `.glass-panel` a `--blur-glass-soft` tokenből |

Elutasított leletek (nem javítandók): `nextArtifactVersion` TOCTOU-verseny
(a csomag előtti örökség, egyfelhasználós rendszerben látens — parkoló),
„holt" settings.hungarian/english kulcsok (bekötöttük őket a11y-címkeként),
`--color-white` a @theme-ben (Tailwind-alapérték visszaállítása, nem
design-token).

## 4. Kezelt eltérések (spec-feltevés ↔ talált valóság)

| Spec-feltevés | Valóság | Igazítás |
| --- | --- | --- |
| Létező oldalsáv (#2 nav-váz) | Nincs oldalsáv | Minimális oldalsáv-shell készült az alap-chrome részeként (márka + Projektek + nyelvváltó); a teljes nav-váz a #4-é |
| `state` enum az állapotgépből | Sima text oszlop, enum nincs | i18n a kanonikus állapotkészletet kulcsozza (+ legacy `not_started`); a seed kanonikus szöveges értékeket ír (`completed`/`in_progress`/`locked`) |
| P2–P6 „az állapotgép szerint zárt/nyitott" | Állapotgép nincs | Lineáris kapu-értelmezés: P1 folyamatban → P2–P6 `locked` (dokumentált feltevés) |
| Projekt „kezdés: 2026-06-15" | Nincs start-oszlop | `created_at`-ként rögzítve |
| Input item cím | Nincs title-oszlop | Cím a `type` oszlopban (a felület meta-sora megjeleníti); `raw_text` szó szerint |
| Decision cím + indoklás | `kind` + `note` oszlopok | `kind='gate_closed'`, cím+indoklás a `note`-ban |
| Charter „P0" kötés | Nincs phase-oszlop az artifacts-en | `type='project_charter'`; a P0-kötés a body-ban/decisionben |
| Éles DB-n futó seed-verifikáció | Nincs hozzáférés ebből a környezetből | Lokális PG16 + shim elleni kétszeri futás (3. szakasz); éles futtatás felhasználói lépés |
| Nyelvváltás után dinamikus tartalom | — | A `decisions` audit-jegyzetei és a generált artefaktum-body ADAT, nem UI — nyelvfüggetlenül tárolódnak (a draft magyar, az adapter védett) |

## 5. Ami nyitva maradt / parkoló

- **#4-re dokumentált #2-hiányok** (audit 7. szakasz): 7 fázis
  instanciálása, state enum + állapotgép, teljes nav-váz, stepper,
  „Következő legjobb lépés", kézi fázis-záró; `phase_instances`
  unique(project_id, phase); text→enum migráció.
- **FormState-átállás** a `createClientAndProject` / `saveDraftBody` /
  `approveArtifact` actionökre (a dobott hibák prod-ban csak a generikus —
  most már lokalizált — hibaképernyőt adják; a mezőszintű hibamegjelenítéshez
  useActionState-minta kell, mint az addInputnál).
- **`nextArtifactVersion` TOCTOU** — versenyhelyzet-mentes verziószámozás
  (pl. DB-oldali sorszámozás) a többfelhasználós jövőre.
- **eslint react/jsx-no-literals** (opcionális tétel): kihagyva — nincs
  eslint-konfig a repóban, bevezetése új függőségeket igényelne, amit a
  csomag függőség-megkötése (csak next-intl + tsx) kizár.
- **Dark mode**: a #1-beli rögtönzött dark-variáns eltávolítva — a v0.4
  egyetlen megjelenést definiál; szükség esetén a token-rétegben vezethető be.
- Parkoló-ötlet: a `decisions.note` strukturált (kulcs+param) tárolása a
  kétnyelvű audit-trailhez — most szándékosan adat marad.

## 6. „Kész, ha" státusz

| Feltétel | Státusz |
| --- | --- |
| Audit-fájl létezik, a jelentés hivatkozza | ✅ (1. szakasz) |
| Teljes felület HU/EN, cookie-perzisztencia; i18n:check üres | ✅ (3. szakasz) |
| Alap-chrome tokenekből, literál hex nélkül; fontok next/font-tal | ✅ (a default Tailwind-paletta kiütve — palettaszín nem is fordul) |
| Seed idempotens; demo-projekt látszik a felületen | ✅ (3. szakasz — lokális stack; éles: felhasználói futtatás) |
| Build zöld; commit-bontás audit/tokenek/i18n/seed | ✅ (2. szakasz; + önellenőrzés-fix és jelentés commit) |

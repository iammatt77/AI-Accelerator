# Záró jelentés — Coding-csomag #5b: Projektdokumentáció tár + md-export (2026-07-13)

Spec: AICON_Coding_csomag_5b_Projektdokumentacio_tar (Approved). Branch: `dev`.
A csomag SÉMA-MENTES — csak olvas és renderel; migráció nincs. Kanonikus név:
„Projektdokumentáció tár" / „Project documentation hub". A tár szerkezete a
későbbi „részlegesen töltött, mindig létező draft" modell fogadó-váza —
v1-ben read-only előkészítés (placeholder-sorok, auto-draft létrehozás NINCS).

## 1. Leszállított lépések (commit-bontás)

| Lépés | Commit | Tartalom |
| --- | --- | --- |
| 1. Tár | `6eeb53e` | `/project/[id]/documents` — deliverable-központú (egy sor = egy típus), fázis-szekciók P0→P6; lokalizált típusnév + fázis-badge + fej-verzió + státusz-pill (ikon+szöveg) + teljesség-pill a hiányzó kötelező mezők név szerinti listájával (tooltip + inline) + updated_at + megnyitás/export; placeholder-sorok DB-írás nélkül; ad-hoc típusok külön szekcióban „teljesség: —" jelöléssel; kibontható verzió-történet; 1c üres állapotok |
| 2. Export | `6e0cd96` | Route handler: `GET /project/[id]/artifact/[artifactId]/export` → text/markdown attachment; approved-only SZERVEROLDALI őr (közvetlen URL-re is, graceful 403/404); fejléc-blokk + body + „Források" függelék a source_input_ids sorrendje szerint; ASCII fájlnév kézi ékezet-transzliterációval |
| 3. Belépők | `d28693f` | Cockpit „legutóbbi artefaktumok" kártya → „Projektdokumentáció tár →"; export-gomb az approved szerkesztő-olvasó nézeten; breadcrumb a meglévő mintával; a Könyvtár nav-placeholder érintetlen |
| 4. Önellenőrzés | (ez a commit) | review-javítás + záró jelentés |

## 2. Önellenőrzés eredményei

Lokális stack (PostgreSQL 16 + PostgREST-shim + Next.js dev `MOCK_LLM=1` +
Playwright/curl); az éles Supabase a sandboxból nem érhető el.

### A tár — seedelt charter + üres/EN állapotok

- **Seedelt charter a tárban:** Approved-pill (ikon+szöveg), **5/5 kötelező
  kitöltve**, v1, verzió-történet 1 elemmel, Export- és Megnyitás-akciók. ✓
- **Üres fázisok (P1–P6):** halk (1c) üres állapot — várt viselkedés, amíg
  csak a charter-típus konfigurált. ✓
- **EN locale:** „Project documentation hub" cím + „Project charter"
  lokalizált típusnév (az 5a-ban bevezetett lokalizációval). ✓

### Export — tartalom-ellenőrzés

- **Seedelt charter (forrás nélkül):** HTTP 200, `content-type:
  text/markdown`, `content-disposition: attachment;
  filename="ai-felmeres-panaszkezeles_projekt-charter_v1.md"` — karakterre a
  spec-minta. Fejléc-blokk (projekt · Kovács Nyomda Kft. · típus · v1
  (Approved) · dátum) + a body; **Források függelék NINCS** (nincs forrás). ✓
- **Fixture-lánccal készült, forrásos artefaktum** (MOCK_LLM walkthrough,
  37/37 PASS — egyben #5a-regresszióteszt): az export **„## Források"
  függelékkel** érkezik, `[1] → Interjú-jegyzet — ügyvezető`, `[2] →
  Folyamatvázlat-jegyzet` — a megfeleltetés a source_input_ids sorrendje
  szerint HELYES, a kézzel szerkesztett body ment ki. ✓
- **Nem-approved verzió közvetlen URL-lel:** HTTP **403**, lokalizált
  szöveges elutasítás (HU/EN cookie szerint), **nem 500**; nem létező
  artefaktum → 404. ✓

### Placeholder-mechanizmus (DB-írás nélkül)

- **(a) Csupasz projekt:** a P0 charter-sor „Még nincs elkezdve" állapottal
  + CTA a P0 munkaterületre; a projektben **0 artifacts-sor** — a
  placeholder nem ír DB-t. ✓
- **(b) Konfig-injektálás:** ideiglenes (nem commitolt) P1-típussal a P1
  szekcióban placeholder-sor + „Ugrás a(z) P1 munkaterületére" CTA — a
  mechanizmus fázis-független; a konfig visszaállítva (git-tiszta). ✓

### Ad-hoc típus (adat nem tűnhet el)

Teszt-adattal (konfigon kívüli `Ad-hoc jegyzet` sor): megjelenik az
„Egyéb — fázis nélkül" szekcióban, **„teljesség: —"** jelöléssel; a
teszt-sor törölve. ✓

### Build + i18n

- `npm run build`: **zöld** (TS strict 0 hiba, 13 route — az új tár- és
  export-útvonallal).
- `npm run i18n:check`: **üres diff** — 262 kulcs, mindkét nyelven azonos
  készlet; a tár neve kanonikus mindkét nyelven.

### Review (többlencsés, adverszáriális ellenőrzéssel)

4 lencse (hub-adathelyesség · export-biztonság · UI/i18n/design ·
regresszió #1–#5a) párhuzamos al-ügynökökként az `a5cd204..HEAD` tartomány
felett; minden lelet adverszáriális ellenőrzőhöz került (cáfolásra utasítva).

**4 lelet → 1 megerősítve és javítva, 3 elvetve.**

| Súly | Megerősített lelet | Javítás |
| --- | --- | --- |
| alacsony | A forrás-lekérés hibáját az export némán elnyelte → 200-as, de csonka deliverable ([n] jelölők a body-ban, függelék nélkül) | A hiba graceful 503-at ad („A források lekérése sikertelen — próbáld újra.", HU/EN) — csonka export nem születhet |

Elvetett leletek: az artifacts-lekérdezés hibakezelése a #3/#4-ben rögzült
oldal-konvenciót követi (az „adat nem tűnhet el" szabály a konfig-szűrésre
vonatkozik, és teljesül); a Draft-pill lilája a szentesített státusz-lexikon
(a 3. törvény az AKCIÓ-akcentust köti döntési pontokhoz; a token-értékek
fogyasztandók, nem módosíthatók — hub-only eltérés fragmentálná a
lexikont); a sor-szintű export a „csak Approved exportálható" szabály
szerint HELYESEN a legfrissebb approved verziót tölti, és a fájlnév + a
dokumentum-fejléc explicit jelzi a verziót (polírozási javaslat →
parkoló). A regressziós lencse leletet nem adott: route-ütközés nincs, a
séma-mentes megkötés teljesül (supabase/, src/lib/llm, állapotgép,
seed/reset, Könyvtár-placeholder, package.json érintetlen).

A javítás után: build + i18n:check zöld, a forrásos és forrás nélküli
export újra-ellenőrizve (200 + helyes függelék), a teljes #5a-lánc
walkthrough újrafuttatva **MINDEN PASS**.

## 3. Kezelt eltérések

- **Export-tartalom nyelve:** a spec fejléc-blokkja „lokalizált típusnevet"
  említ; az export ehelyett UI-nyelvtől FÜGGETLENÜL, fix magyarul készül
  (a generált body nyelvi védőkorlátjának kiterjesztése: a deliverable
  nyelve nem függhet attól, milyen nyelvű felületről kattintották az
  exportot). Csak a böngészőben megjelenő elutasító üzenet lokalizált.
- **Route-konvenció:** a spec példája `/projects/[id]/documents`; a repo
  konvenciója `/project/[id]/…` — ehhez igazodtunk:
  `/project/[id]/documents`.
- **Workflow-futtató:** a review az #5a-nál bevált párhuzamos al-ügynökös
  metodikával futott (az orchesztrátor a session konténer-újraindításai
  miatt nem indult).

## 4. Parkoló-lista (nem e csomag scope-ja)

- Auto-draft létrehozás + AI-completeness réteg (a tár fogadó-váza kész).
- Info-morzsa → deliverable many-to-many megjelenítés.
- docx/pdf export; szűrők/keresés a tárban.
- A sor-szintű export-gomb verziószám-jelzése („Export v2 (.md)") —
  polírozás, a review elvetette mint hibát.
- Oldal-szintű DB-hiba vs. üres állapot megkülönböztetése (kódbázis-szintű
  konvenció-döntés, nem #5b-lokális).

## 5. Nálad zárandó (Máté)

**Migráció NINCS** — a csomag séma-mentes. Csak:

1. `git pull` a dev-en → Preview-deploy.
2. **Tár megnyitása:** cockpit → „Projektdokumentáció tár →" — a charter
   sora Approved · 5/5 · verzió-történettel; P1–P6 halk üres állapot (várt).
3. **Export-letöltés:** a tár-sorból vagy az approved olvasó nézetből —
   a fájlnév ASCII (ai-felmeres-panaszkezeles_projekt-charter_v1.md), a
   tartalom fejléc + body (+ Források függelék, ha az artefaktumnak van
   forrása).
4. **Placeholder-CTA:** egy friss (charter nélküli) projekt tárában a
   „Még nincs elkezdve" sor CTA-ja a P0 munkaterületre visz.

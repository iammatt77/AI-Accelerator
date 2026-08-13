# Záró jelentés — címke-elcsúszás: tartalom-lenyomat + jelölés (0020)

**Dátum:** 2026-08-13 · **Branch:** `dev` · **Döntés:** Máté, 2026-08-13
**Előzmény:** a státusz-vizsgálat (olvasás-csak) feltárta a rést; a döntés
lenyomat + jelölés — NEM nézet-szűkítés, NEM néma érvénytelenítés.

## A rés és a megoldás

A cédula horgonya (`block_id` VAGY `artifact_id+field_key`) stabil marad a
szöveg átírásakor → a T1-ben készült címke némán rátapadt a T2-ben átírt
szövegre. Pontosan a draft/in_review dokumentumok szerkeszthető mezői
érintettek (az approved mezők minden írási úton be vannak fagyasztva). A
kötegelt futtatás ráadásul csak a címke NÉLKÜLI elemeket vette, tehát
magától sosem tért vissza. Ez ugyanaz az elavulás-osztály, amit a rendszer
máshol már kezel — itt hiányzott.

**Megoldás négy rétegben:**

1. **Lenyomat (0020):** a `knowledge_label_signals.content_fingerprint`
   eltárolja, MILYEN SZÖVEGRE készült a címke. A forma a MEGLÉVŐ
   `contentFingerprint()` (sha256-hex a normalizált szövegről,
   `anchor.ts`) — ugyanaz, amit a 0017 `knowledge_dismissals` sticky
   elutasítása használ. Nincs új mechanizmus. *(A
   `knowledge_embeddings.content_text` teljes-szöveg formáját megnéztem:
   ott az újra-embed miatt kell a teljes szöveg; itt csak összevetés kell
   — a hash kompaktabb, és a dismissals-precedens pont erre való.)*
2. **Derivált detektálás:** `isLabelStale()` — a jelenlegi cédula-szöveg
   lenyomata ≠ a tárolt lenyomat. Nem perzisztált flag (ugyanaz az elv,
   mint a `render_stale`); a szerver számítja, a kliens kész booleant kap.
3. **Jelölés:** ⟳ „ELAVULT CÍMKE" amber jelvény (a meglévő StaleFlag
   vizuális nyelvén, de „Ellenőrizve" akció nélkül — ezt nem nyugtázni
   kell, hanem újracímkézni); magyarázó doboz az olvasó-panelen; ⟳ glif a
   felülvizsgálati ablak-sorban + amber sáv a fókusz-kártyán a döntés
   előtt; nudge-sáv darabszámmal; új Státusz-szűrő. **A régi címke végig
   látható marad.**
4. **Újracímkézésbe vonás:** a köteg-futtatás futtatandó listája =
   címkézetlen VAGY elcsúszott. Az NF2 fokozatosság változatlan; a
   futtatás-üzenet kimondja: „Ebből {n} újracímkézés (elavult besorolás)."

**Graceful bevezetés:** a lenyomat-oszlop NULLABLE, és a NULL jelentése
„nem tudjuk, mire készült" — NEM „elcsúszott". A meglévő címke-sorok
visszamenőleg nem jelölődnek; a lenyomat a következő címkézéskor magától
feltöltődik.

**Szemantikai döntés (dokumentálva a kódban):** a kézi javítás
(`applyLabelCorrection`) NEM frissíti a lenyomatot — egy dimenzió emberi
feloldása nem jelenti, hogy a többi (gépi) címke a friss szövegből
készült. Újracímkézéskor az emberi dimenziók változatlanul védettek (F4),
a lenyomat pedig a friss szövegre áll.

## Migráció — MEGÍRVA, ÉLESBEN NEM FUTOTT LE

`supabase/migrations/0020_label_content_fingerprint.sql` — egyetlen
nullable oszlop + comment; lokálisan kétszer futtatva idempotens. **Máté
futtatja kézzel a Supabase SQL-editorban** a deploy előtt.

## Verifikáció — MI MOCK ÉS MI VALÓS

**MINDEN futás MOCK** (MOCK_LLM=1 + MOCK_EMBEDDINGS=1, lokális PG16 +
PostgREST-shim). A csomag a címkézés LOGIKÁJÁT nem érinti (konfidencia,
küszöb, önkonzisztencia változatlan) — a lenyomat-írás és az összevetés
determinisztikus, LLM-től független, ezért valós-LLM próbát nem igényel.

### A) Headless engine-teszt (`verify-drift`): 14/14 ✓

- címkézés → a lenyomat íródik, formája bitre azonos a
  `contentFingerprint(szöveg)`-gel (dismissals-konzisztencia)
- érdemi átírás → elavult; érintetlen szöveg → NEM (nincs hamis pozitív)
- **whitespace/formázás-változás → NEM elavult** (normalizált lenyomat:
  trim + belső whitespace — a vizuális átformázás nem tartalom-változás)
- lenyomat nélküli régi sor (NULL) és a címke nélküli elem → nem elavult
- újracímkézés az új szövegre → a lenyomat frissül, a jelölés megszűnik
- kézi javítás után az elem elavult MARADHAT (a lenyomat nem frissül);
  újracímkézéskor az emberi modalitás túlél (F4), a lenyomat frissül

### B) UI-walkthrough (`walk-drift`, Playwright): 23/23 ✓

A MOCK-rés fixtúra: 49 lenyomat NÉLKÜLI meglévő címke (a graceful-próba
valós anyaga) + egy DRAFT Engagement-terv megerősített `stakeholder_kor`
mezővel — pont a szerkeszthető, elcsúszás-veszélyes eset.

- **Graceful:** 49 régi címke mellett a betöltéskor NULLA jelvény, nulla
  nudge — semmi nem jelölődik visszamenőleg
- címkézés (1 új elem) → lenyomattal születik; az üzenet nem állít
  újracímkézést
- a mező SQL-átírása (a draft-szerkesztés adat-hatása) → „ELAVULT CÍMKE"
  jelvény a kártyán, nudge-sáv (1 elem), magyarázó doboz az olvasóban, a
  RÉGI címke (modalitás + besorolás-tábla) látható marad
- Státusz-szűrő „elavult címke" → pontosan 1 találat
- felülvizsgálat: ⟳ az ablak-sorban + amber sáv a fókusz-kártyán a döntés
  előtt (az elem kétes is volt, így a sorban volt)
- újrafuttatás → az elcsúszott elem magától bekerül; az üzenet: „1 elem
  címkézve… Ebből 1 újracímkézés (elavult besorolás)."; a jelvény és a
  nudge eltűnik; a DB-lenyomat az új szövegre frissült
- **approved-befagyasztás:** az approved dokumentumok mezői végig
  jelöletlenek. Az „approved mező nem csúszhat el" állítás mechanizmus-
  szintű: elcsúszás csak írásból születhet, és approved dokumentumra
  nincs írási út (`editable = status === "draft"` a PhaseWorkspace-ben;
  a modul-szinkron is csak nem-approved-ra ír — kódban ellenőrizve)
- regresszió: elemszám változatlan, a 4.2 böngészés/felülvizsgálat megy

*(A teszt-iteráció két tanulsága — mindkettő teszt-oldali, nem
termék-hiba: a Playwright `text=` case-insensitive, így a jelvény-keresés
a szűrő kisbetűs opcióját is megtalálta → case-sensitive regex; a
review-jelölés ellenőrzése a fókuszba-navigálás UTÁN érvényes.)*

## Számszerű hatás (LOKÁLIS)

| | |
|---|---|
| Meglévő címke-sor lenyomat nélkül | 49 — egyik sem jelölődött (graceful) |
| Új/újracímkézett sorok | lenyomattal születnek; élesen a következő futtatások töltik fel |
| A 4.2 felület elemszáma | változatlan (38 a fixtúrával) |

## Kapcsolódó, NEM e csomag scope-ja

- A 4.3-ra váró szűrő-igény (réteg-jelentés) változatlanul él; az
  elcsúszás-lenyomat a 4.3-nak is hasznos lesz (a `knowledge_dismissals`
  fingerprint-összevetése ugyanerre a formára épül).
- Az embedding-ek elcsúszása (a vektor is a régi szövegre készült): az
  újracímkézés ma újra-embedel (a labelOneItem útja), tehát az elcsúszott
  elem futtatása a vektort is frissíti — külön teendő nincs.

## Kész-ha státusz

- A címke-sor tárolja, milyen szövegre készült: ✓ (0020 + labelOneItem)
- Derivált detektálás, nem perzisztált flag: ✓ (isLabelStale, render_stale-elv)
- Jelölve a böngészőben ÉS a felülvizsgálati sorban, a régi címke látható: ✓ (D1–D6, R2–R3)
- Az elcsúszott elemek bekerülnek az újracímkézésbe: ✓ (U1–U2, NF2 megőrizve)
- Lenyomat nélküli sorok nem jelölődnek hamisan: ✓ (G1–G3, 49 sor)
- Nincs regresszió a 4.2 funkciókon: ✓ (A2 + a futtatás-út végig zöld)

## Takarítás

`.env.local` törölve; PG + shim + dev-szerver leállítva; a verifikációs
fájlok (`verify-drift`, `walk-drift`) a session-scratchpadban maradtak, a
repóba nem kerültek. A drift-fixtúra a LOKÁLIS teszt-DB-ben él.

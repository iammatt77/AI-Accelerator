# Záró jelentés — Katalógus-böngésző újraépítés (17 · 4.2 UI)

**Dátum:** 2026-08-11 · **Branch:** `dev` · **Design-referencia:** AICON_17 (1a/1b/1c)

## Commitok

| Commit | Egység |
|---|---|
| `5970db9` | #17/0 Backend compliance check (NINCS STOP; 4 kérdés megválaszolva) |
| `6fc4b73` | #17/1-3 Újraépítés: browse-lib + page + actions + 4 komponens + i18n |
| *(ez)* | #17/4 claim/formázás-finomítás + verifikáció + záró jelentés |

## Mi épült (a design → megvalósítás)

**Átkeretezés:** egy tudáselem EGY ÁLLÍTÁS. A sor domináns szövege az állítás
(`claimOf`: a tartalom-hordozó típusoknál — pain_point, use_case, requirement,
artifact_field, eval_case — a TARTALOM, nem a rövid név/technikai kulcs);
alatta egy sorban a modalitás-chip (◆ § → ↺ ?) + az EREDET
(ügyfél · fázis · [név/mező] · forrás-dokumentum — személy · dátum).

- **1a Böngészés:** hatókör-csoportok (darab + kétes szám, összecsukható);
  6+1 szűrő (modalitás/hatókör/fázis/forrás-szint/nyelv/érvényesség + státusz)
  + keresés; olvasó-panel (Eredet-kártya, Bizonyíték-idézet a reason-nel,
  Besorolás-tábla mind az 5 dimenzióval — a hiányzó „nincs megadva" —,
  konfidencia/szavazatok, Megnyitás a forrásban + Besorolás javítása +
  Újracímkézés). **Alapérték-elnyomás adat-vezérelt:** a szűrt listán számolt
  többségi org/lang érték nem kap chipet, csak az eltérés; az érvényesség
  csak akkor chip, ha VAN (a „nincs időhorizont" sosem sor-elem).
  **A kétes jelvény megnevezi a dimenziót** (KÉTES · MODALITÁS/…), több kétes
  dimenziónál `+n`.
- **1b Felülvizsgálat:** külön mód (fül + sárga hívó-sáv). Belépéskori
  PILLANATFELVÉTEL-sor (elem × kétes dimenzió párok) — a mentések nem
  rendezik át menet közben. Fókusz-kártya: eredet-sor, nagy állítás,
  bizonyíték-idézet, „KÉTES DIMENZIÓ" + kérdés + a címkéző `reason`-je mint
  emberi nyelvű indok, jelölt-opciók szavazat-sávval (a gépi jelölt az
  alapértelmezett), „a többi dimenzió rendben" sáv + Módosítás (a teljes
  űrlap). **Billentyűzet: 1–5 választ · ⏎ megerősít · S kihagy · ⌫ vissza ·
  Esc kilép.** Haladás (n / össz + ~perc); a döntés AZONNAL mentődik az új
  `resolveDimensionAction`-nel — ami a meglévő `applyLabelCorrection` vékony
  burkolója (approveDoubtful:false → a többi kétes dimenzió érintetlen); a
  kihagyás nem ír semmit.
- **1c Szélsőségek:** üres katalógus (magyarázat: mi a tudáselem + valós
  forrás-darabszám + linkek a Forrásokra/munkaterületre); nulla találat
  (a legszűkítőbb szűrő megnevezve + elhagyás-javaslatok VÁRHATÓ
  találatszámmal + páros javaslat + összes törlése); hosszú állítás
  3-soros vágás + kibontás/összecsukás; sűrűség-váltó (kényelmes/tömör —
  a tömörben a kétes állapot ponttá zsugorodik).
- **Konfliktusok fül:** helyhagyó, letiltott — NEM épült meg (4.3 terület).
- **tstzrange-formázó** (`formatValidTime`): a tárolt érték OLVASHATÓ alakja
  („2024", „2023–2026", „2025. 07. 01-től") — csak formázás, nem kitalált
  adat; ismeretlen alaknál a nyers szöveg marad.

## Nem változott (a csomag tiltásai szerint)

Címkézés-logika (konfidencia/küszöb/önkonzisztencia), kötegelt futtatás
(változatlanul a fejlécben, skip-listával), 4.1 adat-réteg (csak OLVASÁS
bővült: input_items/artifacts/clients), 2.1 katalógus-nézet, Epic 3 UI,
javítás-napló és összegzése.

## Verifikáció — **MOCK-alapú** (MOCK_LLM=1 + MOCK_EMBEDDINGS=1)

**Harness-újraépítés:** a sandbox-konténer a csomagok között újraindult —
PG16 user+adatkönyvtár, node_modules, shim mind elveszett. Újraépítve:
initdb + MIND a 18 migráció sorban (pgvector apt-ból) + idempotens seed +
újraírt PostgREST-shim (eq/is/in/order/limit + upsert + HEAD-count).

**Fixtúrák (a MOCK-rés elv szerint):** 20 katalógus-elem — mindegyik
modalitás; as_is/normativ borderline (3/2 szavazat); rövid szöveg; év
nélküli határidő; kevert HU/EN; attribuálhatatlan forrás; 380+ karakteres
állítás; eredet nélküli tétel (üres source_input_ids); interjúalanyos forrás
(input.stakeholder_source_id); 5 artifact_field cédula (technikai kulcs +
tartalom); 9 elem egy csoportban; ÜRES katalógus külön projektben.

**Eredmény: 38/38 Playwright-ellenőrzés zöld** (A böngészés-anatómia 18 ·
B felülvizsgálat 10 · C szélsőségek 5 · D regressziók 5) + DB-assertek:
a felülvizsgálati döntés naplózva (dimension/old/new/was_doubtful), a
metaadat a választott értékre áll, a dimenzió `ember` eredetű + accepted,
a kétes-állapot újraszámolt; a szerkesztés-mentés és az F4 (gépi
újracímkézés nem írja felül az embert) regressziója zöld; NF2 (ismételt
futás nem címkéz újra) zöld. Build + tsc + i18n:check (2029 kulcs, HU/EN
paritás) zöld.

**Menet közben talált és javított hibák:**
- `claimOf` első verziója a pain_point/use_case soroknál a rövid NEVET
  mutatta állításként — a hosszú-szöveg fixtúra buktatta le; javítva
  (tartalom-hordozó típusoknál excerpt-first).
- `formatValidTime`: a PG `+00` offset-alakját a JS `Date` nem parseolja —
  a formázó némán a nyers szöveget adta vissza; javítva (offset-normalizálás).

**Ami MOCK:** minden LLM-válasz és embedding. **Ami valós:** a teljes adatút
(PostgREST-szemantika, séma, tstzrange-kanonizálás), az eredet-feloldás, a
csoportosítás/elnyomás/javaslat-számítás, az akciók és a UI.

## Tudatos eltérések a designtól (adat-hiány, compliance szerint)

1. **Multi-projekt Könyvtár-nézet** („248 elem · 4 projekt", projekt-szűrő):
   a felület a meglévő projekt-szintű helyén épült újra; az eredet-sor a
   projektet mutatja. Globális nézet → parkoló.
2. **KE-0142 azonosító:** nincs ilyen számozás — nem mutatunk kitalált ID-t
   (az olvasó-panel fejlécében a blokk-típus áll).
3. **„átirat 41. bekezdés" lokátor:** az idézet megvan, a pozíció nincs
   tárolva — a „Megnyitás a forrásban" a Források oldalra visz.
4. **„Elem elvetése"** gomb: nem 4.2-képesség (derivált nézet) — kimaradt.
5. **„Kinyerés indítása"** üres-állapot CTA: nálunk a cédulák jóváhagyással
   keletkeznek — a CTA a Forrásokra/munkaterületre mutat, a forrás-szám valós.

## Parkoló / Máté figyelmébe

- **scripts/seed.ts friss DB-n elbukik**: az input_items-be group_id nélkül
  szúr be, a 0013 óta az NOT NULL (a meglévő környezetekben a backfill
  megoldotta; friss telepítésen hibázik). A harnessben lokális defaulttal
  kerültem meg; a seed-script igazítása egy sor, de e csomag scope-ján kívül.
- Globális Könyvtár → Tudáselemek nézet (multi-projekt) — külön csomag.
- A felülvizsgálat "Elem elvetése" akciója a 4.3-mal együtt gondolandó át.

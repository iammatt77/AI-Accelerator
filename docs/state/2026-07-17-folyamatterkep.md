# Záró jelentés — #10 Folyamattérkép-modul (AS-IS / TO-BE)

**Dátum:** 2026-07-17 · **Branch:** dev · **Ref:** ref_folyamatterv.html (vizuális igazságalap)
**Commitok:** `#10/1` 0008 migráció + lib · `#10/2` generálás (996a4fa) · `#10/3` megjelenítés (6400129) · `#10/4` chat-szerkesztő (c22a548) · `#10/5` jóváhagyás/verziózás + verifikáció (ez a commit)

Új funkcionális modul (nem redesign): az AI nyers leiratból bejárható
folyamattérképet épít (AS-IS), fájdalompontokból + AS-IS-ből TO-BE-t javasol,
a tanácsadó chaten korrigál, végül egyben hagy jóvá. HITL végig; a nyers
forrás SOHA nem íródik felül.

---

## 0) Backend-egyezés (a csomag előírt első lépése)

| Réteg | Állapot | Döntés |
|---|---|---|
| Nyers bemenetek | VOLT — `input_items` + [n] citáció-infra | újrahasznosítva (source_input_id + node-onkénti [n] forrás-ref) |
| Fájdalompontok | VOLT — `pain_points` (E1) | TO-BE-javaslat bemenete (nem-elvetettek) |
| Státusz/verzió | VOLT — `artifact_status` + verzió-minta | átvéve (draft→approved, (project,kind)-onkénti verziószám) |
| LLM-csatorna | VOLT — `lib/llm` adapter + MOCK_LLM | 3 új fn ugyanazon az adapteren (extractProcessMap, suggestToBeProcess, chatEditProcess) |
| Folyamatterv-entitás | NEM VOLT | **0008**: `process_maps` (jsonb nodes/edges — az `artifacts.fields` mintája szerint, nem külön node/edge tábla) |
| Adatmodell-háttér | NEM VOLT | ref szerint SZÜRKE/INAKTÍV („HAMAROSAN") — NINCS backend-kötés |

## 1) Fázisonkénti szállítás

**#10/1 — Migráció + lib.** `0008_process_maps.sql` (idempotens, 2× lefutott
+ `notify pgrst`): jsonb `nodes`/`edges`, `kind` (as_is/to_be), `to_be_origin`
(document/ai_suggested), `original_snapshot` (változáskövetés-alap),
`chat_log`. Lib: `processmap/model.ts` (típusok, TÍPUS-STÍLUS regiszter
fallback-kel — **a készlet nem bedrótozott**, ismeretlen típus semleges
stílusra esik; determinisztikus BFS-layouter a ref elrendezés-mintájával;
él-geometria; computeDiff), `processmap/parse.ts` (defenzív LLM-parse + jsonb→gráf).
Egységteszt: 27/27 ✓ (Fázis 1) — a modell-libre.

**#10/2 — Generálás.** AS-IS leiratból (szó szerinti idézet + [n] + hely
minden lépésen; <40 karakteres forrásra üres javaslat — nem tippel); TO-BE
két eredettel: dokumentumból (ugyanaz a belépő, kind=to_be) és ✦ AI-javasolt
(fájdalompontok + AS-IS lépéslista; ai_intervention + control_hitl node-ok;
a quote eredet-megjelölés; „TILOS számszerű hatást kitalálni" a promptban).
Mentéskor `original_snapshot` = a generált állapot.

**#10/3 — Megjelenítés (ref-hű).** Léptethető térkép: fit ⇄ fókusz (1,3×)
kamera a ref math-jával, húzható vászon, döntés=rombusz / start-end=pill,
ág-választás a panelben, lila bejárt út + breadcrumb + „Utolsó döntés"/
„Újraindítás". Inspector 3 állapotban: áttekintő (SZÁRMAZTATOTT kulcsszámok
— lépés/döntés/AI+HITL/nyitott pont, nem fabrikált metrika), lépés (típus-chip,
FORRÁS-HIVATKOZÁS doboz „Megnyitás a nyers leiratban" ugróval, szürke
ADATMODELL-HÁTTÉR „HAMAROSAN" váz, NYITOTT PONTOK szint-színekkel), compare
(⇄: két mini-térkép + „Mi változik" +/− lista; VÁRT HATÁS: „Nincs metrika-kötés
— … itt nem becsülünk számot"). Csak olvasható nyersleirat-overlay idézet-
kiemeléssel (±160 karakter kontextus). Jelmagyarázat-overlay.

**#10/4 — Chat-szerkesztő (HITL).** `chatEditProcess` az adapteren:
strukturált változás-javaslat (insert_after / update / remove) — a nyers
forrást nem látja és nem érinti. A javaslat PENDING a `chat_log`-ban;
az ember alkalmaz vagy elvet. Alkalmazás: determinisztikus gráf-műtét
(él-átkötés ág-feliratok megtartásával, CHAT forrás-ref + dátum, diff_note),
újra-layout. Drawer a ref szerint (420px, javaslat-kártya op-jelvényekkel,
composer, HITL-jegyzet). Diff-sáv az aktív terven (AS-IS chat-diffre is).
A bezárót a viewer contexten adja át (RSC-határon függvény-prop nem klónozható
— cloneElement nem vitte át, ProcessChatCloseContext lett).

**#10/5 — Jóváhagyás + verziózás.** Egyben-jóváhagyás: a TELJES terv zárul
(zöld gomb a diff-sávban; diff nélkül a státusz-sorban). Jóváhagyás után:
chat rejtve + szerver-őr (`errChatApproved`), az `original_snapshot`
érintetlen. „Új iteráció indítása": v+1 draft a jóváhagyott állapot
másolatával, FRISS diff-alappal (snapshot = induló állapot, diff-jegyzetek
törölve, chat_log üres).

## 2) Kemény szabályok — igazolás

- **Nyers forrás soha nem íródik felül:** egyik akció sem ír `input_items`-t;
  a teljes chat-forgatókönyv után `md5(raw_text)` változatlan ✓.
- **HITL:** generálás → draft; chat → pending javaslat → emberi alkalmazás;
  jóváhagyás emberi és egyben; approved terv szerkesztése szerver-oldalon is tiltott.
- **Típus-készlet nem bedrótozott:** regiszter + semleges fallback; a prompt
  új snake_case típust engedélyez; unit-tesztelve.
- **Nem fabrikál:** kulcsszámok származtatottak; VÁRT HATÁS metrika-kötés
  nélkül jegyzetet mutat, nem számot; a TO-BE/chat-prompt tiltja a kitalált számot.
- **Adatmodell-háttér:** szürke, INAKTÍV, „HAMAROSAN" — nincs backend-kötés.

## 3) Verifikáció (lokális: PG16 + PostgREST-shim + prod build + MOCK_LLM)

| Ellenőrzés | Eredmény |
|---|---|
| 0008 migráció 2× | exit 0, notify pgrst ✓ |
| Modell-lib egységteszt (F1) | 27/27 ✓ |
| Chat-lib egységteszt (F5: parse/apply/diff/log) | 27/27 ✓ |
| tsc strict / prod build / i18n:check | 0 hiba / zöld / 1169 kulcs, HU=EN ✓ |
| Playwright — index + AS-IS generálás | ✓ (7 lépés, 1 döntés) |
| Playwright — teljes térkép + bejárás + ág-választás | ✓ („Igen · sürgős", 5/7 bejárva, breadcrumb) |
| Playwright — nyersleirat-overlay idézet-kiemeléssel | ✓ (csak olvasható) |
| Playwright — ADATMODELL-HÁTTÉR szürke „HAMAROSAN" | ✓ |
| Playwright — jelmagyarázat | ✓ |
| Playwright — TO-BE (AI-javasolt + dokumentumból) | ✓ (2+1 AI/HITL kulcsszám) |
| Playwright — ⇄ compare (+/− lista, VÁRT HATÁS jegyzet) | ✓ |
| Playwright — chat: javaslat → alkalmazás → diff | ✓ (+1 ÚJ · CHAT, 1 MÓDOSÍTVA; „Eredeti mutatása" rejti) |
| Playwright — jóváhagyás → zárolás → új iteráció (v+1) | ✓ (v1 approved: 9 node / snapshot 8; v3 friss alap 9=9) |
| overflow-x / backdrop-blur minden jeleneten | 0 / 0 ✓ |
| `md5(input_items.raw_text)` a chat-forgatókönyv után | változatlan ✓ |

Képernyőképek (harness, 17 db): index, AS-IS teljes/bejárás, overlay-ek,
TO-BE, compare, chat-javaslat/alkalmazva/diff-térkép/eredeti-nézet/CHAT-node-
inspector, jóváhagyott, v2-draft, verzió-lista.

## 4) Nálad zárandó (felhasználói teendő)

1. **Migráció:** a `supabase/migrations/0008_process_maps.sql` futtatása a
   Supabase SQL-editorban **a Preview előtt** (idempotens, egyben beilleszthető).
2. Preview-n: P1 projekt → Folyamattérkép → „AS-IS generálása a leiratból" →
   bejárás → TO-BE javaslat → chat-módosítás → jóváhagyás.

## 5) Parkoló-lista (nem e csomag scope-ja)

- Adatmodell-háttér élesítése node-onként (most szándékosan szürke váz).
- Folyamatterv-export (md/kép) és becsatolás a dokumentumtárba / P1 kapuba.
- Chat-szerkesztés AS-IS↔TO-BE közötti át-származtatás (re-suggest a v2-ből).
- Kamera-animáció finomhangolás prefers-reduced-motion ágra (most a globális
  oldalváltás-szabályt követi).
- Megjegyzés: a diff-sáv MEGJELENÍTÉSE már a #10/3-ban leszállt (a csomag a
  #10/5-höz sorolta); a #10/5 a jóváhagyás/verziózás felét tette hozzá.

## 6) Harness-jegyzet (nem repo-kód)

A lokális PostgREST-shim (scratchpad) két bővítést kapott: `process_maps`
a tábla-whitelistre, valamint jsonb-oszlop-felderítés (information_schema)
és JSON.stringify-kötés INSERT/PATCH-nél — a node-postgres a JS tömböt PG
tömb-literállá alakította volna („invalid input syntax for type json").
Éles Supabase/PostgREST-et ez nem érinti.

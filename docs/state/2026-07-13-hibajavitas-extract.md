# Hibajavítás — élő LLM-kivonatolás üres eredményt ad (2026-07-13)

Branch: `dev`. Commit: `687f1e0`. Migráció NINCS.

## 1. Tünet

A Preview-n az élő ② Feldolgozás (extract) MINDEN artefaktum-típuson üres
(missing) mezőket adott; 200-as státusz, látható hiba nélkül; a mezők
tényleg üresek, nem fixture-értékek.

## 2. Diagnózis — a regresszió NEM a #6-ban van

A jelentés a #6-ra és a fixture-általánosításra gyanakodott. A diff-alapú
vizsgálat ezt **kizárta**:

- `git diff a5cd204..HEAD -- src/lib/llm/index.ts`: a #6 csak a
  `generateBody`/mock-ágat és az importot érintette — az él-ág
  (`extract` → `parseExtractResult`) **bájtra azonos**.
- `git diff a5cd204..HEAD -- src/app/artifact-actions.ts`: **teljesen
  üres** (az extractAction, a forrás-számozás, a merge változatlan).
- A charter mezői (kulcsok, promptHintek) sem változtak — csak `gate`/
  `labelHu` metaadat került hozzájuk.

Vagyis a charter élő kivonatolásának teljes kódútja a5cd204 (#5a-tip) és
4b91d44 (#6-tip) között **változatlan**. A #6 szerkezetileg nem tudta
eltörni.

**A gyökérok a #5a legutolsó review-fixe (`a5cd204`)**: a
`parseExtractResult` fabrikáció-szűrője. Az akkori review-lelet („a
csak-érvénytelen citációjú érték a legerősebb fabrikáció-jel") javítása
túl agresszív volt: minden mezőt NULL-ra ejtett, amelynek forrás-indexei
nem egyeztek a számozással. Az élő modell eltérő index-konvenciói
(string `"1"`, 0-alapú `[0]`, tartományon kívüli `[9]`) mellett ez MINDEN
mezőt kidobott. Máté „működő #5a Preview-tesztje" ezt a review-fixet
megelőző deploy-ból való (≤ `f5c0a12`), ezért attribuálta a #6-nak.

## 3. Miért nem kapta el a #6 önellenőrzése (a vakfolt)

A `MOCK_LLM` fixture **nem megy át** a `parseExtractResult`-on —
`mockExtract` közvetlenül visszaad. Így a fixture-alapú walkthrough
(41/41 PASS) szerkezetileg SOHA nem hajtotta az él-parse-t. A jelentés
pontosan erre mutatott rá: „az él-ág regresszióját a fixture-teszt
szerkezetileg nem tudja elkapni."

## 4. Javítás

### 4.1 Gyökérok — a parse tesztelhetővé tétele + a szűrő javítása

- **`src/lib/llm/parse.ts` (ÚJ):** a tiszta válasz-feldolgozás
  (`parseExtractResult`, `stripCodeFences`, típusok) kiemelve az
  `index.ts`-ből — **`server-only` és SDK nélkül**, így önállóan
  tesztelhető. Az `index.ts` innen importál és re-exportálja a típusokat
  (a hívók `@/lib/llm`-ből importálnak — kompatibilis).
- **A valós értéket a parse SOSEM dobja el a forrás-indexek miatt.**
  Az új szabály (`normalizeIndices`): string→szám koerció (`"1"`→`1`, a
  citáció helyreáll); a nem-numerikus / tartományon kívüli / duplikált
  index kiesik, DE az **érték `ai_filled` javaslatként megmarad** (üres
  `source_indices`-szal). A „fabrikált érték" és az „érvényes érték rossz
  index-szel" külön eset — az utóbbinál csak a hamis citációt távolítjuk
  el, a döntést az emberre (E1) bízzuk. A hallucináció-tiltás a
  rendszerprompttal + a hiányzó forrás-jelölés jelzésértékével + a kötelező
  emberi megerősítéssel érvényesül.
- **MOCK igazítva:** a null-on-all-invalid ág törölve (a mock is a valós
  szabályt tükrözi); a charter-fixture a szponzort ÉS a sikerkritériumot
  adat-hiány miatt adja missing-nek (3/5 teljesség — a demonstráció
  megmaradt).

### 4.2 UX — a néma üres siker megszüntetése

Az extract 0-eredmény esetén némán, 200-zal, üres mezőkkel válaszolt.
Mostantól:

- `FormState.notice` (ÚJ, opcionális) — nem-hiba, de LÁTHATÓ amber jelzés
  (`role="status"`).
- `extractAction`: ha a javaslatok száma **0**, `notice`-t ad
  (`errors.extractNoResult`): „A feldolgozás lefutott, de egyetlen mezőhöz
  sem talált használható értéket…". A részleges eredmény (néhány mező
  jogosan missing) a normál eset — arra nincs jelzés.
- `ExtractForm`: `NoticeAlert` (amber) rendereli a `notice`-t.

Megkülönbözteti a „feldolgozva, tényleg nincs releváns tartalom" és a
„nem adott használható eredményt" esetet — nem néz ki sikeres üres
feldolgozásnak.

## 5. HOGYAN verifikáltam az ÉL-ágat (nem csak a fixture-t)

**A sandboxból élő API-hívás nem futott: nincs `ANTHROPIC_API_KEY`** (az
Vercel-env; az `api.anthropic.com` elérhető, de kulcs nélkül 401). Ezért
az él-parse-t **determinisztikusan, API nélkül** verifikáltam, valós
modell-kimenet-mintákon — pontosan a fixture vakfoltját zárva:

`npm run llm:parse-check` (`scripts/llm-parse-check.ts`) — az IGAZI
`parseExtractResult`-ot hajtja, és összeveti a régi (buggos) logikával:

| Modell-kimenet minta | RÉGI (buggos) | ÚJ (javított) |
| --- | --- | --- |
| numerikus, érvényes `[1]` / `[1,2]` | 5 mező | 5 mező |
| **string `["1"]`** (gyakori él-eset) | **0 mező** | 5 mező (citáció helyreáll) |
| **0-alapú `[0]`** | **0 mező** | 5 mező (érték marad, citáció üres) |
| **tartományon kívüli `[9]`** | **0 mező** | 5 mező (érték marad, citáció üres) |
| üres `[]` / hiányzó kulcs | — | érték marad |
| fenced ```json``` / prose+JSON | — | helyesen parse-ol |
| genuine missing (minden null) | 0 mező | 0 mező (→ UX-notice) |

A régi logika a három trigger-mintán bizonyítottan **0 mezőt** ad
(pontosan a Preview-tünet); az új mindhármon megtartja az értékeket.

Emellett a **fixture-walkthrough-ok** (a merge + mentés + megjelenítés +
kapu-integráció integrált útját fedik) a javítás után újra zöldek:
- `walkthrough5a` (charter fixture, teljes lánc): **MINDEN PASS**
- `walkthrough6` (17 új típus, valós kapuk): **MINDEN PASS**
- `npm run build` zöld · `npm run i18n:check` zöld (359 kulcs)

## 6. Nálad zárandó — Preview-füst-teszt (élő LLM)

Migráció/SQL NINCS: `git pull` → Preview-deploy, majd az élő modellel:

1. **Charter-lánc:** a demo- (vagy egy friss) projekt P0-ján adj hozzá egy
   valós, tartalmas jegyzetet (cél, scope, szponzor, időkeret,
   sikerkritérium infókkal) → ② **Feldolgozás**. **Elvárt:** a mezők
   AI-javaslatként kitöltődnek (nem üres!), a megtalált mezőkön forrás-
   jelölés `[1]`; ami tényleg nincs a jegyzetben, az missing marad.
2. **Más típus:** egy P1 shortlist vagy P2 Business case forrásanyaggal —
   ugyanígy: kitöltött AI-javaslatok, nem üres.
3. **Zero-result jelzés:** adj hozzá egy szándékosan irreleváns bemenetet
   (pl. néhány szó, ami semmit nem tartalmaz a mezőkből) → Feldolgozás.
   **Elvárt:** LÁTHATÓ amber jelzés („…egyetlen mezőhöz sem talált
   használható értéket…"), nem néma üres siker.

Ha bármelyik továbbra is üres mezőket ad **kitöltött** javaslatok helyett,
az már NEM ez a parse-hiba — akkor a modell tényleges válaszát kell
megnézni (a `console.error` a szerver-logban a parse-hibát jelzi), és a
`scripts/llm-parse-check.ts` bővíthető az új mintával.

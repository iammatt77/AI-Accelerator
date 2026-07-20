# D3 mező-leltár — Megoldás-dokumentáció & Tesztriport (2026-07-20)

**Típus:** read-only leltár. **Nincs kód-, séma- vagy migráció-változtatás.** Branch: `dev`.
**Cél:** a két D3 dokumentum minden mezőjéhez a valós **jelenlegi írója(i)**, a D3-partíció (minden mezőnek egy írója) jóváhagyásához. Partíciót NEM implementálok — csak leltár + tény-alapú besorolási javaslat. A döntés Mátéé.
**D3-elv (döntött):** modul-mező = csak a modul-sync írja (szerkesztőben read-only); doc-mező = csak a doc-oldali extract/kézi szerkesztés írja, a sync soha nem nyúl hozzá.

**Valódi kódnevek (a jelentés ezeket használja; a „új néven" formák a feladatból, a kódban MÉG NEM léteznek):**
- **„Megoldás-dokumentáció"** (type-kulcs `Megoldás-dokumentáció`, nameKey `megoldasDokumentacio`, EN „Solution documentation") — *javasolt új név: Megoldásterv / Solution Design*
- **„Tesztriport"** (type-kulcs `Tesztriport`, nameKey `tesztriport`, EN „Test report") — *javasolt új név: Kiértékelési riport*

**Írás-csatornák (kód):**
- **field-extract** — `extractAction`→`extract` (`artifact-actions.ts:129`): a nyers `input_items`-ből, MERGE (a `confirmed`/`manual` mezőt megtartja, az `ai_filled`/`missing` frissül). **Egyik D3-típus sem `entitySourced`** → a field-extract **NINCS tiltva** rájuk, tehát a típus **bármely** mezőjét írhatja.
- **modul-sync** — `syncDocAction` (`builddoc-actions.ts`) / `syncReportAction` (`goldenset-actions.ts`) a `syncField`-en át: az entitásokból, **feltétel nélküli felülírás** (`state:"manual"`, üresnél `missing`) — a megerősítettet is.
- **modul-AI-előtöltés** — `suggestResidualRiskAction` (`goldenset-actions.ts:759`): `ai_filled`-et ír (nem felülírás; az editor-HITL zárja).
- **kézi** — a szerkesztő `editFieldAction`/`confirmFieldAction` (→ `manual`/`confirmed`).

---

## 1. „Megoldás-dokumentáció" (Solution Design) — mező-tábla

Type `Megoldás-dokumentáció`; a `syncDocAction` a `komponensek` / `prompt_konyvtar` / `guardrail_hitl` mezőt írja (`builddoc-actions.ts:793–795, 803–805`).

| Mező (kulcs) | HU / EN | Köt.? | Ki írja MA | Forrás-entitás (ha modul) | Javasolt D3-besorolás + indok |
|---|---|---|---|---|---|
| `architektura` | Architektúra / Architecture | **kötelező** | **csak doc** (field-extract + kézi) | — | **DOC-mező** — ma nincs modul-sync; a `/builddoc` nem gyárt „architektúra" entitást |
| `komponensek` | Komponensek / Components | **kötelező** | **MINDKETTŐ ⚠** (syncDoc + field-extract) | `build_components` (display_id · név · réteg · eredet · megvalósít-kötések, `impl_links`-ből formázva) | **MODUL-mező** — ma a `syncField` írja az entitásokból; a modul a kanonikus tartalom-gazda |
| `prompt_konyvtar` | Prompt-könyvtár / Prompt library | **kötelező** | **MINDKETTŐ ⚠** (syncDoc + field-extract) | `prompt_items` (display_id · név · cél · komponens) | **MODUL-mező** — ma a `syncField` írja a `prompt_items`-ből |
| `guardrail_hitl` | Guardrail és HITL / Guardrails and HITL | **kötelező** | **MINDKETTŐ ⚠** (syncDoc + field-extract) | `control_points` (típus · név · leírás · TO-BE-kötés) | **MODUL-mező** — ma a `syncField` írja a `control_points`-ból |
| `uzemeltetesi_jegyzet` | Üzemeltetési jegyzet / Operations notes | opcionális | **csak doc** (field-extract + kézi) | — | **DOC-mező** — nincs modul-sync; szabad-szöveges üzemeltetési jegyzet |

---

## 2. „Tesztriport" (Kiértékelési riport) — mező-tábla

Type `Tesztriport`; a `syncReportAction` a `golden_set_eredmeny` / `atmenesi_arany` / `hibak_javitasok` mezőt írja (`goldenset-actions.ts:675–677, 685–687`).

| Mező (kulcs) | HU / EN | Köt.? | Ki írja MA | Forrás-entitás (ha modul) | Javasolt D3-besorolás + indok |
|---|---|---|---|---|---|
| `golden_set_eredmeny` | Golden set eredmény / Golden set results | **kötelező** | **MINDKETTŐ ⚠** (syncReport + field-extract) | `eval_cases` (összesítő: N eset · megfelelt/részleges/nem/nyitott · use case) | **MODUL-mező** — ma a `syncField` írja az `eval_cases`-ből |
| `atmenesi_arany` | Átmenési arány / Pass rate | **kötelező** | **MINDKETTŐ ⚠** (syncReport + field-extract) | `eval_cases` → `passStats` (pass% + `passed/total` + küszöb) | **MODUL-mező** — ma a `syncField` számolja az `eval_cases`-ből |
| `hibak_javitasok` | Hibák és javítások / Defects and fixes | **kötelező** | **MINDKETTŐ ⚠** (syncReport + field-extract) | `eval_cases` → `failedCaseLines` (bukott/részleges esetek) | **MODUL-mező** — ma a `syncField` írja a bukott esetekből |
| `maradek_kockazat` | Maradék kockázat / Residual risk | opcionális | **MINDKETTŐ ⚠ (más minta)**: `suggestResidualRiskAction` (modul-AI, `ai_filled`) + field-extract + kézi | `eval_cases` → `failedCaseLines` (LLM-összefoglaló) | **nem egyértelmű** — ma modul-AI (a Golden set-ből) **előtölti** `ai_filled`-ként, de az **editor-HITL a gazda** (emberi megerősítés, nem `syncField`-felülírás). Design-döntés: doc-mező AI-előtöltéssel VAGY modul-mező, ha a Golden set legyen a gazda |

---

## 3. Kétírós ütközések (H1/H2 konkrét helyei) + árva mezők

### Kétírós ütközés — MA mindkét csatorna írja (néma felülírás kockázata)
A `syncField` **felülírja** a mezőt (a megerősítettet is), a field-extract viszont **megtartja** a `manual`/`confirmed`-et → aszimmetrikus: **a modul-sync mindig felülír, a field-extract enged.**

**Megoldás-dokumentáció (H1):**
- `komponensek` — syncDoc (`build_components`) ⚔ field-extract
- `prompt_konyvtar` — syncDoc (`prompt_items`) ⚔ field-extract
- `guardrail_hitl` — syncDoc (`control_points`) ⚔ field-extract

**Tesztriport (H2):**
- `golden_set_eredmeny` — syncReport (`eval_cases`) ⚔ field-extract
- `atmenesi_arany` — syncReport (`passStats`) ⚔ field-extract
- `hibak_javitasok` — syncReport (`failedCaseLines`) ⚔ field-extract
- `maradek_kockazat` — **más minta:** `suggestResidualRiskAction` (`ai_filled`, nem felülírás) ⚔ field-extract — nem `syncField`-felülírás, de két AI-csatorna ugyanarra a mezőre

**Összesen 6 required mező + 1 opcionális mező érintett kétírós mintában.**

### „Csak doc" mezők (nincs modul-sync — nincs ütközés)
- `architektura` (kötelező), `uzemeltetesi_jegyzet` (opcionális) — csak field-extract/kézi.

### Árva mező (egyik csatorna sem írja biztosan)
- **Nincs valódi árva mező.** Minden mezőt ír legalább a field-extract + kézi csatorna. Megjegyzés: az `architektura` és `uzemeltetesi_jegyzet` **kizárólag** a doc-csatornából él (modul nem táplálja) — nem árva, de nincs entitás-fedezete.

---

## 4. Javasolt D3-partíció összefoglaló (tények alapján, döntésre)

| Dokumentum | MODUL-mezők (a sync a gazda, szerkesztőben read-only) | DOC-mezők (extract/kézi a gazda, sync nem nyúl hozzá) |
|---|---|---|
| **Megoldás-dokumentáció** | `komponensek`, `prompt_konyvtar`, `guardrail_hitl` (ma is syncDoc írja) | `architektura`, `uzemeltetesi_jegyzet` (ma sincs modul-sync) |
| **Tesztriport** | `golden_set_eredmeny`, `atmenesi_arany`, `hibak_javitasok` (ma is syncReport írja) | `maradek_kockazat` — **döntendő**: doc-mező (emberi megerősítés a gazda, modul-AI csak előtölt) VAGY modul-mező |

**Indok minden besoroláshoz a tényből:** ahol ma a `syncField` (modul-sync) az entitásokból ír → MODUL-mező (a partíció után a field-extract ne írja); ahol ma nincs modul-sync → DOC-mező (a partíció után a sync ne nyúljon hozzá). A `maradek_kockazat` az egyetlen, ahol a modul-csatorna nem `syncField`-felülírás, hanem `ai_filled`-előtöltés emberi megerősítéssel — ez **design-döntést** igényel (jelölve, nem tippelve).

---

**Semmi kód nem változott** — csak ez a jelentés-fájl készült a `docs/state/`-be. A mezők a `config.ts:288–302` `deliverable(...)` definícióiból (kulcs + required + HU label) és a `messages/*.json` `fields.solutiondoc`/`fields.testreport` névterekből (HU/EN); az írók a `syncDocAction`/`syncReportAction`/`syncField`/`suggestResidualRiskAction`/`extractAction` írás-pontjainak átvizsgálásából.

# Javító-csomag #2 — Document Editor: pontos implementáció a v2 referencia szerint (2026-07-14)

Branch: `dev`. **Nincs séma-migráció, nincs LLM-érintés.** CSAK a Document
Editor; a Phase Workspace, a sidebar és az app-chrome változatlan. Két izolált,
futtatható HTML-referencia (`ref_editor_1a_in_review`, `ref_editor_1b_approved`)
alapján — a színek/spacing/elrendezés az inline style-attribútumokból, nem
becslésből. A funkció változatlan (Draft→In review→Approved lánc, approve-blokk,
forrás-hivatkozás, verziózás).

## Mi volt a hiba, és mi változott

**Hiba:** a mezők + a body + a státusz-lánc egymás alá kerültek a középső
oszlopban → „kiterített végtelen szalag", a három oszlop nem volt egymás
mellett.

**Javítás — a ref elrendezése:** EGY üveg-konténer →
1. **fejléc** (breadcrumb + cím + státuszlánc-pillek jobbra + History/Export),
2. **blokkoló-sáv** (In review + hiányzó kötelező → amber, ugró-linkekkel),
3. **három oszlop egymás mellett, teljes szélességben**: FIELD MAP sín · a
   dokumentum (mező-szekciók + KOMPAKT, görgethető body-panel — `max-h`, nem
   kiterített szalag) · SOURCES sín,
4. **teljes szélességű lábléc**: HITL-jegyzet balra, Back/Approve jobbra
   (Approve letiltva + „— N mező hiányzik", ha van üres kötelező).
Approved (1b): két oszlop (dokumentum · VERZIÓK-sín), ready-to-close szalag,
nincs akció-lábléc (a módosítás új verziót igényel — a doksin jelezve).

Új: `EditorField.tsx` (ref-stílusú mező-szekció, a MEGLÉVŐ
confirm/edit/dismissFieldAction-nel). Az `ArtifactEditor` teljes átépítése az
egy-konténer + 3 oszlop + lábléc szerint. Az orphan `StatusChain` törölve (az
akciók a láblécbe költöztek). A `page.tsx` az azonosságot a konténerbe adja át
(clientName/phaseLabel/typeName/version/inputsCount/nextVersion).

## Színspec — a ténylegesen használt token/hex (a referenciából)

- **Blokkoló-sáv** (In review, hiányzó mező): `bg-tint-gate` fátyol + alsó
  `border-gate/40`, szöveg `text-gate` = `--status-gate` **#B4801E** (a ref
  `#FBF7EE`/`#EBD9B4`/`#9A6A12` amber tartománya). NEM piros.
- **Letiltott Approve**: `bg-neutral-150` + `text-ink-tertiary` (ref `#EDEEF3`/
  `#8B90A3`), felirat „Jóváhagyás — N mező hiányzik".
- **Field-map amber (hiányzó kötelező)**: `bg-tint-gate text-gate` + ☐; kész =
  `text-done` ✓ (**#3E9E6E**); aktív/kiemelt = lila (ref `#EDE6F7`/`#7A4FB0`).
- **Forrás-jelölő**: `text-pivot` = `--status-pivot` **#2E77A8** (mono [n]);
  idézet dőlt `text-ink-secondary`; a citált forrás `border-pivot` kiemelt.
- **Státuszlánc**: Draft/In review/Approved — az aktív TÖMÖR (in review
  `bg-gate` #B4801E, approved `bg-done` #3E9E6E, fehér), jövő = `bg-neutral-150`
  + lakat.
- **CTA-k**: Export PDF / „Ugrás a kapuhoz" = `bg-action` = `--action-primary`
  **#8458B3**; a „Vissza draftba" a mélyebb lila `text-action`; linkek
  `--action-deep` **#7A4FB0**.

## ÜVEG vs. TÖMÖR

A referencia statikus mockup (tömör fehér). Az implementációban a KONTÉNER a
rendszer **glass-tile** receptje (fátyol + blur + felső fény-él); az olvasó/
öröklött tartalom (mező-érték-dobozok, források, body) **süllyesztett**
(`card-sunken`, 6. törvény). Ez a rendszer állandó vizuális törvénye — a ref
színei/elrendezése + a rendszer felület-anyaga.

## Verifikáció (Playwright, a referencia mellett)

- **In review (blokkolt)** — fejléc-pillek (In review tömör amber) + blokkoló-
  sáv (2 kötelező üres + ugró-linkek + 2/4) + 3 oszlop egymás mellett + kompakt
  body + lábléc (HITL + „Vissza draftba" + letiltott „Jóváhagyás — 2 mező
  hiányzik"). **0 vízszintes túlcsordulás.**
- **Draft** — üres kötelező mezők a v2 szaggatott borostyán dobozban („Töltsd
  ki…" + „Kézi kitöltés"); kész mezők süllyesztett érték + E1-akciók; lábléc
  „Review-ra küldés".
- **Approved** — solid-zöld Approved + tömör lila Export/Kapuhoz + ready-to-
  close szalag + 2 oszlop (dokumentum · VERZIÓK-sín „Bármely két verzió
  összevethető").
- `npm run build` zöld · `tsc --noEmit` zöld · `i18n:check` üres (587 kulcs).

## Státusz-modell eltérés (dokumentált)

A ref 1a szaggatott „Write manually" mezői IN REVIEW-ban jelennek meg; a
rendszer KEMÉNY KORLÁTja szerint az in_review olvasható (a mezők DRAFTban
szerkeszthetők). Ezért a szaggatott borostyán „Kézi kitöltés" doboz a DRAFT
nézetben él; in_review-ban az üres kötelező a blokkoló-sávban + a mezőtérkép
amber jelölésével + a „kötelező · üres" státusz-szóval jelenik meg (a kitöltés
a „Vissza draftba" után). A per-mező „Draft a suggestion (you confirm)" AI-gomb
továbbra is FLAG (új server action + LLM) — a „Kézi kitöltés" a meglévő
szerkesztésre köt.

## Nálad zárandó

A Preview-n a két állapotot (In review / Approved) a két `ref_editor_*.html`
fájl mellett, pontról pontra. Ha a szaggatott „Write manually" mezőt in_review-
ban is szeretnéd (nem csak draftban), az a státuszlánc-szabály lazítása — külön
döntés/csomag.

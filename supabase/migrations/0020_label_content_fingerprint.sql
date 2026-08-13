-- ─────────────────────────────────────────────────────────────
-- 0020 — Tartalom-lenyomat a címke-soron (Epic 4 · 4.2, elcsúszás-jelölés)
--
-- MIÉRT: a cédula horgonya (block_id VAGY artifact_id+field_key) STABIL
-- marad a szöveg átírásakor, ezért a T1-ben készült címke némán rátapad a
-- T2-ben átírt szövegre. A draft/in_review dokumentumok mezői pontosan
-- azok, amiket a 0015 nézet státusz-szűrő nélkül beenged ÉS amik
-- szerkeszthetők maradnak (editable = status === 'draft'; a modul-szinkron
-- is csak nem-approved dokumentumra ír) — az approved mezők be vannak
-- fagyasztva, azok nem csúszhatnak el.
--
-- MEGOLDÁS: a címke-sor eltárolja, MILYEN SZÖVEGRE készült. Az elcsúszás
-- ebből DERIVÁLT (a jelenlegi cédula-szöveg lenyomatával összevetve) —
-- NEM perzisztált flag, ugyanaz az elv, mint a render_stale-nél.
--
-- A LENYOMAT FORMÁJA: sha256-hex a normalizált szövegről (trim + belső
-- whitespace összevonás) — a MEGLÉVŐ `contentFingerprint()`
-- (src/lib/knowledge/anchor.ts), amit a 0017 knowledge_dismissals sticky
-- elutasítása már használ. Nincs új mechanizmus.
--
-- NULLABLE — SZÁNDÉKOSAN: a meglévő címke-sorok lenyomat nélkül maradnak,
-- és a NULL jelentése „nem tudjuk, mire készült", NEM „elcsúszott". Így a
-- bevezetés visszamenőleg semmit nem jelöl elavultnak; a lenyomat a
-- következő címkézéskor/újracímkézéskor magától feltöltődik.
--
-- Idempotens; egyben futtatható. Futtatás: Máté, kézzel, Supabase
-- SQL-editor — ÉLESBEN MÉG NEM FUTOTT LE.
-- ─────────────────────────────────────────────────────────────

alter table knowledge_label_signals
  add column if not exists content_fingerprint text null;

comment on column knowledge_label_signals.content_fingerprint is
  'sha256-hex a normalizált cédula-szövegről, amire a címke készült '
  '(contentFingerprint, azonos a knowledge_dismissals lenyomat-formájával). '
  'NULL = ismeretlen (régi sor) — NEM elcsúszott.';

notify pgrst, 'reload schema';

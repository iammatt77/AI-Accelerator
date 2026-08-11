-- ─────────────────────────────────────────────────────────────
-- 0019 — Forrás-metaadat + evidencia-jelleg (Epic 4 · 4.2b)
--
-- (a) input_items.source_kind + org_level: a feltöltő ADJA MEG (nem az
--     LLM tippeli a szövegből). NULLABLE — a NULL jelentése „nincs
--     megadva", és a felületen LÁTHATÓ hiányként jelenik meg (F1).
--     FIGYELEM: a knowledge_metadata.source_kind (0017) az ATTRIBÚCIÓ
--     jellege (dokumentum/interju/megfigyeles/rendszeradat) — MÁS
--     értékkészlet, érintetlen marad.
-- (b) knowledge_metadata.evidence_kind: új besorolási dimenzió (F5) —
--     mért adat / megfigyelés / vélekedés / hivatkozás / ismeretlen.
-- (c) a 0018 javítás-napló dimension CHECK-je bővül 'evidence'-szel.
--
-- Idempotens; egyben futtatható. Futtatás: Máté, kézzel, Supabase
-- SQL-editor — ÉLESBEN MÉG NEM FUTOTT LE.
-- ─────────────────────────────────────────────────────────────

-- (a) forrás-metaadat
alter table input_items
  add column if not exists source_kind text null,
  add column if not exists org_level   text null;

do $$ begin
  alter table input_items add constraint input_items_source_kind_check
    check (source_kind is null or source_kind in
      ('interju_atirat', 'hivatalos_dokumentacio', 'workshop_jegyzokonyv',
       'rendszeradat_riport', 'levelezes', 'prezentacio', 'egyeb'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table input_items add constraint input_items_org_level_check
    check (org_level is null or org_level in ('hq', 'helyi', 'kulso', 'ismeretlen'));
exception when duplicate_object then null; end $$;

-- (b) evidencia-jelleg
alter table knowledge_metadata
  add column if not exists evidence_kind text not null default 'ismeretlen';

do $$ begin
  alter table knowledge_metadata add constraint knowledge_metadata_evidence_kind_check
    check (evidence_kind in
      ('mert_adat', 'megfigyeles', 'velekedes', 'hivatkozas', 'ismeretlen'));
exception when duplicate_object then null; end $$;

-- (c) a javítás-napló elfogadja az új dimenziót
alter table knowledge_label_corrections
  drop constraint if exists knowledge_label_corrections_dimension_check;
alter table knowledge_label_corrections
  add constraint knowledge_label_corrections_dimension_check
    check (dimension in ('modality', 'valid_time', 'scope', 'source', 'lang', 'evidence'));

notify pgrst, 'reload schema';

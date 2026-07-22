-- ─────────────────────────────────────────────────────────────
-- 0016 — Epic 3 · 3.5: TO-BE terv D2-renderelés — render-cél bővítés
--
-- KÉZI FUTTATÁS: Máté futtatja a Supabase SQL editorból. Idempotens —
-- többszöri futtatás biztonságos. A végén: NOTIFY pgrst, 'reload schema';
--
-- A TO-BE terv (P2) a JÓVÁHAGYOTT TO-BE folyamattérképből renderelődik
-- (D2-minta, mint a Use case-rangsor) — a renderelés-élnek (Csomag C1,
-- 0015) 'process_map' cél-típusra is ki kell terjednie. A tábla és a
-- render_stale derive-logika MÁR MEGVAN (0015); ez a migráció KIZÁRÓLAG
-- a target_type CHECK domain-jét bővíti eggyel — ugyanaz az idempotens
-- drop+add minta, mint amit a 0015 saját maga alkalmazott a
-- stale_acks.kind bővítésére. Nincs új tábla, nincs új oszlop.
-- ─────────────────────────────────────────────────────────────

alter table artifact_render_links drop constraint if exists artifact_render_links_target_type_check;
alter table artifact_render_links add constraint artifact_render_links_target_type_check
  check (target_type in
    ('use_case', 'solution_component', 'component_option',
     'build_component', 'prompt_item', 'control_point', 'eval_case',
     'process_map'));

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- reset-demo.sql — a demo-projekt visszaállítása a seed-alapállapotra
-- (Coding-csomag #4). Böngészőből (Supabase SQL-editor) EGYBEN
-- futtatható; IDEMPOTENS — többszöri futtatás ugyanazt az állapotot adja.
--
-- Alapállapot: P0 completed · P1 in_progress · P2–P6 locked ·
-- cycle_count = 1; a projekt gate_close Decision-jei törlődnek,
-- KIVÉVE a seedelt f0000000-0000-4000-8000-000000000001-et.
-- ─────────────────────────────────────────────────────────────

update phase_instances set state = 'completed', cycle_count = 1
  where id = 'c0000000-0000-4000-8000-000000000000'; -- P0

update phase_instances set state = 'in_progress', cycle_count = 1
  where id = 'c0000000-0000-4000-8000-000000000001'; -- P1

update phase_instances set state = 'locked', cycle_count = 1
  where id in (
    'c0000000-0000-4000-8000-000000000002', -- P2
    'c0000000-0000-4000-8000-000000000003', -- P3
    'c0000000-0000-4000-8000-000000000004', -- P4
    'c0000000-0000-4000-8000-000000000005', -- P5
    'c0000000-0000-4000-8000-000000000006'  -- P6
  );

delete from decisions
  where project_id = 'b0000000-0000-4000-8000-000000000001'
    and kind = 'gate_close'
    and id <> 'f0000000-0000-4000-8000-000000000001';

-- ─────────────────────────────────────────────────────────────
-- reset-demo.sql — a demo-projekt visszaállítása a seed-alapállapotra
-- (Coding-csomag #4, a #5a-ban és a #7a-ban bővítve). Böngészőből
-- (Supabase SQL-editor) EGYBEN futtatható; IDEMPOTENS.
--
-- Alapállapot: P0 completed · P1 in_progress · P2–P6 locked ·
-- cycle_count = 1; a demo-projekt MINDEN nem-seedelt sora törlődik:
--   - decisions: csak a seedelt f0000000-…-0001 marad (minden kind)
--   - artifacts: csak a seedelt charter (e0000000-…-0001) marad,
--     approved v1 státuszban (a #5a „Új verzió"-klónjai törlődnek)
--   - input_items: csak a 3 seedelt bemenet (d0000000-…-0001…0003) marad
--   - pain_points / use_cases (#7a): MINDEN sor törlődik (a seed nem
--     tartalmaz entitást — a demó a kivonatolással kezdődik)
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

-- Nem-seedelt döntések törlése (a #5a óta minden kind: add_input, extract,
-- generate_draft, edit_draft, status_change, approve_artifact, new_version
-- és a teszt-kapuzárások is).
delete from decisions
  where project_id = 'b0000000-0000-4000-8000-000000000001'
    and id <> 'f0000000-0000-4000-8000-000000000001';

-- Nem-seedelt artefaktumok törlése (#5a „Új verzió"-klónok, tesztek);
-- a seedelt charter visszaáll approved v1-re.
delete from artifacts
  where project_id = 'b0000000-0000-4000-8000-000000000001'
    and id <> 'e0000000-0000-4000-8000-000000000001';

update artifacts set status = 'approved', version = 1
  where id = 'e0000000-0000-4000-8000-000000000001';

-- #9: a P2 strukturált adat (benefit_calc / pilot_success) az artefaktumon él
-- — a fenti „nem-seedelt artefaktum" törlés a P2 Business case / Pilot-terv
-- draftokat egészben eltávolítja, így a jsonb is velük megy. Defenzív reset a
-- fennmaradó (seedelt charter) sorra is, hogy az alapállapot mindig üres {}.
update artifacts set benefit_calc = '{}', pilot_success = '{}'
  where project_id = 'b0000000-0000-4000-8000-000000000001';

-- Nem-seedelt bemenetek törlése (a ① zónában felvett teszt-inputok).
delete from input_items
  where project_id = 'b0000000-0000-4000-8000-000000000001'
    and id not in (
      'd0000000-0000-4000-8000-000000000001',
      'd0000000-0000-4000-8000-000000000002',
      'd0000000-0000-4000-8000-000000000003'
    );

-- #8: a demo-projekt stakeholder-kötései + stakeholderei törlődnek. A
-- pain_point_stakeholders sorok a FK-cascade miatt a pain_points/stakeholders
-- törlésekor is elmennének, de itt EXPLICIT is töröljük (idempotens,
-- sorrend-független). Az input_items.stakeholder_source_id a FK „on delete
-- set null" miatt magától null-ra áll a stakeholderek törlésekor.
delete from pain_point_stakeholders
  where pain_point_id in (
    select id from pain_points where project_id = 'b0000000-0000-4000-8000-000000000001'
  )
  or stakeholder_id in (
    select id from stakeholders where project_id = 'b0000000-0000-4000-8000-000000000001'
  );

delete from stakeholders
  where project_id = 'b0000000-0000-4000-8000-000000000001';

-- #7a: a demo-projekt P1-entitásai törlődnek (a seed nem tartalmaz
-- entitást — az alapállapot az üres Fájdalompontok/Use case-ek szekció).
delete from use_cases
  where project_id = 'b0000000-0000-4000-8000-000000000001';

delete from pain_points
  where project_id = 'b0000000-0000-4000-8000-000000000001';

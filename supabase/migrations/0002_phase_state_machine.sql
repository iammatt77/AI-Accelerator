-- ─────────────────────────────────────────────────────────────
-- 0002 — phase_state enum + állapotgép-alapok (Coding-csomag #4)
--
-- EGYBEN bemásolható a Supabase SQL-editorba és újrafuttatásra is
-- biztonságos (idempotens védelmekkel). Élő értékek a futtatáskor:
-- 'completed' (P0), 'in_progress' (P1), 'not_started' (P2–P6).
-- ─────────────────────────────────────────────────────────────

-- 1) Meglévő sorok mappelése MÉG text-ként:
--    'not_started' → 'locked'; 'in_progress'/'completed' marad;
--    MINDEN egyéb/ismeretlen érték → 'locked'.
update phase_instances set state = 'locked'
  where state not in ('locked', 'open', 'in_progress', 'gate_pending', 'completed');

-- 2) Az enum típus (locked → open → in_progress → gate_pending → completed)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'phase_state') then
    create type phase_state as enum
      ('locked', 'open', 'in_progress', 'gate_pending', 'completed');
  end if;
end
$$;

-- 3) Az oszlop átállítása text → phase_state (a régi text-default előbb
--    lekerül, különben a cast elhasal), default: 'locked'.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'phase_instances' and column_name = 'state'
      and data_type <> 'USER-DEFINED'
  ) then
    alter table phase_instances alter column state drop default;
    alter table phase_instances
      alter column state type phase_state using (state::phase_state);
  end if;
end
$$;
alter table phase_instances alter column state set default 'locked';

-- 4) cycle_count — a pivot-hurok (#9) előkészítése
alter table phase_instances add column if not exists cycle_count int not null default 1;

-- 5) Integritás: egy projekt–fázis pár csak egyszer; érvényes fáziskódok
create unique index if not exists uq_phase_instances_project_phase
  on phase_instances (project_id, phase);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_phase_code') then
    alter table phase_instances add constraint chk_phase_code
      check (phase in ('P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6'));
  end if;
end
$$;

-- 6) close_gate() — TRANZAKCIONÁLIS kapu-zárás:
--    P(n) → completed  +  P(n+1) locked → open  +  decisions-sor,
--    egyetlen függvényhívásban (a PostgREST rpc hívás egy tranzakció).
--    Érvénytelen állapotból hívva kivételt dob (a kliens FormState-hibává
--    alakítja). P6-nak nincs kapuja.
create or replace function close_gate(p_project_id uuid, p_phase text, p_note text)
returns void
language plpgsql
as $$
declare
  v_updated int;
  v_next text;
begin
  if p_phase not in ('P0', 'P1', 'P2', 'P3', 'P4', 'P5') then
    raise exception 'invalid_transition: % fázisnak nincs zárható kapuja', p_phase;
  end if;
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'note_required: a kapu-zárás indoklása kötelező';
  end if;

  update phase_instances set state = 'completed'
    where project_id = p_project_id
      and phase = p_phase
      and state in ('in_progress', 'gate_pending');
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'invalid_transition: a % fázis a jelenlegi állapotából nem zárható', p_phase;
  end if;

  v_next := 'P' || (substring(p_phase from 2)::int + 1)::text;
  update phase_instances set state = 'open'
    where project_id = p_project_id and phase = v_next and state = 'locked';

  insert into decisions (project_id, kind, note)
    values (p_project_id, 'gate_close', p_note);
end;
$$;

-- 7) PostgREST séma-cache frissítése (a #1-ben élesben megharapott
--    PGRST205 miatt kötelező zárás).
notify pgrst, 'reload schema';

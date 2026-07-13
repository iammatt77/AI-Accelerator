-- ─────────────────────────────────────────────────────────────
-- 0004 — P1-mélység I.: fájdalompont- és use case-entitások
-- (Coding-csomag #7a)
--
-- Supabase SQL-editorba EGYBEN bemásolható; IDEMPOTENS — második futás
-- nem hibázik és nem ront el adatot.
--
-- Tartalom:
--   1) entity_state enum — az E1 elv entitás-szinten:
--      ai_suggested (AI-javaslat) → confirmed (emberi megerősítés) /
--      rejected (elvetve, de nem törölve); manual = kézi felvétel
--   2) pain_points — fájdalompontok (idézettel + forrás-inputokkal)
--   3) use_cases — use case-ek (fájdalompont-hivatkozásokkal,
--      pontozással, shortlist-státusszal)
--   4) indexek (project_id) + RLS (a 0001 mintája szerint: policy
--      nélkül bekapcsolva — csak a szerveroldali service-role fér hozzá)
--   5) notify pgrst — PostgREST séma-cache frissítés
-- ─────────────────────────────────────────────────────────────

-- 1) entity_state enum ----------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'entity_state') then
    create type entity_state as enum ('ai_suggested', 'confirmed', 'manual', 'rejected');
  end if;
end
$$;

-- 2) pain_points -----------------------------------------------------------
create table if not exists pain_points (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects (id) on delete cascade,
  title            text not null,
  description      text,
  quote            text,
  severity         text null check (severity in ('low', 'medium', 'high')),
  source_input_ids uuid[] not null default '{}',
  state            entity_state not null default 'ai_suggested',
  created_at       timestamptz not null default now()
);

-- 3) use_cases -------------------------------------------------------------
create table if not exists use_cases (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects (id) on delete cascade,
  title             text not null,
  description       text,
  pain_point_ids    uuid[] not null default '{}',
  score_value       int null check (score_value between 1 and 5),
  score_feasibility int null check (score_feasibility between 1 and 5),
  risk              text null check (risk in ('low', 'medium', 'high')),
  quick_win         boolean not null default false,
  list_status       text not null default 'candidate'
                      check (list_status in ('candidate', 'shortlist', 'excluded', 'selected')),
  exclusion_reason  text,
  source_input_ids  uuid[] not null default '{}',
  state             entity_state not null default 'ai_suggested',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 4) indexek + RLS ---------------------------------------------------------
create index if not exists idx_pain_points_project on pain_points (project_id);
create index if not exists idx_use_cases_project   on use_cases (project_id);

alter table pain_points enable row level security;
alter table use_cases   enable row level security;

-- 5) PostgREST séma-cache --------------------------------------------------
notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- AI Consulting rendszer — foundation séma (v0.2 §4, minimális oszlopok)
-- Csak a generálási vertikumhoz szükséges entitások.
-- Régió: Supabase EU (Frankfurt).
-- ─────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- Artefaktum-státusz: Draft → Review → Approved (v0.2 kód-konvenciók)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'artifact_status') then
    create type artifact_status as enum ('draft', 'in_review', 'approved');
  end if;
end
$$;

-- clients ------------------------------------------------------
create table if not exists clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  industry   text,
  created_at timestamptz not null default now()
);

-- projects -----------------------------------------------------
create table if not exists projects (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients (id) on delete cascade,
  name       text not null,
  package    text,
  status     text not null default 'active',
  created_at timestamptz not null default now()
);

-- phase_instances (most csak P0 rekord elég) -------------------
create table if not exists phase_instances (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  phase      text not null,
  state      text not null default 'not_started'
);

-- input_items --------------------------------------------------
create table if not exists input_items (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  type       text not null default 'raw',
  raw_text   text not null,
  created_at timestamptz not null default now()
);

-- artifacts ----------------------------------------------------
create table if not exists artifacts (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects (id) on delete cascade,
  type             text not null,
  version          int  not null default 1,
  status           artifact_status not null default 'draft',
  body             text not null default '',
  source_input_ids uuid[] not null default '{}',
  created_at       timestamptz not null default now()
);

-- decisions (audit trail alap) ---------------------------------
create table if not exists decisions (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  kind       text not null,
  note       text,
  created_at timestamptz not null default now()
);

-- indexek ------------------------------------------------------
create index if not exists idx_projects_client   on projects (client_id);
create index if not exists idx_phases_project     on phase_instances (project_id);
create index if not exists idx_inputs_project     on input_items (project_id);
create index if not exists idx_artifacts_project  on artifacts (project_id);
create index if not exists idx_decisions_project  on decisions (project_id);

-- ─────────────────────────────────────────────────────────────
-- Row Level Security: bekapcsolva, policy NÉLKÜL.
-- Következmény: az anon / authenticated szerep NEM fér hozzá.
-- Minden írás/olvasás szerveroldalon, service-role kulccsal történik,
-- ami megkerüli az RLS-t. Így az anon böngésző-kliens nem szivárogtat adatot.
-- ─────────────────────────────────────────────────────────────
alter table clients         enable row level security;
alter table projects        enable row level security;
alter table phase_instances enable row level security;
alter table input_items     enable row level security;
alter table artifacts       enable row level security;
alter table decisions       enable row level security;

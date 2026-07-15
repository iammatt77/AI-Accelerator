-- ─────────────────────────────────────────────────────────────
-- 0006 — Stakeholder-mélység: stakeholder-entitás, forrás-kötés,
-- fájdalompont↔stakeholder many-to-many (Coding-csomag #8)
--
-- Supabase SQL-editorba EGYBEN bemásolható; IDEMPOTENS — második futás
-- nem hibázik és nem ront el adatot.
--
-- Tartalom:
--   1) stakeholders — ügyfélhez ÉS projekthez kötött stakeholder-entitás;
--      influence/impact score (1–5, null=nincs alap), communication_strategy
--      (KIZÁRÓLAG manuális), source_input_ids, entity_state (a 0004 enumja)
--   2) pain_point_stakeholders — a pain_points ↔ stakeholders many-to-many
--      kötőtábla (egy fájdalompont több stakeholdert is érinthet)
--   3) input_items.stakeholder_source_id — melyik stakeholdertől jött az
--      input (null = nem köthető; NINCS kényszerített hozzárendelés)
--   4) indexek + RLS (a 0001/0004 mintája szerint: policy nélkül
--      bekapcsolva — csak a szerveroldali service-role fér hozzá)
--   5) notify pgrst — PostgREST séma-cache frissítés
--
-- Az entity_state enumot a 0004 hozta létre (ai_suggested / confirmed /
-- manual / rejected) — itt újrahasznált. Defenzív guard, ha a 0006 a 0004
-- előtt futna (nem várt, de idempotens).
-- ─────────────────────────────────────────────────────────────

-- 0) entity_state enum defenzív pótlás (a 0004 hozza; guard önálló futáshoz)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'entity_state') then
    create type entity_state as enum ('ai_suggested', 'confirmed', 'manual', 'rejected');
  end if;
end
$$;

-- 1) stakeholders --------------------------------------------------------
create table if not exists stakeholders (
  id                     uuid primary key default gen_random_uuid(),
  client_id              uuid not null references clients (id) on delete cascade,
  project_id             uuid not null references projects (id) on delete cascade,
  name                   text not null,
  title                  text,
  influence_score        int null check (influence_score between 1 and 5),
  impact_score           int null check (impact_score between 1 and 5),
  communication_strategy text,
  source_input_ids       uuid[] not null default '{}',
  state                  entity_state not null default 'ai_suggested',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- 2) pain_point_stakeholders (many-to-many) ------------------------------
create table if not exists pain_point_stakeholders (
  pain_point_id  uuid not null references pain_points (id) on delete cascade,
  stakeholder_id uuid not null references stakeholders (id) on delete cascade,
  primary key (pain_point_id, stakeholder_id)
);

-- 3) input_items.stakeholder_source_id -----------------------------------
alter table input_items
  add column if not exists stakeholder_source_id uuid null
    references stakeholders (id) on delete set null;

-- 4) indexek + RLS -------------------------------------------------------
create index if not exists idx_stakeholders_client   on stakeholders (client_id);
create index if not exists idx_stakeholders_project  on stakeholders (project_id);
create index if not exists idx_pps_pain              on pain_point_stakeholders (pain_point_id);
create index if not exists idx_pps_stakeholder       on pain_point_stakeholders (stakeholder_id);
create index if not exists idx_inputs_stakeholder    on input_items (stakeholder_source_id);

alter table stakeholders            enable row level security;
alter table pain_point_stakeholders enable row level security;

-- 5) PostgREST séma-cache ------------------------------------------------
notify pgrst, 'reload schema';

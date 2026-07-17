-- 0009 — Követelmény- és User Story-kezelő (P2, #11)
--
-- Fogalmi modell (a csomag döntései):
--   · requirements — háromszintű fa (business → stakeholder → system),
--     system szinten functional / non_functional altípussal; parent_id
--     önhivatkozó fa-kötés; moscow NULLABLE (emberi ítélet — az AI alap
--     nélkül nem tölti); display_id a felhasználó-facing azonosító
--     (BR-/SR-/SYS-/NFR- + projektenkénti sorszám).
--   · acceptance_criteria — az AC a REQUIREMENTHEZ tartozik (a közös AC
--     magja): a story-k a requirement→story kötésen át ÖRÖKLIK, nem
--     másolják. (given/when/then oszlopnevek *_text utótaggal — a WHEN és
--     a THEN SQL-kulcsszó.)
--   · epics + user_stories — az Agile-nézet; a story a system
--     requirementekből SZÁRMAZIK (irány: requirement → story).
--   · requirement_stories — N:M kötés (egy story több requirementet fedhet,
--     egy requirementet több story valósíthat meg).
--   · stakeholder_requirements — a stakeholder-szintű requirement érintett-
--     kötése (#8 stakeholders); kötőtábla, mert több szereplő is köthető.
--
-- A forrás-hivatkozás a meglévő entitás-minta szerint source_input_ids
-- uuid[] (a kanonikus [n] számozást a lib/sources képezi le) — a #7a/#8
-- entitásokkal konzisztensen. Idempotens; a végén notify pgrst.

create table if not exists requirements (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects (id) on delete cascade,
  phase            text not null default 'P2',
  level            text not null check (level in ('business', 'stakeholder', 'system')),
  subtype          text null check (subtype in ('functional', 'non_functional')),
  parent_id        uuid null references requirements (id) on delete cascade,
  moscow           text null check (moscow in ('must', 'should', 'could', 'wont')),
  text             text not null,
  source_input_ids uuid[] not null default '{}',
  state            entity_state not null default 'ai_suggested',
  display_id       text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- altípus csak system szinten (és ott kötelező)
  constraint requirements_subtype_level check (
    (level = 'system' and subtype is not null)
    or (level <> 'system' and subtype is null)
  ),
  constraint requirements_display_unique unique (project_id, display_id)
);

create index if not exists requirements_project_idx on requirements (project_id);
create index if not exists requirements_parent_idx on requirements (parent_id);

create table if not exists acceptance_criteria (
  id             uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references requirements (id) on delete cascade,
  title          text not null,
  given_text     text not null,
  when_text      text not null,
  then_text      text not null,
  ord            int not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists acceptance_criteria_req_idx on acceptance_criteria (requirement_id);

create table if not exists epics (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null references projects (id) on delete cascade,
  title                   text not null,
  business_requirement_id uuid null references requirements (id) on delete set null,
  display_id              text not null,
  created_at              timestamptz not null default now(),
  constraint epics_display_unique unique (project_id, display_id)
);

create index if not exists epics_project_idx on epics (project_id);

create table if not exists user_stories (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects (id) on delete cascade,
  epic_id          uuid null references epics (id) on delete set null,
  role             text not null,
  want             text not null,
  so_that          text not null,
  moscow           text null check (moscow in ('must', 'should', 'could', 'wont')),
  state            entity_state not null default 'ai_suggested',
  source_input_ids uuid[] not null default '{}',
  display_id       text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint user_stories_display_unique unique (project_id, display_id)
);

create index if not exists user_stories_project_idx on user_stories (project_id);
create index if not exists user_stories_epic_idx on user_stories (epic_id);

create table if not exists requirement_stories (
  requirement_id uuid not null references requirements (id) on delete cascade,
  story_id       uuid not null references user_stories (id) on delete cascade,
  primary key (requirement_id, story_id)
);

create index if not exists requirement_stories_story_idx on requirement_stories (story_id);

create table if not exists stakeholder_requirements (
  requirement_id uuid not null references requirements (id) on delete cascade,
  stakeholder_id uuid not null references stakeholders (id) on delete cascade,
  primary key (requirement_id, stakeholder_id)
);

alter table requirements enable row level security;
alter table acceptance_criteria enable row level security;
alter table epics enable row level security;
alter table user_stories enable row level security;
alter table requirement_stories enable row level security;
alter table stakeholder_requirements enable row level security;

notify pgrst, 'reload schema';

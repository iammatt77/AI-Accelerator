-- ─────────────────────────────────────────────────────────────
-- 0012 — Megoldás-dokumentáció modul (P3, #15)
--
-- Fogalmi modell (a spec döntései, 2026-07-19):
--   · build_components — a MEGÉPÍTETT megoldás komponensei (K-nn). A modul
--     lelke a KÉT, ELKÜLÖNÍTETT kötés-fajta:
--       – EREDET (honnan jött): origin_component_id → a P2 opció-összevető
--         solution_components sora (1-N: egy P2-komponens több build-
--         komponenst adhat). NULL = manuális felvétel, nincs P2-előzmény.
--         A P2 a kiválasztást strukturáltan tárolja (component_options
--         is_selected, HITL) — a seed ezért automatizálható (AC1).
--       – MEGVALÓSÍTÁS (mit valósít meg): impl_links, N:M, 4 cél-típus.
--   · impl_links — komponens ↔ {system requirement | user story | TO-BE
--     node | fájdalompont}. A requirement/story/fájdalompont target_id-ja
--     a sor uuid-ja szövegként; a TO-BE lépésé a process_map jsonb-n BELÜLI
--     STABIL node-id (a 0010-ben dokumentált id-stabilitási garanciákkal),
--     process_map_id provenance-szal. state: az AI-javasolt kötés (✦)
--     ai_suggested — CSAK emberi megerősítéssel (confirmed) aktív, elvetése
--     törlés (E1). A lefedettség-nézet PASSZÍV tükör: ugyanezen sorok
--     fordított irányú olvasata — nincs pontszám, nincs analízis.
--   · prompt_items — prompt-elemek (PR-nn), komponenshez kötve (1-N).
--   · control_points — kontrollpontok (guardrail | hitl), opcionális TO-BE
--     lépés-kötéssel (c-minta: ahol nincs alap, node_id NULL marad).
--
-- A forrás-hivatkozás a meglévő minta szerint source_input_ids uuid[];
-- state a meglévő entity_state enum (E1). Idempotens; notify pgrst.
-- ─────────────────────────────────────────────────────────────

create table if not exists build_components (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects (id) on delete cascade,
  phase               text not null default 'P3',
  display_id          text not null,
  name                text not null,
  description         text not null default '',
  layer_type          text not null check (layer_type in ('process', 'infrastructure', 'personnel')),
  origin_component_id uuid null references solution_components (id) on delete set null,
  state               entity_state not null default 'ai_suggested',
  source_input_ids    uuid[] not null default '{}',
  ord                 int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (project_id, display_id)
);

create index if not exists build_components_project_idx on build_components (project_id);
create index if not exists build_components_origin_idx on build_components (origin_component_id);

create table if not exists impl_links (
  id             uuid primary key default gen_random_uuid(),
  component_id   uuid not null references build_components (id) on delete cascade,
  target_type    text not null check (target_type in ('requirement', 'story', 'tobe_node', 'pain_point')),
  target_id      text not null,
  process_map_id uuid null references process_maps (id) on delete cascade,
  state          entity_state not null default 'manual',
  created_at     timestamptz not null default now(),
  unique (component_id, target_type, target_id)
);

create index if not exists impl_links_component_idx on impl_links (component_id);
create index if not exists impl_links_target_idx on impl_links (target_type, target_id);

create table if not exists prompt_items (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects (id) on delete cascade,
  component_id     uuid not null references build_components (id) on delete cascade,
  display_id       text not null,
  name             text not null,
  purpose          text not null default '',
  prompt_text      text not null default '',
  state            entity_state not null default 'ai_suggested',
  source_input_ids uuid[] not null default '{}',
  ord              int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (project_id, display_id)
);

create index if not exists prompt_items_project_idx on prompt_items (project_id);
create index if not exists prompt_items_component_idx on prompt_items (component_id);

create table if not exists control_points (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects (id) on delete cascade,
  name             text not null,
  kind             text not null check (kind in ('guardrail', 'hitl')),
  description      text not null default '',
  process_map_id   uuid null references process_maps (id) on delete cascade,
  node_id          text null,
  state            entity_state not null default 'ai_suggested',
  source_input_ids uuid[] not null default '{}',
  ord              int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists control_points_project_idx on control_points (project_id);

alter table build_components enable row level security;
alter table impl_links enable row level security;
alter table prompt_items enable row level security;
alter table control_points enable row level security;

-- PostgREST séma-cache
notify pgrst, 'reload schema';

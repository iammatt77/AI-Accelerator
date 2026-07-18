-- ─────────────────────────────────────────────────────────────
-- 0010 — Megoldási opció-összevető modul (P2, #12)
--
-- Fogalmi modell (a csomag döntései):
--   · solution_components — MIVEL valósul meg a megoldás. Három típus:
--     process (egy TO-BE lépéshez dokkolt), infrastructure (átfogó, több
--     lépést szolgál), personnel (change-elem, gyakran nem lépéshez kötött).
--   · component_step_links — a komponens ↔ TO-BE lépés kötés. A TO-BE
--     lépések a process_maps jsonb node-jai, NEM önálló sorok — a kötés
--     ezért a process_map-en BELÜLI STABIL node-id-re hivatkozik (a node-ok
--     `id` mezője: az LLM-parse s1…sN-t ad dedupolva, a chat-beszúrás c1…cN-t,
--     a szerkesztés/verzió-emelés az id-kat VÁLTOZATLANUL megőrzi — lásd
--     lib/processmap/parse.ts + chat.ts + newProcessVersionAction). A
--     process_map_id a provenance (melyik térkép-sor ellen jött létre a
--     kötés); a render a mindenkori JÓVÁHAGYOTT TO-BE node_id-jaira illeszt.
--     N:M — egy infra-komponens több node-ot fed, egy node-hoz több komponens.
--   · component_options — komponensenkénti alternatívák. criteria_values:
--     szempont-kulcs → { value, note } jsonb (bővíthető készlet; a hiányzó
--     érték ÜRES — c-minta, nem fabrikált). Komponensenként LEGFELJEBB EGY
--     is_selected (részleges unique index) — a nyertest EMBER választja
--     (HITL): selected_by + selected_at + rationale rögzül. Az AI ajánlását
--     az ai_recommended jelzi — az ajánlás SOSEM választás.
--
-- A forrás-hivatkozás a meglévő entitás-minta szerint source_input_ids
-- uuid[]; state a meglévő entity_state enum (E1). Idempotens; notify pgrst.
-- ─────────────────────────────────────────────────────────────

create table if not exists solution_components (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects (id) on delete cascade,
  phase            text not null default 'P2',
  type             text not null check (type in ('process', 'infrastructure', 'personnel')),
  name             text not null,
  description      text not null default '',
  state            entity_state not null default 'ai_suggested',
  source_input_ids uuid[] not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists solution_components_project_idx on solution_components (project_id);

create table if not exists component_step_links (
  component_id   uuid not null references solution_components (id) on delete cascade,
  process_map_id uuid not null references process_maps (id) on delete cascade,
  node_id        text not null,
  primary key (component_id, node_id)
);

create index if not exists component_step_links_map_idx on component_step_links (process_map_id);

create table if not exists component_options (
  id              uuid primary key default gen_random_uuid(),
  component_id    uuid not null references solution_components (id) on delete cascade,
  name            text not null,
  description     text not null default '',
  criteria_values jsonb not null default '{}'::jsonb,
  is_selected     boolean not null default false,
  ai_recommended  boolean not null default false,
  rationale       text not null default '',
  selected_by     text null,
  selected_at     timestamptz null,
  ord             int not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists component_options_component_idx on component_options (component_id);

-- komponensenként legfeljebb EGY nyertes (a kiválasztás emberi — HITL)
create unique index if not exists component_options_one_selected
  on component_options (component_id) where is_selected;

alter table solution_components enable row level security;
alter table component_step_links enable row level security;
alter table component_options enable row level security;

-- PostgREST séma-cache
notify pgrst, 'reload schema';

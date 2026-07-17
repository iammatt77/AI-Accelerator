-- ─────────────────────────────────────────────────────────────
-- 0008 — Folyamattérkép-modul (#10): process_maps entitás.
--
-- Egy folyamatterv = node-lista + élek EGY jsonb-dokumentumban (a repo
-- jsonb-mintája szerint: artifacts.fields / benefit_calc). A node/edge
-- alak a TS-oldalon él (src/lib/processmap/model.ts) — a DB nem kényszeríti
-- ki a belső szerkezetet, a parse defenzív.
--
--   kind:            'as_is' | 'to_be'
--   status:          a MEGLÉVŐ artifact_status lánc (draft→in_review→approved)
--   version:         jóváhagyás után zárolt; új iteráció = új sor, version+1
--   source_input_id: a nyers leirat (input_items) — SOHA nem íródik felül,
--                    a térkép csak hivatkozza (traceability)
--   to_be_origin:    'document' (bevitt TO-BE-leiratból) | 'ai_suggested'
--                    (pain_points + AS-IS alapján tervezve) — csak TO-BE-nél
--   original_snapshot: az eredeti AI-generált {nodes,edges} a
--                    változáskövetéshez (a szerkesztés ezt nem módosítja)
--   chat_log:        a chat-szerkesztő üzenetei + függő javaslat (HITL:
--                    a javaslat csak explicit alkalmazáskor íródik a nodes-ba)
--
-- Idempotens; a végén notify pgrst.
-- ─────────────────────────────────────────────────────────────

create table if not exists process_maps (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects (id) on delete cascade,
  phase             text,
  kind              text not null check (kind in ('as_is', 'to_be')),
  title             text not null default '',
  status            artifact_status not null default 'draft',
  version           int not null default 1,
  source_input_id   uuid references input_items (id) on delete set null,
  to_be_origin      text check (to_be_origin in ('document', 'ai_suggested')),
  nodes             jsonb not null default '[]',
  edges             jsonb not null default '[]',
  original_snapshot jsonb not null default '{}'::jsonb,
  chat_log          jsonb not null default '[]',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_process_maps_project on process_maps (project_id);
create index if not exists idx_process_maps_kind    on process_maps (project_id, kind);

alter table process_maps enable row level security;

-- PostgREST séma-cache
notify pgrst, 'reload schema';

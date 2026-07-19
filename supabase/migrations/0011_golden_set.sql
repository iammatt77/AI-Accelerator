-- ─────────────────────────────────────────────────────────────
-- 0011 — P3 Golden set + Tesztriport (#14)
--
-- Fogalmi modell (Approved spec, 2026-07-19):
--   · golden_sets — a P2 use case-hez (1:1 / use case, unique). A
--     pass_threshold EMBERI mező (az AI SOHA nem állítja); NULL = még
--     nincs beállítva → a Tesztriport nem hagyható jóvá (poka-yoke).
--     A threshold_override_note a dokumentált emberi felülírás (AC5
--     kivétel-ága) — üres = nincs felülírás.
--   · eval_cases — teszteset (EC-nn). A VÁLASZ-TÍPUS vezérli a dinamikus
--     rögzítő formáját (5 típus); a típusfüggő konfiguráció + a
--     kimenetek jsonb-ben (változó forma):
--       answer_config:   choice_*: {"options":[...]} · number_scale:
--                        {"min":0,"max":100,"label":"..."} · egyébként {}
--       expected_output: OPCIONÁLIS (c-minta — nyílt esetnél üres, a
--                        kritérium dönt, nem fabrikálunk értéket)
--       actual_output:   a tanácsadó által KÍVÜL lefuttatott megoldás
--                        tényleges kimenete (a rendszer nem futtat!)
--     E1-fegyelem: az AI-besorolás (ai_verdict + ai_rationale +
--     ai_criteria kritériumonkénti OK/BUKOTT) KÜLÖN mezőkben az emberi
--     végső ítélettől (final_verdict + verdict_by + verdict_at).
--     Az eset állapota (rögzítendő → besorolandó → besorolva) LEVEZETETT,
--     nem tárolt (lib/goldenset/model).
--   · eval_criteria — kritérium (K1..) az esethez (1-N); a pass/fail fő
--     alapja. Eredet: entity_state (ai_suggested / manual / confirmed).
--     Az „OK/BUKOTT" nem tárolt kritérium-mező — a besorolás mellékterméke
--     (ai_criteria).
--
-- A Tesztriport deliverable NEM új tábla: a MEGLÉVŐ artifacts típus
-- (`Tesztriport`, P3, kapu-kritérium a #6 óta) — a kanonikus
-- Draft→In review→Approved láncon; a modul a mezőit szinkronizálja és
-- típusspecifikus approve-őrt ad (app-réteg). A forrás-hivatkozás a
-- meglévő minta: source_input_ids uuid[]. Idempotens; notify pgrst.
-- ─────────────────────────────────────────────────────────────

create table if not exists golden_sets (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null references projects (id) on delete cascade,
  use_case_id             uuid not null references use_cases (id) on delete cascade,
  phase                   text not null default 'P3',
  pass_threshold          int null check (pass_threshold between 1 and 100),
  threshold_override_note text not null default '',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint golden_sets_usecase_unique unique (use_case_id)
);

create index if not exists golden_sets_project_idx on golden_sets (project_id);

create table if not exists eval_cases (
  id               uuid primary key default gen_random_uuid(),
  golden_set_id    uuid not null references golden_sets (id) on delete cascade,
  display_id       text not null,
  input_text       text not null,
  answer_type      text not null check (
    answer_type in ('free_text', 'choice_single', 'choice_multi', 'number_scale', 'yes_no')
  ),
  answer_config    jsonb not null default '{}'::jsonb,
  expected_output  jsonb null,
  actual_output    jsonb null,
  ai_verdict       text null check (ai_verdict in ('passed', 'partial', 'failed')),
  ai_rationale     text not null default '',
  ai_criteria      jsonb not null default '[]'::jsonb,
  final_verdict    text null check (final_verdict in ('passed', 'partial', 'failed')),
  verdict_by       text null,
  verdict_at       timestamptz null,
  source_input_ids uuid[] not null default '{}',
  state            entity_state not null default 'ai_suggested',
  ord              int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint eval_cases_display_unique unique (golden_set_id, display_id)
);

create index if not exists eval_cases_set_idx on eval_cases (golden_set_id);

create table if not exists eval_criteria (
  id           uuid primary key default gen_random_uuid(),
  eval_case_id uuid not null references eval_cases (id) on delete cascade,
  ord          int not null default 1,
  text         text not null,
  state        entity_state not null default 'ai_suggested',
  created_at   timestamptz not null default now()
);

create index if not exists eval_criteria_case_idx on eval_criteria (eval_case_id);

alter table golden_sets enable row level security;
alter table eval_cases enable row level security;
alter table eval_criteria enable row level security;

-- PostgREST séma-cache
notify pgrst, 'reload schema';

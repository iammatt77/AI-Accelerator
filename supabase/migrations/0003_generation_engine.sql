-- ─────────────────────────────────────────────────────────────
-- 0003 — Generálási motor v2 (Coding-csomag #5a)
--
-- Supabase SQL-editorba EGYBEN bemásolható; IDEMPOTENS — második futás
-- nem hibázik és nem ront el adatot.
--
-- Tartalom:
--   1) artifacts.fields jsonb — strukturált mezők (mezőnként:
--      { value, source_indices, state: ai_filled|confirmed|manual|missing })
--   2) artifacts.updated_at — a szerkesztő mentése frissíti
--   3) unique (project_id, type, version) — a verseny-biztos verziózás
--      DB-oldali őre (ütköző insert hibát kap, nem duplikál)
--   4) input_items.phase — az új bemenetek a munkaterület fázisával
--      címkéződnek; a régiek NULL-on maradnak
--   5) a seedelt charter (e0000000-…-0001) mező-backfillje — mind az 5
--      kötelező mező confirmed állapottal (a seed ismert értékei);
--      csak akkor fut, ha a fields még üres (nem ír felül kézi munkát)
--   6) notify pgrst — PostgREST séma-cache frissítés
-- ─────────────────────────────────────────────────────────────

-- 1–2) artifacts új oszlopai --------------------------------------------
alter table artifacts
  add column if not exists fields jsonb not null default '{}';

alter table artifacts
  add column if not exists updated_at timestamptz not null default now();

-- 3) verzió-egyediség ----------------------------------------------------
-- Védőellenőrzés: ha az élő adatban már lenne (project_id, type, version)
-- duplikátum, az index-létrehozás érthetetlen hibával állna el — ehelyett
-- beszédes hibaüzenetet adunk, ami felsorolja az ütköző sorokat.
do $$
declare
  dup record;
  msg text := '';
begin
  for dup in
    select project_id, type, version, count(*) as n
    from artifacts
    group by project_id, type, version
    having count(*) > 1
  loop
    msg := msg || format(
      ' [project=%s type=%s version=%s: %s sor]',
      dup.project_id, dup.type, dup.version, dup.n
    );
  end loop;
  if msg <> '' then
    raise exception
      'duplikált (project_id, type, version) az artifacts táblában:% — tisztítsd meg, majd futtasd újra a 0003-at',
      msg;
  end if;
end
$$;

create unique index if not exists uq_artifacts_project_type_version
  on artifacts (project_id, type, version);

-- 4) input_items.phase ---------------------------------------------------
alter table input_items
  add column if not exists phase text null;

-- 5) seedelt charter mező-backfill ---------------------------------------
-- Csak üres fields esetén ír (idempotens + nem ír felül későbbi szerkesztést).
update artifacts
set fields = jsonb_build_object(
  'cel', jsonb_build_object(
    'value', 'a panaszkezelési folyamat AI-alkalmasságának felmérése',
    'source_indices', '[]'::jsonb,
    'state', 'confirmed'
  ),
  'scope', jsonb_build_object(
    'value', 'P0–P2, Felmérés-csomag',
    'source_indices', '[]'::jsonb,
    'state', 'confirmed'
  ),
  'szponzor', jsonb_build_object(
    'value', 'ügyvezető',
    'source_indices', '[]'::jsonb,
    'state', 'confirmed'
  ),
  'idokeret', jsonb_build_object(
    'value', '6 hét',
    'source_indices', '[]'::jsonb,
    'state', 'confirmed'
  ),
  'sikerkriterium', jsonb_build_object(
    'value', 'priorizált use case-shortlist + business case',
    'source_indices', '[]'::jsonb,
    'state', 'confirmed'
  )
)
where id = 'e0000000-0000-4000-8000-000000000001'
  and (fields is null or fields = '{}'::jsonb);

-- 6) „Új verzió" — verseny-biztos verziószám DB-oldalon ------------------
-- version+1 draft-klón EGY utasításban számított max+1-gyel; párhuzamos
-- hívásnál az uq_artifacts_project_type_version unique index véd: a
-- második insert 23505-tel hibázik (a hívó graceful FormState-hibát ad),
-- duplikált verziószám nem jöhet létre.
create or replace function new_artifact_version(p_artifact_id uuid)
returns setof artifacts
language plpgsql
as $$
declare
  src artifacts%rowtype;
begin
  select * into src from artifacts where id = p_artifact_id;
  if not found then
    raise exception 'artifact_not_found: %', p_artifact_id;
  end if;
  -- Új verzió csak jóváhagyott (immutábilis) verzióból indul.
  if src.status <> 'approved' then
    raise exception 'not_approved: % (status: %)', p_artifact_id, src.status;
  end if;

  return query
  insert into artifacts (project_id, type, version, status, body, source_input_ids, fields)
  select
    src.project_id,
    src.type,
    (select coalesce(max(a.version), 0) + 1
       from artifacts a
      where a.project_id = src.project_id and a.type = src.type),
    'draft',
    src.body,
    src.source_input_ids,
    src.fields
  returning *;
end
$$;

-- 7) PostgREST séma-cache ------------------------------------------------
notify pgrst, 'reload schema';

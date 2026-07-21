-- ─────────────────────────────────────────────────────────────
-- 0015 — Csomag C1: Tudáselem-katalógus adat-rétege
--
-- KÉZI FUTTATÁS: Máté futtatja a Supabase SQL editorból. Idempotens —
-- többszöri futtatás biztonságos. A végén: NOTIFY pgrst, 'reload schema';
--
-- HÁROM RÉSZ:
--   (1) artifact_render_links — renderelés-él tábla (perzisztált tény:
--       „ez az artifact(-mező) ezt a tudáselemet renderelte, ekkor").
--       EGY-ÍRÓ: kizárólag a 4 generálás/sync action (rangsor, Megoldási
--       javaslat, syncDoc, syncReport) — field-extract és kézi mentés
--       SOHA nem ír élt.
--   (2) knowledge_catalog — DERIVE-ONLY nézet (nulla írás): a meglévő
--       táblákból számolt cédulák a spec 4.1 leképezése szerint.
--   (3) stale_acks.kind CHECK bővítése a 'render_stale' fajtával (C1.4).
--
-- NÉV-DÖNTÉS (C1.1/C1.2, a spec javasolt neveit megtartva):
--   · artifact_render_links — illeszkedik a *_links él-tábla konvencióhoz
--     (component_links, requirement_stories); az „artifact_” előtag
--     megkülönbözteti az entitás↔entitás kötésektől.
--   · knowledge_catalog — a spec javasolt neve; nincs ütköző név a sémában.
--
-- SÉMA-DÖNTÉSEK:
--   · target_id SOFT-REF (text, nem FK) — a component_links dokumentált
--     mintája szerint: a cél-típusok több uuid-táblát fednek, polimorf
--     célra Postgres-FK nem tehető. A cél-tábla a target_type-ból
--     egyértelmű. Árva-él kockázat: cél-törléskor az él bent maradhat —
--     az olvasó (lib/catalog) a nem-létező célt kihagyja; a következő
--     regen/sync cseréli az éleket (replace-szemantika).
--   · field_key NULL = teljes-dokumentum él (entitySourced generálás:
--     rangsor, Megoldási javaslat); kitöltve = modul-mező él (syncDoc/
--     syncReport). A unique index coalesce(field_key,'')-vel fedi mindkettőt.
--   · A D1 mező-cédula horgonya LOGIKAI (artifact_id + jsonb-kulcs) —
--     a spec 5. döntése; nincs mező-szintű sor/FK.
--   · A katalógus a D1 mező-cédulákat CSAK a HEAD verzióról deriválja
--     (max version per project+type): az új-verzió klón a mezőket
--     változatlanul másolja, verziónkénti cédula csak duplikálna; a
--     régi verziók a dokumentum-történetben visszanézhetők.
--   · approved_at = a meglévő updated_at KÖZELÍTÉS (spec 5. korlát);
--     ahol nincs updated_at (pain_points, acceptance_criteria, epics,
--     eval_criteria), ott created_at ill. a szülő updated_at-ja.
--   · Az artifact-típus → fázis leképezés a nézetben CASE-ként duplikálja
--     a TS-konfigot (src/lib/artifacts/config.ts) — az artifacts táblán
--     nincs phase oszlop; dokumentált korlát (típus-bővítéskor a CASE-t
--     is bővíteni kell).
-- ─────────────────────────────────────────────────────────────

-- ── (1) Renderelés-él tábla ──────────────────────────────────
create table if not exists artifact_render_links (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects (id) on delete cascade,
  artifact_id uuid not null references artifacts (id) on delete cascade,
  -- NULL = teljes-dokumentum renderelés (entitySourced generálás);
  -- kitöltve = melyik modul-mezőt táplálja a cél (syncDoc/syncReport).
  field_key   text null,
  target_type text not null check (target_type in
    ('use_case', 'solution_component', 'component_option',
     'build_component', 'prompt_item', 'control_point', 'eval_case')),
  -- soft-ref (lásd fejléc-indoklás): a cél-tábla uuid-ja szövegként
  target_id   text not null,
  rendered_at timestamptz not null default now()
);

create unique index if not exists uq_artifact_render_links
  on artifact_render_links (artifact_id, coalesce(field_key, ''), target_type, target_id);
create index if not exists artifact_render_links_artifact_idx
  on artifact_render_links (artifact_id);
create index if not exists artifact_render_links_target_idx
  on artifact_render_links (target_type, target_id);
create index if not exists artifact_render_links_project_idx
  on artifact_render_links (project_id);

alter table artifact_render_links enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'artifact_render_links'
      and policyname = 'service_all_artifact_render_links'
  ) then
    create policy service_all_artifact_render_links on artifact_render_links
      for all using (true) with check (true);
  end if;
end $$;

-- ── (3 előre, mert a nézet nem függ tőle) stale_acks.kind bővítés ──
-- Az inline CHECK neve a 0013-ból: stale_acks_kind_check. Drop + add =
-- idempotens nettó eredmény (újrafuttatásra ugyanaz az állapot).
alter table stale_acks drop constraint if exists stale_acks_kind_check;
alter table stale_acks add constraint stale_acks_kind_check
  check (kind in ('source_updated', 'origin_drift', 'doc_stale', 'render_stale'));

-- ── (2) A katalógus-nézet (derive-only, NULLA írás) ──────────
-- Cédula-oszlopok (minden ágon azonos):
--   block_type    — a tudáselem fajtája (tábla-szintű megkülönböztető)
--   block_id      — a hordozó sor uuid-ja szövegként (D1 mező-cédulánál NULL)
--   artifact_id   + field_key — a D1/artifact cédulák horgonya
--   project_id · phase · title · excerpt (max 240 kar)
--   approval_mode — 'direct' (saját állapot) | 'inherited' (AC/epic)
--   enrichment    — jsonb gazdagítás (is_selected nyertes, final_verdict…)
--   source_input_ids · source_indices — forrás-eredet (a 0013
--     verzió-csoporton át az app oldja fel: lib/sources)
--   approved_at (≈ updated_at, közelítés) · created_at
create or replace view knowledge_catalog as
-- entity_state ágak: confirmed VAGY manual → benne ─────────────
select
  'pain_point'::text as block_type,
  p.id::text         as block_id,
  null::uuid         as artifact_id,
  null::text         as field_key,
  p.project_id,
  'P1'::text         as phase,
  p.title,
  left(coalesce(p.description, p.quote, ''), 240) as excerpt,
  'direct'::text     as approval_mode,
  null::jsonb        as enrichment,
  p.source_input_ids,
  null::int[]        as source_indices,
  p.created_at       as approved_at,
  p.created_at
from pain_points p
where p.state in ('confirmed', 'manual')

union all
select
  'use_case', u.id::text, null, null, u.project_id, 'P1',
  u.title, left(coalesce(u.description, ''), 240), 'direct',
  jsonb_build_object('list_status', u.list_status, 'quick_win', u.quick_win),
  u.source_input_ids, null, u.updated_at, u.created_at
from use_cases u
where u.state in ('confirmed', 'manual')

union all
select
  'stakeholder', s.id::text, null, null, s.project_id, 'P1',
  s.name, left(coalesce(s.title, ''), 240), 'direct',
  null, s.source_input_ids, null, s.updated_at, s.created_at
from stakeholders s
where s.state in ('confirmed', 'manual')

union all
select
  'requirement', r.id::text, null, null, r.project_id, r.phase,
  r.display_id, left(r.text, 240), 'direct',
  jsonb_build_object('level', r.level, 'moscow', r.moscow),
  r.source_input_ids, null, r.updated_at, r.created_at
from requirements r
where r.state in ('confirmed', 'manual')

union all
select
  'user_story', us.id::text, null, null, us.project_id, 'P2',
  us.display_id, left(us.role || ' — ' || us.want, 240), 'direct',
  jsonb_build_object('moscow', us.moscow),
  us.source_input_ids, null, us.updated_at, us.created_at
from user_stories us
where us.state in ('confirmed', 'manual')

union all
-- a nyertes opció (is_selected — HITL mező-bool) GAZDAGÍTJA a cédulát;
-- az alap-belépés az entity_state szerint (spec 4.1)
select
  'solution_component', sc.id::text, null, null, sc.project_id, sc.phase,
  sc.name, left(sc.description, 240), 'direct',
  (select jsonb_build_object(
     'selected_option_id', o.id, 'selected_option_name', o.name)
   from component_options o
   where o.component_id = sc.id and o.is_selected
   limit 1),
  sc.source_input_ids, null, sc.updated_at, sc.created_at
from solution_components sc
where sc.state in ('confirmed', 'manual')

union all
select
  'build_component', b.id::text, null, null, b.project_id, b.phase,
  b.name, left(b.description, 240), 'direct',
  jsonb_build_object('display_id', b.display_id, 'layer_type', b.layer_type),
  b.source_input_ids, null, b.updated_at, b.created_at
from build_components b
where b.state in ('confirmed', 'manual')

union all
select
  'prompt_item', pi.id::text, null, null, pi.project_id, 'P3',
  pi.name, left(pi.purpose, 240), 'direct',
  jsonb_build_object('display_id', pi.display_id),
  pi.source_input_ids, null, pi.updated_at, pi.created_at
from prompt_items pi
where pi.state in ('confirmed', 'manual')

union all
select
  'control_point', c.id::text, null, null, c.project_id, 'P3',
  c.name, left(c.description, 240), 'direct',
  jsonb_build_object('kind', c.kind),
  c.source_input_ids, null, c.updated_at, c.created_at
from control_points c
where c.state in ('confirmed', 'manual')

union all
-- final_verdict (emberi végső ítélet — mező-bool család) gazdagít
select
  'eval_case', e.id::text, null, null, g.project_id, g.phase,
  e.display_id, left(e.input_text, 240), 'direct',
  jsonb_build_object('final_verdict', e.final_verdict, 'verdict_at', e.verdict_at),
  e.source_input_ids, null, e.updated_at, e.created_at
from eval_cases e
join golden_sets g on g.id = e.golden_set_id
where e.state in ('confirmed', 'manual')

union all
select
  'eval_criterion', ec.id::text, null, null, g.project_id, g.phase,
  left(ec.text, 240), null, 'direct',
  jsonb_build_object('ord', ec.ord),
  null, null, ec.created_at, ec.created_at
from eval_criteria ec
join eval_cases e on e.id = ec.eval_case_id
join golden_sets g on g.id = e.golden_set_id
where ec.state in ('confirmed', 'manual')

union all
-- ArtifactStatus ág: approved artifact → dokumentum-cédula ─────
select
  'artifact', a.id::text, a.id, null, a.project_id,
  case a.type
    when 'Projekt-charter'                then 'P0'
    when 'Engagement-terv'                then 'P0'
    when 'Kickoff-agenda'                 then 'P0'
    when 'Priorizált use case-shortlist'  then 'P1'
    when 'Felmérési riport'               then 'P1'
    when 'Business case'                  then 'P2'
    when 'Pilot-terv'                     then 'P2'
    when 'Megoldási javaslat'             then 'P2'
    when 'TO-BE terv'                     then 'P2'
    when 'Megoldás-dokumentáció'          then 'P3'
    when 'Tesztriport'                    then 'P3'
    else null
  end,
  a.type || ' v' || a.version, left(a.body, 240), 'direct',
  jsonb_build_object('status', a.status, 'version', a.version),
  a.source_input_ids, null, a.updated_at, a.created_at
from artifacts a
where a.status = 'approved'

union all
-- approved folyamattérkép → TÉRKÉP-szintű cédula (a node-ok az élek
-- felől címezhetők maradnak, de v1-ben nem külön cédulák — spec 4.1)
select
  'process_map', m.id::text, null, null, m.project_id,
  coalesce(m.phase, case m.kind when 'as_is' then 'P1' else 'P2' end),
  m.title, m.kind, 'direct',
  jsonb_build_object('kind', m.kind, 'version', m.version),
  case when m.source_input_id is not null
       then array[m.source_input_id] end,
  null, m.updated_at, m.created_at
from process_maps m
where m.status = 'approved'

union all
-- D1 mező-cédulák: fields jsonb, state ∈ {confirmed, manual}; CSAK a
-- HEAD verzióról (lásd fejléc-döntés); horgony = artifact_id + kulcs
select
  'artifact_field', null, a.id, f.key, a.project_id,
  case a.type
    when 'Projekt-charter'                then 'P0'
    when 'Engagement-terv'                then 'P0'
    when 'Kickoff-agenda'                 then 'P0'
    when 'Priorizált use case-shortlist'  then 'P1'
    when 'Felmérési riport'               then 'P1'
    when 'Business case'                  then 'P2'
    when 'Pilot-terv'                     then 'P2'
    when 'Megoldási javaslat'             then 'P2'
    when 'TO-BE terv'                     then 'P2'
    when 'Megoldás-dokumentáció'          then 'P3'
    when 'Tesztriport'                    then 'P3'
    else null
  end,
  f.key, left(coalesce(f.value ->> 'value', ''), 240), 'direct',
  jsonb_build_object('field_state', f.value ->> 'state',
                     'artifact_status', a.status),
  a.source_input_ids,
  case when jsonb_typeof(f.value -> 'source_indices') = 'array'
       then (select array_agg(x::int)
             from jsonb_array_elements_text(f.value -> 'source_indices') t(x)
             where x ~ '^[0-9]+$')
  end,
  a.updated_at, a.created_at
from artifacts a
join lateral jsonb_each(
  case when jsonb_typeof(a.fields) = 'object'
       then a.fields else '{}'::jsonb end) f(key, value) on true
where a.version = (select max(x.version) from artifacts x
                   where x.project_id = a.project_id and x.type = a.type)
  and f.value ->> 'state' in ('confirmed', 'manual')

union all
-- örökölt jóváhagyás (spec 4.1): AC benne, ha a szülő requirement
-- jóváhagyott — approval_mode='inherited'
select
  'acceptance_criterion', ac.id::text, null, null, r.project_id, r.phase,
  ac.title,
  left(ac.given_text || ' / ' || ac.when_text || ' / ' || ac.then_text, 240),
  'inherited',
  jsonb_build_object('requirement_id', ac.requirement_id, 'ord', ac.ord),
  null, null, r.updated_at, ac.created_at
from acceptance_criteria ac
join requirements r on r.id = ac.requirement_id
where r.state in ('confirmed', 'manual')

union all
-- epic benne, ha VAN legalább egy jóváhagyott kapcsolt elem:
-- a business requirement szülő VAGY egy hozzá kötött story
select
  'epic', ep.id::text, null, null, ep.project_id, 'P2',
  ep.display_id || ' — ' || ep.title, null, 'inherited',
  jsonb_build_object('business_requirement_id', ep.business_requirement_id),
  null, null, ep.created_at, ep.created_at
from epics ep
where exists (
    select 1 from requirements r
    where r.id = ep.business_requirement_id
      and r.state in ('confirmed', 'manual'))
   or exists (
    select 1 from user_stories us
    where us.epic_id = ep.id and us.state in ('confirmed', 'manual'));

-- PostgREST séma-frissítés (ha részletekben futtatod, a végén egyszer
-- mindenképp fusson le):
notify pgrst, 'reload schema';

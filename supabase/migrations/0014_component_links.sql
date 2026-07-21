-- ─────────────────────────────────────────────────────────────
-- 0014 — Kötéstábla-konszolidáció (Csomag A7): component_links
--
-- KÉZI FUTTATÁS: Máté futtatja a Supabase SQL editorból. Idempotens —
-- többszöri futtatás biztonságos. A végén: NOTIFY pgrst, 'reload schema';
--
-- SÉMA-DÖNTÉS (A7.1, a spec 4.1 keretein belül):
--   Egységesített CÉL-modell + KÉT valódi owner-FK oszlop (nem szöveges
--   polimorf owner):
--   · solution_component_id  → P2 dokkolás-szemantika (cél mindig tobe_node)
--   · build_component_id     → P3 megvalósítás-kötés (4 cél-típus)
--   Pontosan EGY owner kitöltött (CHECK) — a kötés-fajta a sorból
--   visszaállítható: melyik owner-oszlop nem NULL (b követelmény).
--   Hivatkozás-integritás (c): az ownerekre és a process_map-re VALÓDI FK
--   (on delete cascade — a komponens-törlés viselkedése változatlan).
--   A CÉL soft-ref marad (target_type + target_id szövegként), mert a négy
--   cél-típus három uuid-táblát ÉS a process_maps jsonb-n BELÜLI stabil
--   node-id-t fedi — polimorf célra Postgres-FK nem tehető; ez azonos a
--   kivezetett impl_links dokumentált megoldásával. A tobe_node célnál a
--   process_map_id a provenance (FK), a render a mindenkori jóváhagyott
--   TO-BE node-id-jaira illeszt (0010-ben dokumentált id-stabilitás).
--
-- SORREND (az idempotenciáért): (1) régi táblák átnevezése *_deprecated
-- névre (adat MEGMARAD — törlés tilos; az app-kód már nem hivatkozik
-- rájuk), (2) új tábla létrehozása, (3) backfill a deprecated nevekből
-- (where not exists — újrafuttatásra nem duplikál).
-- ─────────────────────────────────────────────────────────────

-- (1) Régi táblák → *_deprecated (csak ha még eredeti néven léteznek)
do $$
begin
  if to_regclass('public.component_step_links') is not null then
    alter table component_step_links rename to component_step_links_deprecated;
  end if;
  if to_regclass('public.impl_links') is not null then
    alter table impl_links rename to impl_links_deprecated;
  end if;
end $$;

-- (2) Az egységes kötéstábla
create table if not exists component_links (
  id                    uuid primary key default gen_random_uuid(),
  -- pontosan egy owner (a kötés-fajta ebből áll vissza):
  solution_component_id uuid null references solution_components (id) on delete cascade,
  build_component_id    uuid null references build_components (id) on delete cascade,
  target_type           text not null
    check (target_type in ('requirement', 'story', 'tobe_node', 'pain_point')),
  -- soft-ref (lásd fejléc-indoklás): uuid szövegként VAGY TO-BE node-id
  target_id             text not null,
  process_map_id        uuid null references process_maps (id) on delete cascade,
  -- E1-állapot a megvalósítás-kötéseken (ai_suggested → confirmed / törlés);
  -- a dokkolás-sor emberi felvétel → 'manual' (a dokk-olvasó nem szűr rá).
  state                 entity_state not null default 'manual',
  created_at            timestamptz not null default now(),
  constraint component_links_one_owner
    check (num_nonnulls(solution_component_id, build_component_id) = 1),
  -- dokkolás-szemantika: solution-owner CSAK TO-BE lépésre köthet
  constraint component_links_dock_target
    check (solution_component_id is null or target_type = 'tobe_node')
);

-- a két kivezetett tábla unique-jainak közös utódja:
--   impl_links: unique (component_id, target_type, target_id)
--   component_step_links: pk (component_id, node_id)
create unique index if not exists uq_component_links_owner_target
  on component_links (coalesce(solution_component_id, build_component_id), target_type, target_id);
create index if not exists component_links_solution_idx
  on component_links (solution_component_id) where solution_component_id is not null;
create index if not exists component_links_build_idx
  on component_links (build_component_id) where build_component_id is not null;
create index if not exists component_links_map_idx on component_links (process_map_id);

alter table component_links enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'component_links' and policyname = 'service_all_component_links'
  ) then
    create policy service_all_component_links on component_links
      for all using (true) with check (true);
  end if;
end $$;

-- (3) Backfill — teljes, idempotens (adatvesztés nélkül)
-- 3a: dokkolás-sorok (component_step_links_deprecated → solution-owner)
insert into component_links
  (solution_component_id, target_type, target_id, process_map_id, state)
select d.component_id, 'tobe_node', d.node_id, d.process_map_id, 'manual'::entity_state
from component_step_links_deprecated d
where not exists (
  select 1 from component_links l
  where l.solution_component_id = d.component_id
    and l.target_type = 'tobe_node'
    and l.target_id = d.node_id
);

-- 3b: megvalósítás-kötések (impl_links_deprecated → build-owner)
insert into component_links
  (build_component_id, target_type, target_id, process_map_id, state, created_at)
select d.component_id, d.target_type, d.target_id, d.process_map_id, d.state, d.created_at
from impl_links_deprecated d
where not exists (
  select 1 from component_links l
  where l.build_component_id = d.component_id
    and l.target_type = d.target_type
    and l.target_id = d.target_id
);

-- ─────────────────────────────────────────────────────────────
-- SOR-PARITÁS ELLENŐRZÉS (A7.4 — futtasd a migráció után; minden sorban
-- a diff oszlopnak 0-nak kell lennie):
--
--   select 'dokkolás' as forras,
--          (select count(*) from component_step_links_deprecated) as regi,
--          (select count(*) from component_links where solution_component_id is not null) as uj,
--          (select count(*) from component_step_links_deprecated)
--        - (select count(*) from component_links where solution_component_id is not null) as diff
--   union all
--   select 'megvalósítás',
--          (select count(*) from impl_links_deprecated),
--          (select count(*) from component_links where build_component_id is not null),
--          (select count(*) from impl_links_deprecated)
--        - (select count(*) from component_links where build_component_id is not null);
--
-- Szúrópróba a szemantikus mezőkre (0 sort kell adnia — nincs olyan régi
-- sor, aminek nem azonos tartalmú új párja volna):
--
--   select * from impl_links_deprecated d
--   where not exists (
--     select 1 from component_links l
--     where l.build_component_id = d.component_id and l.target_type = d.target_type
--       and l.target_id = d.target_id and l.state = d.state
--       and l.process_map_id is not distinct from d.process_map_id);
--
--   select * from component_step_links_deprecated d
--   where not exists (
--     select 1 from component_links l
--     where l.solution_component_id = d.component_id and l.target_type = 'tobe_node'
--       and l.target_id = d.node_id
--       and l.process_map_id is not distinct from d.process_map_id);
-- ─────────────────────────────────────────────────────────────

-- PostgREST séma-frissítés (ha részletekben futtatod, a végén egyszer
-- mindenképp fusson le):
notify pgrst, 'reload schema';

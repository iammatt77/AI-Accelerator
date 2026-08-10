-- ─────────────────────────────────────────────────────────────
-- 0018 — Epic 4 · 4.2: Címkézés konfidencia-jelei + javítás-napló
--
-- KÉZI FUTTATÁS: Máté futtatja a Supabase SQL editorból. Idempotens —
-- többszöri futtatás biztonságos. A végén: NOTIFY pgrst, 'reload schema';
--
-- ADDITÍV: a 4.1 tábláit (0017) NEM módosítja. A címkék maguk a
-- knowledge_metadata-ba mennek (setMetadata); ez a két tábla a 4.2 saját
-- adata:
--   (1) knowledge_label_signals    — dimenziónkénti konfidencia-jel:
--       címke + konfidencia + indok + bizonyíték-idézet + szavazat-
--       megoszlás (F2) + gép/ember eredet (F4) + elem-szintű kétes (F3).
--       Horgonyonként EGY sor (a 0017 unique-minta) — újracímkézés csere.
--   (2) knowledge_label_corrections — javítás-napló (F5), append-only:
--       eredeti gépi címke + új emberi címke + a gép akkori konfidenciája
--       + kétes-volt-e + dimenzió + időpont. Ebből olvasható ki a hangolási
--       irány: kétes-volt + változatlanul jóváhagyva = túl óvatos;
--       biztos-volt + átírva = túl bátor.
--
-- HORGONY: a katalógus-cédula két kizárólagos alakja (0017 CHECK-minta).
-- A corrections-ön SZÁNDÉKOSAN nincs artifact FK: a napló audit-céllal
-- túléli az elem törlését (mint a knowledge_dismissals).
-- ─────────────────────────────────────────────────────────────

-- ── (1) knowledge_label_signals ──────────────────────────────
create table if not exists knowledge_label_signals (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects (id) on delete cascade,
  -- horgony (katalógus-cédula)
  block_type  text not null,
  block_id    text null,
  artifact_id uuid null references artifacts (id) on delete cascade,
  field_key   text null,
  -- dimenziónkénti jel: { modality|valid_time|scope|source|lang:
  --   { label, confidence, reason, evidence, votes?, samples?,
  --     accepted, source: 'gep'|'ember' } }
  signals     jsonb not null default '{}'::jsonb,
  -- F3: kétes elem — nem vesz részt a felismerésben (4.3 ezen szűr)
  doubtful    boolean not null default false,
  doubtful_dimensions text[] not null default '{}',
  labeled_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint knowledge_label_signals_anchor_shape check (
    (block_id is not null and field_key is null)
    or (block_type = 'artifact_field' and block_id is null
        and artifact_id is not null and field_key is not null)
  )
);

create unique index if not exists uq_knowledge_label_signals_anchor
  on knowledge_label_signals (project_id, block_type,
    coalesce(block_id, ''), coalesce(artifact_id::text, ''), coalesce(field_key, ''));
create index if not exists knowledge_label_signals_project_idx
  on knowledge_label_signals (project_id);
create index if not exists knowledge_label_signals_doubtful_idx
  on knowledge_label_signals (project_id, doubtful);

-- ── (2) knowledge_label_corrections — append-only napló ──────
create table if not exists knowledge_label_corrections (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects (id) on delete cascade,
  block_type  text not null,
  block_id    text null,
  artifact_id uuid null,
  field_key   text null,
  dimension   text not null
    check (dimension in ('modality', 'valid_time', 'scope', 'source', 'lang')),
  old_label   text null,   -- a gépi címke (jelölt/elfogadott), szövegesen
  new_label   text null,   -- az emberi címke; old=new → változtatás nélküli jóváhagyás
  machine_confidence real null,  -- a gép akkori konfidenciája (0..1)
  was_doubtful boolean not null default false,
  corrected_at timestamptz not null default now(),
  constraint knowledge_label_corrections_anchor_shape check (
    (block_id is not null and field_key is null)
    or (block_type = 'artifact_field' and block_id is null
        and artifact_id is not null and field_key is not null)
  )
);

create index if not exists knowledge_label_corrections_project_idx
  on knowledge_label_corrections (project_id);
create index if not exists knowledge_label_corrections_dim_idx
  on knowledge_label_corrections (project_id, dimension);

-- ── RLS (a projekt-táblák mintája: service-role minden) ──────
do $$
declare t text;
begin
  foreach t in array array[
    'knowledge_label_signals', 'knowledge_label_corrections'
  ] loop
    execute format('alter table %I enable row level security', t);
    if not exists (
      select 1 from pg_policies
      where tablename = t and policyname = 'service_all_' || t
    ) then
      execute format(
        'create policy %I on %I for all using (true) with check (true)',
        'service_all_' || t, t);
    end if;
  end loop;
end $$;

-- PostgREST séma-frissítés
notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- 0017 — Epic 4 · 4.1: Elavulás-modell kiterjesztése (adat-réteg)
--
-- KÉZI FUTTATÁS: Máté futtatja a Supabase SQL editorból. Idempotens —
-- többszöri futtatás biztonságos. A végén: NOTIFY pgrst, 'reload schema';
--
-- Tisztán adat, felület nélkül (mint a 2.1 / 0015). A 4.1 MELLÉÉPÍT a
-- katalógusra (0015) — nem módosítja. Öt szerkezet:
--   (0) vector extension (pgvector) — a hasonlósági kereséshez
--   (1) knowledge_metadata   — a négydimenziós keret + explicit elavítás
--   (2) knowledge_embeddings — vektor + modell név/verzió, azonos horgony
--   (3) knowledge_supersessions — irányított „meghaladta" él, indoklással
--   (4) knowledge_findings   — a hat finding-típus + feloldási állapotgép
--   (5) knowledge_dismissals — sticky elutasítás + tartalom-lenyomat
--   (6) match_knowledge_embeddings() — hasonlósági RPC, metaadat-ELŐszűréssel
--
-- HORGONY (compliance 1. döntés): a katalógus (knowledge_catalog, 0015)
-- SAJÁT négyoszlopos cédula-alakját vesszük át — NEM a stale_acks
-- egyértékű (subject_type,subject_id) párját, mert az artifact_field cédula
-- KÉTÉRTÉKŰ (artifact_id + field_key). Két horgony-alak, kizárólagosan:
--   · entitás-cédula:      block_id NOT NULL, field_key NULL
--     (pain_point … process_map + a teljes-artifact: block_type='artifact')
--   · artifact_field cédula: block_type='artifact_field',
--     artifact_id + field_key NOT NULL, block_id NULL
-- Ugyanez a horgony ismétlődik minden táblán (a polimorf minta ára — mint
-- a stale_acks subject_type/subject_id-je). A finding és a supersession
-- KÉT horgonyt hordoz (elem-pár): a_* és b_*, ill. superseded_* / superseding_*.
--
-- HASONLÓSÁG (compliance 5. döntés): a mi adatméretünknél (egyfelhasználós,
-- projektenként tucat–pár száz elem) NINCS ANN-index — PONTOS (flat) KNN
-- `WHERE` metaadat-ELŐszűréssel. Így a szűrés ténylegesen érvényesül (F5),
-- a HNSW post-filter hiány fogalmilag nem áll fenn. HNSW + particionálás
-- (vagy pgvector 0.8 iterative_scan) skálázáskor, NEM most.
--
-- NF2: metaadat/embedding NÉLKÜL is működik minden — a kényszerek csak az
-- ÍRÁS pillanatában érvényesek (modalitás alapérték 'ismeretlen';
-- elavítás/supersession/dismissal indoklás NOT NULL), nem a meglévő adatra.
--
-- VEKTOR-DIMENZIÓ: BGE-M3 dense = 1024. A modell név+verzió külön oszlop
-- (F4) — modell-váltáskor tudni, mit kell újraszámolni. Más dimenziójú
-- modellre váltás külön migráció (a vector(1024) fix).
-- ─────────────────────────────────────────────────────────────

-- ── (0) pgvector extension ───────────────────────────────────
create extension if not exists vector;

-- ── Közös horgony-kényszer makró helyett: minden táblán ismételve ──
-- (Postgres-ben nincs reusable CHECK-sablon; a mintát kommentben rögzítjük.)

-- ── (1) knowledge_metadata — a négydimenziós keret ───────────
create table if not exists knowledge_metadata (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects (id) on delete cascade,
  -- horgony (katalógus-cédula)
  block_type  text not null,
  block_id    text null,
  artifact_id uuid null references artifacts (id) on delete cascade,
  field_key   text null,
  -- 4-dim keret
  modality    text not null default 'ismeretlen'
    check (modality in ('historikus', 'as_is', 'normativ', 'to_be', 'ismeretlen')),
  -- érvényességi idő: intervallum, NYITOTT véggel is; a rendszerbe kerülés
  -- (created_at) idejétől FÜGGETLENÜL kérdezhető (F3)
  valid_time  tstzrange null,
  lang        text null,
  -- forrás-attribúció: személy (stakeholder-ref, nem másolt név) +
  -- szervezeti szint + forrás-típus
  source_person_stakeholder_id uuid null references stakeholders (id) on delete set null,
  source_org_level text not null default 'ismeretlen'
    check (source_org_level in ('hq', 'helyi', 'kulso', 'ismeretlen')),
  source_kind text null,   -- dokumentum / interju / megfigyeles / rendszeradat
  scope       text null,   -- hatókör (derivált vagy emberi)
  -- explicit emberi elavítás (8-as eset) — indoklás KÖTELEZŐ (F9)
  deprecated_at     timestamptz null,
  deprecated_reason text null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- horgony-alak: entitás-cédula VAGY artifact_field cédula, kizárólagosan
  constraint knowledge_metadata_anchor_shape check (
    (block_id is not null and field_key is null)
    or (block_type = 'artifact_field' and block_id is null
        and artifact_id is not null and field_key is not null)
  ),
  -- F9: elavítás jelölés → indoklás kötelező (nem-üres)
  constraint knowledge_metadata_deprecation_reason check (
    deprecated_at is null
    or (deprecated_reason is not null and length(btrim(deprecated_reason)) > 0)
  )
);

create unique index if not exists uq_knowledge_metadata_anchor
  on knowledge_metadata (project_id, block_type,
    coalesce(block_id, ''), coalesce(artifact_id::text, ''), coalesce(field_key, ''));
create index if not exists knowledge_metadata_project_idx on knowledge_metadata (project_id);
create index if not exists knowledge_metadata_modality_idx on knowledge_metadata (modality);
create index if not exists knowledge_metadata_scope_idx on knowledge_metadata (scope);

-- ── (2) knowledge_embeddings — vektor + modell-attribúció ─────
create table if not exists knowledge_embeddings (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects (id) on delete cascade,
  block_type  text not null,
  block_id    text null,
  artifact_id uuid null references artifacts (id) on delete cascade,
  field_key   text null,
  embedding   vector(1024) not null,          -- BGE-M3 dense
  model_name    text not null,                -- F4: mit kell újraszámolni
  model_version text not null,
  content_text  text not null,                -- amit beágyaztunk (újra-embed + lenyomat)
  created_at  timestamptz not null default now(),
  constraint knowledge_embeddings_anchor_shape check (
    (block_id is not null and field_key is null)
    or (block_type = 'artifact_field' and block_id is null
        and artifact_id is not null and field_key is not null)
  )
);

-- egy tudáselemre egy vektor / modell (újra-embed = csere)
create unique index if not exists uq_knowledge_embeddings_anchor
  on knowledge_embeddings (project_id, block_type,
    coalesce(block_id, ''), coalesce(artifact_id::text, ''), coalesce(field_key, ''));
create index if not exists knowledge_embeddings_project_idx on knowledge_embeddings (project_id);
-- SZÁNDÉKOSAN NINCS HNSW/IVFFlat index (compliance 5): a pontos KNN a
-- `WHERE` előszűrővel a mi méretünknél helyes és gyors; index skálázáskor.

-- ── (3) knowledge_supersessions — irányított „meghaladta" él ──
create table if not exists knowledge_supersessions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects (id) on delete cascade,
  -- meghaladott (from)
  superseded_block_type  text not null,
  superseded_block_id    text null,
  superseded_artifact_id uuid null,
  superseded_field_key   text null,
  -- meghaladó (to)
  superseding_block_type  text not null,
  superseding_block_id    text null,
  superseding_artifact_id uuid null,
  superseding_field_key   text null,
  reason      text not null,                  -- KÖTELEZŐ indoklás (F6) → RAG
  created_at  timestamptz not null default now(),
  constraint knowledge_supersessions_reason check (length(btrim(reason)) > 0),
  constraint knowledge_supersessions_from_shape check (
    (superseded_block_id is not null and superseded_field_key is null)
    or (superseded_block_type = 'artifact_field' and superseded_block_id is null
        and superseded_artifact_id is not null and superseded_field_key is not null)
  ),
  constraint knowledge_supersessions_to_shape check (
    (superseding_block_id is not null and superseding_field_key is null)
    or (superseding_block_type = 'artifact_field' and superseding_block_id is null
        and superseding_artifact_id is not null and superseding_field_key is not null)
  )
);

create index if not exists knowledge_supersessions_project_idx on knowledge_supersessions (project_id);
create index if not exists knowledge_supersessions_from_idx
  on knowledge_supersessions (superseded_block_type, coalesce(superseded_block_id, ''),
    coalesce(superseded_artifact_id::text, ''), coalesce(superseded_field_key, ''));

-- ── (4) knowledge_findings — hat típus + feloldási állapotgép ─
-- Típus 1..6 = ① valódi ellentmondás · ② stakeholder-eltérés ·
--   ③ policy vs gyakorlat · ④ időbeli meghaladás · ⑤ duplikátum · ⑥ mintázat.
-- KÉT ÁG (tervezési dok. §5; a spec ide utal):
--   · feloldható (1,4,5): status ∈ felismerve / a_ervenyes / b_ervenyes /
--     mindketto_ervenyes / hamis_pozitiv / osszevonando.
--     (⑤ a tervezési dok. §3/§5 „összevonandó/merge" végállapotán oldódik;
--      a spec AC csak ① ④-et NEVEZ példaként, de a §5-re utal, ahol a
--      lelet-ág KIZÁRÓLAG ② ③ ⑥.)
--   · lelet (2,3,6): status = 'lelet', nem vár emberi műveletre.
create table if not exists knowledge_findings (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects (id) on delete cascade,
  finding_type int not null check (finding_type between 1 and 6),
  -- elem-pár: A horgony
  a_block_type  text not null,
  a_block_id    text null,
  a_artifact_id uuid null,
  a_field_key   text null,
  -- elem-pár: B horgony
  b_block_type  text not null,
  b_block_id    text null,
  b_artifact_id uuid null,
  b_field_key   text null,
  evidence     text null,                     -- a judge indoklása (4.2 tölti)
  status       text not null,
  resolved_at       timestamptz null,
  resolution_reason text null,
  created_at   timestamptz not null default now(),
  -- ág szerinti status-kényszer
  constraint knowledge_findings_status_branch check (
    (finding_type in (2, 3, 6) and status = 'lelet')
    or (finding_type in (1, 4, 5) and status in
        ('felismerve', 'a_ervenyes', 'b_ervenyes', 'mindketto_ervenyes',
         'hamis_pozitiv', 'osszevonando'))
  ),
  -- terminál feloldás → időpont + indoklás; 'felismerve'/'lelet' nem terminál
  constraint knowledge_findings_resolution check (
    (status in ('felismerve', 'lelet') and resolved_at is null)
    or (status in ('a_ervenyes', 'b_ervenyes', 'mindketto_ervenyes',
                   'hamis_pozitiv', 'osszevonando')
        and resolved_at is not null
        and resolution_reason is not null and length(btrim(resolution_reason)) > 0)
  ),
  constraint knowledge_findings_a_shape check (
    (a_block_id is not null and a_field_key is null)
    or (a_block_type = 'artifact_field' and a_block_id is null
        and a_artifact_id is not null and a_field_key is not null)
  ),
  constraint knowledge_findings_b_shape check (
    (b_block_id is not null and b_field_key is null)
    or (b_block_type = 'artifact_field' and b_block_id is null
        and b_artifact_id is not null and b_field_key is not null)
  )
);

create index if not exists knowledge_findings_project_idx on knowledge_findings (project_id);
create index if not exists knowledge_findings_status_idx on knowledge_findings (status);

-- ── (5) knowledge_dismissals — sticky elutasítás + lenyomat ───
-- Egy elutasított (elem-pár + finding-típus): soha többé nem keletkezik új
-- finding — KIVÉVE ha valamelyik elem TARTALMA érdemben változik (a
-- lenyomat eltér). A lenyomat sha256-hex a normalizált tartalomról (a 4.2
-- számítja jóváhagyás-időben; a forma a compliance ajánlása, spec 7.3).
create table if not exists knowledge_dismissals (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects (id) on delete cascade,
  finding_type int not null check (finding_type between 1 and 6),
  a_block_type  text not null,
  a_block_id    text null,
  a_artifact_id uuid null,
  a_field_key   text null,
  b_block_type  text not null,
  b_block_id    text null,
  b_artifact_id uuid null,
  b_field_key   text null,
  dismissed_reason text null,
  a_fingerprint text not null,                -- az A elem akkori tartalom-lenyomata
  b_fingerprint text not null,                -- a B elem akkori tartalom-lenyomata
  dismissed_at timestamptz not null default now(),
  constraint knowledge_dismissals_a_shape check (
    (a_block_id is not null and a_field_key is null)
    or (a_block_type = 'artifact_field' and a_block_id is null
        and a_artifact_id is not null and a_field_key is not null)
  ),
  constraint knowledge_dismissals_b_shape check (
    (b_block_id is not null and b_field_key is null)
    or (b_block_type = 'artifact_field' and b_block_id is null
        and b_artifact_id is not null and b_field_key is not null)
  )
);

create index if not exists knowledge_dismissals_project_idx on knowledge_dismissals (project_id);
create index if not exists knowledge_dismissals_pair_idx
  on knowledge_dismissals (project_id, finding_type,
    a_block_type, coalesce(a_block_id, ''), coalesce(a_artifact_id::text, ''), coalesce(a_field_key, ''),
    b_block_type, coalesce(b_block_id, ''), coalesce(b_artifact_id::text, ''), coalesce(b_field_key, ''));

-- ── RLS (a projekt-táblák mintája: service-role minden) ──────
do $$
declare t text;
begin
  foreach t in array array[
    'knowledge_metadata', 'knowledge_embeddings', 'knowledge_supersessions',
    'knowledge_findings', 'knowledge_dismissals'
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

-- ── (6) Hasonlósági RPC — pontos KNN, metaadat-ELŐszűréssel ───
-- A `WHERE` (hatókör + modalitás-család) a pontos szomszéd-keresés ELŐTT
-- fut (nincs ANN-index), így a szűrés ténylegesen érvényesül (F5). A
-- metaadatot LEFT JOIN köti a horgonyon; metaadat nélküli elem kimarad,
-- ha szűrő van megadva (nem tudja teljesíteni). A hasonlóság = 1 - koszinusz
-- távolság (<=>), így 1.0 = azonos, 0 = merőleges.
-- A query_embedding TEXT-ként érkezik (a lokális shim minden paramétert
-- szövegként köt; a valós PostgREST is elfogadja) → belül vector(1024)-re
-- kasztoljuk. A literál alakja: "[0.1,0.2,…]".
create or replace function match_knowledge_embeddings(
  query_embedding text,
  p_project_id uuid,
  p_scope text default null,
  p_modality_family text[] default null,
  p_exclude_block_type text default null,
  p_exclude_block_id text default null,
  p_exclude_artifact_id uuid default null,
  p_exclude_field_key text default null,
  match_count int default 10
)
returns table (
  block_type text,
  block_id text,
  artifact_id uuid,
  field_key text,
  content_text text,
  model_name text,
  model_version text,
  similarity float
)
language sql stable
as $$
  -- a text-paramétert egyszer kasztoljuk vektorrá (a shim text-ként köti)
  with q as (select query_embedding::vector(1024) as v)
  select
    e.block_type, e.block_id, e.artifact_id, e.field_key,
    e.content_text, e.model_name, e.model_version,
    1 - (e.embedding <=> (select v from q)) as similarity
  from knowledge_embeddings e
  left join knowledge_metadata m
    on m.project_id = e.project_id
   and m.block_type = e.block_type
   and coalesce(m.block_id, '') = coalesce(e.block_id, '')
   and coalesce(m.artifact_id::text, '') = coalesce(e.artifact_id::text, '')
   and coalesce(m.field_key, '') = coalesce(e.field_key, '')
  where e.project_id = p_project_id
    and (p_scope is null or m.scope = p_scope)
    and (p_modality_family is null or m.modality = any (p_modality_family))
    -- önmagát ne adja vissza (a lekérdezett elem kizárása)
    and not (
      p_exclude_block_type is not null
      and e.block_type = p_exclude_block_type
      and coalesce(e.block_id, '') = coalesce(p_exclude_block_id, '')
      and coalesce(e.artifact_id::text, '') = coalesce(p_exclude_artifact_id::text, '')
      and coalesce(e.field_key, '') = coalesce(p_exclude_field_key, '')
    )
  order by e.embedding <=> (select v from q)
  limit match_count;
$$;

-- PostgREST séma-frissítés
notify pgrst, 'reload schema';

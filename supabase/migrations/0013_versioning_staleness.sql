-- ─────────────────────────────────────────────────────────────
-- 0013 — Csomag A: verzió/elavulás-réteg (A8) + partíció-támogatás (A1)
--
-- Fogalmi modell (spec v0.2 + a v0.1-review beépített döntései):
--   · input_items VERZIÓ-CSOPORT: group_id + version. Egy forrás frissítése
--     = ÚJ sor ugyanabban a csoportban (version+1); a régi verzió VÁLTOZATLAN
--     marad (visszanézhető). A kanonikus [n] számozás CSOPORTONKÉNT él
--     (mindig a legfrissebb verzió a képviselő), a sorrend a csoport ELSŐ
--     verziójának created_at-ja szerint STABIL — így a meglévő citációk
--     (source_input_ids, bármely verzió-id) a csoporton át feloldódnak,
--     nem törnek el. Backfill: minden meglévő sor a SAJÁT csoportjának
--     v1-e (group_id = id).
--   · build_components.seeded_at: MIKOR seedelt a P2-komponensből — a
--     drift-jelölő (H5) alapja: solution_components.updated_at > seeded_at
--     (és > ack) → „a forrás-komponens változott". Backfill: created_at,
--     ahol origin_component_id van.
--   · artifacts.synced_at: az utolsó modul-sync / entitás-generálás
--     időbélyege (A1 „a modulból frissül" jelzés + az approve-sync-őr +
--     a doc-elavulás jelölő alapja). NULL = még nem futott sync.
--   · stale_acks: a jelölők NEM tárolt állapotok — időbélyeg-összevetésből
--     DERIVÁLTAK (nem tudnak elhazudni); KIZÁRÓLAG a feloldás („ellenőrizve")
--     tárolódik, polimorf ack-sorként. Újabb változás az ack után → a
--     jelölő újra megjelenik (a derivált összevetés az ack időbélyegét is
--     nézi). kind: source_updated (forrás-verzió > kinyerés) ·
--     origin_drift (P2-komponens > seeded_at) · doc_stale (tudáselem >
--     synced_at).
--
-- Idempotens; notify pgrst. Futtatás: Máté, kézzel, Supabase SQL-editor.
-- ─────────────────────────────────────────────────────────────

-- ── input_items: verzió-csoport ──────────────────────────────
alter table input_items
  add column if not exists group_id uuid null,
  add column if not exists version  int  not null default 1;

-- Backfill: minden meglévő sor a saját csoportjának v1-e.
update input_items set group_id = id where group_id is null;

alter table input_items alter column group_id set not null;

-- Egy csoporton belül a verziószám egyedi.
create unique index if not exists input_items_group_version_idx
  on input_items (group_id, version);

create index if not exists input_items_group_idx on input_items (group_id);

-- ── build_components: seed-időbélyeg (drift-alap) ────────────
alter table build_components
  add column if not exists seeded_at timestamptz null;

update build_components
  set seeded_at = created_at
  where seeded_at is null and origin_component_id is not null;

-- ── artifacts: modul-sync időbélyeg ──────────────────────────
alter table artifacts
  add column if not exists synced_at timestamptz null;

-- ── stale_acks: a jelölő-feloldások naplója (polimorf) ───────
create table if not exists stale_acks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects (id) on delete cascade,
  subject_type text not null,
  subject_id   text not null,
  kind         text not null check (kind in ('source_updated', 'origin_drift', 'doc_stale')),
  acked_at     timestamptz not null default now(),
  unique (subject_type, subject_id, kind)
);

create index if not exists stale_acks_project_idx on stale_acks (project_id);

alter table stale_acks enable row level security;

-- PostgREST séma-cache
notify pgrst, 'reload schema';

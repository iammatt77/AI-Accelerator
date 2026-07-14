-- ─────────────────────────────────────────────────────────────
-- 0005 — P1-mélység II.: értékelő-mezők a use_cases-en
-- (Coding-csomag #7b)
--
-- Supabase SQL-editorba EGYBEN bemásolható; IDEMPOTENS — második futás
-- nem hibázik és nem ront el adatot.
--
-- Tartalom: három jsonb oszlop a use_cases táblán —
--   1) ai_suitability  — AI-alkalmassági szűrő (kézikönyv 3.2):
--      { criteria: { c1..c5: 'yes'|'partial'|'no' }, note }
--   2) data_readiness  — adatérettség mini-értékelő (4 dimenzió,
--      láncszem-elv): { dimensions: {...}, level, note }
--   3) ai_act          — AI Act gyorsbesoroló (kézikönyv 6.1–6.2, E1):
--      { answers: {...}, suggested, confirmed_category, note }
-- Az üres {} default = „nincs értékelve" állapot.
-- ─────────────────────────────────────────────────────────────

alter table use_cases
  add column if not exists ai_suitability jsonb not null default '{}';

alter table use_cases
  add column if not exists data_readiness jsonb not null default '{}';

alter table use_cases
  add column if not exists ai_act jsonb not null default '{}';

-- PostgREST séma-cache --------------------------------------------------
notify pgrst, 'reload schema';

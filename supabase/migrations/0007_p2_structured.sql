-- ─────────────────────────────────────────────────────────────
-- 0007 — P2-mélység: business case haszon-kalkulátor + pilot
-- sikerdefiníció strukturált tárolása (Coding-csomag #9)
--
-- Supabase SQL-editorba EGYBEN bemásolható; IDEMPOTENS — második futás
-- nem hibázik és nem ront el adatot.
--
-- A repo-konvenció szerint (mint a #5a artefaktum-mezők és a #7b use_cases-
-- értékelők) JSONB oszlopok az `artifacts` táblán:
--   1) benefit_calc  — a Business case „Haszon-számítás" kalkulátora:
--      { state, felszabadult_kapacitas_ora_ho, oradij_ft,
--        realizalhato_szazalek (a „fék" — CSAK emberi), bevezetes_koltseg_ft,
--        uzemeltetes_koltseg_ft_ho, source_indices }
--      A levezetett értékek (bruttó/realizált/nettó/megtérülés) NEM tárolódnak
--      — mindig a bemenetekből + a fékből számolódnak (lib/artifacts/p2).
--   2) pilot_success — a Pilot-terv sikerdefiníciója:
--      { state, meresi_metrika, baseline_ertek, baseline_egyseg,
--        kuszob_ertek, kuszob_egyseg,
--        dontesi_szabaly: { scale_feltetel, pivot_feltetel, stop_feltetel },
--        source_indices }
-- Az üres {} default = „nincs strukturálva" állapot (a mező szabad szövegként
-- viselkedik, amíg nem strukturálják).
--
-- NINCS kapu-változás: a P2 kapu változatlanul a két kötelező deliverable
-- Approved. A strukturált mezők a fields-jsonb value-szinkronon át elégítik ki
-- a meglévő approve-blokkot.
-- ─────────────────────────────────────────────────────────────

alter table artifacts
  add column if not exists benefit_calc jsonb not null default '{}';

alter table artifacts
  add column if not exists pilot_success jsonb not null default '{}';

-- PostgREST séma-cache --------------------------------------------------
notify pgrst, 'reload schema';

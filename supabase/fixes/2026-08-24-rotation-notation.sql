-- One-off live-data repair — MANUAL RUN ONLY.
--
-- Change: rotation-notation-fix (context/changes/rotation-notation-fix/plan.md)
-- Authored: 2026-08-24
--
-- WHAT THIS FIXES
-- Seven seeded rows in public.algorithms stored a double turn with a trailing
-- prime (R2' / U2'). That token is not standard cube notation and is outside
-- the set dispatchMove() in src/components/app/PracticeSession.tsx can ever
-- produce, so a practice session on any of these algorithms stuck forever on
-- that move: no error, currentIndex never advanced, the session never reached
-- "submitting".
--
-- WHY A STANDALONE FILE
-- supabase/algos_seed.sql was applied to the production database once, by hand,
-- and no pipeline re-runs it — correcting that file alone never reaches a
-- running database. This file is the corrective statement plus its own audit
-- trail. It is deliberately:
--   * NOT in supabase/migrations/ — that directory is DDL-only by convention.
--   * NOT in supabase/config.toml [db.seed] sql_paths — it must not run on
--     `supabase db reset`, which re-seeds from algos_seed.sql instead.
-- Run it by hand, once, via the Supabase Studio SQL Editor.
--
-- SAFETY
-- UPDATE only — no DELETE, no INSERT. Row identity (id, list_id, position) is
-- untouched, so `public.algorithms` row count must be identical before and
-- after. Re-running is harmless: the statements are idempotent (they write the
-- already-correct value). Each WHERE is narrowed by list_id so a user-created
-- algorithm that happens to share a name is never touched.
--
-- moves values below are copied verbatim from the corrected
-- supabase/algos_seed.sql (' prime escaped as '' in SQL string literals).

BEGIN;

-- OLL list (00000000-0000-0000-0000-000000000003)

UPDATE public.algorithms
   SET moves = 'R U2 (R2 U'' R2 U'') (R2 U2 R)'
 WHERE name = 'OLL 22'
   AND list_id = '00000000-0000-0000-0000-000000000003';

UPDATE public.algorithms
   SET moves = 'M'' U'' M U2 M'' U'' M'
 WHERE name = 'OLL 28'
   AND list_id = '00000000-0000-0000-0000-000000000003';

UPDATE public.algorithms
   SET moves = 'R'' F R2 B'' R2 F'' R2 B R'''
 WHERE name = 'OLL 50'
   AND list_id = '00000000-0000-0000-0000-000000000003';

UPDATE public.algorithms
   SET moves = '(r U R'' U) (R U'' R'' U) R U2 r'''
 WHERE name = 'OLL 54'
   AND list_id = '00000000-0000-0000-0000-000000000003';

-- PLL list (00000000-0000-0000-0000-000000000004)

UPDATE public.algorithms
   SET moves = 'R2 U R'' U'' y (R U R'' U'') (R U R'' U'') (R U R'') y'' (R U'' R2)'
 WHERE name = 'E-perm'
   AND list_id = '00000000-0000-0000-0000-000000000004';

UPDATE public.algorithms
   SET moves = 'y R2 u (R'' U R'' U'') (R u'' R2) y'' (R'' U R)'
 WHERE name = 'Ga-perm'
   AND list_id = '00000000-0000-0000-0000-000000000004';

UPDATE public.algorithms
   SET moves = 'y R2 u'' R U'' (R U R'' u) R2 y (R U'' R'')'
 WHERE name = 'Gc-perm'
   AND list_id = '00000000-0000-0000-0000-000000000004';

COMMIT;

-- Read-back verification (run separately after COMMIT):
--
--   SELECT name, moves
--     FROM public.algorithms
--    WHERE name IN ('OLL 22', 'OLL 28', 'OLL 50', 'OLL 54',
--                   'E-perm', 'Ga-perm', 'Gc-perm')
--    ORDER BY list_id, position;
--
-- Expect 7 rows, none containing the substring  2'
--
--   SELECT count(*) FROM public.algorithms;
--
-- Expect the same count as before the run.

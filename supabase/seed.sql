-- MemQ seed: pre-built PLL algorithm set
-- Fixed UUID on system list makes this idempotent on supabase db reset.
-- WARNING: algorithm rows have no unique constraint — do not run this file manually
-- against a live DB more than once or rows will duplicate. Safe for db reset only.

INSERT INTO public.algorithm_lists (id, user_id, is_system, name)
VALUES ('00000000-0000-0000-0000-000000000001', NULL, true, 'PLL (Permutation of Last Layer)')
ON CONFLICT (id) DO NOTHING;

-- Standard two-look PLL sequences (Singmaster notation; ' prime escaped as '' in SQL)
-- Verify sequences against a trusted source before production use.
INSERT INTO public.algorithms (list_id, name, moves, position) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Ua-perm', 'M2 U M U2 M'' U M2',                                        1),
  ('00000000-0000-0000-0000-000000000001', 'Ub-perm', 'M2 U'' M U2 M'' U'' M2',                                    2),
  ('00000000-0000-0000-0000-000000000001', 'H-perm',  'M2 U M2 U2 M2 U M2',                                        3),
  ('00000000-0000-0000-0000-000000000001', 'Z-perm',  'M2 U M2 U M'' U2 M2 U2 M''',                                4),
  ('00000000-0000-0000-0000-000000000001', 'T-perm',  'R U R'' U'' R'' F R2 U'' R'' U'' R U R'' F''',              5),
  ('00000000-0000-0000-0000-000000000001', 'Y-perm',  'F R U'' R'' U'' R U R'' F'' R U R'' U'' R'' F R F''',       6),
  ('00000000-0000-0000-0000-000000000001', 'Ja-perm', 'R'' U L'' U2 R U'' R'' U2 R L',                             7),
  ('00000000-0000-0000-0000-000000000001', 'Jb-perm', 'R U R'' F'' R U R'' U'' R'' F R2 U'' R''',                 8);

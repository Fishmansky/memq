# Domain Schema + RLS (F-01) — Plan Brief

> Full plan: `context/changes/domain-schema-rls/plan.md`

## What & Why

Create the four domain tables (`algorithm_lists`, `algorithms`, `practice_sessions`, `algorithm_mastery`) in Supabase with row-level security and wire TypeScript types. This is the foundation every downstream slice (S-01, S-02, S-04) depends on — no domain queries can ship until this lands.

## Starting Point

Supabase Auth is fully working against a remote project (`ephwcvmnnjmjdzjepnab.supabase.co`). Zero migration files exist. The Supabase client at `src/lib/supabase.ts` is auth-only and untyped today.

## Desired End State

Four RLS-protected tables live in the `public` schema. A system PLL list with 8 algorithms is seeded. `src/db/database.types.ts` is generated and `src/lib/supabase.ts` passes the `Database` generic — giving downstream slices full type safety on every `.from()` call.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Pre-built content isolation | `is_system` flag + nullable `user_id` on `algorithm_lists` | Single table, one SELECT policy covers both pre-built and user-owned rows | Plan |
| Streak tracking location | Separate `algorithm_mastery` table | Sessions are append-only history; mastery is mutable state — keeping them apart is cleaner | Plan |
| TypeScript types | Generate in F-01 (`src/db/database.types.ts`) | Downstream slices need typed queries from day one | Plan |
| `practice_sessions` columns | `is_clean` + `error_count` per session | Covers FR-013 streak and FR-014 total count; richer than minimum with negligible extra work | Plan |
| `algorithms.moves` type | `TEXT` (space-separated tokens) | Matches PRD literal-string duplicate detection; simplest to display and index | Plan |
| Seed content | 1 system PLL list + 8 standard PLL algorithms | Immediately unblocks S-01 (browse pre-built sets) | Plan |
| Migration tooling | `supabase migrations/` + `npx supabase db push` | Standard CLI workflow; matches existing `config.toml` setup | Plan |

## Scope

**In scope:**
- `algorithm_lists`, `algorithms`, `practice_sessions`, `algorithm_mastery` tables
- Indexes: `algorithms.moves` (btree, for FR-015 duplicate detection), `practice_sessions(user_id, algorithm_id)`
- 14 RLS policies across 4 tables
- `supabase/seed.sql` with 1 system list + 8 PLL algorithms
- `src/db/database.types.ts` (generated)
- `src/lib/supabase.ts` typed with `Database` generic

**Out of scope:**
- Per-algorithm practice history (PRD §Non-Goals)
- Local Docker stack setup
- Admin panel or service-role tooling
- Any UI or API route (those belong to S-01, S-02, S-04)

## Architecture / Approach

Single migration file creates all tables and policies in one transaction. Pre-built content uses `is_system=true` + `user_id=NULL` on `algorithm_lists`; one SELECT policy reads both system and user rows. `algorithm_mastery` has a `UNIQUE(user_id, algorithm_id)` constraint enabling UPSERT semantics in S-02. Types are generated against the live remote project after migration applies.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Schema SQL artifacts | Migration SQL + seed SQL files written to disk | Incorrect prime notation escaping in seed (`'` → `''`) silently stores wrong moves |
| 2. Apply + TS types | Migration applied, types generated, client typed | `npx supabase db push` requires linked CLI; remote project credentials needed |
| 3. RLS smoke test | Two-account isolation verified | RLS policy gap here cascades to every slice — must not be skipped |

**Prerequisites:** Supabase CLI available (`npx supabase --version`); remote project credentials in `.env`
**Estimated effort:** ~1 session across 3 phases

## Open Risks & Assumptions

- Seed move sequences are widely-cited standard PLL algorithms but should be verified against a trusted source before production seeding
- `npm run build` does not validate SQL — migration correctness is only confirmed on apply
- If schema changes are needed after F-01 lands, a new migration file must be created (existing applied file is immutable)

## Success Criteria (Summary)

- `supabase db push` applies cleanly with no errors
- Supabase Studio shows all 4 tables with RLS enabled and seed data present
- Two-account RLS smoke test passes: system list visible to both, user lists isolated

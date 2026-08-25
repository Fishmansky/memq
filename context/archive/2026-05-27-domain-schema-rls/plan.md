# Domain Schema + RLS (F-01) Implementation Plan

## Overview

Create all domain tables in Supabase, enforce per-user row-level security, seed one pre-built PLL algorithm set, and wire TypeScript types so downstream slices query with full type safety. This is the foundation every other slice depends on — no domain code ships before this lands.

## Current State Analysis

- Supabase connected to remote project `ephwcvmnnjmjdzjepnab.supabase.co`
- Auth fully working; cookie-based sessions; `src/lib/supabase.ts` uses `@supabase/ssr`
- Zero migration files — `supabase/migrations/` does not exist
- `supabase/config.toml` has seed enabled pointing to `./seed.sql` (file absent)
- No `database.types.ts` — client is untyped today
- `src/db/` directory does not exist

## Desired End State

Four tables live in the `public` schema: `algorithm_lists`, `algorithms`, `practice_sessions`, `algorithm_mastery`. RLS is enabled on all four. Authenticated users can read system (pre-built) algorithm lists and algorithms; they can only read/write their own user-owned data. Seed inserts one system PLL list with eight standard PLL algorithms. `src/db/database.types.ts` is generated and `src/lib/supabase.ts` passes the `Database` generic to `createServerClient`.

### Verification:
- `supabase/migrations/20260527000000_domain_schema_rls.sql` exists and applies cleanly
- `supabase/seed.sql` exists and inserts system list + 8 algorithms
- `npx supabase gen types typescript` produces `src/db/database.types.ts` with all four tables present
- `npm run build` passes with typed client
- Manual: two distinct accounts confirm data isolation + shared pre-built access

### Key Discoveries:

- `src/lib/supabase.ts:4` — `createServerClient` call takes no type parameter today; adding `<Database>` here gives typed `.from()` calls everywhere
- `supabase/config.toml` seed config (`sql_paths = ["./seed.sql"]`) is already wired; `supabase db reset` will auto-apply seed.sql on local stack
- Remote project requires `npx supabase link` before `db push`; local stack requires Docker

## What We're NOT Doing

- No local Docker stack setup — plan targets remote project; local stack instructions are alternative
- No per-algorithm practice history (nice-to-have per PRD §Non-Goals)
- No admin panel or service-role seeding helpers
- No schema versioning beyond a single migration file (only 4 tables, no incremental complexity yet)
- No RLS on `auth.users` (managed by Supabase Auth, not our concern)

## Implementation Approach

Single migration file creates all tables + indexes + RLS in one transaction. Seed file inserts system list + algorithms with a fixed UUID so the seed is idempotent on re-runs. TypeScript types are generated after migration applies against the live project, then `supabase.ts` is updated to be generic.

## Critical Implementation Details

- **SQL prime notation**: Move sequences contain `'` (prime, e.g. `R'`). In SQL string literals this must be escaped as `''`. Plan carries the escaped versions in the seed SQL.
- **RLS on `algorithms` uses a subquery join**: The policy checks `algorithm_lists` to determine if the calling user owns or can see the list. This means RLS on `algorithms` is only safe if RLS on `algorithm_lists` is also enabled — both must be enabled together.
- **`algorithm_mastery` UNIQUE constraint**: `UNIQUE (user_id, algorithm_id)` is the enabler for UPSERT on session completion in S-02. Do not remove it.

---

## Phase 1: Schema SQL artifacts

### Overview

Write the migration SQL file and seed SQL file. No database connection required for this phase — these are file writes only. The migration file timestamp `20260527000000` encodes today's date.

### Changes Required:

#### 1. Migration file

**File**: `supabase/migrations/20260527000000_domain_schema_rls.sql`

**Intent**: Create all four domain tables with correct column types, FK constraints, indexes, and RLS policies in one idempotent DDL block.

**Contract**:

```sql
-- algorithm_lists
CREATE TABLE public.algorithm_lists (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
    is_system   boolean     NOT NULL DEFAULT false,
    name        text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT algorithm_lists_ownership_check
        CHECK (
            (is_system = true  AND user_id IS NULL) OR
            (is_system = false AND user_id IS NOT NULL)
        )
);

-- algorithms
CREATE TABLE public.algorithms (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id     uuid        NOT NULL REFERENCES public.algorithm_lists(id) ON DELETE CASCADE,
    name        text        NOT NULL,
    moves       text        NOT NULL,
    position    integer     NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX algorithms_moves_idx ON public.algorithms (moves);

-- practice_sessions (append-only; no UPDATE policy)
CREATE TABLE public.practice_sessions (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    algorithm_id  uuid        NOT NULL REFERENCES public.algorithms(id) ON DELETE CASCADE,
    is_clean      boolean     NOT NULL,
    error_count   integer     NOT NULL DEFAULT 0,
    completed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX practice_sessions_user_algorithm_idx
    ON public.practice_sessions (user_id, algorithm_id);

-- algorithm_mastery (upsertable via unique constraint)
CREATE TABLE public.algorithm_mastery (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    algorithm_id      uuid        NOT NULL REFERENCES public.algorithms(id) ON DELETE CASCADE,
    consecutive_clean integer     NOT NULL DEFAULT 0,
    mastery_reached   boolean     NOT NULL DEFAULT false,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT algorithm_mastery_user_algorithm_unique UNIQUE (user_id, algorithm_id)
);

-- Enable RLS
ALTER TABLE public.algorithm_lists    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.algorithms         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.algorithm_mastery  ENABLE ROW LEVEL SECURITY;

-- algorithm_lists policies
CREATE POLICY "al_select" ON public.algorithm_lists
    FOR SELECT TO authenticated
    USING (is_system = true OR user_id = auth.uid());

CREATE POLICY "al_insert" ON public.algorithm_lists
    FOR INSERT TO authenticated
    WITH CHECK (is_system = false AND user_id = auth.uid());

CREATE POLICY "al_update" ON public.algorithm_lists
    FOR UPDATE TO authenticated
    USING  (user_id = auth.uid() AND is_system = false)
    WITH CHECK (user_id = auth.uid() AND is_system = false);

CREATE POLICY "al_delete" ON public.algorithm_lists
    FOR DELETE TO authenticated
    USING (user_id = auth.uid() AND is_system = false);

-- algorithms policies (access inherited from owning list)
CREATE POLICY "alg_select" ON public.algorithms
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.algorithm_lists l
            WHERE l.id = algorithms.list_id
              AND (l.is_system = true OR l.user_id = auth.uid())
        )
    );

CREATE POLICY "alg_insert" ON public.algorithms
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.algorithm_lists l
            WHERE l.id = algorithms.list_id
              AND l.user_id = auth.uid()
              AND l.is_system = false
        )
    );

CREATE POLICY "alg_update" ON public.algorithms
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.algorithm_lists l
            WHERE l.id = algorithms.list_id
              AND l.user_id = auth.uid()
              AND l.is_system = false
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.algorithm_lists l
            WHERE l.id = algorithms.list_id
              AND l.user_id = auth.uid()
              AND l.is_system = false
        )
    );

CREATE POLICY "alg_delete" ON public.algorithms
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.algorithm_lists l
            WHERE l.id = algorithms.list_id
              AND l.user_id = auth.uid()
              AND l.is_system = false
        )
    );

-- practice_sessions policies (user owns their own sessions; append-only)
CREATE POLICY "ps_select" ON public.practice_sessions
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "ps_insert" ON public.practice_sessions
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- algorithm_mastery policies
CREATE POLICY "am_select" ON public.algorithm_mastery
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "am_insert" ON public.algorithm_mastery
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "am_update" ON public.algorithm_mastery
    FOR UPDATE TO authenticated
    USING  (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
```

#### 2. Seed file

**File**: `supabase/seed.sql`

**Intent**: Insert one system PLL list with a fixed UUID and eight standard two-look PLL algorithm sequences. Fixed UUID makes the seed idempotent on repeated `db reset` runs. Move sequences use standard Singmaster notation; `'` (prime) is escaped as `''` in SQL string literals.

**Contract**:

```sql
INSERT INTO public.algorithm_lists (id, user_id, is_system, name)
VALUES ('00000000-0000-0000-0000-000000000001', NULL, true, 'PLL (Permutation of Last Layer)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.algorithms (list_id, name, moves, position) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Ua-perm', 'M2 U M U2 M'' U M2',                                              1),
  ('00000000-0000-0000-0000-000000000001', 'Ub-perm', 'M2 U'' M U2 M'' U'' M2',                                          2),
  ('00000000-0000-0000-0000-000000000001', 'H-perm',  'M2 U M2 U2 M2 U M2',                                              3),
  ('00000000-0000-0000-0000-000000000001', 'Z-perm',  'M2 U M2 U M'' U2 M2 U2 M''',                                      4),
  ('00000000-0000-0000-0000-000000000001', 'T-perm',  'R U R'' U'' R'' F R2 U'' R'' U'' R U R'' F''',                    5),
  ('00000000-0000-0000-0000-000000000001', 'Y-perm',  'F R U'' R'' U'' R U R'' F'' R U R'' U'' R'' F R F''',             6),
  ('00000000-0000-0000-0000-000000000001', 'Ja-perm', 'R'' U L'' U2 R U'' R'' U2 R L',                                   7),
  ('00000000-0000-0000-0000-000000000001', 'Jb-perm', 'R U R'' F'' R U R'' U'' R'' F R2 U'' R''',                       8);
```

> **Note**: Verify move sequences against a trusted source (e.g., speedsolving.com) before considering the seed production-ready. These are widely cited two-look PLL sequences; confirm prime notation matches what S-02 will validate against.

### Success Criteria:

#### Automated Verification:

- Migration file exists: `ls supabase/migrations/20260527000000_domain_schema_rls.sql`
- Seed file exists: `ls supabase/seed.sql`
- `npm run lint` passes (SQL files are not linted; this confirms no TS side effects)
- `npm run build` passes

#### Manual Verification:

- Review migration SQL: all four tables present, CHECK constraint on `algorithm_lists`, `algorithms_moves_idx` index, 14 RLS policies total
- Review seed SQL: system list has fixed UUID `00000000-0000-0000-0000-000000000001`, 8 algorithm rows

**Implementation Note**: After all automated checks pass, pause for manual SQL review before proceeding to Phase 2 (application to live DB).

---

## Phase 2: Apply migration + generate TypeScript types

### Overview

Apply the migration to the database (manual gate — requires CLI or Studio access), then generate `src/db/database.types.ts` and update `src/lib/supabase.ts` to be typed.

### Changes Required:

#### 1. Apply migration (manual step — not automated)

**Intent**: Push the migration to the live database. Two paths depending on setup:

**Remote project (current setup)**:
```bash
npx supabase link --project-ref ephwcvmnnjmjdzjepnab  # one-time if not already linked
npx supabase db push
```

**Local Docker stack (alternative)**:
```bash
npx supabase start
npx supabase db reset   # applies all migrations + seed.sql
```

#### 2. Generate TypeScript types

**File**: `src/db/database.types.ts` (generated — do not hand-edit)

**Intent**: Run Supabase CLI type generation to produce typed table row interfaces for all four domain tables. The `src/db/` directory is created as part of this step.

**Contract**:
```bash
# Remote:
npx supabase gen types typescript --project-id ephwcvmnnjmjdzjepnab --schema public > src/db/database.types.ts

# Local (if using Docker stack):
npx supabase gen types typescript --local --schema public > src/db/database.types.ts
```

The generated file exports a `Database` type with a `public.Tables` map covering `algorithm_lists`, `algorithms`, `practice_sessions`, `algorithm_mastery`.

#### 3. Update Supabase client to pass Database generic

**File**: `src/lib/supabase.ts`

**Intent**: Make the Supabase client typed so all `.from('algorithms')` calls in downstream slices get inferred row types and catch column-name typos at compile time.

**Contract**: Add `import type { Database } from "@/db/database.types"` and change `createServerClient(...)` to `createServerClient<Database>(...)`. No other changes to the function signature or cookie logic.

### Success Criteria:

#### Automated Verification:

- `src/db/database.types.ts` exists and contains `algorithm_lists`, `algorithms`, `practice_sessions`, `algorithm_mastery` type definitions
- `npm run build` passes with no type errors
- `npm run lint` passes

#### Manual Verification:

- Supabase Studio (remote: dashboard → Table Editor, local: `http://localhost:54323`): all four tables visible with correct columns
- RLS enabled on all four tables (Studio → Table Editor → each table → RLS is "enabled")
- Seed data present: system list row in `algorithm_lists`, 8 rows in `algorithms`

**Implementation Note**: Pause here. Verify in Studio before proceeding to RLS smoke test.

---

## Phase 3: RLS smoke test

### Overview

Manually verify data isolation using two distinct authenticated accounts. Pre-built (system) data must be visible to both; user-owned data must be invisible to other users.

### Changes Required:

No code changes in this phase. This phase is verification-only.

### Success Criteria:

#### Automated Verification:

- None (RLS verification requires real auth sessions against the live DB)

#### Manual Verification:

- **System data visible to all**: Sign in as user A → navigate to any page that queries `algorithm_lists` (or use Supabase Studio SQL editor: `SELECT * FROM algorithm_lists WHERE is_system = true`) → 1 row returned (the PLL list). Repeat with user B → same result.
- **User data isolated**: Sign in as user A → insert a custom algorithm list via Studio or API. Sign in as user B → run `SELECT * FROM algorithm_lists WHERE is_system = false` → 0 rows returned.
- **`algorithms` inherits list isolation**: Insert an algorithm under user A's custom list. Query as user B → 0 rows returned for that algorithm.
- **No cross-user session leakage**: Insert a `practice_sessions` row as user A. Query as user B → 0 rows returned.

**Implementation Note**: RLS smoke test with two accounts is the final gate before F-01 is marked `done` and S-01 / S-04 can be picked up.

---

## Testing Strategy

### Manual Testing Steps:

1. Open Supabase Studio → SQL Editor
2. Run `SELECT * FROM algorithm_lists` as anonymous → expect RLS error (unauthenticated)
3. Run `SELECT * FROM algorithm_lists WHERE is_system = true` with an auth token → 1 row
4. Create a custom list as user A; confirm user B sees 0 rows for that list
5. Confirm `algorithms` count for the system list = 8

## Migration Notes

- This is a greenfield migration — no existing data to preserve
- If the migration needs to be changed after apply, create a new migration file (do not edit the applied file)
- Seed is idempotent via `ON CONFLICT (id) DO NOTHING` on the system list row; the 8 algorithm rows do not have a unique constraint so seeding twice will duplicate them — avoid running seed.sql manually more than once against a non-reset DB

## References

- PRD: `context/foundation/prd.md` — FR-003, FR-004, FR-005, FR-008, FR-013, FR-014, FR-015; NFR (data isolation)
- Roadmap: `context/foundation/roadmap.md` — F-01
- Supabase client: `src/lib/supabase.ts:4`
- Env declarations: `src/env.d.ts`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Schema SQL artifacts

#### Automated

- [x] 1.1 Migration file exists: `ls supabase/migrations/20260527000000_domain_schema_rls.sql` — 90e5fc9
- [x] 1.2 Seed file exists: `ls supabase/seed.sql` — 90e5fc9
- [x] 1.3 `npm run lint` passes — 90e5fc9
- [x] 1.4 `npm run build` passes — 90e5fc9

#### Manual

- [x] 1.5 Review migration SQL — four tables, CHECK constraint, moves index, 14 RLS policies — 90e5fc9
- [x] 1.6 Review seed SQL — fixed UUID on system list, 8 algorithm rows, correct SQL escaping — 90e5fc9

### Phase 2: Apply migration + generate TypeScript types

#### Automated

- [x] 2.1 `src/db/database.types.ts` exists with all four table types — 3b5f7c7
- [x] 2.2 `npm run build` passes with typed client — 3b5f7c7
- [x] 2.3 `npm run lint` passes — 3b5f7c7

#### Manual

- [x] 2.4 Supabase Studio shows all four tables with correct columns — 3b5f7c7
- [x] 2.5 RLS enabled on all four tables in Studio — 3b5f7c7
- [x] 2.6 Seed data present: 1 system list, 8 algorithms — 3b5f7c7

### Phase 3: RLS smoke test

#### Manual

- [x] 3.1 System list visible to both user A and user B — e347ccb
- [x] 3.2 User A custom list invisible to user B — e347ccb
- [x] 3.3 User A algorithms invisible to user B — e347ccb
- [x] 3.4 User A practice session invisible to user B — e347ccb

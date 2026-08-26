# Custom List Creation + Algorithm Entry + Duplicate Detection — Implementation Plan

## Overview

Build the write path for user-owned algorithm lists (roadmap S-04; PRD FR-004, FR-005, FR-015) on top of the schema and RLS policies F-01 already shipped but never exercised. A learner can create a private list, add algorithms to it by name and move sequence, and — when the sequence matches an algorithm they can already see — is offered the existing entry to add instead of creating a duplicate.

Three cross-cutting decisions shape the work:

- **Duplicate-on-add copies the row** (option D2): a new `algorithms` row in the learner's list plus a nullable `source_algorithm_id` recording where it came from. The one-row-one-list invariant (D4) stays intact, no RLS policy changes, no read path breaks.
- **"Exactly matches" means normalized**, not byte-identical: parentheses treated as separators, whitespace collapsed, typographic apostrophes folded to ASCII. Case stays significant (`r` ≠ `R` — wide moves).
- **Notation gets a real validator**, extracted from the test-only grammar helper into `src/lib/`, imported by both the form and the endpoint. This is the slice that hands free-form notation entry to users, and an out-of-grammar token silently freezes the practice loop.

## Current State Analysis

**The backend exists; the write path does not.** `algorithm_lists` and `algorithms` were created in `supabase/migrations/20260527000000_domain_schema_rls.sql` with a complete policy set that already models "a user creates a private list and owns its algorithms" — `al_insert` (`:66-68`) and `alg_insert` (`:89-98`) both gate on `is_system = false AND user_id = auth.uid()`. Not one line of application code inserts into either table. `src/lib/practice/completePractice.ts` is the only file in `src/` that writes to the database at all.

What is missing, precisely:

- **No create-list path, no create-algorithm path, no API route for either.** `src/pages/api/practice/complete.ts` is the only JSON endpoint in the app.
- **No runtime validation of `moves` at any layer** — no CHECK constraint on `moves text NOT NULL` (`...rls.sql:24`), no client validator, no server validator. The only grammar guard is `src/test/tokenGrammar.ts`, which is test-only and imports `KEY_TO_MOVE` *from a React component*. An out-of-grammar token means `action.move === expected` (`PracticeSession.tsx:149`) never matches, the slot never advances, and no error is shown. This exact failure reached production and required a hand-run repair (`supabase/fixes/2026-08-24-rotation-notation.sql`).
- **No normalization anywhere.** `moves` is plain `TEXT` compared byte-for-byte. A trailing space or a U+2019 apostrophe is a silent false negative for duplicate detection. F-01 did ship `algorithms_moves_idx ON public.algorithms (moves)` (`...rls.sql:28-29`) with the comment "btree index on moves enables O(1) exact-match duplicate detection (FR-015)" — an index built for the byte-comparison approach this plan replaces. Nothing in `src/` ever queried it.
- **One line hides custom lists.** `src/pages/dashboard.astro:18` hardcodes `.eq("is_system", true)`.
- **`/sets/[id]` and `/sets/[id]/[algoId]` need almost nothing** — neither filters on `is_system`, and RLS scopes both correctly for a user-owned list. Browse-and-practice on custom algorithms arrives essentially free. `sets/[id].astro` does need to *select* `is_system`/`user_id` so it can decide whether to render the add-algorithm form.
- **The two-account integration harness does not exist.** `src/test/integration/db.ts` provides `serviceClient()` and a single `createTestUser()`; `cleanupUserRows` (`:59-68`) deletes only `practice_sessions` and `algorithm_mastery`. Test-plan Phase 3 (authorization / isolation) is `not started`.
- **CI never runs tests.** `.github/workflows/ci.yml` runs `npm ci → astro sync → typecheck → lint → build → deploy`. No `npm test`. Flagged and skipped in two prior impl-reviews.

There is **no existing user data** — FR-004/FR-005 have never been implemented, so every schema choice here is greenfield rather than a retrofit.

## Desired End State

A signed-in learner can:

1. Create a named private list from the dashboard, and see it there alongside the pre-built sets, visually distinguished as theirs.
2. Open their list and add an algorithm by name + move sequence. Invalid notation is rejected at the form with a specific message naming the offending token — before it can reach the database and freeze a practice session.
3. On submitting a sequence that matches an algorithm they can already see (pre-built, or in any of their own lists), get an inline panel naming the match, with the choice to add the existing algorithm to this list or create a separate entry anyway.
4. Practice any algorithm in their custom list through the existing `/sets/[id]/[algoId]` flow, with no changes to the practice loop.

Verified by: the automated criteria in each phase below, plus an integration test proving user A cannot read or write user B's list or algorithms, and that B's private algorithm never appears as a duplicate match for A.

### Key Discoveries:

- `algorithms.list_id uuid NOT NULL` (`...rls.sql:22`) — one row is one list membership by construction; this is what makes "add the *existing* algorithm to your list" unrepresentable without either a copy or a schema change (`context/changes/custom-list-algorithm-entry/research.md:44-71`).
- `alg_select` (`...rls.sql:79-87`) resolves to exactly "pre-built OR in any of the caller's lists" — FR-015's visibility scope verbatim, with no over- or under-inclusion. Duplicate detection needs no hand-rolled ownership filter.
- `algorithm_mastery` is keyed `UNIQUE (user_id, algorithm_id)` (`...rls.sql:51`), so a copied row starts a fresh streak. `source_algorithm_id` is what makes a later carryover fix possible without a second migration.
- `algorithm_lists_ownership_check` (`...rls.sql:12-16`) requires `is_system = false AND user_id IS NOT NULL` together — a create-list insert must set both.
- `algorithms.Insert` requires `position: number`, non-optional (`src/db/database.types.ts:91`) — the caller computes it.
- Seeded rows store parentheses as visual grouping (`(R U2 R' U') (R U R')`, `supabase/algos_seed.sql`) and the parser strips them (`PracticeSession.tsx:216-218`). Normalized comparison must therefore strip them too — which is why comparison cannot run against the raw `moves` column and stay index-backed.
- `src/test/tokenGrammar.ts:1` imports `KEY_TO_MOVE` from `src/components/app/PracticeSession.tsx`. Any server-side importer of the grammar would drag a React component into the endpoint bundle.
- API routes are not covered by `src/middleware.ts` (`PROTECTED_ROUTES = ["/dashboard", "/sets"]`, prefix-matched) — every new `/api/*` route gates itself on `context.locals.user`.
- The endpoint precedent is a thin route delegating to a lib module: `complete.ts` does auth + `typeof` validation + client construction, then hands off to `completePractice()` and maps `{status, body}` onto the `Response`.
- `playwright.config.ts:26-29` serves the **built** worker (`npm run build && npm run preview`) — app changes need a rebuild before E2E sees them. Specs hit the real remote Supabase project and have no teardown.

## What We're NOT Doing

- **No edit, delete, or rename** of custom lists or algorithms. Deleting an algorithm cascades into `practice_sessions` and `algorithm_mastery` (`...rls.sql:35,47`) — silent loss of practice history that deserves a confirmation surface this repo has no component for. Its own slice.
- **No mastery carryover.** A copied algorithm starts a fresh streak. `source_algorithm_id` is recorded so a follow-up can rewrite mastery lookups to follow provenance; that rewrite is not in this slice.
- **No `list_items` junction table** (option B). It would rewrite four `alg_*` policies, break both read paths, and open a cross-user cascade where deleting one shared row wipes every user's practice history.
- **No ACL / ports layer, no `MoveSequence` value object** (domain docs 02/03). Only doc 02's behavior-neutral P0 grammar extraction is in scope. Astro pages keep their inline PostgREST chains.
- **No dialog or toast component.** The FR-015 prompt is an inline panel.
- **No shared error-banner extraction.** The banner is copy-pasted three times; this slice adds no fourth copy to a *new* page, and leaves the existing three alone rather than widening the diff.
- **No `UNIQUE(list_id, moves)` constraint.** Check-then-insert stays a TOCTOU race, same accepted shape as `completePractice.ts:31-44`. Consequence: two truly concurrent submissions of the same sequence into one list can both land. At `data_volume: small` with single-user-per-list writes, the window is not worth a migration and 23505 mapping this slice has no other use for.
- **No changes to the practice loop.** `PracticeSession.tsx` changes by exactly one import line (Phase 1); its behavior is untouched.

## Implementation Approach

Six phases, foundation-up, each independently verifiable:

Extract and harden the notation grammar first (Phase 1), so both the form and the endpoint have one validator to import and the normalizer exists before anything depends on it. Then the migration (Phase 2) adds the normalized generated column that makes index-backed matching possible and the provenance FK that D2 needs. Server logic and routes follow (Phase 3), mirroring the existing route-delegates-to-lib-module split. UI comes next (Phase 4), at which point the feature is usable end to end. The last two phases are proof: the two-account isolation tests this slice's user-owned rows demand (Phase 5), then E2E coverage of the create→duplicate→add flow and wiring `npm test` into CI so none of it is inert (Phase 6).

Phases 1–4 are strictly ordered. Phases 5 and 6 both depend on 1–4 but not on each other.

## Critical Implementation Details

**The JS normalizer and the SQL generated column must produce byte-identical output.** Comparison happens in SQL (`moves_normalized = $1`) against a value normalized in JS, so any divergence is a silent false negative — the exact failure mode FR-015 exists to prevent. The two definitions live in different languages and cannot be shared, so Phase 2 pins them with a parity test that runs the JS normalizer over every seeded row and asserts equality against the column Postgres computed. Treat that test as the contract; if the normalization rule ever changes, both sides and the test change together.

**Move `KEY_TO_MOVE` and `parseMoves` out of the React component, don't re-export them.** `src/test/tokenGrammar.ts` currently imports `KEY_TO_MOVE` from `PracticeSession.tsx`, and `src/test/seedTokens.test.ts:4` imports `parseMoves` from it. If the server-side validator imports the grammar and the grammar still imports the component, an API route pulls a React island into its bundle on the Cloudflare Workers runtime. Both declarations move to `src/lib/notation/moveGrammar.ts`; `PracticeSession.tsx` imports them back.

**The validator must gate the string the practice loop will actually tokenize.** `moves` is stored raw and display-verbatim (parentheses and original spacing preserved, matching the seeded rows); `moves_normalized` is the derived comparison column. But the practice loop tokenizes the *raw* column with `parseMoves` — `moves.replace(/[()]/g, "").split(" ").filter(Boolean)` (`PracticeSession.tsx:216-218`) — which splits on a single space only and does no U+2019 folding. A validator that token-checks only the *normalized* form therefore accepts `R\tU R'` and `R’ U`, which then yield tokens outside `PRODUCIBLE_TOKENS` at practice time: `action.move === expected` (`PracticeSession.tsx:149`) never matches, the slot never advances, no error is shown. That is the exact `supabase/fixes/2026-08-24-rotation-notation.sql` failure class, reached through the input path this slice adds. So `validateMoves` checks **both** tokenizations — the normalized split and `parseMoves(raw)`.

**Ordering within Phase 2:** the generated column must be added before `src/db/database.types.ts` is regenerated, and the types must be regenerated before Phase 3 compiles — `TablesInsert<"algorithms">` will not know about `source_algorithm_id` otherwise.

## Phase 1: Notation grammar module

### Overview

Move the move-token grammar out of test-only space into `src/lib/`, add the normalizer and validator that Phases 2–4 depend on, and leave the practice loop behaviorally unchanged.

### Changes Required:

#### 1. Grammar module

**File**: `src/lib/notation/moveGrammar.ts` (new)

**Intent**: Become the single source of truth for the move vocabulary, for how the app tokenizes a sequence, and for what a valid move sequence is. Absorbs `KEY_TO_MOVE`, `parseMoves`, and everything currently in `src/test/tokenGrammar.ts`, and adds the two functions this feature needs. Must not import from `src/components/`.

**Contract**: Exports, in addition to the existing `WIDE_SENTINEL`, `DOUBLE_SENTINEL`, `KEYBOARD_BASE_TOKENS`, `KEYBOARD_WITH_WIDE_TOKENS`, `PRODUCIBLE_TOKENS` (semantics unchanged):

- `KEY_TO_MOVE: Record<string, string>` — moved verbatim from `PracticeSession.tsx:8-35`.
- `parseMoves(moves: string): string[]` — moved verbatim from `PracticeSession.tsx:216-218`. Behaviour unchanged: this is the runtime tokenizer the practice loop already uses, and relocating it is what lets the validator check against it.
- `normalizeMoves(raw: string): string` — replace `(` and `)` with a **space** (not with nothing), fold `’` (U+2019) to ASCII `'`, collapse all whitespace runs to a single space, trim. Case-preserving. Must mirror the SQL expression in Phase 2 exactly:

  ```ts
  raw.replace(/[()]/g, " ").replace(/\u2019/g, "'").replace(/\s+/g, " ").trim()
  ```

  Parens map to a space rather than to nothing because deleting them fuses tokens across an unspaced group boundary: `(R U)(R' U)` would become `R UR' U`, and `UR'` is not a producible token. JS and SQL would agree on that corruption, so the Phase 2 parity test would stay green while the learner got a bewildering "unknown token `UR'`". Seeded rows always space their groups (`(R U2 R' U') (R U R')`), so this changes nothing for existing data — the extra space collapses away.
- `validateMoves(raw: string): { ok: true; normalized: string } | { ok: false; error: string }` — normalizes, rejects empty, then checks **two** token streams against `PRODUCIBLE_TOKENS`:
  1. the normalized sequence split on spaces — what duplicate matching compares, and
  2. `parseMoves(raw)` — what the practice loop will actually dispatch against the stored raw `moves`.

  Both must be fully producible; a token rejected by either check fails the whole call. Check 2 is the one that rejects `R\tU R'` and `R’ U`, which check 1 alone would accept and which would then freeze a practice session (see Critical Implementation Details). The error message names the first offending token (that specificity is the point: it is what turns a silent frozen session into a fixable form error).

#### 2. Practice component

**File**: `src/components/app/PracticeSession.tsx`

**Intent**: Stop declaring the move vocabulary and the tokenizer; import both from the new module.

**Contract**: `KEY_TO_MOVE` and `parseMoves` are imported from `@/lib/notation/moveGrammar` and are no longer declared or exported here — Phase 1 item 3 repoints the only two external importers in the same commit, so no re-export is needed. No behavioral change: the grids, `dispatchMove`, and the `parseMoves(moves)` call at `:274` are untouched.

#### 3. Test-only grammar helper

**File**: `src/test/tokenGrammar.ts` (deleted), `src/test/seedTokens.test.ts`, `src/components/app/PracticeSession.parity.test.ts`

**Intent**: Remove the now-duplicate helper and repoint its two consumers at the lib module, so there is one grammar rather than a second copy.

**Contract**: Both test files take every grammar symbol from `@/lib/notation/moveGrammar` — the sentinels and `PRODUCIBLE_TOKENS` (previously `@/test/tokenGrammar`), plus `KEY_TO_MOVE` and `parseMoves` (previously `@/components/app/PracticeSession`). `PracticeSession.parity.test.ts` still imports `CENTRAL_GRID` / `SIDE_GRID` / `ROTATION_GRID` from the component, since those stay; `seedTokens.test.ts` ends up importing nothing from `src/components/` at all. Their assertions are unchanged.

#### 4. Unit tests

**File**: `src/lib/notation/moveGrammar.test.ts` (new)

**Intent**: Table-driven coverage of the normalizer and validator, with the oracle being the intended rule rather than the implementation.

**Contract**: Normalizer cases at minimum — leading/trailing whitespace, double space, tab and newline separators, parentheses (matching a real seeded sequence such as `(R U2 R' U') (R U R')`), **unspaced adjacent groups** (`(R U)(R' U)` → `R U R' U`, the case that would fuse into `UR'` if parens mapped to nothing), U+2019 apostrophe, and case preservation (`r` stays `r`). Validator cases — every token in `PRODUCIBLE_TOKENS` accepted; `R2'` rejected (the unreachable token from the production incident); empty and whitespace-only rejected; a garbage token rejected with that token named in the message. Plus the two cases that exist only because of the raw-`moves` check: `"R\tU R'"` and `"R’ U"` must both be **rejected** — each normalizes to a fully producible sequence, so a validator checking only the normalized form would pass them and hand the practice loop a token it can never dispatch.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- `grep -r "@/test/tokenGrammar" src/` returns nothing
- `grep -n "components" src/lib/notation/moveGrammar.ts` returns nothing (no React import path into the grammar)

#### Manual Verification:

- A practice session on a seeded algorithm still accepts moves and completes exactly as before (grid + keyboard input, per-move feedback, streak recorded)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Migration — normalized column + provenance

### Overview

Add the normalized generated column that makes index-backed duplicate matching possible, the nullable FK that records where a copied algorithm came from, and the parity test that pins the SQL normalization to the JS one.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_algorithms_normalized_moves_and_source.sql` (new)

**Intent**: Give `algorithms` a normalized, indexed projection of `moves` for FR-015 matching while keeping `moves` display-verbatim, and add the provenance link a copied row carries back to its original.

**Contract**: Two additive changes, no data migration (there is no user data):

- `moves_normalized text GENERATED ALWAYS AS (...) STORED`, plus a btree index on it. The expression maps parentheses to a space, folds U+2019 to ASCII `'`, collapses whitespace runs to a single space, and trims — byte-identical to `normalizeMoves`. Written as a single expression over `moves`:

  ```sql
  btrim(regexp_replace(translate(moves, '()’', '  '''), '\s+', ' ', 'g'))
  ```

  `translate` pairs `from` and `to` **positionally** and deletes any `from` character with no `to` counterpart, so the `to` argument must be exactly three characters long: space, space, apostrophe. As a SQL literal that is `'  '''` — open quote, two spaces, an escaped apostrophe, close quote. Getting this wrong is easy and silent-looking: the earlier draft of this plan used `'''''`, which is a *one*-character literal, and would have mapped `(` → `'` while **deleting** `)` and `’` — turning `(R U2 R' U')` into `'R U2 R' U'`. Verify the mapping in `psql` before committing the migration (`select translate('(R U’)', '()’', '  ''')` must yield ` R U' `), and fall back to nested `replace()` calls if the escaping proves awkward:

  ```sql
  btrim(regexp_replace(replace(replace(replace(moves, '(', ' '), ')', ' '), '’', ''''), '\s+', ' ', 'g'))
  ```

  All three functions (`translate` / `replace`, `regexp_replace`, `btrim`) are `IMMUTABLE`, which a generated column requires. The parity test in item 3 is what proves whichever form ships.

- `source_algorithm_id uuid NULL REFERENCES public.algorithms(id) ON DELETE SET NULL`. `SET NULL`, not `CASCADE` — deleting an original must never delete a learner's copy.

- `DROP INDEX algorithms_moves_idx;` — superseded. It was built for byte-exact matching on raw `moves` (`...rls.sql:28-29`, comment: "enables O(1) exact-match duplicate detection (FR-015)"), and after this migration no query in the codebase filters on raw `moves` at all. Leaving it costs a write on every insert and, worse, leaves the schema pointing the next reader at the wrong index for FR-015. Include a comment on the drop naming `algorithms_moves_normalized_idx` as its replacement.

No RLS policy changes: the new column is on an existing table already covered by `alg_select`/`alg_insert`.

#### 2. Generated types

**File**: `src/db/database.types.ts`

**Intent**: Reflect both new columns so Phase 3 can type its inserts and selects.

**Contract**: Regenerated via the Supabase CLI. `algorithms.Row` gains `moves_normalized: string` and `source_algorithm_id: string | null`; `algorithms.Insert` gains `source_algorithm_id?: string | null` and must NOT accept `moves_normalized` (generated columns are not insertable).

#### 3. Normalizer parity test

**File**: `src/test/integration/normalization.int.test.ts` (new)

**Intent**: Prove the JS normalizer and the SQL generated column agree, over real data, so the two definitions cannot drift into a silent false negative.

**Contract**: Using `serviceClient()`, select `moves, moves_normalized` for every row in `algorithms`, and assert `normalizeMoves(row.moves) === row.moves_normalized` for each. Fails loudly if the table is empty (an empty pass is not a pass). Additionally asserts the round-trip on a hand-written case containing parentheses, a double space, and a U+2019 — so the test still has teeth if the seed data happens to contain none of them.

#### 4. Apply the migration to the remote project

**File**: none — a deploy step, not a code change.

**Intent**: Get the two new columns onto the remote Supabase project, because that is the database the dev server and the E2E suite actually talk to. Without this, Phases 3, 4, and 6 cannot pass.

**Contract**: `npx supabase db push` against the remote project (or the equivalent SQL run in the dashboard), after `npx supabase db reset` has proven the migration locally. This is load-bearing, not housekeeping: `vitest.config.integration.ts:15-16` sources credentials from `.env.test` and the integration suite runs against the **local** stack, but `playwright.config.ts:4-6` documents that E2E auth is "a real signed-in session against the remote Supabase project the dev server also targets (see `.dev.vars`)". So every manual criterion in Phase 3 (curl / browser against `npm run dev`), every manual criterion in Phase 4, and the whole Phase 6 E2E spec hit the remote project. Against a remote schema without `moves_normalized`, the duplicate `SELECT ... WHERE moves_normalized = $1` fails with PostgREST `42703` (undefined column) and every add-algorithm submission errors out.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Remote schema is current: `npx supabase db push` reports no pending migrations on a second run
- Stale index is gone: `\di algorithms*` (or a `pg_indexes` query) lists `algorithms_moves_normalized_idx` and **not** `algorithms_moves_idx`
- Types are current: regenerating `src/db/database.types.ts` produces no diff
- Type checking passes: `npm run typecheck`
- Integration suite passes: `npm run test:integration`
- Unit tests still pass: `npm test`

#### Manual Verification:

- In Supabase Studio, a seeded row with parentheses (e.g. an OLL entry from `algos_seed.sql`) shows `moves_normalized` with parens stripped and single spacing, while `moves` is unchanged
- `EXPLAIN` on `SELECT ... WHERE moves_normalized = '...'` shows an index scan, not a sequential scan
- Both new columns are present on the **remote** project (Studio, or a service-role `select moves_normalized, source_algorithm_id from algorithms limit 1`) — Phases 3, 4, and 6 verify against that database, not the local stack

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Server — list and algorithm creation

### Overview

Add the logic modules and JSON endpoints for creating a list, adding an algorithm with duplicate detection, and adding an existing algorithm as a copy. Follows the `complete.ts` → `completePractice.ts` split: the route does auth, body validation, and client construction; the module owns the logic and returns `{status, body}`.

### Changes Required:

#### 1. Create-list logic

**File**: `src/lib/lists/createList.ts` (new)

**Intent**: Insert a user-owned list and return it, leaning on `al_insert` for authorization rather than duplicating an ownership check.

**Contract**: `createList(supabase, user, { name }): Promise<{ status: number; body: unknown }>`. Trims `name`, rejects empty and over-long (cap at 100 chars) with `400`. Inserts `{ name, user_id: user.id, is_system: false }` — both ownership fields are required together by `algorithm_lists_ownership_check`. Returns `201` with `{ id, name }`. On DB error: `console.error` the raw error, return a generic message — never echo `error.message` to the client (prior impl-review F6).

#### 2. Add-algorithm logic

**File**: `src/lib/lists/addAlgorithm.ts` (new)

**Intent**: The FR-005 + FR-015 core — validate notation, look for a normalized match within the caller's visible scope, and either report the match or insert.

**Contract**: `addAlgorithm(supabase, user, { listId, name, moves, createAnyway }): Promise<{ status: number; body: unknown }>`.

Sequence:
1. `validateMoves(moves)` → `400` with the specific error on failure.
2. Duplicate query: from `algorithms` where `moves_normalized = normalized`, selecting `id, name, moves, list_id` **plus the owning list** via an embedded join — `algorithm_lists!inner(name, is_system)`. RLS (`alg_select`) already narrows this to "pre-built or in any of the caller's lists" — do not add a hand-rolled filter, and do not widen it.

   N matches is the normal case, not an edge case: the seeded PLL set has a T-perm, and the same sequence may also sit in two of the learner's own lists. So the query must be **deterministic** — order pre-built first (`is_system` descending on the embedded table), then by `algorithms.created_at` ascending as a stable tiebreak. Preferring the pre-built row is the reading of FR-015 ("pre-built or in any of their lists") that gives the learner the canonical entry rather than an arbitrary one of their own copies.

   The embedded list `name` and `is_system` are what make the Phase 4 panel able to say *where* the match lives ("already in the pre-built PLL set" vs "already in your Sunday drills list") — which is the entire basis for the add-vs-create decision. Trade-off: the join gives up a pure index-only lookup on `algorithms_moves_normalized_idx`; at 119 seeded rows plus a handful of user entries that is not measurable, but the Performance Considerations claim below is scoped accordingly.
3. Partition matches: any match whose `list_id` is the target list means the algorithm is already in this list → `409` with `{ status: "already_in_list", match }` (no copy, no duplicate row). Otherwise, if a match exists and `createAnyway` is not true → `200` with `{ status: "duplicate", match: { id, name, moves, listName, isSystem } }`, taking the **first** row of the ordered result from step 2. `listName` / `isSystem` are flattened out of the embedded `algorithm_lists` object here, so the client never sees the join shape.
4. Otherwise insert `{ list_id, name, moves, position }` where `moves` is the **raw** submitted string, not the validator's `normalized` — `moves` is display-verbatim and `moves_normalized` is derived from it by the generated column. Storing raw is only safe because step 1 also token-checked `parseMoves(raw)`. `position` is `coalesce(max(position), 0) + 1` within the list — so an empty list starts at `1`, not `0` (`position` is `NOT NULL` with no default). 1-based is not cosmetic: `AlgorithmRow.astro:16` renders `position` verbatim as the learner-visible row number, and the seeded rows are 1-based (`algos_seed.sql`: `'Basic 1', ..., 1`), so a 0-based custom list would show a row numbered `0` beside pre-built lists that start at `1`. Return `201` with `{ status: "created", algorithm }`.

`alg_insert` is what rejects an insert into a list the caller does not own; a `42501`/RLS failure maps to `403` with a generic message.

#### 3. Add-existing (copy) logic

**File**: `src/lib/lists/addExistingAlgorithm.ts` (new)

**Intent**: Implement the "add it to my list instead" branch of FR-015 as a single atomic INSERT that copies the source row and records where it came from.

**Contract**: `addExistingAlgorithm(supabase, user, { listId, sourceAlgorithmId }): Promise<{ status: number; body: unknown }>`. Reads the source row through the authed client — RLS decides visibility, so an invisible id is indistinguishable from a missing one and both return `404`. Inserts `{ list_id, name: source.name, moves: source.moves, position: <computed>, source_algorithm_id: source.id }`. If an algorithm with the same `moves_normalized` is already in the target list, return `409 { status: "already_in_list" }` rather than creating a second copy. Returns `201` with the new algorithm.

#### 4. Create-list route

**File**: `src/pages/api/lists/index.ts` (new)

**Intent**: `POST /api/lists` — the HTTP surface for `createList`.

**Contract**: Mirrors `src/pages/api/practice/complete.ts:5-56` exactly: `POST` only; `context.locals.user` → `401` if absent (middleware does not cover `/api/*`); `request.json()` in try/catch → `400 "Invalid body"`; hand-rolled `typeof` guard on `name`; `createClient(...)` → `500 "Supabase not configured"` when null; delegate, then map `{status, body}` onto the `Response` with `Content-Type: application/json`.

#### 5. Add-algorithm route

**File**: `src/pages/api/lists/[listId]/algorithms.ts` (new)

**Intent**: `POST /api/lists/:listId/algorithms` — one endpoint serving all three add paths, discriminated by body shape.

**Contract**: Same auth/validation/delegation skeleton as above. `listId` comes from `context.params` and is `400` if absent. Body is one of:

- `{ sourceAlgorithmId: string }` → `addExistingAlgorithm`
- `{ name: string, moves: string, createAnyway?: boolean }` → `addAlgorithm`
- anything else → `400 "Invalid body"`

The route never trusts `listId` for authorization — `alg_insert` does that (prior impl-review F2: the server must not trust client-supplied values, and here it deliberately does not need to).

#### 6. Logic unit tests

**File**: `src/lib/lists/addAlgorithm.test.ts`, `src/lib/lists/createList.test.ts` (new)

**Intent**: Cover the branch logic hermetically, following `completePractice.test.ts`'s stub pattern.

**Contract**: Stubbed Supabase client. Cases: invalid notation → `400` with the offending token named; no match → insert path with `position` computed as `max+1`, and `1` on an empty list (not `0` — it is the rendered row number); match outside the target list → `duplicate`, no insert issued, with `listName`/`isSystem` present in the payload; two matches outside the target list, one pre-built and one of the caller's own → the pre-built one is proposed (pins the step-2 ordering); match inside the target list → `already_in_list`, no insert issued; `createAnyway: true` with a match → insert proceeds; DB error → generic message, raw error not present in the response body.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- No raw DB error forwarding: `grep -rn "error.message" src/lib/lists/ src/pages/api/lists/` returns nothing

#### Manual Verification:

- `curl -X POST /api/lists` without a session returns `401`
- With a session: creating a list returns `201`; adding an algorithm returns `201`; re-submitting the same sequence returns the `duplicate` payload naming the match; submitting a sequence matching a seeded pre-built algorithm returns `duplicate` with that algorithm
- Submitting `R2'` returns `400` with a message naming `R2'`
- Adding an algorithm to a list id belonging to another account returns `403`, not `201`

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: UI — dashboard visibility and entry forms

### Overview

Make custom lists visible, and add the two React islands that drive the endpoints from Phase 3, including the inline FR-015 duplicate panel.

### Changes Required:

#### 1. Dashboard

**File**: `src/pages/dashboard.astro`

**Intent**: Stop hiding custom lists, and present them as a section distinct from the pre-built sets so the learner can tell theirs apart.

**Contract**: The `.eq("is_system", true)` filter at `:18` is removed and `is_system` added to the `.select()` projection; RLS already restricts the result to pre-built plus the caller's own. The page partitions the rows into two rendered groups ("Algorithm Sets" / "My Lists") and hosts the create-list island. The existing empty-state copy ("No pre-built sets found.") applies to the pre-built group only; the custom group gets its own empty state.

#### 2. Create-list island

**File**: `src/components/app/CreateListForm.tsx` (new)

**Intent**: Let the learner name and create a list from the dashboard without a page transition.

**Contract**: `client:load` island. A name input and submit button; `fetch("/api/lists", {method:"POST"})` with a JSON body (the `PracticeSession.tsx:322-339` idiom). Client-side validation mirrors `SignUpForm.tsx:22-45` — synchronous check, error in local `useState`, cleared per-keystroke. On `201`, navigate to `/sets/${id}`. On error, render the message inline. Locators must be role- and label-addressable for Phase 6.

#### 3. Set page

**File**: `src/pages/sets/[id].astro`

**Intent**: Render the add-algorithm form, but only on a list the learner owns.

**Contract**: The list `.select()` at `:20-23` gains `is_system, user_id`. When `is_system === false` and `user_id === Astro.locals.user?.id`, the page renders the add-algorithm island with `listId`; otherwise it renders exactly as today. The narrow inline type at `:14` widens to match the new projection. Nothing else on the page changes — RLS already handles a user-owned list correctly.

#### 4. Add-algorithm island

**File**: `src/components/app/AddAlgorithmForm.tsx` (new)

**Intent**: The FR-005 entry surface and the FR-015 decision point, in one place, without losing typed state.

**Contract**: `client:load` island taking `listId`. Name + moves inputs; on submit, runs `validateMoves` from `@/lib/notation/moveGrammar` client-side first (same validator the endpoint uses, so the message is identical) and blocks the request on failure. Otherwise `POST`s to `/api/lists/${listId}/algorithms`.

Response handling:
- `201` → reload the page so the new algorithm appears in the server-rendered list.
- `{ status: "duplicate", match }` → render an inline panel below the form naming the match, its moves, and **where it lives** — `isSystem` → "in the pre-built <listName> set", otherwise "in your <listName> list" — with two actions: **Add this one** (re-`POST`s `{ sourceAlgorithmId: match.id }`) and **Create separate entry** (re-`POST`s the original body with `createAnyway: true`). The form's typed values stay intact behind the panel. Move focus to the panel when it appears so it is announced rather than silently inserted.
- `409 already_in_list` → inline message stating the algorithm is already in this list; no action buttons.
- Other errors → inline message.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- Unit tests pass: `npm test`
- `grep -n 'eq("is_system", true)' src/pages/dashboard.astro` returns nothing

#### Manual Verification:

- Dashboard shows pre-built sets and a separate "My Lists" section; a newly created list appears there
- Creating a list navigates to its (empty) set page, which shows the add-algorithm form
- A pre-built set page shows **no** add-algorithm form
- Entering `R U R' U'` with a name adds it and it appears in the list
- Entering the move sequence of a seeded pre-built algorithm surfaces the duplicate panel naming that algorithm **and the pre-built set it belongs to**; "Add this one" adds it to the custom list; "Create separate entry" creates a distinct row
- Entering the same sequence twice into the same list reports "already in this list" rather than creating a second copy
- Entering `R2'` shows the validation error at the form and issues no request
- Practicing an algorithm from the custom list works through the normal `/sets/[id]/[algoId]` flow

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 5: Two-account isolation tests

### Overview

This slice creates the first user-owned rows in the product, which makes it the first real exercise of test-plan risk #2 (cross-user data access) and of RLS policies that have never been executed by a test. Build the two-account harness and prove the boundary holds.

### Changes Required:

#### 1. Integration harness

**File**: `src/test/integration/db.ts`

**Intent**: Support two concurrent throwaway accounts and clean up the new row types, so isolation can be tested and tests do not leak rows into each other.

**Contract**: `createTestUser()` is already per-call and returns a distinct user — no signature change needed; confirm two concurrent calls yield independent authed clients. `cleanupUserRows` extends to delete the user's `algorithms` (via their owned `list_id`s) and then their `algorithm_lists`, in that order, before the existing `practice_sessions`/`algorithm_mastery` deletes — child rows first, since the cascade direction is list → algorithms. Add a `createList` fixture helper using the service client.

#### 2. Isolation tests

**File**: `src/test/integration/listIsolation.int.test.ts` (new)

**Intent**: Prove, through the RLS-governed authed client, that user A cannot reach user B's data — including the one path where a leak would be invisible in the UI and look like a feature.

**Contract**: `beforeAll` creates users A and B and a private list for each; `afterEach` cleans both; `afterAll` deletes both. Assertions, all driven through `authedClient` (never the service client) with independent service-role read-backs for anything claimed to have persisted:

- A's `select` on `algorithm_lists` returns A's list and the pre-built lists, and **not** B's list.
- A's `select` on `algorithms` filtered to B's `list_id` returns zero rows.
- A's `insert` into `algorithms` with `list_id` = B's list is rejected.
- A's `update` and `delete` against a row in B's list affect zero rows, confirmed by a service-role read-back showing the row unchanged.
- A's `insert` into `algorithm_lists` with `user_id` = B's id is rejected (`al_insert`'s `user_id = auth.uid()`).
- **FR-015 scope**: B adds an algorithm with a distinctive sequence; A's duplicate query on that normalized sequence returns zero rows. A's duplicate query on a seeded pre-built sequence returns the pre-built row. This is the assertion that pins `alg_select` to FR-015's exact wording.

Each assertion must fail if the risk materializes — verify by deliberately breaking one policy locally and confirming the corresponding test goes red.

### Success Criteria:

#### Automated Verification:

- Integration suite passes: `npm run test:integration`
- Unit tests pass: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- Deliberate-break check: temporarily relax `alg_select` to `USING (true)` locally and confirm the cross-user read and FR-015 scope tests both fail; restore the policy and confirm they pass again (record which policy was broken and what failed)
- After a full run, a service-role query shows no leftover `algorithm_lists` or `algorithms` rows for the throwaway users

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 6: E2E coverage and CI wiring

### Overview

Cover the user-visible create→duplicate→add flow end to end, and wire `npm test` into CI so this slice's guards actually run.

### Changes Required:

#### 1. E2E spec

**File**: `playwright/test/custom-list-algorithm-entry.spec.ts` (new)

**Intent**: Verify the flow that is the heart of the feature, against the built worker, without leaving rows behind in the shared remote project.

**Contract**: Follows `playwright/test/E2E_RULES.md` — role/label/text locators only, `{ exact: true }` on any move-token text, no `waitForTimeout`, auth from the shared `storageState`. Every created list and algorithm name carries a timestamp suffix so parallel runs and re-runs cannot collide. An `afterEach` deletes what the spec created (this is the first spec in the repo to do teardown; delete via a service-role client built the way `src/test/integration/db.ts` builds one, since the app ships no delete path).

Scenarios: create a list and see it on the dashboard; add an algorithm and see it in the list; submit the move sequence of a seeded pre-built algorithm and see the duplicate panel name it; choose "Add this one" and see the algorithm appear in the custom list; submit invalid notation and see the form error.

#### 2. CI workflow

**File**: `.github/workflows/ci.yml`

**Intent**: Run the unit suite on every push and PR, so the validator and logic tests are not inert.

**Contract**: `npm test` is added as a step after `npm run lint` and before `npm run build`. The integration suite is **not** added — it requires `SUPABASE_SERVICE_ROLE_KEY`, which the workflow does not currently supply, and pointing CI at the shared remote project would make runs order-dependent. If that secret is added later, `npm run test:integration` becomes a one-line follow-up. Note the deploy step is gated on `master` pushes and runs after `build`; adding a failing test step therefore also gates deploys, which is the intent.

#### 3. Documentation

**File**: `README.md`

**Intent**: Record that the E2E spec now requires a service-role key for teardown, so the next person running `npm run test:e2e` is not surprised.

**Contract**: One line in the testing section naming `SUPABASE_SERVICE_ROLE_KEY` as required for the custom-list spec's cleanup, alongside the existing `.env.e2e` credentials note.

### Success Criteria:

#### Automated Verification:

- E2E suite passes: `npm run test:e2e`
- Unit tests pass: `npm test`
- Full CI sequence passes locally: `npm run typecheck && npm run lint && npm test && npm run build`
- `grep -n "npm test" .github/workflows/ci.yml` returns a match

#### Manual Verification:

- CI run on the PR shows the test step executing and passing
- Deliberate-break check: revert the `dashboard.astro` `is_system` change and confirm the "create a list and see it on the dashboard" scenario fails; restore and confirm it passes
- After an E2E run, a service-role query shows no leftover timestamped lists or algorithms in the remote project

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation. This is the final phase.

---

## Testing Strategy

### Unit Tests:

- `normalizeMoves` — whitespace (leading, trailing, double, tab, newline), parentheses against a real seeded sequence, U+2019 folding, case preservation
- `validateMoves` — every `PRODUCIBLE_TOKENS` member accepted; `R2'` rejected (the production-incident token); empty and whitespace-only rejected; garbage token named in the message
- `addAlgorithm` — no match → insert with `position` = `max+1` (and `1` when empty); match outside target list → `duplicate` with no insert, carrying `listName`/`isSystem`; a pre-built and an own-list match together → the pre-built one proposed; match inside target list → `already_in_list` with no insert; `createAnyway` → insert; DB error → generic message
- `createList` — name trimmed, empty and over-long rejected, `is_system: false` and `user_id` both set
- Existing `seedTokens.test.ts` and `PracticeSession.parity.test.ts` keep passing against the relocated grammar

### Integration Tests:

- JS↔SQL normalizer parity across every seeded row, plus a hand-written case with parens, double space, and U+2019
- Two-account isolation: cross-user select/insert/update/delete on `algorithm_lists` and `algorithms`, each with an independent service-role read-back
- FR-015 scope: B's private algorithm never matches A's duplicate query; a seeded pre-built algorithm does

### Manual Testing Steps:

1. Create a list from the dashboard; confirm it appears under "My Lists" and not among the pre-built sets
2. Add `R U R' U'` to it; confirm it appears in the list and is practicable
3. Add the exact move sequence of a seeded PLL algorithm; confirm the duplicate panel names that algorithm
4. Choose "Add this one"; confirm a copy lands in the custom list and the pre-built set is unchanged
5. Repeat step 3 and choose "Create separate entry"; confirm two distinct rows exist
6. Submit the same sequence a third time into that list; confirm "already in this list" and no new row
7. Submit `R2'`; confirm the form error names the token and no request is issued
8. Sign in as a second account; confirm the first account's custom list is not visible anywhere, and that entering the first account's private sequence does **not** surface it as a duplicate
9. Practice an algorithm added via "Add this one"; confirm the streak starts at zero (expected under D2) and the session records

## Performance Considerations

The duplicate query's `moves_normalized = $1` predicate is served by the new `algorithms_moves_normalized_idx` — the roadmap's stated risk for this slice ("ensure the query is index-backed at the schema layer") is satisfied, and an equality predicate is exactly what a btree serves. The embedded `algorithm_lists!inner(name, is_system)` join added for match attribution means the plan is an index scan plus a primary-key lookup per matched row rather than index-only; with matches numbering in the single digits that is not load-bearing. At `data_volume: small` (119 seeded rows plus user entries) nothing else here is load-bearing.

`position` is computed with a `max(position)` read before the insert. The dashboard's single query is unchanged in shape — it drops a filter rather than adding a join. Per `context/foundation/lessons.md`, any page that ends up with two independent Supabase queries should run them under `Promise.all`; none in this slice does, but `sets/[id].astro`'s existing sequential pair remains dependent (algorithms need the list id) and stays as-is.

## Migration Notes

One additive migration, no data migration — FR-004/FR-005 have never shipped, so there are no user-owned rows to convert. Both changes are backward-compatible: existing reads ignore the new columns, and `source_algorithm_id` is nullable, so pre-existing seeded rows are valid without backfill.

Rollback is `DROP COLUMN source_algorithm_id`, `DROP INDEX algorithms_moves_normalized_idx`, `DROP COLUMN moves_normalized` — but only after the application code that reads them is reverted, since Phase 3's duplicate query depends on the column. Apply it to **both** databases: the local stack (`npx supabase db reset` off the reverted migration set) and the remote project the dev server and E2E target. A rollback also has to recreate `algorithms_moves_idx`, which this migration drops. This repo has no down-migration convention, so a rollback is a hand-run statement in each place, in that order (code first, then remote, then local).

Per the repo convention established in `context/archive/2026-08-24-rotation-notation-fix/`, corrective data repairs belong in `supabase/fixes/` (with a `GET DIAGNOSTICS ... ROW_COUNT` guard), not in `migrations/`. This slice needs no such repair.

## References

- Related research: `context/changes/custom-list-algorithm-entry/research.md`
- Roadmap slice: `context/foundation/roadmap.md` (S-04) — including the now-settled "exactly matches" open question
- PRD: `context/foundation/prd.md:68,71,105` (FR-004, FR-005, FR-015)
- Schema and policies: `supabase/migrations/20260527000000_domain_schema_rls.sql:20-29,61-98`
- Endpoint pattern to mirror: `src/pages/api/practice/complete.ts:5-56` → `src/lib/practice/completePractice.ts`
- Form pattern: `src/components/auth/SignUpForm.tsx:22-45`; fetch pattern: `src/components/app/PracticeSession.tsx:322-339`
- Integration harness: `src/test/integration/db.ts:21-68`; reference spec: `src/test/integration/persistence.int.test.ts`
- E2E rules: `playwright/test/E2E_RULES.md`
- Test-plan risk #2 and its protection row: `context/foundation/test-plan.md:42,61`
- The notation incident: `context/archive/2026-08-24-rotation-notation-fix/`, `supabase/fixes/2026-08-24-rotation-notation.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. Manual rows carry their confirmation basis, not just a sha.

### Phase 1: Notation grammar module

#### Automated

- [x] 1.1 Unit tests pass: `npm test` — 940c930
- [x] 1.2 Type checking passes: `npm run typecheck` — 940c930
- [x] 1.3 Linting passes: `npm run lint` — 940c930
- [x] 1.4 Build passes: `npm run build` — 940c930
- [x] 1.5 `grep -r "@/test/tokenGrammar" src/` returns nothing — 940c930
- [x] 1.6 `grep -n "components" src/lib/notation/moveGrammar.ts` returns nothing — 940c930

#### Manual

- [x] 1.7 Practice session on a seeded algorithm still accepts moves and completes as before — 940c930

### Phase 2: Migration — normalized column + provenance

#### Automated

- [x] 2.1 Migration applies cleanly: `npx supabase db reset` — faaf66c
- [x] 2.2 Regenerating `src/db/database.types.ts` produces no diff — faaf66c
- [x] 2.3 Type checking passes: `npm run typecheck` — faaf66c
- [x] 2.4 Integration suite passes: `npm run test:integration` — faaf66c
- [x] 2.5 Unit tests still pass: `npm test` — faaf66c
- [x] 2.6 `npx supabase db push` reports no pending migrations on a second run — faaf66c
- [x] 2.7 `algorithms_moves_normalized_idx` present and `algorithms_moves_idx` gone (`pg_indexes`) — faaf66c

#### Manual

- [x] 2.8 Seeded row with parentheses shows stripped, single-spaced `moves_normalized` and unchanged `moves` — faaf66c
- [x] 2.9 `EXPLAIN` on the normalized equality query shows an index scan — faaf66c
- [x] 2.10 Both new columns present on the **remote** project (Studio or service-role select) — Phases 3, 4, 6 verify against it — faaf66c

### Phase 3: Server — list and algorithm creation

#### Automated

- [x] 3.1 Unit tests pass: `npm test`
- [x] 3.2 Type checking passes: `npm run typecheck`
- [x] 3.3 Linting passes: `npm run lint`
- [x] 3.4 Build passes: `npm run build`
- [x] 3.5 `grep -rn "error.message" src/lib/lists/ src/pages/api/lists/` returns nothing

#### Manual

- [x] 3.6 `POST /api/lists` without a session returns `401`
- [ ] 3.7 Create list → `201`; add algorithm → `201`; resubmit same sequence → `duplicate` naming the match
- [ ] 3.8 Sequence matching a seeded pre-built algorithm returns `duplicate` with that algorithm
- [ ] 3.9 `R2'` returns `400` naming the token
- [ ] 3.10 Adding to another account's list id returns `403`

### Phase 4: UI — dashboard visibility and entry forms

#### Automated

- [ ] 4.1 Type checking passes: `npm run typecheck`
- [ ] 4.2 Linting passes: `npm run lint`
- [ ] 4.3 Build passes: `npm run build`
- [ ] 4.4 Unit tests pass: `npm test`
- [ ] 4.5 `grep -n 'eq("is_system", true)' src/pages/dashboard.astro` returns nothing

#### Manual

- [ ] 4.6 Dashboard shows pre-built sets and a separate "My Lists" section containing a new list
- [ ] 4.7 Creating a list navigates to its set page, which shows the add-algorithm form
- [ ] 4.8 A pre-built set page shows no add-algorithm form
- [ ] 4.9 Adding `R U R' U'` puts it in the list
- [ ] 4.10 Seeded sequence surfaces the duplicate panel; "Add this one" adds it; "Create separate entry" creates a distinct row
- [ ] 4.11 Same sequence twice into one list reports "already in this list"
- [ ] 4.12 `R2'` shows the form error and issues no request
- [ ] 4.13 Practicing a custom-list algorithm works via `/sets/[id]/[algoId]`

### Phase 5: Two-account isolation tests

#### Automated

- [ ] 5.1 Integration suite passes: `npm run test:integration`
- [ ] 5.2 Unit tests pass: `npm test`
- [ ] 5.3 Type checking passes: `npm run typecheck`
- [ ] 5.4 Linting passes: `npm run lint`

#### Manual

- [ ] 5.5 Deliberate-break check: relaxing `alg_select` fails the cross-user read and FR-015 scope tests; restoring passes them
- [ ] 5.6 Service-role query shows no leftover throwaway `algorithm_lists` / `algorithms` rows after a full run

### Phase 6: E2E coverage and CI wiring

#### Automated

- [ ] 6.1 E2E suite passes: `npm run test:e2e`
- [ ] 6.2 Unit tests pass: `npm test`
- [ ] 6.3 Full CI sequence passes locally: `npm run typecheck && npm run lint && npm test && npm run build`
- [ ] 6.4 `grep -n "npm test" .github/workflows/ci.yml` returns a match

#### Manual

- [ ] 6.5 CI run on the PR shows the test step executing and passing
- [ ] 6.6 Deliberate-break check: reverting the `dashboard.astro` filter change fails the dashboard E2E scenario; restoring passes it
- [ ] 6.7 Service-role query shows no leftover timestamped rows in the remote project after an E2E run

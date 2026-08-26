<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Custom List Creation + Algorithm Entry + Duplicate Detection

- **Plan**: context/changes/custom-list-algorithm-entry/plan.md
- **Scope**: Phases 1–6 of 6 (full plan)
- **Date**: 2026-08-26
- **Verdict**: NEEDS ATTENTION (triaged 2026-08-26 — 9 fixed, 1 accepted-and-documented)
- **Findings**: 0 critical, 5 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

### Success criteria (all re-run during review)

| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors (6 hints, 2 relevant ts(6133)) |
| `npm run lint` | 0 errors, exit 0 |
| `npm test` | 80 passed / 10 files |
| `npm run build` | Complete |
| `npm run test:integration` | 18 passed / 5 files |
| `npm run test:e2e` | 8 passed |
| Grep criteria 1.5, 1.6, 3.5, 4.5, 6.4 | all as specified |
| `pg_indexes` on `algorithms` | `algorithms_moves_normalized_idx` present, `algorithms_moves_idx` gone |

All Manual Progress rows carry a sha plus a confirmation basis; rows 5.5 and 6.6/6.7 record a correction to the plan's own prediction. No rubber-stamping detected.

### Scope discipline

All eight "What We're NOT Doing" exclusions held. Five unplanned files exist — `playwright/test/support/islands.ts`, `playwright/test/support/e2eEnv.ts`, `.env.e2e.example`, the `auth.setup.ts` rewrite, and a third `parseMoves` importer the plan's Phase 1 item 3 missed — all load-bearing for planned deliverables. One genuinely unrelated edit (a widened regex in `playwright/test/seed.spec.ts`) is a non-weakening fix for a pre-existing streak-accumulation flake.

## Findings

### F1 — No length cap on `moves`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/lists/addAlgorithm.ts:87-92,171
- **Detail**: `name` is capped at 100 chars (:87) but `moves` is capped nowhere — not in `validateMoves` (moveGrammar.ts:106-122), not in the route, and the column is plain `text`. An authenticated client can POST a multi-MB all-valid-token sequence; it is tokenized twice per request and re-tokenized on every practice page render.
- **Fix**: Add a `MOVES_MAX_LENGTH` check beside the name cap in `addAlgorithm.ts` and mirror it in `AddAlgorithmForm.tsx`.
- **Decision**: FIXED — cap added as `MOVES_MAX_LENGTH = 500` inside `validateMoves` (moveGrammar.ts), before `normalizeMoves`, so server and client are both covered by one check that runs ahead of any tokenizing. Two unit tests added (over-cap rejected, at-cap accepted).

### F2 — `position` read-then-insert can produce duplicate row numbers

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/lists/addAlgorithm.ts:152-171, src/lib/lists/addExistingAlgorithm.ts:78-92
- **Detail**: `position = max + 1` is a separate read then insert, and `20260527000000_domain_schema_rls.sql:20-27` has no unique constraint on `(list_id, position)`. Two concurrent adds both read N and write N+1 → duplicate learner-visible row numbers and nondeterministic ordering on `/sets/[id]`, which orders by position. The plan explicitly accepted a TOCTOU race for *duplicate detection*; this is a different race it never discussed.
- **Fix A ⭐ Recommended**: Accept it and document it in the plan's "What We're NOT Doing", same as the duplicate-detection race.
  - Strength: Identical risk profile to a race the plan already reasoned through and accepted at `data_volume: small` with single-user-per-list writes; zero new code.
  - Tradeoff: Duplicate row numbers stay reachable; a later reorder/edit slice inherits the problem.
  - Confidence: HIGH — the write pattern really is one user per list.
  - Blind spot: The form's submit-disable narrows but does not close the window; a double-submit from two tabs is untested.
- **Fix B**: Add `UNIQUE(list_id, position)` and retry on `23505`.
  - Strength: Closes it at the schema layer, where a future caller cannot bypass it.
  - Tradeoff: A migration plus `23505` mapping in two modules — the exact cost the plan declined to pay for the other race.
  - Confidence: MEDIUM — retry loops need a bound and a test.
  - Blind spot: Haven't checked whether any seeded list has duplicate positions that would block the constraint.
- **Decision**: ACCEPTED (Fix A) — recorded in the plan's "What We're NOT Doing" as an accepted race, alongside the existing `UNIQUE(list_id, moves)` exclusion, with a note that a future reorder/edit slice must close it.

### F3 — The pre-built-wins ORDER BY has no automated coverage

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/lib/lists/addAlgorithm.ts:121,143-144
- **Detail**: The plan put "pre-built wins" solely in the step-2 query ordering and said the two-match unit test "pins the step-2 ordering". What shipped applies the preference twice — in PostgREST (:121) and again in JS (`rows.find(r => r.algorithm_lists.is_system)`, :144) — and `addAlgorithm.test.ts:206-214` feeds the stub an own-list-first array, so it pins the JS rule. The `.order("algorithm_lists(is_system)")` clause is therefore verified by hand only. `lessons.md` records that the sibling `referencedTable` form of this exact call is a *silent no-op* returning 200 with unspecified order — precisely the failure a test was supposed to catch.
- **Fix A ⭐ Recommended**: Assert the emitted query string in the unit test (`order=algorithm_lists(is_system).desc`), per the `lessons.md` rule.
  - Strength: Directly pins the clause the lesson says fails silently, in the hermetic suite that already runs in CI.
  - Tradeoff: Asserts a PostgREST wire detail, so a client-library upgrade could churn the test.
  - Confidence: HIGH — the stub already captures the builder calls.
  - Blind spot: Proves the clause is *emitted*, not that Postgres honors it; the JS fallback still masks a server-side regression.
- **Fix B**: Add an integration test with a pre-built and an own-list row sharing one sequence, asserting the pre-built row comes back first.
  - Strength: Exercises the real database, so it catches both a dropped clause and a wrong one.
  - Tradeoff: The integration suite does not run in CI, so it would not gate a regression.
  - Confidence: HIGH — the harness and fixtures already exist.
  - Blind spot: Would need the JS `.find()` removed to have teeth.
- **Decision**: FIXED (Fix A) — the stub now captures every `.order()` call and a new unit test asserts the duplicate query emits exactly `["algorithm_lists(is_system)", {ascending:false}]` then `["created_at", {ascending:true}]`.

### F4 — Parity fixture writes a globally-visible pre-built row with try/finally-only cleanup

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/test/integration/normalization.int.test.ts:52-79
- **Detail**: The hand-written parity case inserts `{ is_system: true, user_id: null }` through the RLS-bypassing service client — a list visible to every user of the target database. Cleanup is `try/finally` only, so a killed run leaves `parity-<uuid>` behind permanently. What keeps this off a shared project is prose: `src/test/integration/setup.ts:5-15` checks the three vars are *present*, never that `SUPABASE_URL` is local.
- **Fix**: Make the fixture a user-owned list via the existing `createList(svc, userId)` helper in `db.ts`, and assert `SUPABASE_URL` is a localhost URL in `setup.ts`.
- **Decision**: FIXED — the parity fixture is now a throwaway-user-owned list (`createTestUser` + `createList`, deleted in `finally`), and `setup.ts` refuses to run against any non-local `SUPABASE_URL`. Guard verified by pointing `.env.test` at a remote host: the run aborts before any spec executes.

### F5 — Plan and README contradict each other on the E2E service-role key

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/custom-list-algorithm-entry/plan.md, Phase 6 items 1 and 3
- **Detail**: The plan says teardown runs "via a service-role client built the way `src/test/integration/db.ts` builds one", and that the README must name `SUPABASE_SERVICE_ROLE_KEY` as required. What shipped (`playwright/test/support/e2eEnv.ts:64-79`) signs in as the E2E user with the anon key and deletes through `al_delete`/`alg_delete`. The README says the opposite — "no service-role key is required". The README is correct and the adaptation is strictly better: no new secret, and the teardown is itself RLS-scoped so it cannot delete rows the spec was not allowed to create. Progress row 6.7 records the adaptation. Only the plan text was never amended, so the two now disagree in writing.
- **Fix**: Amend `plan.md` Phase 6 items 1 and 3 to describe the RLS-scoped teardown that actually shipped.
- **Decision**: FIXED — plan Phase 6 items 1 and 3, and the Phase 6 success criterion, amended to describe the RLS-scoped teardown that shipped.

### F6 — Unused `user` param implies an ownership check that isn't there

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/lists/addAlgorithm.ts:78, src/lib/lists/addExistingAlgorithm.ts:41
- **Detail**: Both take `user: ListUser` and never read it (typecheck emits `ts(6133)` for both). The precedent, `completePractice.ts:53,61`, uses it for `user_id`. Authorization is correctly RLS-only here — the parameter just misleads a reader into thinking an ownership check happens.
- **Fix**: Drop the parameter, or rename it `_user`.
- **Decision**: FIXED — `user` dropped from both `addAlgorithm` and `addExistingAlgorithm` signatures and all call sites; the route still gates on `context.locals.user`. Typecheck hints 6 → 4.

### F7 — Malformed `listId` returns 500, not 400

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/lists/[listId]/algorithms.ts:24-30
- **Detail**: `listId` is checked for presence, never for shape. `/api/lists/foo/algorithms` reaches PostgREST as `.eq("list_id","foo")` → Postgres `22P02` → `addAlgorithm.ts:160-163` maps it to 500. Authorization is unaffected.
- **Fix**: Validate the UUID format in the route and return 400.
- **Decision**: FIXED — `UUID_RE` shape guard in the route returns 400 `Invalid listId` before PostgREST sees the value.

### F8 — `algorithms.Insert` accepts `moves_normalized`; `Row` types it nullable

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/db/database.types.ts:82,89
- **Detail**: The plan said `Insert` "must NOT accept `moves_normalized`" and that `Row` would gain `moves_normalized: string`. Shipped types have it optional-in-Insert and `string | null` in `Row` — but that is faithful CLI output (regenerated during review: no table-content diff), and `lessons.md` already carries the accepted rule "treat generated Supabase columns as optional-in-Insert and nullable-in-Row". The plan's contract was unachievable, not the implementation wrong. Latent only: nothing inserts the column today.
- **Fix**: Correct the plan contract to cite the existing `lessons.md` rule.
- **Decision**: FIXED — plan Phase 2 type contract amended to state the actual CLI output and cite the existing `lessons.md` rule.

### F9 — E2E teardown selects lists by name with no owner filter

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: playwright/test/support/e2eEnv.ts:94-111
- **Detail**: `deleteOwnLists` resolves ids with `.in("name", names)` and no `user_id` / `is_system` filter. Safe today only because `al_delete` scopes to the caller's own non-system lists and names carry a `Date.now()` suffix. Not a prefix delete — seeded rows are unreachable.
- **Fix**: Add `.eq("user_id", <session user id>).eq("is_system", false)` to the lookup.
- **Decision**: FIXED — `deleteOwnLists` now filters on `user_id` (from `auth.getUser()`) and `is_system: false` as well as the names. Verified against the remote project after a full E2E run: 0 leftover `e2e-cle-*` lists, 0 own non-system lists, 127 seeded algorithms untouched.

### F10 — Astro pages echo raw PostgREST messages the lib modules refuse to

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/pages/dashboard.astro:25, src/pages/sets/[id].astro:27,37,42
- **Detail**: `queryError = error.message` / `bannerError = listError.message`, one of them interpolated into a redirect query string. `createList.ts:57-61` takes the opposite stance ("never echo it — a DB error string can leak schema and policy details") and `createList.test.ts:95-103` asserts that behavior. Both page lines are pre-existing, and the `sets/[id].astro` one was *deliberately* introduced by a prior implementation review (c29f2f3, "honest error redirects"). This slice introduces no new leak class, but it widens both queries to user-owned rows, putting two accepted decisions in direct conflict.
- **Fix A ⭐ Recommended**: Pick one house rule — log server-side, render generic — and apply it to both pages, superseding c29f2f3.
  - Strength: Removes a live contradiction between two accepted review decisions, and matches the stance the new lib modules already test for.
  - Tradeoff: Reverses an earlier reviewed decision; debugging a page-level DB failure gets harder.
  - Confidence: MEDIUM — the c29f2f3 rationale was about honesty to the user, which a generic message partly loses.
  - Blind spot: Haven't checked whether any E2E spec asserts on the specific redirect message text.
- **Fix B**: Leave both as-is and record the split (pages honest, APIs generic) as an explicit `lessons.md` rule.
  - Strength: Zero code churn; stops future reviews from re-raising the same tension.
  - Tradeoff: Keeps raw PostgREST strings reachable in a URL, where they end up in browser history and any proxy log.
  - Confidence: HIGH — this is purely a documentation change.
  - Blind spot: The rule would need a boundary definition sharp enough for the next reviewer to apply.
- **Decision**: FIXED (Fix A) — all three pages now log the PostgREST error server-side and render a fixed message; `sets/[id].astro` no longer interpolates it into the redirect query string. Extended beyond the finding's scope to `sets/[id]/[algoId].astro:33,45`, which has the same pattern and would otherwise have kept the inconsistency alive. Blind spot closed first: no Playwright spec asserts any of these strings.

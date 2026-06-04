# Persistence Integration Tests (#1, #4) Implementation Plan

## Overview

Rollout Phase 2 of `context/foundation/test-plan.md` — "Persistence integration". Prove two
risks at the cheapest layer that gives real signal:

- **#1 — Finished session result fails to persist.** A clean run must leave a persisted
  `practice_sessions` row AND a correct `algorithm_mastery` row, asserted by a fresh DB
  **read-back** — not the 200 response body (which is computed in memory and lies about whether
  the write landed).
- **#4 — Streak miscounts.** The *persisted* streak must increment on a clean run, reset on a
  dirty run, flip `mastery_reached` at exactly 3 consecutive clean runs and keep it sticky, and
  stay isolated per `(user, algorithm)`. Oracle = **PRD FR-013**, never `computeStreak` (using
  the code under test as the oracle is a tautology).

Plus hermetic coverage of the two `500` error branches that a real DB cannot trigger on demand.
The documented fetch-then-compute-then-upsert race is **documented, not tested** (see rationale
in Current State Analysis).

## Current State Analysis

The entire write path for both risks is one endpoint, `src/pages/api/practice/complete.ts`
(`POST /api/practice/complete`), which is **non-atomic**:

1. `Promise.all([` insert `practice_sessions`, select current `algorithm_mastery` row `])`
   (`complete.ts:51-64`)
2. `computeStreak(currentClean, alreadyMastered, isClean)` — pure, already unit-tested in Phase 1
   (`src/lib/practice/streak.ts:22-26`, `streak.test.ts`)
3. `upsert algorithm_mastery` on conflict `(user_id, algorithm_id)` (`complete.ts:93-101`)
4. respond `{ consecutiveClean, masteryReached }`, `200` (`complete.ts:111-120`)

Error branches: FK violation `23503` on the session insert → `400 "Invalid algorithmId"`
(`complete.ts:66-73`); any other insert error, a mastery-read error, or an upsert error →
`500 "Failed to record session"` (`complete.ts:74-87`, `103-109`).

**The astro:env blocker.** `src/lib/supabase.ts:3` imports `SUPABASE_URL, SUPABASE_KEY` from
`astro:env/server` — a build/SSR-only virtual module that does not resolve under plain
Vitest/node. The endpoint imports that factory, so neither `complete.ts` nor `@/lib/supabase`
is node-importable as-is. This is why Phase 1 kept the test graph to pure modules
(`vitest.config.ts` jsdom-only; `src/test/setup.ts` imports nothing app-side).

**Schema (oracle for persisted rows)** — `supabase/migrations/20260527000000_domain_schema_rls.sql`:
- `practice_sessions`: `is_clean bool NOT NULL`, `error_count int NOT NULL DEFAULT 0`,
  `completed_at timestamptz DEFAULT now()`; FK `algorithm_id → algorithms(id)`; append-only.
- `algorithm_mastery`: `consecutive_clean int NOT NULL DEFAULT 0`,
  `mastery_reached bool NOT NULL DEFAULT false`; UNIQUE `(user_id, algorithm_id)` (matches the
  upsert `onConflict`).
- RLS on both, all policies key off `auth.uid() = user_id`.
- Seeded algorithm UUIDs exist (`supabase/seed.sql`, `supabase/algos_seed.sql`) — tests reuse
  them rather than inserting algorithms.

**Test infra today**: single `vitest.config.ts` (jsdom, globals, `@ → ./src`,
`include: src/**/*.test.{ts,tsx}`); scripts `test`, `test:watch`; `@supabase/supabase-js@^2.99.1`
is a direct dep; `supabase@^2.23.4` CLI present; local stack via `npx supabase start`. No
node-env project, no service-role client.

**On the race (why document-only).** The read→compute→upsert window can lose an increment when
two completions for the same `(user, algo)` overlap. Traced through both triggers:
- *Double-submit / retry* (the only realistic single-user trigger, per
  `context/archive/2026-05-28-practice-session-core-loop/`): the two POSTs are the **same** real
  session sent twice. The lost update yields the **correct** count (+1 for one real run); an
  atomic fix would instead **overcount**. So the race is benign — even corrective — here.
- *Genuinely distinct concurrent clean runs* (two tabs/devices, two real runs): only here is the
  lost update a true undercount, and `mastery_reached` is monotonic so PRO is never revoked.
  Requires two real sessions finishing within a few-ms window — rare for a single-user app.

Net: near-zero genuine-harm exposure; a forced-interleave test would pin a near-theoretical
outcome and add flake. "Don't ignore the documented race" (test-plan §2/#4) is satisfied by
documenting it honestly. The real adjacent issue under double-submit — duplicate
`practice_sessions` rows (no idempotency) — is session history, not lost data (#1) or a wrong
streak (#4), so it is out of this phase's risks.

### Key Discoveries:

- `complete.ts:51-64` — non-atomic dual write; `complete.ts:89-101` — compute + upsert.
- `complete.ts:111-120` — response is computed intent, not proof of persistence (the #1 trap).
- `src/lib/supabase.ts:3` — `astro:env/server` import → node-import blocker (drives the seam).
- `algorithm_mastery_user_algorithm_unique UNIQUE (user_id, algorithm_id)` matches the upsert key.
- PRD FR-013 (`context/foundation/prd.md`) — "3 consecutive mistake-free sessions for the same
  algorithm … per-algorithm and persisted" = the #4 oracle.
- `src/lib/practice/streak.test.ts` already covers the pure rule — integration must NOT duplicate it.

## Desired End State

- `completePractice(...)` is a node-importable seam holding the exact insert→read→compute→upsert
  logic; `complete.ts` is a thin route wrapper over it with identical observable behavior.
- `npm test` (jsdom) additionally runs hermetic tests of the seam's `500` error branches.
- `npm run test:integration` (new, node env, opt-in) runs against a local Supabase and proves
  #1 (persisted rows via read-back) and #4 (streak-through-DB correctness) with the test user's
  rows cleaned between tests.
- `test-plan.md` §6.3, §6.5, §6.6 filled; §3 Phase 2 status advanced; the race documented.
- Verify: `npm run lint` + `npm run build` pass; `npm test` green; with a local stack up,
  `npm run test:integration` green.

## What We're NOT Doing

- No concurrent/race test, no idempotency/duplicate-session-row test (out of #1/#4 scope).
- No HTTP-level test, no real Astro middleware/auth-flow exercise (signup/signin owned by the
  starter, excluded in test-plan §7; HTTP fidelity is Phase 3/4 territory).
- No cross-user / RLS-isolation tests (that is Phase 3, risk #2).
- No CI wiring of the integration suite (Phase 4 / lesson boundary — do not author CI here).
- No change to the streak rule, the non-atomic design, or the response shape.
- No new pure-logic streak tests (Phase 1 owns `computeStreak`).

## Implementation Approach

Extract the endpoint logic into a node-importable function so a real-DB test can drive the
*actual* write path without booting Astro or tripping `astro:env`. Layer the tests by
cost × signal: hermetic stubs for the partial-failure branches a real DB won't reproduce; real
local Supabase for the persistence + streak round-trip that a stub would lie about (constraints,
defaults, the unique-key upsert, per-row isolation). Authenticated-user client for the
RLS-governed write path; service-role client only for fixture setup, teardown, and read-back
cross-checks. Keep the integration suite in its own node-env config, opt-in and out of the
default fast suite.

## Critical Implementation Details

- **astro:env seam (load-bearing).** The seam `completePractice` must take an injected Supabase
  client and must NOT import `astro:env`. `complete.ts` keeps the `astro:env`-bound
  `createClient` call and passes the client in. This is the single fact that makes the
  integration tests possible under node.
- **Behavior-neutral refactor (Phase 1 → mode).** Phase 1 is a refactor with no red test
  available first — use `/10x-implement`, not `/10x-tdd`. The route's status codes, JSON bodies,
  and `console.error` calls must be byte-for-byte preserved; the seam returns a structured result
  the route maps to the existing `Response`s.
- **Oracle discipline (#4).** Expected streak values come from PRD FR-013 (3 = PRO; clean
  increments; dirty resets; mastery sticky; per-algorithm), hand-written in the test — never
  imported from or recomputed via `computeStreak`.
- **RLS + FK demand a real user.** The authed-user write path needs a real `auth.users` row and
  a valid JWT, and `algorithm_id` must reference a seeded algorithm — otherwise the insert fails
  on FK/RLS rather than the behavior under test.

---

## Phase 1: Seam extraction (behavior-neutral refactor)

### Overview

Lift the body of the `complete.ts` POST handler into a pure, node-importable function that takes
an injected Supabase client, leaving the route as a thin wrapper with identical behavior. This
unblocks both the hermetic and integration layers without touching `astro:env`.

### Changes Required:

#### 1. New seam module

**File**: `src/lib/practice/completePractice.ts`

**Intent**: Hold the exact insert→read→compute→upsert sequence and error mapping from
`complete.ts`, decoupled from HTTP and `astro:env`, so tests can drive it with an injected
client. Behavior must be identical to the current endpoint.

**Contract**: Export `completePractice(supabase, user, input)` where `supabase` is a
`@supabase/supabase-js`/SSR client (typed against `Database`), `user` is the authenticated user
(`{ id: string }`), and `input` is `{ algorithmId: string; isClean: boolean; errorCount: number }`
(already-validated). Returns a discriminated result the route maps to a `Response`, e.g.
`{ status: 200; body: { consecutiveClean; masteryReached } }
 | { status: 400; body: { error: "Invalid algorithmId" } }
 | { status: 500; body: { error: "Failed to record session" } }`.
It must preserve the existing `console.error(...)` calls and the `23503 → 400` branch, and must
import `computeStreak` (not reimplement it). No `astro:env` import.

#### 2. Route becomes a thin wrapper

**File**: `src/pages/api/practice/complete.ts`

**Intent**: Keep auth gate (401), body parse/validate (400), and the `astro:env`-bound
`createClient` (500 if unconfigured); then delegate to `completePractice` and translate its
result into the same `Response`s as today.

**Contract**: After `createClient`, call `completePractice(supabase, user, { algorithmId,
isClean, errorCount })` and map `result.status`/`result.body` to a `Response` with
`Content-Type: application/json`. Observable behavior (status codes, JSON bodies, log lines)
unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking + build passes: `npm run build`
- Linting passes: `npm run lint`
- Existing unit/component suite still green: `npm test`

#### Manual Verification:

- A clean and a dirty completion via the running app behave exactly as before (status, banner,
  persisted values).

**Implementation Note**: After automated verification passes, pause for manual confirmation
before proceeding.

---

## Phase 2: Hermetic error-branch tests

### Overview

Cover the two `500` branches (mastery-read failure, upsert failure) that a real DB will not
trigger on demand, by driving the Phase-1 seam with a stub client. No DB, no `astro:env`, so
these run in the default fast suite.

### Changes Required:

#### 1. Seam error-branch spec

**File**: `src/lib/practice/completePractice.test.ts`

**Intent**: Prove the seam returns `500` (and logs) when the mastery read errors and when the
upsert errors, and returns `400` when the session insert reports FK code `23503` — using a stub
client, asserting the seam's structured result, not a real DB.

**Contract**: A minimal stub implementing the chained shape the seam calls
(`from(...).insert(...)`, `from(...).select(...).eq(...).eq(...).maybeSingle()`,
`from(...).upsert(...)`), returning `{ error }` / `{ data, error }` objects matching
supabase-js. Cases: mastery-read error → `{status:500}`; upsert error → `{status:500}`; insert
error `{code:"23503"}` → `{status:400}`; happy path with a stubbed existing row → `{status:200}`
with expected `consecutiveClean`/`masteryReached` (oracle from FR-013, not `computeStreak`).
Runs under the existing jsdom config (no DB import).

### Success Criteria:

#### Automated Verification:

- New spec passes: `npm test`
- Linting passes: `npm run lint`

#### Manual Verification:

- Reviewer confirms each case asserts the seam's result/log, not a mirror of the implementation.

**Implementation Note**: TDD-suitable (each case names a red assertion first). After automated
verification passes, pause for manual confirmation.

---

## Phase 3: Integration harness (node config + helpers)

### Overview

Stand up a node-environment Vitest project that talks to a local Supabase, plus the client and
fixture helpers the integration specs need. Opt-in; not part of `npm test`.

### Changes Required:

#### 1. Integration Vitest config

**File**: `vitest.config.integration.ts`

**Intent**: A node-env config dedicated to DB-backed specs, independent of the jsdom unit config
and of `astro.config.mjs`.

**Contract**: `environment: "node"`, `globals: true`, `@ → ./src` alias, `include:
["src/**/*.int.test.ts"]`, a dedicated setup file (below), and loading of test env vars
(`.env.test` via `process.env` / a loader). Does not include the jsdom `src/test/setup.ts`.

#### 2. Integration setup + client/fixture helpers

**File**: `src/test/integration/setup.ts` (+ helpers, e.g. `src/test/integration/db.ts`)

**Intent**: Provide a service-role client (setup/teardown/read-back), an authenticated-user
client builder (anon key, RLS applies), throwaway-user lifecycle, and per-test row cleanup.

**Contract**: Build clients from `@supabase/supabase-js` using `process.env`
(`SUPABASE_URL`, `SUPABASE_KEY`/anon, `SUPABASE_SERVICE_ROLE_KEY`) — NOT the app's
`@/lib/supabase`. Helpers: `createTestUser()` via `auth.admin.createUser` returning
`{ userId, authedClient }`; `deleteTestUser(userId)`; `cleanupUserRows(userId)` deleting that
user's `practice_sessions` + `algorithm_mastery` rows (seed algorithms untouched); a known seeded
`algorithmId` constant. `afterEach` cleans the test user's rows; `afterAll` deletes the user.
Skip/guard with a clear message if env vars are absent so the suite fails loudly, not silently.

#### 3. Scripts + test env template

**File**: `package.json`, `.env.test.example` (and `.gitignore` for `.env.test`)

**Intent**: Add `test:integration` (and optional `test:integration:watch`) running the new
config; document required env vars without committing secrets.

**Contract**: `"test:integration": "vitest run --config vitest.config.integration.ts"`.
`.env.test.example` lists `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` with the
local-stack defaults from the README. Default `npm test` unchanged (still jsdom-only).

#### 4. Connectivity smoke spec

**File**: `src/test/integration/smoke.int.test.ts`

**Intent**: Prove the harness can reach the DB and the seeded algorithm exists before any
behavioral spec runs.

**Contract**: Service-role select of the known seeded `algorithmId` returns one row; a
throwaway user can be created and deleted. Pure connectivity, no behavior under test.

### Success Criteria:

#### Automated Verification:

- With a local stack up + `.env.test` set, smoke passes: `npm run test:integration`
- Default fast suite unaffected: `npm test`
- Linting passes: `npm run lint`

#### Manual Verification:

- `npx supabase start` → `npm run test:integration` runs the smoke spec green from a clean checkout
  following `.env.test.example`.
- Missing-env run fails with the explicit guard message, not a cryptic crash.

**Implementation Note**: Use `/10x-implement` (infra/setup, no red test first). After automated
verification passes, pause for manual confirmation.

---

## Phase 4: Persistence + streak integration tests (#1, #4)

### Overview

The behavioral core. Against the real local DB, prove #1 (a clean run persists rows that
survive a read-back, asserted independently of the response) and #4 (the persisted streak
follows PRD FR-013 across the real round-trip).

### Changes Required:

#### 1. Persistence read-back spec (#1)

**File**: `src/test/integration/persistence.int.test.ts`

**Intent**: Prove the write lands in the DB, not just that the call returns 200 — the explicit
challenge to "a 200 means the write landed."

**Contract**: Drive `completePractice(authedClient, testUser, input)` (or the route logic via
the seam) for a clean first run, then **read back via the service-role client**: exactly one
`practice_sessions` row with `is_clean=true`, `error_count=0`, matching `user_id`/`algorithm_id`;
exactly one `algorithm_mastery` row with `consecutive_clean=1`, `mastery_reached=false`. Assert
the persisted rows, never the returned body. A separate case: a bogus (non-seeded) `algorithmId`
→ result `400` AND no `practice_sessions` row persisted (real FK `23503`).

#### 2. Streak-through-DB spec (#4)

**File**: `src/test/integration/streak.int.test.ts`

**Intent**: Prove the *persisted* streak obeys FR-013 across real insert→read→upsert cycles —
the behavior a pure `computeStreak` test cannot see (defaults, the unique-key upsert, isolation).

**Contract**: Sequential `completePractice` calls for one `(user, algo)`, reading back
`algorithm_mastery` after each. Cases (oracle = FR-013, hand-written): clean → `consecutive_clean`
1, 2, 3 with `mastery_reached` flipping true at exactly 3 (and false at 2); a dirty run resets
`consecutive_clean` to 0 while `mastery_reached` stays true (sticky); a clean run on algo B does
not change algo A's row (per-`(user,algo)` isolation, two seeded algorithm ids). No concurrency.

### Success Criteria:

#### Automated Verification:

- With a local stack up, both specs pass: `npm run test:integration`
- Default fast suite unaffected: `npm test`
- Linting passes: `npm run lint`

#### Manual Verification:

- Reviewer confirms assertions read persisted rows (service-role read-back), not the response
  body, and that expected values trace to FR-013, not to `computeStreak`.
- Per-test cleanup leaves no residual rows for the test user between cases.

**Implementation Note**: TDD-suitable per case (e.g. "a clean first run persists one
practice_sessions row with is_clean=true"). After automated verification passes, pause for manual
confirmation.

---

## Phase 5: Cookbook + race documentation + test-plan sync

### Overview

Capture the reusable integration patterns, document the race honestly, and advance the rollout
state so the test-plan reflects shipped Phase 2.

### Changes Required:

#### 1. Cookbook §6.3 / §6.5

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the "TBD" in §6.3 (integration test) and §6.5 (new API endpoint test) with
the concrete pattern this phase established.

**Contract**: §6.3 — node-env config (`vitest.config.integration.ts`), `*.int.test.ts`,
`npm run test:integration` against a local Supabase, authed-user vs service-role client roles,
per-test row cleanup, seam-import pattern (why not the app's `astro:env`-bound client). §6.5 —
assert request→result AND the persisted side-effect via read-back; never trust the response body
or a client-submitted outcome; reference the seam.

#### 2. Race characterization note

**File**: `context/foundation/test-plan.md` (§6.6 phase note) + a comment near the upsert in
`src/lib/practice/completePractice.ts`

**Intent**: Record the race honestly so future readers don't "fix" it blindly or write a mirror
test: benign/corrective under double-submit, genuine undercount only for rare concurrent distinct
runs, `mastery_reached` monotonic; revisit with an atomic RPC only if multi-device accuracy
matters. Reference `context/archive/2026-05-28-practice-session-core-loop/`.

#### 3. Rollout status + phase note

**File**: `context/foundation/test-plan.md` (§3 table, §6.6), `context/changes/.../change.md`

**Intent**: Advance §3 Phase 2 Status to `complete`; add a §6.6 Phase 2 note (what shipped, the
seam refactor, the node-env integration config, the two-client strategy, race documented). Set
`change.md` status appropriately.

**Contract**: §3 Phase 2 row Status → `complete`; §6.6 gains a dated "Phase 2 — Persistence
integration" bullet. No strategy (§1–§5 risk map) edits — that is Lesson 1's domain.

### Success Criteria:

#### Automated Verification:

- Linting passes (if docs are linted) / no broken references: `npm run lint`
- Full default suite green: `npm test`

#### Manual Verification:

- §6.3/§6.5 read as actionable recipes a future contributor can follow.
- The race note is accurate and matches the archive acceptance.
- §3 Phase 2 status reflects reality.

**Implementation Note**: `/10x-implement` (documentation). After automated verification passes,
pause for manual confirmation.

---

## Testing Strategy

### Unit Tests (default `npm test`, jsdom):

- Seam error branches via stub client: mastery-read 500, upsert 500, insert `23503` → 400, happy
  path (oracle FR-013). No DB, no `astro:env`.
- Do NOT re-test pure `computeStreak` (Phase 1 owns it).

### Integration Tests (`npm run test:integration`, node, local Supabase):

- #1: clean run → service-role read-back asserts the `practice_sessions` + `algorithm_mastery`
  rows; bogus algorithmId → 400 + no row (real FK).
- #4: sequential clean increments (1→2→3, mastery at 3), dirty reset with sticky mastery,
  per-`(user,algo)` isolation. Oracle = FR-013.

### Manual Testing Steps:

1. `npx supabase start`; copy creds into `.env.test` per `.env.test.example`.
2. `npm test` — fast suite incl. hermetic branches green.
3. `npm run test:integration` — persistence + streak specs green; rerun to confirm cleanup
   leaves no residue.
4. In the running app, finish a clean run and a dirty run; confirm banner + persisted values
   unchanged from pre-refactor behavior.

## Performance Considerations

Integration suite is opt-in and local; not on the per-commit path. Per-test row cleanup
(targeted deletes) is cheaper and faster than `supabase db reset` and keeps seed data intact.

## Migration Notes

No data migration. Phase 1 is a behavior-neutral refactor; the only schema/runtime dependency is
that a local Supabase with the existing migration + seed is available for the integration suite.

## References

- Research: `context/changes/testing-persistence-integration/research.md`
- Write path: `src/pages/api/practice/complete.ts:51-120`
- Streak rule: `src/lib/practice/streak.ts:22-26`; Phase 1 tests `src/lib/practice/streak.test.ts`
- Client factory + blocker: `src/lib/supabase.ts:3`
- Schema/RLS/seed: `supabase/migrations/20260527000000_domain_schema_rls.sql`, `supabase/seed.sql`
- Race acceptance: `context/archive/2026-05-28-practice-session-core-loop/plan.md:50-54`,
  `.../reviews/impl-review.md:66-74`
- Phase 1 infra prior art: `context/archive/2026-06-02-testing-bootstrap-core-logic-units/`
- Oracle: `context/foundation/prd.md` FR-013

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Seam extraction (behavior-neutral refactor)

#### Automated

- [x] 1.1 Type checking + build passes: `npm run build` — 096879e
- [x] 1.2 Linting passes: `npm run lint` — 096879e
- [x] 1.3 Existing unit/component suite still green: `npm test` — 096879e

#### Manual

- [x] 1.4 Clean + dirty completion via the running app behave exactly as before — 096879e

### Phase 2: Hermetic error-branch tests

#### Automated

- [x] 2.1 New seam spec passes: `npm test`
- [x] 2.2 Linting passes: `npm run lint`

#### Manual

- [x] 2.3 Reviewer confirms each case asserts the seam result/log, not a mirror

### Phase 3: Integration harness (node config + helpers)

#### Automated

- [ ] 3.1 Smoke passes with local stack + `.env.test`: `npm run test:integration`
- [ ] 3.2 Default fast suite unaffected: `npm test`
- [ ] 3.3 Linting passes: `npm run lint`

#### Manual

- [ ] 3.4 Clean-checkout run via `.env.test.example` runs smoke green
- [ ] 3.5 Missing-env run fails with the explicit guard message

### Phase 4: Persistence + streak integration tests (#1, #4)

#### Automated

- [ ] 4.1 Persistence + streak specs pass: `npm run test:integration`
- [ ] 4.2 Default fast suite unaffected: `npm test`
- [ ] 4.3 Linting passes: `npm run lint`

#### Manual

- [ ] 4.4 Reviewer confirms read-back assertions (not response body) and FR-013 oracle
- [ ] 4.5 Per-test cleanup leaves no residual rows

### Phase 5: Cookbook + race documentation + test-plan sync

#### Automated

- [ ] 5.1 No broken references / lint passes: `npm run lint`
- [ ] 5.2 Full default suite green: `npm test`

#### Manual

- [ ] 5.3 §6.3/§6.5 read as actionable recipes
- [ ] 5.4 Race note matches the archive acceptance
- [ ] 5.5 §3 Phase 2 status reflects reality

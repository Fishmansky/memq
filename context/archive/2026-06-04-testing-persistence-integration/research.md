---
date: 2026-06-04T14:07:26+02:00
researcher: pawel.rybczynski@redge.media
git_commit: bda1176f9d7803b2450f5cd4f414d3fc6613355b
branch: master
repository: memq
topic: "Persistence integration oracle for finished-session result (#1) and streak count (#4)"
tags: [research, codebase, persistence, streak, integration-test, supabase, rls, race]
status: complete
last_updated: 2026-06-04
last_updated_by: pawel.rybczynski@redge.media
---

# Research: Persistence integration oracle — finished-session result (#1) + streak count (#4)

**Date**: 2026-06-04T14:07:26+02:00
**Researcher**: pawel.rybczynski@redge.media
**Git Commit**: bda1176f9d7803b2450f5cd4f414d3fc6613355b
**Branch**: master
**Repository**: memq

## Research Question

Rollout Phase 2 of `context/foundation/test-plan.md` — "Persistence integration". Ground the
oracle (what the code *should* do, from sources, not from the implementation) for two risks
before any test is written:

- **#1 — Finished session result fails to persist.** A clean run completes but progress/streak
  is not written, and the result is lost on reload. Must challenge "a 200 response means the
  write landed"; assert the persisted row, not the response body.
- **#4 — Streak miscounts.** Wrong consecutive-clean count, off-by-one PRO trigger, or a
  lost-update race drops a clean run. Must challenge "final status 200 means the count is
  right"; do **not** take the oracle from `computeStreak` (tautology); do **not** ignore the
  documented fetch-then-compute-then-upsert race.

## Summary

The entire write path for both risks lives in a single endpoint:
`src/pages/api/practice/complete.ts` (`POST /api/practice/complete`). It is **non-atomic**:

1. `Promise.all([` insert into `practice_sessions`, select current `algorithm_mastery` row `])`
2. `computeStreak(currentClean, alreadyMastered, isClean)` (pure, already unit-tested in Phase 1)
3. `upsert algorithm_mastery` on conflict `(user_id, algorithm_id)`
4. respond `{ consecutiveClean, masteryReached }` with `200`.

Two writes, no transaction. This shape drives both risks and the test layering:

- **#1 oracle**: a clean POST must leave a row in `practice_sessions` AND a correct
  `algorithm_mastery` row that survive independent of the response body. The response is
  computed in memory (steps 2–4 return the *intended* values even if a later read would
  disagree) — so the only honest proof is a fresh DB read-back.
- **#4 oracle**: comes from **PRD FR-013** ("3 consecutive mistake-free sessions for the same
  algorithm", per-algorithm, persisted) — NOT from `computeStreak`. The integration phase must
  prove the *persisted* count behaves per the PRD across a real insert→read→upsert round-trip,
  and must explicitly exercise (not paper over) the documented lost-update race.

**Central infra constraint (blocker for naive approaches):** `src/lib/supabase.ts` imports
`SUPABASE_URL, SUPABASE_KEY` from `astro:env/server` (line 3). The endpoint imports that
factory. `astro:env/server` is a build/SSR-only virtual module — it does **not** resolve under
plain Vitest/node. Therefore neither `complete.ts` nor `@/lib/supabase` can be imported in a
node test as-is. An integration test must either (a) drive the endpoint over HTTP against a
running Astro server, or (b) the plan introduces a node-importable seam. This is a plan
decision, captured in Open Questions.

## Detailed Findings

### The write path (#1 + #4 both originate here)

`src/pages/api/practice/complete.ts`:

- **Auth gate** — `complete.ts:6-12`: 401 if `context.locals.user` is null.
- **Body validation** — `complete.ts:24-35`: requires `algorithmId: string`, `isClean: boolean`,
  `errorCount: number`; else `400 "Invalid body"`. Note the endpoint **trusts the
  client-submitted `isClean`/`errorCount`** — that forged-outcome surface is deliberately
  *out of scope* (test-plan §7, negative space).
- **Non-atomic dual write** — `complete.ts:51-64`:
  ```ts
  const [sessionResult, masteryResult] = await Promise.all([
    supabase.from("practice_sessions").insert({ user_id, algorithm_id, is_clean, error_count }),
    supabase.from("algorithm_mastery").select("consecutive_clean, mastery_reached")
      .eq("user_id", user.id).eq("algorithm_id", algorithmId).maybeSingle(),
  ]);
  ```
- **FK-violation branch** — `complete.ts:66-79`: a Postgres `23503` (FK violation) on the
  session insert → `400 "Invalid algorithmId"` (client error). Any other insert error →
  `500 "Failed to record session"`. A mastery *read* error → `500`.
- **Compute** — `complete.ts:89-91`: `currentClean = data?.consecutive_clean ?? 0`,
  `alreadyMastered = data?.mastery_reached ?? false`, then `computeStreak(...)`.
- **Upsert** — `complete.ts:93-101`: `onConflict: "user_id,algorithm_id"`; on error → `500`.
- **Response** — `complete.ts:111-120`: `{ consecutiveClean, masteryReached }`, `200`.

The lost-update race lives between the `select` (step 1) and the `upsert` (step 3): two
concurrent completions can both read `N` and both write `N+1`.

### Table schema (oracle for the persisted rows — #1)

`supabase/migrations/20260527000000_domain_schema_rls.sql`:

**`practice_sessions`** (append-only; no UPDATE policy by design):
- `id uuid PK DEFAULT gen_random_uuid()`
- `user_id uuid NOT NULL` → FK `auth.users(id) ON DELETE CASCADE`
- `algorithm_id uuid NOT NULL` → FK `public.algorithms(id) ON DELETE CASCADE`
- `is_clean boolean NOT NULL`
- `error_count integer NOT NULL DEFAULT 0`
- `completed_at timestamptz NOT NULL DEFAULT now()`
- index `practice_sessions_user_algorithm_idx (user_id, algorithm_id)`

**`algorithm_mastery`**:
- `id uuid PK DEFAULT gen_random_uuid()`
- `user_id uuid NOT NULL` → FK `auth.users(id)`
- `algorithm_id uuid NOT NULL` → FK `public.algorithms(id)`
- `consecutive_clean integer NOT NULL DEFAULT 0`
- `mastery_reached boolean NOT NULL DEFAULT false`
- `updated_at timestamptz NOT NULL DEFAULT now()`
- **`algorithm_mastery_user_algorithm_unique UNIQUE (user_id, algorithm_id)`** — matches the
  upsert `onConflict` key. Confirmed present.

So a clean first session for `(user, algo)` must produce: exactly one `practice_sessions` row
with `is_clean=true, error_count=0`, and exactly one `algorithm_mastery` row with
`consecutive_clean=1, mastery_reached=false`.

### RLS — affects how a test authenticates (#1, #4, and forward to #3)

Both tables have RLS enabled. All policies key off `auth.uid() = user_id`:
- `practice_sessions`: `ps_select` (SELECT), `ps_insert` (INSERT WITH CHECK). No UPDATE/DELETE.
- `algorithm_mastery`: `am_select`, `am_insert`, `am_update` (USING + WITH CHECK).

Consequence: a user-scoped client only sees/writes its own rows. An integration test reading a
row back as the same user works under RLS; a test that wants to set up fixtures or read across
users needs the **service-role key** (no service-role variant exists in `src/lib/supabase.ts` —
the plan must construct one). There is no `service_role` factory today.

### FK target / seed data (fixtures for #1, #4)

`algorithm_id` → `public.algorithms(id)`. Seed files provide fixed UUIDs the test can reuse
without inserting algorithms:
- `supabase/seed.sql` — 3 system lists (F2L/OLL/PLL) + 119 algorithms, fixed UUIDs.
- `supabase/algos_seed.sql` — PLL two-look list `00000000-0000-0000-0000-000000000001` + 8 algos.

A test still needs a real `auth.users` row (the FK + RLS demand a real user id + JWT).

### Streak rule oracle (#4) — from the PRD, not the function

`context/foundation/prd.md` **FR-013** (the oracle — quote):
> Learner sees "You're PRO!" and is offered a new session after **3 consecutive mistake-free
> sessions for the same algorithm**. … threshold is 3 consecutive mistake-free sessions for the
> same algorithm. Streak counter is tracked per-algorithm and persisted.

US-01 reinforces: "clean → streak counter updated, 'You're PRO!' shown only on 3rd consecutive
clean run for this algorithm."

Derived oracle (independent of `computeStreak`):
- clean run → persisted `consecutive_clean` increments by 1;
- any non-clean run → persisted `consecutive_clean` resets to 0;
- `mastery_reached` becomes true at exactly the 3rd consecutive clean run (off-by-one boundary:
  2 ⇒ not PRO, 3 ⇒ PRO);
- `mastery_reached` is **sticky/monotonic** — once true it never reverts, even when a later
  dirty run resets `consecutive_clean` to 0;
- the count is **per `(user, algorithm)`** — a clean run on algo A must not move algo B's count.

`computeStreak` (`src/lib/practice/streak.ts:22-26`) implements exactly this, but it is the code
under test — using its output as the expected value would be a tautology / mirror test.

### What Phase 1 already covers (do NOT duplicate)

`src/lib/practice/streak.test.ts` is table-driven, oracle = an explicit `cases` array (not the
function). It already proves the pure rule: increment, reset, the 2-vs-3 PRO boundary, and
mastery stickiness across a dirty run. **The integration phase must not re-assert pure logic.**
Its distinct job: prove the rule holds *through the real DB round-trip* (the select→compute→upsert
path, defaults, the unique constraint, per-algorithm isolation) and *characterize the race* —
things a pure unit test structurally cannot see.

### The documented fetch-then-compute-then-upsert race (#4 — must not be ignored)

`context/archive/2026-05-28-practice-session-core-loop/plan.md:50-54` (verbatim):
> **Accepted race (impl-review F4):** The read→compute→upsert sequence has a lost-update window
> — two concurrent completions for the same `(user, algorithm)` can both read `N` and write
> `N+1`, undercounting the streak by one. `mastery_reached` is monotonic so it never regresses.
> Accepted for the single-user, low-concurrency usage profile (the only realistic trigger is a
> fast double-submit / retry). Revisit with an atomic Postgres RPC if streak accuracy under
> concurrency ever matters.

`context/archive/2026-05-28-practice-session-core-loop/reviews/impl-review.md:66-74` (F4):
> Severity OBSERVATION; Impact MEDIUM. … Two concurrent completions for same (user, algorithm)
> can both read N and write N+1, losing one increment. mastery_reached is monotonic so won't
> regress; only streak count undercounts. Blast radius small (single-user double-submit /
> retry). Decision: ACCEPTED — documented; no code change.

**Test implication.** The race is *accepted behavior*, not a bug to "fix" with a test. The
honest integration test fires two concurrent clean completions for the same `(user, algo)` and
asserts the **documented** outcome: the persisted `consecutive_clean` can be `1` (lost update)
rather than `2`. The test pins the *known* window and references the acceptance, so a future
atomic-RPC fix flips a clearly-labeled assertion rather than silently changing meaning. It must
also assert `mastery_reached` never regresses. Do **not** write a test that assumes atomicity
and asserts `2`; that would mirror an expectation the system explicitly does not guarantee.

### PRO banner — where mastery becomes observable

`src/components/app/PracticeSession.tsx:305`:
`const isPro = result !== null && (result.masteryReached || result.consecutiveClean >= 3);`
Banner "You're PRO! 🏆" renders on that condition (lines 335-338). This is the post-response,
client-side surface; it reads only the API response, never the DB directly. No server-rendered
page reads `algorithm_mastery` — the only DB reader/writer of streak state is `complete.ts`
(grep confirmed). So "survives a reload" (#1) is about the *DB row*, which a subsequent
`/complete` read or a direct DB read-back observes — not about any SSR page.

### Test infrastructure today (and the blocker)

- `vitest.config.ts`: single config, `environment: "jsdom"`, `globals: true`,
  `setupFiles: ["./src/test/setup.ts"]`, `include: ["src/**/*.test.{ts,tsx}"]`, `@ → ./src`.
  **No node-environment project.**
- `src/test/setup.ts`: only registers jest-dom matchers. No app/Supabase/astro:env imports.
- Scripts: `test: "vitest run"`, `test:watch: "vitest"`.
- Deps: `vitest@^4.1.8`, `@supabase/supabase-js@^2.99.1` (direct), testing-library set, `jsdom`,
  `supabase@^2.23.4` (CLI).
- Local stack: `supabase/config.toml` + `supabase/seed.sql` present; developer runs
  `npx supabase start` (Docker, ~7 GB) → `SUPABASE_URL=http://127.0.0.1:54321` + anon key; no
  npm script wraps it.
- **Blocker (confirmed):** `src/lib/supabase.ts:3` `import { SUPABASE_URL, SUPABASE_KEY } from
  "astro:env/server"`. Virtual module, unresolved under node/Vitest. Importing `complete.ts` or
  `@/lib/supabase` in a plain test fails. Phase 1 avoided this by importing only pure modules
  and stubbing `fetch` in component tests (test-plan §6.2).

## Code References

- `src/pages/api/practice/complete.ts:51-64` — non-atomic Promise.all (session insert + mastery read)
- `src/pages/api/practice/complete.ts:66-79` — FK `23503` → 400; other insert error → 500
- `src/pages/api/practice/complete.ts:89-101` — compute + upsert (race window is here)
- `src/pages/api/practice/complete.ts:111-120` — in-memory response (the thing #1 must NOT trust)
- `src/lib/practice/streak.ts:22-26` — `computeStreak` (code under test; not the oracle)
- `src/lib/practice/streak.test.ts` — Phase 1 pure-rule coverage (do not duplicate)
- `src/lib/supabase.ts:3` — `astro:env/server` import (the node-import blocker)
- `src/lib/supabase.ts:6` — `createClient(requestHeaders, cookies)` signature
- `src/middleware.ts:6-16` — sets `context.locals.user` via `supabase.auth.getUser()` (JWT in Cookie)
- `supabase/migrations/20260527000000_domain_schema_rls.sql` — schema, unique constraint, RLS policies
- `supabase/seed.sql`, `supabase/algos_seed.sql` — fixed algorithm UUIDs for fixtures
- `src/components/app/PracticeSession.tsx:305` — `isPro` derivation (response-only, not DB)
- `vitest.config.ts` — single jsdom config, no node project

## Architecture Insights

- **Persistence is one endpoint.** All of #1 and #4 funnel through `complete.ts`. No CQRS, no
  background job, no SSR read of streak. The test surface is narrow and well-defined.
- **Response ≠ persistence by construction.** The 200 body is the *computed intent*; the DB row
  is the *fact*. The two diverge exactly when a write silently fails or the race drops an
  update — which is why #1/#4 guidance forbids asserting the body.
- **Non-atomic by accepted decision.** The dual write + read-modify-write upsert is a known,
  documented tradeoff. Tests pin behavior, they don't relitigate the design (that's Lesson 5 /
  a future atomic-RPC change).
- **astro:env is the seam problem.** Every realistic integration approach has to get around the
  fact that the production write path is welded to `astro:env/server`. Either go over HTTP
  (exercise the real endpoint, real middleware, real RLS) or introduce a node-importable handler
  seam. Cost × signal will decide in the plan.
- **Two-layer guidance (CLAUDE.md) applies cleanly:** real-DB integration for the
  insert/read-back/upsert/constraint behavior; the partial-failure branches (mastery-read 500,
  upsert 500) are candidates for **hermetic stub** tests — a stub client can force "second
  operation fails" which a real DB will not reproduce on demand. The race itself needs real
  concurrency against a real DB (a stub cannot model two transactions interleaving).

## Historical Context (from prior changes)

- `context/archive/2026-05-28-practice-session-core-loop/plan.md:50-54` — race accepted, verbatim above.
- `context/archive/2026-05-28-practice-session-core-loop/reviews/impl-review.md:66-74` — F4 OBSERVATION, ACCEPTED.
- `context/archive/2026-06-02-testing-bootstrap-core-logic-units/` — Phase 1 bootstrap:
  - vitest.config kept independent of `astro.config.mjs` so the Cloudflare/SSR adapter never
    enters the test graph; Phase 1 imports only pure modules so no `astro:env`/Supabase in graph.
  - research.md cheapest-layer verdict: "#4 lost-update race | integration (concurrent + DB) |
    Phase 2, not this phase" — Phase 2 is explicitly the real-DB phase.
  - research.md Open Questions explicitly **deferred** the test-env strategy for anything that
    transitively imports the Supabase client / `astro:env` ("mock vs seeded `.env.test`") to
    plan time — i.e. now.
- `context/foundation/lessons.md` — "Run independent Supabase queries concurrently with
  Promise.all": the endpoint already follows this for the insert+select pair; relevant only as a
  reminder that the parallelism is intentional, not the source of the race (the race is the
  later read-modify-write upsert, not the Promise.all).

## Related Research

- `context/archive/2026-06-02-testing-bootstrap-core-logic-units/research.md` — runner bootstrap, pure-layer inventory.
- `context/archive/2026-05-28-practice-session-core-loop/research.md` — original practice-loop persistence design.

## Open Questions

These are **solution-design** choices for `/10x-plan`, not unresolved oracle questions:

1. **How to exercise the endpoint given the `astro:env` blocker.** Options:
   (a) drive `POST /api/practice/complete` over HTTP against a running dev/preview Astro server
   (exercises real middleware + RLS + the actual handler — highest fidelity, heaviest setup);
   (b) introduce a node-importable seam (extract the handler body to a function taking an injected
   supabase client, or a thin `astro:env` shim/alias in the node vitest project) so the write
   path runs in-process against a real DB client built from `process.env`. Cost × signal call.
2. **Vitest topology.** Add a separate node-environment project/config for integration
   (`*.int.test.ts`) alongside the jsdom unit project, or a single config with per-file env. The
   integration suite must not run in CI-by-default if local Supabase is required (test-plan §4
   marks the integration gate as potentially ad hoc).
3. **Client / RLS strategy in tests.** Build a service-role client (none exists today) for
   fixture setup/teardown and cross-checking rows, and an authenticated user client (real
   `auth.users` + JWT) to exercise the RLS-governed path the endpoint actually uses. Decide
   whether to create a throwaway test user per run or reuse a seeded one.
4. **DB lifecycle / isolation between tests.** Per-test cleanup of `practice_sessions` /
   `algorithm_mastery` for the test user vs `supabase db reset`; how to keep the seeded algorithm
   rows intact while resetting user progress.
5. **How to assert the race deterministically enough.** Two concurrent `fetch`/inserts will be
   timing-dependent; decide whether to assert the *documented possible* outcome (count ∈ {1,2},
   `mastery_reached` never regresses) or to force the interleaving via two clients sharing a read
   snapshot. Pin to the accepted behavior, label the assertion so a future atomic fix flips it.

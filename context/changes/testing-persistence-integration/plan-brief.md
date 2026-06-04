# Persistence Integration Tests (#1, #4) — Plan Brief

> Full plan: `context/changes/testing-persistence-integration/plan.md`
> Research: `context/changes/testing-persistence-integration/research.md`

## What & Why

Rollout Phase 2 of the test plan: prove that a finished practice session actually persists
(**#1** — assert the persisted row, not the 200 body) and that the streak behaves per PRD FR-013
through the real DB round-trip (**#4** — increment / reset / mastery-at-3 / sticky / per-algorithm).
The 200 response is computed in memory and can lie about whether the write landed; only a DB
read-back is honest proof.

## Starting Point

All persistence funnels through one non-atomic endpoint, `src/pages/api/practice/complete.ts`
(insert session + read mastery → `computeStreak` → upsert mastery). Phase 1 stood up a
jsdom-only Vitest runner and unit-tested the pure `computeStreak`. No integration tests exist,
and `src/lib/supabase.ts` imports `astro:env/server`, so the endpoint can't be imported under
plain node today.

## Desired End State

A node-importable `completePractice(supabase, user, body)` seam holds the real write logic; the
route is a thin wrapper with unchanged behavior. `npm test` also runs hermetic stub tests of the
500 branches. A new opt-in `npm run test:integration` (node env, local Supabase) proves #1 via
read-back and #4 via sequential streak cycles. Cookbook §6.3/§6.5 filled, the race documented,
§3 Phase 2 marked complete.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Oracle for #4 | PRD FR-013, hand-written | Using `computeStreak` as the expected value is a tautology | Research |
| Endpoint exercise | Extract node-importable seam | Runs the real write path + read-back without astro:env or booting Astro | Plan |
| Vitest topology | Separate node config + `test:integration` | Keeps the fast suite clean; integration stays opt-in per §4 | Plan |
| Client strategy | Authed-user (RLS) + service-role for setup | Write path RLS-governed like prod; service-role for reliable cleanup/read-back | Plan |
| The race | Document only, no concurrent test | Benign/corrective under double-submit; true undercount only for rare concurrent distinct runs | Plan |
| Error branches | Hermetic stub tests for the 500s | Real DB can't trigger mid-sequence failures on demand (CLAUDE.md two-layer) | Plan |
| Test user | Throwaway per run via admin API | Hermetic, satisfies FK + RLS with a real auth.users row | Plan |
| CI posture | Ad hoc / local-only this phase | CI wiring is Phase 4 / lesson boundary | Plan |

## Scope

**In scope:** seam refactor; hermetic 500-branch tests; node integration harness; #1 read-back +
FK-400 tests; #4 streak-through-DB tests; cookbook + race doc + rollout sync.

**Out of scope:** concurrent/race test; duplicate-session-row (idempotency); HTTP/middleware/auth-flow
tests; cross-user RLS (Phase 3); CI wiring (Phase 4); any streak-rule or response-shape change;
new pure `computeStreak` tests.

## Architecture / Approach

Refactor the endpoint body into `completePractice` (injected client, no `astro:env`) so a real-DB
test drives the actual insert→read→compute→upsert sequence. Layer by cost × signal: stub client
for partial-failure branches a real DB won't reproduce; real local Supabase for the round-trip a
stub would lie about (constraints, defaults, unique-key upsert, per-row isolation). Authed-user
client for the RLS-governed write; service-role client for setup/teardown/read-back. Integration
specs live in their own node-env config, out of the default fast suite.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Seam extraction | `completePractice` seam + thin route | Refactor must be byte-for-byte behavior-neutral |
| 2. Hermetic error tests | Stub-driven 500/400 branch coverage | Stub must match supabase-js result shape |
| 3. Integration harness | Node config, clients, fixtures, smoke | Local Supabase availability + env wiring |
| 4. #1 + #4 integration tests | Read-back persistence + streak-through-DB | Asserting rows (not body); oracle from FR-013 |
| 5. Cookbook + race doc + sync | §6.3/§6.5 filled, race documented, §3 status | Honest race characterization, no strategy edits |

**Prerequisites:** local Supabase stack (`npx supabase start`) with the existing migration + seed;
`.env.test` with `SUPABASE_URL`, anon `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
**Estimated effort:** ~2–3 sessions across 5 phases.

## Open Risks & Assumptions

- Integration suite needs a local Supabase; it is intentionally not on the per-commit path this
  phase (enforcement deferred to Phase 4).
- The seam refactor must preserve every status code, JSON body, and log line.
- `SUPABASE_SERVICE_ROLE_KEY` enters the test env (local only; never committed).

## Success Criteria (Summary)

- A clean run leaves persisted `practice_sessions` + `algorithm_mastery` rows that a read-back
  confirms — independent of the 200 body.
- The persisted streak increments on clean, resets on dirty, flips mastery at exactly 3 (sticky),
  and stays per-`(user, algorithm)` — matching FR-013.
- The 500 error branches and the FK-400 branch are covered; the race is documented, not mistested.

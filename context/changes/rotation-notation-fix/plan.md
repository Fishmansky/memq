# Rotation Notation Fix Implementation Plan

## Overview

Seven seeded algorithms (`OLL 22`, `OLL 28`, `OLL 50`, `OLL 54`, `E-perm`,
`Ga-perm`, `Gc-perm`) contain the token `R2'`/`U2'` — a double turn with a
trailing prime. This notation is not standard cube notation and is outside
the set of tokens the app's input system (`dispatchMove` in
`PracticeSession.tsx`) can ever produce. Practicing any of these algorithms
sticks forever on that move: no error, no crash, `currentIndex` never
advances, the session never reaches `"submitting"`.

This plan closes the bug on three legs — (1) correct the source file, (2)
correct the already-seeded live database (the source file has no re-apply
pipeline — a corrective statement is the only way the fix reaches
production), (3) add a regression guard over real seed content — and proves
the fix with a genuine red→green cycle: an E2E spec is written and confirmed
failing *before* either fix lands (the live DB is broken today, independent
of any local edit), then re-run to confirm it passes once the DB is
corrected.

## Current State Analysis

- `supabase/algos_seed.sql` stores `R2'`/`U2'` in 8 places across 7 rows
  (`R2'` ×2 in OLL 22, ×1 each in OLL 50, E-perm, Ga-perm, Gc-perm; `U2'` ×1
  each in OLL 28, OLL 54). SQL-escaped as `R2''`/`U2''` in the file — this is
  correct escaping of one literal `'`, not a parsing artifact. Confirmed
  directly against the DB for OLL 22.
- `dispatchMove` (`src/components/app/PracticeSession.tsx:291-296`) builds a
  token as `base`, `base + "2"`, `lower(base)`, or `lower(base) + "2"` —
  always appending `"2"` last. No path produces `"2"` followed by `"'"`.
- `parseMoves` (`PracticeSession.tsx:216-218`) splits an algorithm's `moves`
  string on spaces (after stripping parens) into exact tokens; the reducer's
  `INPUT_MOVE` case does `action.move === expected` (`PracticeSession.tsx:149`).
  A token outside the producible set can never satisfy that equality, so its
  slot in `slotResults` never turns `"correct"`.
- `algos_seed.sql` is **not** in the auto-seed path — `supabase/config.toml`
  `[db.seed] sql_paths = ["./seed.sql"]` only lists `seed.sql`. Per
  `context/foundation/roadmap.md:141`, `algos_seed.sql` "has already been
  supplied to production database" — a one-time manual apply, no pipeline
  ever re-runs it. Playwright E2E (`playwright.config.ts`) authenticates
  against that same remote Supabase project, so e2e specs hit the live,
  currently-broken rows today — right now, before this plan touches
  anything. That is what makes a genuine red-first E2E spec possible: no
  deliberate breakage is needed, the bug is already live.
- `algos_seed.sql` carries an explicit warning: no unique constraint on
  `algorithms`, so re-running the whole file against a live DB duplicates
  rows. Any live-DB fix must be a scoped statement, not a file re-apply.
- The app's input grammar (`dispatchMove`) does not change in this plan —
  only data does — so an E2E spec written against today's code and today's
  broken data is valid evidence of the bug, not a symptom of unrelated
  in-flight code changes.
- `PracticeSession.parity.test.ts` already derives the full
  keyboard-producible token set (base ∪ base-lowercased, via `KEY_TO_MOVE`)
  and cross-checks it against the grid-emittable set. It does not currently
  include the doubled (`+"2"`) forms, and it never touches real seed content
  — both are needed for the regression guard.
- No test currently exercises real `algos_seed.sql`/`seed.sql` content: the
  reducer/parity/component tests use synthetic tokens (`"R"`, `"U"`, `"R'"`);
  `playwright/test/seed.spec.ts` deliberately uses a benign 3-move F2L
  algorithm. `.github/workflows/ci.yml` runs only `lint` + `build` — no test
  step exists at all, so even an existing vitest suite wouldn't have caught
  this today.
- `vitest` is a real, configured, scripted test runner (`npm test`,
  `npm run test:integration`) despite `AGENTS.md:10` stating "No test runner
  is configured." That line is stale relative to the repo as it stands. This
  plan does not correct it (out of scope — flagged only).
- No repo precedent exists for correcting already-inserted data in a live
  Supabase project. `supabase/migrations/` holds one file, pure DDL. The only
  documented write path to the linked remote project is the Supabase Studio
  SQL Editor, run by hand.

## Desired End State

- A Playwright spec that reproducibly failed against the live, unfixed data
  now passes against the same live project, unchanged, after the DB
  corrective lands — direct red→green proof, not reasoning-based inference.
- `supabase/algos_seed.sql` uses only standard notation: `R2`/`U2` (no
  trailing prime) in all 7 previously-affected rows.
- The live (remote) Supabase project's `algorithms` table has the same 7 rows
  corrected — confirmed by a read-back `SELECT` and by the E2E spec turning
  green.
- A vitest test parses every seed file's `moves` literals, unescapes them,
  and fails if any token falls outside the app's producible-token set. A
  future scrape that reintroduces an unreachable token fails this test
  before it ships.

### Key Discoveries:

- `src/components/app/PracticeSession.tsx:291-296` (`dispatchMove`) — the
  producible-token grammar the regression guard must mirror.
- `src/components/app/PracticeSession.parity.test.ts` — existing derivation
  pattern for "everything the keyboard/grid can produce"; extend rather than
  duplicate.
- `supabase/algos_seed.sql:1-6` — explicit no-duplicate-run warning; live-DB
  fix must be a targeted `UPDATE`, never a file re-apply.
- `supabase/config.toml:60-65` — `algos_seed.sql` is outside the auto-seed
  path; editing it alone never reaches any running database.
- `playwright.config.ts:1-7` — E2E auth targets the real remote Supabase
  project, which is broken *today* — the precondition that makes a red-first
  E2E spec meaningful rather than contrived.

## What We're NOT Doing

- Not loosening the input grammar to accept `2'` — every other seed row uses
  standard notation; the data was wrong, not the grammar (frame's
  Hypothesis Investigation: dimension 2, verdict NONE).
- Not wiring the new regression test (or any test) into `ci.yml`. It runs via
  `npm test` like the existing suite; CI-wiring is a separate, cross-cutting
  concern.
- Not correcting the stale `AGENTS.md:10` "no test runner configured" line —
  flagged, not this change's job.
- Not building a general data-migration pipeline/tool for future prod data
  fixes — this is a one-off corrective statement, run by hand once.
- Not adding a live-DB integration test for the regression guard — the static
  file check plus the one-time corrective statement in Phase 3 covers the
  known drift; an ongoing integration check would mostly duplicate the static
  test's logic for a scenario this change already closes.

## Implementation Approach

Capture the bug as a failing, automated E2E assertion *first* (Phase 1) —
the live project is broken independent of any local file edit, so this is a
true pre-fix red, not a staged one. Only then fix the source file (Phase 2,
mechanical, does not by itself affect the live E2E target) and repair the
live data (Phase 3, the step that actually turns Phase 1's spec green — its
automated verification re-runs that exact spec). Phase 4 (the static
regression guard) is independent of the other three and can land in any
order relative to them; it is sequenced last only because it protects the
*future*, not this incident. Phases 1 and 3's E2E steps are driven via
`/10x-e2e`; Phases 2, 3's SQL authoring, and 4 are driven via
`/10x-implement`, per this repo's plan/E2E workflow split — both tools share
this same plan and Progress section.

## Phase 1: E2E regression spec — capture red

### Overview

Author a Playwright spec that drives a previously-stuck algorithm to
completion, and confirm it currently fails against the live project — for
the *right* reason (the session stalls on the bad move), not an unrelated
error.

### Changes Required:

#### 1. E2E regression spec

**File**: `playwright/test/rotation-notation-fix.spec.ts` (new)

**Intent**: Drive `OLL 28` (the shortest of the 7 affected algorithms: `M' U'
M U2' M' U' M`, 7 tokens, single previously-broken slot) through a full clean
run to the completion banner, modeled on `playwright/test/seed.spec.ts`'s
locator, self-contained-cycle, and wait-for-state patterns. Written and run
*before* Phase 2 or 3 touch anything, against the live project's current
(broken) data.

**Contract**: Reach the algorithm via its set page
(`/sets/00000000-0000-0000-0000-000000000003`, the OLL list) and its row
link, start practice, then click move buttons in order — `M'`, `U'`, `M`,
then toggle the `X2` double-modifier button before clicking `U'` (dispatches
`U2`), then `M'`, `U'`, `M` — asserting `Consecutive clean: \d+\.` appears at
the end. Per `E2E_RULES.md`, use `exact: true` on every move-button locator
(`M`/`M'` collide by substring) and assert the banner text, not intermediate
state.

### Success Criteria:

#### Automated Verification:

- Spec run confirms failure today: `npx playwright test
  rotation-notation-fix.spec.ts` exits non-zero

#### Manual Verification:

- The failure is the *right* one — the run stalls at the `U2` step (the
  double-modifier click never advances `currentIndex`), not a page-not-found,
  locator-not-found, or auth error. Confirm from the test's trace/screenshot
  before treating this as valid red.

---

## Phase 2: Fix seed source file

### Overview

Remove the invalid trailing prime after every `2` in the 7 affected rows of
`supabase/algos_seed.sql`.

### Changes Required:

#### 1. Seed source tokens

**File**: `supabase/algos_seed.sql`

**Intent**: Replace every occurrence of the invalid `R2'`/`U2'` token (written
in-file as `R2''`/`U2''`) with the standard `R2`/`U2`. No other content on
these lines changes.

**Contract**: Exactly 8 occurrences across 7 rows (line 93: `R2''` ×2; line
99: `U2''`; line 121: `R2''`; line 125: `U2''`; line 140: `R2''`; line 143:
`R2''`; line 145: `R2''`). After the edit, `grep -c "2''" supabase/algos_seed.sql`
must return `0`.

### Success Criteria:

#### Automated Verification:

- `grep -c "2''" supabase/algos_seed.sql` returns `0`
- Linting passes: `npm run lint`

#### Manual Verification:

- Diff review confirms only the 8 targeted tokens changed, nothing else on
  those 7 lines

---

## Phase 3: Corrective SQL for the live database — confirm green

### Overview

The already-seeded live (remote) Supabase project still has the 7 bad rows —
Phase 2 alone never reaches it. Produce and run a targeted, non-duplicating
corrective statement, then re-run Phase 1's spec to prove it now passes.

### Changes Required:

#### 1. Corrective SQL script

**File**: `supabase/fixes/2026-08-24-rotation-notation.sql` (new)

**Intent**: A committed, reviewable record of the exact statement run against
the live project — this repo has no data-migration convention, so this file
is both the fix and its own audit trail.

**Contract**: Seven explicit `UPDATE public.algorithms SET moves = '<corrected
moves>' WHERE name = '<algorithm name>';` statements, one per affected row
(`OLL 22`, `OLL 28`, `OLL 50`, `OLL 54`, `E-perm`, `Ga-perm`, `Gc-perm`), each
using the exact corrected `moves` string now in `algos_seed.sql`. A one-time
header comment marks the file as manual-run only (not part of `sql_paths`,
not picked up by `db reset`). No `DELETE`/`INSERT` — the row identity (id,
position) must not change, only the `moves` value.

#### 2. Manual execution step

**Intent**: Run the file's 7 `UPDATE` statements against the live project via
the Supabase Studio SQL Editor (the only documented write path to that
project — see `context/changes/domain-schema-rls/plan.md:347,360`).

**Contract**: No code change — a documented one-time manual action, recorded
as a Manual Verification item below.

### Success Criteria:

#### Automated Verification:

- `grep -c "2''" supabase/fixes/2026-08-24-rotation-notation.sql` returns `0`
  (the corrective values themselves must not reintroduce the bug)
- Phase 1's spec now passes, unchanged: `npx playwright test
  rotation-notation-fix.spec.ts` — this is the red→green confirmation

#### Manual Verification:

- The 7 `UPDATE` statements executed against the live Supabase project via
  Studio SQL Editor
- Read-back `SELECT name, moves FROM public.algorithms WHERE name IN (...)`
  confirms all 7 rows now show the corrected `moves` value, no `2'` substring
  remaining
- Row count for `public.algorithms` unchanged before/after (confirms no
  duplication)

---

## Phase 4: Regression guard over real seed content

### Overview

A future scrape or manual edit that reintroduces an unreachable token should
fail a fast, DB-free test — not ship silently again. Independent of Phases
1–3; protects against recurrence rather than fixing this incident.

### Changes Required:

#### 1. Shared producible-token derivation

**File**: `src/test/tokenGrammar.ts` (new)

**Intent**: Extract the "what can the app ever produce" derivation
(`KEY_TO_MOVE` base tokens, minus the two modifier sentinels, times
lowercased-and-not × doubled-and-not) into one shared helper, so
`PracticeSession.parity.test.ts` and the new seed-content test compute it
once instead of drifting independently.

**Contract**: Exports `PRODUCIBLE_TOKENS: Set<string>` — the full set
`dispatchMove` can ever dispatch: `{base, base+"2", lower(base),
lower(base)+"2"}` for every `KEY_TO_MOVE` value except the `__wide_modifier__`
and `__double_modifier__` sentinels.

#### 2. Refactor existing parity test onto the shared helper

**File**: `src/components/app/PracticeSession.parity.test.ts`

**Intent**: Replace its local `keyboardBase`/`keyboardWithWide` derivation
with the new shared helper where equivalent, so there is exactly one source
of truth for the producible-token grammar. No test behavior change — same
assertions, same pass/fail outcomes.

**Contract**: Existing three `it` blocks keep passing unchanged.

#### 3. Seed-content token check

**File**: `src/test/seedTokens.test.ts` (new)

**Intent**: Parse every `moves` literal out of `supabase/algos_seed.sql` and
`supabase/seed.sql`, run each through `parseMoves`, and assert every resulting
token is in `PRODUCIBLE_TOKENS`. This is the guard that would have caught the
original bug — it fails on any token, present or future, that the app could
never actually receive as input.

**Contract**: Reads both files with `node:fs` at test time (no DB). Extracts
`moves` literals with a regex matching the `algorithms` INSERT tuple shape —
`'<uuid>', '<name>', '<moves-with-doubled-quotes>', <position>` — capturing
the third quoted field, since names never contain apostrophes but `moves`
values do (escaped as `''`). Unescape each match with
`.replace(/''/g, "'")` before calling `parseMoves`. On failure, report the
offending algorithm name and token, not just a boolean.

### Success Criteria:

#### Automated Verification:

- New test fails against the pre-fix content (verified by temporarily
  reverting Phase 2's edit and re-running — must go red) and passes after
  Phase 2 lands: `npm test`
- Existing parity test still passes unchanged after the refactor: `npm test`
- Type checking passes: `npx astro check` (or project's configured check)
- Linting passes: `npm run lint`

#### Manual Verification:

- None — this phase is fully covered by automated checks

---

## Testing Strategy

### Unit Tests:

- `src/test/tokenGrammar.ts` derivation covered indirectly via the parity
  test and the new seed-content test consuming it
- Seed-content test (`src/test/seedTokens.test.ts`) covers both
  `algos_seed.sql` and `seed.sql`, all rows, not just the 7 previously broken
  ones

### Integration Tests:

- None added — Phase 3's live-DB fix is a one-time manual correction, not an
  ongoing integration-test concern (see "What We're NOT Doing")

### Manual Testing Steps:

1. Run Phase 1's spec first and confirm it fails for the right reason
   (session stalls on the double-turn move)
2. Run the 7 `UPDATE` statements from
   `supabase/fixes/2026-08-24-rotation-notation.sql` against the live project
   via Supabase Studio SQL Editor
3. Read back the 7 rows to confirm the corrected `moves` values and unchanged
   row count
4. Re-run Phase 1's spec and confirm it now passes
5. In the running app, open each of the remaining 6 previously-broken
   algorithms and manually complete a clean run, confirming the completion
   banner appears for all of them (Phase 1's spec covers only `OLL 28`)

## Performance Considerations

None — a 7-row data correction and a DB-free parse test; no runtime path
changes.

## Migration Notes

The corrective statement in `supabase/fixes/2026-08-24-rotation-notation.sql`
is intentionally outside `supabase/migrations/` (DDL-only convention, see
Current State Analysis) and outside `sql_paths` (would duplicate rows on
`db reset`). It is a standalone, manually-run artifact — this establishes the
first precedent in this repo for a one-off live-data repair; the file's
header comment should say so explicitly for whoever finds it next.

## References

- Frame brief: `context/changes/rotation-notation-fix/frame.md`
- Change notes: `context/changes/rotation-notation-fix/change.md`
- Source: `supabase/algos_seed.sql:1-6,93,99,121,125,140,143,145`;
  `src/components/app/PracticeSession.tsx:216-218,291-296,149`;
  `src/components/app/PracticeSession.parity.test.ts`;
  `supabase/config.toml:60-65`; `playwright.config.ts:1-7`;
  `playwright/test/seed.spec.ts`; `playwright/test/E2E_RULES.md`
- Related docs: `context/foundation/roadmap.md:141`;
  `context/changes/domain-schema-rls/plan.md:347,360`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: E2E regression spec — capture red

#### Automated

- [x] 1.1 Spec run confirms failure today: `npx playwright test rotation-notation-fix.spec.ts` exits non-zero — e6d9f20

#### Manual

- [x] 1.2 Failure confirmed as the right one (stalls at the `U2` step, not an unrelated error) — e6d9f20

### Phase 2: Fix seed source file

#### Automated

- [x] 2.1 `grep -c "2''" supabase/algos_seed.sql` returns `0` — 867992b
- [x] 2.2 Linting passes: `npm run lint` — 867992b

#### Manual

- [x] 2.3 Diff review confirms only the 8 targeted tokens changed — 867992b

### Phase 3: Corrective SQL for the live database — confirm green

#### Automated

- [x] 3.1 `grep -c "2''" supabase/fixes/2026-08-24-rotation-notation.sql` returns `0` — 887a32e
- [x] 3.2 Phase 1's spec now passes: `npx playwright test rotation-notation-fix.spec.ts` — 887a32e

#### Manual

- [x] 3.3 7 `UPDATE` statements executed against the live Supabase project via Studio SQL Editor — 887a32e
- [x] 3.4 Read-back `SELECT` confirms all 7 rows corrected, no `2'` substring remaining — 887a32e
- [x] 3.5 `public.algorithms` row count unchanged before/after — 887a32e

### Phase 4: Regression guard over real seed content

#### Automated

- [x] 4.1 New seed-content test fails pre-fix, passes post-fix: `npm test`
- [x] 4.2 Existing parity test still passes after refactor: `npm test`
- [x] 4.3 Type checking passes: `npx astro check`
- [x] 4.4 Linting passes: `npm run lint`

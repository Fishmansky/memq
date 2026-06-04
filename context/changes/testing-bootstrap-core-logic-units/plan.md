# Phase 1 Test Rollout — Bootstrap + Core-Logic Units Implementation Plan

## Overview

Stand up the project's first test runner (Vitest + @testing-library/react) on an
Astro 6 / React 19 codebase that has zero tests today, then prove the three
core-logic risks from `context/foundation/test-plan.md` hold at the cheapest
layer that gives real signal:

- **#3 Move validation lies** — wrong move blocks and never advances, correct move
  advances, end-state color is binary green/yellow.
- **#4 Streak miscounts** — count increments only on a clean run, resets on error,
  triggers PRO at exactly 3.
- **#5 Grid input desync** — each grid button and its keyboard shortcut emit the
  correct move token; a layout reflow cannot silently widen grid↔keyboard divergence.

A small, behavior-neutral export+extract refactor is the enabling precondition for
pure-unit coverage; targeted component tests cover only the JSX-closure surfaces that
pure logic cannot reach.

## Current State Analysis

- **Test base = none.** Zero test files in `src/`; no test-runner config, no
  vitest/jest/playwright deps or scripts. Vite config is nested inside
  `astro.config.mjs` (no standalone `vite.config.ts`). The `@/*` → `./src/*` alias
  lives only in `tsconfig.json`. CI (`.github/workflows/ci.yml`) runs lint + build,
  no test step (the gate is wired later, in §3 Phase 4).
- **#3 / #5 logic is pure but NOT exported.** `reducer`, `parseMoves`, `KEY_TO_MOVE`,
  and the three grid arrays (`SIDE_GRID`, `CENTRAL_GRID`, `ROTATION_GRID`) are
  module-level values in `src/components/app/PracticeSession.tsx` with only the
  component `export default`. They cannot be imported by a test as-is.
- **#4 streak rule is INLINED** in the POST handler at
  `src/pages/api/practice/complete.ts:88-91` — not a pure function. It is unreachable
  at the unit layer until extracted. No `src/lib` streak module exists today.
- **Three JSX-closure surfaces** are not reachable as pure logic: the modifier
  assembly in `dispatchMove` (`PracticeSession.tsx:250-255` — wide→lowercase,
  double→`+"2"`, shift→prime), and the `isPro` + green-vs-amber end-banner ternary
  (`:305`, `:343-345`), all inline in JSX.
- **Two #4 surfaces are explicitly out of this phase**: the lost-update race
  (integration-only, Phase 2) and the server trusting client `isClean`
  (§7 negative-space, low impact — do not over-invest).

### Key Discoveries:

- `reducer(state, action, tokens)` is a pure free function with `tokens` injected as
  the 3rd arg (`PracticeSession.tsx:122`); `parseMoves` is pure (`:207-209`). Cheapest
  layer = pure unit, blocked only by missing `export`s.
- Wrong move BLOCKS — `currentIndex` advances only inside the `if (correct)` branch
  (`:143-154`); the wrong branch (`:158-165`) returns without advancing. `errorCount`
  is attempt count, not distinct-slot-mistake count (`:157`).
- Green-vs-amber end state is decided **solely** by `errorCount === 0` (`:343-345`);
  "green when it should be yellow" maps to exactly this expression. Slot colors are a
  separate vocabulary (`pending|correct|wrong` → gray/green/red, no yellow at slot
  level).
- Grid emits `cell.move` directly (`:216`) — label and token are the SAME value, so
  they cannot drift *within* the grid. The real #5 divergence is grid arrays vs the
  independent hand-aligned `KEY_TO_MOVE` (`:8`), across the prime(shift)/wide(`w`)/
  double(`2`) derivation asymmetry.
- Grid clicks also route through `dispatchMove` (`onMove={dispatchMove}` `:437-439`),
  so an active wide/double modifier transforms grid clicks too (click `u` with double
  → `u2`) — a real edge case worth a component test.
- Streak compute: increment `currentClean + 1` when clean, reset to `0` otherwise;
  PRO trigger is `newConsecutiveClean >= 3` (`>=`, not `===`); `alreadyMastered ||`
  makes mastery sticky; missing mastery row computes from `?? 0` so first clean
  session yields `consecutive_clean = 1`.
- **Tautology trap (load-bearing):** any streak/comparison assertion must take its
  oracle from the *intended rule* (3 consecutive clean; strict-equality comparison),
  never from the compute function it reads.

## Desired End State

`npm test` runs Vitest green on a codebase that previously had none. The pure practice
logic and the extracted streak rule are importable and covered by unit tests; the two
input maps are proven in parity; the modifier/end-color JSX surfaces are covered by
targeted component tests. Source behavior is unchanged. The test-plan cookbook (§6.1,
§6.2, §6.6) documents how to add the next unit/component test, and §3 Phase 1 is marked
complete.

Verify: `npm test` exits 0 with the expected specs present; `npm run lint` and
`npm run build` still pass (refactor is behavior-neutral); test-plan §6 no longer reads
"TBD — see §3 Phase 1" for the unit/component entries.

## What We're NOT Doing

- **No integration or DB tests.** The lost-update race (#4) and session-persistence
  (#1) belong to §3 Phase 2. No Supabase client is loaded in this phase's test graph.
- **No authorization / two-account tests** (#2) — §3 Phase 3.
- **No e2e / Playwright, no full happy-path session walkthrough** — §3 Phase 4.
- **No server-side guard for client-forged `isClean`** — §7 negative-space, low impact;
  there is no guard to test today and we are not adding one.
- **No CI test-step wiring** — the gate is enforced in §3 Phase 4 (test-plan §5). This
  phase only makes `npm test` runnable locally.
- **No visual / multimodal review** — optional, §3 Phase 4.
- **No behavior changes** to the reducer, the endpoint, or the grid/keyboard maps. The
  refactor is export + extract only.

## Implementation Approach

Bootstrap the runner first as an isolated, source-untouched step so a green smoke test
proves the harness before any real assertion depends on it. Then make the minimal
behavior-neutral refactor that unlocks the cheapest test layer (export the pure values;
extract the inlined streak compute into `src/lib/practice/streak.ts` and re-wire the
endpoint to call it). Write pure-unit tests against the now-importable logic, reserving
component tests strictly for the JSX-closure surfaces that pure logic cannot reach.
Close by filling the cookbook so the next contributor (and `/10x-tdd` in Lesson 2) can
add a test without re-deriving conventions.

Config keeps the test runtime independent of the Cloudflare/SSR Astro config: a
standalone `vitest.config.ts` with its own `@/*` alias and a `jsdom` environment for
component tests. Because the refactor leaves the streak helper pure and Phase 1 imports
only pure modules, no `astro:env` / Supabase code enters the test graph.

## Critical Implementation Details

- **Refactor ordering (load-bearing).** Phase 2 must land and stay behavior-neutral
  before Phase 3/4 assertions are written against it — `npm run lint` + `npm run build`
  are the neutrality gate. Extract the streak helper as an absolute value computation
  `(currentClean, alreadyMastered, isClean) → { newConsecutiveClean, newMasteryReached }`
  and have `complete.ts` call it; do not change the upsert or fetch path.
- **Tautology trap (#4, #3).** The streak and comparison oracles come from the intended
  rule (3 consecutive clean; strict string-equality on the expected token), never from
  the function under test. A test that mirrors the compute/comparison function proves
  nothing.
- **#5 parity asymmetry.** Grid bakes primes/wides as literal cells (`U'`, `u`, `r`);
  keyboard derives primes from `shift+` and wide/double from the `w`/`2` sentinel
  toggles. The parity assertion must encode this asymmetry, not assert flat
  set-equality (which would false-fail) and not assert grid label==token (which is a
  tautology — they are the same value).

## Phase 1: Bootstrap test runner

### Overview

Install Vitest + Testing Library, add a standalone config and test setup, add npm
scripts, and prove the harness with one trivial smoke test. No `src/` source touched.

### Changes Required:

#### 1. Test runner dependencies

**File**: `package.json`

**Intent**: Add the dev dependencies for the unit + component layer named in test-plan
§4 (Vitest, @testing-library/react, the jsdom environment, jest-dom matchers, and
@testing-library/user-event for the modifier component tests in Phase 4). Add `test`
and `test:watch` scripts.

**Contract**: New `devDependencies` entries and `scripts.test` (non-watch, CI-shaped)
+ `scripts.test:watch`. Versions resolved against Vitest current + Astro 6 / React 19
at implement time via Context7 (test-plan §4 defers versions to Phase 1). `"type":
"module"` and npm lockfile are already in place.

#### 2. Vitest configuration

**File**: `vitest.config.ts` (new, repo root)

**Intent**: Standalone Vitest config independent of `astro.config.mjs`, so the test
runtime does not pull in the Cloudflare adapter / SSR plugins. Declare the `@/*` →
`./src/*` alias (mirroring `tsconfig.json`), set the `jsdom` test environment for
component tests, and register the global setup file.

**Contract**: `test.environment = "jsdom"`, `test.setupFiles` → the Phase 1 setup file,
`test.globals` enabled (so specs need no per-file vitest imports), and `resolve.alias`
mapping `@` → `./src`. Glob defaults to co-located `**/*.test.{ts,tsx}`.

#### 3. Test setup file

**File**: `src/test/setup.ts` (new)

**Intent**: Register `@testing-library/jest-dom` matchers and any global afterEach
cleanup for Testing Library so component specs in Phase 4 have DOM matchers available.

**Contract**: Side-effect import of jest-dom; Testing Library auto-cleanup relied on
(Vitest globals). No app/Supabase imports.

#### 4. Smoke test

**File**: `src/test/smoke.test.ts` (new, removable)

**Intent**: Prove the harness runs and the alias resolves before any real assertion
depends on it.

**Contract**: One trivial passing assertion. Deleted or kept as a sanity spec at
implementer discretion once Phase 3 lands real tests.

### Success Criteria:

#### Automated Verification:

- Dependencies install cleanly: `npm install`
- Test runner executes and smoke test passes: `npm test`
- Linting passes on new config/setup files: `npm run lint`
- Production build is unaffected: `npm run build`

#### Manual Verification:

- `npm test` output shows the Vitest runner and a green smoke spec.
- No Supabase / `astro:env` import appears in the test run (no env errors).

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation before proceeding.

---

## Phase 2: Refactor for testability

### Overview

Behavior-neutral refactor that unlocks the pure-unit layer: export the pure values from
`PracticeSession.tsx`, and extract the inlined streak compute into a pure
`src/lib/practice/streak.ts` that the endpoint calls. No behavior changes.

### Changes Required:

#### 1. Export pure practice values

**File**: `src/components/app/PracticeSession.tsx`

**Intent**: Add named exports for the pure, currently-module-private values so tests can
import them without rendering: `reducer`, `parseMoves`, `KEY_TO_MOVE`, `SIDE_GRID`,
`CENTRAL_GRID`, `ROTATION_GRID`. Keep `export default` for the component unchanged.

**Contract**: Named exports added alongside the existing default export; no signature,
value, or call-site change. `reducer(state, action, tokens)` purity preserved.

#### 2. Extract streak compute helper

**File**: `src/lib/practice/streak.ts` (new)

**Intent**: Move the inlined streak rule from `complete.ts:88-91` into a pure helper that
is the single source of truth for the consecutive-clean rule, reusable by Phase 2
integration.

**Contract**: Pure function
`(currentClean: number, alreadyMastered: boolean, isClean: boolean) → { newConsecutiveClean: number; newMasteryReached: boolean }`,
implementing: `newConsecutiveClean = isClean ? currentClean + 1 : 0`;
`newMasteryReached = alreadyMastered || newConsecutiveClean >= 3`. Exact behavior parity
with the current inlined lines (the `?? 0` first-row default stays at the call site,
feeding `currentClean`).

#### 3. Re-wire the endpoint to the helper

**File**: `src/pages/api/practice/complete.ts`

**Intent**: Replace the inlined `:88-91` compute with a call to the extracted helper,
importing it via the `@/*` alias. The fetch (`Promise.all`) and upsert paths are
untouched.

**Contract**: `complete.ts` imports from `@/lib/practice/streak`; the two computed values
(`newConsecutiveClean`, `newMasteryReached`) feed the existing upsert exactly as before.
No change to validation, response shape, or the accepted lost-update race.

### Success Criteria:

#### Automated Verification:

- Type checking + linting pass on the refactor: `npm run lint`
- Production build succeeds (endpoint still wires): `npm run build`
- Existing smoke test still green: `npm test`

#### Manual Verification:

- Diff confirms the refactor is behavior-neutral (no logic change beyond move/extract).
- A quick manual practice run still records progress / streak as before.

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation before proceeding.

---

## Phase 3: Pure-unit tests (#3, #4, #5)

### Overview

Unit-test the now-importable pure logic at the cheapest layer: move comparison + slot
transitions (#3), the streak helper (#4), and bidirectional grid↔keyboard parity (#5).

### Changes Required:

#### 1. Move-comparison + reducer tests (#3)

**File**: `src/components/app/PracticeSession.reducer.test.ts` (new, co-located)

**Intent**: Prove the reducer's correctness claims against the intended rule: a wrong
move increments `errorCount` but does NOT advance `currentIndex` or change `phase`; a
correct move advances; the per-slot result transitions `pending→correct|wrong`; and
`parseMoves` strips parentheses and splits on whitespace. Assert the green-vs-amber rule
(`errorCount === 0`) as the documented end-color predicate.

**Contract**: Drives `reducer(state, INPUT_MOVE, tokens)` with hand-built states; oracle
is the intended rule, not the comparator. Covers wrong-blocks, correct-advances,
final-slot completion, and a `parseMoves` table including a parenthesized sequence.

#### 2. Streak helper tests (#4)

**File**: `src/lib/practice/streak.test.ts` (new, co-located)

**Intent**: Pin the off-by-one boundaries from research: count==2 → no PRO, count==3 →
PRO, clean increments by 1, any non-clean resets to 0, fresh-after-reset==1 → no PRO,
and missing-row first-clean (currentClean=0) → 1 with no PRO. Confirm mastery is sticky
(`alreadyMastered` true stays true even on a non-clean run).

**Contract**: Table-driven over `(currentClean, alreadyMastered, isClean)`; oracle is the
intended 3-consecutive-clean rule, never the helper's own expression.

#### 3. Grid↔keyboard parity test (#5)

**File**: `src/components/app/PracticeSession.parity.test.ts` (new, co-located)

**Intent**: Prove every grid-emittable token has a keyboard route and vice-versa,
accounting for the prime(shift)/wide(`w`)/double(`2`) derivation asymmetry — so a future
grid reflow (e.g. `moves-grid-update`) that touches only the grid arrays cannot silently
widen divergence without failing this test.

**Contract**: Derive the grid token set from `SIDE_GRID`/`CENTRAL_GRID`/`ROTATION_GRID`
and the keyboard-reachable token set from `KEY_TO_MOVE` (expanding `shift+` primes and
the `w`/`2` sentinels per the documented assembly rules), then assert bidirectional
coverage. Sentinel tokens (`__wide_modifier__`, `__double_modifier__`) handled as
modifiers, not face tokens.

### Success Criteria:

#### Automated Verification:

- All unit specs pass: `npm test`
- Linting passes on new test files: `npm run lint`
- Build unaffected: `npm run build`

#### Manual Verification:

- Spot-check that a deliberately broken expected-token (temporarily) fails the reducer
  test — confirms the oracle is independent, not a mirror.
- Parity test fails if a grid token is removed from `KEY_TO_MOVE` (confirm by temporary
  edit, then revert).

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation before proceeding.

---

## Phase 4: Component tests (targeted)

### Overview

Cover only the surfaces unreachable as pure logic: modifier assembly + end-color render
(#3), and grid-click-with-active-modifier (#5). No full session walkthrough (e2e's job).

### Changes Required:

#### 1. Modifier assembly + end-color render (#3)

**File**: `src/components/app/PracticeSession.test.tsx` (new, co-located)

**Intent**: Render the island and prove the JSX-closure behavior: pressing `w` then `R`
emits the wide token `r`; an active double modifier yields `+"2"`; `shift` yields a
prime — and the end banner shows green when `errorCount === 0` and amber otherwise, with
the PRO (`text-yellow-300`) state gated on `isPro`.

**Contract**: Testing Library + `user-event`; assert the emitted/validated move token and
the rendered end-state color/PRO state. Drives the `dispatchMove` assembly path, not the
reducer directly. Any data the component fetches on completion is stubbed at the boundary
(no real Supabase) — keep the test within the rendered-component surface.

#### 2. Grid-click-with-active-modifier (#5)

**File**: covered in the same `PracticeSession.test.tsx`

**Intent**: Prove that grid clicks route through `dispatchMove`, so clicking `u` with an
active double modifier emits `u2` — the documented cross-input edge case.

**Contract**: Render, activate the double modifier, click the grid cell, assert the
emitted/validated token reflects the modifier. Asserts behavior, not a DOM snapshot.

### Success Criteria:

#### Automated Verification:

- Component specs pass under jsdom: `npm test`
- Linting passes: `npm run lint`
- Build unaffected: `npm run build`

#### Manual Verification:

- Component tests run without pulling `astro:env`/Supabase into the graph (no env errors).
- Removing the `w` sentinel handling (temporarily) fails the modifier test — confirms the
  assertion is meaningful.

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation before proceeding.

---

## Phase 5: Cookbook + close

### Overview

Fill the test-plan cookbook so the conventions established here are reusable, flip the
rollout status, and stamp the change identity. (`context/archive/` is immutable; only
`context/foundation/test-plan.md` and this change folder are touched.)

### Changes Required:

#### 1. Fill cookbook §6.1 / §6.2 / §6.6

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the "TBD — see §3 Phase 1" placeholders for the unit (§6.1) and
component (§6.2) entries with the concrete conventions this phase established, and add a
§6.6 per-phase note.

**Contract**: §6.1 names location (co-located `*.test.ts`), the runner (`npm test`), the
pure-logic pattern (import the exported `reducer`/`parseMoves`/streak helper; oracle =
intended rule), and a reference test (`src/lib/practice/streak.test.ts`). §6.2 names the
component pattern (Testing Library + `user-event`, jsdom, co-located `*.test.tsx`) with
`PracticeSession.test.tsx` as the reference. §6.6 records the Phase 1 landing
(runner/config/refactor). Do not edit §1–§5 strategy.

#### 2. Flip rollout status

**File**: `context/foundation/test-plan.md`

**Intent**: Update §3 Phase 1 Status from `change opened` to `complete`.

**Contract**: Only the Phase 1 row's Status cell changes; Phase 2–4 untouched.

#### 3. Stamp the change identity

**File**: `context/changes/testing-bootstrap-core-logic-units/change.md`

**Intent**: Set `status` to reflect completion and bump `updated`.

**Contract**: Frontmatter `status` and `updated: <today>` updated; Notes preserved.

### Success Criteria:

#### Automated Verification:

- Full suite still green: `npm test`
- Lint + build pass: `npm run lint` && `npm run build`

#### Manual Verification:

- test-plan §6.1/§6.2 read as actionable instructions (no remaining "TBD" for unit/
  component), and §3 Phase 1 shows `complete`.
- A reader unfamiliar with the project could add a new unit test from §6.1 alone.

**Implementation Note**: After completing this phase and all automated verification
passes, pause for final manual confirmation. This is the last phase.

---

## Testing Strategy

### Unit Tests:

- **#3** reducer: wrong-move-blocks (no `currentIndex`/`phase` change, `errorCount++`),
  correct-move-advances, slot `pending→correct|wrong`, final-slot completion; `parseMoves`
  tokenizer incl. parenthesized input; green-vs-amber via `errorCount === 0`.
- **#4** streak helper: increment-on-clean, reset-on-error, `>=3` PRO boundary
  (2→no, 3→yes), fresh-after-reset==1, missing-row first-clean→1, sticky mastery.
- **#5** bidirectional, asymmetry-aware grid↔keyboard parity.

### Component Tests:

- **#3** modifier assembly (`w`→wide, `2`→double, `shift`→prime) + end-state green/amber
  + PRO banner gating.
- **#5** grid click with an active modifier emits the transformed token (`u`+double→`u2`).

### Manual Testing Steps:

1. `npm test` — confirm all specs green and the Vitest runner reports the expected files.
2. Temporarily break one oracle (e.g. expected token, or remove a `KEY_TO_MOVE` entry) —
   confirm the relevant test fails, then revert (proves tests aren't tautologies).
3. Run a real practice session in the app — confirm progress/streak still records
   (refactor behavior-neutral).

## Performance Considerations

Pure-unit tests carry no env/DB cost. Component tests run under jsdom; keep them limited
to the modifier/end-color surfaces to keep the suite fast and stable. No real Supabase or
`astro:env` is loaded in this phase.

## Migration Notes

The streak-compute extraction (Phase 2) is a pure code move with no data or schema
impact; the endpoint's external behavior is unchanged. No deployment or data migration.

## References

- Research: `context/changes/testing-bootstrap-core-logic-units/research.md`
- Strategy: `context/foundation/test-plan.md` §2 (risks #3/#4/#5), §4 (stack), §6 (cookbook)
- Reducer / maps: `src/components/app/PracticeSession.tsx:8,45,73,83,122,207,250,305,343`
- Streak compute (to extract): `src/pages/api/practice/complete.ts:88-91`
- Lesson: `context/foundation/lessons.md` (Promise.all — endpoint fetch path, do not alter)
- Bootstrap inventory: `astro.config.mjs:11-24`, `tsconfig.json:7-10`, `.github/workflows/ci.yml`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Bootstrap test runner

#### Automated

- [x] 1.1 Dependencies install cleanly: `npm install` — a66fbb6
- [x] 1.2 Test runner executes and smoke test passes: `npm test` — a66fbb6
- [x] 1.3 Linting passes on new config/setup files: `npm run lint` — a66fbb6
- [x] 1.4 Production build is unaffected: `npm run build` — a66fbb6

#### Manual

- [x] 1.5 `npm test` output shows the Vitest runner and a green smoke spec — a66fbb6
- [x] 1.6 No Supabase / `astro:env` import appears in the test run — a66fbb6

### Phase 2: Refactor for testability

#### Automated

- [x] 2.1 Type checking + linting pass on the refactor: `npm run lint` — ef99ead
- [x] 2.2 Production build succeeds: `npm run build` — ef99ead
- [x] 2.3 Existing smoke test still green: `npm test` — ef99ead

#### Manual

- [x] 2.4 Diff confirms the refactor is behavior-neutral — ef99ead
- [x] 2.5 A manual practice run still records progress / streak — ef99ead

### Phase 3: Pure-unit tests (#3, #4, #5)

#### Automated

- [x] 3.1 All unit specs pass: `npm test` — 73e565c
- [x] 3.2 Linting passes on new test files: `npm run lint` — 73e565c
- [x] 3.3 Build unaffected: `npm run build` — 73e565c

#### Manual

- [x] 3.4 Broken expected-token fails the reducer test (oracle is independent) — 73e565c
- [x] 3.5 Parity test fails if a grid token is removed from `KEY_TO_MOVE` — 73e565c

### Phase 4: Component tests (targeted)

#### Automated

- [x] 4.1 Component specs pass under jsdom: `npm test`
- [x] 4.2 Linting passes: `npm run lint`
- [x] 4.3 Build unaffected: `npm run build`

#### Manual

- [x] 4.4 Component tests run without pulling `astro:env`/Supabase into the graph
- [x] 4.5 Removing the `w` sentinel handling fails the modifier test

### Phase 5: Cookbook + close

#### Automated

- [ ] 5.1 Full suite still green: `npm test`
- [ ] 5.2 Lint + build pass: `npm run lint` && `npm run build`

#### Manual

- [ ] 5.3 §6.1/§6.2 actionable (no TBD for unit/component); §3 Phase 1 shows `complete`
- [ ] 5.4 A reader could add a new unit test from §6.1 alone

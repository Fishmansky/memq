# Phase 1 Test Rollout — Bootstrap + Core-Logic Units — Plan Brief

> Full plan: `context/changes/testing-bootstrap-core-logic-units/plan.md`
> Research: `context/changes/testing-bootstrap-core-logic-units/research.md`

## What & Why

Stand up the project's first test runner (Vitest + @testing-library/react) on a
codebase with zero tests, then prove the three core-logic risks from the test plan hold
at the cheapest layer that gives real signal: move validation never silently accepts a
wrong move (#3), the streak counter triggers PRO at exactly 3 consecutive clean runs
(#4), and grid buttons stay in sync with keyboard shortcuts (#5).

## Starting Point

`src/` has no test files and no runner config; Vite config is nested inside
`astro.config.mjs` and the `@/*` alias lives only in `tsconfig.json`. The practice loop
is a pure reducer + React shell — an unusually clean unit target — but the pure values
(`reducer`, `parseMoves`, `KEY_TO_MOVE`, grid arrays) aren't exported, and the streak
rule is inlined in the session-complete endpoint (`complete.ts:88-91`).

## Desired End State

`npm test` runs Vitest green. Move comparison, slot transitions, the extracted streak
rule, and grid↔keyboard parity are covered by pure-unit tests; modifier assembly and
the green/amber end banner are covered by targeted component tests. Source behavior is
unchanged, and the test-plan cookbook (§6.1/§6.2) documents how to add the next test.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Refactor scope | Export pure values + extract streak helper | Unlocks the cheapest (pure-unit) layer research named as the precondition for #3/#4/#5 | Plan |
| Streak helper location | `src/lib/practice/streak.ts` | Canonical pure-logic home the cookbook points at, reusable by Phase 2 integration | Plan |
| Test layout | Co-located `*.test.ts(x)` | Vitest default; subject + test move together; standard for Vite/React | Plan |
| Runner config | Standalone `vitest.config.ts`, jsdom, no Supabase import | Keeps test runtime off the Cloudflare/SSR Astro config; pure units need no env | Plan |
| Component-test depth | Targeted — modifiers + end-color only | Render tests only for JSX-closure surfaces pure logic can't reach; no e2e overlap | Plan |
| #5 parity scope | Bidirectional, asymmetry-aware | Catches structural desync incl. the `moves-grid-update` reflow risk, not a tautology | Research/Plan |

## Scope

**In scope:** Vitest + Testing Library bootstrap; export/extract refactor;
pure-unit tests for #3/#4/#5; targeted component tests for modifier assembly +
end-color + grid-click-with-modifier; cookbook §6.1/§6.2/§6.6 fill-in.

**Out of scope:** integration/DB tests, the lost-update race, persistence (#1),
authorization (#2), e2e/Playwright, full session walkthrough, CI test-step wiring,
server-side `isClean` guard, visual review, any behavior change.

## Architecture / Approach

Bootstrap the runner as an isolated, source-untouched step (green smoke test) → make
the minimal behavior-neutral refactor (export pure values; extract streak helper, re-wire
endpoint) gated by lint+build → write pure-unit tests against the importable logic →
reserve component tests strictly for JSX-closure surfaces → fill the cookbook and flip
status. Standalone `vitest.config.ts` (jsdom + `@/*` alias) keeps `astro:env`/Supabase
out of the test graph.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Bootstrap test runner | Vitest + Testing Library installed, config, green smoke test | jsdom/alias/env wiring against Astro 6 nested Vite config |
| 2. Refactor for testability | Exported pure values + `src/lib/practice/streak.ts`, endpoint re-wired | Keeping the streak extraction behavior-neutral (touches live endpoint) |
| 3. Pure-unit tests (#3/#4/#5) | Reducer, streak, parity specs | Tautology trap — oracle must be the intended rule, not the function under test |
| 4. Component tests (targeted) | Modifier assembly + end-color + grid-click-with-modifier | jsdom render tests staying off the Supabase boundary |
| 5. Cookbook + close | §6.1/§6.2/§6.6 filled, §3 status flipped, change stamped | Editing only §6 (not §1–§5 strategy) |

**Prerequisites:** None beyond the existing repo; Context7 available for current Vitest /
Astro 6 / React 19 setup at implement time.
**Estimated effort:** ~2–3 sessions across 5 light phases.

## Open Risks & Assumptions

- Tool versions (test-plan §4 marks them TBD) resolve at implement time via Context7 —
  no version pinned at plan time.
- The streak extraction must stay strictly behavior-neutral; lint+build+a manual run are
  the neutrality gate.
- The `#5` parity assertion must encode the prime/wide/double asymmetry — a naive
  set-equality false-fails and a grid label==token check is a tautology.

## Success Criteria (Summary)

- `npm test` runs green on a codebase that had no tests; lint + build still pass.
- A wrong move provably blocks, a correct move advances, end color is binary green/yellow;
  streak triggers PRO at exactly 3; every grid token has a keyboard route and vice-versa.
- The cookbook (§6.1/§6.2) lets the next contributor add a unit/component test without
  re-deriving conventions.

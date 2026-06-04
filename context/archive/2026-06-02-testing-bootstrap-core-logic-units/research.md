---
date: 2026-06-02T00:00:00Z
researcher: pawel.rybczynski
git_commit: 9281e7ec4a9054f27a054ed247e01060f0bf6a92
branch: master
repository: memq
topic: "Phase 1 test rollout — ground core-logic risks #3/#4/#5 + Vitest bootstrap"
tags: [research, codebase, testing, practice-session, streak, move-grid, vitest]
status: complete
last_updated: 2026-06-02
last_updated_by: pawel.rybczynski
---

# Research: Phase 1 test rollout — core-logic units (risks #3, #4, #5) + Vitest bootstrap

**Date**: 2026-06-02
**Researcher**: pawel.rybczynski
**Git Commit**: 9281e7ec4a9054f27a054ed247e01060f0bf6a92
**Branch**: master
**Repository**: memq

## Research Question

Ground rollout Phase 1 of `context/foundation/test-plan.md` ("Bootstrap + core-logic
units"): verify the move-comparison logic (#3), streak compute rule + UPSERT race (#4),
and grid button→token / keyboard map (#5) against current code. Verify or correct the
test plan's Risk Response Guidance, identify the cheapest useful test layer per risk,
flag speculative risks or misleading hot-spot evidence, and confirm where to bootstrap
the Vitest runner.

## Summary

- **Test base = none confirmed.** Zero test files in `src/`; no test runner config. Phase 1
  must stand up Vitest + @testing-library/react. Vite config is nested inside
  `astro.config.mjs` (no standalone `vite.config.ts`); `@/*` → `./src/*` alias lives in
  `tsconfig.json`.
- **#3, #5 logic is pure and unit-testable — but NOT EXPORTED.** `reducer`, `parseMoves`,
  `KEY_TO_MOVE`, and the three grid arrays are module-level values in
  `PracticeSession.tsx` with only the component `export default`. A tiny refactor to export
  them unlocks pure unit + parity tests at the cheapest layer.
- **#4 streak rule is INLINED in the endpoint, not a pure function.** The 4-line compute at
  `complete.ts:88-91` must be extracted into a helper to be unit-testable; otherwise the
  rule is only reachable via integration.
- **Three correctness surfaces the happy path hides** (all real, all flagged below): the
  equality comparator has no notation normalization (#3); grid and keyboard are two
  independent hand-aligned maps with a structural desync risk (#5); the server trusts the
  client-submitted `isClean` with no cross-check against `errorCount` (#4 integrity).
- **The lost-update race (#4) is real, documented, and accepted** for single-user usage —
  it belongs to Phase 2 integration, not this phase. A unit test cannot exercise it.
- **Hot-spot evidence corrections (backport candidates):** Risk #3 cited hot-spot dir
  `src/components/app`; the move-validation logic does live there
  (`PracticeSession.tsx`) — citation holds. Risk #4 cited `src/pages/api`; the streak
  compute lives in `src/pages/api/practice/complete.ts` — citation holds. Risk #5 cited
  `src/components/app` — holds. **No §2 Source corrections needed.** One response-guidance
  correction: #4's "cheapest layer = unit + integration" is right, but the unit half is
  *gated on extracting the compute helper* — note that in the plan.

## Detailed Findings

### Risk #3 — Move validation lies (`src/components/app/PracticeSession.tsx`)

All move-validation logic is in one file. The server endpoint does no move validation.

**Comparison logic** — `reducer()` `INPUT_MOVE` case, `PracticeSession.tsx:137-166`. The
entire correct/wrong decision is one strict string equality (`:140`):

```ts
const expected = tokens[state.currentIndex];
const correct = action.move === expected;
```

`tokens` comes from `parseMoves(moves)` (`:207-209`), which only strips parentheses and
splits on space:

```ts
function parseMoves(moves: string): string[] {
  return moves.replace(/[()]/g, "").split(" ").filter(Boolean);
}
```

**Wrong move BLOCKS — confirmed.** `currentIndex` advances only inside the `if (correct)`
branch (`:143-154`); the wrong branch (`:158-165`) returns without changing `currentIndex`
or `phase`, so the learner stays on the same slot. Every wrong attempt re-increments
`errorCount` — so `errorCount` is **attempt count, not distinct-slot-mistake count**
(comment `:157` "count every wrong attempt").

**Slot color vs end-state color — two distinct vocabularies, do not conflate:**
- Per-slot `SlotResult = "pending" | "correct" | "wrong"` (`:94`) → gray/green/red
  (`:376-389`). **No yellow at the slot level.**
- End-of-session banner is where green-vs-yellow lives. PRO banner uses `text-yellow-300`
  (`:336`), gated on `isPro` (`:305`):
  `const isPro = result !== null && (result.masteryReached || result.consecutiveClean >= 3);`
- Within the non-PRO branch, green-vs-amber is decided **solely by** `errorCount === 0`
  (`:343-345`). "Green when it should be yellow" maps to exactly this expression.

**Two sources of truth for "clean":** the banner re-derives green/amber from local
`errorCount` (`:343`) while the PRO badge derives from the server `result` (`:305`). They
agree on a clean happy path; they can diverge on error/retry paths.

**Purity:** `reducer(state, action, tokens)` (`:122`) is a pure free function — `tokens`
injected as 3rd arg, component closes over it at `:235`. `parseMoves` (`:207`) is pure.
Cheapest layer = **pure unit**. Entanglement: the modifier-assembly (`dispatchMove`,
`:250-255` — wide→lowercase, double→`+"2"`) lives in a component closure, NOT the reducer,
so "W + R → r validated correctly" needs a component test or a refactor. `isPro` and the
green/amber ternary are inline JSX, not extracted.

### Risk #4 — Streak miscounts (`src/pages/api/practice/complete.ts`)

**Streak rule is INLINED in the POST handler, `complete.ts:88-91`** (no pure helper):

```ts
const currentClean = masteryResult.data?.consecutive_clean ?? 0;
const alreadyMastered = masteryResult.data?.mastery_reached ?? false;
const newConsecutiveClean = isClean ? currentClean + 1 : 0;
const newMasteryReached = alreadyMastered || newConsecutiveClean >= 3;
```

- Increment `currentClean + 1` when clean; reset to `0` otherwise (`:90`).
- PRO trigger = `newConsecutiveClean >= 3` (`:91`) — **`>=`, not `===`**. Fires on the 3rd
  clean session (1→2→3). Matches PRD "3 consecutive mistake-free". `>=` is the safer
  direction given the race (a skipped value still latches PRO). Mastery is
  monotonic/sticky via `alreadyMastered ||`.
- First-ever session: `?? 0` (`:88`) means a missing mastery row computes from 0 → first
  clean session yields `consecutive_clean = 1`.

**Off-by-one boundaries to pin in unit tests:** count==2 → no PRO, count==3 → PRO,
fresh-after-reset==1 → no PRO, missing-row first-clean → 1.

**Write path & race** — `complete.ts`:
- Fetch (`:50-63`): a `Promise.all` runs the `practice_sessions` INSERT in parallel with
  the mastery SELECT (`:57-62`). The mastery read→compute→upsert remains sequential.
- Compute (`:88-91`, above).
- Upsert (`:93-101`): writes the JS-computed absolute value back with
  `onConflict: "user_id,algorithm_id"`.

**Lost-update race CONFIRMED** — classic read-modify-write. No atomic DB increment, no RPC.
Two concurrent completions for the same `(user, algorithm)` can both read `N` and both
write `N+1`. Documented and accepted in
`context/archive/2026-05-28-practice-session-core-loop/plan.md:52,54` and
`.../reviews/impl-review.md:22,66-73` (Finding F4) — accepted for single-user,
low-concurrency; revisit with a Postgres RPC if it ever matters. **Integration-only,
Phase 2 — not this phase.**

**Server TRUSTS client `isClean`.** Validation (`:27-28`) requires `isClean: boolean` and
`errorCount: number` but never cross-checks them. Compute (`:90`) branches on the
client-supplied `isClean`. The client computes it at
`PracticeSession.tsx:286`: `isClean: errorCount === 0`. A client can send
`isClean: true, errorCount: 5` and still inflate the streak. **Distinct integrity sub-risk
under #4** — cheap to unit-test once a server guard exists; today there is no guard to
test (note in §7 negative space the test plan already triaged client-forged outcomes as
low impact — this is the same surface; do not over-invest).

**Purity:** the 4-line compute is the smallest pure unit —
`(currentClean, alreadyMastered, isClean) → { newConsecutiveClean, newMasteryReached }`.
Currently NOT isolable; **extract into a helper first**, then unit-test. No `src/lib`
streak module exists today.

### Risk #5 — Grid input desync (`src/components/app/PracticeSession.tsx`)

All input logic in the one island. `MoveSequence.astro` is read-only display.

**Grid = data-driven.** Three `GridCell { move, col, row }` arrays: `SIDE_GRID` (`:45`, 24
cells), `CENTRAL_GRID` (`:73`, M/E/S), `ROTATION_GRID` (`:83`, x/y/z). A generic `MoveGrid`
renders them and emits `cell.move` on click (`:216`,
`onClick={() => { onMove(cell.move); }}`). Label and emitted token are the same value — they
cannot drift *within* the grid.

**Keyboard = a SEPARATE map.** `KEY_TO_MOVE: Record<string, string>` (`:8`) — key-combo →
token (`r:"R"`, `"shift+r":"R'"`, … plus sentinels `w:"__wide_modifier__"`,
`2:"__double_modifier__"`). Bound via `useHotkeys(Object.keys(KEY_TO_MOVE), …)` (`:257`,
lib `react-hotkeys-hook@^5.2.4`), enabled only when `phase === "active"`.

**Desync risk is structural and confirmed.** Grid arrays and `KEY_TO_MOVE` are two
independent hand-aligned literals with no type or test linking them. Two divergence axes:
1. Grid bakes primes/wides as literal cells (`U'`, `u`, `r`); keyboard derives primes from
   `shift+` and wide/double from the `w`/`2` sentinel toggles in `dispatchMove` (`:250-255`).
2. The grid also routes through `dispatchMove` (`onMove={dispatchMove}` `:437-439`), so an
   active wide/double modifier transforms grid clicks too (e.g. click `u` with
   `doubleModifier` → `u2`). Real edge case worth a test.

**Move-token vocabulary** (for enumeration): faces `R R' U U' F F' L L' B B' D D'`; wides
`r r' u u' f f' l l' b b' d d'`; slices `M M' E E' S S'`; rotations `x x' y y' z z'`;
modifiers `w` (wide), `2` (double).

**Purity:** maps + `parseMoves` + `reducer` are module-level but **not exported**. Cheapest
high-value test = a **pure parity assertion** (every grid-emittable token has a keyboard
route and vice-versa, accounting for the prime/wide asymmetry) — needs the maps exported,
zero rendering. Pair with a small Testing Library component test for the modifier
interaction (`w`/`2` sentinels + `shift` primes), which only exists inside JSX handlers.
e2e not warranted.

**In-flight `moves-grid-update`** (`context/changes/moves-grid-update/`): identity file
only (status `new`), Notes: "buttons too small and misplaced." **The "purely cosmetic"
assumption is UNSAFE** — position (`col`/`row`) lives in the same `GridCell` literals as
`move`, and the reflow touches only the grid arrays, never `KEY_TO_MOVE`. A slip silently
widens grid↔keyboard divergence with no compiler/test to catch it. Land the parity test
before this change ships.

### Vitest bootstrap inventory

- **No test files** in `src/` (confirmed 0). No vitest/jest/playwright deps or scripts.
- `package.json`: `"type": "module"`, npm (`package-lock.json`). Relevant deps: `astro@^6.3.1`,
  `react@^19.2.6`, `@astrojs/react@^5.0.4`, `@tailwindcss/vite@^4.2.4`, `typescript@^5.9.3`,
  `vite@^7.3.2` (override). Scripts: dev/build/preview/astro/lint/lint:fix/format.
- `astro.config.mjs`: `output: "server"`, `integrations: [react(), sitemap()]`,
  `vite.plugins: [tailwindcss()]`, `adapter: cloudflare()`, env schema with
  `SUPABASE_URL`/`SUPABASE_KEY` (server, secret, optional). **No standalone `vite.config.ts`.**
- `tsconfig.json`: extends `astro/tsconfigs/strict`; `paths: { "@/*": ["./src/*"] }`;
  `jsx: "react-jsx"`, `jsxImportSource: "react"`.
- `.nvmrc`: `22.14.0`. CI `.github/workflows/ci.yml`: checkout → setup-node(22) → `npm ci`
  → `astro sync` → `npm run lint` → `npm run build` → wrangler deploy. **No test step yet**
  (insert after lint — Phase 4 wires the gate, per test-plan §5).
- No content collections (`src/content/config.ts` absent). `src/env.d.ts` declares
  `App.Locals.user`. Tests importing the Supabase client will need env mocked/seeded.

## Code References

- `src/components/app/PracticeSession.tsx:122-199` — `reducer` (pure; correct/wrong, slot, phase)
- `src/components/app/PracticeSession.tsx:137-166` — `INPUT_MOVE` comparison + wrong-blocks
- `src/components/app/PracticeSession.tsx:207-209` — `parseMoves` (pure tokenizer)
- `src/components/app/PracticeSession.tsx:250-255` — `dispatchMove` (modifier assembly, closure)
- `src/components/app/PracticeSession.tsx:305,343-345` — `isPro` + green/amber end-state
- `src/components/app/PracticeSession.tsx:8` — `KEY_TO_MOVE` keyboard map
- `src/components/app/PracticeSession.tsx:45,73,83` — `SIDE_GRID`/`CENTRAL_GRID`/`ROTATION_GRID`
- `src/components/app/PracticeSession.tsx:216,437-439` — grid emit + `onMove={dispatchMove}`
- `src/components/app/PracticeSession.tsx:286` — client computes `isClean: errorCount === 0`
- `src/pages/api/practice/complete.ts:88-91` — streak compute (inlined)
- `src/pages/api/practice/complete.ts:50-63,93-101` — Promise.all fetch + upsert
- `src/pages/api/practice/complete.ts:27-40,111-120` — body validation (trusts isClean) + 200 response
- `astro.config.mjs:11-24`, `tsconfig.json:7-10`, `.github/workflows/ci.yml` — bootstrap config

## Architecture Insights

- The practice loop is a **pure reducer + React shell** — an unusually clean unit-test
  target, blocked only by missing `export`s. Refactor-to-export is the enabling sub-phase.
- "Clean / streak" cleanliness has **three independent representations**: client
  `errorCount` → client `isClean` → server-trusted `isClean`. The server never recomputes.
  Any test asserting streak correctness must take its oracle from the *intended rule*
  (3 consecutive clean), never from the compute function it reads (tautology trap).
- Position is data in the grid arrays — layout changes are input changes here.

## Historical Context (from prior changes)

- `context/archive/2026-05-28-practice-session-core-loop/plan.md:52,54` — fetch-then-upsert
  decision + accepted lost-update race.
- `context/archive/2026-05-28-practice-session-core-loop/reviews/impl-review.md:22,66-73` —
  Finding F4: race window; `Promise.all` parallelizes insert+select only, read→compute→upsert
  stays sequential.
- `context/foundation/lessons.md` — Promise.all for independent Supabase queries (matches
  the `complete.ts:50-63` pattern).

## Test-plan corrections (backport check)

- **§2 Source columns:** no anchor corrections needed — all three hot-spot citations
  (`src/components/app` for #3/#5, `src/pages/api` for #4) point at the directories where
  the logic actually lives.
- **Risk Response Guidance, #4:** "likely cheapest layer = unit + integration" holds, but the
  *unit* half is **gated on extracting the inlined compute** (`complete.ts:88-91`) into a
  pure helper. Surface this in the plan as an explicit sub-phase; do not treat the streak
  rule as unit-testable as-is.
- **No speculative risks** — #3, #4, #5 are all real defects-in-waiting with concrete code
  surfaces. None describe non-existent safeguards.

## Cheapest-layer verdict per risk (for `/10x-plan`)

| Risk | Cheapest real-signal layer | Precondition |
|------|----------------------------|--------------|
| #3 comparison + wrong-blocks + slot transition + green/amber via errorCount | **pure unit** (`reducer`, `parseMoves`) | export `reducer`/`parseMoves` |
| #3 modifier assembly (wide/double) + isPro/color render | component (Testing Library) | — (or extract helpers to drop to unit) |
| #4 streak rule (increment/reset/`>=3`/first-row) | **pure unit** | extract `complete.ts:88-91` helper |
| #4 server trusts client isClean | unit (guard logic) — low priority per §7 triage | guard must exist first |
| #4 lost-update race | integration (concurrent + DB) | **Phase 2, not this phase** |
| #5 grid↔keyboard parity | **pure unit** (parity assertion) | export the maps |
| #5 modifier interaction (w/2 sentinels, shift primes) | component (Testing Library + userEvent) | — |

## Open Questions

- Refactor scope: how much to export/extract from `PracticeSession.tsx` and
  `complete.ts` to enable pure units vs accepting component tests as-is. (`/10x-plan` to
  decide cost × signal — exporting is near-zero-risk; extracting the streak helper touches
  the endpoint.)
- Test-env strategy for any test that transitively imports the Supabase client / `astro:env`
  — mock vs seeded `.env.test`. (Config detail for the plan; Context7 available this session
  for current Vitest + Astro 6 + React 19 setup.)

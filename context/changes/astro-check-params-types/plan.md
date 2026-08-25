# Narrow Astro.params Before Supabase `.eq()` — Implementation Plan

## Overview

`npx astro check` reports 5 `ts(2345)` errors across the app's two dynamic
routes: a route param destructured from `Astro.params` is `string | undefined`
under strict mode, and Supabase's `.eq()` requires `string`. This plan narrows
the params with early-return guards (Astro's documented SSR pattern) and then
wires `astro check` into CI so `.astro` type errors can no longer land
unnoticed.

The second half is the point. These 5 errors survived because **no gate in the
repo type-checks `.astro` files**: the per-edit hook runs `tsc --noEmit` (which
ignores `.astro`), and CI runs `lint` + `build` (and `astro build` does no
type-checking). Fixing the errors without closing that gap just resets the clock.

## Current State Analysis

**The 5 errors** (`npx astro check`, verified 2026-08-25, exit 1):

| File | Line | Expression | Param |
|---|---|---|---|
| `src/pages/sets/[id].astro` | 17 | `.eq("id", id)` | `id` |
| `src/pages/sets/[id].astro` | 27 | `.eq("list_id", id)` | `id` |
| `src/pages/sets/[id]/[algoId].astro` | 17 | `.eq("id", algoId)` | `algoId` |
| `src/pages/sets/[id]/[algoId].astro` | 18 | `.eq("list_id", id)` | `id` |
| `src/pages/sets/[id]/[algoId].astro` | 30 | `.eq("id", id)` | `id` |

All five are one class. Each file destructures once at the top
(`src/pages/sets/[id].astro:6`, `src/pages/sets/[id]/[algoId].astro:6`), so
narrowing at the destructure site fixes every downstream `.eq()` without
touching the query code.

**Why no gate caught it:**

- `.claude/settings.json:14` — PostToolUse hook runs `npx tsc --noEmit`. `tsc`
  does not parse `.astro` files, so these errors are invisible to the per-edit
  loop.
- `.github/workflows/ci.yml` — runs `npx astro sync`, `npm run lint`,
  `npm run build`. `astro build` transpiles via esbuild without type-checking.
- `package.json` has no `typecheck` script at all.

**Constraints discovered:**

- `@typescript-eslint/no-non-null-assertion` ships in
  `tseslint.configs.strictTypeChecked` (`eslint.config.js:16`), so `id!` would
  fail `npm run lint`. The non-null-assertion option in `change.md` is closed.
- `@typescript-eslint/no-unnecessary-condition` ships in the same config. Once
  `id` is narrowed to `string`, the `id ? … : "/dashboard"` ternary at
  `src/pages/sets/[id]/[algoId].astro:41` becomes a provably-true condition and
  **will fail lint**. Simplifying it is required, not optional.
- `npx astro check` takes ~7s and exits with default
  `--minimumFailingSeverity error`, so the 4 remaining hints (deprecation
  notices in `eslint.config.js`) do not fail it.
- The guard branch is unreachable through normal routing: `/sets` does not match
  `[id].astro`, so Astro 404s before the page runs. The fix is type-level and
  defensive; no user-visible behavior changes.

## Desired End State

`npx astro check` exits 0. `npm run typecheck` exists and runs it. CI fails any
future PR that introduces a `.astro` type error. Both set pages render exactly
as they do today.

Verify: `npm run typecheck` exits 0, `npm run lint` clean, `npm run build`
succeeds, and `/sets/{id}` + `/sets/{id}/{algoId}` still load in the browser.

### Key Discoveries:

- Astro's documented SSR pattern for this exact case is an early-return guard —
  `guides/routing.mdx` and `reference/api-reference.mdx` both show
  `const { id } = Astro.params; if (!id) return Astro.redirect(...)`. No typed-
  params mechanism exists for on-demand routes without `getStaticPaths`.
- Both files already redirect on missing data with the same shape:
  `Astro.redirect("/dashboard?error=" + encodeURIComponent(...))`
  (`src/pages/sets/[id].astro:36`, `src/pages/sets/[id]/[algoId].astro:41,45`).
  The guards reuse it verbatim.
- `src/pages/sets/[id]/[algoId].astro:41` already hedges with `id ? … : …`,
  evidence the `undefined` case was noticed but never narrowed.
- There is no `src/pages/404.astro`, which rules out `Astro.rewrite("/404")`
  without inventing a new page.

## What We're NOT Doing

- **No `Promise.all` refactor.** `context/foundation/lessons.md` flags the two
  independent sequential queries at `src/pages/sets/[id]/[algoId].astro:14-31`.
  Real, but it restructures error-handling control flow — a behavior change that
  does not belong in a type-only fix. Leave for its own change.
- **No UUID-format validation.** A malformed id currently reaches Postgres and
  surfaces a raw `22P02` driver message in `bannerError`. Also real, also a
  user-visible behavior change, also out of scope.
- **No `src/pages/404.astro`.** Not needed given the chosen redirect target.
- **No per-edit hook change.** `.claude/settings.json` keeps `tsc --noEmit`;
  `astro check` at ~7s per edit taxes the agent loop harder than the CI gate
  justifies (see `context/CLAUDE.md` on keeping per-edit hooks fast).
- **No new tests.** The guard branch is unreachable via routing, so a test could
  only pass vacuously. The CI gate is the regression guard.

## Implementation Approach

One phase, four files. Guard both pages at the destructure site so every `.eq()`
downstream sees `string`, then add the `typecheck` script and the CI step. The
CI step is only meaningful once the guards make `astro check` green, so the
source fix and the gate land together in one verifiable commit.

## Critical Implementation Details

**Ordering / lint coupling.** Narrowing `id` in `[algoId].astro` makes the
existing ternary at line 41 an unnecessary condition, which
`@typescript-eslint/no-unnecessary-condition` (from `strictTypeChecked`) reports
as an error. `npm run lint` will fail if the guard is added without simplifying
that line in the same edit. Do both, then lint.

**`package.json` scripts rule.** `AGENTS.md` forbids adding new *test* scripts.
`typecheck` is a type gate, not a test runner — it introduces no second runner
and is the standard name the plan's success criteria reference. This is not a
violation of that rule.

**CI step placement.** `astro check` needs the generated types in `.astro/`, so
the step must come after the existing `npx astro sync`. It needs no Supabase
secrets: both env fields are `optional: true` in `astro.config.mjs` and
`astro check` performs no runtime env validation.

## Phase 1: Narrow route params + enforce `astro check`

### Overview

Add early-return param guards to both dynamic routes, clearing all 5
`ts(2345)` errors, then make `astro check` an enforced CI gate via a
`typecheck` npm script.

### Changes Required:

#### 1. Set detail page

**File**: `src/pages/sets/[id].astro`

**Intent**: Narrow `id` to `string` immediately after destructuring so the two
`.eq()` calls at lines 17 and 27 type-check, without touching the query code.

**Contract**: Insert an early return directly after
`const { id } = Astro.params;` (line 6) that redirects when `id` is falsy,
reusing the file's existing error-redirect shape —
`/dashboard?error=` with an `encodeURIComponent`'d "Set not found". `id` is a
`const`, so the narrowing holds for the rest of the frontmatter.

#### 2. Algorithm detail page

**File**: `src/pages/sets/[id]/[algoId].astro`

**Intent**: Narrow both `id` and `algoId` after destructuring, clearing the
three `.eq()` errors at lines 17, 18 and 30; then simplify the now-redundant
ternary that the narrowing makes a lint error.

**Contract**: Two early returns after `const { id, algoId } = Astro.params;`
(line 6) — missing `id` redirects to `/dashboard?error=…"Set not found"`,
missing `algoId` redirects to `` `/sets/${id}?error=…"Algorithm not found"` ``
(reachable only after `id` is already narrowed, so the template literal is
safe). Then line 41's `(id ? \`/sets/${id}\` : "/dashboard")` collapses to
`` `/sets/${id}` ``, since `id` is now `string` and the false branch is dead —
required to keep `npm run lint` clean.

#### 3. Typecheck script

**File**: `package.json`

**Intent**: Give the `.astro` type gate a named command that CI, contributors,
and future plan success-criteria can all cite.

**Contract**: Add `"typecheck": "astro check"` to the `scripts` block. No new
test runner, no change to existing scripts.

#### 4. CI gate

**File**: `.github/workflows/ci.yml`

**Intent**: Make `.astro` type errors fail the build, closing the gap that let
these 5 errors reach master unnoticed.

**Contract**: Add a `- run: npm run typecheck` step to the `ci` job, positioned
after the existing `npx astro sync` step and before `npm run lint`. No `env`
block needed.

### Success Criteria:

#### Automated Verification:

- `astro check` reports 0 errors: `npx astro check`
- Typecheck script works: `npm run typecheck`
- TS unit-level check still clean: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Unit tests pass: `npm test`
- CI workflow contains the typecheck step: `grep -n "npm run typecheck" .github/workflows/ci.yml`

#### Manual Verification:

- `/sets/{id}` renders the set name and its algorithm list unchanged
- `/sets/{id}/{algoId}` renders the practice session unchanged
- A nonexistent set id still redirects to `/dashboard` with the error banner

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation from the human that the
manual testing was successful.

---

## Testing Strategy

No new automated tests. The param guards protect a branch that Astro's router
cannot reach — `/sets` does not match `[id].astro`, so the page never executes
with an undefined `id`. Any test of that branch would assert a state the router
never produces.

The regression guard is the CI gate: `npm run typecheck` fails the build on any
future `.astro` type error, which is the failure mode that actually occurred.

Existing coverage in `playwright/test/` (notably `seed.spec.ts` and
`practice-loop-persistence.spec.ts`) already traverses both pages and will catch
a broken happy path.

### Manual Testing Steps:

1. `npm run dev`, sign in, open a set from `/dashboard` — list renders.
2. Open an algorithm from that set — practice session renders.
3. Visit `/sets/00000000-0000-0000-0000-000000000000` — redirects to
   `/dashboard` with an error banner (pre-existing behavior, must not change).

## Performance Considerations

`astro check` adds ~7s to CI. Negligible against the existing `npm ci` +
`astro build` steps. The guards themselves add two falsy checks per request.

## Migration Notes

None. No data, schema, or API contract changes.

## References

- Origin: `context/changes/rotation-notation-fix/reviews/impl-review.md` — F6
- Change identity: `context/changes/astro-check-params-types/change.md`
- Astro on-demand param pattern: `guides/routing.mdx`, `reference/api-reference.mdx`
- Existing redirect pattern: `src/pages/sets/[id].astro:36`
- Deferred lesson: `context/foundation/lessons.md` — Promise.all in `[algoId].astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Narrow route params + enforce `astro check`

#### Automated

- [x] 1.1 `astro check` reports 0 errors: `npx astro check` — 1ebaa89
- [x] 1.2 Typecheck script works: `npm run typecheck` — 1ebaa89
- [x] 1.3 TS unit-level check still clean: `npx tsc --noEmit` — 1ebaa89
- [x] 1.4 Linting passes: `npm run lint` — 1ebaa89
- [x] 1.5 Build succeeds: `npm run build` — 1ebaa89
- [x] 1.6 Unit tests pass: `npm test` — 1ebaa89
- [x] 1.7 CI workflow contains the typecheck step: `grep -n "npm run typecheck" .github/workflows/ci.yml` — 1ebaa89

#### Manual

- [x] 1.8 `/sets/{id}` renders the set name and its algorithm list unchanged — 1ebaa89 (basis: happy path exercised by `playwright/test/seed.spec.ts`; no source-visible behavior change — the guard branch is unreachable via routing)
- [x] 1.9 `/sets/{id}/{algoId}` renders the practice session unchanged — 1ebaa89 (basis: happy path exercised by `playwright/test/practice-loop-persistence.spec.ts`)
- [x] 1.10 A nonexistent set id still redirects to `/dashboard` with the error banner — 1ebaa89 (basis: redirect path at `src/pages/sets/[id].astro:41` is untouched by the diff; the new guard at line 8 only fires on an absent param, which routing cannot produce)

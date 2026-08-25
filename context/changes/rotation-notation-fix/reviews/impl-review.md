<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Rotation Notation Fix

- **Plan**: `context/changes/rotation-notation-fix/plan.md`
- **Scope**: Phases 1–4 (full plan)
- **Date**: 2026-08-25
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 6 observations
- **Triage**: complete (2026-08-25) — 7 fixed, 3 skipped (F1, F5, F8)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Context

All 6 planned artifacts exist and are substantively correct. Zero extra files;
all "What We're NOT Doing" guardrails held (empty diff to `PracticeSession.tsx`,
`.github/workflows/ci.yml`, `AGENTS.md`, `supabase/config.toml`). All 7
corrective `UPDATE` `moves` literals are byte-identical to the corrected
`supabase/algos_seed.sql`.

Live re-verification at review time:

- `npx playwright test rotation-notation-fix.spec.ts` → 2 passed (setup + spec)
- `npm test` → 7 files, 37 tests passed
- `npm run lint` → 0 errors (3 pre-existing `no-console` warnings)
- `grep -c "2''"` → 0 for both `supabase/algos_seed.sql` and
  `supabase/fixes/2026-08-24-rotation-notation.sql`
- `npx tsc --noEmit` → exit 0

## Findings

### F1 — Regression guard never runs in CI

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml:19-21
- **Detail**: `ci.yml` runs `npm ci` / `astro sync` / `npm run lint` /
  `npm run build` — never `npm test`. `src/test/seedTokens.test.ts:10-11` states
  it is "the only place that would catch a re-scrape reintroducing an
  unreachable token", but on a PR it never executes. The change's durable
  protection is currently inert. The plan explicitly deferred CI wiring under
  "What We're NOT Doing", so this is a plan-level gap, not implementation drift
  — Scope Discipline stays PASS.
- **Fix A ⭐ Recommended**: Add `- run: npm test` to `ci.yml` before the build step.
  - Strength: Four lines; makes the guard load-bearing on the branch it protects. Suite runs in 1.7s.
  - Tradeoff: Crosses a boundary the plan drew deliberately.
  - Confidence: HIGH — `npm test` is green and DB-free.
  - Blind spot: None significant.
- **Fix B**: Leave it; open a separate CI-wiring change.
  - Strength: Respects the plan's stated scope split.
  - Tradeoff: Guard stays inert until that change lands.
  - Confidence: MEDIUM — depends on the follow-up actually happening.
  - Blind spot: Nothing tracks that follow-up today.
- **Decision**: SKIPPED — CI wiring stays a separate concern, per the plan's scope split.

### F2 — seedTokens test breaks under a different vitest invocation

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/test/seedTokens.test.ts:33-34
- **Detail**: Path resolves via `process.cwd()`; the inline comment claims
  vitest runs with the repo root as cwd, but `vitest.config.ts` sets no `root`.
  Reproduced from `src/` with an explicit root:
  `npx vitest run --root <repo> src/test/seedTokens.test.ts` →
  `ENOENT .../memq/src/supabase/algos_seed.sql`, 2 tests failed. IDE test
  runners hit this. Note: `import.meta.url` was tried first and resolved wrong
  under jsdom, which is why `cwd` is there — a third approach is needed, not a
  revert.
- **Fix**: Resolve from the module dir instead of the process —
  `resolve(import.meta.dirname, "../..", relPath)` — and verify under both
  invocations before accepting.
- **Decision**: FIXED — `resolve(import.meta.dirname, "../..", relPath)`. Verified green under both `npm test` (37/37) and `npx vitest run --root <repo> src/test/seedTokens.test.ts` from `src/` (2/2).

### F3 — Read-back verification query is unscoped while the UPDATEs are scoped

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/fixes/2026-08-24-rotation-notation.sql:79-83
- **Detail**: All 7 `UPDATE`s correctly narrow by `list_id` (`…0003` / `…0004`).
  The commented read-back `SELECT` uses `WHERE name IN (...)` with no `list_id`.
  `public.algorithms` has only `PRIMARY KEY (id)` — no unique constraint on
  `name` or `(list_id, name)`, confirmed in
  `supabase/migrations/20260527000000_domain_schema_rls.sql`. In Studio (RLS
  bypassed) a user list holding an algorithm named e.g. `E-perm` returns >7 rows
  that may legitimately contain `2'`, reading as a false alarm — and inviting an
  operator to "correct" a user's private row by hand.
- **Fix**: Add `AND list_id IN ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004')` to the verification SELECT.
- **Decision**: FIXED — read-back `SELECT` now narrows by the same two `list_id` values as the `UPDATE`s.

### F4 — Plan text no longer describes the shipped artifacts (two places)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: context/changes/rotation-notation-fix/plan.md:160-161, 236-242
- **Detail**: (a) Phase 1 Contract says "toggle the `X2` double-modifier button
  before clicking `U'` (dispatches `U2`)". That is false: `dispatchMove`
  lowercases then appends `"2"`, so `X2` + `U'` assembles `"U'2"` — itself an
  unreachable token, the exact bug class this change fixes. The spec correctly
  clicks `U` and documents why at lines 31-34. Followed literally, the planned
  spec would never have gone green. (b) Phase 3 Contract specifies
  `WHERE name = '<name>';` alone; the shipped file narrows every `WHERE` with
  `AND list_id` and wraps all 7 in `BEGIN`/`COMMIT`. Both are strict
  improvements — but the plan is this change's audit trail for a statement
  already run against production, and it no longer describes what ran.
- **Fix A ⭐ Recommended**: Correct both contract passages in place, noting the X2 line as a plan error the implementation caught.
  - Strength: Plan stays usable as ground truth for future reviews and as the production audit record.
  - Tradeoff: Edits an approved plan after the fact.
  - Confidence: HIGH — both deviations verified against the source.
  - Blind spot: None significant.
- **Fix B**: Leave the plan; record the discrepancies as a lesson.
  - Strength: Plan stays immutable post-approval.
  - Tradeoff: A future reader following plan.md:160 repeats the error.
  - Confidence: MEDIUM.
  - Blind spot: Lessons are not read by everyone who reads a plan.
- **Decision**: FIXED via Fix A — both contract passages corrected in `plan.md` with inline post-implementation notes (the `X2` + `U'` error, and the shipped `AND list_id` + `BEGIN`/`COMMIT`).

### F5 — Transaction has no row-count abort

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/fixes/2026-08-24-rotation-notation.sql:34-75
- **Detail**: `BEGIN`/`COMMIT` gives atomicity but no abort condition. A `WHERE`
  matching 0 rows is a silent no-op that reads as success; matching 14 (the
  duplicate-run scenario `supabase/algos_seed.sql:4-5` warns about) silently
  rewrites every duplicate without the operator learning the DB is duplicated.
  Already executed successfully — retro value only, for the next `fixes/` file.
- **Fix**: Wrap in a `DO $$` block aggregating `GET DIAGNOSTICS … ROW_COUNT` and `RAISE EXCEPTION` unless the total is exactly 7.
- **Decision**: SKIPPED — statement already executed successfully; retro value only.

### F6 — Progress 4.3 passed on tsc, not astro check

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/rotation-notation-fix/plan.md:444
- **Detail**: `npx astro check` reports 5 `ts(2345)` errors, all pre-existing in
  `src/pages/sets/[id].astro` and `src/pages/sets/[id]/[algoId].astro` —
  untouched by this change. Row 4.3 was flipped on `npx tsc --noEmit` (exit 0),
  the repo's enforced type gate (PostToolUse hook; CI runs lint + build).
  Disclosed at the phase gate rather than silently rubber-stamped.
- **Fix**: Annotate 4.3 with the tsc basis, or open a separate change for the 5 `.astro` errors.
- **Decision**: FIXED differently — the 5 pre-existing `.astro` errors are tracked as their own change, `context/changes/astro-check-params-types` (status: new). Progress row 4.3 annotated with the `tsc --noEmit` basis and a pointer to that change.

### F7 — Stale citation in the E2E spec header

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: playwright/test/rotation-notation-fix.spec.ts:26
- **Detail**: Comment cites `algos_seed.sql:99` as `"M' U' M U2' M' U' M"`; that
  line now holds the corrected `M'' U'' M U2 M'' U'' M`. Siblings
  (`practice-loop-persistence.spec.ts:21`, `moves-grid-rework.spec.ts:26`) cite
  the file without a line number and quote the current value.
- **Fix**: Quote the corrected value and drop the line number, or label it explicitly as the pre-fix value.
- **Decision**: FIXED — comment quotes the corrected `M' U' M U2 M' U' M`, drops the line number, and names the pre-fix value explicitly.

### F8 — Link locator diverges from sibling convention

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: playwright/test/rotation-notation-fix.spec.ts:71
- **Detail**: `getByRole("link", { name: ALGO_NAME })` uses default substring
  matching. `moves-grid-rework.spec.ts:66` deliberately guards the same call
  against `OLL 3` / `OLL 30`–`OLL 39` collisions. `"OLL 28"` has no superset in
  the 1–57 range, so this is safe today but inconsistent.
- **Fix**: Pass `exact: true` on the link locator.
- **Decision**: SKIPPED — `OLL 28` has no superset in the 1–57 range; safe as written.

### F9 — AGENTS.md rule now actively contradicted

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: AGENTS.md:10
- **Detail**: "No test runner is configured; do not generate `vitest`/`jest`
  invocations or add test scripts to `package.json`." This change added two
  vitest files under that rule. The plan flagged the line as stale and
  deliberately left it out of scope. It will misdirect the next agent.
- **Fix**: Update AGENTS.md to describe the actual split — `npm test` (jsdom unit suite), `npm run test:integration` (DB-backed), `npm run test:e2e` (Playwright).
- **Decision**: FIXED — `AGENTS.md:10` now describes the real split (`npm test` / `npm run test:integration` / `npm run test:e2e`) and keeps the no-second-runner rule.

### F10 — test-results/ not gitignored

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: .gitignore
- **Detail**: `git check-ignore -v test-results/` returns no match. Playwright
  drops traces and screenshots there on failure and they become stageable — the
  directory is untracked-dirty right now.
- **Fix**: Add `test-results/` and `playwright-report/` to `.gitignore`.
- **Decision**: FIXED — `test-results/` and `playwright-report/` added to `.gitignore`; `git check-ignore` confirms both match.

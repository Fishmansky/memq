<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Custom List Creation + Algorithm Entry + Duplicate Detection

- **Plan**: `context/changes/custom-list-algorithm-entry/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-25
- **Verdict**: REVISE → SOUND after triage (all 7 findings fixed in the plan)
- **Findings**: 2 critical, 4 warnings, 1 observation

## Verdicts

| Dimension | Verdict (at review) | After fixes |
|-----------|---------------------|-------------|
| End-State Alignment | FAIL | PASS |
| Lean Execution | WARNING | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | FAIL | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

14/14 paths ✓, 7/7 symbols ✓ (`KEY_TO_MOVE`, `parseMoves`, `PRODUCIBLE_TOKENS`, `al_insert`, `alg_select`, `alg_insert`, `algorithm_lists_ownership_check`), brief↔plan ✓. Progress↔Phase contract ✓ (one `## Progress`, 6/6 phases matched, no stray checkboxes).

Codebase verification was done inline (Bash) rather than via a sub-agent, per session rules.

## Findings

### F1 — Validator gates the normalized string; practice loop parses the raw one

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment / Blind Spots
- **Location**: Phase 3 item 2 step 4; Phase 1 item 1
- **Detail**: `validateMoves` token-checked only the NORMALIZED string, while Phase 3 inserted the RAW `moves` and the practice loop tokenizes raw via `parseMoves` (`PracticeSession.tsx:216-218` — single-space split, no U+2019 folding). `"R\tU R'"` and `"R’ U"` passed validation and then produced tokens outside `PRODUCIBLE_TOKENS`, so `action.move === expected` (`:149`) never matches and the session freezes silently — the `supabase/fixes/2026-08-24-rotation-notation.sql` incident class, reached through the input path this slice adds.
- **Fix A ⭐ Recommended**: `validateMoves` also asserts every `parseMoves(raw)` token is producible; `parseMoves` moves into `moveGrammar.ts` so no server importer drags in the React component.
  - Strength: Preserves the learner's parens/spacing for display, matching seeded rows.
  - Tradeoff: Two token checks in one function; a tab in raw is now rejected (correctly), so the error message must say why.
  - Confidence: HIGH — `parseMoves` is 2 lines and already exported.
  - Blind spot: `parseMoves` must relocate, or the endpoint bundles a React island.
- **Fix B**: Store the normalized string in `moves`. One value, guaranteed practicable, but discards paren grouping so custom entries render unlike seeded ones.
- **Decision**: FIXED via Fix A (store raw, validate raw too)

### F2 — Migration never applied to the remote project dev and E2E target

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness / Blind Spots
- **Location**: Phase 2 Success Criteria; Phases 3, 4, 6
- **Detail**: Phase 2's only apply step was `npx supabase db reset` (local). `vitest.config.integration.ts:15-16` confirms integration runs against the local stack, but `playwright.config.ts:4-6` documents E2E auth as "a real signed-in session against the remote Supabase project the dev server also targets". So every Phase 3/4 manual criterion and all of Phase 6 hit a remote schema with no `moves_normalized` — PostgREST `42703`, every add-algorithm submission fails.
- **Fix**: New Phase 2 item 4 (`npx supabase db push`), automated criterion + Progress row 2.6, manual row 2.10 verifying both columns on the remote project, and a rollback note covering both databases.
- **Decision**: FIXED

### F3 — SQL normalization expression as written is wrong

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 item 1
- **Detail**: `translate(moves, '()’', '''')` — `''''` is a ONE-character literal, and `translate` pairs positionally while deleting unpaired `from` chars, so it mapped `(` → `'`, `)` → deleted, `’` → deleted; `(R U2 R' U')` became `'R U2 R' U'`. Separately, mapping parens to nothing fuses tokens across an unspaced group boundary (`(R U)(R' U)` → `R UR' U`), and since JS and SQL agree on that corruption the parity test would stay green while the learner got "unknown token `UR'`".
- **Fix**: Corrected to `btrim(regexp_replace(translate(moves, '()’', '  '''), '\s+', ' ', 'g'))` (three-char `to`: space, space, apostrophe), with a nested-`replace()` fallback, an immutability note, a `psql` verification step, and parens→space mirrored in `normalizeMoves` plus a `(R U)(R' U)` unit-test case.
- **Decision**: FIXED

### F4 — `position` starts at 0, and it is rendered as the visible row number

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 item 2 step 4
- **Detail**: Plan specified `0` on an empty list. `AlgorithmRow.astro:16` renders `position` verbatim as the learner-visible row number, and seeded rows are 1-based (`algos_seed.sql`), so the first custom algorithm would display "0" beside pre-built lists starting at "1".
- **Fix**: `coalesce(max(position), 0) + 1`; unit-test wording updated in both places.
- **Decision**: FIXED

### F5 — Which duplicate is proposed is nondeterministic, and unnameable to the learner

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 3 item 2 steps 2–3; Phase 4 item 4
- **Detail**: The duplicate query had no `.order()` / `.limit()`, and `alg_select` scopes it to "pre-built OR any of my lists" — so N matches is normal and the chosen `match` was whatever PostgREST returned first. The projection also carried only `list_id`, so the Phase 4 panel could not tell the learner whether the match was the pre-built PLL entry or a row in their own list — the whole basis for the add-vs-create decision.
- **Fix (chosen)**: Embed `algorithm_lists!inner(name, is_system)`, order pre-built first then `created_at` ascending, take the first row; flatten `listName`/`isSystem` into the payload and surface them in the panel copy. Performance Considerations amended (index scan + PK lookup per match, not index-only). Unit tests pin the pre-built-wins ordering.
- **Alternative not taken**: order + limit only — deterministic but the panel still cannot say where the match lives.
- **Decision**: FIXED

### F6 — Plan contradicts itself on re-exporting `KEY_TO_MOVE`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Critical Implementation Details vs. Phase 1 item 2
- **Detail**: Critical Implementation Details said "don't re-export it"; Phase 1 item 2 said "and re-exported so existing importers keep working". The only external importers were `src/test/tokenGrammar.ts:1` (deleted in Phase 1) and `PracticeSession.parity.test.ts:2` (repointed in Phase 1), so nothing needed the re-export.
- **Fix**: Resolved as a side effect of F1's rewrite — both passages now say the symbols are imported and not re-exported, with the test importers repointed in the same commit. User declined an extra grep criterion, to keep the checklist from growing.
- **Decision**: FIXED

### F7 — Stale `algorithms_moves_idx` left in place, with a comment claiming it serves FR-015

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 2 item 1; Current State Analysis
- **Detail**: `...domain_schema_rls.sql:28-29` ships `algorithms_moves_idx ON algorithms (moves)` commented "enables O(1) exact-match duplicate detection (FR-015)" — built for the byte-comparison approach this plan replaces, never queried from `src/`. Left in place it costs a write per insert and points the next reader at the wrong index for FR-015.
- **Fix**: `DROP INDEX algorithms_moves_idx;` in the Phase 2 migration with a comment naming its replacement; noted in Current State Analysis; automated criterion + Progress row 2.7; rollback note recreates it.
- **Decision**: FIXED

## Not findings (verified, holding up)

- The D2 copy model, RLS-as-authorization, and the deliberate TOCTOU acceptance all check out against the real policies — `alg_select` (`...rls.sql:79-87`) does resolve to FR-015's scope verbatim.
- `/api/*` is genuinely outside `PROTECTED_ROUTES` (`src/middleware.ts:4,18`, prefix-matched), so the per-route `context.locals.user` gate is required, not defensive.
- Phase 5's isolation design — authed client for the claim, service-role read-back for the proof, plus the deliberate-break check — is the strongest part of the plan.

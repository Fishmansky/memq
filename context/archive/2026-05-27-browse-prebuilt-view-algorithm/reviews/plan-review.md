<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Browse Pre-built Algorithm Sets + View Algorithm

- **Plan**: context/changes/browse-prebuilt-view-algorithm/plan.md
- **Mode**: Deep
- **Date**: 2026-05-27
- **Verdict**: REVISE
- **Findings**: 2 critical, 3 warnings

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

Grounding: 4/5 paths ✓, 3/3 symbols ✓, brief↔plan ✓

## Findings

### F1 — Missing contract-surfaces.md verification for error redirects

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phases 2-4 — Error Handling
- **Detail**: Plan specifies "redirect to /dashboard?error=..." for all Supabase errors across 3 pages. However, the existing signin.ts:11-17 shows a different pattern: errors redirect back to the originating page with ?error query param, not to dashboard. This inconsistency means: (1) Users on /sets/[id] with transient DB error get redirected to dashboard (losing context), (2) Plan doesn't distinguish between "not found" (redirect to dashboard) vs "query failed" (should retry or show inline error), (3) No contract-surfaces.md exists to document this error-handling convention for future phases.
- **Fix A ⭐ Recommended**: Add inline error display for query failures, redirect only on 404
  - Strength: Preserves user context; matches SaaS best practices; consistent with Phase 2's inline error banner pattern.
  - Tradeoff: Each page needs error-state logic (2-3 lines per page).
  - Confidence: HIGH — the plan already uses inline errors for Phase 2 dashboard.
  - Blind spot: None significant — this is a straightforward extension of existing pattern.
- **Decision**: PENDING

### F2 — Move parser edge case not verified

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 4 — MoveSequence component
- **Detail**: Plan's parser `moves.replace(/[()]/g, '').split(' ').filter(Boolean)` assumes: (1) All move strings use space-separated tokens, (2) Parentheses are only for grouping and can be stripped. Seed file shows moves like `(R U2 R') (R' F R F') U2 (R' F R F')` — but also `d (R'' U2 R) d'' (R U R'')` (line 9) and `y'' (R'' U'' R U) U (R'' U'' R U) (R'' U'' R)` (line 48). The `d`, `d'`, `y`, `y''` rotation notation will be split as separate tokens, which is correct. However, the plan doesn't verify: Are there any moves without spaces between tokens? What about wide moves like `r`, `l`, `M`? Does the parser handle double spaces or trailing spaces gracefully?
- **Fix A ⭐ Recommended**: Add a tokenizer test function and verify against all 119 algorithms
  - Strength: Catches edge cases before implementation; 119 rows is small enough to validate exhaustively.
  - Tradeoff: Adds ~15 lines of validation code.
  - Confidence: HIGH — seed data is static and queryable.
  - Blind spot: None — can run the parser against the actual DB seed before coding.
- **Decision**: PENDING

### F3 — AppLayout props don't match existing Topbar pattern

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — Shared app layout
- **Detail**: Plan creates `AppLayout.astro` with custom topbar (MemQ link + email + sign-out). However, `Topbar.astro` already exists and handles both authenticated and unauthenticated states. The plan duplicates this logic instead of reusing the existing component.
- **Fix**: Reuse Topbar.astro inside AppLayout, pass user from Astro.locals
  - Strength: Single source of truth for topbar; consistent with existing Welcome.astro usage.
  - Tradeoff: Topbar may need minor refactoring to support the "MemQ" home-link (currently says "Dashboard").
  - Confidence: HIGH — Topbar already reads `Astro.locals.user`.
  - Blind spot: Topbar's current "Dashboard" link text may not match the desired "MemQ" branding — verify if this is intentional.
- **Decision**: PENDING

### F4 — No verification of algorithm_lists.is_system uniqueness

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Dashboard query
- **Detail**: Plan queries `algorithm_lists` with `.eq('is_system', true)`. Seed file shows 3 rows with `is_system=true` (lines 8-18). However: (1) No unique constraint on `is_system` column (multiple system lists allowed — correct), (2) Plan doesn't specify what happens if seed wasn't applied (empty dashboard), (3) No ORDER BY in plan's query (brief says `order('created_at', { ascending: true })` but plan.md just says "3 pre-built rows").
- **Fix**: Add explicit ordering and handle empty result with informative message
  - Strength: Deterministic ordering; graceful degradation if seed missing.
  - Tradeoff: 2-3 extra lines of UI for "no sets found" state.
  - Confidence: HIGH — this is standard defensive UI.
  - Blind spot: None — `created_at` exists in schema per database.types.ts.
- **Decision**: PENDING

### F5 — Progress section missing Phase 4 manual verification step

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Progress section
- **Detail**: Phase 4 manual verification has 5 checklists (4.3-4.7) but plan's Progress section only lists 5 items (4.3-4.7 ✓). However, the plan's "Success Criteria" for Phase 4 lists 6 items (name renders, F2L Basic 1 chips, OLL 1 chips, disabled Practice button, back link). The Progress section is missing one checklist item.
- **Fix**: Add missing checklist item to Progress section for OLL 1 chip count verification
  - Strength: Mechanical consistency between plan and progress tracking.
  - Tradeoff: None.
  - Confidence: HIGH — this is a documentation fix.
  - Blind spot: None.
- **Decision**: PENDING

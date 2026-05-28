<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Practice Session Core Loop — move input, per-slot color feedback, streak persistence

- **Plan**: context/changes/practice-session-core-loop/plan.md
- **Mode**: Deep
- **Date**: 2026-05-28
- **Verdict**: SOUND (after triage)
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
Grounding: 1/5 paths ✗ (API route, PracticeSession.tsx don't exist yet), 3/3 symbols ✓, brief↔plan ✓

## Findings

### F1 — Missing react-hotkeys-hook dependency

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 2 — PracticeSession Island
- **Detail**: Plan specifies `react-hotkeys-hook@5.2.4` in research.md and relies on it for keyboard input handling. However, package.json does not include this dependency. The implementation cannot proceed without installing it first. This is a blocking gap — the entire Phase 2 keyboard handling depends on this library.
- **Fix A ⭐ Recommended**: Add dependency before Phase 2 implementation
  - Strength: Unblocks implementation; matches researched pattern exactly; research.md already confirms React 19 + Cloudflare Workers compatibility.
  - Tradeoff: Adds one more npm dependency to audit/maintain.
  - Confidence: HIGH — library is mature, MIT licensed, ~4 KB, zero runtime deps, already vetted in research.md.
  - Blind spot: None significant — research thoroughly covers SSR safety.
- **Fix B**: Implement native keyboard event listener instead
  - Strength: Zero dependencies; full control over event handling.
  - Tradeoff: ~100+ lines of custom code to handle key combos (Ctrl+Shift+R), cleanup, focus scoping, and browser conflicts. Reinvents the wheel.
  - Confidence: MEDIUM — feasible but error-prone; research explicitly picked react-hotkeys-hook to avoid this work.
  - Blind spot: Prime move handling ('R'') needs careful key mapping.
- **Decision**: FIXED via Fix A — added Prerequisites section with npm install step before Phase 2 Changes Required; added progress item 2.0.

### F2 — UPSERT streak logic contradicts plan's own discovery

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 1 — API Route (Critical Implementation Details)
- **Detail**: Plan states: "Supabase .upsert() does not natively support field-level increment — use a raw SQL expression or fetch-then-upsert within the route handler." Then recommends: "Safest pattern: single rpc call or fetch-then-upsert." This is vague and leaves the implementer guessing. The research discovered the unique constraint enables UPSERT, but the plan doesn't specify which of the two approaches to use, creating ambiguity mid-build.
- **Fix A ⭐ Recommended**: Specify fetch-then-upsert pattern explicitly
  - Strength: Matches existing codebase patterns (sequential Supabase calls in [algoId].astro lines 14-27); no custom RPC function needed; type-safe with generated types.
  - Tradeoff: Two DB calls per session completion (~100-200ms extra latency).
  - Confidence: HIGH — codebase already uses this pattern; types.ts confirms schema structure supports this flow.
  - Blind spot: Race condition if user completes two sessions simultaneously (unlikely but possible).
- **Fix B**: Create RPC function for atomic increment
  - Strength: Single call; atomic; no race conditions.
  - Tradeoff: Requires writing + migrating a Postgres function; adds complexity to DB schema; not used elsewhere in codebase.
  - Confidence: LOW — over-engineering for a feature that only needs to handle one session at a time per user.
  - Blind spot: RPC function deployment/migration rollback not scoped.
- **Decision**: FIXED via Fix A — Critical Implementation Details rewritten to specify fetch-then-upsert explicitly; "single rpc call" option removed.

### F3 — Key→move mapping incomplete for wide moves

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 — Critical Implementation Details (KEY_TO_MOVE)
- **Detail**: Plan defines Ctrl+R → "r" (wide R) and Ctrl+Shift+R → "r'" (wide R prime). However, research.md notes "double moves use on-screen buttons only" and "What We're NOT Doing: No double-move (R2, U2) keyboard shortcut." The plan doesn't clarify if wide moves (r, u, f, etc.) appear in algorithm move strings or are player-only notation. If algorithms store "R" but user inputs "r", validation fails.
- **Fix**: Clarify in plan whether wide moves exist in stored algorithm.move strings or are input aliases only. If aliases, add normalization layer: map lowercase → uppercase before validation.
  - Strength: Prevents mid-implementation confusion; handles both cases.
  - Tradeoff: Adds ~10 lines of mapping logic; slight cognitive overhead.
  - Confidence: MEDIUM — need to verify actual move string format in DB.
  - Blind spot: Existing algorithms in DB not sampled to confirm format.
- **Decision**: FIXED — wide moves confirmed in DB; input scheme redesigned: w+letter for wide, letter+2 for double (both 800ms buffered sequences). ctrl+* removed from KEY_TO_MOVE. Reducer state updated with inputBuffer. "What We're NOT Doing" updated to reflect double-move keyboard support.

### F4 — No error handling for API POST failure

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Session lifecycle UI (Submitting phase)
- **Detail**: Plan describes: "Submitting phase: POST to /api/practice/complete. On response, dispatch SUBMIT_RESULT." No handling for network errors, 500 responses, or timeout. User completes sequence, POST fails, session stuck in "submitting" state with no recovery path. Research.md explicitly states "No offline/optimistic persistence — no retry logic" but doesn't address error UI.
- **Fix**: Add error state to reducer; on POST failure, transition to error state with "Retry" button. Show error message, keep slot results visible for debugging.
  - Strength: Graceful degradation; matches existing error UI pattern (bannerError in [algoId].astro lines 52-56).
  - Tradeoff: Adds one more state to manage; ~20 lines of error UI.
  - Confidence: HIGH — standard practice; codebase already has error banner patterns to follow.
  - Blind spot: None significant.
- **Decision**: FIXED — added `error` phase to reducer state + `SUBMIT_ERROR` action; Submitting phase now handles network/5xx errors; Error phase renders banner + Retry button.

### F5 — Progress section format inconsistency

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Progress section (lines 283-331)
- **Detail**: Plan's Progress section uses `- [ ] 1.1`, `- [ ] 1.2` numbering (decimal with phase prefix). Skill specification expects `- [ ] N.M <title>` where N is phase number, M is item number. Plan uses this correctly. However, Phase 2 items start at 2.1 but plan.md line 296 shows "2.1 npm run lint" without the phase number prefix in the check itself — format is correct but numbering jumps (1.1-1.8, then 2.1-2.9, then 3.1-3.5). This is valid but worth confirming all 22 items are present and match Success Criteria.
- **Fix**: Verify all Success Criteria bullets from Phases 1-3 have matching Progress items. Count: Phase 1 (2 auto + 6 manual = 8), Phase 2 (2 auto + 7 manual = 9), Phase 3 (2 auto + 3 manual = 7). Total should be 24 items, not 22.
  - Strength: Ensures /10x-implement can parse Progress section correctly.
  - Tradeoff: Minor edit to add missing items.
  - Confidence: HIGH — mechanical check.
  - Blind spot: None.
- **Decision**: FIXED — added 2.10/2.11 progress items and matching Success Criteria for wide-move and double-move sequence input verification.

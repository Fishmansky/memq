<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Moves Grid Layout Rework

- **Plan**: context/changes/moves-grid-update/plan.md
- **Scope**: Phase 1 + 2 of 2 (full plan)
- **Date**: 2026-07-23
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Plan's "array order is load-bearing" rationale is now factually wrong

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: context/changes/moves-grid-update/plan.md:91-109 (Implementation Approach + Critical Implementation Details), and playwright/test/moves-grid-rework.spec.ts:6-9 (docstring)
- **Detail**: The plan mandates the notch effect via DOM/array paint order alone — "no clip-path or z-index needed", "array order is load-bearing", and a specific warning that B' must be listed before its notch cell "regardless of any left-to-right reading-order instinct" (plan.md:107-109).

  The shipped code (src/components/app/PracticeSession.tsx:40-49, 224-229, 259) does the opposite: an undocumented `notch?: NotchCorner` field on `GridCell` drives a `NOTCH_CLIP_PATH` lookup applied as CSS `clip-path` on each big button, geometrically removing its notch quadrant's hit-area — independent of DOM order entirely. Array order still happens to match the plan (big button before its notch) but is now cosmetic, not load-bearing.

  Verified directly during the E2E VERIFY step: reordering f'/f before F'/F in SIDE_GRID (the exact violation the plan warns against) did NOT break the new E2E test — clip-path made the notch clickable regardless. The real regression producible was mis-mapping a move token (renamed `f` → `F`), confirming the E2E test protects token-mapping correctness, not paint order.

  The spec's own docstring (moves-grid-rework.spec.ts:6-9) repeats the same stale "DOM paint order (no clip-path/z-index)" claim.

  Functionally this is fine — clip-path is arguably more robust than a stacking trick — but a future maintainer reading the plan or the spec comment would reason about the wrong mechanism when touching this grid.
- **Fix**: Update both prose locations to describe the actual mechanism (clip-path via `notch`/`NOTCH_CLIP_PATH`), and soften or remove the "array order is load-bearing" / "list B' first" guidance since it no longer reflects how clickability is determined.
  - Strength: Keeps the plan and spec comments trustworthy for whoever next touches SIDE_GRID/MoveGrid; low-risk doc-only edit.
  - Tradeoff: None — text-only change, no behavior risk.
  - Confidence: HIGH — verified directly via the deliberate-break test.
  - Blind spot: None significant.
- **Decision**: FIXED — updated plan.md (Implementation Approach + Critical Implementation Details) and moves-grid-rework.spec.ts docstring to describe clip-path mechanism.

### F2 — Duplicated E2E helpers across two spec files

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: playwright/test/moves-grid-rework.spec.ts:34-58 (vs. practice-loop-persistence.spec.ts:28-52)
- **Detail**: `inputSequence`/`startSession`/`runSession` are near-identical copies across the two spec files. The plan explicitly left extraction as "implementer's call" (plan.md:281-283), so this isn't an oversight — but a second full copy makes the case for a shared helper module now that two specs need the same shape.
- **Fix**: Extract to a shared `playwright/test/helpers.ts` (or similar) and import in both specs.
- **Decision**: SKIPPED

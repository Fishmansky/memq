<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Practice Session Core Loop

- **Plan**: context/changes/practice-session-core-loop/plan.md
- **Scope**: All 3 phases (full plan)
- **Date**: 2026-05-29
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

Automated criteria: `npm run lint` PASS (exit 0), `npm run build` PASS.
Dropped as benign: `completed_at` omitted from insert (schema has `DEFAULT now()`); `Promise.all` parallelizing insert+mastery-select (read→compute→upsert still sequenced).
Auth boundary verified: route does own `locals.user` 401 guard, `user_id` pinned server-side, RLS enforces `user_id = auth.uid()`. No injection/secrets; `@/*` alias respected.

## Findings

### F1 — Correct slots reveal move text; plan said BLANK

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence (+ Success Criteria rubber-stamp)
- **Location**: src/components/app/PracticeSession.tsx:387
- **Detail**: Slot render `{res === "correct" ? tokens[i] : ""}` reveals the move token on correct slots. Plan (Phase 2 #4, repeated in Desired End State) requires "Slots are BLANK — no move text shown. Color only." Manual criterion 2.4 ("Slots blank (no move text)") was checked [x] at 4975a9e despite this — a rubber-stamp. Revealing solved moves weakens the blind-recall memorization loop.
- **Fix A ⭐ Recommended**: Make slots truly blank — render "" for all states.
  - Strength: Matches explicit plan + criterion 2.4; restores blind-recall loop.
  - Tradeoff: One-line change; loses "confirm what I pressed" text feedback (color still signals).
  - Confidence: HIGH — plan wording unambiguous, repeated twice.
  - Blind spot: Whether reveal was a deliberate post-test UX call.
- **Fix B**: Keep reveal-on-correct, amend plan + uncheck/justify 2.4.
  - Strength: Preserves shipped behavior if reveal proved better in use.
  - Tradeoff: Contradicts stated memorization intent; plan becomes moving target.
  - Confidence: MED — depends on an unrecorded product call.
  - Blind spot: No evidence the reveal was deliberate.
- **Decision**: FIXED via Fix B — plan #4 intent, criterion, and Progress 2.4 amended to document reveal-on-correct.

### F2 — Server trusts client `isClean`; `errorCount` unbounded

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/practice/complete.ts:23-40
- **Detail**: Body validated for type/presence, but `isClean` is taken from the client rather than derived. A crafted request can record `isClean:true` with `errorCount:999`. `errorCount` also accepts negatives/floats/NaN (`typeof NaN === "number"` passes guard; integer column then 500s). Island already sends `isClean = errorCount === 0` (PracticeSession.tsx:286).
- **Fix**: Derive `isClean = errorCount === 0` server-side; require `Number.isInteger(errorCount) && errorCount >= 0` else 400.
- **Decision**: SKIPPED

### F3 — Error count increments on every wrong keystroke

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/app/PracticeSession.tsx:157-165
- **Detail**: INPUT_MOVE adds errorCount+1 on every wrong move at the current slot. Plan (Critical Implementation Details): "Error count increments only on the wrong attempt, not on each retry keystroke." Code comment L157 states the divergence. A learner fumbling 3 wrong keys on one slot logs error_count 3, not 1 — inflates stored stat (is_clean unaffected).
- **Fix**: Only increment when slot not already "wrong": `if (state.slotResults[idx] !== "wrong") errorCount++` then mark red. (Confirm intended "retry keystroke" definition with plan author.)
- **Decision**: ACCEPTED — keep per-keystroke counting (fits project); plan L64 amended to match shipped behavior.

### F4 — Fetch-then-upsert lost-update race on consecutive_clean

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/practice/complete.ts:50-92
- **Detail**: Read consecutive_clean (L57-62) → compute → upsert (L84-92). Two concurrent completions for same (user, algorithm) can both read N and write N+1, losing one increment. mastery_reached is monotonic so won't regress; only streak count undercounts. Blast radius small (single-user double-submit / retry). Plan accepted two DB calls but didn't name this race.
- **Fix**: Move increment to atomic DB op (Postgres RPC: `consecutive_clean = CASE WHEN is_clean THEN consecutive_clean+1 ELSE 0 END`), OR document accepted lost-update window.
- **Decision**: ACCEPTED — documented accepted lost-update window in plan (Critical Implementation Details); no code change.

### F5 — Undescribed STOP action + Stop button (scope creep)

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/app/PracticeSession.tsx:177-188, ~397-405
- **Detail**: Plan action list is START/INPUT_MOVE/TOGGLE_*/SUBMIT_RESULT/SUBMIT_ERROR. Implementation adds RETRY (reasonable companion to planned error phase) and STOP + Stop button (abandon active session → idle), neither in plan. Benign, no risk, undescribed surface.
- **Fix**: Document STOP/RETRY in the plan as an addendum (preserve work).
- **Decision**: ACCEPTED — RETRY/STOP added to plan action list (Phase 2 #2) as addendum.

### F6 — Raw DB error echoed; client errors return 500

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/practice/complete.ts:65-99
- **Detail**: Bad/non-existent algorithmId UUID surfaces as 500 with raw Supabase message echoed to client (FK miss → DB error). Minor info-disclosure smell + conflates 4xx with 5xx. Consistent with house style (signin.ts:16 also echoes error.message) — hence observation.
- **Fix**: Return sanitized 4xx for FK/validation misses; log raw server-side.
- **Decision**: FIXED — generic 500 messages + `console.error` server-side; FK violation (code 23503) now returns 400 "Invalid algorithmId". Lint + build pass.

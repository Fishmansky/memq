---
change_id: testing-bootstrap-core-logic-units
title: Phase 1 test rollout — bootstrap test runner + core-logic unit tests
status: impl_reviewed
created: 2026-06-02
updated: 2026-06-04
archived_at: null
---

## Notes

Rollout Phase 1 of `context/foundation/test-plan.md`: "Bootstrap + core-logic units".
Stands up the test runner (test base is currently **none** — no config, zero test files in `src/`) and proves the core logic layer holds.

Risks covered:
- **#3 Move validation lies** — wrong move accepted as correct / correct rejected; end-slot color wrong (green when should be yellow). Prove: a wrong move blocks and never advances, a correct move advances, end color is binary green/yellow.
- **#4 Streak miscounts** — off-by-one PRO trigger, lost-update race. Prove: count increments only on a clean run, resets on error, triggers PRO at exactly 3.
- **#5 Grid input desync** — button or keyboard shortcut maps to wrong move token. Prove: each grid button and its keyboard shortcut emit the correct move token.

Test types: unit, component (Vitest + Testing Library).
Next: `/10x-research` to ground the move-comparison logic, slot-state reducer, streak compute rule, and button→token/hotkey map against current code.

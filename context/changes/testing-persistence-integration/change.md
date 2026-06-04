---
change_id: testing-persistence-integration
title: Persistence integration tests for finished-session result and streak count (rollout Phase 2)
status: implementing
created: 2026-06-04
updated: 2026-06-04
archived_at: null
---

## Notes

Rollout Phase 2 of context/foundation/test-plan.md: "Persistence integration".
Risks covered: #1 (finished session result fails to persist — clean run completes but progress/streak not written, lost on reload), #4 (streak
miscounts — wrong consecutive-clean count, off-by-one PRO trigger, lost-update race drops a clean run).
Test types planned: integration (endpoint + DB read-back).
Risk response intent:
- #1: prove a clean run produces a persisted row that survives a reload — challenge "a 200 response means the write landed"; assert the persisted
row, not the response body.
- #4: prove the count increments only on a clean run, resets on error, triggers PRO at exactly 3 — challenge "final status 200 means the count is
right"; do not take the oracle from the compute function (tautology); do not ignore the documented fetch-then-compute-then-upsert race.

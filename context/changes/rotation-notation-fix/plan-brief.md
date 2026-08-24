# Rotation Notation Fix — Plan Brief

> Full plan: `context/changes/rotation-notation-fix/plan.md`
> Frame brief: `context/changes/rotation-notation-fix/frame.md`

## What & Why

Seven seeded algorithms store the token `R2'`/`U2'` — a double turn with a
trailing prime, invalid notation the app's input system can never produce.
Practicing any of them permanently sticks on that move: no error, no crash,
just stuck forever. The fix has to reach both the source file and the
already-seeded live database, or the bug ships again on the very data users
hit today.

## Starting Point

`supabase/algos_seed.sql` has the bad tokens in 7 rows; `algos_seed.sql` was
already manually applied once to the live Supabase project and has no
re-apply pipeline (`config.toml`'s auto-seed only covers `seed.sql`). No test
anywhere exercises real seed content — everything uses synthetic tokens — and
CI runs only lint + build, no tests at all.

## Desired End State

All 7 algorithms use standard notation (`R2`/`U2`) in the file and in the
live database; a fast, DB-free test fails if any seed file ever contains a
token the app can't produce; an E2E spec proves a previously-stuck algorithm
now completes for real, against the actual remote project.

## Key Decisions Made

| Decision                          | Choice                                            | Why (1 sentence)                                                                 | Source |
| ---------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| Live-DB corrective SQL shape        | 7 targeted `UPDATE ... WHERE name = '...'`         | Explicit and reviewable against the exact known-bad rows; no risk of hitting the wrong row | Plan |
| Where the corrective SQL lives      | New committed file `supabase/fixes/2026-08-24-rotation-notation.sql` | No data-migration convention exists; this is the first precedent and its own audit trail | Plan |
| Regression guard scope              | Static parse of seed files only, no live-DB integration test | Fast, DB-free, catches the mistake before any DB sees it; live-DB drift is closed by the one-time corrective statement | Plan |
| CI wiring for the new test          | Leave unwired, flag the gap                        | Matches this change's scope (fix the bug + guard it) — CI design is a separate, cross-cutting concern | Plan |
| E2E proof                           | One new Playwright spec on `OLL 28`                | Only check that proves file fix + live-DB fix + real UI together actually unstick a session | Plan |
| E2E phase ordering                  | Write + run spec red *before* either fix; re-run for green after DB fix | Live project is broken today regardless of local edits — genuine red→green, not staged | Plan |
| Seed-file coverage                  | Both `algos_seed.sql` and `seed.sql`               | One guard, no blind spot if a future algorithm is added directly to `seed.sql`   | Plan |
| Input grammar vs. data              | Data is wrong, not the grammar — no grammar change | Every other seed row already uses standard notation; frame's investigation ruled this out | Frame |

## Scope

**In scope:**
- Correct the 8 bad tokens across 7 rows in `supabase/algos_seed.sql`
- A committed, manually-run corrective SQL script for the live database
- A shared producible-token helper + a new static test over all seed content
- One Playwright spec proving a previously-stuck algorithm now completes

**Out of scope:**
- Loosening `dispatchMove`'s token grammar
- Wiring any test into `ci.yml`
- Fixing the stale `AGENTS.md:10` "no test runner configured" line
- A general data-migration tool/pipeline for future prod data fixes
- A live-DB integration test for the regression guard

## Architecture / Approach

Capture the bug as a failing E2E assertion first — the live project is
broken *today*, independent of any local edit, so this is a true pre-fix
red, not a staged one. Then fix the source file (mechanical, doesn't reach
the live DB by itself), then repair the live data (the step that actually
turns the Phase 1 spec green — re-running it is that phase's own automated
verification). A DB-free regression test, reusing
`PracticeSession.parity.test.ts`'s existing producible-token derivation
(extracted into a shared helper), lands independently to guard the future.
Phase 1's spec and Phase 3's re-run are driven via `/10x-e2e`; the rest via
`/10x-implement` — both share this same plan and Progress section.

## Phases at a Glance

| Phase                                    | What it delivers                                       | Key risk                                                          |
| ------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------- |
| 1. E2E spec — capture red (`/10x-e2e`)     | Playwright spec on `OLL 28`, confirmed failing today      | Must fail for the *right* reason (stalls on the move), not a fluke |
| 2. Fix seed source file                    | 7 rows corrected in `algos_seed.sql`                      | Low — mechanical text edit                                          |
| 3. Corrective SQL — confirm green (`/10x-e2e` re-run) | New `supabase/fixes/` script + manual Studio execution + Phase 1 spec now passing | Manual step against production data; must not duplicate rows        |
| 4. Regression guard                        | Shared token helper + new static seed-content test        | Regex must correctly parse escaped `moves` literals from raw SQL   |

**Prerequisites:** None — no dependency on other in-flight changes.
**Estimated effort:** ~1 session across 4 phases; Phase 1's spec authoring and Phase 3's manual DB step are the only non-mechanical parts.

## Open Risks & Assumptions

- Phase 3's `UPDATE` statements must be run by a human with Studio access to
  the live project — if that access is unavailable, Phases 1, 2, and 4 can
  still land, but the bug persists in production and Phase 1's spec stays
  red until Phase 3 executes.
- Phase 1's spec is only valid red evidence if its failure mode is confirmed
  as the move-stall, not an unrelated error (locator, auth, page-not-found)
  — a manual check built into that phase.

## Success Criteria (Summary)

- All 7 previously-stuck algorithms can be practiced to completion, in the
  file, in the live database, and provably so via E2E for at least one of them
- A future seed-content edit that reintroduces an unreachable token fails
  `npm test` before it ships

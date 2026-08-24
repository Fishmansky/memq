# Frame Brief: Rotation notation fix

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Practicing 7 specific seeded algorithms (OLL 22, OLL 28, OLL 50, OLL 54,
E-perm, Ga-perm, Gc-perm) permanently sticks on one move — no error, no
crash, `currentIndex` never advances, session never reaches `"submitting"`.
Confirmed root mechanism: `supabase/algos_seed.sql` stores the token
`R2'`/`U2'` (double turn + trailing prime) in those 7 rows; `dispatchMove`
(`src/components/app/PracticeSession.tsx:291-296`) can only ever produce
`base`, `base+"2"`, `base.toLowerCase()`, or `base.toLowerCase()+"2"` — never
`"2"` followed by `"'"`. `R2'`/`U2'` is outside the producible token set,
full stop.

## Initial Framing (preserved)

- **User's stated cause**: bad notation scraped into seed data — `R2'` isn't
  standard cube notation (180° turns have no direction) and can't be typed
  through the app's input system.
- **User's proposed direction**: drop the trailing `'` after every `2` in the
  7 affected rows of `supabase/algos_seed.sql`.
- **Pre-dispatch narrowing**: user confirmed both (a) scope includes
  already-seeded DB(s), not just the source file, and (b) a regression guard
  belongs in this change, not a separate one.

## Dimension Map

1. **Source notation content** (`algos_seed.sql` literal tokens) — user's
   framing lands here. Confirmed by grep: exactly 8 occurrences / 7 rows,
   matches doc exactly, no more, no fewer.
2. **Input grammar** (`dispatchMove`/`parseMoves` too strict) — alternative:
   maybe the grammar should accept `2'`, not the data be wrong.
3. **Seed-pipeline wiring / already-seeded environments** — not in original
   framing at all. Does fixing the source file reach anywhere it needs to?
4. **Detection / regression guard** — why 7 broken rows shipped silently and
   stayed undetected across the whole test suite.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **Source data is the wrong notation** (dim. 1) | `grep -no "[A-Za-z]2''" supabase/algos_seed.sql` → exactly the 8 occurrences the bug doc lists, no others. `R2'` is not valid Singmaster notation (a 180° turn has no direction). | **STRONG** |
| **Input grammar is too strict, should accept `2'`** (dim. 2) | `dispatchMove` (`PracticeSession.tsx:291-296`) always appends `"2"` last; every other one of ~150+ seed rows uses standard notation (`R'`, `R2`, no `2'`). Loosening the grammar would encode a token that isn't real cube notation anywhere else in the data. | **NONE** |
| **Fix doesn't reach already-seeded DBs** (dim. 3) | `supabase/config.toml:60-65` `[db.seed] sql_paths = ["./seed.sql"]` — `algos_seed.sql` is not in the auto-seed path. `context/foundation/roadmap.md:141`: "pre-built algorithms... already supplied to production database" — manual, one-time apply. `src/test/integration/db.ts:75-87` error message points only at `seed.sql` for `db reset`. Playwright e2e (`playwright.config.ts`, `playwright/test/E2E_RULES.md:37-39`) runs against that same real/remote Supabase project, not a freshly-reset local stack — so it already carries the 7 bad rows today, live, right now. | **STRONG** |
| **No test/CI path exercises real seed data** (dim. 4) | `.github/workflows/ci.yml:9-27` runs only `lint` + `build`, no test step at all. `.husky/pre-commit` runs only lint-staged (eslint/prettier), no tests. `PracticeSession.reducer.test.ts` / `.parity.test.ts` / `.test.tsx` all use synthetic tokens. `playwright/test/seed.spec.ts` deliberately exercises only a benign 3-move algorithm, never the 7 broken ones. | **STRONG** |

## Narrowing Signals

- User confirmed (Q1): scope includes correcting already-seeded DB(s), not
  just the source file — matches dimension 3's strong evidence.
- User confirmed (Q2): a regression guard belongs in this change — matches
  dimension 4's strong evidence.
- No precedent anywhere in `context/archive/**` for correcting already-
  inserted production seed data; this would be the first such change
  (general-purpose agent, exhaustive search of archived plans/research).
- `supabase/migrations/` holds exactly one file, pure DDL (schema + RLS) —
  no data-migration convention exists to reuse.

## Cross-System Convention

Schema changes here go through `supabase/migrations/*.sql` + `db push`
(DDL only, verified: the one existing migration has zero `INSERT`/`UPDATE`).
Data changes have no established convention — the only documented path that
touches the linked *remote* project's actual rows is the manual Supabase
Studio SQL Editor, and even that's documented only for a read-only
verification `SELECT` (`context/changes/domain-schema-rls/plan.md:347,360`),
never as a repair mechanism. So "fix the data" here means: no existing tool
in this repo writes to the live remote DB — the corrective statement has to
be run by a human, by hand, outside any CLI/CI path that exists today.

Separately: `vitest` is a real, installed, scripted test runner
(`package.json` `test`/`test:integration` scripts, `vitest.config.ts`) —
but `AGENTS.md:10` states "No test runner is configured; do not generate
`vitest`/`jest` invocations." That line is stale relative to the repo as it
stands (vitest is configured, just never wired into CI/hooks). Not this
change's job to fix, but /10x-plan will hit it head-on if a regression guard
is scoped as a vitest test — worth flagging rather than silently working
around.

## Reframed Problem Statement

> **The actual problem to plan around is**: the seed *file* has the wrong
> notation (user's framing was right), the live database seeded from it has
> already propagated that wrong notation into the one environment users and
> e2e actually hit (prod, no auto-resync), and nothing anywhere would catch
> a repeat of this class of mistake.

The original framing wasn't wrong, it was incomplete: it treated
"algos_seed.sql is broken" and "the bug is fixed" as the same fact. They
aren't — `algos_seed.sql` is a write-once source file with no pipeline that
ever re-applies it, so editing it fixes nothing a user or e2e test will ever
touch until someone also runs a corrective statement against the live DB. If
the plan stops at the file edit, the 7 algorithms stay stuck in production
after the change ships.

## Confidence

**HIGH** — every leg has direct file:line or document:section evidence
(config.toml, roadmap.md, CI workflow, husky config, migration file, archive
search), the user's own narrowing answers land exactly on the two dimensions
the evidence flags as strong, and the original data-notation diagnosis holds
up under an independent re-check (exact token count match).

## What Changes for /10x-plan

Plan needs three legs, not one: (1) correct the 7 tokens in
`supabase/algos_seed.sql` — original direction, unchanged; (2) a corrective
SQL statement run against the already-seeded live database (no existing
automated path — will need a documented manual step, likely via Supabase
Studio SQL Editor, since that's the only write path this repo's docs
acknowledge); (3) a regression guard that exercises real seed content
(not synthetic tokens) so a future scrape can't silently reintroduce an
unreachable token — scoped with the `AGENTS.md:10` vitest tension above in
mind.

## References

- Source files: `supabase/algos_seed.sql:93,99,121,125,140,143,145`;
  `src/components/app/PracticeSession.tsx:291-296,149,216`;
  `supabase/config.toml:60-65`; `src/test/integration/db.ts:75-87`;
  `.github/workflows/ci.yml:9-27`; `.husky/pre-commit`;
  `supabase/migrations/20260527000000_domain_schema_rls.sql`
- Related docs: `context/foundation/roadmap.md:141`;
  `context/changes/domain-schema-rls/plan.md:272-283,347,360`;
  `playwright/test/E2E_RULES.md:37-39`
- Related finding: `notation-bug.md` (original bug report, verbatim in
  `change.md` Notes)
- Investigation agents: Explore ("Trace where algos_seed.sql / vitest
  actually run"), general-purpose ("Check precedent for correcting
  already-seeded prod data")

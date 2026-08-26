# Custom List Creation + Algorithm Entry + Duplicate Detection — Plan Brief

> Full plan: `context/changes/custom-list-algorithm-entry/plan.md`
> Research: `context/changes/custom-list-algorithm-entry/research.md`

## What & Why

Learners can only practice the 119 pre-built algorithms shipped in the seed data. This slice (roadmap S-04; PRD FR-004, FR-005, FR-015) lets them create a private list and add their own algorithms by name and move sequence — and, when a submitted sequence matches something they can already see, offers the existing algorithm instead of quietly creating a duplicate.

## Starting Point

F-01 shipped `algorithm_lists`, `algorithms`, and a complete RLS policy set that already models "a user creates a private list and owns its algorithms" — and not one line of application code has ever exercised it. There is no `INSERT` against either table anywhere in `src/`. The browse pages (`/sets/[id]`, `/sets/[id]/[algoId]`) already render a user-owned list correctly under RLS; a single hardcoded `.eq("is_system", true)` on `dashboard.astro:18` is what makes custom lists invisible. Missing: the create paths, the duplicate-detection decision, and any runtime validation of move notation at all.

## Desired End State

A learner creates a named private list from the dashboard, sees it there under "My Lists", opens it, and adds algorithms by name + move sequence. Bad notation is rejected at the form with the offending token named — before it can reach the database and silently freeze a practice session. A sequence matching a pre-built algorithm surfaces an inline panel naming the match, with the choice to add that algorithm to this list or create a separate entry. Everything added is immediately practicable through the existing flow.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| FR-015 data model | **D2** — copy the row + nullable `source_algorithm_id` | Full FR-015 conformance with zero RLS rewrite and zero read-path breakage, and the provenance FK keeps a later streak-carryover fix a one-migration job | Plan |
| "Exactly matches" semantics | **Normalized** (whitespace, parens, apostrophes; case-sensitive) | Byte comparison makes a trailing space or a smart quote a silent false negative — the exact duplicate the FR exists to prevent | Plan (closes an open roadmap question) |
| Where normalization lives | Postgres **generated column** `moves_normalized` + index, mirrored by a JS normalizer, pinned by a parity test | Seeded rows store parens as visual grouping, so a paren-stripping comparison can't run against the raw column and stay index-backed | Plan |
| Notation validation scope | Extract `src/test/tokenGrammar.ts` → `src/lib/notation/moveGrammar.ts`, add validator + normalizer | One grammar for form and endpoint instead of a third copy; closes a proven production failure without becoming a refactor | Plan |
| Sequencing vs domain-doc ACL | **S-04 first**; only doc 02's behavior-neutral grammar extraction | The ACL is a large body of unshipped work with no user-visible payoff; the one refactor that de-risks this feature is already in scope | Plan (against doc 03's recommendation, deliberately) |
| Duplicate-prompt UX | Inline result panel, JSON `fetch` | No dialog component exists; a modal drags Radix and a focus-trap a11y surface into a slice already carrying a schema decision | Plan |
| Feature scope | Create + dashboard visibility only — no edit, delete, or rename | Delete cascades into practice history and needs a confirmation surface the repo has no component for | Plan |
| Test depth | Build the two-account integration harness now | This slice creates the first user-owned rows; the RLS policies protecting them have never been executed by a test | Plan (test-plan risk #2) |
| CI | Wire `npm test` in this slice | Third time it's been raised; without it every guard written here ships dead | Plan |

## Scope

**In scope:** create a custom list; add an algorithm by name + moves; FR-015 duplicate detection with add-existing and create-anyway branches; notation validation + normalization extracted to `src/lib/`; dashboard visibility for custom lists; two-account RLS isolation tests; E2E coverage; `npm test` in CI.

**Out of scope:** edit / delete / rename of lists or algorithms; mastery-streak carryover across a copy; the `list_items` junction model; the ACL / ports layer and the full `MoveSequence` value object; dialog and toast components; shared error-banner extraction; a `UNIQUE(list_id, moves)` constraint (check-then-insert stays a TOCTOU race, same accepted shape as `completePractice.ts`); any change to the practice loop.

## Architecture / Approach

```
AddAlgorithmForm (island) ──fetch──▶ POST /api/lists/:listId/algorithms
      │ validateMoves()                      │ auth + typeof guard + client
      │ (same validator)                     ▼
      │                          src/lib/lists/addAlgorithm.ts
      │                                      │ normalizeMoves()
      │                                      ▼
      │                    SELECT … WHERE moves_normalized = $1   ← RLS alg_select
      │                                      │  = "pre-built OR any of my lists"
      ◀──── { status: "duplicate", match } ──┤
                                             └─ no match → INSERT (position = max+1)
```

Routes stay thin and delegate to lib modules, mirroring `complete.ts` → `completePractice.ts`. Authorization is RLS, not app code — `alg_insert` is what rejects a write into someone else's list, and Phase 5 proves it. Astro pages keep their inline PostgREST chains; no new structural convention is introduced.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Notation module | Grammar out of test-space into `src/lib/`, plus normalizer + validator | Moving `KEY_TO_MOVE` must not leave a React import path into the grammar, or an API route bundles a component |
| 2. Migration | `moves_normalized` generated column + index, `source_algorithm_id` FK, types regen | JS and SQL normalization drifting apart — a silent false negative; the parity test is the mitigation |
| 3. Server | `createList` / `addAlgorithm` / `addExistingAlgorithm` + two API routes | Raw DB errors leaking to the client (prior impl-review F6); `position` is `NOT NULL` with no default |
| 4. UI | Dashboard visibility, create-list island, add-algorithm island with duplicate panel | The duplicate panel must not lose typed form state, and needs focus management to be announced |
| 5. Isolation tests | Two-account harness + cross-user and FR-015-scope assertions | A test that passes because RLS hides everything from everyone; the deliberate-break check is what proves it has teeth |
| 6. E2E + CI | Create→duplicate→add specs with cleanup; `npm test` in `ci.yml` | First specs in the repo that create persistent rows in the shared remote project |

**Prerequisites:** F-01 (done). Local Supabase stack for the migration; `SUPABASE_SERVICE_ROLE_KEY` for integration and E2E teardown.
**Estimated effort:** ~3–4 sessions across 6 phases; Phases 3 and 4 are the bulk.

## Open Risks & Assumptions

- **Streak forks on "add this one."** A learner at 2-of-3 clean runs on the pre-built T-perm restarts at 0/3 after adding it to their list. This is the accepted cost of D2 and reads as a bug until a follow-up rewrites mastery lookups to follow `source_algorithm_id`. Worth naming to the user in the UI copy or accepting explicitly.
- **The JS↔SQL normalization pair is the single point of silent failure** in FR-015. The parity test over real seeded rows is the contract; if the rule changes, both sides and the test change together.
- **No delete path ships.** A learner who fat-fingers a sequence has a permanent, unpracticeable row until a later slice. Phase 1's validator is what keeps that from being common.
- **E2E specs write to the shared remote project.** Timestamped names plus explicit teardown are the mitigation, but this is the first spec in the repo doing either.
- **Integration tests stay out of CI** (no service-role secret in the workflow), so the isolation guards run locally only until that secret is added.

## Success Criteria (Summary)

- A learner can create a private list, add algorithms to it, and practice them — end to end, in the browser.
- Submitting a sequence that already exists surfaces the existing algorithm and lets the learner add it rather than duplicating it; invalid notation is caught at the form, not at practice time.
- User A cannot read or write user B's lists or algorithms, and B's private algorithm never appears as a duplicate match for A — proven by tests that fail when the policy is deliberately broken.

# Complete CRUD on User Algorithm Lists — Plan Brief

> Full plan: `context/changes/crud-algo-functions/plan.md`

## What & Why

A learner can create and read their algorithm lists and the algorithms inside
them, but cannot change or remove either. A mistyped list name is permanent; a
wrong move sequence can only be worked around by adding a second entry beside it.
This plan adds update and delete on both resources, making the feature area
CRUD-complete.

## Starting Point

`POST /api/lists` and `POST /api/lists/:listId/algorithms` exist, along with the
three read surfaces (dashboard, list page, algorithm page). The four RLS policies
needed for the missing operations — `al_update`, `al_delete`, `alg_update`,
`alg_delete` — are **already in the schema** and already restrict writes to
owner-only, non-system rows. The gap is entirely at the app layer: no routes, no
lib modules, no UI.

## Desired End State

Viewing one of their own lists, a learner can rename it and delete it. Viewing
one of their own algorithms, they can change its name, change its move sequence,
and delete it. Pre-built sets show none of these controls. A delete states what
will be lost before it happens. Editing a move sequence re-checks for duplicates
exactly as adding one does, and clears the mastery streak earned on the old
sequence.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Scope | Update + delete on both `algorithm_lists` and `algorithms` | The change title asks for CRUD-full, and today neither a bad list name nor a bad sequence is fixable. |
| Schema | No migration | All four required policies already exist and already enforce owner-only, non-system. |
| Mastery on edit | Reset the streak when `moves` changes; leave it alone on a name-only edit | A streak means "I can recall *this* sequence"; carrying it to a different one makes "You're PRO!" false. |
| Duplicate check on edit | Yes, same FR-015 contract as create | An edit can create a duplicate just as easily as an insert; the probe in `addAlgorithm.ts` is reusable. |
| `position` after delete | Stop displaying it — render the array index instead | Zero extra writes and no partial-failure risk, versus renumbering N rows with no transaction available. |
| Delete confirmation | Inline confirm inside the island | Styled, role-locatable, and able to state the cascade — a native `confirm()` can do none of those. |
| Cascade into practice history | Accept the hard delete, disclose it in the confirm | Soft delete means a migration plus a filter on every read path and policy — larger than the gap being closed. |
| Algorithm edit surface | The existing algorithm detail page | It already loads `name` and `moves`, and has room for the duplicate panel. |
| Algorithm route shape | Flat `/api/algorithms/:algoId` | The create route already documents that `listId` carries no authority; a segment never read shouldn't be in the URL. |
| Testing | Unit per lib module + one two-account integration suite | The new write endpoints *are* test-plan risk #2, and a mocked client cannot prove a policy rejects anything. |
| Phasing | Deletes first, then updates | Each phase builds one piece of shared machinery, and the riskier semantics land after the simpler pass proves the pattern. |

## Scope

**In scope:** rename list; delete list; edit algorithm name and moves; delete
algorithm; a shared confirm-before-destroy island; contiguous row numbering; unit
tests per lib module; a two-account isolation suite over all four operations.

**Out of scope:** any schema migration; soft delete, archive, or undo;
reordering algorithms; renumbering the `position` column; bulk operations;
editing pre-built content; E2E specs; dashboard-level list controls; any change
to the FR-014 session counter.

## Architecture / Approach

Each operation follows the pattern already set by `createList.ts`: a
Node-importable lib module returning `{ status, body }`, wrapped by a thin
`APIRoute` that gates `locals.user`, shape-checks the id and body, and maps the
result onto a `Response`. RLS remains the authorization boundary — the UI gate
only decides whether a button renders, and a row the caller cannot see returns
`404` rather than confirming it exists.

```
ConfirmDelete / RenameListForm / EditAlgorithmForm   (React islands, fetch + navigate)
        │
        ▼
/api/lists/:listId  (PATCH, DELETE)      /api/algorithms/:algoId  (PATCH, DELETE)
        │                                          │
        ▼                                          ▼
renameList.ts / deleteList.ts        updateAlgorithm.ts / deleteAlgorithm.ts
        │                                          │
        └──────────────► RLS policies ◄────────────┘
              al_update / al_delete / alg_update / alg_delete
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Delete | Both delete endpoints, the shared confirm island, both UI surfaces, row numbers moved off `position` | Cascade is irreversible — the confirm text is the only safeguard, so it must state the algorithm count and the history loss accurately |
| 2. Update | Both update endpoints, rename form, edit form with the duplicate panel, mastery reset | Two ordering traps: the duplicate probe must exclude the row under edit, and the mastery reset must precede the moves write |

**Prerequisites:** none — no migration, no new dependency. The integration suite
needs a local Supabase stack (`.env.test`), as it already does.
**Estimated effort:** ~2-3 sessions across 2 phases.

## Open Risks & Assumptions

- **No transaction spans the mastery reset and the moves update.** PostgREST
  gives no way to make them atomic without an RPC (a migration this plan
  excludes). The order chosen fails toward a zeroed streak on an unchanged row
  rather than toward a false mastery claim; the residual window is accepted.
- **Delete is unrecoverable.** A learner who clicks past the confirm loses a
  mastered streak with no undo. Accepted as proportionate for a personal drill
  list.
- **`position` and the displayed row number diverge** after this change. Anything
  later that reads `position` as a display value will be wrong; it is an
  ordering key only.
- **No PRD FR covers these operations** — FR-001..FR-015 has no rename/edit/delete
  line, so this extends past the MVP requirement set rather than completing it.
- **Integration tests do not run in CI** (no DB credentials), so the isolation
  evidence for risk #2 is local-only until that changes.
- **`supabase db reset` seeds only 8 algorithms**, not the remote project's 127,
  so fixtures are created explicitly rather than assumed from the seed.

## Success Criteria (Summary)

- A learner can fix a mistyped list name or a wrong move sequence in place,
  without deleting and rebuilding.
- A learner can remove a list or an algorithm, and is told what goes with it
  before it happens.
- Pre-built sets remain untouched and uneditable, and no learner can reach
  another learner's rows through any of the four new endpoints.

# Complete CRUD on User Algorithm Lists — Implementation Plan

## Overview

A learner can create and read their algorithm lists and the algorithms inside
them, but cannot change or remove either. A mistyped list name is permanent; a
wrong move sequence can only be worked around by adding a second entry. This
plan adds the missing two operations on both resources — rename/delete a list,
edit/delete an algorithm — making the feature area CRUD-complete.

No database migration is required. The four RLS policies this needs already
exist and already enforce the right rule.

## Current State Analysis

**CRUD matrix today:**

| Resource | Create | Read | Update | Delete |
| --- | --- | --- | --- | --- |
| `algorithm_lists` (user-owned) | `POST /api/lists` | `dashboard.astro`, `sets/[id].astro` | **missing** | **missing** |
| `algorithms` (in a user list) | `POST /api/lists/:listId/algorithms` | `sets/[id].astro`, `sets/[id]/[algoId].astro` | **missing** | **missing** |

**The gap is app-layer only.** `supabase/migrations/20260527000000_domain_schema_rls.sql:69-128`
already defines `al_update`, `al_delete`, `alg_update` and `alg_delete`, each
gated on `user_id = auth.uid() AND is_system = false` (for `algorithms`, via an
`EXISTS` on the owning list). Nothing new is needed in SQL: pre-built sets are
already unwritable and another user's rows are already unreachable.

**Established pattern to follow.** Every existing mutation is a Node-importable
lib module returning `{ status, body }`, plus a thin `APIRoute` wrapper that
builds the client, shape-checks the body, and maps the result onto a `Response`
(`src/lib/lists/createList.ts` + `src/pages/api/lists/index.ts`;
`src/lib/lists/addExistingAlgorithm.ts`). Within that pattern:

- `context.locals.user` is gated in every API route, and the gate is load-bearing
  rather than defensive: `src/middleware.ts` prefix-matches
  `PROTECTED_ROUTES = ["/dashboard", "/sets"]`, so `/api/*` is not covered.
- Postgres `42501` (RLS violation) maps to `403`; every other DB error is
  `console.error`'d and returns a fixed generic string. Never echo
  `error.message` (`createList.ts:57-61`, and the lessons.md rule on DB error
  messages).
- A row the caller cannot see is indistinguishable from one that does not
  exist — both `404`, deliberately (`addExistingAlgorithm.ts:30-37`).

**Constraints and hazards discovered:**

- **`position` is learner-visible.** `AlgorithmRow.astro:16` renders `position`
  verbatim as the row number; inserts compute `max(position) + 1`
  (`addAlgorithm.ts:151-166`). Deleting from the middle of a list leaves a hole
  (1, 2, 4).
- **Deletes cascade into practice history.** `practice_sessions.algorithm_id`
  and `algorithm_mastery.algorithm_id` are both `ON DELETE CASCADE` (migration
  1, lines 35 and 47). Deleting a list cascades to its algorithms, which cascade
  again into sessions and mastery. `algorithms.source_algorithm_id` is
  `ON DELETE SET NULL` (migration 2, line 50), so a learner's *copy* survives
  the deletion of its original.
- **`moves_normalized` is a generated column** (migration 2, line 30-32). An
  `UPDATE` to `moves` re-derives it automatically — nothing may ever write it
  directly (lessons.md rule on generated columns).
- **Mastery survives an edit.** `algorithm_mastery` is keyed by `algorithm_id`,
  so changing that row's `moves` leaves a streak in place that was earned on a
  sequence which no longer exists.
- **`sets/[id]/[algoId].astro` does not know list ownership.** It selects only
  `id, name` from `algorithm_lists` (line 39-43), which is insufficient to gate
  an owner-only control. Its two independent queries also run as sequential
  awaits (lines 23-50), against the lessons.md `Promise.all` rule.
- **No PRD FR covers this.** FR-001..FR-015 has no rename/edit/delete line; this
  extends past the MVP requirement set. Test-plan risk #2 (cross-user data
  access) applies directly to four new write endpoints.
- **FR-014's global session counter is not built yet** — no code reads
  `practice_sessions`. So "deleting a list shrinks my lifetime session total" is
  a future consequence of the cascade, not a live regression.

## Desired End State

A learner viewing one of their own lists can rename it and delete it. A learner
viewing one of their own algorithms can change its name, change its move
sequence, and delete it. Pre-built sets show none of these controls and reject
the requests at the policy layer if called directly. Deleting states what will
be lost before it happens. Editing a move sequence re-checks for duplicates the
same way adding one does, and clears the mastery streak that was earned on the
old sequence.

Verified by: the manual walkthrough in Testing Strategy, plus two-account
integration tests proving user B cannot update or delete user A's rows.

### Key Discoveries:

- All four required RLS policies already exist —
  `supabase/migrations/20260527000000_domain_schema_rls.sql:69` (`al_update`),
  `:74` (`al_delete`), `:100` (`alg_update`), `:119` (`alg_delete`). No migration.
- `position` is rendered verbatim as the row number (`AlgorithmRow.astro:16`),
  so deletes make holes visible unless the display stops reading that column.
- `algorithm_mastery` and `practice_sessions` cascade on algorithm delete
  (migration 1, lines 35 and 47); `source_algorithm_id` does not (migration 2,
  line 50).
- `addAlgorithm.ts:116-145` is the reusable FR-015 duplicate probe, including the
  pre-built-wins ordering and the `order("algorithm_lists(is_system)")` syntax
  that fails silently if "tidied up" (lessons.md).
- `AddAlgorithmForm.tsx` already holds the client-side validator call, the
  duplicate panel, and the focus management the edit form needs.
- `sets/[id].astro:56` is the existing owner-gate idiom:
  `!list.is_system && list.user_id === Astro.locals.user?.id`.

## What We're NOT Doing

- **No schema migration.** No new columns, no new policies, no RPC.
- **No soft delete / archive / undo.** Deletes are hard and cascade; the confirm
  step is the only safeguard.
- **No reordering of algorithms.** `position` stays an ordering key; drag-to-reorder
  is out of scope.
- **No renumbering of `position` after a delete.** Gaps are left in the column
  and hidden at the display layer instead.
- **No bulk operations.** One list or one algorithm at a time.
- **No editing of pre-built (`is_system`) content**, and no "fork this pre-built
  set into my lists" flow.
- **No E2E specs.** Coverage stops at unit + integration (see Testing Strategy).
- **No dashboard-level list controls.** Rename and delete live on the list's own
  page, where the algorithm count needed for the confirm text is already loaded.
- **No change to the FR-014 counter** or to how cascade affects it.

## Implementation Approach

Two phases, split by operation rather than by resource, because each phase builds
one piece of shared machinery and ships one coherent capability:

- **Phase 1 (delete)** builds the confirm-before-destroy island and the
  delete-endpoint shape, and applies both to lists and algorithms. It also moves
  the row number off `position`, since that is the direct consequence of allowing
  deletes.
- **Phase 2 (update)** builds the edit surfaces, reusing the notation validator
  and duplicate panel that `AddAlgorithmForm` already established. The riskier
  semantics — duplicate re-detection and mastery reset — land here, after the
  simpler pass has proven the route, gating, and test shape.

**Route shape.** Algorithm mutations are addressed flatly as
`/api/algorithms/:algoId`, not `/api/lists/:listId/algorithms/:algoId`. The
existing create route already documents that `listId` "is never trusted for
authorization — the `alg_insert` RLS policy decides" (`algorithms.ts:11-12`); a
path segment that carries no authority and is never read should not be in the
URL. It also avoids restructuring `algorithms.ts` into `algorithms/index.ts`.
List mutations live at `/api/lists/:listId` via
`src/pages/api/lists/[listId]/index.ts` (the `index.ts` form, because the
`[listId]/` directory already exists).

**Client idiom.** `fetch` plus `window.location` on success, matching
`CreateListForm.tsx:38-48` — these are server-rendered pages, so a navigation or
reload is how the new state appears.

**Authorization.** Unchanged in principle: RLS decides, the route gates on
`locals.user`, and the UI gate only controls whether a button renders. A missing
or non-owned row after a delete or update surfaces as `404`, never as
confirmation that the row exists.

## Critical Implementation Details

**State sequencing (Phase 2).** The mastery reset must run **before** the `moves`
update, not after. There is no transaction spanning two PostgREST calls. If the
update lands and the reset then fails, the app claims a mastery streak for a
sequence that was never practiced — precisely the lie the reset exists to
prevent. Reset-first fails the other way: a zeroed streak on an unchanged
algorithm, which the learner recovers by practicing. Accept the weaker failure.

**Self-match in the duplicate probe (Phase 2).** The FR-015 query filters on
`moves_normalized` and then looks for a row whose `list_id` is the target list.
When editing, the row being edited satisfies both, so a name-only edit would
match itself and return `409 already_in_list`. The probe must exclude the
algorithm under edit by id. Additionally: skip the probe and the mastery reset
entirely when the submitted moves normalize to the same value already stored —
that is a name-only edit and must not disturb the streak.

## Phase 1: Delete (list + algorithm)

### Overview

Both delete endpoints, the shared confirm island, both UI surfaces, and the
display-index change that keeps row numbers contiguous once holes can appear.

### Changes Required:

#### 1. Delete-list core

**File**: `src/lib/lists/deleteList.ts`

**Intent**: Node-importable core for `DELETE /api/lists/:listId` — remove one
user-owned list, letting `al_delete` decide whether the caller may. Mirrors the
`createList.ts` module shape so the route stays thin.

**Contract**: `deleteList(supabase, { listId }): Promise<DeleteListResult>` where
the result union is `{ status: 204 }` | `{ status: 404; body: { error: "List not found" } }`
| `{ status: 500; body: { error: "Failed to delete list" } }`. Delete with a
`.select("id")` so affected rows are observable: zero rows means the policy
excluded it (not owned, or `is_system`) and maps to `404` — the same
see-it-or-not collapse as `addExistingAlgorithm.ts:30-37`. DB errors are logged,
never echoed.

#### 2. Delete-algorithm core

**File**: `src/lib/lists/deleteAlgorithm.ts`

**Intent**: Node-importable core for `DELETE /api/algorithms/:algoId`, same shape
as above but governed by `alg_delete`. Also returns the owning `list_id`, which
the client needs in order to navigate back to the list page after the row is gone.

**Contract**: `deleteAlgorithm(supabase, { algorithmId }): Promise<DeleteAlgorithmResult>`
returning `{ status: 200; body: { listId: string } }` |
`{ status: 404; body: { error: "Algorithm not found" } }` |
`{ status: 500; body: { error: "Failed to delete algorithm" } }`. `200` with a
body rather than `204`, because the response carries `list_id` from the deleted
row's `.select("id, list_id")`.

#### 3. List route: DELETE

**File**: `src/pages/api/lists/[listId]/index.ts` (new)

**Intent**: Thin wrapper for the list-level mutations. Phase 1 adds `DELETE`
only; Phase 2 adds `PATCH` to the same file.

**Contract**: `export const DELETE: APIRoute`. Gates `context.locals.user` →
`401`. Shape-checks `listId` against the UUID regex → `400` (a non-UUID reaches
PostgREST as `.eq("id","foo")`, raising `22P02`, which the lib module's catch-all
would misreport as `500` — same reasoning as `algorithms.ts:26-36`). Builds the
client, `500` if unconfigured, then maps `deleteList`'s result onto a `Response`.
Note the `index.ts` filename: the `[listId]/` directory already exists.

#### 4. Algorithm route: DELETE

**File**: `src/pages/api/algorithms/[algoId].ts` (new)

**Intent**: Thin wrapper for algorithm-level mutations at the flat address.
Phase 1 adds `DELETE`; Phase 2 adds `PATCH`.

**Contract**: `export const DELETE: APIRoute`, same gate → UUID-check → client →
map sequence as above, delegating to `deleteAlgorithm`. Hoist the UUID regex
rather than re-declaring it; `algorithms.ts:15` is the existing copy.

#### 5. Shared confirm-and-delete island

**File**: `src/components/app/ConfirmDelete.tsx` (new)

**Intent**: One island serving both delete surfaces. Renders a destructive
trigger; on click it swaps in an inline confirm/cancel pair carrying a caller-
supplied sentence naming what will be lost, rather than a native `confirm()`
dialog — so it is styled, announceable, and reachable with role-based locators.

**Contract**: Props `{ endpoint: string; label: string; confirmPrompt: string; redirectTo?: string }`.
`fetch(endpoint, { method: "DELETE" })`; on success navigate to `redirectTo` if
given, else reload — the `CreateListForm.tsx:45-48` idiom. On failure surface the
endpoint's generic error string in a `role="alert"` and return to the unconfirmed
state. Both buttons carry stable accessible names; the confirm prompt is text
content, not an `aria-label`, so it is visible as well as announced.

#### 6. List page: delete control, and row numbers off `position`

**File**: `src/pages/sets/[id].astro`

**Intent**: Render the list-delete control for an owned list only, and stop
passing `position` to the row so a hole in that column never reaches the learner.

**Contract**: Reuse the existing `canAddAlgorithms` gate (line 56) — rename it to
something operation-neutral such as `canManageList`, since it now gates more than
the add form. Mount `ConfirmDelete` with `endpoint={"/api/lists/" + list.id}`,
`redirectTo="/dashboard"`, and a prompt stating the algorithm count
(`algorithms.length`, already in scope) and that practice history goes with it.
Change the `AlgorithmRow` call site (line 69) to pass the array index plus one in
place of `algo.position`; keep the `.order("position")` fetch unchanged, since
that is what makes the index meaningful.

#### 7. Algorithm row: display index

**File**: `src/components/app/AlgorithmRow.astro`

**Intent**: Take a display-only number instead of the `position` column, so the
prop name stops implying it is the stored value.

**Contract**: Rename the `position: number` prop to `displayIndex: number`. No
markup change — it renders in the same slot (line 16). Callers: `sets/[id].astro`
only.

#### 8. Algorithm page: ownership gate and delete control

**File**: `src/pages/sets/[id]/[algoId].astro`

**Intent**: This page cannot currently tell whether the learner owns the list, so
it cannot gate an owner-only control. Widen its list query, add the delete
control, and — since the file is being edited — collapse its two independent
sequential queries into one `Promise.all` per the lessons.md rule.

**Contract**: Extend the `algorithm_lists` select (line 40) to
`"id, name, is_system, user_id"` and widen the `list` local's type to match.
Derive the same owner gate as `sets/[id].astro`
(`!list.is_system && list.user_id === Astro.locals.user?.id`). Behind that gate,
mount `ConfirmDelete` with `endpoint={"/api/algorithms/" + algorithm.id}`,
`redirectTo={"/sets/" + list.id}`, and a prompt naming the algorithm and its
practice history. Run the `algorithms` and `algorithm_lists` queries through
`Promise.all`; the existing error branches and both redirect guards (lines 53-59)
keep their current behaviour and must still not interpolate `error.message` into
a redirect.

#### 9. Unit tests for both delete cores

**Files**: `src/lib/lists/deleteList.test.ts`, `src/lib/lists/deleteAlgorithm.test.ts` (new)

**Intent**: Cover each module's status mapping against a mocked Supabase client,
following `createList.test.ts` — including the assertion that no DB error string
reaches the response body (`createList.test.ts:95-103` is the model).

**Contract**: Per module: success; zero-rows-affected → `404`; DB error → `500`
with the fixed message and no leaked detail. `deleteAlgorithm` additionally
asserts `listId` is returned from the deleted row.

#### 10. Two-account delete isolation test

**File**: `src/test/integration/listMutationIsolation.int.test.ts` (new)

**Intent**: Prove `al_delete` and `alg_delete` actually reject a non-owner —
test-plan risk #2. A mocked client cannot demonstrate that a policy refuses
anything, so this needs the DB.

**Contract**: Follow `listIsolation.int.test.ts` for account setup and teardown.
User B attempts to delete A's list and A's algorithm; assert zero rows affected
and that A's rows are still readable by A afterwards. Per the lessons.md RLS
break-check rule: keep these queries **join-free** so the assertion pins
`al_delete` / `alg_delete` alone rather than the conjunction of a parent and
child policy. Also assert a user cannot delete a pre-built (`is_system`) list,
which is the same policy clause from the other direction.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Unit suite passes, including the two new delete-core test files: `npm test`
- Integration suite passes, including the new isolation test: `npm run test:integration`

#### Manual Verification:

- On an owned list with several algorithms, the delete control appears; the confirm
  step names the algorithm count before anything is removed; confirming returns to
  the dashboard and the list is gone.
- On a pre-built set, no delete control renders on the list page or on any
  algorithm page within it.
- Deleting the second of four algorithms leaves the remaining rows numbered 1, 2, 3
  with no hole.
- Cancelling the confirm leaves the list and its algorithms intact.
- Deleting an algorithm returns to its list page and the row is gone.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 2: Update (rename list + edit algorithm)

### Overview

Both update endpoints and both edit surfaces. Renaming a list reuses the
`createList` validation rules. Editing an algorithm re-runs FR-015 duplicate
detection and resets the mastery streak when — and only when — the move sequence
actually changes.

### Changes Required:

#### 1. Rename-list core

**File**: `src/lib/lists/renameList.ts`

**Intent**: Node-importable core for `PATCH /api/lists/:listId`. Same validation
as create, so a name rejected at creation is rejected on rename with the same
message.

**Contract**: `renameList(supabase, { listId, name }): Promise<RenameListResult>`
returning `{ status: 200; body: { id: string; name: string } }` |
`{ status: 400; body: { error: string } }` |
`{ status: 404; body: { error: "List not found" } }` |
`{ status: 500; body: { error: "Failed to rename list" } }`. Trim, reject empty,
reject over `LIST_NAME_MAX_LENGTH` — import that constant from `createList.ts`
rather than restating `100`, as `addAlgorithm.ts:13` already does. Update with
`.select("id, name")`; zero rows → `404`. No name-uniqueness check: creation does
not impose one and the schema has no unique constraint, so rename must not invent
one.

#### 2. Update-algorithm core

**File**: `src/lib/lists/updateAlgorithm.ts`

**Intent**: Node-importable core for `PATCH /api/algorithms/:algoId` — the edit
counterpart of `addAlgorithm.ts`, carrying the same notation validation and the
same FR-015 duplicate contract, plus the mastery reset that an edit makes
necessary.

**Contract**: `updateAlgorithm(supabase, { algorithmId, name, moves, createAnyway? }): Promise<UpdateAlgorithmResult>`.
The result union deliberately mirrors `AddAlgorithmResult` so the edit form can
reuse the add form's response handling:
`{ status: 200; body: { status: "updated"; algorithm: AddedAlgorithm } }` |
`{ status: 200; body: { status: "duplicate"; match: DuplicateMatch } }` |
`{ status: 409; body: { status: "already_in_list"; match: DuplicateMatch } }` |
`{ status: 400; body: { error: string } }` |
`{ status: 404; body: { error: "Algorithm not found" } }` |
`{ status: 500; body: { error: "Failed to update algorithm" } }`.

Sequence, and the order is load-bearing:

1. Read the current row (`id, list_id, moves_normalized`) through the authed
   client; not visible → `404`.
2. Validate name (trim, non-empty, length) and `validateMoves(moves)` — reuse
   `@/lib/notation/moveGrammar`, not a second copy of the rule.
3. Compare `validation.normalized` against the stored `moves_normalized`. Equal
   means this is a name-only edit: skip steps 4 and 5 entirely.
4. Run the FR-015 probe from `addAlgorithm.ts:116-145` — same filter, same
   `order("algorithm_lists(is_system)", { ascending: false })` composite-column
   syntax (the `referencedTable` form is a silent no-op; see lessons.md), same
   pre-built-wins re-application in JS — **excluding the row being edited by id**.
   A match in the same list → `409`; a match elsewhere with `createAnyway !== true`
   → `200 duplicate`.
5. Reset mastery for this algorithm *before* writing the new moves: set
   `consecutive_clean = 0`, `mastery_reached = false` on `algorithm_mastery` where
   `algorithm_id` matches. `am_update` scopes this to the caller's own row, so no
   `user_id` filter is needed and at most one row is affected; zero rows is normal
   and not an error.
6. Update `name` and `moves`. Never include `moves_normalized` in the payload —
   it is a generated column and Postgres rejects the write (lessons.md). `moves`
   is stored raw, display-verbatim, exactly as `addAlgorithm.ts:147-172` does.
   `42501` → in practice unreachable, since step 1's read already
   proved visibility and `alg_update` shares `alg_select`'s ownership test; map it
   to `404` for consistency with the read rather than adding a fourth branch.
7. Return the updated row.

Extract the probe shared with `addAlgorithm.ts` into a helper rather than
duplicating it — one copy of the ordering rule and the `MatchRow` flattening.

#### 3. List route: PATCH

**File**: `src/pages/api/lists/[listId]/index.ts`

**Intent**: Add the rename verb alongside Phase 1's `DELETE`.

**Contract**: `export const PATCH: APIRoute`. Same user gate and UUID check.
Body must parse as JSON with a `string` `name`, else `400` — the exact check
`src/pages/api/lists/index.ts:30-35` performs. Delegates to `renameList`.

#### 4. Algorithm route: PATCH

**File**: `src/pages/api/algorithms/[algoId].ts`

**Intent**: Add the edit verb alongside Phase 1's `DELETE`.

**Contract**: `export const PATCH: APIRoute`. Same gate and UUID check. Body must
carry `string` `name` and `string` `moves`, with optional `boolean` `createAnyway`
— mirroring `algorithms.ts:76-83`, including the explicit rejection of a
non-boolean `createAnyway`. Delegates to `updateAlgorithm`.

#### 5. Rename-list island

**File**: `src/components/app/RenameListForm.tsx` (new)

**Intent**: Let the owner change the list name in place on the list page. Small
enough to be a direct sibling of `CreateListForm`, whose validation and submit
shape it copies.

**Contract**: Props `{ listId: string; currentName: string }`. Controlled input
seeded with `currentName`; synchronous validation mirroring
`CreateListForm.tsx:17-28` (same two messages, cleared on the next keystroke);
`PATCH /api/lists/:listId`; on `200` reload so the heading, the page title, and
the delete prompt all pick up the new name. Labelled input, error in
`role="alert"`.

#### 6. Edit-algorithm island

**File**: `src/components/app/EditAlgorithmForm.tsx` (new)

**Intent**: The edit counterpart of `AddAlgorithmForm`, on the algorithm's own
page. Carries the same client-side notation validation and the same duplicate
panel, so an edit that collides behaves exactly like an add that collides.

**Contract**: Props `{ algorithmId: string; listId: string; name: string; moves: string }`.
Fields seeded from props. Client-side `validateMoves` before the request, so the
message is identical to the server's and an invalid sequence costs no round trip
(the `AddAlgorithmForm` rationale). `PATCH /api/algorithms/:algoId`. Response
handling reuses the add form's three-state shape: `updated` → reload;
`duplicate` → render the panel offering the existing algorithm, with a
"Save anyway" action that resubmits with `createAnyway: true` and the typed values
intact behind the panel; `already_in_list` → panel without the save-anyway
action. Keep the panel focus-move on appearance (`AddAlgorithmForm.tsx:42-47`).
Because a moves change clears the mastery streak, the form must say so before
submission — a static note next to the moves field, not a second confirm dialog.
Mount it behind a disclosure on the page so the practice view stays the default.

#### 7. Algorithm page: mount the edit form

**File**: `src/pages/sets/[id]/[algoId].astro`

**Intent**: Add the edit surface behind the owner gate Phase 1 introduced.

**Contract**: Behind the same gate, mount `EditAlgorithmForm` with the algorithm's
`id`, `name`, `moves` and the `list.id` — all already in scope, no query change
needed on top of Phase 1's.

#### 8. Unit tests for both update cores

**Files**: `src/lib/lists/renameList.test.ts`, `src/lib/lists/updateAlgorithm.test.ts` (new)

**Intent**: Cover the status mapping and — for `updateAlgorithm` — the branch
logic that the phase's two gotchas live in.

**Contract**: `renameList`: trim; empty → `400`; over-length → `400` with the
shared constant in the message; zero rows → `404`; DB error → `500` with nothing
leaked. `updateAlgorithm`, following `addAlgorithm.test.ts`: invalid notation →
`400`; a name-only edit (moves normalize unchanged) performs **no** duplicate
probe and **no** mastery reset — assert the calls are absent, not merely that the
response is `200`; a moves change whose sequence exists in the same list → `409`;
existing elsewhere → `200 duplicate` with the pre-built match preferred;
`createAnyway: true` → update proceeds; the row under edit is excluded from the
probe, so a name-only edit never self-matches; the mastery reset is issued
**before** the update; the update payload never contains `moves_normalized`.

#### 9. Two-account update isolation test

**File**: `src/test/integration/listMutationIsolation.int.test.ts`

**Intent**: Extend Phase 1's file to cover `al_update` and `alg_update` — the
other half of test-plan risk #2 for these endpoints.

**Contract**: User B attempts to rename A's list and to edit A's algorithm;
assert zero rows affected and that A's values are unchanged when A reads them
back. Keep the queries join-free, per the lessons.md RLS break-check rule. Also
assert a pre-built list cannot be renamed and a pre-built algorithm cannot be
edited.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Unit suite passes, including both new update-core test files: `npm test`
- Integration suite passes, with the isolation test extended to update: `npm run test:integration`

#### Manual Verification:

- Renaming an owned list updates the heading and the browser tab title, and the
  new name appears on the dashboard.
- Editing only an algorithm's name leaves its move sequence and its practice
  streak untouched — verify against an algorithm with at least one clean run
  recorded.
- Editing an algorithm's moves to a sequence held by a pre-built set shows the
  duplicate panel naming that set; "Save anyway" completes the edit.
- Editing an algorithm's moves to a sequence already present in the same list is
  refused with the already-in-list message.
- After a moves change, a practice session starts from the new sequence and the
  streak counter has restarted from zero.
- An invalid move token is rejected before any request is sent, with the same
  message the add form gives.
- No rename or edit control appears anywhere within a pre-built set.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful.

---

## Testing Strategy

### Unit Tests:

Four new lib-module suites against a mocked Supabase client, following
`createList.test.ts` and `addAlgorithm.test.ts`. The edge cases that carry real
risk:

- Zero-rows-affected on update or delete maps to `404`, not `200` — an RLS-hidden
  row is not an error, it is an absence.
- No DB error string reaches a response body, in any branch.
- A name-only edit issues neither a duplicate probe nor a mastery reset.
- The duplicate probe excludes the row under edit.
- The mastery reset precedes the moves update.
- No update payload contains `moves_normalized`.

### Integration Tests:

One two-account suite covering all four new operations against a real local
stack: B cannot update or delete A's list or A's algorithm, and nobody can
mutate `is_system` content. Queries stay join-free so each assertion pins one
policy rather than a parent/child conjunction (lessons.md). Note that
`npx supabase db reset` seeds only `seed.sql` — 8 algorithms, no parenthesised
grouping — so any fixture this suite needs is created explicitly rather than
assumed from the seed (lessons.md).

### Manual Testing Steps:

1. Create a list, add four algorithms, practise one to a clean run.
2. Delete the second algorithm; confirm the remaining rows read 1, 2, 3.
3. Rename the list; confirm the dashboard card, page heading, and tab title update.
4. Edit the practised algorithm's name only; confirm the streak survives.
5. Edit its moves; confirm the streak restarts and practice uses the new sequence.
6. Edit another algorithm's moves to a sequence a pre-built set already holds;
   confirm the duplicate panel, then "Save anyway".
7. Edit a third algorithm's moves to match the second's; confirm refusal.
8. Delete the list; confirm the prompt states the algorithm count, and that the
   dashboard no longer shows it.
9. Open a pre-built set and one of its algorithms; confirm no rename, edit, or
   delete control is present anywhere.

## Performance Considerations

Nothing here is on a hot path. The duplicate probe on edit is the same
index-backed equality on `moves_normalized`
(`algorithms_moves_normalized_idx`) that add already runs, and it only runs when
the sequence actually changed. Deletes cascade through `practice_sessions` and
`algorithm_mastery`, both of which are small per user and indexed on
`(user_id, algorithm_id)`. `updateAlgorithm` issues up to four round trips (read,
probe, mastery reset, update); they are inherently ordered, so there is nothing
for `Promise.all` to parallelise.

## Migration Notes

No schema migration. Existing rows need no backfill: `position` gaps are
tolerated by design once the display reads the array index, and no new column is
introduced.

The one behavioural change to existing data is that `position` values will drift
away from the numbers a learner sees. Anything added later that treats `position`
as a display value would be wrong; it is an ordering key only.

## References

- Change: `context/changes/crud-algo-functions/change.md`
- RLS policies (all four already present): `supabase/migrations/20260527000000_domain_schema_rls.sql:69-128`
- Generated column + provenance FK: `supabase/migrations/20260826000000_algorithms_normalized_moves_and_source.sql:30,50`
- Lib-module + thin-route pattern: `src/lib/lists/createList.ts`, `src/pages/api/lists/index.ts`
- FR-015 duplicate probe to reuse: `src/lib/lists/addAlgorithm.ts:116-145`
- Owner-gate idiom: `src/pages/sets/[id].astro:56`
- Client fetch + navigate idiom: `src/components/app/CreateListForm.tsx:38-48`
- Duplicate panel + focus management: `src/components/app/AddAlgorithmForm.tsx`
- Two-account isolation precedent: `src/test/integration/listIsolation.int.test.ts`
- Applicable rules: `context/foundation/lessons.md` — RLS break-check scope,
  `order("table(column)")` syntax, generated columns, DB errors are not for the
  page, `Promise.all` for independent queries
- Risk this covers: `context/foundation/test-plan.md` §2 risk #2 (cross-user data access)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Delete (list + algorithm)

#### Automated

- [x] 1.1 Lint passes: `npm run lint`
- [x] 1.2 Build passes: `npm run build`
- [x] 1.3 Unit suite passes, including the two new delete-core test files: `npm test`
- [x] 1.4 Integration suite passes, including the new isolation test: `npm run test:integration`

#### Manual

- [x] 1.5 Owned list: delete control appears, confirm names the algorithm count, confirming returns to dashboard and the list is gone
- [x] 1.6 Pre-built set: no delete control on the list page or any algorithm page within it
- [x] 1.7 Deleting the second of four algorithms leaves rows numbered 1, 2, 3 with no hole
- [x] 1.8 Cancelling the confirm leaves the list and its algorithms intact
- [x] 1.9 Deleting an algorithm returns to its list page and the row is gone

### Phase 2: Update (rename list + edit algorithm)

#### Automated

- [ ] 2.1 Lint passes: `npm run lint`
- [ ] 2.2 Build passes: `npm run build`
- [ ] 2.3 Unit suite passes, including both new update-core test files: `npm test`
- [ ] 2.4 Integration suite passes, with the isolation test extended to update: `npm run test:integration`

#### Manual

- [ ] 2.5 Renaming an owned list updates heading, tab title, and the dashboard card
- [ ] 2.6 Name-only edit leaves the move sequence and the practice streak untouched
- [ ] 2.7 Editing moves to a pre-built set's sequence shows the duplicate panel; "Save anyway" completes the edit
- [ ] 2.8 Editing moves to a sequence already in the same list is refused with the already-in-list message
- [ ] 2.9 After a moves change, practice uses the new sequence and the streak has restarted from zero
- [ ] 2.10 An invalid move token is rejected before any request is sent, with the add form's message
- [ ] 2.11 No rename or edit control appears anywhere within a pre-built set

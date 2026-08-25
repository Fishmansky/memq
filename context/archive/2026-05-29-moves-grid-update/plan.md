# Moves Grid Layout Rework — Implementation Plan

## Overview

Rework the three move-grids in `PracticeSession.tsx` (Side/Central/Rotation) to
match the exact layout in `change.md`: wider grids, and four "big" L-shaped
buttons (`F`, `F'`, `B`, `B'`) that give the most-used face moves a much larger
touch target while the wide-move variants (`f`, `f'`, `b`, `b'`) keep their own
small button nested into the big button's corner. Adds a real-algorithm E2E
regression test proving the reworked grid still drives a practice session
correctly end to end.

## Current State Analysis

`PracticeSession.tsx` renders three independent grids (`SIDE_GRID` 7 cols,
`CENTRAL_GRID` 4 cols, `ROTATION_GRID` 4 cols — `PracticeSession.tsx:45-90`)
via a shared `MoveGrid` sub-component (`PracticeSession.tsx:212-230`) that
places each `GridCell` with a single grid line (`gridColumnStart`/
`gridRowStart`) — no support for a cell spanning more than one column/row.
Buttons are plain `<button>`s (not the shared `Button` component) sized only
by padding (`px-2 py-1`), which is why they read as cramped, especially the
face-turn moves (`F`, `F'`, `B`, `B'`) that get used disproportionately often
in algorithm memorization but currently occupy the same tiny cell as every
other move.

### Key Discoveries:

- `GridCell` (`PracticeSession.tsx:38-42`) has no span concept — every cell is
  exactly 1×1.
- The grid↔keyboard parity test (`PracticeSession.parity.test.ts`) checks
  **move-token Set equality only** (`SIDE_GRID`/`CENTRAL_GRID`/`ROTATION_GRID`
  moves vs `KEY_TO_MOVE`) — repositioning cells or adding span fields is safe
  as long as the *set* of move strings is unchanged. It is unchanged in this
  plan (still 24 + 6 + 6 = 36 unique tokens).
- `PracticeSession.test.tsx` queries grid buttons with
  `screen.getByRole("button", { name: "<move>" })`, which throws if more than
  one button shares that accessible name. The final design below produces
  **zero duplicate move-labeled buttons** (each of `F`, `F'`, `B`, `B'` is
  exactly one button, just L-shaped), so no existing test assertion needs to
  change.
- `playwright/test/practice-loop-persistence.spec.ts` +
  `playwright/test/E2E_RULES.md` establish the house style for a real,
  DB-backed practice-session E2E test: sign in via shared `storageState`,
  reach an algorithm via its set page and a `getByRole("link", { name })`
  click (**never hardcode the algorithm UUID in the spec**), drive the grid
  via `getByRole("button", { name, exact: true })`, normalize any streak
  assertion with a dirty run first. This plan's new E2E test follows the same
  house style.
- Algorithm `d195bbac-aedf-408d-9b66-db3b29a79caa` (set
  `00000000-0000-0000-0000-000000000003`, the "OLL" system list) resolved via
  the Supabase REST API is **"OLL 3"**, moves `f (R U R' U') f' U' F (R U R'
  U') F'` — 13 tokens: `f R U R' U' f' U' F R U R' U' F'`. It exercises both
  new big buttons (`F` and `F'`) plus their notch neighbors (`f`, `f'`), which
  makes it a good regression case for the new grid shape.

## Desired End State

The three grids render with the exact column/row layout specified in
`change.md`. `F`, `F'`, `B`, `B'` are each one big (2×2, one corner notched)
button; `f`, `f'`, `b`, `b'` sit in that notch as their own normal-size
button. `M`/`M'`/`E`/`E'` and `x`/`x'`/`y`/`y'` are 2-column-wide buttons;
`S`/`S'`/`z`/`z'` stay single-width. All existing unit tests
(`PracticeSession.test.tsx`, `PracticeSession.parity.test.ts`) pass unchanged.
A new Playwright spec drives a real practice session for "OLL 3" through the
reworked Side grid and reaches the clean-run completion banner.

Verify via: `npm run test`, `npm run lint`, `npm run build`, `npm run
test:e2e -- moves-grid-rework`, plus manual visual comparison against the
`change.md` sketch.

## What We're NOT Doing

- No responsive/mobile breakpoints — grids stay fixed-size, as today.
- No change to `KEY_TO_MOVE`, the reducer, `parseMoves`, or any keyboard
  handling.
- No change to the W/X2 modifier buttons' styling.
- No migration to the shared `Button` component for grid cells — kept as
  bespoke `<button>`s, resized.
- No pixel-perfect design-file matching — structural/positional fidelity to
  `change.md` is the bar, not a visual diff tool.

## Implementation Approach

Add two optional fields to `GridCell` — `colSpan?: number` and `rowSpan?:
number` (both default to 1 when absent) — and rewrite the three grid arrays
with the coordinates below. `MoveGrid` positions each cell via a single
`gridColumn`/`gridRow` shorthand (start line + span) instead of the current
start-only styles, and the button element stretches to fill its (possibly
spanned) cell instead of shrinking to its padding.

The four L-shaped buttons (`F`, `F'`, `B`, `B'`) are implemented as one
`<button>` whose grid area is the full 2×2 bounding box; the notch move
(`f`/`f'`/`b`/`b'`) is a separate `<button>` placed at the single notched
cell. Each big button carries an optional `notch?: NotchCorner` field that
drives a `NOTCH_CLIP_PATH` lookup, applied as a CSS `clip-path` on the big
button to geometrically remove its notch quadrant's hit-area — this is what
carves the visual L and keeps the notch independently clickable, regardless
of DOM/array order.

## Critical Implementation Details

**Notch carving via clip-path.** `SIDE_GRID`'s big buttons (`F'`, `F`, `B`,
`B'`) each fully cover their notch cell's bounding box. Rather than relying
on paint order, each big button's `notch` field clips away the quadrant
where its notch cell (`f'`, `f`, `b`, `b'`) sits, so the notch button is
never actually covered and stays clickable no matter where it appears in
the array.

## Phase 1: Grid layout rework

### Overview

Rewrite `GridCell`, the three grid arrays, and `MoveGrid`'s rendering to
produce the layout in `change.md`.

### Changes Required:

#### 1. `GridCell` type

**File**: `src/components/app/PracticeSession.tsx` (lines 38-42)

**Intent**: Let a cell span more than one column and/or row so a button can
be visually bigger than its neighbors.

**Contract**: Add two optional fields, both defaulting to `1` when absent:

```ts
export interface GridCell {
  move: string;
  col: number;
  row: number;
  colSpan?: number;
  rowSpan?: number;
}
```

#### 2. `SIDE_GRID` data (lines 45-70)

**Intent**: Reposition all 24 side-layer moves per `change.md`'s left-most
section; widen the grid from 7 to 8 columns; make `F`, `F'`, `B`, `B'` big
L-shaped buttons.

**Contract**: Replace the literal array with (order matters — see Critical
Implementation Details):

| # | move | col | row | colSpan | rowSpan |
|---|------|-----|-----|---------|---------|
| 1 | `U` | 3 | 0 | | |
| 2 | `U'` | 4 | 0 | | |
| 3 | `u` | 3 | 1 | | |
| 4 | `u'` | 4 | 1 | | |
| 5 | `F'` | 2 | 2 | 2 | 2 |
| 6 | `F` | 4 | 2 | 2 | 2 |
| 7 | `L'` | 0 | 3 | | |
| 8 | `l'` | 1 | 3 | | |
| 9 | `f'` | 3 | 3 | | |
| 10 | `f` | 4 | 3 | | |
| 11 | `r` | 6 | 3 | | |
| 12 | `R` | 7 | 3 | | |
| 13 | `L` | 0 | 4 | | |
| 14 | `l` | 1 | 4 | | |
| 15 | `B` | 2 | 4 | 2 | 2 |
| 16 | `b` | 3 | 4 | | |
| 17 | `B'` | 4 | 4 | 2 | 2 |
| 18 | `b'` | 4 | 4 | | |
| 19 | `r'` | 6 | 4 | | |
| 20 | `R'` | 7 | 4 | | |
| 21 | `d'` | 3 | 6 | | |
| 22 | `d` | 4 | 6 | | |
| 23 | `D'` | 3 | 7 | | |
| 24 | `D` | 4 | 7 | | |

Grid is now 8 columns × 8 rows (rows 5 has no standalone cells — fully
covered by `B`/`B'`'s `rowSpan`).

#### 3. `CENTRAL_GRID` data (lines 73-80)

**Intent**: Widen from 4 to 6 columns; make `M`, `M'`, `E`, `E'` 2-column-wide
buttons; `S`, `S'` stay single-width.

**Contract**:

| move | col | row | colSpan |
|------|-----|-----|---------|
| `M'` | 2 | 0 | 2 |
| `E'` | 0 | 1 | 2 |
| `S'` | 2 | 1 | |
| `S` | 3 | 1 | |
| `E` | 4 | 1 | 2 |
| `M` | 2 | 2 | 2 |

No overlaps in this grid — plain `colSpan`, no ordering constraint.

#### 4. `ROTATION_GRID` data (lines 83-90)

**Intent**: Widen from 4 to 6 columns; make `x`, `x'`, `y`, `y'`
2-column-wide buttons; `z`, `z'` stay single-width.

**Contract**:

| move | col | row | colSpan |
|------|-----|-----|---------|
| `x` | 2 | 0 | 2 |
| `y` | 0 | 1 | 2 |
| `z'` | 2 | 1 | |
| `z` | 3 | 1 | |
| `y'` | 4 | 1 | 2 |
| `x'` | 2 | 2 | 2 |

#### 5. `MoveGrid` rendering (lines 212-230)

**Intent**: Support `colSpan`/`rowSpan` and make each button fill its
(possibly spanned) cell instead of shrinking to its padding.

**Contract**: Replace the per-cell `style` (currently
`gridColumnStart`/`gridRowStart` only) with a shorthand that encodes both
start and span, e.g. `gridColumn: `${cell.col + 1} / span ${cell.colSpan ??
1}`` and the equivalent for `gridRow`. Add sizing classes to the button so it
stretches to fill its grid area (e.g. `w-full h-full flex items-center
justify-center`) rather than sizing to its text/padding.

#### 6. Grid `columns` props at the call site (line ~437-439)

**Intent**: Match the new column counts.

**Contract**: `SIDE_GRID` → `columns={8}`, `CENTRAL_GRID` → `columns={6}`,
`ROTATION_GRID` → `columns={6}` (was 7/4/4).

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Existing unit tests pass unchanged: `npm run test`

#### Manual Verification:

- Side/Central/Rotation grids visually match `change.md`'s three ASCII
  sketches (positions, and which buttons are big/L-shaped/wide).
- `F`, `F'`, `B`, `B'` are each clickable as one big button; clicking inside
  the notch corner instead activates `f`/`f'`/`b`/`b'`.
- No regression in keyboard input (`W`/`X2` modifiers, letter keys) during a
  manual practice run.

---

## Phase 2: E2E regression test for the reworked grid

### Overview

Add a Playwright spec that drives a full practice session for a real
algorithm ("OLL 3") through the reworked Side grid, following the existing
house style in `playwright/test/practice-loop-persistence.spec.ts` and
`playwright/test/E2E_RULES.md`.

### Changes Required:

#### 1. New spec file

**File**: `playwright/test/moves-grid-rework.spec.ts`

**Intent**: Prove the rebuilt Side grid still drives a real, DB-backed
practice session correctly — specifically exercising both new L-shaped
buttons (`F` and `F'`) and their notch neighbors (`f`, `f'`) via a real
algorithm, not synthetic moves.

**Contract**:
- Reach the algorithm via its set page, never hardcoding the algorithm UUID:
  `page.goto("/sets/00000000-0000-0000-0000-000000000003")` →
  `page.getByRole("link", { name: "OLL 3" }).click()`.
- Move sequence to input in order (13 tokens): `f R U R' U' f' U' F R U R'
  U' F'`. Each click is `page.getByRole("button", { name, exact: true
  }).click()` — the `exact: true` matters because move names collide by
  substring (`F` vs `F'`).
- Normalize the streak like the existing persistence spec: one dirty run
  (any wrong first move, e.g. `D`) asserting `/Streak reset\./`, then a clean
  run asserting `Consecutive clean: 1.`.
- Reuse or duplicate the `startSession`/`runSession`/`inputSequence` helper
  shape from `practice-loop-persistence.spec.ts` — implementer's call on
  whether to extract a shared helper module now that two specs need it.

### Success Criteria:

#### Automated Verification:

- New spec passes: `npm run test:e2e -- moves-grid-rework`
- Full E2E suite still passes: `npm run test:e2e`
- Lint passes: `npm run lint`

#### Manual Verification:

- Spec run observed at least once locally against the real preview server
  (not just CI) to confirm no flake from the new grid's click targets.

---

## Testing Strategy

### Unit Tests:

- No new unit tests — `PracticeSession.parity.test.ts` and
  `PracticeSession.test.tsx` are the regression guard for token-set parity
  and click-by-name behavior; both pass unchanged against the new
  coordinates (verified by design: move-token set is unchanged, no duplicate
  accessible names introduced).

### Integration Tests:

- None — no server/API behavior changes.

### E2E / Manual Testing Steps:

1. Run `npm run test:e2e -- moves-grid-rework` and confirm it passes.
2. Start a practice session manually and visually compare all three grids
   against `change.md`.
3. Click into the notch corner of each of `F`, `F'`, `B`, `B'` and confirm
   the smaller move (`f`, `f'`, `b`, `b'`) is what activates, not the big
   button underneath.

## Performance Considerations

None — this is a static layout change to a small (36-cell) client-rendered
grid; no measurable performance impact.

## Migration Notes

None — no data model or persisted-state changes.

## References

- Ticket: `context/changes/moves-grid-update/change.md`
- Grid implementation: `src/components/app/PracticeSession.tsx:38-90,212-230`
- Parity risk (why the move-token set must stay unchanged):
  `context/archive/2026-06-02-testing-bootstrap-core-logic-units/research.md:181-197`
- E2E house style: `playwright/test/E2E_RULES.md`,
  `playwright/test/practice-loop-persistence.spec.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Grid layout rework

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — 56cd494
- [x] 1.2 Build passes: `npm run build` — 56cd494
- [x] 1.3 Existing unit tests pass unchanged: `npm run test` — 56cd494

#### Manual

- [x] 1.4 Side/Central/Rotation grids visually match `change.md`'s sketches — 56cd494
- [x] 1.5 `F`/`F'`/`B`/`B'` big-button + notch click behavior correct — 56cd494
- [x] 1.6 No regression in keyboard input during a manual practice run — 56cd494

### Phase 2: E2E regression test for the reworked grid

#### Automated

- [x] 2.1 New spec passes: `npm run test:e2e -- moves-grid-rework` — 5bc4176
- [x] 2.2 Full E2E suite still passes: `npm run test:e2e` — 5bc4176
- [x] 2.3 Lint passes: `npm run lint` — 5bc4176

#### Manual

- [x] 2.4 Spec run observed at least once locally against the real preview server — 5bc4176

# Moves Grid Layout Rework — Plan Brief

> Full plan: `context/changes/moves-grid-update/plan.md`

## What & Why

Rework the three move-grids in the practice session (`PracticeSession.tsx`)
so buttons match the exact layout the ticket sketched — some buttons are
currently too small and misplaced. The fix gives the most-used face moves
(`F`, `F'`, `B`, `B'`) a much bigger, L-shaped touch target, widens all three
grids, and adds an E2E regression test proving the new grid still drives a
real algorithm correctly.

## Starting Point

Today, three data arrays (`SIDE_GRID` 7 cols, `CENTRAL_GRID`/`ROTATION_GRID`
4 cols each) place every button at exactly 1×1 via `gridColumnStart`/
`gridRowStart`. Buttons are plain `<button>`s sized only by padding — nothing
supports a cell spanning multiple columns/rows.

## Desired End State

Side grid is 8×8, Central/Rotation are 6×3. `F`/`F'`/`B`/`B'` are each one
big L-shaped button (2×2 minus one corner); the wide-move variant (`f`/`f'`/
`b`/`b'`) sits in that corner as its own small button. `M`/`M'`/`E`/`E'`/`x`/
`x'`/`y`/`y'` are 2-column-wide; everything else stays 1×1. A new Playwright
spec runs a real "OLL 3" session through the new grid.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Big-button shape | Single L-shaped element (2×2 box, notch corner covered by a separate small button via plain DOM order) | User explicitly wanted one clickable shape, not two overlapping controls | Plan (iterated w/ user) |
| Span data model | `colSpan?`/`rowSpan?` on `GridCell`, default 1 | Minimal additive fields; no clip-path or z-index needed since paint order handles the notch | Plan |
| Button sizing | Base cell size fixed (~2.5rem); spans multiply it | Matches existing `minmax(2.5rem,1fr)` pattern already in the code | Plan |
| Shared `Button` component | Not used — keep bespoke `<button>` | CVA size variants are fixed squares; can't express per-cell spans | Plan |
| Responsiveness | None added — fixed-size grids | Matches existing code; ticket only asks for a layout fix | Plan |
| Fidelity bar | Structural/positional match to `change.md`, not pixel-perfect | No design mockup exists, only ASCII | Plan |
| Scope | Layout/sizing + one new E2E test only | Modifier buttons, keyboard map, reducer untouched | Plan (E2E added after user revised testing scope) |
| Testing | Existing unit tests unchanged (zero duplicate button names in final design) + new Playwright spec on real "OLL 3" algorithm | User asked for concrete algorithm-driven regression coverage | Plan |

## Scope

**In scope:**
- `GridCell` type, `SIDE_GRID`/`CENTRAL_GRID`/`ROTATION_GRID` data, `MoveGrid` rendering, grid `columns` props.
- New Playwright spec `playwright/test/moves-grid-rework.spec.ts` (algorithm "OLL 3", set `00000000-0000-0000-0000-000000000003`).

**Out of scope:**
- Responsive/mobile breakpoints.
- `KEY_TO_MOVE`, reducer, `parseMoves`, keyboard handling.
- W/X2 modifier button styling.
- Migrating grid buttons to the shared `Button` component.

## Architecture / Approach

Two additive optional fields (`colSpan`, `rowSpan`) on the existing
`GridCell` literal-array model. `MoveGrid` places each cell with a single
`gridColumn`/`gridRow` start+span shorthand. The four L-shaped buttons rely
on plain CSS-grid overlap + DOM/array order (no clip-path): the big button's
2×2 box is listed before its notch cell, so the notch paints on top and stays
independently clickable.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Grid layout rework | New coordinates/spans for all 3 grids, L-shaped big buttons, updated `columns` props | Array-order mistake breaks a notch button's clickability |
| 2. E2E regression test | Real-algorithm Playwright spec exercising the new L-shaped buttons | Flake from click targets if spans render wrong |

**Prerequisites:** None — single existing file plus one new spec file.
**Estimated effort:** ~1 session, 2 phases.

## Open Risks & Assumptions

- Relies on default CSS-grid paint order (later DOM element on top) for the
  notch buttons — well-supported standard behavior, but worth the manual
  click-into-the-notch check called out in Phase 1's manual verification.
- The E2E spec depends on the real hosted Supabase project's seeded data for
  algorithm "OLL 3" remaining unchanged.

## Success Criteria (Summary)

- All three grids visually match `change.md`'s layout.
- `F`/`F'`/`B`/`B'` are each one big clickable shape; their notch buttons
  remain independently clickable.
- Existing unit tests and the new E2E spec all pass.

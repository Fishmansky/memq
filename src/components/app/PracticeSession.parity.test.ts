import { describe, expect, it } from "vitest";
import { CENTRAL_GRID, type GridCell, KEY_TO_MOVE, ROTATION_GRID, SIDE_GRID } from "@/components/app/PracticeSession";

const WIDE_SENTINEL = "__wide_modifier__";
const DOUBLE_SENTINEL = "__double_modifier__";

// A grid button emits its `move` field verbatim (label === token), so this set
// IS the grid-emittable token set.
const gridTokens = new Set<string>([...SIDE_GRID, ...CENTRAL_GRID, ...ROTATION_GRID].map((c: GridCell) => c.move));

// Directly keyboard-typeable tokens: every KEY_TO_MOVE value except the two
// modifier sentinels (w / 2), which are modifiers, not face tokens.
const keyboardBase = new Set<string>(
  Object.values(KEY_TO_MOVE).filter((v) => v !== WIDE_SENTINEL && v !== DOUBLE_SENTINEL),
);

// The wide modifier (w) lowercases the assembled token (see dispatchMove), so
// each base token ALSO reaches its lowercase form — this is the grid's wide
// cells (u, r', l, ...). Encoding this asymmetry is the point: a flat
// set-equality would false-fail, and label==token is a tautology.
const keyboardWithWide = new Set<string>([...keyboardBase, ...[...keyboardBase].map((t) => t.toLowerCase())]);

describe("grid ↔ keyboard parity (#5 input desync)", () => {
  it("the w / 2 sentinels are modifiers, not face tokens", () => {
    expect(KEY_TO_MOVE.w).toBe(WIDE_SENTINEL);
    expect(KEY_TO_MOVE["2"]).toBe(DOUBLE_SENTINEL);
    expect(gridTokens.has(WIDE_SENTINEL)).toBe(false);
    expect(gridTokens.has(DOUBLE_SENTINEL)).toBe(false);
  });

  it("every grid-emittable token has a keyboard route (incl. wide lowercasing)", () => {
    const orphanGridTokens = [...gridTokens].filter((t) => !keyboardWithWide.has(t));
    expect(orphanGridTokens).toEqual([]);
  });

  it("every directly-typed keyboard token has a grid cell", () => {
    const keyboardOnly = [...keyboardBase].filter((t) => !gridTokens.has(t));
    expect(keyboardOnly).toEqual([]);
  });
});

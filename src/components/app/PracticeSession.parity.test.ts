import { describe, expect, it } from "vitest";
import { CENTRAL_GRID, type GridCell, KEY_TO_MOVE, ROTATION_GRID, SIDE_GRID } from "@/components/app/PracticeSession";
import { DOUBLE_SENTINEL, KEYBOARD_BASE_TOKENS, KEYBOARD_WITH_WIDE_TOKENS, WIDE_SENTINEL } from "@/test/tokenGrammar";

// A grid button emits its `move` field verbatim (label === token), so this set
// IS the grid-emittable token set.
const gridTokens = new Set<string>([...SIDE_GRID, ...CENTRAL_GRID, ...ROTATION_GRID].map((c: GridCell) => c.move));

// Directly keyboard-typeable tokens and their wide (lowercased) forms come from
// the shared grammar helper — see src/test/tokenGrammar.ts. Encoding the wide
// asymmetry is the point: a flat set-equality would false-fail, and
// label==token is a tautology.

describe("grid ↔ keyboard parity (#5 input desync)", () => {
  it("the w / 2 sentinels are modifiers, not face tokens", () => {
    expect(KEY_TO_MOVE.w).toBe(WIDE_SENTINEL);
    expect(KEY_TO_MOVE["2"]).toBe(DOUBLE_SENTINEL);
    expect(gridTokens.has(WIDE_SENTINEL)).toBe(false);
    expect(gridTokens.has(DOUBLE_SENTINEL)).toBe(false);
  });

  it("every grid-emittable token has a keyboard route (incl. wide lowercasing)", () => {
    const orphanGridTokens = [...gridTokens].filter((t) => !KEYBOARD_WITH_WIDE_TOKENS.has(t));
    expect(orphanGridTokens).toEqual([]);
  });

  it("every directly-typed keyboard token has a grid cell", () => {
    const keyboardOnly = [...KEYBOARD_BASE_TOKENS].filter((t) => !gridTokens.has(t));
    expect(keyboardOnly).toEqual([]);
  });
});

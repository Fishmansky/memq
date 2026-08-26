import { describe, expect, it } from "vitest";
import { reducer, type State } from "@/components/app/PracticeSession";
import { parseMoves } from "@/lib/notation/moveGrammar";

// Oracle is the *intended rule*, never the comparator under test: the expected
// move at each index is hardcoded as a literal here, not read back from the
// reducer's own `tokens[currentIndex]` comparison.
const TOKENS = ["R", "U", "R'"];

function activeState(overrides: Partial<State> = {}): State {
  return {
    phase: "active",
    slotResults: TOKENS.map(() => "pending"),
    currentIndex: 0,
    errorCount: 0,
    result: null,
    wideModifier: false,
    doubleModifier: false,
    submitError: null,
    ...overrides,
  };
}

describe("reducer — INPUT_MOVE (#3 move validation)", () => {
  it("correct move advances currentIndex and marks the slot correct", () => {
    // First expected move is literally "R".
    const next = reducer(activeState(), { type: "INPUT_MOVE", move: "R" }, TOKENS);
    expect(next.currentIndex).toBe(1);
    expect(next.slotResults[0]).toBe("correct");
    expect(next.errorCount).toBe(0);
    expect(next.phase).toBe("active");
  });

  it("wrong move blocks: no advance, no phase change, errorCount++, slot wrong", () => {
    // "F" is not the expected first move "R".
    const next = reducer(activeState(), { type: "INPUT_MOVE", move: "F" }, TOKENS);
    expect(next.currentIndex).toBe(0); // did NOT advance
    expect(next.phase).toBe("active"); // did NOT change
    expect(next.errorCount).toBe(1);
    expect(next.slotResults[0]).toBe("wrong");
  });

  it("each wrong attempt counts and never advances", () => {
    let s = activeState();
    s = reducer(s, { type: "INPUT_MOVE", move: "F" }, TOKENS);
    s = reducer(s, { type: "INPUT_MOVE", move: "D" }, TOKENS);
    expect(s.errorCount).toBe(2);
    expect(s.currentIndex).toBe(0);
  });

  it("correct move on the final slot completes the run (phase → submitting)", () => {
    // At the last index, expected move is literally "R'".
    const atLast = activeState({ currentIndex: 2, slotResults: ["correct", "correct", "pending"] });
    const next = reducer(atLast, { type: "INPUT_MOVE", move: "R'" }, TOKENS);
    expect(next.currentIndex).toBe(3);
    expect(next.phase).toBe("submitting");
    expect(next.slotResults[2]).toBe("correct");
  });

  it("INPUT_MOVE is ignored when phase is not active", () => {
    const idle = activeState({ phase: "idle" });
    const next = reducer(idle, { type: "INPUT_MOVE", move: "R" }, TOKENS);
    expect(next).toBe(idle);
  });

  it("green-vs-amber end predicate: errorCount === 0 iff the whole run was clean", () => {
    // Clean walk: every move correct.
    let clean = activeState();
    clean = reducer(clean, { type: "INPUT_MOVE", move: "R" }, TOKENS);
    clean = reducer(clean, { type: "INPUT_MOVE", move: "U" }, TOKENS);
    clean = reducer(clean, { type: "INPUT_MOVE", move: "R'" }, TOKENS);
    expect(clean.errorCount === 0).toBe(true); // green

    // One wrong attempt anywhere → amber.
    let dirty = activeState();
    dirty = reducer(dirty, { type: "INPUT_MOVE", move: "F" }, TOKENS); // wrong
    dirty = reducer(dirty, { type: "INPUT_MOVE", move: "R" }, TOKENS);
    expect(dirty.errorCount === 0).toBe(false); // amber
  });
});

describe("parseMoves (#3 tokenizer)", () => {
  it("splits on whitespace and drops empties", () => {
    expect(parseMoves("R U R' U'")).toEqual(["R", "U", "R'", "U'"]);
  });

  it("strips parentheses (trigger-grouping notation)", () => {
    expect(parseMoves("(R U R') U'")).toEqual(["R", "U", "R'", "U'"]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseMoves("")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { computeStreak } from "@/lib/practice/streak";

// Oracle = the intended rule, NOT the helper's own expression: a clean run
// increments the count by 1, any non-clean run resets it to 0, and mastery is
// reached at exactly 3 consecutive clean runs (and stays reached once hit).
interface Case {
  name: string;
  currentClean: number;
  alreadyMastered: boolean;
  isClean: boolean;
  expectClean: number;
  expectMastery: boolean;
}

const cases: Case[] = [
  {
    name: "first clean session (missing row → currentClean 0) → 1, no PRO",
    currentClean: 0,
    alreadyMastered: false,
    isClean: true,
    expectClean: 1,
    expectMastery: false,
  },
  {
    name: "second clean → 2, still no PRO",
    currentClean: 1,
    alreadyMastered: false,
    isClean: true,
    expectClean: 2,
    expectMastery: false,
  },
  {
    name: "third consecutive clean → 3, triggers PRO",
    currentClean: 2,
    alreadyMastered: false,
    isClean: true,
    expectClean: 3,
    expectMastery: true,
  },
  {
    name: "non-clean run resets count to 0, no PRO",
    currentClean: 2,
    alreadyMastered: false,
    isClean: false,
    expectClean: 0,
    expectMastery: false,
  },
  {
    name: "fresh clean after a reset → 1, no PRO",
    currentClean: 0,
    alreadyMastered: false,
    isClean: true,
    expectClean: 1,
    expectMastery: false,
  },
  {
    name: "mastery is sticky on a continued clean run",
    currentClean: 3,
    alreadyMastered: true,
    isClean: true,
    expectClean: 4,
    expectMastery: true,
  },
  {
    name: "mastery is sticky even when this run is not clean",
    currentClean: 3,
    alreadyMastered: true,
    isClean: false,
    expectClean: 0,
    expectMastery: true,
  },
];

describe("computeStreak (#4 streak rule)", () => {
  for (const c of cases) {
    it(c.name, () => {
      const r = computeStreak(c.currentClean, c.alreadyMastered, c.isClean);
      expect(r.newConsecutiveClean).toBe(c.expectClean);
      expect(r.newMasteryReached).toBe(c.expectMastery);
    });
  }

  it("off-by-one boundary: 2 consecutive clean is NOT PRO yet", () => {
    expect(computeStreak(1, false, true).newMasteryReached).toBe(false);
  });

  it("off-by-one boundary: exactly 3 consecutive clean IS PRO", () => {
    expect(computeStreak(2, false, true).newMasteryReached).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { completePractice } from "@/lib/practice/completePractice";

// Hermetic tests for the partial-failure branches a real DB cannot trigger on
// demand (a mid-sequence read error, an upsert error). We drive the seam with a
// stub client and assert the seam's structured result + that it logs. The real
// insert/read/upsert round-trip, the FK-as-real-constraint, and the streak
// persistence are covered by the integration suite (*.int.test.ts), not here.
//
// Oracle for the happy-path streak values is PRD FR-013 (clean increments;
// mastery at exactly 3 consecutive clean, sticky) — hand-written below, NOT
// derived from computeStreak (that would be a tautology).

interface StubConfig {
  insertError?: { code?: string } | null;
  masteryData?: { consecutive_clean: number; mastery_reached: boolean } | null;
  masteryError?: { message: string } | null;
  upsertError?: { message: string } | null;
}

// Minimal stand-in for the chained supabase-js calls the seam makes:
//   from("practice_sessions").insert(...)            -> { error }
//   from("algorithm_mastery").select().eq().eq().maybeSingle() -> { data, error }
//   from("algorithm_mastery").upsert(..., {...})      -> { error }
function makeStub(config: StubConfig): SupabaseClient<Database> {
  const stub = {
    from() {
      return {
        insert: () => Promise.resolve({ error: config.insertError ?? null }),
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: config.masteryData ?? null,
                  error: config.masteryError ?? null,
                }),
            }),
          }),
        }),
        upsert: () => Promise.resolve({ error: config.upsertError ?? null }),
      };
    },
  };
  return stub as unknown as SupabaseClient<Database>;
}

const USER = { id: "user-1" };
const CLEAN = { algorithmId: "algo-1", isClean: true, errorCount: 0 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("completePractice — error branches (hermetic)", () => {
  it("returns 400 Invalid algorithmId when the session insert hits FK violation 23503", async () => {
    const result = await completePractice(makeStub({ insertError: { code: "23503" } }), USER, CLEAN);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "Invalid algorithmId" });
  });

  it("returns 500 and logs when the session insert fails with a non-FK error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await completePractice(makeStub({ insertError: { code: "08006" } }), USER, CLEAN);
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: "Failed to record session" });
    expect(spy).toHaveBeenCalled();
  });

  it("returns 500 and logs when the mastery read fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await completePractice(makeStub({ masteryError: { message: "read boom" } }), USER, CLEAN);
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: "Failed to record session" });
    expect(spy).toHaveBeenCalled();
  });

  it("returns 500 and logs when the mastery upsert fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await completePractice(makeStub({ upsertError: { message: "upsert boom" } }), USER, CLEAN);
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: "Failed to record session" });
    expect(spy).toHaveBeenCalled();
  });
});

describe("completePractice — happy path result shape (hermetic)", () => {
  it("first clean run with no existing row returns 200 with consecutiveClean 1, not PRO", async () => {
    // FR-013 oracle: a single clean run is +1 and below the 3-run PRO threshold.
    const result = await completePractice(makeStub({ masteryData: null }), USER, CLEAN);
    expect(result).toEqual({ status: 200, body: { consecutiveClean: 1, masteryReached: false } });
  });

  it("third consecutive clean run returns 200 with consecutiveClean 3 and mastery reached", async () => {
    // FR-013 oracle: PRO fires at exactly 3 consecutive mistake-free runs.
    const result = await completePractice(
      makeStub({ masteryData: { consecutive_clean: 2, mastery_reached: false } }),
      USER,
      CLEAN,
    );
    expect(result).toEqual({ status: 200, body: { consecutiveClean: 3, masteryReached: true } });
  });
});

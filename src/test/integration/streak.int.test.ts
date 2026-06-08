import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { completePractice } from "@/lib/practice/completePractice";
import { cleanupUserRows, createTestUser, deleteTestUser, getSeededAlgorithmIds, serviceClient } from "./db";

// Risk #4 — "Streak miscounts."
//
// Proves the PERSISTED streak obeys PRD FR-013 across real insert -> read ->
// upsert cycles — the behavior a pure computeStreak test cannot see (DB
// defaults, the (user, algorithm) unique-key upsert, per-row isolation). Each
// expected value is hand-written from FR-013, NEVER imported from or recomputed
// via computeStreak (that would be a tautology against the code under test).
//
// FR-013 oracle: a clean run increments consecutive_clean by 1; any run with
// errors resets it to 0; "You're PRO!" (mastery_reached) fires at exactly 3
// consecutive mistake-free runs for the same algorithm and, once reached, stays
// reached (sticky); the count is tracked per (user, algorithm).

async function readMastery(svc: SupabaseClient<Database>, userId: string, algorithmId: string) {
  const { data, error } = await svc
    .from("algorithm_mastery")
    .select("consecutive_clean, mastery_reached")
    .eq("user_id", userId)
    .eq("algorithm_id", algorithmId)
    .maybeSingle();
  expect(error).toBeNull();
  return data;
}

describe("persisted streak through the real DB (#4)", () => {
  let svc: SupabaseClient<Database>;
  let userId: string;
  let authedClient: SupabaseClient<Database>;
  let algoA: string;
  let algoB: string;

  beforeAll(async () => {
    svc = serviceClient();
    const user = await createTestUser(svc);
    userId = user.userId;
    authedClient = user.authedClient;
    [algoA, algoB] = await getSeededAlgorithmIds(svc, 2);
  });

  afterEach(async () => {
    await cleanupUserRows(svc, userId);
  });

  afterAll(async () => {
    await deleteTestUser(svc, userId);
  });

  const clean = (algorithmId: string) =>
    completePractice(authedClient, { id: userId }, { algorithmId, isClean: true, errorCount: 0 });
  const dirty = (algorithmId: string) =>
    completePractice(authedClient, { id: userId }, { algorithmId, isClean: false, errorCount: 2 });

  it("clean runs increment 1 -> 2 -> 3 and flip mastery to true at exactly 3 (false at 2)", async () => {
    await clean(algoA);
    expect(await readMastery(svc, userId, algoA)).toMatchObject({ consecutive_clean: 1, mastery_reached: false });

    await clean(algoA);
    expect(await readMastery(svc, userId, algoA)).toMatchObject({ consecutive_clean: 2, mastery_reached: false });

    await clean(algoA);
    expect(await readMastery(svc, userId, algoA)).toMatchObject({ consecutive_clean: 3, mastery_reached: true });
  });

  it("a dirty run resets consecutive_clean to 0 while mastery_reached stays true (sticky)", async () => {
    await clean(algoA);
    await clean(algoA);
    await clean(algoA);
    expect(await readMastery(svc, userId, algoA)).toMatchObject({ consecutive_clean: 3, mastery_reached: true });

    await dirty(algoA);
    expect(await readMastery(svc, userId, algoA)).toMatchObject({ consecutive_clean: 0, mastery_reached: true });
  });

  it("a clean run on algorithm B does not change algorithm A's row (per-(user, algorithm) isolation)", async () => {
    await clean(algoA);
    await clean(algoA);
    expect(await readMastery(svc, userId, algoA)).toMatchObject({ consecutive_clean: 2, mastery_reached: false });

    await clean(algoB);
    expect(await readMastery(svc, userId, algoB)).toMatchObject({ consecutive_clean: 1, mastery_reached: false });
    // A untouched by B's run.
    expect(await readMastery(svc, userId, algoA)).toMatchObject({ consecutive_clean: 2, mastery_reached: false });
  });
});

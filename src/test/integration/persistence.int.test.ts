import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { completePractice } from "@/lib/practice/completePractice";
import { cleanupUserRows, createTestUser, deleteTestUser, getSeededAlgorithmIds, serviceClient } from "./db";

// Risk #1 — "Finished session result fails to persist."
//
// The endpoint's 200 body is computed in memory and lies about whether the
// write landed. So we drive the REAL write path (completePractice with an
// RLS-governed authed-user client) and then prove persistence with an
// INDEPENDENT service-role read-back — never by trusting the returned body.
//
// Oracle: PRD FR-013 + the domain schema (a first clean run = consecutive_clean
// 1, not yet PRO). Hand-written here, not derived from computeStreak.

describe("persistence read-back (#1)", () => {
  let svc: SupabaseClient<Database>;
  let userId: string;
  let authedClient: SupabaseClient<Database>;
  let algorithmId: string;

  beforeAll(async () => {
    svc = serviceClient();
    const user = await createTestUser(svc);
    userId = user.userId;
    authedClient = user.authedClient;
    [algorithmId] = await getSeededAlgorithmIds(svc, 1);
  });

  afterEach(async () => {
    await cleanupUserRows(svc, userId);
  });

  afterAll(async () => {
    await deleteTestUser(svc, userId);
  });

  it("a clean first run persists one practice_sessions row and one algorithm_mastery row (read-back, not the response body)", async () => {
    const result = await completePractice(authedClient, { id: userId }, { algorithmId, isClean: true, errorCount: 0 });
    // Guard only: the call must not have errored. The proof is the read-back.
    expect(result.status).toBe(200);

    const sessions = await svc
      .from("practice_sessions")
      .select("user_id, algorithm_id, is_clean, error_count")
      .eq("user_id", userId);
    expect(sessions.error).toBeNull();
    expect(sessions.data).toHaveLength(1);
    expect(sessions.data?.[0]).toMatchObject({
      user_id: userId,
      algorithm_id: algorithmId,
      is_clean: true,
      error_count: 0,
    });

    const mastery = await svc
      .from("algorithm_mastery")
      .select("user_id, algorithm_id, consecutive_clean, mastery_reached")
      .eq("user_id", userId);
    expect(mastery.error).toBeNull();
    expect(mastery.data).toHaveLength(1);
    expect(mastery.data?.[0]).toMatchObject({
      user_id: userId,
      algorithm_id: algorithmId,
      consecutive_clean: 1,
      mastery_reached: false,
    });
  });

  it("a bogus (non-seeded) algorithmId returns 400 and persists no practice_sessions row (real FK 23503)", async () => {
    const bogusId = crypto.randomUUID();
    const result = await completePractice(
      authedClient,
      { id: userId },
      { algorithmId: bogusId, isClean: true, errorCount: 0 },
    );
    expect(result.status).toBe(400);

    const sessions = await svc.from("practice_sessions").select("id").eq("user_id", userId);
    expect(sessions.error).toBeNull();
    expect(sessions.data).toHaveLength(0);
  });
});

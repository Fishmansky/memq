import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { createTestUser, deleteTestUser, getSeededAlgorithmIds, serviceClient } from "./db";

// Connectivity smoke: prove the harness can reach the DB, the seed loaded, and
// the throwaway-user lifecycle works — before any behavioral spec runs. No
// behavior under test here.

describe("integration harness smoke", () => {
  let svc: SupabaseClient<Database>;

  beforeAll(() => {
    svc = serviceClient();
  });

  it("reaches the DB and finds at least one seeded algorithm", async () => {
    const ids = await getSeededAlgorithmIds(svc, 1);
    expect(ids.length).toBe(1);
    expect(typeof ids[0]).toBe("string");
  });

  it("can create and delete a throwaway user", async () => {
    const { userId } = await createTestUser(svc);
    expect(typeof userId).toBe("string");
    await deleteTestUser(svc, userId);
  });

  afterAll(() => {
    // no shared user created at suite scope; per-test cleanup handles the rest
  });
});

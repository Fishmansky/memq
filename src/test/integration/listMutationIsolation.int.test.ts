import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { cleanupUserRows, createList, createTestUser, deleteTestUser, serviceClient, type TestUser } from "./db";

// Risk #2 — "One user reaches another user's data" — for the CRUD-completing
// WRITE endpoints. listIsolation.int.test.ts pins the read/insert side; this
// file pins the delete side of `al_delete` / `alg_delete` from both directions:
//   1. a non-owner (user B) cannot delete user A's list or algorithm;
//   2. nobody can delete PRE-BUILT content, which is the `is_system = false`
//      clause of the same two policies.
// (Phase 2 extends this file to `al_update` / `alg_update`.)
//
// Every hostile attempt drives an RLS-GOVERNED authed client, never the service
// client. A PostgREST DELETE filtered out by a policy returns 200 with an empty
// array rather than an error, so "affected zero rows" only means something once
// the row is read back — done twice here: by the owner through their own authed
// client (the claim the plan makes) and by the service client (proof the row is
// there to be found at all).
//
// Queries are deliberately JOIN-FREE. A query embedding `algorithm_lists` would
// be filtered by `al_select` as well, so a green result would prove the
// conjunction of two policies rather than the one under test (lessons.md).
//
// Oracle: supabase/migrations/20260527000000_domain_schema_rls.sql:74 (al_delete)
// and :119 (alg_delete) — both `user_id = auth.uid() AND is_system = false`,
// for `algorithms` via an EXISTS on the owning list.

// Absent from the seed is irrelevant here (nothing asserts duplicate scope), but
// it must be a sequence the app would actually store.
const A_MOVES = "R U R' U'";

describe("list mutation isolation — delete (#2)", () => {
  let svc: SupabaseClient<Database>;
  let userA: TestUser;
  let userB: TestUser;
  let listA: string;
  let algorithmA: string;
  let algorithmAName: string;
  let systemList: string;
  let systemAlgorithm: string;

  beforeAll(async () => {
    svc = serviceClient();

    // Pre-built fixtures are discovered at runtime: the seeded rows have
    // generated ids, and hardcoding one would drift from the seed.
    const list = await svc.from("algorithm_lists").select("id").eq("is_system", true).order("name").limit(1).single();
    if (list.error) {
      throw list.error;
    }
    systemList = list.data.id;

    const algorithm = await svc
      .from("algorithms")
      .select("id")
      .eq("list_id", systemList)
      .order("position")
      .limit(1)
      .single();
    if (algorithm.error) {
      throw algorithm.error;
    }
    systemAlgorithm = algorithm.data.id;

    [userA, userB] = await Promise.all([createTestUser(svc), createTestUser(svc)]);
  });

  // Per-test, not per-suite: `afterEach` deletes the users' own rows (that is
  // the point of it), so recreating them here is what keeps every test
  // standalone — and a test that *does* delete a row cannot leak into the next.
  beforeEach(async () => {
    listA = await createList(svc, userA.userId);

    // Written through A's OWN authed client — the real RLS-governed path.
    algorithmAName = `a-private-${crypto.randomUUID()}`;
    const inserted = await userA.authedClient
      .from("algorithms")
      .insert({ list_id: listA, name: algorithmAName, moves: A_MOVES, position: 1 })
      .select("id")
      .single();
    if (inserted.error) {
      throw inserted.error;
    }
    algorithmA = inserted.data.id;
  });

  afterEach(async () => {
    await cleanupUserRows(svc, userA.userId);
    await cleanupUserRows(svc, userB.userId);
  });

  afterAll(async () => {
    await Promise.all([deleteTestUser(svc, userA.userId), deleteTestUser(svc, userB.userId)]);
  });

  it("B's delete of A's list affects zero rows, and A still reads it (al_delete)", async () => {
    const attempt = await userB.authedClient.from("algorithm_lists").delete().eq("id", listA).select("id");
    expect(attempt.error).toBeNull();
    expect(attempt.data).toHaveLength(0);

    const asOwner = await userA.authedClient.from("algorithm_lists").select("id").eq("id", listA);
    expect(asOwner.error).toBeNull();
    expect(asOwner.data).toEqual([{ id: listA }]);

    const asService = await svc.from("algorithm_lists").select("id").eq("id", listA);
    expect(asService.error).toBeNull();
    expect(asService.data).toHaveLength(1);
  });

  it("B's delete of A's list does not cascade away A's algorithms", async () => {
    await userB.authedClient.from("algorithm_lists").delete().eq("id", listA);

    // The cascade is the reason a leaked list delete would be worse than a
    // leaked row delete: it takes the algorithms and their practice history too.
    const asService = await svc.from("algorithms").select("id").eq("list_id", listA);
    expect(asService.error).toBeNull();
    expect(asService.data).toEqual([{ id: algorithmA }]);
  });

  it("B's delete of A's algorithm affects zero rows, and A still reads it (alg_delete)", async () => {
    const attempt = await userB.authedClient.from("algorithms").delete().eq("id", algorithmA).select("id");
    expect(attempt.error).toBeNull();
    expect(attempt.data).toHaveLength(0);

    const asOwner = await userA.authedClient.from("algorithms").select("id, name").eq("id", algorithmA);
    expect(asOwner.error).toBeNull();
    expect(asOwner.data).toEqual([{ id: algorithmA, name: algorithmAName }]);

    const asService = await svc.from("algorithms").select("id").eq("id", algorithmA);
    expect(asService.error).toBeNull();
    expect(asService.data).toHaveLength(1);
  });

  it("A can delete their OWN list — the policy is a filter, not a wall", async () => {
    const attempt = await userA.authedClient.from("algorithm_lists").delete().eq("id", listA).select("id");
    expect(attempt.error).toBeNull();
    expect(attempt.data).toEqual([{ id: listA }]);

    // And the cascade fires: the list's algorithms go with it.
    const readBack = await svc.from("algorithms").select("id").eq("list_id", listA);
    expect(readBack.error).toBeNull();
    expect(readBack.data).toHaveLength(0);
  });

  it("A can delete their OWN algorithm and leave the list standing", async () => {
    const attempt = await userA.authedClient.from("algorithms").delete().eq("id", algorithmA).select("id");
    expect(attempt.error).toBeNull();
    expect(attempt.data).toEqual([{ id: algorithmA }]);

    const readBack = await svc.from("algorithm_lists").select("id").eq("id", listA);
    expect(readBack.error).toBeNull();
    expect(readBack.data).toHaveLength(1);
  });

  // The `is_system = false` clause, from the other direction. A regression here
  // would let any signed-in learner destroy shared seed content for everyone —
  // which is also why the read-back matters: if these ever go red, the local
  // stack needs `npx supabase db reset`.
  it("A cannot delete a pre-built list (al_delete's is_system = false)", async () => {
    const attempt = await userA.authedClient.from("algorithm_lists").delete().eq("id", systemList).select("id");
    expect(attempt.error).toBeNull();
    expect(attempt.data).toHaveLength(0);

    const readBack = await svc.from("algorithm_lists").select("id").eq("id", systemList);
    expect(readBack.error).toBeNull();
    expect(readBack.data).toHaveLength(1);
  });

  it("A cannot delete a pre-built algorithm (alg_delete's is_system = false)", async () => {
    const attempt = await userA.authedClient.from("algorithms").delete().eq("id", systemAlgorithm).select("id");
    expect(attempt.error).toBeNull();
    expect(attempt.data).toHaveLength(0);

    const readBack = await svc.from("algorithms").select("id").eq("id", systemAlgorithm);
    expect(readBack.error).toBeNull();
    expect(readBack.data).toHaveLength(1);
  });
});

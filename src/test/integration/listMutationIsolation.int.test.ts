import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { normalizeMoves } from "@/lib/notation/moveGrammar";
import { cleanupUserRows, createList, createTestUser, deleteTestUser, serviceClient, type TestUser } from "./db";

// Risk #2 — "One user reaches another user's data" — for the CRUD-completing
// WRITE endpoints. listIsolation.int.test.ts pins the read/insert side; this
// file pins the delete and update sides of `al_delete` / `alg_delete` /
// `al_update` / `alg_update`, each from both directions:
//   1. a non-owner (user B) cannot delete or rewrite user A's list or algorithm;
//   2. nobody can delete or rewrite PRE-BUILT content, which is the
//      `is_system = false` clause of all four policies.
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
// Oracle: supabase/migrations/20260527000000_domain_schema_rls.sql — :69
// (al_update), :74 (al_delete), :100 (alg_update), :119 (alg_delete). All four
// are `user_id = auth.uid() AND is_system = false`; for `algorithms`, via an
// EXISTS on the owning list. The two UPDATE policies carry that test in BOTH
// USING and WITH CHECK, so neither a hostile target nor a hostile new value
// gets through.

// Absent from the seed is irrelevant here (nothing asserts duplicate scope), but
// it must be a sequence the app would actually store.
const A_MOVES = "R U R' U'";
/** A different valid sequence, for the "the edit really landed" assertions. */
const NEW_MOVES = "R U R' U' R' F";

describe("list mutation isolation — delete + update (#2)", () => {
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

  // ---- update: al_update / alg_update ----

  it("B's rename of A's list affects zero rows, and A still reads the old name (al_update)", async () => {
    const before = await svc.from("algorithm_lists").select("name").eq("id", listA).single();
    expect(before.error).toBeNull();

    const attempt = await userB.authedClient
      .from("algorithm_lists")
      .update({ name: "hijacked" })
      .eq("id", listA)
      .select("id");
    // PostgREST reports a policy-filtered UPDATE as success over zero rows.
    expect(attempt.error).toBeNull();
    expect(attempt.data).toHaveLength(0);

    const asOwner = await userA.authedClient.from("algorithm_lists").select("name").eq("id", listA).single();
    expect(asOwner.error).toBeNull();
    expect(asOwner.data?.name).toBe(before.data?.name);

    const asService = await svc.from("algorithm_lists").select("name").eq("id", listA).single();
    expect(asService.error).toBeNull();
    expect(asService.data?.name).toBe(before.data?.name);
  });

  it("B cannot reassign A's list to themselves (al_update's WITH CHECK on user_id)", async () => {
    const attempt = await userB.authedClient
      .from("algorithm_lists")
      .update({ user_id: userB.userId })
      .eq("id", listA)
      .select("id");
    expect(attempt.error).toBeNull();
    expect(attempt.data).toHaveLength(0);

    const readBack = await svc.from("algorithm_lists").select("user_id").eq("id", listA).single();
    expect(readBack.error).toBeNull();
    expect(readBack.data?.user_id).toBe(userA.userId);
  });

  it("B's edit of A's algorithm affects zero rows and leaves name and moves intact (alg_update)", async () => {
    const attempt = await userB.authedClient
      .from("algorithms")
      .update({ name: "hijacked", moves: "F R U" })
      .eq("id", algorithmA)
      .select("id");
    expect(attempt.error).toBeNull();
    expect(attempt.data).toHaveLength(0);

    const asOwner = await userA.authedClient.from("algorithms").select("name, moves").eq("id", algorithmA).single();
    expect(asOwner.error).toBeNull();
    expect(asOwner.data?.name).toBe(algorithmAName);
    expect(asOwner.data?.moves).toBe(A_MOVES);

    const asService = await svc.from("algorithms").select("name, moves").eq("id", algorithmA).single();
    expect(asService.error).toBeNull();
    expect(asService.data?.moves).toBe(A_MOVES);
  });

  it("B cannot move A's algorithm into B's own list (alg_update's WITH CHECK on list_id)", async () => {
    const listB = await createList(svc, userB.userId);

    const attempt = await userB.authedClient
      .from("algorithms")
      .update({ list_id: listB })
      .eq("id", algorithmA)
      .select("id");
    expect(attempt.error).toBeNull();
    expect(attempt.data).toHaveLength(0);

    const readBack = await svc.from("algorithms").select("list_id").eq("id", algorithmA).single();
    expect(readBack.error).toBeNull();
    expect(readBack.data?.list_id).toBe(listA);
  });

  it("A can rename their OWN list and edit their OWN algorithm — the policies are filters, not walls", async () => {
    const renamed = `renamed-${crypto.randomUUID()}`;
    const rename = await userA.authedClient
      .from("algorithm_lists")
      .update({ name: renamed })
      .eq("id", listA)
      .select("id, name");
    expect(rename.error).toBeNull();
    expect(rename.data).toEqual([{ id: listA, name: renamed }]);

    const edited = `edited-${crypto.randomUUID()}`;
    const edit = await userA.authedClient
      .from("algorithms")
      .update({ name: edited, moves: NEW_MOVES })
      .eq("id", algorithmA)
      .select("id, name, moves");
    expect(edit.error).toBeNull();
    expect(edit.data).toEqual([{ id: algorithmA, name: edited, moves: NEW_MOVES }]);
  });

  // The generated column is the DB's job, never the payload's — updateAlgorithm.ts
  // must not send it, and Postgres re-derives it from the raw `moves`.
  it("an owner's moves edit re-derives moves_normalized without anyone writing it", async () => {
    const edit = await userA.authedClient
      .from("algorithms")
      .update({ moves: "(R U) (R' U')" })
      .eq("id", algorithmA)
      .select("id");
    expect(edit.error).toBeNull();
    expect(edit.data).toHaveLength(1);

    const readBack = await svc.from("algorithms").select("moves, moves_normalized").eq("id", algorithmA).single();
    expect(readBack.error).toBeNull();
    // Raw stored verbatim; normalized derived — parens stripped, spacing collapsed.
    expect(readBack.data?.moves).toBe("(R U) (R' U')");
    expect(readBack.data?.moves_normalized).toBe(normalizeMoves("(R U) (R' U')"));
  });

  it("writing moves_normalized directly is rejected — it is a generated column", async () => {
    const attempt = await userA.authedClient
      .from("algorithms")
      // NOTE: this TYPECHECKS. The Supabase CLI types `moves_normalized` as
      // writable in `Update`, so nothing at the type layer stops a payload from
      // carrying it — only Postgres does, at runtime. That gap is why
      // updateAlgorithm.test.ts asserts the payload's exact key set.
      .update({ moves_normalized: "forged" })
      .eq("id", algorithmA)
      .select("id");
    expect(attempt.error).not.toBeNull();

    const readBack = await svc.from("algorithms").select("moves_normalized").eq("id", algorithmA).single();
    expect(readBack.error).toBeNull();
    expect(readBack.data?.moves_normalized).toBe(normalizeMoves(A_MOVES));
  });

  it("A cannot rename a pre-built list (al_update's is_system = false)", async () => {
    const before = await svc.from("algorithm_lists").select("name").eq("id", systemList).single();
    expect(before.error).toBeNull();

    const attempt = await userA.authedClient
      .from("algorithm_lists")
      .update({ name: "mine now" })
      .eq("id", systemList)
      .select("id");
    expect(attempt.error).toBeNull();
    expect(attempt.data).toHaveLength(0);

    const readBack = await svc.from("algorithm_lists").select("name").eq("id", systemList).single();
    expect(readBack.error).toBeNull();
    expect(readBack.data?.name).toBe(before.data?.name);
  });

  it("A cannot edit a pre-built algorithm (alg_update's is_system = false)", async () => {
    const before = await svc.from("algorithms").select("name, moves").eq("id", systemAlgorithm).single();
    expect(before.error).toBeNull();

    const attempt = await userA.authedClient
      .from("algorithms")
      .update({ name: "mine now", moves: NEW_MOVES })
      .eq("id", systemAlgorithm)
      .select("id");
    expect(attempt.error).toBeNull();
    expect(attempt.data).toHaveLength(0);

    const readBack = await svc.from("algorithms").select("name, moves").eq("id", systemAlgorithm).single();
    expect(readBack.error).toBeNull();
    expect(readBack.data?.name).toBe(before.data?.name);
    expect(readBack.data?.moves).toBe(before.data?.moves);
  });
});

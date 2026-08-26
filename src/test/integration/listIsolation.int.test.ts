import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { normalizeMoves, validateMoves } from "@/lib/notation/moveGrammar";
import { cleanupUserRows, createList, createTestUser, deleteTestUser, serviceClient, type TestUser } from "./db";

// Risk #2 — "One user reaches another user's data."
//
// This slice creates the first user-owned rows in the product, so it is the
// first real exercise of the `al_*` / `alg_*` policies shipped in F-01 and never
// executed by a test. Every assertion below drives an RLS-GOVERNED authed client
// (never the service client), and anything claimed to have persisted — or to
// have survived a hostile write — is proven by an INDEPENDENT service-role
// read-back. A PostgREST update/delete that matches no row returns 200 with an
// empty array, not an error, so "affected zero rows" has to be read back to
// mean anything.
//
// Oracle: the policy set in supabase/migrations/20260527000000_domain_schema_rls.sql
// read against PRD FR-015's visibility wording ("pre-built, or in any of their
// own lists"), spelled out here rather than derived from the app's query code.

// A sequence B owns privately. Every token is producible (guarded in beforeAll,
// so a vocabulary change cannot silently turn this into an invalid sequence the
// app would never store), and it is asserted absent from the seed — otherwise
// the FR-015 zero-rows assertion could pass for the wrong reason.
const B_PRIVATE_MOVES = "E2 S2 x y' z2";

describe("two-account isolation (#2)", () => {
  let svc: SupabaseClient<Database>;
  let userA: TestUser;
  let userB: TestUser;
  let listA: string;
  let listB: string;
  let bAlgorithmId: string;
  let bAlgorithmName: string;
  let seeded: { id: string; name: string; movesNormalized: string };

  beforeAll(async () => {
    svc = serviceClient();

    const validation = validateMoves(B_PRIVATE_MOVES);
    if (!validation.ok) {
      throw new Error(`B_PRIVATE_MOVES is no longer a valid sequence: ${validation.error}`);
    }

    const collisions = await svc
      .from("algorithms")
      .select("id, name")
      .eq("moves_normalized", normalizeMoves(B_PRIVATE_MOVES));
    if (collisions.error) {
      throw collisions.error;
    }
    if (collisions.data.length > 0) {
      throw new Error(
        `B_PRIVATE_MOVES collides with an existing row (${collisions.data.map((r) => r.name).join(", ")}); ` +
          `pick a sequence absent from supabase/seed.sql or the FR-015 assertion loses its teeth.`,
      );
    }

    // A pre-built algorithm, discovered at runtime — the seeded rows have
    // generated ids, and hardcoding a sequence would drift from the seed.
    const systemList = await svc
      .from("algorithm_lists")
      .select("id")
      .eq("is_system", true)
      .order("name")
      .limit(1)
      .single();
    if (systemList.error) {
      throw systemList.error;
    }
    const seededRow = await svc
      .from("algorithms")
      .select("id, name, moves_normalized")
      .eq("list_id", systemList.data.id)
      .order("position")
      .limit(1)
      .single();
    if (seededRow.error) {
      throw seededRow.error;
    }
    // The generated column is typed nullable, but `moves` is NOT NULL and the
    // expression is total — a null here means the migration is not applied.
    if (seededRow.data.moves_normalized === null) {
      throw new Error(
        `Seeded algorithm ${seededRow.data.name} has a null moves_normalized; ` +
          `run \`npx supabase db reset\` so the generated column is present.`,
      );
    }
    seeded = { id: seededRow.data.id, name: seededRow.data.name, movesNormalized: seededRow.data.moves_normalized };

    [userA, userB] = await Promise.all([createTestUser(svc), createTestUser(svc)]);
  });

  // The lists are per-test, not per-suite: `afterEach` cleanup deletes the
  // users' own lists (that is the point of it), so recreating them here is what
  // keeps every test standalone.
  beforeEach(async () => {
    [listA, listB] = await Promise.all([createList(svc, userA.userId), createList(svc, userB.userId)]);

    // B's private algorithm, written through B's OWN authed client — the real
    // RLS-governed path, so a broken `alg_insert` shows up here too.
    bAlgorithmName = `b-private-${crypto.randomUUID()}`;
    const inserted = await userB.authedClient
      .from("algorithms")
      .insert({ list_id: listB, name: bAlgorithmName, moves: B_PRIVATE_MOVES, position: 1 })
      .select("id")
      .single();
    if (inserted.error) {
      throw inserted.error;
    }
    bAlgorithmId = inserted.data.id;
  });

  afterEach(async () => {
    await cleanupUserRows(svc, userA.userId);
    await cleanupUserRows(svc, userB.userId);
  });

  afterAll(async () => {
    await Promise.all([deleteTestUser(svc, userA.userId), deleteTestUser(svc, userB.userId)]);
  });

  it("A sees their own list and the pre-built lists, and not B's list (al_select)", async () => {
    const { data, error } = await userA.authedClient.from("algorithm_lists").select("id, is_system, user_id");
    expect(error).toBeNull();

    const ids = (data ?? []).map((row) => row.id);
    expect(ids).toContain(listA);
    expect(ids).not.toContain(listB);
    // Pre-built content is visible to everyone — the policy is a filter, not a wall.
    expect((data ?? []).some((row) => row.is_system)).toBe(true);
    // No custom list belonging to anyone else leaks in.
    expect((data ?? []).filter((row) => !row.is_system).map((row) => row.user_id)).toEqual([userA.userId]);
  });

  it("A's select on algorithms scoped to B's list returns zero rows, while the row demonstrably exists (alg_select)", async () => {
    const asA = await userA.authedClient.from("algorithms").select("id").eq("list_id", listB);
    expect(asA.error).toBeNull();
    expect(asA.data).toHaveLength(0);

    // Independent read-back: the zero above is RLS filtering, not an absent row.
    const asService = await svc.from("algorithms").select("id").eq("list_id", listB);
    expect(asService.error).toBeNull();
    expect(asService.data).toHaveLength(1);
  });

  it("A cannot insert an algorithm into B's list (alg_insert)", async () => {
    const attempt = await userA.authedClient
      .from("algorithms")
      .insert({ list_id: listB, name: `a-intruder-${crypto.randomUUID()}`, moves: "R U R' U'", position: 2 })
      .select("id");
    expect(attempt.error).not.toBeNull();
    expect(attempt.error?.code).toBe("42501");

    const readBack = await svc.from("algorithms").select("id").eq("list_id", listB);
    expect(readBack.error).toBeNull();
    expect(readBack.data).toHaveLength(1); // still only B's own row
  });

  it("A's update against a row in B's list affects zero rows and leaves it unchanged (alg_update)", async () => {
    const attempt = await userA.authedClient
      .from("algorithms")
      .update({ name: "hijacked" })
      .eq("id", bAlgorithmId)
      .select("id");
    // PostgREST reports a policy-filtered UPDATE as success over zero rows.
    expect(attempt.error).toBeNull();
    expect(attempt.data).toHaveLength(0);

    const readBack = await svc.from("algorithms").select("name, moves").eq("id", bAlgorithmId).single();
    expect(readBack.error).toBeNull();
    expect(readBack.data?.name).toBe(bAlgorithmName);
    expect(readBack.data?.moves).toBe(B_PRIVATE_MOVES);
  });

  it("A's delete against a row in B's list affects zero rows and leaves it present (alg_delete)", async () => {
    const attempt = await userA.authedClient.from("algorithms").delete().eq("id", bAlgorithmId).select("id");
    expect(attempt.error).toBeNull();
    expect(attempt.data).toHaveLength(0);

    const readBack = await svc.from("algorithms").select("id").eq("id", bAlgorithmId);
    expect(readBack.error).toBeNull();
    expect(readBack.data).toHaveLength(1);
  });

  it("A cannot delete B's list (al_delete)", async () => {
    const attempt = await userA.authedClient.from("algorithm_lists").delete().eq("id", listB).select("id");
    expect(attempt.error).toBeNull();
    expect(attempt.data).toHaveLength(0);

    const readBack = await svc.from("algorithm_lists").select("id").eq("id", listB);
    expect(readBack.error).toBeNull();
    expect(readBack.data).toHaveLength(1);
  });

  it("A cannot create a list owned by B (al_insert's user_id = auth.uid())", async () => {
    const attempt = await userA.authedClient
      .from("algorithm_lists")
      .insert({ name: `a-forging-for-b-${crypto.randomUUID()}`, user_id: userB.userId, is_system: false })
      .select("id");
    expect(attempt.error).not.toBeNull();
    expect(attempt.error?.code).toBe("42501");

    const readBack = await svc.from("algorithm_lists").select("id").eq("user_id", userB.userId);
    expect(readBack.error).toBeNull();
    expect(readBack.data).toHaveLength(1); // B's own list, and nothing forged
  });

  // The FR-015 scope assertions. A leak here would be invisible in the UI and
  // read as a feature — "we found this sequence already exists" — while
  // disclosing the name and moves of another learner's private algorithm. The
  // query shape below is deliberately the one addAlgorithm.ts issues, embedded
  // join included, so this pins `alg_select` to FR-015's wording through the
  // path the product actually takes.
  it("B's private sequence never surfaces as a duplicate match for A (FR-015 scope)", async () => {
    const normalized = normalizeMoves(B_PRIVATE_MOVES);

    const asA = await userA.authedClient
      .from("algorithms")
      .select("id, name, moves, list_id, algorithm_lists!inner(name, is_system)")
      .eq("moves_normalized", normalized);
    expect(asA.error).toBeNull();
    expect(asA.data).toHaveLength(0);

    // Read-back: B's row is there to be found, so A's zero is the policy.
    const asService = await svc.from("algorithms").select("id, name").eq("moves_normalized", normalized);
    expect(asService.error).toBeNull();
    expect(asService.data).toEqual([{ id: bAlgorithmId, name: bAlgorithmName }]);

    // And B, who owns it, does see it — the policy is not simply blocking everyone.
    const asB = await userB.authedClient.from("algorithms").select("id").eq("moves_normalized", normalized);
    expect(asB.error).toBeNull();
    expect(asB.data).toEqual([{ id: bAlgorithmId }]);
  });

  it("a pre-built sequence does surface as a duplicate match for A (FR-015 scope)", async () => {
    const { data, error } = await userA.authedClient
      .from("algorithms")
      .select("id, name, list_id, algorithm_lists!inner(name, is_system)")
      .eq("moves_normalized", seeded.movesNormalized);
    expect(error).toBeNull();

    const match = (data ?? []).find((row) => row.id === seeded.id);
    expect(match, `pre-built algorithm ${seeded.name} should be visible to every user`).toBeDefined();
    expect(match?.algorithm_lists.is_system).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { addAlgorithm } from "@/lib/lists/addAlgorithm";

// Hermetic: a stub client stands in for the two reads (duplicate query, max
// position) and the insert, so every branch — including the ones a real DB
// cannot be made to hit on demand — is asserted without a database. The real
// RLS scoping of the duplicate query (alg_select = "pre-built OR any of my
// lists") is pinned by the integration suite, not here.
//
// The stub returns matches in a DELIBERATELY UNHELPFUL order (own-list row
// first) so the "pre-built wins" test proves the selection logic rather than
// re-reading a pre-sorted array.

const TARGET_LIST = "list-target";

interface MatchRow {
  id: string;
  name: string;
  moves: string;
  list_id: string;
  algorithm_lists: { name: string; is_system: boolean };
}

interface StubConfig {
  matches?: MatchRow[];
  matchError?: { message: string } | null;
  maxPosition?: number | null;
  positionError?: { message: string } | null;
  insertError?: { code?: string; message?: string } | null;
}

interface Captured {
  insertPayload?: Record<string, unknown>;
  insertCount: number;
  // Every .order() the duplicate query issues, in call order. Asserted by the
  // "emits the pre-built-first ordering" test below.
  orderCalls: [string, unknown][];
}

function makeStub(config: StubConfig, captured: Captured): SupabaseClient<Database> {
  const stub = {
    from() {
      return {
        // Duplicate query: .select().eq().order().order()  → thenable
        // Position query: .select().eq().order().limit().maybeSingle()
        select() {
          return {
            eq: () => ({
              order: (column: string, opts: unknown) => (
                captured.orderCalls.push([column, opts]),
                {
                  // Second .order() ends the duplicate query.
                  order: (column2: string, opts2: unknown) => (
                    captured.orderCalls.push([column2, opts2]),
                    Promise.resolve({
                      data: config.matchError ? null : (config.matches ?? []),
                      error: config.matchError ?? null,
                    })
                  ),
                  limit: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data:
                          config.positionError || config.maxPosition === null || config.maxPosition === undefined
                            ? null
                            : { position: config.maxPosition },
                        error: config.positionError ?? null,
                      }),
                  }),
                }
              ),
            }),
          };
        },
        insert(payload: Record<string, unknown>) {
          captured.insertCount += 1;
          captured.insertPayload = payload;
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: config.insertError
                    ? null
                    : { id: "algo-new", name: payload.name, moves: payload.moves, position: payload.position },
                  error: config.insertError ?? null,
                }),
            }),
          };
        },
      };
    },
  };
  return stub as unknown as SupabaseClient<Database>;
}

function fresh(): Captured {
  return { insertCount: 0, orderCalls: [] };
}

const VALID = { listId: TARGET_LIST, name: "My T-perm", moves: "R U R' U'" };

const ownMatch: MatchRow = {
  id: "algo-own",
  name: "My old copy",
  moves: "R U R' U'",
  list_id: "list-other-of-mine",
  algorithm_lists: { name: "Sunday drills", is_system: false },
};

const systemMatch: MatchRow = {
  id: "algo-sys",
  name: "T-perm",
  moves: "R U R' U'",
  list_id: "list-prebuilt",
  algorithm_lists: { name: "PLL (Permutation of Last Layer)", is_system: true },
};

const sameListMatch: MatchRow = {
  id: "algo-here",
  name: "Already here",
  moves: "R U R' U'",
  list_id: TARGET_LIST,
  algorithm_lists: { name: "My list", is_system: false },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("addAlgorithm — notation validation", () => {
  it("rejects R2' with the offending token named, and issues no insert", async () => {
    const captured = fresh();
    const result = await addAlgorithm(makeStub({}, captured), { ...VALID, moves: "R U R2'" });
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toContain("R2'");
    expect(captured.insertCount).toBe(0);
  });

  it("rejects an empty move sequence", async () => {
    const captured = fresh();
    const result = await addAlgorithm(makeStub({}, captured), { ...VALID, moves: "   " });
    expect(result.status).toBe(400);
    expect(captured.insertCount).toBe(0);
  });

  it("rejects an empty name", async () => {
    const captured = fresh();
    const result = await addAlgorithm(makeStub({}, captured), { ...VALID, name: "  " });
    expect(result.status).toBe(400);
    expect(captured.insertCount).toBe(0);
  });
});

describe("addAlgorithm — insert path (no match)", () => {
  it("computes position as max + 1", async () => {
    const captured = fresh();
    const result = await addAlgorithm(makeStub({ matches: [], maxPosition: 7 }, captured), VALID);
    expect(result.status).toBe(201);
    expect(captured.insertPayload?.position).toBe(8);
  });

  it("starts an empty list at 1, not 0 — position is the rendered row number", async () => {
    const captured = fresh();
    const result = await addAlgorithm(makeStub({ matches: [], maxPosition: null }, captured), VALID);
    expect(result.status).toBe(201);
    expect(captured.insertPayload?.position).toBe(1);
  });

  it("stores the RAW moves string, not the normalized one", async () => {
    const captured = fresh();
    await addAlgorithm(makeStub({ matches: [], maxPosition: null }, captured), {
      ...VALID,
      moves: "(R U R') (U' R U)",
    });
    // Display-verbatim: parens and the learner's grouping survive.
    expect(captured.insertPayload?.moves).toBe("(R U R') (U' R U)");
  });

  it("returns 201 with status created", async () => {
    const result = await addAlgorithm(makeStub({ matches: [], maxPosition: null }, fresh()), VALID);
    expect(result.status).toBe(201);
    expect((result.body as { status: string }).status).toBe("created");
  });
});

describe("addAlgorithm — duplicate detection", () => {
  it("reports a match outside the target list without inserting", async () => {
    const captured = fresh();
    const result = await addAlgorithm(makeStub({ matches: [ownMatch] }, captured), VALID);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      status: "duplicate",
      match: {
        id: "algo-own",
        name: "My old copy",
        moves: "R U R' U'",
        listName: "Sunday drills",
        isSystem: false,
      },
    });
    expect(captured.insertCount).toBe(0);
  });

  it("carries listName and isSystem so the panel can say WHERE the match lives", async () => {
    const result = await addAlgorithm(makeStub({ matches: [systemMatch] }, fresh()), VALID);
    const { match } = result.body as { match: { listName: string; isSystem: boolean } };
    expect(match.listName).toBe("PLL (Permutation of Last Layer)");
    expect(match.isSystem).toBe(true);
  });

  it("proposes the PRE-BUILT match when a pre-built and an own-list row both match", async () => {
    // Stub deliberately yields the own-list row first: the pre-built preference
    // must come from the selection rule, not from the array's order.
    const result = await addAlgorithm(makeStub({ matches: [ownMatch, systemMatch] }, fresh()), VALID);
    const { match } = result.body as { match: { id: string; isSystem: boolean } };
    expect(match.id).toBe("algo-sys");
    expect(match.isSystem).toBe(true);
  });

  // The JS `rows.find(is_system)` above is a belt-and-braces re-application of a
  // preference the SERVER is supposed to apply. Without this test the
  // `.order()` clause itself has no coverage — and lessons.md records that the
  // sibling `{ referencedTable }` form of this exact call is a SILENT no-op:
  // PostgREST returns 200 with unspecified order, so nothing fails loudly. Pin
  // the positional `table(column)` string form that actually works.
  it("emits the pre-built-first ordering as a positional embedded-column clause", async () => {
    const captured = fresh();
    await addAlgorithm(makeStub({ matches: [ownMatch, systemMatch] }, captured), VALID);
    expect(captured.orderCalls).toEqual([
      ["algorithm_lists(is_system)", { ascending: false }],
      ["created_at", { ascending: true }],
    ]);
  });

  it("returns already_in_list, with no insert, when the match is in the target list", async () => {
    const captured = fresh();
    const result = await addAlgorithm(makeStub({ matches: [sameListMatch] }, captured), VALID);
    expect(result.status).toBe(409);
    expect((result.body as { status: string }).status).toBe("already_in_list");
    expect(captured.insertCount).toBe(0);
  });

  it("prefers already_in_list over duplicate when the sequence is both here and elsewhere", async () => {
    const captured = fresh();
    const result = await addAlgorithm(makeStub({ matches: [systemMatch, sameListMatch] }, captured), VALID);
    expect(result.status).toBe(409);
    expect(captured.insertCount).toBe(0);
  });

  it("inserts anyway when createAnyway is true", async () => {
    const captured = fresh();
    const result = await addAlgorithm(makeStub({ matches: [systemMatch], maxPosition: 2 }, captured), {
      ...VALID,
      createAnyway: true,
    });
    expect(result.status).toBe(201);
    expect(captured.insertCount).toBe(1);
    expect(captured.insertPayload?.position).toBe(3);
  });

  it("createAnyway does NOT override already_in_list", async () => {
    const captured = fresh();
    const result = await addAlgorithm(makeStub({ matches: [sameListMatch] }, captured), {
      ...VALID,
      createAnyway: true,
    });
    expect(result.status).toBe(409);
    expect(captured.insertCount).toBe(0);
  });
});

describe("addAlgorithm — error branches", () => {
  it("maps an RLS violation on insert to 403, not 500", async () => {
    const result = await addAlgorithm(
      makeStub({ matches: [], maxPosition: null, insertError: { code: "42501" } }, fresh()),
      VALID,
    );
    expect(result).toEqual({ status: 403, body: { error: "Not your list" } });
  });

  it("returns a generic message and logs when the duplicate query fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await addAlgorithm(
      makeStub({ matchError: { message: "column blah does not exist" } }, fresh()),
      VALID,
    );
    expect(result).toEqual({ status: 500, body: { error: "Failed to add algorithm" } });
    expect(JSON.stringify(result.body)).not.toContain("column blah");
    expect(spy).toHaveBeenCalled();
  });

  it("returns a generic message and logs when the insert fails for a non-RLS reason", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await addAlgorithm(
      makeStub(
        { matches: [], maxPosition: null, insertError: { code: "08006", message: "connection reset" } },
        fresh(),
      ),
      VALID,
    );
    expect(result).toEqual({ status: 500, body: { error: "Failed to add algorithm" } });
    expect(JSON.stringify(result.body)).not.toContain("connection reset");
    expect(spy).toHaveBeenCalled();
  });
});

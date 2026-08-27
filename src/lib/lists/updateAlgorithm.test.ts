import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { normalizeMoves } from "@/lib/notation/moveGrammar";
import { updateAlgorithm } from "@/lib/lists/updateAlgorithm";

// Hermetic: a stub client stands in for up to four round trips (opening read,
// duplicate probe, mastery reset, update), so every branch — including the two
// orderings this module's correctness rests on — is asserted without a DB.
//
// `captured.calls` records which round trips happened AND in what order. Two of
// this module's guarantees are only expressible that way:
//   - a name-only edit issues NEITHER a probe NOR a mastery reset;
//   - the mastery reset precedes the update, never follows it.
// Asserting the 200 alone would pass with both guarantees broken.
//
// The real RLS scoping (alg_update, am_update) is the integration suite's job.

const TARGET_LIST = "list-target";
const ALGO_ID = "algo-1";
const STORED_MOVES = "R U R' U'";

interface MatchRow {
  id: string;
  name: string;
  moves: string;
  list_id: string;
  algorithm_lists: { name: string; is_system: boolean };
}

interface StubConfig {
  /** The opening read's row. `null` = not visible to this caller. */
  current?: { id: string; list_id: string; moves_normalized: string | null } | null;
  readError?: { message: string } | null;
  matches?: MatchRow[];
  matchError?: { message: string } | null;
  masteryError?: { message: string } | null;
  updateError?: { code?: string; message?: string } | null;
  updateData?: { id: string; name: string; moves: string; position: number }[] | null;
}

interface Captured {
  calls: string[];
  probeNeq?: [string, string];
  orderCalls: [string, unknown][];
  masteryPayload?: Record<string, unknown>;
  masteryEq?: [string, string];
  updatePayload?: Record<string, unknown>;
  updateEq?: [string, string];
}

function makeStub(config: StubConfig, captured: Captured): SupabaseClient<Database> {
  const orderChain = () => ({
    order: (c1: string, o1: unknown) => (
      captured.orderCalls.push([c1, o1]),
      {
        order: (c2: string, o2: unknown) => (
          captured.orderCalls.push([c2, o2]),
          Promise.resolve({
            data: config.matchError ? null : (config.matches ?? []),
            error: config.matchError ?? null,
          })
        ),
      }
    ),
  });

  const stub = {
    from(table: string) {
      if (table === "algorithm_mastery") {
        return {
          update(payload: Record<string, unknown>) {
            captured.calls.push("masteryReset");
            captured.masteryPayload = payload;
            return {
              eq: (column: string, value: string) => {
                captured.masteryEq = [column, value];
                return Promise.resolve({ data: null, error: config.masteryError ?? null });
              },
            };
          },
        };
      }

      return {
        select(columns: string) {
          // The probe is the only read that embeds the owning list.
          if (columns.includes("algorithm_lists!inner")) {
            captured.calls.push("probe");
            return {
              eq: () => ({
                neq: (column: string, value: string) => {
                  captured.probeNeq = [column, value];
                  return orderChain();
                },
                // Reachable only if the exclusion is ever dropped — which is the
                // self-match bug, so leave it unimplemented rather than silently
                // working.
                ...orderChain(),
              }),
            };
          }

          captured.calls.push("read");
          return {
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: config.readError
                    ? null
                    : config.current === undefined
                      ? { id: ALGO_ID, list_id: TARGET_LIST, moves_normalized: normalizeMoves(STORED_MOVES) }
                      : config.current,
                  error: config.readError ?? null,
                }),
            }),
          };
        },
        update(payload: Record<string, unknown>) {
          captured.calls.push("update");
          captured.updatePayload = payload;
          return {
            eq: (column: string, value: string) => {
              captured.updateEq = [column, value];
              return {
                select: () =>
                  Promise.resolve({
                    data: config.updateError
                      ? null
                      : (config.updateData ?? [
                          {
                            id: ALGO_ID,
                            name: payload.name as string,
                            moves: payload.moves as string,
                            position: 3,
                          },
                        ]),
                    error: config.updateError ?? null,
                  }),
              };
            },
          };
        },
      };
    },
  };
  return stub as unknown as SupabaseClient<Database>;
}

function fresh(): Captured {
  return { calls: [], orderCalls: [] };
}

/** A name-only edit: the moves round-trip to the same normalized value. */
const NAME_ONLY = { algorithmId: ALGO_ID, name: "Renamed T-perm", moves: STORED_MOVES };
/** A genuine moves change. */
const MOVES_CHANGED = { algorithmId: ALGO_ID, name: "My T-perm", moves: "R U R' U' R' F" };

const ownMatch: MatchRow = {
  id: "algo-own",
  name: "My old copy",
  moves: "R U R' U' R' F",
  list_id: "list-other-of-mine",
  algorithm_lists: { name: "Sunday drills", is_system: false },
};

const systemMatch: MatchRow = {
  id: "algo-sys",
  name: "T-perm",
  moves: "R U R' U' R' F",
  list_id: "list-prebuilt",
  algorithm_lists: { name: "PLL (Permutation of Last Layer)", is_system: true },
};

const sameListMatch: MatchRow = {
  id: "algo-here",
  name: "Already here",
  moves: "R U R' U' R' F",
  list_id: TARGET_LIST,
  algorithm_lists: { name: "My list", is_system: false },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("updateAlgorithm — visibility", () => {
  it("returns 404 for a row the caller cannot see, and writes nothing", async () => {
    const captured = fresh();
    const result = await updateAlgorithm(makeStub({ current: null }, captured), NAME_ONLY);
    expect(result).toEqual({ status: 404, body: { error: "Algorithm not found" } });
    expect(captured.calls).toEqual(["read"]);
  });

  it("returns a generic 500 and logs when the opening read fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await updateAlgorithm(
      makeStub({ readError: { message: 'column "blah" does not exist' } }, fresh()),
      NAME_ONLY,
    );
    expect(result).toEqual({ status: 500, body: { error: "Failed to update algorithm" } });
    expect(JSON.stringify(result.body)).not.toContain("blah");
    expect(spy).toHaveBeenCalled();
  });

  it("checks visibility BEFORE validating, so a hidden row cannot be probed for by input shape", async () => {
    const captured = fresh();
    const result = await updateAlgorithm(makeStub({ current: null }, captured), { ...NAME_ONLY, moves: "R2'" });
    // An invalid sequence against an invisible id still reads as 404, not 400 —
    // otherwise the two responses distinguish "exists" from "does not".
    expect(result.status).toBe(404);
  });
});

describe("updateAlgorithm — validation", () => {
  it("rejects R2' with the offending token named, and writes nothing", async () => {
    const captured = fresh();
    const result = await updateAlgorithm(makeStub({}, captured), { ...NAME_ONLY, moves: "R U R2'" });
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toContain("R2'");
    expect(captured.calls).toEqual(["read"]);
  });

  it("rejects an empty name", async () => {
    const captured = fresh();
    const result = await updateAlgorithm(makeStub({}, captured), { ...NAME_ONLY, name: "  " });
    expect(result.status).toBe(400);
    expect(captured.calls).toEqual(["read"]);
  });

  it("rejects a name over the cap", async () => {
    const captured = fresh();
    const result = await updateAlgorithm(makeStub({}, captured), { ...NAME_ONLY, name: "x".repeat(101) });
    expect(result.status).toBe(400);
    expect(captured.calls).toEqual(["read"]);
  });

  it("trims the name before writing", async () => {
    const captured = fresh();
    await updateAlgorithm(makeStub({}, captured), { ...NAME_ONLY, name: "  Renamed T-perm  " });
    expect(captured.updatePayload?.name).toBe("Renamed T-perm");
  });
});

describe("updateAlgorithm — name-only edit", () => {
  it("issues NEITHER a duplicate probe NOR a mastery reset", async () => {
    const captured = fresh();
    const result = await updateAlgorithm(makeStub({}, captured), NAME_ONLY);
    expect(result.status).toBe(200);
    // The absence is the assertion: a probe here would self-match (409) and a
    // reset here would destroy a streak earned on a sequence that still stands.
    expect(captured.calls).toEqual(["read", "update"]);
  });

  it("treats a re-spaced / re-parenthesised sequence as unchanged", async () => {
    const captured = fresh();
    // Normalizes to the same value as STORED_MOVES, so the streak must survive.
    const result = await updateAlgorithm(makeStub({}, captured), { ...NAME_ONLY, moves: "(R U) (R' U')" });
    expect(result.status).toBe(200);
    expect(captured.calls).toEqual(["read", "update"]);
  });

  it("still stores the RAW moves string, so the learner's grouping survives", async () => {
    const captured = fresh();
    await updateAlgorithm(makeStub({}, captured), { ...NAME_ONLY, moves: "(R U) (R' U')" });
    expect(captured.updatePayload?.moves).toBe("(R U) (R' U')");
  });

  it("treats a null stored moves_normalized as a change rather than crashing", async () => {
    const captured = fresh();
    // The generated column is typed nullable even though the expression is
    // total; a null must not be compared as if it were the new value.
    const result = await updateAlgorithm(
      makeStub({ current: { id: ALGO_ID, list_id: TARGET_LIST, moves_normalized: null }, matches: [] }, captured),
      NAME_ONLY,
    );
    expect(result.status).toBe(200);
    expect(captured.calls).toEqual(["read", "probe", "masteryReset", "update"]);
  });
});

describe("updateAlgorithm — duplicate detection on a moves change", () => {
  it("excludes the row under edit from the probe", async () => {
    const captured = fresh();
    await updateAlgorithm(makeStub({ matches: [] }, captured), MOVES_CHANGED);
    expect(captured.probeNeq).toEqual(["id", ALGO_ID]);
  });

  it("emits the pre-built-first ordering as a positional embedded-column clause", async () => {
    const captured = fresh();
    await updateAlgorithm(makeStub({ matches: [] }, captured), MOVES_CHANGED);
    // lessons.md: the sibling `{ referencedTable }` form is a SILENT no-op.
    expect(captured.orderCalls).toEqual([
      ["algorithm_lists(is_system)", { ascending: false }],
      ["created_at", { ascending: true }],
    ]);
  });

  it("returns 409 already_in_list when the sequence is elsewhere in THIS list", async () => {
    const captured = fresh();
    const result = await updateAlgorithm(makeStub({ matches: [sameListMatch] }, captured), MOVES_CHANGED);
    expect(result.status).toBe(409);
    expect((result.body as { status: string }).status).toBe("already_in_list");
    // Refused before anything is written — and crucially before the reset, so a
    // rejected edit leaves the streak alone.
    expect(captured.calls).toEqual(["read", "probe"]);
  });

  it("returns 200 duplicate for a match elsewhere, preferring the pre-built one", async () => {
    const captured = fresh();
    // Stub yields the own-list row first: the preference must come from the
    // selection rule, not the array order.
    const result = await updateAlgorithm(makeStub({ matches: [ownMatch, systemMatch] }, captured), MOVES_CHANGED);
    expect(result.status).toBe(200);
    const body = result.body as { status: string; match: { id: string; listName: string; isSystem: boolean } };
    expect(body.status).toBe("duplicate");
    expect(body.match.id).toBe("algo-sys");
    expect(body.match.listName).toBe("PLL (Permutation of Last Layer)");
    expect(captured.calls).toEqual(["read", "probe"]);
  });

  it("proceeds when createAnyway is true", async () => {
    const captured = fresh();
    const result = await updateAlgorithm(makeStub({ matches: [systemMatch] }, captured), {
      ...MOVES_CHANGED,
      createAnyway: true,
    });
    expect(result.status).toBe(200);
    expect((result.body as { status: string }).status).toBe("updated");
    expect(captured.calls).toEqual(["read", "probe", "masteryReset", "update"]);
  });

  it("createAnyway does NOT override already_in_list", async () => {
    const captured = fresh();
    const result = await updateAlgorithm(makeStub({ matches: [sameListMatch] }, captured), {
      ...MOVES_CHANGED,
      createAnyway: true,
    });
    expect(result.status).toBe(409);
    expect(captured.calls).toEqual(["read", "probe"]);
  });

  it("returns a generic 500 and logs when the probe fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await updateAlgorithm(
      makeStub({ matchError: { message: "column blah does not exist" } }, fresh()),
      MOVES_CHANGED,
    );
    expect(result).toEqual({ status: 500, body: { error: "Failed to update algorithm" } });
    expect(JSON.stringify(result.body)).not.toContain("column blah");
    expect(spy).toHaveBeenCalled();
  });
});

describe("updateAlgorithm — mastery reset", () => {
  it("issues the reset BEFORE the update", async () => {
    const captured = fresh();
    await updateAlgorithm(makeStub({ matches: [] }, captured), MOVES_CHANGED);
    // Load-bearing: there is no transaction across two PostgREST calls. Update
    // first + reset fails = a claimed streak for a sequence never practised.
    expect(captured.calls).toEqual(["read", "probe", "masteryReset", "update"]);
    expect(captured.calls.indexOf("masteryReset")).toBeLessThan(captured.calls.indexOf("update"));
  });

  it("zeroes the streak and clears mastery_reached, scoped by algorithm_id alone", async () => {
    const captured = fresh();
    await updateAlgorithm(makeStub({ matches: [] }, captured), MOVES_CHANGED);
    expect(captured.masteryPayload).toEqual({ consecutive_clean: 0, mastery_reached: false });
    // am_update already scopes to the caller's own row, so no user_id filter.
    expect(captured.masteryEq).toEqual(["algorithm_id", ALGO_ID]);
  });

  it("fails closed: a reset error returns 500 and the moves are NOT written", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const captured = fresh();
    const result = await updateAlgorithm(
      makeStub({ matches: [], masteryError: { message: "connection reset" } }, captured),
      MOVES_CHANGED,
    );
    expect(result).toEqual({ status: 500, body: { error: "Failed to update algorithm" } });
    expect(JSON.stringify(result.body)).not.toContain("connection reset");
    expect(captured.calls).not.toContain("update");
    expect(spy).toHaveBeenCalled();
  });
});

describe("updateAlgorithm — the update itself", () => {
  it("never includes moves_normalized in the payload — it is a generated column", async () => {
    const captured = fresh();
    await updateAlgorithm(makeStub({ matches: [] }, captured), MOVES_CHANGED);
    expect(Object.keys(captured.updatePayload ?? {}).sort()).toEqual(["moves", "name"]);
    expect(captured.updatePayload).not.toHaveProperty("moves_normalized");
  });

  it("never rewrites list_id or position — an edit does not move the row", async () => {
    const captured = fresh();
    await updateAlgorithm(makeStub({ matches: [] }, captured), MOVES_CHANGED);
    expect(captured.updatePayload).not.toHaveProperty("list_id");
    expect(captured.updatePayload).not.toHaveProperty("position");
  });

  it("filters on the algorithm id and returns the updated row", async () => {
    const captured = fresh();
    const result = await updateAlgorithm(makeStub({ matches: [] }, captured), MOVES_CHANGED);
    expect(captured.updateEq).toEqual(["id", ALGO_ID]);
    expect(result).toEqual({
      status: 200,
      body: {
        status: "updated",
        algorithm: { id: ALGO_ID, name: "My T-perm", moves: "R U R' U' R' F", position: 3 },
      },
    });
  });

  it("maps an RLS violation on update to 404, consistent with the read", async () => {
    const result = await updateAlgorithm(
      makeStub({ matches: [], updateError: { code: "42501" } }, fresh()),
      MOVES_CHANGED,
    );
    expect(result).toEqual({ status: 404, body: { error: "Algorithm not found" } });
  });

  it("maps zero rows affected to 404", async () => {
    const result = await updateAlgorithm(makeStub({ matches: [], updateData: [] }, fresh()), MOVES_CHANGED);
    expect(result).toEqual({ status: 404, body: { error: "Algorithm not found" } });
  });

  it("returns a generic 500 and logs on a non-RLS update error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await updateAlgorithm(
      makeStub({ matches: [], updateError: { code: "08006", message: "connection reset" } }, fresh()),
      MOVES_CHANGED,
    );
    expect(result).toEqual({ status: 500, body: { error: "Failed to update algorithm" } });
    expect(JSON.stringify(result.body)).not.toContain("connection reset");
    expect(spy).toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { deleteAlgorithm } from "@/lib/lists/deleteAlgorithm";

// Hermetic, same shape as deleteList.test.ts. The real RLS behaviour
// (alg_delete rejecting a row in a list the caller does not own, and every
// pre-built entry) belongs to the integration suite.

interface StubConfig {
  deleteError?: { message: string; code?: string } | null;
  deleteData?: { id: string; list_id: string }[];
}

interface Captured {
  table?: string;
  eq?: [string, string];
  select?: string;
}

function makeStub(config: StubConfig, captured: Captured): SupabaseClient<Database> {
  const stub = {
    from(table: string) {
      captured.table = table;
      return {
        delete: () => ({
          eq: (column: string, value: string) => {
            captured.eq = [column, value];
            return {
              select: (columns: string) => {
                captured.select = columns;
                return Promise.resolve({
                  data: config.deleteError ? null : (config.deleteData ?? [{ id: "algo-1", list_id: "list-1" }]),
                  error: config.deleteError ?? null,
                });
              },
            };
          },
        }),
      };
    },
  };
  return stub as unknown as SupabaseClient<Database>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deleteAlgorithm", () => {
  it("returns 200 with the deleted row's listId, so the client can navigate back", async () => {
    const result = await deleteAlgorithm(makeStub({ deleteData: [{ id: "algo-9", list_id: "list-4" }] }, {}), {
      algorithmId: "algo-9",
    });
    expect(result).toEqual({ status: 200, body: { listId: "list-4" } });
  });

  it("filters on the algorithm id and selects list_id back off the deleted row", async () => {
    const captured: Captured = {};
    await deleteAlgorithm(makeStub({}, captured), { algorithmId: "algo-7" });
    expect(captured.table).toBe("algorithms");
    expect(captured.eq).toEqual(["id", "algo-7"]);
    expect(captured.select).toBe("id, list_id");
  });

  it("maps zero rows affected to 404 — an RLS-hidden algorithm is an absence, not an error", async () => {
    const result = await deleteAlgorithm(makeStub({ deleteData: [] }, {}), { algorithmId: "not-mine" });
    expect(result).toEqual({ status: 404, body: { error: "Algorithm not found" } });
  });

  it("returns a generic message and logs on DB error — never the raw error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await deleteAlgorithm(
      makeStub({ deleteError: { message: 'new row violates policy "alg_delete"' } }, {}),
      { algorithmId: "algo-1" },
    );
    expect(result).toEqual({ status: 500, body: { error: "Failed to delete algorithm" } });
    expect(JSON.stringify(result.body)).not.toContain("alg_delete");
    expect(spy).toHaveBeenCalled();
  });
});

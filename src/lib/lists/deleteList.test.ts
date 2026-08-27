import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { deleteList } from "@/lib/lists/deleteList";

// Hermetic: a stub client stands in for the chained supabase-js call, so the
// status mapping and the exact filter are asserted without a DB. The real RLS
// behaviour (al_delete rejecting someone else's list, and every is_system list)
// is the integration suite's job, not this file's.

interface StubConfig {
  deleteError?: { message: string; code?: string } | null;
  /** Rows PostgREST reports as affected. `[]` is what a policy filter produces. */
  deleteData?: { id: string }[];
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
                  data: config.deleteError ? null : (config.deleteData ?? [{ id: "list-1" }]),
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

describe("deleteList", () => {
  it("returns 204 with no body when one row is deleted", async () => {
    const result = await deleteList(makeStub({}, {}), { listId: "list-1" });
    expect(result).toEqual({ status: 204 });
  });

  it("filters on the list id and asks for the affected rows back", async () => {
    const captured: Captured = {};
    await deleteList(makeStub({}, captured), { listId: "list-7" });
    expect(captured.table).toBe("algorithm_lists");
    expect(captured.eq).toEqual(["id", "list-7"]);
    // Without a select, a policy-filtered delete is indistinguishable from a
    // successful one — PostgREST reports both as 200.
    expect(captured.select).toBe("id");
  });

  it("maps zero rows affected to 404 — an RLS-hidden list is an absence, not an error", async () => {
    const result = await deleteList(makeStub({ deleteData: [] }, {}), { listId: "not-mine" });
    expect(result).toEqual({ status: 404, body: { error: "List not found" } });
  });

  it("returns a generic message and logs on DB error — never the raw error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await deleteList(makeStub({ deleteError: { message: 'relation "algorithm_lists" blah' } }, {}), {
      listId: "list-1",
    });
    expect(result).toEqual({ status: 500, body: { error: "Failed to delete list" } });
    // Stringify the whole result: `DeleteListResult`'s success arm has no body,
    // so narrowing to `.body` here would not typecheck.
    expect(JSON.stringify(result)).not.toContain("algorithm_lists");
    expect(spy).toHaveBeenCalled();
  });
});

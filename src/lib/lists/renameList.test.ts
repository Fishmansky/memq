import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { LIST_NAME_MAX_LENGTH } from "@/lib/lists/createList";
import { renameList } from "@/lib/lists/renameList";

// Hermetic, same shape as createList.test.ts. The real RLS behaviour (al_update
// rejecting someone else's list and every is_system list) is the integration
// suite's job.

interface StubConfig {
  updateError?: { message: string } | null;
  updateData?: { id: string; name: string }[];
}

interface Captured {
  payload?: Record<string, unknown>;
  eq?: [string, string];
  select?: string;
}

function makeStub(config: StubConfig, captured: Captured): SupabaseClient<Database> {
  const stub = {
    from() {
      return {
        update(payload: Record<string, unknown>) {
          captured.payload = payload;
          return {
            eq: (column: string, value: string) => {
              captured.eq = [column, value];
              return {
                select: (columns: string) => {
                  captured.select = columns;
                  return Promise.resolve({
                    data: config.updateError ? null : (config.updateData ?? [{ id: "list-1", name: "Renamed" }]),
                    error: config.updateError ?? null,
                  });
                },
              };
            },
          };
        },
      };
    },
  };
  return stub as unknown as SupabaseClient<Database>;
}

const VALID = { listId: "list-1", name: "Sunday drills" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renameList", () => {
  it("trims the name before updating", async () => {
    const captured: Captured = {};
    const result = await renameList(makeStub({}, captured), { ...VALID, name: "  Sunday drills  " });
    expect(result.status).toBe(200);
    expect(captured.payload).toEqual({ name: "Sunday drills" });
  });

  it("returns 200 with the updated row", async () => {
    const result = await renameList(makeStub({ updateData: [{ id: "list-9", name: "OLL drills" }] }, {}), VALID);
    expect(result).toEqual({ status: 200, body: { id: "list-9", name: "OLL drills" } });
  });

  it("filters on the list id and asks for the affected rows back", async () => {
    const captured: Captured = {};
    await renameList(makeStub({}, captured), { ...VALID, listId: "list-7" });
    expect(captured.eq).toEqual(["id", "list-7"]);
    expect(captured.select).toBe("id, name");
  });

  it("never writes user_id or is_system — rename touches the name only", async () => {
    const captured: Captured = {};
    await renameList(makeStub({}, captured), VALID);
    expect(Object.keys(captured.payload ?? {})).toEqual(["name"]);
  });

  it("rejects an empty name, issuing no update", async () => {
    const captured: Captured = {};
    const result = await renameList(makeStub({}, captured), { ...VALID, name: "" });
    expect(result.status).toBe(400);
    expect(captured.payload).toBeUndefined();
  });

  it("rejects a whitespace-only name, issuing no update", async () => {
    const captured: Captured = {};
    const result = await renameList(makeStub({}, captured), { ...VALID, name: "   " });
    expect(result.status).toBe(400);
    expect(captured.payload).toBeUndefined();
  });

  it(`accepts a name of exactly ${String(LIST_NAME_MAX_LENGTH)} characters`, async () => {
    const result = await renameList(makeStub({}, {}), { ...VALID, name: "x".repeat(LIST_NAME_MAX_LENGTH) });
    expect(result.status).toBe(200);
  });

  it("rejects a name one character over the cap, naming the shared constant's value", async () => {
    const captured: Captured = {};
    const result = await renameList(makeStub({}, captured), {
      ...VALID,
      name: "x".repeat(LIST_NAME_MAX_LENGTH + 1),
    });
    expect(result.status).toBe(400);
    // The cap comes from createList.ts, not a restated literal — so create and
    // rename cannot drift apart.
    expect((result.body as { error: string }).error).toContain(String(LIST_NAME_MAX_LENGTH));
    expect(captured.payload).toBeUndefined();
  });

  it("maps zero rows affected to 404 — an RLS-hidden list is an absence, not an error", async () => {
    const result = await renameList(makeStub({ updateData: [] }, {}), { ...VALID, listId: "not-mine" });
    expect(result).toEqual({ status: 404, body: { error: "List not found" } });
  });

  it("returns a generic message and logs on DB error — never the raw error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await renameList(makeStub({ updateError: { message: 'policy "al_update" blah' } }, {}), VALID);
    expect(result).toEqual({ status: 500, body: { error: "Failed to rename list" } });
    expect(JSON.stringify(result.body)).not.toContain("al_update");
    expect(spy).toHaveBeenCalled();
  });
});

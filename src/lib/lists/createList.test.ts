import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { LIST_NAME_MAX_LENGTH, createList } from "@/lib/lists/createList";

// Hermetic: a stub client stands in for the chained supabase-js call, so the
// validation branches and the exact insert payload are asserted without a DB.
// The real RLS behaviour (al_insert rejecting someone else's user_id) is the
// integration suite's job, not this file's.

interface StubConfig {
  insertError?: { message: string } | null;
  insertData?: { id: string; name: string };
}

interface Captured {
  payload?: Record<string, unknown>;
}

function makeStub(config: StubConfig, captured: Captured): SupabaseClient<Database> {
  const stub = {
    from() {
      return {
        insert(payload: Record<string, unknown>) {
          captured.payload = payload;
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: config.insertError ? null : (config.insertData ?? { id: "list-1", name: "Sunday drills" }),
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

const USER = { id: "user-1" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createList", () => {
  it("trims the name before inserting", async () => {
    const captured: Captured = {};
    const result = await createList(makeStub({}, captured), USER, { name: "  Sunday drills  " });
    expect(result.status).toBe(201);
    expect(captured.payload?.name).toBe("Sunday drills");
  });

  it("sets is_system false and user_id together — the ownership check requires both", async () => {
    const captured: Captured = {};
    await createList(makeStub({}, captured), USER, { name: "Sunday drills" });
    expect(captured.payload).toEqual({ name: "Sunday drills", user_id: "user-1", is_system: false });
  });

  it("returns 201 with the created list", async () => {
    const result = await createList(makeStub({ insertData: { id: "list-9", name: "OLL drills" } }, {}), USER, {
      name: "OLL drills",
    });
    expect(result).toEqual({ status: 201, body: { id: "list-9", name: "OLL drills" } });
  });

  it("rejects an empty name", async () => {
    const captured: Captured = {};
    const result = await createList(makeStub({}, captured), USER, { name: "" });
    expect(result.status).toBe(400);
    expect(captured.payload).toBeUndefined();
  });

  it("rejects a whitespace-only name", async () => {
    const captured: Captured = {};
    const result = await createList(makeStub({}, captured), USER, { name: "   " });
    expect(result.status).toBe(400);
    expect(captured.payload).toBeUndefined();
  });

  it(`accepts a name of exactly ${String(LIST_NAME_MAX_LENGTH)} characters`, async () => {
    const result = await createList(makeStub({}, {}), USER, { name: "x".repeat(LIST_NAME_MAX_LENGTH) });
    expect(result.status).toBe(201);
  });

  it("rejects a name one character over the cap", async () => {
    const captured: Captured = {};
    const result = await createList(makeStub({}, captured), USER, { name: "x".repeat(LIST_NAME_MAX_LENGTH + 1) });
    expect(result.status).toBe(400);
    expect(captured.payload).toBeUndefined();
  });

  it("returns a generic message and logs on DB error — never the raw error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await createList(makeStub({ insertError: { message: "duplicate key blah blah" } }, {}), USER, {
      name: "Sunday drills",
    });
    expect(result).toEqual({ status: 500, body: { error: "Failed to create list" } });
    expect(JSON.stringify(result.body)).not.toContain("duplicate key");
    expect(spy).toHaveBeenCalled();
  });
});

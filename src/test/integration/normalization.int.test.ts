import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { normalizeMoves } from "@/lib/notation/moveGrammar";
import { serviceClient } from "./db";

// The JS normalizer and the SQL `moves_normalized` generated column are two
// definitions of one rule, in two languages that cannot share code. Duplicate
// detection normalizes in JS and compares in SQL (`moves_normalized = $1`), so
// any divergence is a silent FALSE NEGATIVE — the learner is told a sequence is
// new when the app can already see it, which is the exact failure FR-015 exists
// to prevent. This test is the contract between the two. If the normalization
// rule changes, src/lib/notation/moveGrammar.ts, the migration, and this test
// change together.

describe("normalizeMoves ↔ moves_normalized parity", () => {
  let svc: SupabaseClient<Database>;

  beforeAll(() => {
    svc = serviceClient();
  });

  it("agrees with the generated column on every row in algorithms", async () => {
    const { data, error } = await svc.from("algorithms").select("id, name, moves, moves_normalized");
    if (error) {
      throw error;
    }

    // An empty table would make this test vacuously green — that is not a pass.
    expect(
      data.length,
      "no algorithms rows to compare; run `npx supabase db reset` to load supabase/seed.sql",
    ).toBeGreaterThan(0);

    const divergent = data
      .filter((row) => normalizeMoves(row.moves) !== row.moves_normalized)
      .map(
        (row) =>
          `${row.name}: moves=${JSON.stringify(row.moves)} ` +
          `js=${JSON.stringify(normalizeMoves(row.moves))} sql=${JSON.stringify(row.moves_normalized)}`,
      );
    expect(divergent).toEqual([]);
  });

  // The seed the local stack loads (supabase/seed.sql) happens to contain no
  // parentheses, no double spaces, and no U+2019 — the very characters the rule
  // exists for. Round-tripping a hand-written row through the column keeps this
  // test's teeth independent of what the seed happens to hold.
  it("agrees on a hand-written row with parens, a double space, and U+2019", async () => {
    const raw = "(R  U2 R’ U') (R U R')";

    const list = await svc
      .from("algorithm_lists")
      .insert({ name: `parity-${crypto.randomUUID()}`, is_system: true, user_id: null })
      .select("id")
      .single();
    if (list.error) {
      throw list.error;
    }

    try {
      const inserted = await svc
        .from("algorithms")
        .insert({ list_id: list.data.id, name: "parity-case", moves: raw, position: 1 })
        .select("moves, moves_normalized")
        .single();
      if (inserted.error) {
        throw inserted.error;
      }

      // Oracle is the intended rule, spelled out as a literal — not read back
      // from either implementation.
      expect(inserted.data.moves).toBe(raw); // stored display-verbatim
      expect(inserted.data.moves_normalized).toBe("R U2 R' U' R U R'");
      expect(normalizeMoves(raw)).toBe(inserted.data.moves_normalized);
    } finally {
      // Deleting the list cascades the algorithm row.
      await svc.from("algorithm_lists").delete().eq("id", list.data.id);
    }
  });
});

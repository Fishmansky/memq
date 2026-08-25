import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMoves } from "@/components/app/PracticeSession";
import { PRODUCIBLE_TOKENS } from "@/test/tokenGrammar";

// Regression guard for the `R2'` / `U2'` incident: seed content containing a
// token the app can never dispatch leaves a practice session permanently stuck
// on that move — no error, no crash. Nothing else in the suite reads real seed
// content, so this is the only place that would catch a re-scrape reintroducing
// an unreachable token. DB-free: the .sql files are parsed as text.

const SEED_FILES = ["supabase/algos_seed.sql", "supabase/seed.sql"] as const;

// One `public.algorithms` tuple: ('<uuid>', '<name>', '<moves>', <position>).
// Names never contain apostrophes; `moves` values do, escaped as ''. The
// list_id/user_id/is_system tuples in the algorithm_lists INSERTs don't match
// this shape and are skipped.
const ALGORITHM_TUPLE = /\(\s*'([0-9a-fA-F-]{36})',\s*'([^']*)',\s*'((?:[^']|'')*)',\s*(\d+)\s*\)/g;

// Every line that opens an algorithms tuple — used to cross-check the regex
// actually matched everything, so a silently-broken pattern can't pass as "no
// bad tokens found".
const TUPLE_LINE = /^\s*\('[0-9a-fA-F-]{36}',/;

interface SeedRow {
  file: string;
  name: string;
  moves: string;
}

function readSeedRows(relPath: string): SeedRow[] {
  // Resolve from this module's own directory, not the process cwd — vitest.config.ts
  // sets no `root`, so cwd varies by invocation (IDE runners, explicit --root).
  // src/test/ → two levels up is the repo root.
  const source = readFileSync(resolve(import.meta.dirname, "../..", relPath), "utf8");
  const rows: SeedRow[] = [];
  for (const match of source.matchAll(ALGORITHM_TUPLE)) {
    // Unescape SQL-doubled apostrophes back to the literal the DB stores.
    rows.push({ file: relPath, name: match[2], moves: match[3].replace(/''/g, "'") });
  }
  const tupleLines = source.split("\n").filter((line) => TUPLE_LINE.test(line)).length;
  expect(rows.length, `${relPath}: tuple regex matched ${String(rows.length)} of ${String(tupleLines)} rows`).toBe(
    tupleLines,
  );
  expect(rows.length).toBeGreaterThan(0);
  return rows;
}

describe("seed content uses only producible move tokens", () => {
  for (const relPath of SEED_FILES) {
    it(`${relPath}: every token can be dispatched by the app`, () => {
      const offenders = readSeedRows(relPath).flatMap((row) =>
        parseMoves(row.moves)
          .filter((token) => !PRODUCIBLE_TOKENS.has(token))
          .map((token) => `${row.file} — ${row.name}: unreachable token "${token}" in "${row.moves}"`),
      );
      expect(offenders).toEqual([]);
    });
  }
});

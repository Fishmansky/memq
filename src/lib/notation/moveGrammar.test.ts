import { describe, expect, it } from "vitest";
import { PRODUCIBLE_TOKENS, normalizeMoves, validateMoves } from "@/lib/notation/moveGrammar";

// Oracle is the intended rule, stated as literals here — never the
// implementation read back. `normalizeMoves` is half of a two-language
// contract: the other half is the `moves_normalized` generated column, pinned
// by src/test/integration/normalization.int.test.ts.

describe("normalizeMoves", () => {
  const cases: [label: string, raw: string, expected: string][] = [
    ["leading and trailing whitespace", "  R U R'  ", "R U R'"],
    ["double space", "R  U  R'", "R U R'"],
    ["tab separator", "R\tU R'", "R U R'"],
    ["newline separator", "R\nU R'", "R U R'"],
    // A real seeded sequence — parens are visual grouping in algos_seed.sql.
    ["parenthesised groups", "(R U2 R' U') (R U R')", "R U2 R' U' R U R'"],
    // Parens map to a space, not to nothing: mapping to nothing would fuse
    // `U` and `R'` into the unproducible token `UR'`.
    ["unspaced adjacent groups", "(R U)(R' U)", "R U R' U"],
    ["typographic apostrophe folded to ASCII", "R’ U", "R' U"],
    ["case is preserved (wide moves)", "r U R", "r U R"],
    ["empty string", "", ""],
    ["whitespace only", " \t\n ", ""],
  ];

  for (const [label, raw, expected] of cases) {
    it(label, () => {
      expect(normalizeMoves(raw)).toBe(expected);
    });
  }
});

describe("validateMoves", () => {
  it("accepts every producible token", () => {
    for (const token of PRODUCIBLE_TOKENS) {
      const result = validateMoves(token);
      expect(result.ok, `token "${token}" should be producible`).toBe(true);
    }
  });

  it("accepts a parenthesised seeded sequence and returns its normalized form", () => {
    expect(validateMoves("(R U2 R' U') (R U R')")).toEqual({
      ok: true,
      normalized: "R U2 R' U' R U R'",
    });
  });

  it("rejects R2' — the unreachable token from the 2026-08-24 incident", () => {
    const result = validateMoves("R U R2'");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("R2'");
  });

  it("rejects an empty sequence", () => {
    expect(validateMoves("").ok).toBe(false);
  });

  it("rejects a whitespace-only sequence", () => {
    expect(validateMoves(" \t\n ").ok).toBe(false);
  });

  it("names the first offending token", () => {
    const result = validateMoves("R Q U");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('"Q"');
  });

  // These two exist only because `validateMoves` also checks `parseMoves(raw)`.
  // Each normalizes to a fully producible sequence, so a validator gating only
  // the normalized form would accept them — and the practice loop, which
  // tokenizes the stored RAW `moves`, would then hold a token it can never
  // dispatch: the slot never advances and no error is shown.
  it("rejects a tab separator, which the raw tokenizer cannot split", () => {
    const result = validateMoves("R\tU R'");
    expect(normalizeMoves("R\tU R'")).toBe("R U R'"); // normalized form is fine
    expect(result.ok).toBe(false);
  });

  it("rejects a typographic apostrophe, which the raw tokenizer does not fold", () => {
    const result = validateMoves("R’ U");
    expect(normalizeMoves("R’ U")).toBe("R' U"); // normalized form is fine
    expect(result.ok).toBe(false);
  });
});

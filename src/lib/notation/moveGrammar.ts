// Single source of truth for the move vocabulary, how the app tokenizes a move
// sequence, and what counts as a valid sequence. Consumed by the practice-loop
// island, the add-algorithm form, and the add-algorithm API route — which is
// why this module must never import from a React island: doing so would drag a
// component into an endpoint bundle on the Cloudflare Workers runtime. Phase 1
// of the plan guards this with a literal grep over this file for that import
// path, so keep the path itself out of here — comments included.

// --- Key → move lookup table ---------------------------------------------
// Base moves, shift-prime variants, and two modifier sentinels (w, 2).
export const KEY_TO_MOVE: Record<string, string> = {
  r: "R",
  "shift+r": "R'",
  u: "U",
  "shift+u": "U'",
  f: "F",
  "shift+f": "F'",
  l: "L",
  "shift+l": "L'",
  b: "B",
  "shift+b": "B'",
  d: "D",
  "shift+d": "D'",
  x: "x",
  "shift+x": "x'",
  y: "y",
  "shift+y": "y'",
  z: "z",
  "shift+z": "z'",
  m: "M",
  "shift+m": "M'",
  e: "E",
  "shift+e": "E'",
  s: "S",
  "shift+s": "S'",
  w: "__wide_modifier__", // sentinel — toggles wideModifier
  2: "__double_modifier__", // sentinel — toggles doubleModifier
};

// --- Producible token set -------------------------------------------------
// "What tokens can the app ever produce?". Mirrors `dispatchMove`
// (PracticeSession.tsx): wide lowercases the base token, double appends "2" —
// always last, which is why `R2'` is unreachable.

export const WIDE_SENTINEL = "__wide_modifier__";
export const DOUBLE_SENTINEL = "__double_modifier__";

// Every KEY_TO_MOVE value except the two modifier sentinels (w / 2), which are
// modifiers, not face tokens.
export const KEYBOARD_BASE_TOKENS: ReadonlySet<string> = new Set<string>(
  Object.values(KEY_TO_MOVE).filter((v) => v !== WIDE_SENTINEL && v !== DOUBLE_SENTINEL),
);

// The wide modifier lowercases the assembled token, so each base token ALSO
// reaches its lowercase form (the grid's wide cells: u, r', l, ...).
export const KEYBOARD_WITH_WIDE_TOKENS: ReadonlySet<string> = new Set<string>([
  ...KEYBOARD_BASE_TOKENS,
  ...[...KEYBOARD_BASE_TOKENS].map((t) => t.toLowerCase()),
]);

// The double modifier appends "2" after any lowercasing, giving the full
// producible set: {base, base+"2", lower(base), lower(base)+"2"}.
export const PRODUCIBLE_TOKENS: ReadonlySet<string> = new Set<string>([
  ...KEYBOARD_WITH_WIDE_TOKENS,
  ...[...KEYBOARD_WITH_WIDE_TOKENS].map((t) => `${t}2`),
]);

// --- Tokenizer ------------------------------------------------------------
// The runtime tokenizer the practice loop dispatches against. Splits on a
// single space only and does no apostrophe folding — which is exactly why
// `validateMoves` has to check it as well as the normalized form.
export function parseMoves(moves: string): string[] {
  return moves.replace(/[()]/g, "").split(" ").filter(Boolean);
}

// --- Normalizer -----------------------------------------------------------
// Derives the comparison form used for FR-015 duplicate detection. MUST stay
// byte-identical to the `moves_normalized` generated column
// (supabase/migrations/*_algorithms_normalized_moves_and_source.sql); the
// parity test in src/test/integration/normalization.int.test.ts is the
// contract. Case-preserving — `r` (wide) is not `R`.
//
// Parens map to a SPACE, not to nothing: deleting them fuses tokens across an
// unspaced group boundary, so `(R U)(R' U)` would become `R UR' U` and `UR'` is
// not a producible token. JS and SQL would agree on that corruption, keeping
// the parity test green while the learner got a bewildering error.
export function normalizeMoves(raw: string): string {
  return raw
    .replace(/[()]/g, " ")
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Validator ------------------------------------------------------------
// Gates a submitted sequence against the producible vocabulary. Checks BOTH
// token streams:
//   1. the normalized sequence — what duplicate matching compares, and
//   2. `parseMoves(raw)` — what the practice loop will actually dispatch
//      against the stored raw `moves`.
// Check 2 is what rejects "R\tU R'" and "R’ U": each normalizes to a fully
// producible sequence, but raw tokenization yields a token the app can never
// dispatch, so `action.move === expected` never matches, the slot never
// advances, and no error is shown — the 2026-08-24 rotation-notation incident
// class, reached through the input path this feature adds.
export function validateMoves(raw: string): { ok: true; normalized: string } | { ok: false; error: string } {
  const normalized = normalizeMoves(raw);
  if (normalized === "") {
    return { ok: false, error: "Enter a move sequence." };
  }

  for (const token of [...normalized.split(" "), ...parseMoves(raw)]) {
    if (!PRODUCIBLE_TOKENS.has(token)) {
      return {
        ok: false,
        error: `"${token}" is not a move this app can practice. Separate moves with single spaces and use a plain apostrophe (') for primes.`,
      };
    }
  }

  return { ok: true, normalized };
}

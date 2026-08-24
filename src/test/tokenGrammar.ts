import { KEY_TO_MOVE } from "@/components/app/PracticeSession";

// Single source of truth for "what tokens can the app ever produce?".
// Mirrors `dispatchMove` (PracticeSession.tsx): wide lowercases the base token,
// double appends "2" — always last, which is why `R2'` is unreachable.
// Consumed by PracticeSession.parity.test.ts and src/test/seedTokens.test.ts so
// the two cannot drift apart.

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

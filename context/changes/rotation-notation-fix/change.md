---
change_id: rotation-notation-fix
title: Rotation notation fix
status: implemented
created: 2026-08-24
updated: 2026-08-25
archived_at: null
---

## Notes

Bug: invalid `X2'` notation in seed data blocks 7 algorithms

## Summary

`supabase/algos_seed.sql` contains the token `R2'` / `U2'` (double turn +
trailing prime) in 7 algorithm rows. This notation is not standard cube
notation (a 180° turn has no direction — `R2` and `R2'` are the same physical
move) and, more importantly, the app's input system can **never produce it**.
Any practice session on one of these algorithms sticks forever on that move —
no error, no crash, just permanently stuck. Silent, undetected by existing
tests.

## Affected rows

`supabase/algos_seed.sql`:

| Algorithm | List | Line | Broken token |
|---|---|---|---|
| OLL 22 | OLL | 93 | `R2'` (×2) |
| OLL 28 | OLL | 99 | `U2'` |
| OLL 50 | OLL | 121 | `R2'` |
| OLL 54 | OLL | 125 | `U2'` |
| E-perm | PLL | 140 | `R2'` |
| Ga-perm | PLL | 143 | `R2'` |
| Gc-perm | PLL | 145 | `R2'` |

In the SQL file these appear escaped as `R2''` / `U2''` (each `''` = one
literal `'`); the DB row actually stores `R2'` / `U2'`. Confirmed directly
against the DB for OLL 22: `R U2 (R2' U' R2 U') (R2' U2 R)`. This is correct,
unambiguous SQL escaping — not a parsing artifact. The stray prime is real
content, scraped as-is from the source (solvethecube.com) and never valid
notation to begin with.

## Root cause / mechanism

`src/components/app/PracticeSession.tsx:291-296`, `dispatchMove`:

```js
function dispatchMove(base: string) {
  let move = base;
  if (wideModifier) move = move.toLowerCase(); // R → r, R' → r'
  if (doubleModifier) move = move + "2";
  dispatch({ type: "INPUT_MOVE", move });
}
```

Double modifier always appends `"2"` last, after any prime. Reachable tokens
are only: `base`, `base + "2"`, `base.toLowerCase()`, `base.toLowerCase() +
"2"`. There is no path that produces `"2"` followed by `"'"` — i.e. `R2'` is
not in the producible token set, whether via keyboard (`KEY_TO_MOVE` +
modifiers) or via the on-screen `MoveGrid` buttons.

`parseMoves` (same file) splits an algorithm's `moves` string into exact
tokens; `reducer`'s `INPUT_MOVE` case does `action.move === expected`
(`PracticeSession.tsx:149`). Since `R2'`/`U2'` can never equal any producible
`move`, that slot in `slotResults` can never turn `"correct"`, `currentIndex`
never advances past it, and the session can never reach `"submitting"`.

## Why undetected

- Reducer/parity/component tests (`PracticeSession.reducer.test.ts`,
  `PracticeSession.parity.test.ts`, `PracticeSession.test.tsx`) all use
  synthetic tokens (`"R"`, `"U"`, `"R'"`) — never real seed content.
- E2E specs (`moves-grid-rework.spec.ts`, `practice-loop-persistence.spec.ts`)
  drive synthetic move sequences too.
- Nothing in the test suite exercises the actual `algos_seed.sql` data.

## Fix

Drop the trailing `'` after every `2` in the 7 rows above:
`R2'` → `R2`, `U2'` → `U2`. Standard notation, matches the producible token
grammar.

# Practice Session Core Loop — Implementation Plan

## Overview

Build the interactive practice session for algorithm memorization: move input via keyboard and mouse, per-slot color feedback, streak persistence, and "You're PRO!" milestone banner. Mounts as a React island on the existing algorithm detail page.

## Current State Analysis

- `src/pages/sets/[id]/[algoId].astro` — loads `algorithm.moves` (plain string, e.g. `"R U R' U'"`) and renders a disabled "Practice (coming soon)" button. No practice logic exists.
- `MoveSequence.astro` — parses moves: `moves.replace(/[()]/g, "").split(" ").filter(Boolean)`. Same parsing logic reused in island.
- `practice_sessions` table — append-only INSERT, columns: `user_id`, `algorithm_id`, `is_clean`, `error_count`, `completed_at`.
- `algorithm_mastery` table — UPSERT on unique `(user_id, algorithm_id)`, columns: `consecutive_clean`, `mastery_reached`, `updated_at`.
- RLS policies allow users to read/insert `practice_sessions` and read/insert/update `algorithm_mastery` for their own records.
- Zero Supabase write calls exist in codebase today.
- Auth island pattern: `client:load`, user always present on `/sets/**` (protected by middleware).

### Key Discoveries

- `algorithm_mastery` unique constraint on `(user_id, algorithm_id)` — enables `.upsert({ onConflict: 'user_id,algorithm_id' })` without extra SELECT.
- `practice_sessions` has no UPDATE RLS policy — append-only by design; each session is a new row.
- `context.locals.user` provides authenticated user in API routes — island never needs to pass userId.
- `react-hotkeys-hook@5.2.4`: SSR-safe (guarded `typeof window/document`), React 19 compatible, ships own `.d.ts`. Omit the `deps` arg to avoid `no-explicit-any` lint error.
- Button component (`src/components/ui/button.tsx`) uses CVA variants — reuse for move buttons.

## Desired End State

User opens an algorithm detail page, clicks "Start Practice", and sees the move sequence as interactive slots. As they input each move (keyboard or on-screen button), the slot turns green (correct) or red (wrong — must retry). On completing the full sequence, results persist to Supabase and a result banner appears. On the 3rd consecutive clean run, the PRO banner replaces the standard result banner.

### Verification

- Start button activates session; hotkeys fire only when session is active.
- Wrong move marks slot red; correct move required to advance; error_count accumulates.
- Session completion POSTs to `/api/practice/complete` and receives `{ consecutiveClean, masteryReached }`.
- PRO banner visible after 3rd consecutive clean.
- `practice_sessions` row inserted and `algorithm_mastery.consecutive_clean` correctly incremented/reset after each session.

## What We're NOT Doing

- No separate `/practice` route — session embeds directly on algo detail page.
- Double moves (R2, U2) and wide moves (r, u) ARE supported via keyboard using sequence input (see Critical Implementation Details).
- No rotation (x, y, z) special treatment beyond what appears in the algorithm's move string.
- No confetti, sounds, or animations beyond Tailwind color transitions.
- No offline/optimistic persistence — POST to API on session end; no retry logic.
- No undo/hint functionality.

## Implementation Approach

Three phases in dependency order: API route first (testable in isolation), then the island (consumes the API), then wire the island into the detail page (one-line change). The island owns all session state with `useReducer`; the API route owns all persistence logic; the Astro page stays a thin shell.

## Critical Implementation Details

**UPSERT streak logic in API route:** On clean session, `consecutive_clean` must increment by 1 (not set to 1). Supabase `.upsert()` does not natively support field-level increment. Use **fetch-then-upsert**: call `.select().maybeSingle()` first to get the current row (`null` = first-ever session), compute the new `consecutive_clean` value in JS, then call `.upsert({ onConflict: 'user_id,algorithm_id' })` with the computed value. Two DB calls per session — acceptable latency; no custom RPC or Postgres function needed.

**Key→move mapping — two explicit modifiers, no buffer:** Both wide moves and double moves use toggle modifiers. Drop all `ctrl+*` entries from `KEY_TO_MOVE`. No `useRef` timers, no `inputBuffer`.

- **Base moves:** `r` → `"R"`, `shift+r` → `"R'"`, etc. (instant)
- **Wide modifier:** key `"w"` + on-screen W button. When activated, `wideModifier: true`. Next move lowercased before dispatch (`"R"` → `"r"`, `"R'"` → `"r'"`). Resets to `false` after dispatch.
- **Double modifier:** key `"2"` + on-screen X2 button. When activated, `doubleModifier: true`. Next move gets `"2"` appended (`"R"` → `"R2"`). Resets to `false` after dispatch.
- Both active simultaneously: `"R"` → `"r2"` (wide takes priority over double in token assembly: lowercase first, then append `"2"`).
- Neither modifier dispatches a move itself.

Modifier state: `wideModifier: boolean` + `doubleModifier: boolean` in reducer. Both reset to `false` after any move dispatch.

**Slot state on retry:** When a slot is in `wrong` state, the next correct input for that slot should turn it green (not add a new error). Error count increments only on the wrong attempt, not on each retry keystroke.

---

## Phase 1: API Route — Session Persistence

### Overview

New POST endpoint that receives session results, writes to `practice_sessions`, and upserts `algorithm_mastery`. Returns updated streak data to the island.

### Changes Required

#### 1. Session completion endpoint

**File:** `src/pages/api/practice/complete.ts`

**Intent:** Handle POST `{ algorithmId, isClean, errorCount }`. Auth-guard via `context.locals.user`. Write session row. Read current `consecutive_clean`, compute new value (increment if clean, reset to 0 if not, cap mastery at true once reached), upsert mastery row. Return `{ consecutiveClean: number, masteryReached: boolean }`.

**Contract:**

```ts
// POST body
{ algorithmId: string; isClean: boolean; errorCount: number }

// 200 response
{ consecutiveClean: number; masteryReached: boolean }

// Error responses: 401 (no user), 400 (invalid body), 500 (DB error)
```

Fetch `algorithm_mastery` for `(user_id, algorithm_id)` before upserting — needed to compute incremented `consecutive_clean` correctly (Supabase JS client has no atomic increment on upsert). Use `.maybeSingle()` so missing row returns `null` (first-ever session for this algorithm).

### Success Criteria

#### Automated Verification

- `npm run lint` passes
- `npm run build` passes

#### Manual Verification

- POST with valid session body and authenticated cookie returns 200 with `{ consecutiveClean, masteryReached }`.
- POST with missing/invalid body returns 400.
- Unauthenticated POST returns 401.
- `practice_sessions` table has new row after request.
- `algorithm_mastery.consecutive_clean` increments on clean, resets on dirty.
- `mastery_reached` flips to `true` on 3rd consecutive clean and stays `true` thereafter.

**Pause here for manual confirmation before proceeding to Phase 2.**

---

## Phase 2: PracticeSession Island

### Overview

React island managing the full session lifecycle: idle → active → complete. Renders the move slot grid, handles keyboard and mouse input, calls the Phase 1 API on completion, and displays the result/PRO banner.

### Prerequisites

```bash
npm install react-hotkeys-hook@5.2.4
```

Library vetted in research.md: MIT, ~4 KB, zero runtime deps, SSR-safe, React 19 + Cloudflare Workers compatible.

### Changes Required

#### 1. Key→move lookup table

**File:** `src/components/app/PracticeSession.tsx`

**Intent:** Define a module-level constant mapping key combo strings to move tokens. Covers base moves, shift-prime, and modifier sentinels for `w` (wide) and `2` (double).

**Contract:**

```ts
const KEY_TO_MOVE: Record<string, string> = {
  r: "R",  "shift+r": "R'",
  u: "U",  "shift+u": "U'",
  f: "F",  "shift+f": "F'",
  l: "L",  "shift+l": "L'",
  b: "B",  "shift+b": "B'",
  d: "D",  "shift+d": "D'",
  x: "x",  "shift+x": "x'",
  y: "y",  "shift+y": "y'",
  z: "z",  "shift+z": "z'",
  m: "M",  "shift+m": "M'",
  e: "E",  "shift+e": "E'",
  s: "S",  "shift+s": "S'",
  w: "__wide_modifier__",   // sentinel — toggles wideModifier
  2: "__double_modifier__", // sentinel — toggles doubleModifier
};
```

#### 2. Session state reducer

**File:** `src/components/app/PracticeSession.tsx`

**Intent:** `useReducer` managing `{ phase: 'idle' | 'active' | 'submitting' | 'complete' | 'error', slotResults: Array<'pending' | 'correct' | 'wrong'>, currentIndex: number, errorCount: number, result: { consecutiveClean: number; masteryReached: boolean } | null, wideModifier: boolean, doubleModifier: boolean, submitError: string | null }`. No `inputBuffer`. No `useRef` timers. Actions: `START`, `INPUT_MOVE`, `TOGGLE_WIDE_MODIFIER`, `TOGGLE_DOUBLE_MODIFIER`, `SUBMIT_RESULT`, `SUBMIT_ERROR`.

- `INPUT_MOVE` payload: raw move token string (already assembled by handler — reducer just validates and advances).
- `TOGGLE_WIDE_MODIFIER`: flips `wideModifier`. Fired by W button click or key `"w"`.
- `TOGGLE_DOUBLE_MODIFIER`: flips `doubleModifier`. Fired by X2 button click or key `"2"`.
- After `INPUT_MOVE` dispatch: reducer resets both `wideModifier` and `doubleModifier` to `false`.
- Token assembly happens in the keyboard handler (not the reducer): if `wideModifier`, lowercase the base token; if `doubleModifier`, append `"2"`. Both: lowercase then append `"2"` (e.g. `"r2"`).

#### 3. Keyboard hook

**File:** `src/components/app/PracticeSession.tsx`

**Intent:** Single `useHotkeys` call covering all keys in `KEY_TO_MOVE`. Active only when `phase === 'active'`. Handles three cases: wide modifier sentinel, double modifier sentinel, or base move (assembled with active modifiers before dispatch).

**Contract:**

```ts
useHotkeys(
  Object.keys(KEY_TO_MOVE),
  (_, handler) => {
    const keys = handler.keys ?? [];
    const mods = handler.shift ? ["shift"] : [];
    const combo = [...mods, ...keys].join("+");
    const mapped = KEY_TO_MOVE[combo];
    if (!mapped) return;
    if (mapped === "__wide_modifier__") {
      dispatch({ type: "TOGGLE_WIDE_MODIFIER" });
    } else if (mapped === "__double_modifier__") {
      dispatch({ type: "TOGGLE_DOUBLE_MODIFIER" });
    } else {
      let move = mapped;
      if (wideModifier) move = move.toLowerCase(); // R → r, R' → r'
      if (doubleModifier) move = move + "2";
      dispatch({ type: "INPUT_MOVE", move });
    }
  },
  { enabled: phase === "active", preventDefault: true }
);
```

#### 4. Move slot grid

**File:** `src/components/app/PracticeSession.tsx`

**Intent:** Render parsed moves as an array of colored slot elements. Slots are **blank** — no move text shown. Color class driven by `slotResults[i]`: `pending` → neutral (`bg-white/10 border border-white/20`), `correct` → `bg-green-500`, `wrong` → `bg-red-500`. Current slot (`currentIndex`) gets a ring to indicate focus.

Below slots, render the **full moves grid** — all possible moves, always shown, regardless of what the algorithm uses. Three sub-grids with keyboard-layout positioning using CSS grid:

**Side layers moves grid** (face turns + wide moves):
```
Layout (col × row, 0-indexed):
       U      U'            ← row 0, cols 3,4
       u      u'            ← row 1, cols 3,4
L' l'  F'     F  r  R      ← row 2, cols 0,1,2,4,5,6 (gap at col 3)
         f' f               ← row 3, cols 2,3 (or 3,4 — center of F column)
         b  b'              ← row 4
L  l   B      B' r' R'     ← row 5
       d'     d             ← row 6
       D'     D             ← row 7
```

**Central layers moves grid** (M, E, S — 3×3 cross layout):
```
     M'       ← top center
E' S' S E     ← middle row
     M        ← bottom center
```

**Cube rotation moves grid** (x, y, z — 3×3 cross layout):
```
     x        ← top center
y  z' z  y'   ← middle row
     x'       ← bottom center
```

Each move button dispatches `INPUT_MOVE` on click (applying active modifiers before dispatch). Two modifier buttons shown separately above the grids:

- **W button** — dispatches `TOGGLE_WIDE_MODIFIER`. Highlighted when `wideModifier === true`. Key `"w"`.
- **X2 button** — dispatches `TOGGLE_DOUBLE_MODIFIER`. Highlighted when `doubleModifier === true`. Key `"2"`.

Clicking any move button while modifiers active assembles the final token (lowercase if wide, append `"2"` if double, both if both), dispatches `INPUT_MOVE`, and both modifiers reset.

#### 5. Session lifecycle UI

**File:** `src/components/app/PracticeSession.tsx`

**Intent:**
- **Idle phase:** Render move sequence overview (same token rendering as `MoveSequence.astro` — `moves.replace(/[()]/g, "").split(" ").filter(Boolean)` as styled spans) + "Start Practice" button (reuse `Button` from `@/components/ui/button`). On click, dispatch `START`. Overview visible only in idle.
- **Active phase:** Render slot grid (blank) + full moves grid + X2 modifier button. Move sequence overview hidden.
- **Submitting phase:** POST `{ algorithmId, isClean: errorCount === 0, errorCount }` to `/api/practice/complete`. On success, dispatch `SUBMIT_RESULT`. On network error or non-2xx response, dispatch `SUBMIT_ERROR` with error message text — transitions phase to `error`.
- **Error phase:** Show error banner (follow `bannerError` pattern from `[algoId].astro:52-56`) with message and a "Retry" button that re-attempts the POST. Slot results remain visible.
- **Complete phase:** Render result banner above slots. If `result.masteryReached` is true or `result.consecutiveClean >= 3`, show PRO banner (`"You're PRO!"`); otherwise show clean/dirty summary. Render "Try Again" button that resets to idle.

**Props interface:**

```ts
interface PracticeSessionProps {
  algorithmId: string;
  moves: string; // raw moves string from DB, e.g. "R U R' U'"
}
```

### Success Criteria

#### Automated Verification

- `npm run lint` passes
- `npm run build` passes

#### Manual Verification

- Move sequence overview visible in idle; hidden once session starts.
- Slots are blank (no move text shown) — color only.
- Start button activates session; hotkeys inactive before clicking Start.
- Correct key press turns slot green and advances to next slot.
- Wrong key press turns slot red; stays until correct move entered; error count accumulates.
- On-screen move buttons (full grid) work identically to keyboard.
- W button highlights when active; clicking a move while W active dispatches wide move and clears W.
- X2 button highlights when active; clicking a move while X2 active dispatches doubled move and clears X2.
- Key `w` toggles W modifier; key `2` toggles X2 modifier.
- W + X2 both active: move dispatched as wide-double (e.g. `"r2"`).
- After last slot, banner appears with correct clean/dirty message.
- PRO banner appears on reaching 3 consecutive cleans.
- "Try Again" resets all slots to pending and returns to idle (overview reappears).
- Wide-move input: press `w` (W activates), press `r` → `"r"` dispatched, W clears.
- Double-move input: press `2` (X2 activates), press `r` → `"R2"` dispatched, X2 clears.
- Combined: both active, press `r` → `"r2"` dispatched, both clear.
- No console errors during session or on completion.

**Pause here for manual confirmation before proceeding to Phase 3.**

---

## Phase 3: Wire Into Algo Detail Page

### Overview

Replace the disabled "Practice (coming soon)" button on the algorithm detail page with the PracticeSession island.

### Changes Required

#### 1. Mount PracticeSession island

**File:** `src/pages/sets/[id]/[algoId].astro`

**Intent:** Import `PracticeSession`. Remove the static `<MoveSequence>` block (lines 58-60) — PracticeSession renders the move overview itself in idle phase. Replace the disabled button block (lines 61-66) with `<PracticeSession algorithmId={algorithm.id} moves={algorithm.moves} client:load />`.

**Contract:** Remove the `MoveSequence` import and its wrapping `<div class="mb-8">`. Add PracticeSession import and swap disabled button. No new data fetching — `algorithm.id` and `algorithm.moves` already loaded on line 14-25.

### Success Criteria

#### Automated Verification

- `npm run lint` passes
- `npm run build` passes (Cloudflare Workers adapter)

#### Manual Verification

- Algo detail page loads without errors.
- Practice session is visible and functional in place of the old disabled button.
- Full happy path: start → correct inputs → session completes → streak updates in DB → result banner shown.
- Full error path: wrong inputs counted → dirty session stored → `consecutive_clean` resets.
- No regressions: MoveSequence display, back navigation, page title still work.

---

## Testing Strategy

### Manual Testing Steps

1. Navigate to `/sets/<id>/<algoId>` as authenticated user.
2. Confirm move sequence overview visible; "Start Practice" button visible; hotkeys do nothing.
3. Click Start — overview hides, blank slots appear, full move grid appears, hotkeys activate.
4. Input each correct move via keyboard — each blank slot turns green sequentially.
5. Input a wrong move — slot turns red; verify correct move needed to advance.
6. Complete session with 0 errors — verify green banner, DB row `is_clean=true`, `consecutive_clean` incremented.
7. Complete session with errors — verify dirty banner, `consecutive_clean` reset to 0.
8. Complete 3 consecutive clean sessions for same algorithm — verify PRO banner on 3rd.
9. Verify "Try Again" resets island to idle — overview reappears, slots gone.
10. Verify X2 modifier: click X2 (or press `2`), then click a move button — doubled move dispatched, X2 clears.
11. Verify wide-move input: press `w` then `r` — `"r"` dispatched if in algorithm.

## Performance Considerations

Island hydrates on page load (`client:load`) — acceptable since the practice section is the primary purpose of this page. No heavy deps: `react-hotkeys-hook` is ~4 KB.

## Migration Notes

No schema changes required. Tables `practice_sessions` and `algorithm_mastery` exist with correct structure and RLS.

## References

- Research: `context/changes/practice-session-core-loop/research.md`
- DB types: `src/db/database.types.ts`
- Move display pattern: `src/components/app/MoveSequence.astro:5`
- Island pattern reference: `src/components/auth/SignInForm.tsx`
- Button component: `src/components/ui/button.tsx`
- Migration + RLS: `supabase/migrations/20260527000000_domain_schema_rls.sql`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: API Route — Session Persistence

#### Automated

- [x] 1.1 `npm run lint` passes — 45a6553
- [x] 1.2 `npm run build` passes — 45a6553

#### Manual

- [x] 1.3 POST with valid body + auth returns 200 with `{ consecutiveClean, masteryReached }` — 7630c1b
- [x] 1.4 POST with invalid body returns 400 — 7630c1b
- [x] 1.5 Unauthenticated POST returns 401 — 7630c1b
- [x] 1.6 `practice_sessions` row inserted after request — 7630c1b
- [x] 1.7 `consecutive_clean` increments on clean, resets on dirty — 7630c1b
- [x] 1.8 `mastery_reached` flips on 3rd consecutive clean and stays true — 7630c1b

### Phase 2: PracticeSession Island

#### Automated

- [x] 2.0 `npm install react-hotkeys-hook@5.2.4` succeeds — b5877f1
- [x] 2.1 `npm run lint` passes — b5877f1
- [x] 2.2 `npm run build` passes — b5877f1

#### Manual

- [x] 2.3 Move overview visible idle; hidden on session start
- [x] 2.4 Slots blank (no move text) in active phase
- [x] 2.5 Start button activates session; hotkeys inactive before
- [x] 2.6 Correct key turns slot green and advances
- [x] 2.7 Wrong key turns slot red; stays until correct move entered; error count accumulates
- [x] 2.8 Full move grid always shown in active phase; all buttons clickable
- [x] 2.9 X2 button highlights when active; move click while X2 active dispatches doubled move and clears X2
- [x] 2.10 Key 2 toggles X2 modifier
- [x] 2.11 Completion banner shows correct clean/dirty message
- [x] 2.12 PRO banner appears on 3rd consecutive clean
- [x] 2.13 Try Again resets to idle (overview reappears)
- [x] 2.15 Wide-move input: press `w` (toggles W), then move button/key → wide token dispatched, W clears

### Phase 3: Wire Into Algo Detail Page

#### Automated

- [x] 3.1 `npm run lint` passes
- [x] 3.2 `npm run build` passes (Cloudflare Workers adapter)

#### Manual

- [x] 3.3 Full happy path end-to-end
- [x] 3.4 Full error path end-to-end
- [x] 3.5 No regressions on algo detail page (MoveSequence, nav, title)

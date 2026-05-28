---
change_id: practice-session-core-loop
type: research
created: 2026-05-28
last_updated: 2026-05-28
last_updated_note: "Added codebase compatibility audit for react-hotkeys-hook (React 19, Cloudflare Workers SSR, TypeScript strict, island patterns)"
---

# Library Research: practice-session-core-loop

## Input handling

### Keyboard shortcuts
**Pick: `react-hotkeys-hook`**
- Most adopted, battle-tested, React 19 compatible
- `useHotkeys` hook, handles `enableOnFormTags: false` edge case
- MIT, ~4 KB

Alternatives considered: `@tanstack/react-hotkeys` (newer, more overhead), `keystrok-react` (correct `KeyboardEvent.key` usage but less adoption).

### Mouse clicks
No library. Plain React `onClick` on each button.

Both inputs call the same handler — keyboard lib and mouse are orthogonal:

```tsx
function MoveButton({ move, onMove }: { move: string; onMove: (m: string) => void }) {
  useHotkeys(move.toLowerCase(), () => onMove(move))
  return <button onClick={() => onMove(move)}>{move}</button>
}
```

### react-hotkeys-hook — implementation patterns (from docs)

**All move keys in one hook** (preferred over per-button hooks):

```tsx
useHotkeys(['r', 'u', 'f', 'l', 'b', 'd'], (_, handler) => {
  onMove(handler.keys!.join('').toUpperCase())
})
```

**Disable when session not active** — use `enabled` option:

```tsx
useHotkeys(['r', 'u', 'f', 'l', 'b', 'd'], (_, handler) => {
  onMove(handler.keys!.join('').toUpperCase())
}, { enabled: isSessionActive })
```

**Input safety** — `enableOnFormTags` defaults to `false`; hotkeys won't fire when user is typing elsewhere.

**Scope to practice panel** (optional, prevents global firing):

```tsx
const ref = useHotkeys(['r', 'u', 'f', 'l', 'b', 'd'], handler)
return <div ref={ref} tabIndex={0}>...</div>
```

**Prevent browser defaults** for conflicting keys:

```tsx
useHotkeys('f', handler, { preventDefault: true }) // prevents browser find (Ctrl+F irrelevant but 'f' alone is safe)
```

**Full S-02 pattern:**

```tsx
function PracticeSession({ moves }: { moves: string[] }) {
  const [sessionActive, setSessionActive] = useState(false)

  const handleMove = (move: string) => { /* validate move */ }

  useHotkeys(
    ['r', 'u', 'f', 'l', 'b', 'd'],
    (_, handler) => handleMove(handler.keys!.join('').toUpperCase()),
    { enabled: sessionActive, preventDefault: true }
  )

  return (
    <div>
      {moves.map(move => (
        <button key={move} onClick={() => handleMove(move)}>{move}</button>
      ))}
    </div>
  )
}
```

**Watch out — prime moves (`R'`, `U'` etc.):** apostrophe key needs a lookup table or separate binding; `'` alone may conflict with browser. Need explicit key→move mapping in plan.

## Slot feedback (red / green / yellow)

No library. Toggle Tailwind color classes (`bg-red-500`, `bg-green-500`, `bg-yellow-400`) with `transition-colors duration-150`. Zero runtime, Cloudflare Workers safe.

Optional shake on wrong move: `@casoon/tailwindcss-animations` — Tailwind v4 plugin, `cs-shake` / `cs-wiggle` utility classes, CSS-only, zero JS runtime.

## Session state

**Pick: React `useState` / `useReducer`**
- Practice session = single island, no cross-island state needed
- Nanostores / Zustand add overhead with no benefit here

## Persistence

Existing `@supabase/supabase-js` client. Streak counter written on session end.

## Summary

| Concern | Solution |
|---|---|
| Keyboard → grid | `react-hotkeys-hook` |
| Mouse → grid | React `onClick` |
| Slot color feedback | Tailwind color classes (no lib) |
| Wrong-move shake | `@casoon/tailwindcss-animations` (optional) |
| Session state | React `useState` / `useReducer` |
| Streak persistence | existing Supabase client |

All Cloudflare Workers compatible. No SSR-unsafe libs.

---

## Follow-up Research — 2026-05-28: Codebase Compatibility Audit

**Research question:** Is `react-hotkeys-hook` compatible with this specific codebase (React 19.2.6, Astro 6 SSR + Cloudflare Workers adapter, TypeScript strict, existing island patterns)?

**Git commit:** `c29f2f3260d39be93c1de0fa4cd6e3b0a5065a3b` | **Branch:** `master` | **Repo:** `Fishmansky/memq`

### Verdict: Compatible — no blockers

All three research vectors (npm source analysis, codebase audit, Context7 docs) converge on the same conclusion.

---

### Finding 1 — React 19 peer dependency

`react-hotkeys-hook@5.2.4` declares `"react": ">=16.8.0"` as peer dependency. Dev deps confirm active React 19 testing: `@types/react@19.2.8` and `@testing-library/react@16.3.1`. Zero runtime dependencies.

**Verdict: Compatible.**

---

### Finding 2 — SSR safety on Cloudflare Workers

The library guards every `window`/`document` access with `typeof` checks:

```ts
// useSafeLayoutEffect — evaluated once at module import
const useSafeLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect
```

```ts
// isHotkeyPressed.ts — IIFE at module level, fully guarded
;(() => {
  if (typeof document !== 'undefined') { document.addEventListener('keydown', ...) }
  if (typeof window !== 'undefined') { window.addEventListener('blur', ...) }
  // ...
})()
```

On Cloudflare Workers (`window`/`document` undefined during SSR):
- `useSafeLayoutEffect` falls back to `useEffect` — React never calls effects during SSR, so no DOM access reaches execution.
- The IIFE runs but all branches are skipped — no crash.
- The `document` reference inside the effect body (`ref || _options?.document || document`) is inside the guarded effect and never reached server-side.

SSR crash was a historical issue (GitHub #827, 2022), fixed in v4.0.3 and hardened further in v5.

**Verdict: SSR-safe, unconditionally. No `client:only` required.**

---

### Finding 3 — Existing React island patterns

Only 2 React islands exist in the codebase — both auth forms, both using `client:load`:

| File | Component | Directive |
|------|-----------|-----------|
| `src/pages/auth/signin.astro:16` | `SignInForm` | `client:load` |
| `src/pages/auth/signup.astro:16` | `SignUpForm` | `client:load` |

Practice session will follow the same `client:load` pattern (immediate hydration required for keyboard input). No conflicts.

**Zero existing keyboard event handlers** in the codebase — no event delegation or listener conflicts to worry about.

---

### Finding 4 — TypeScript strict compatibility

- Library ships own `.d.ts` files (no `@types/` package needed).
- Source uses TypeScript 5.9.3, same version as this project.
- ESM-only (`"type": "module"`) — aligns with Astro 6's ESM-first bundling.
- `tsconfig.json` uses `jsxImportSource: "react"` and `astro/tsconfigs/strict` — no conflicts.

**One lint caveat:** `deps` parameter is typed `any[]` in the hook signature. The project's ESLint config uses `@typescript-eslint/no-explicit-any` under `strictTypeChecked`. Omit `deps` entirely (it's optional) or pass typed arrays directly — the `any[]` only matters if you explicitly pass a deps array. In practice, the S-02 `useHotkeys` call won't need deps.

**Verdict: Compatible. Omit `deps` arg in usage.**

---

### Finding 5 — StrictMode / concurrent mode

v5 refactored internals to use `useState` + `RefCallback` instead of `useRef` for the DOM node. This correctly handles React StrictMode double-invocation — effects clean up listeners, re-registration restores them. No open issues on React 19 concurrent mode.

**Verdict: No issues.**

---

### Integration contract for S-02

Based on the codebase patterns:
- Mount `PracticeSession` as `<PracticeSession ... client:load />` in the algo detail page (`src/pages/sets/[id]/[algoId].astro`)
- Use a single `useHotkeys` call for all move keys — not per-button hooks
- Use `enabled: isSessionActive` to disable hotkeys when session is not running
- No `HotkeysProvider` needed — global scope is fine for a single island
- Path alias: `import { useHotkeys } from 'react-hotkeys-hook'` — library name, not aliased

### Compatibility matrix

| Concern | Status | Evidence |
|---|---|---|
| React 19 peerDep | ✅ `>=16.8.0` | npm package.json |
| Cloudflare Workers SSR | ✅ guarded `typeof` checks | source analysis |
| `client:load` island pattern | ✅ matches existing auth forms | codebase audit |
| TypeScript strict | ✅ ships own `.d.ts` | source + Context7 docs |
| ESLint `no-explicit-any` | ⚠️ omit `deps` arg | Context7 docs |
| React StrictMode / concurrent | ✅ v5 refactor fixed | changelog |
| Keyboard event conflicts | ✅ none exist in codebase | codebase audit |

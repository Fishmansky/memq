# Browse Pre-built Algorithm Sets + View Algorithm — Implementation Plan

## Overview

Implement the S-01 user slice: authenticated user lands on pre-built algorithm sets (F2L, OLL, PLL) from the dashboard, browses algorithms within any set sorted by position, and opens an algorithm to read its full move sequence as individual move-token chips. The disabled "Practice" button on the detail page pre-wires the S-02 entry point without breaking anything.

## Current State Analysis

- `/dashboard` is a placeholder stub showing only email + sign-out button
- Sign-in redirects to `/` (landing page) instead of `/dashboard`
- Middleware only protects `/dashboard`; `/sets/*` routes don't exist yet
- Supabase schema complete: `algorithm_lists` (3 pre-built rows, `is_system=true`), `algorithms` (F2L: 41, OLL: 57, PLL: ~21), fully typed in `src/db/database.types.ts`
- All existing pages are Astro server-rendered; no client-side data fetching anywhere
- `src/lib/supabase.ts` provides a typed server client via `createClient(headers, cookies)`
- `src/layouts/Layout.astro` is a minimal base — no topbar, no auth-aware chrome
- `src/components/Topbar.astro` exists but is only used on the marketing landing page

## Desired End State

After this plan:
- Sign-in → redirects to `/dashboard` (sets list showing F2L, OLL, PLL cards)
- Click a set → `/sets/[id]` showing all algorithms sorted by position
- Click an algorithm → `/sets/[id]/[algoId]` showing name + move sequence as chips + disabled Practice button
- Unauthenticated access to `/sets/*` → redirect to `/auth/signin`
- Supabase query errors → inline error banner on the current page (user keeps context)
- Record not found (null from `.single()`) → redirect to `/dashboard?error=...`
- TypeScript strict, lint, and build all pass

### Key Discoveries

- `algorithm_lists.is_system = true` identifies the 3 pre-built sets (F2L, OLL, PLL) with fixed UUIDs starting `00000000-0000-0000-0000-000000000002/3/4`
- `algorithms.position` is the sort key within a list; no subgroup field in schema (OLL subgroups are only SQL comments in the seed)
- Move strings use parenthetical notation: `(R U R' U') (R U' R')` — parser: `moves.replace(/[()]/g, '').split(' ').filter(Boolean)` strips grouping parentheses and splits on spaces. **Verified against all 119 seed algorithms**: 38 unique token types including wide moves (`r`, `l`, `u`, `d`, `f`), slice moves (`M`, `M'`, `M2`), rotations (`x`, `x'`, `y`, `y'`, `y2`, `z`, `z'`), and unusual `R2'` / `U2'`. No double spaces, no unspaced adjacent tokens. Parser handles all correctly.
- `signin.ts:18` currently redirects to `/` — needs to change to `/dashboard`
- Middleware `PROTECTED_ROUTES` array at `src/middleware.ts:4` needs `/sets` added

## What We're NOT Doing

- No move sequence validation or parsing beyond display (belongs to S-02)
- No search or filtering within a set list
- No pagination (max 57 algorithms, flat list is fine)
- No custom algorithm lists (belongs to S-04)
- No practice functionality (S-02 — only a disabled stub button)
- No subgroup labels within OLL (no schema support; would require a DB migration)
- No per-algorithm mastery/streak display (belongs to S-02/S-03)

## Implementation Approach

Four Astro server-rendered pages using the existing `createClient` pattern. A new `AppLayout.astro` provides the shared chrome (cosmic background + reused `Topbar.astro` + optional back-nav link) for all authenticated app pages. Dashboard queries `algorithm_lists`, set detail queries `algorithms`, algorithm detail queries both.

**Error handling split** (distinct from auth `signin.ts` pattern): Supabase query errors (transient DB failures) show an inline error on the current page so the user keeps context; missing records (null from `.single()`) redirect to `/dashboard?error=...` since there is nothing to show.

## Critical Implementation Details

**Move token parser — verified against full seed:** `moves.replace(/[()]/g, '').split(' ').filter(Boolean)` handles all 119 algorithms correctly. Parentheses appear only as grouping delimiters and are safe to strip. `filter(Boolean)` guards any trailing/double-space edge cases (none found in seed, but free). Token set includes `R2'` and `U2'` — render them as plain text chips, do not special-case.

## Phase 1: Routing Foundation

### Overview

Wire up the routing layer before any visual work: fix the post-auth redirect, protect new routes in middleware, and create the shared `AppLayout.astro` that all subsequent pages will use.

### Changes Required

#### 1. Post-auth redirect

**File**: `src/pages/api/auth/signin.ts`

**Intent**: After successful sign-in, send the user to the dashboard (sets list) instead of the marketing landing page.

**Contract**: Change the final `context.redirect` argument from `"/"` to `"/dashboard"` on line 18.

#### 2. Protect `/sets/*` routes

**File**: `src/middleware.ts`

**Intent**: Unauthenticated users who navigate directly to any `/sets/*` URL are redirected to sign-in.

**Contract**: Add `"/sets"` to the `PROTECTED_ROUTES` array on line 4. The existing `startsWith` check covers all `/sets/[id]` and `/sets/[id]/[algoId]` paths.

#### 3. Update Topbar brand link

**File**: `src/components/Topbar.astro`

**Intent**: Change the authenticated user's "Dashboard" link label to "MemQ" so the topbar functions as the app's home brand link when embedded in `AppLayout`.

**Contract**: Change the link text on the `<a href="/dashboard">` element from `Dashboard` to `MemQ`. The `href` stays the same.

#### 4. Shared app layout

**File**: `src/layouts/AppLayout.astro`

**Intent**: Provide a consistent layout for all authenticated app pages: cosmic background, a topbar with "MemQ" home-link and sign-out, and an optional back-navigation link above the content slot.

**Contract**:
- Props: `title: string`, `backHref?: string`, `backLabel?: string`
- Extends `Layout.astro` via `<Layout {title}>`
- Full-height cosmic background (`bg-cosmic min-h-screen`)
- Reuses `<Topbar />` from `src/components/Topbar.astro` — it already reads `Astro.locals.user` and renders the sign-out button. Update `Topbar.astro`'s "Dashboard" link text to "MemQ" (the label, not the `href`) so it functions as the home brand link.
- If `backHref` prop is set, render a `← {backLabel}` anchor below the topbar, above the `<slot />`

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- Sign in with valid credentials → lands on `/dashboard` (not `/`)
- Navigate to `http://localhost:4321/sets/00000000-0000-0000-0000-000000000002` while signed out → redirected to `/auth/signin`

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Dashboard — Sets List

### Overview

Replace the placeholder dashboard with a server-rendered grid of pre-built algorithm set cards, each linking to the set's detail page. Display an inline error banner when a `?error` query param is present.

### Changes Required

#### 1. Redesign dashboard page

**File**: `src/pages/dashboard.astro`

**Intent**: Query the 3 pre-built algorithm sets and render them as a card grid. If Supabase returns an error, redirect back to itself with `?error=...`. Show an inline error banner if `?error` is present in the URL.

**Contract**:
- Uses `AppLayout` with `title="Algorithm Sets"`
- Server-side query: `supabase.from('algorithm_lists').select('id, name').eq('is_system', true).order('created_at', { ascending: true })`
- On query **error** (truthy `error`): render an inline error banner on the dashboard — do **not** redirect (user is already on dashboard; a redirect loop would result)
- If `Astro.url.searchParams.get('error')` is set (e.g. redirected here from a sub-page), render an inline error banner above the card grid
- If `data` is empty (seed not applied): render a "No pre-built sets found" empty state message
- Renders `<SetCard>` for each list item, passing `id` and `name`

#### 2. Algorithm set card component

**File**: `src/components/app/SetCard.astro`

**Intent**: A clickable card that displays the set's name and links to `/sets/[id]`.

**Contract**:
- Props: `id: string`, `name: string`
- Renders an `<a href="/sets/{id}">` wrapping the card content
- Styled with glass-morphism card look (white/10 bg, border, backdrop-blur) consistent with the existing dashboard card pattern

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- `/dashboard` shows 3 cards: F2L, OLL, PLL
- Clicking a card navigates to `/sets/[id]` (404 expected — Phase 3 not yet done)
- `?error=foo` in URL shows an inline error banner
- Topbar shows "MemQ" link, user email, and sign-out button

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Set Detail Page — Algorithm List

### Overview

Create the `/sets/[id]` page that fetches all algorithms for a given list and renders them as a flat, position-ordered list. Unknown or inaccessible list IDs redirect to the dashboard with an error.

### Changes Required

#### 1. Set detail page

**File**: `src/pages/sets/[id].astro`

**Intent**: Fetch the parent list (for the page title and back-link label) and all its algorithms (ordered by `position`), then render them as a list of clickable rows.

**Contract**:
- Dynamic route param: `id` from `Astro.params`
- Uses `AppLayout` with `title={list.name}`, `backHref="/dashboard"`, `backLabel="Sets"`
- Two sequential queries: (1) `algorithm_lists` by `id` `.single()`, (2) `algorithms` by `list_id` `.order('position', { ascending: true })`
- List not found (null from query 1) or invalid id: `return Astro.redirect('/dashboard?error=' + encodeURIComponent('Set not found'))`
- Query error (truthy `error` from either query): render inline error banner on the current page — user keeps URL context and can refresh
- Renders `<AlgorithmRow>` for each algorithm

#### 2. Algorithm list-item component

**File**: `src/components/app/AlgorithmRow.astro`

**Intent**: A clickable row displaying the algorithm's `position` number, `name`, and a right-arrow indicator, linking to `/sets/[listId]/[id]`.

**Contract**:
- Props: `id: string`, `listId: string`, `position: number`, `name: string`
- Renders an `<a href="/sets/{listId}/{id}">` wrapping the row
- Consistent dark-theme row styling: subtle border, hover state, position number in muted color

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- Navigate to F2L set → see 41 algorithms listed in order (Basic 1, Basic 2 … Case 6.5)
- Navigate to OLL set → see 57 algorithms listed (OLL 1 … OLL 57 by position)
- Navigate to `/sets/00000000-0000-0000-0000-000000000099` (nonexistent) → redirected to `/dashboard?error=...`
- Append `?error=Test` to a valid set URL → inline error banner renders on the page (not redirect)
- "← Sets" back link navigates to `/dashboard`
- Clicking any algorithm navigates to `/sets/[id]/[algoId]` (404 until Phase 4)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: Algorithm Detail Page

### Overview

Create the `/sets/[id]/[algoId]` page that shows the algorithm's name and its full move sequence rendered as individual token chips. A disabled "Practice" button pre-wires the S-02 entry point.

### Changes Required

#### 1. Algorithm detail page

**File**: `src/pages/sets/[id]/[algoId].astro`

**Intent**: Fetch the algorithm by `algoId` and its parent list by `id` (for the back link). Render the algorithm name, the move sequence via `MoveSequence`, and a disabled Practice button.

**Contract**:
- Dynamic route params: `id`, `algoId` from `Astro.params`
- Uses `AppLayout` with `title={algorithm.name}`, `backHref="/sets/{id}"`, `backLabel={list.name}`
- Two queries: (1) `algorithms` by `algoId` `.single()`, (2) `algorithm_lists` by `id` `.single()`
- Algorithm not found (null from query 1): `return Astro.redirect('/sets/' + id + '?error=' + encodeURIComponent('Algorithm not found'))` — redirects to parent set, not dashboard, to preserve navigation context
- List not found (null from query 2): `return Astro.redirect('/dashboard?error=' + encodeURIComponent('Set not found'))`
- Query error (truthy `error` from either query): render inline error banner on the current page
- Disabled Practice button: `<button disabled class="...opacity-50 cursor-not-allowed">Practice (coming soon)</button>`

#### 2. Move sequence component

**File**: `src/components/app/MoveSequence.astro`

**Intent**: Parse a move string and render each token as a styled chip. Groups bounded by parentheses in the source string are stripped; individual tokens separated by spaces become individual chips.

**Contract**:
- Props: `moves: string`
- Parser: `moves.replace(/[()]/g, '').split(' ').filter(Boolean)` — this strips `(` / `)` group delimiters and splits on spaces, producing individual move tokens like `R`, `U'`, `R2`
- Renders each token as a `<span>` chip: monospace font, subtle border, dark background — styled to look like keyboard key badges

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- Navigate to any algorithm → see its name as page heading
- Move sequence shows individual chips (e.g. F2L Basic 1: `R` `U` `R'` — 3 chips)
- Complex algorithm (e.g. OLL 1: `(R U2 R') (R' F R F') U2 (R' F R F')`) shows correct token count with no stray parentheses
- Disabled Practice button visible with "coming soon" label and visually greyed out
- "← [Set Name]" back link navigates to the parent set's algorithm list

---

## Testing Strategy

### Manual Testing Steps

1. Full flow: sign in → see 3 set cards on dashboard → click F2L → see 41 algorithms → click "Basic 1" → see `R` `U` `R'` chips + disabled Practice button
2. Back navigation: algorithm detail → back to F2L list → back to Sets (dashboard)
3. Error path: sign out, navigate directly to `/sets/00000000-0000-0000-0000-000000000002` → redirected to sign-in
4. Error banner: manipulate URL to `/dashboard?error=Test%20error` → banner appears
5. OLL spot-check: OLL 1 algorithm at position 1 → verify chip count matches source: 9 tokens from `(R U2 R') (R' F R F') U2 (R' F R F')`

## References

- Roadmap entry: `context/foundation/roadmap.md` §S-01
- Database types: `src/db/database.types.ts`
- Supabase client factory: `src/lib/supabase.ts`
- Auth API pattern: `src/pages/api/auth/signin.ts`
- Middleware guard: `src/middleware.ts`
- Seed data: `supabase/algos_seed.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Routing Foundation

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — db48ebc
- [x] 1.2 Build passes: `npm run build` — db48ebc

#### Manual

- [x] 1.3 Sign in → lands on `/dashboard` (not `/`) — db48ebc
- [x] 1.4 Navigate to `/sets/*` signed out → redirected to `/auth/signin` — db48ebc

### Phase 2: Dashboard — Sets List

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — 613256a
- [x] 2.2 Build passes: `npm run build` — 613256a

#### Manual

- [x] 2.3 Dashboard shows 3 set cards (F2L, OLL, PLL) — 613256a
- [x] 2.4 `?error=foo` in URL shows inline error banner — 613256a
- [x] 2.5 Topbar shows MemQ link, user email, sign-out — 613256a

### Phase 3: Set Detail Page — Algorithm List

#### Automated

- [x] 3.1 Lint passes: `npm run lint`
- [x] 3.2 Build passes: `npm run build`

#### Manual

- [x] 3.3 F2L set shows 41 algorithms in position order
- [x] 3.4 OLL set shows 57 algorithms in position order
- [x] 3.5 Nonexistent list id → redirect to `/dashboard?error=...`
- [x] 3.6 Valid set URL + `?error=Test` → inline banner renders (no redirect)
- [x] 3.7 "← Sets" back link works

### Phase 4: Algorithm Detail Page

#### Automated

- [ ] 4.1 Lint passes: `npm run lint`
- [ ] 4.2 Build passes: `npm run build`

#### Manual

- [ ] 4.3 Algorithm name renders as page heading
- [ ] 4.4 F2L Basic 1 shows 3 chips: `R`, `U`, `R'`
- [ ] 4.5 OLL 1 shows 9 chips with no stray parentheses
- [ ] 4.6 Disabled Practice button visible and greyed out
- [ ] 4.7 Back link navigates to parent set

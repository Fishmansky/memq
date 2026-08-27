# Home Page Rebrand Implementation Plan

## Overview

The site root (`/`) still renders the unmodified 10x Astro Starter landing page — hero headline "10x Astro Starter", a tagline about "a production-ready starter", and three feature cards describing Supabase auth, the Astro/React/Tailwind stack, and ESLint tooling. None of it mentions MemQ, Rubik's cubes, or algorithm memorization.

This change replaces that page with a MemQ landing page: a cube-memorization pitch, an auth-aware call to action, and a flat cube visual paired with a real algorithm from the app's own seeded content. The route stays public; no middleware, auth, or dashboard behavior changes.

## Current State Analysis

**The page today:**

- `src/pages/index.astro` — 8 lines. Wraps `<Welcome />` in `<Layout>`, passes no `title` prop.
- `src/components/Welcome.astro` — 126 lines. Structure: `bg-cosmic` full-height wrapper → three blurred "cosmic orb" divs → an inline-styled radial-gradient star field → `<Topbar />` → hero (h1 + tagline + Sign In / Sign Up buttons) → a 3-column feature-card grid. Every string in it is starter boilerplate. Its only consumer is `index.astro:2`.
- `src/layouts/Layout.astro:10` — `const { title = "10x Astro Starter" } = Astro.props;`. Because `index.astro` passes no title, the browser tab on the home page reads "10x Astro Starter".

**Constraints discovered:**

- `Astro.locals.user` is populated for every request by `src/middleware.ts:9-17`, including unprotected routes. `PROTECTED_ROUTES` is `["/dashboard", "/sets"]` — `/` is deliberately public and stays that way. So the landing page can branch on auth state with no routing change at all.
- `Topbar.astro` already branches on `Astro.locals.user`: signed-in users see their email plus a "MemQ" link to `/dashboard` and a sign-out form; anonymous users see Sign in / Sign up links. The hero CTA must not duplicate sign-out — `Topbar` owns it.
- The design vocabulary is fixed and in use across `AppLayout`, `SetCard`, `Topbar`, `MoveSequence`: `bg-cosmic` (a custom Tailwind utility defined at `src/styles/global.css:118-120`), glass panels as `rounded-xl border border-white/10 bg-white/5 backdrop-blur-xl`, purple-600 primary buttons, `text-blue-100/70` secondary text, purple-300 links.
- `src/components/app/MoveSequence.astro` renders a move string as glass notation chips — `interface Props { moves: string }`, strips `()`, splits on whitespace. It is the existing way this app displays notation and needs no changes.
- Per `context/foundation/lessons.md` ("Local `db reset` seeds 8 algorithms; the remote project has 127"), `supabase/seed.sql` is the only corpus loaded both locally and remotely. Its 8 two-look PLL rows are therefore the safe source for any algorithm quoted in UI copy.
- PRD non-goal (`context/foundation/prd.md`): "**No 3D cube visualization.** Practice sessions display move tokens (R, U, F'…) only. No animated or rendered cube." The landing visual must stay flat.

**No conflict with the PRD's access model.** `prd.md` Access Control states "Unauthenticated users cannot access any app content — login wall at root." A public landing page satisfies that as written: `/` serves no app content — no algorithm lists, no algorithms, no practice session, no user data, and no Supabase query. Its only affordances are links to `/auth/signin` and `/auth/signup`. The wall itself is `src/middleware.ts:19-24` (`PROTECTED_ROUTES` guarding `/dashboard` and `/sets`) plus the sign-in form at `/auth/signin`; the constraint is about content, not about making `/` a redirect. Nothing in this change weakens it, and no PRD edit is needed.

## Desired End State

Visiting `/` shows a MemQ landing page. The browser tab reads MemQ. Every reference to Astro, the starter, Supabase-as-a-feature, and developer tooling is gone from the page. The hero states what MemQ does — drill Rubik's cube algorithms from memory with immediate per-move feedback — and shows a flat 3x3 cube face in the six standard cube colors alongside a real algorithm from the app's seeded PLL set. An anonymous visitor sees Sign in / Sign up CTAs; a signed-in visitor sees a single CTA into `/dashboard` instead of a signup pitch.

Verify: `grep -ri --include='*.astro' "astro starter\|10x-astro" src/pages src/components src/layouts` returns nothing; `npm run lint`, `npm run typecheck`, and `npm run build` pass; the page renders correctly at mobile and desktop widths in both auth states.

### Key Discoveries:

- `src/components/Welcome.astro` has exactly one consumer (`src/pages/index.astro:2`) — it can be renamed and rewritten freely with no other call sites to update.
- `src/middleware.ts:9-17` sets `Astro.locals.user` on every route, so an auth-aware hero on a public page costs one conditional and zero routing changes.
- `src/components/app/MoveSequence.astro` is a ready-made notation renderer (`Props { moves: string }`) — reuse it rather than writing token markup.
- `src/layouts/Layout.astro:10` holds the stale default title; it leaks to any page not passing `title`, which today is only `index.astro`.
- `supabase/seed.sql:13` — `Ua-perm`, `M2 U M U2 M' U M2`. Seven tokens, present in both the local and remote corpora.
- No unit test and no Playwright spec currently touches `/` — none of `playwright/test/*.spec.ts` calls `goto("/")`. Nothing breaks, and nothing guards this page.

## What We're NOT Doing

- **Not changing routing or auth.** `/` stays public; `PROTECTED_ROUTES` in `src/middleware.ts` is untouched. No redirect on `/` in either auth state.
- **Not touching `/dashboard`** or any page under `/sets`, or any API route.
- **Not editing the PRD.** The public landing page is consistent with its access model (see Current State Analysis) — there is nothing to reconcile.
- **Not renaming `package.json`** (still `10x-astro-starter`) and not deleting `public/template.png`. Out of the landing page's blast radius; `README.md` still references the image.
- **No 3D or animated cube.** PRD non-goal. Flat CSS grid only.
- **No Playwright spec for `/`.** CI does not run the E2E suite (`.github/workflows` runs `npm test` only; see `README.md`), so an E2E spec would guard nothing automatically.
- **No Astro component-render test infrastructure.** No Container API test, no `getViteConfig` change, no per-file `environment: 'node'` override. The one new test (Phase 1, change 5) asserts on source text and renders nothing.
- **Not adding a feature-card grid, how-it-works steps, testimonials, or footer.** Hero-only page by decision.
- **Not changing `Topbar.astro`.** It already handles both auth states and owns sign-out.

## Implementation Approach

Two phases, each independently shippable.

Phase 1 makes the page *correct*: rename the component to `Landing.astro`, delete the feature-card grid, rewrite hero copy for MemQ, add the auth-aware CTA branch, and fix the stale default title. At the end of Phase 1 the page is honest MemQ content with no starter residue — shippable on its own, just visually plain.

Phase 2 makes the page *about the cube*: a flat 3x3 six-color face in the hero, with `MoveSequence` rendering a real seeded algorithm beside it, plus the accessibility treatment for both.

Both phases reuse the existing layout skeleton (`bg-cosmic`, the three orb divs, the star-field div, `<Topbar />`) rather than rebuilding it — that markup is already responsive and on-palette.

## Critical Implementation Details

**The cube face and the algorithm are intentionally unrelated.** Do not build a face depicting a specific OLL/PLL case and pair it with an algorithm, and do not label the visual as showing that algorithm's state. MemQ's audience is intermediate cubers who will notice that a pictured case and a quoted sequence don't correspond — a wrong pairing is a visible correctness bug, and a correct pairing means hand-verifying cube state in a marketing visual. A six-color scramble face reads unambiguously as "Rubik's cube" and makes no claim; the algorithm stands as its own adjacent element.

---

## Phase 1: Rebrand the landing page

### Overview

Remove every starter reference from `/` and replace it with MemQ content, including the auth-aware CTA and the browser tab title. No cube visual yet.

### Changes Required:

#### 1. Landing component

**File**: `src/components/Welcome.astro` → `src/components/Landing.astro` (rename)

**Intent**: The starter's "Welcome" component becomes MemQ's landing page. Rename it because the content is fully replaced and "Welcome" is starter naming; the rewrite is what justifies the rename, since no blame history is worth preserving. Keep the outer skeleton — `bg-cosmic` wrapper, the three orb divs, the star-field div, `<Topbar />`, and the centered hero container — and replace what's inside the hero. Delete the 3-column feature-card grid entirely (all three cards and their inline SVG icons).

**Contract**: No props (as today). Renders `<Topbar />` plus one hero section. Hero contains: an `h1` naming MemQ, a one-paragraph pitch, and a CTA row. Keep the existing gradient-text treatment on the `h1` (`bg-gradient-to-r from-blue-200 via-purple-200 to-pink-200 bg-clip-text text-transparent`) and the existing responsive type scale (`text-5xl sm:text-6xl lg:text-7xl`) — the palette and scale are established, only the words change.

Copy must convey: MemQ is for intermediate cube solvers memorizing OLL/PLL algorithm sets; you drill a sequence from memory move by move and every move is confirmed correct or marked wrong immediately; three clean runs of an algorithm marks it mastered. Draw from `context/foundation/prd.md` Vision & Business Logic — do not invent capabilities the app lacks (no timers, no scrambler, no sharing, no mobile app, no 3D cube).

#### 2. Auth-aware CTA

**File**: `src/components/Landing.astro`

**Intent**: A signed-in visitor currently gets pitched Sign In / Sign Up on `/`, a dead end whose only escape is the small "MemQ" link in `Topbar`. Branch the CTA row on auth state so signed-in visitors get a route into the app instead.

**Contract**: Read `const { user } = Astro.locals;` in the component frontmatter — the same access pattern as `src/components/Topbar.astro:2`. When `user` is truthy, render a single primary CTA to `/dashboard` (label along the lines of "Go to my sets"). When falsy, render the existing two buttons: primary to `/auth/signin`, secondary outline to `/auth/signup`. Reuse the current button classes verbatim (`bg-purple-600 … hover:bg-purple-500` primary; `border border-white/20 … hover:bg-white/10` secondary). Do not render a sign-out control — `Topbar` owns it.

#### 3. Page wiring and title

**File**: `src/pages/index.astro`

**Intent**: Point at the renamed component and pass an explicit page title so the home page no longer inherits the stale default.

**Contract**: Import `@/components/Landing.astro` (the `@/*` alias is mandatory per `AGENTS.md`) and pass a `title` prop to `<Layout>`. `Layout`'s `Props` already declares `title?: string`.

#### 4. Layout default title

**File**: `src/layouts/Layout.astro`

**Intent**: Replace the `"10x Astro Starter"` default so any future page that omits a title falls back to MemQ rather than to starter branding.

**Contract**: Line 10 — change the default value of the destructured `title` prop. Signature is unchanged (`title?: string`).

#### 5. Landing-page source guard

**File**: `src/components/Landing.test.ts` (new)

**Intent**: Nothing automated currently touches `/` — no unit test, and no Playwright spec calls `goto("/")`. Without a guard, a later edit could reintroduce starter copy or silently drop the auth branch and every check would still pass. This test pins the two regressions that are actually plausible here: starter text coming back, and one side of the CTA branch disappearing.

**Contract**: A plain Vitest test that reads the source of `src/components/Landing.astro`, `src/pages/index.astro`, and `src/layouts/Layout.astro` from disk with `node:fs` and asserts on their text. Deliberately renders nothing — no Astro Container API, no `.astro` import, so it needs no Vite plugin and no per-file environment override and runs under the existing jsdom suite as-is.

Assertions:

- No `/astro starter/i` and no `10x-astro` in any of the three files
- `Landing.astro` references `/auth/signin` and `/auth/signup` (the anonymous branch) and `/dashboard` (the signed-in branch)
- `index.astro` passes a `title` prop to `Layout` (guards the stale-tab-title regression)

Resolve paths from `import.meta.url`, not `process.cwd()`, so the test is independent of where Vitest is invoked. File must be named `*.test.ts` under `src/` to be picked up by `vitest.config.ts`'s `include: ["src/**/*.test.{ts,tsx}"]` — no new script and no second config, per `AGENTS.md`.

**Known limitation, state it in a comment**: these are string assertions on source text, not on rendered output. The test proves both branches exist; it does not prove each renders under the right `Astro.locals.user` value. A behavioral guard would need the Astro Container API with `renderToString(Landing, { locals })`, which requires `environment: 'node'` (Astro 6 forbids rendering `.astro` in a Vitest client environment) and the Astro Vite plugin that `vitest.config.ts` deliberately excludes. Out of scope here.

### Success Criteria:

#### Automated Verification:

- No starter references remain in app source: `grep -ri --include='*.astro' "astro starter\|10x-astro\|Modern Stack\|Developer Experience" src/pages src/components src/layouts` returns no matches
- Old component is gone and new one exists: `test ! -f src/components/Welcome.astro && test -f src/components/Landing.astro`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`
- Unit suite passes, including the new landing-page source guard: `npm test`

#### Manual Verification:

- `/` as an anonymous visitor shows MemQ hero copy with Sign in / Sign up CTAs; both links land on the right pages
- `/` as a signed-in visitor shows the single "Go to my sets" CTA linking to `/dashboard`, and no signup pitch
- Browser tab on `/` reads MemQ, not "10x Astro Starter"
- Hero copy claims nothing the app doesn't do (no timer, scrambler, sharing, mobile, or 3D cube)
- Layout holds at ~375px and at desktop width — no horizontal scroll, no clipped headline
- `/dashboard` and `/sets/*` are visually unchanged

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Cube visual and notation

### Overview

Give the hero its cube identity: a flat 3x3 face in the six standard cube colors, with a real seeded algorithm rendered beside it through the existing notation component.

### Changes Required:

#### 1. Cube face visual

**File**: `src/components/Landing.astro`

**Intent**: Add a flat 3x3 grid of colored tiles to the hero so the page reads as being about a Rubik's cube at a glance. Flat by constraint — the PRD rules out 3D and animated cube rendering.

**Contract**: A CSS-grid (or inline SVG) 3x3 block of square tiles using the six standard cube colors (white, yellow, red, orange, blue, green) in a mixed arrangement, sized to sit alongside or above the hero text without dominating it. Rounded tiles with a thin dark gutter, consistent with the app's `rounded`/`border-white/10` treatment. The tile colors are literal cube colors, so they will not come from the cosmic palette — contain them inside one bordered glass panel so the saturated block reads as a deliberate object against the dark background rather than as a palette break. Purely decorative: `aria-hidden="true"`, no text alternative. Depicts no specific case (see Critical Implementation Details).

#### 2. Algorithm sample

**File**: `src/components/Landing.astro`

**Intent**: Show a real algorithm the app actually ships, so the notation on the landing page matches what a learner meets in a practice session.

**Contract**: Import `@/components/app/MoveSequence.astro` and render it with `moves="M2 U M U2 M' U M2"` — `Ua-perm` from `supabase/seed.sql:13`, chosen because `seed.sql` is the one corpus present both locally and in the remote project (`context/foundation/lessons.md`). Label it with the algorithm name as visible text so the chip row is not a bare, unexplained sequence. `MoveSequence` needs no changes; it already strips parens, splits on whitespace, and styles chips.

### Success Criteria:

#### Automated Verification:

- Notation renders through the shared component, not new markup: `grep -q "MoveSequence" src/components/Landing.astro`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`
- Existing unit suite still passes: `npm test`

#### Manual Verification:

- The 3x3 cube face renders as nine aligned square tiles at mobile and desktop widths — no squashed or overflowing tiles
- The notation chips read `M2 U M U2 M' U M2` — seven chips, prime rendered correctly
- The cube face and hero text coexist without crowding at ~375px (stacked) and at desktop width
- Saturated cube colors read as a contained object, not as a palette clash against `bg-cosmic`
- The cube grid is skipped by a screen reader while the algorithm name and its notation are announced
- Both auth states from Phase 1 still render correctly with the visual added

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

The page has no data access, no state, and no business logic beyond a single auth-state conditional, so its real risk is visual — which only human review catches. Automated coverage is therefore deliberately narrow: one source-assertion test that pins the regressions a human reviewer would plausibly miss on a later edit, and the existing suites as evidence nothing else broke.

### Unit Tests:

- `src/components/Landing.test.ts` (new, Phase 1) — reads the source of `Landing.astro`, `index.astro`, and `Layout.astro` and asserts: no starter strings; both `/auth/signin` + `/auth/signup` and `/dashboard` present in `Landing.astro`; `index.astro` passes a `title`. Runs in the existing jsdom suite under `npm test`, which CI runs.
- Key edge case it does *not* cover: whether each CTA branch renders under the correct `Astro.locals.user` value. That is a rendered-output assertion, covered by manual verification instead.
- No other unit tests added.

### Integration Tests:

- None added and none run. The landing page makes no Supabase query.

### Manual Testing Steps:

1. `npm run dev`, open `/` signed out — confirm MemQ hero copy, Sign in and Sign up CTAs, correct browser tab title, and no Astro or starter references anywhere on the page.
2. Sign in, return to `/` — confirm the CTA row is a single "Go to my sets" link to `/dashboard` and no signup pitch appears.
3. Narrow the viewport to ~375px — confirm no horizontal scroll, the headline is not clipped, and the cube face and hero text stack cleanly.
4. Confirm the cube face shows nine aligned tiles in cube colors and the notation row reads `M2 U M U2 M' U M2`.
5. Run a screen reader or inspect the accessibility tree — the decorative cube grid is skipped; the algorithm name and notation are announced.
6. Visit `/dashboard` and one `/sets/:id` page — confirm both are visually unchanged.

## Performance Considerations

The page loses markup (the three feature cards and their inline SVGs) and gains a small CSS grid. `MoveSequence` is a server-rendered Astro component with no client JS. No React island, no client-side JavaScript, and no data fetch is introduced — the landing page stays a static server render.

## Migration Notes

None. No schema change, no data change, no stored state, and no URL change. Reverting is a single git revert of the two phase commits.

## References

- PRD (vision, business logic, non-goals): `context/foundation/prd.md`
- Seed corpus constraint: `context/foundation/lessons.md` — "Local `db reset` seeds 8 algorithms; the remote project has 127"
- Component being replaced: `src/components/Welcome.astro:1-126`
- Auth state source: `src/middleware.ts:9-17`
- Auth-state access pattern to mirror: `src/components/Topbar.astro:2`
- Notation renderer being reused: `src/components/app/MoveSequence.astro`
- Design vocabulary in use: `src/styles/global.css:118-120` (`bg-cosmic`), `src/components/app/SetCard.astro`
- Algorithm quoted in the hero: `supabase/seed.sql:13` (`Ua-perm`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Rebrand the landing page

#### Automated

- [x] 1.1 No starter references remain in app source — 802f68d
- [x] 1.2 Old component is gone and new one exists — 802f68d
- [x] 1.3 Type checking passes: `npm run typecheck` — 802f68d
- [x] 1.4 Linting passes: `npm run lint` — 802f68d
- [x] 1.5 Production build succeeds: `npm run build` — 802f68d
- [x] 1.6 Unit suite passes, including the new landing-page source guard: `npm test` — 802f68d

#### Manual

- [x] 1.7 Anonymous `/` shows MemQ hero copy with working Sign in / Sign up CTAs — 802f68d
- [x] 1.8 Signed-in `/` shows the single "Go to my sets" CTA to `/dashboard` — 802f68d
- [x] 1.9 Browser tab on `/` reads MemQ — 802f68d
- [x] 1.10 Hero copy claims nothing the app doesn't do — 802f68d
- [x] 1.11 Layout holds at ~375px and at desktop width — 802f68d
- [x] 1.12 `/dashboard` and `/sets/*` are visually unchanged — 802f68d

### Phase 2: Cube visual and notation

#### Automated

- [x] 2.1 Notation renders through the shared `MoveSequence` component — 2010bcf
- [x] 2.2 Type checking passes: `npm run typecheck` — 2010bcf
- [x] 2.3 Linting passes: `npm run lint` — 2010bcf
- [x] 2.4 Production build succeeds: `npm run build` — 2010bcf
- [x] 2.5 Existing unit suite still passes: `npm test` — 2010bcf

#### Manual

- [x] 2.6 Cube face renders as nine aligned tiles at mobile and desktop widths — 2010bcf
- [x] 2.7 Notation chips read `M2 U M U2 M' U M2` with the prime rendered correctly — 2010bcf
- [x] 2.8 Cube face and hero text coexist without crowding at ~375px and desktop — 2010bcf
- [x] 2.9 Cube colors read as a contained object, not a palette clash — 2010bcf
- [x] 2.10 Cube grid is skipped by a screen reader; algorithm name and notation are announced — 2010bcf
- [x] 2.11 Both auth states still render correctly with the visual added — 2010bcf

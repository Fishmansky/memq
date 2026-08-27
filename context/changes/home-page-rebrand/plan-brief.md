# Home Page Rebrand — Plan Brief

> Full plan: `context/changes/home-page-rebrand/plan.md`

## What & Why

The site root still serves the unmodified 10x Astro Starter landing page — headline "10x Astro Starter", a pitch about a production-ready starter, and three feature cards about Supabase auth, the Astro/React/Tailwind stack, and ESLint. A visitor to MemQ has no way to learn what MemQ is. This change replaces that page with a MemQ landing page about Rubik's cube algorithm memorization.

## Starting Point

`src/pages/index.astro` (8 lines) renders `src/components/Welcome.astro` (126 lines of pure starter boilerplate) inside `Layout`, passing no `title` — so the browser tab reads "10x Astro Starter" too, from the default at `src/layouts/Layout.astro:10`. `Welcome.astro` has exactly one consumer, so it can be rewritten freely.

## Desired End State

`/` shows a MemQ hero: what the app does (drill cube algorithms from memory, every move confirmed or marked wrong immediately, three clean runs marks mastery), a flat 3x3 cube face in the six standard cube colors, and a real algorithm from the app's seeded PLL set. Anonymous visitors get Sign in / Sign up; signed-in visitors get one CTA into `/dashboard` instead of a signup pitch. The browser tab reads MemQ. No Astro or starter reference survives on the page.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Root route | Stays public, no middleware change | `/` serves no app content, so the PRD's login wall is unaffected; the wall stays `PROTECTED_ROUTES` + `/auth/signin` |
| Signed-in visitor | Hero CTA swaps to "Go to my sets" | Removes the dead end where a signed-in user gets pitched a signup; ~5 lines, no routing change |
| Cube visual | Flat 3x3 CSS/SVG face + notation tokens | Reads instantly as a Rubik's cube; PRD non-goal rules out 3D and animated cube rendering |
| Face vs. algorithm | Deliberately unrelated | A pictured OLL/PLL case paired with a non-matching sequence is a visible bug to intermediate cubers; a six-color scramble claims nothing |
| Sections | Hero only — feature-card grid deleted | Least content to keep accurate; the cube visual carries the page |
| Branding cleanup | `Layout.astro` default title only | The tab is the one stale string a visitor sees; `package.json` name and `public/template.png` stay out of the blast radius |
| Component name | `Welcome.astro` → `Landing.astro` | Content is 100 % rewritten and there is one call site |
| Notation rendering | Reuse `MoveSequence.astro` | Existing `Props { moves: string }` component already renders glass notation chips |
| Algorithm shown | `Ua-perm`, `M2 U M U2 M' U M2` (`supabase/seed.sql:13`) | `seed.sql` is the only corpus present both locally and remotely (`lessons.md`) |
| Verification | Lint + typecheck + build + manual review, plus one source-assertion test | The page's risk is visual, but `/` had no automated guard at all; a source test catches returning starter copy or a dropped CTA branch |
| Guard depth | Source-text assertions, not rendered output | Rendering `.astro` in Vitest needs `environment: 'node'` (Astro 6) plus the Vite plugin `vitest.config.ts` deliberately excludes; Playwright would not run in CI |

## Scope

**In scope:** rewrite the landing component (rename to `Landing.astro`); delete the 3-card feature grid; MemQ hero copy; auth-aware CTA via `Astro.locals.user`; flat cube face; `MoveSequence` with a seeded algorithm; `Layout.astro` default title; a source-assertion Vitest guard for the landing page.

**Out of scope:** routing/auth changes (`PROTECTED_ROUTES` untouched); `/dashboard`, `/sets/*`, and all API routes; `package.json` rename; `public/template.png`; 3D or animated cube; a Playwright spec for `/` (CI does not run E2E); Astro Container API / component-render test infrastructure; `Topbar.astro`.

## Architecture / Approach

Server-rendered Astro page, no client JS added. `index.astro` → `Layout` (title) → `Landing.astro`, which keeps the proven skeleton from `Welcome.astro` (`bg-cosmic` wrapper, three blurred orb divs, star-field div, `<Topbar />`) and replaces the hero contents. `Landing.astro` reads `Astro.locals.user` — already set for every route by `src/middleware.ts:9-17` — for the CTA branch, and delegates notation to `src/components/app/MoveSequence.astro`. All styling comes from the vocabulary already in `SetCard`/`Topbar`/`AppLayout`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Rebrand the landing page | Starter content gone; MemQ hero copy, auth-aware CTA, correct tab title, source-assertion guard. Shippable alone, just visually plain | Copy overclaims — promising a timer, scrambler, sharing, or mobile app the PRD lists as non-goals |
| 2. Cube visual and notation | Flat 3x3 six-color cube face + `Ua-perm` notation chips, with a11y treatment | Saturated cube colors clashing with the purple/blue cosmic palette; tile alignment at ~375px |

**Prerequisites:** none — no schema, data, env var, or dependency needed. Local dev server plus one confirmed account to check the signed-in CTA.
**Estimated effort:** ~1 session, 2 small commits.

## Open Risks & Assumptions

- Cube colors are literal, so they sit outside the cosmic palette by necessity. Containing them in one bordered glass panel is the mitigation; may need visual iteration.
- The new guard asserts on source text, so it proves both CTA branches exist but not that each renders under the right `Astro.locals.user` value. A branch wired to an inverted condition would still pass.
- Hero copy is the main correctness surface: the PRD non-goals list (no 3D cube, no sharing, no mobile, no offline) is easy to violate with ordinary marketing language.

## Success Criteria (Summary)

- A first-time visitor to `/` can tell what MemQ does without signing in.
- A signed-in visitor gets a route into the app, not a signup pitch.
- No reference to Astro, the starter, or generic developer tooling remains on the page or in its browser tab.

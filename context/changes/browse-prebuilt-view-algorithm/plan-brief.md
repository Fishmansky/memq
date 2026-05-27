# Browse Pre-built Algorithm Sets + View Algorithm — Plan Brief

> Full plan: `context/changes/browse-prebuilt-view-algorithm/plan.md`

## What & Why

Implements S-01: the first user-facing slice of MemQ. Users sign in and immediately see the 3 pre-built algorithm sets (F2L, OLL, PLL), browse algorithms within any set, and open one to read its move sequence as individual token chips. This is the prerequisite for S-02 (the north star practice loop) — nothing else in Stream A ships until this is done.

## Starting Point

The dashboard is a placeholder stub (email + sign-out only). Sign-in redirects to `/` (the marketing landing). No domain pages exist. The Supabase schema is complete and the seed SQL is already applied to production — data is there, UI is not.

## Desired End State

After sign-in, the user lands on `/dashboard` showing 3 set cards. One click → algorithms list sorted by position. Another click → algorithm detail with move tokens as chips and a greyed-out "Practice (coming soon)" button. Full auth protection, error redirects, and back-navigation across all 3 pages.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Dashboard role | Dashboard = sets list | Satisfies "2 clicks from sign-in" with 0 extra clicks | Plan |
| Algorithm detail UI | Separate full page `/sets/[id]/[algoId]` | Consistent with Astro server-render pattern; clean URL for S-02 to link to | Plan |
| Move display | Token chips (split on spaces, strip parens) | Scannable for long OLL sequences; 1-line parser, no edge cases | Plan |
| Large-list UX | Flat list sorted by position | Max 57 items — pagination is overkill | Plan |
| Error handling | Query errors → inline banner (keep context); 404 → redirect to parent page with `?error` | Preserves user context on transient failures; only redirects when there's nothing to show | Plan |
| Practice CTA | Disabled button with "coming soon" label | Pre-wires S-02 entry point without broken links | Plan |
| Top nav | MemQ home-link + sign-out in topbar | Minimal; extends existing Topbar pattern | Plan |

## Scope

**In scope:** Post-auth redirect fix, middleware `/sets` protection, `AppLayout` shared chrome, dashboard (sets grid), `/sets/[id]` (algorithm list), `/sets/[id]/[algoId]` (detail + move chips + disabled Practice), error states.

**Out of scope:** Move validation, search/filter, pagination, subgroup labels within OLL, custom lists (S-04), practice functionality (S-02), per-algorithm mastery display.

## Architecture / Approach

4 server-rendered Astro pages + 4 new components. All data fetching via typed Supabase server client (`createClient(headers, cookies)`). New `AppLayout.astro` wraps `Layout.astro` and adds app chrome. Error handling follows the redirect-with-query-param pattern from `signin.ts`. No React components — all static server render.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Routing Foundation | Sign-in redirect + middleware + AppLayout | None — only 3 files touched |
| 2. Dashboard — Sets List | Supabase query + 3 set cards | Supabase env not configured locally → null client |
| 3. Set Detail Page | Algorithm list for any set | Nonexistent ID must not 500 |
| 4. Algorithm Detail Page | Move chips + disabled Practice | Parser edge cases in move strings |

**Prerequisites:** F-01 (domain-schema-rls) complete, seed applied to production DB.
**Estimated effort:** ~1-2 sessions across 4 phases.

## Open Risks & Assumptions

- Local Supabase must be running (or `.dev.vars` pointing to cloud project) for manual verification
- Seed already applied to production DB; local dev needs `supabase start` + seed run
- Move string format assumed consistent with seed (`(R U R' U')` notation) — no schema validation

## Success Criteria (Summary)

- Sign in → dashboard shows 3 pre-built set cards (F2L, OLL, PLL)
- F2L Basic 1 detail page shows 3 move chips: `R`, `U`, `R'`
- Navigating `/sets/*` while signed out redirects to `/auth/signin`

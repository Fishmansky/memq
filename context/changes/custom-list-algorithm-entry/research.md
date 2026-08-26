---
date: 2026-08-25T16:25:57+02:00
researcher: pawel.rybczynski@redge.media
git_commit: 102229229569ac6f9cd66f469aeef7ac13fb664c
branch: master
repository: memq
topic: "Custom algorithm lists — user-created lists, algorithm entry, and FR-015 duplicate detection"
tags: [research, codebase, algorithm-lists, algorithms, rls, duplicate-detection, move-notation, forms, S-04]
status: complete
last_updated: 2026-08-25
last_updated_by: pawel.rybczynski@redge.media
---

# Research: Custom algorithm lists — creation, algorithm entry, duplicate detection

**Date**: 2026-08-25T16:25:57+02:00
**Researcher**: pawel.rybczynski@redge.media
**Git Commit**: `102229229569ac6f9cd66f469aeef7ac13fb664c`
**Branch**: `master`
**Repository**: memq

> Note: `HEAD` is not pushed to `origin/master` at time of writing, so this document uses local `file:line` references rather than GitHub permalinks.

## Research Question

"We need to allow user to create his own, custom algorithms and store them on his own, private list of algorithms" — roadmap slice **S-04 `custom-list-algorithm-entry`** (PRD FR-004, FR-005, FR-015).

Scope confirmed with the user before research: full data-model dive on the FR-015 "add the existing algorithm" gap, plus UI/route patterns, API/validation/auth conventions, move notation & parsing, and testing + historical context.

## Summary

**The backend is already built; the write path is entirely missing.** F-01 shipped `algorithm_lists` + `algorithms` with a complete set of RLS policies that already model "user creates a private list and owns its algorithms" — including `al_insert`, `alg_insert`, and the `is_system=false AND user_id=auth.uid()` ownership gate. None of it is exercised by a single line of application code. There is no `INSERT` against either table anywhere in `src/` (`src/lib/practice/completePractice.ts` is the only file in the app that writes to the DB at all, and it writes `practice_sessions`/`algorithm_mastery`).

Five findings dominate what the plan must decide:

1. **FR-015 has no data model.** `algorithms.list_id` is `NOT NULL` and single-valued (`supabase/migrations/20260527000000_domain_schema_rls.sql:22`) — an algorithm belongs to exactly one list. "Let the learner add the *existing* algorithm to their list" therefore cannot be represented today. Four options analyzed in detail below; each trades schema disruption against whether practice streaks carry over.
2. **Free-form notation input is the highest-risk part of this slice, and the risk is already proven.** There is *no* runtime validation of a `moves` string at any layer — no CHECK constraint, no client validator, no server validator. The one guard that exists (`src/test/tokenGrammar.ts` + `src/test/seedTokens.test.ts`) is a test that parses SQL seed files as text, not a reusable runtime validator. A malformed token silently freezes the practice loop with no error — this exact failure reached production and required a manual DB repair (`supabase/fixes/2026-08-24-rotation-notation.sql`). S-04 is the feature that hands this input surface to users.
3. **Exact-match duplicate detection works correctly under RLS, but is fragile on formatting.** `alg_select` returns precisely "pre-built OR in any of the caller's lists" — exactly FR-015's wording, no more, no less. The prepared btree index is the right index. But comparison is byte-for-byte on raw `TEXT` with zero normalization, so a typographic apostrophe or a double space is a silent false negative.
4. **One line makes custom lists invisible.** `src/pages/dashboard.astro:18` hardcodes `.eq("is_system", true)`. `src/pages/sets/[id].astro` has *no* `is_system` filter and already renders a user-owned list correctly under RLS — so most of the browse surface is reusable as-is.
5. **This is the first feature to create user-owned rows,** which makes it the first real exercise of test-plan **risk #2 (cross-user data access)** — and the two-account integration harness that would prove it does not exist yet.

## Detailed Findings

### 1. Data model — the FR-015 gap

FR-015 (`context/foundation/prd.md:105`): *"When a learner inputs a move sequence that exactly matches an existing algorithm (pre-built or in any of their lists), the app proposes the existing algorithm and lets the learner add it to their list instead of creating a duplicate."*

The blocking fact: `algorithms.list_id uuid NOT NULL REFERENCES algorithm_lists(id) ON DELETE CASCADE` (`supabase/migrations/20260527000000_domain_schema_rls.sql:22`). One row = one list membership, by construction. The domain docs record this as invariant **D4** — "An algorithm belongs to exactly one list" — status *enforces* (`context/domain/01-domain-distillation.md`).

There is **no existing user data** to migrate: FR-004/FR-005 have never been implemented, so every option below is greenfield rather than a retrofit.

| | **A — copy the row** | **B — `list_items` junction** | **C — detect + link only** | **D2 — copy + `source_algorithm_id`** |
|---|---|---|---|---|
| Migration | none | new table, backfill, `DROP COLUMN list_id`, regen types | none | one additive nullable FK column |
| RLS changes | none | rewrite `alg_*` (4 policies) + 3 new `list_items` policies | none | none |
| Streak carries over | **no — forks** | **yes, free** | yes (no new row) | only if mastery lookups are rewritten |
| Read paths broken | none | `sets/[id].astro:29-34`, `sets/[id]/[algoId].astro:23-27` | none | none |
| Delete hazard | per-row, safe | **cross-user cascade** — deleting a shared catalog row wipes every user's history | none | per-row, safe |
| Atomicity | single INSERT | two inserts → wants an RPC (a pattern this repo has never used) | n/a | single INSERT |
| Effort / risk | small / low | medium-large / high | small / lowest | small-medium / low |
| FR-015 conformance | full | full | **under-delivers** — never "adds to their list" | full |

Detail worth carrying into planning:

- **Option A's real cost is user-visible.** The copy gets a new `id`; `algorithm_mastery` is keyed `UNIQUE (user_id, algorithm_id)` (`...rls.sql:51`). A learner sitting at 2-of-3 clean runs on the pre-built T-perm drops to 0/3 the moment they "add" it to their list — which reads as a bug against FR-015's "propose the existing algorithm" phrasing. Nothing in FR-013/FR-015 states whether progress should transfer; this is a genuine product ambiguity the plan should settle rather than resolve by omission.
- **Option B's payoff is exactly that carryover**, for free — shared `algorithm_id` means `algorithm_mastery`'s existing unique key already collapses to one streak per user per canonical algorithm, and `completePractice.ts` needs no change at all (it keys only on `algorithm_id`, never `list_id`).
- **Option B's hazards are real.** `algorithms → practice_sessions / algorithm_mastery ON DELETE CASCADE` (`...rls.sql:35,47`) becomes a cross-user destructive surface once rows are shared: deleting one catalog row wipes practice history for *every* user who practiced it. The current `alg_delete` policy shape (`...rls.sql:119-128`) cannot express "only if no other list references this". Also, `alg_update`/`alg_delete` become semantically ambiguous (fork-on-edit vs mutate-for-everyone), and creating a custom algorithm becomes two inserts that supabase-js cannot make atomic — pushing toward a `SECURITY DEFINER` RPC. A half-committed orphan `algorithms` row with no `list_items` back-reference is invisible garbage, which is a strictly worse non-atomic failure than the already-accepted streak race in `completePractice.ts:31-44`.
- **Option C under-delivers the FR as written** — it surfaces and links to the existing algorithm but creates no membership record, so "lets the learner add it to their list" is not implemented. Viable only with explicit product sign-off to reinterpret the acceptance criterion.
- **Option D1** (nullable `list_id` + phased migration to `list_items`) buys a transition safety net that has no payoff here — with zero user data, if B is chosen it should be one migration, not two.

**Sub-agent's recommendation (its opinion, not a decision):** Option A plus the D2 `source_algorithm_id` refinement, treating mastery carryover as an explicit follow-up. Strongest argument for: zero RLS rewrite, zero read-path changes, doesn't disturb the one-row-one-list invariant every existing policy was built around. Strongest argument against: it silently forks streaks, which is precisely the continuity a user expects from "this is the same algorithm."

### 2. Duplicate detection — query, index, and the normalization gap

- **The index is right.** `CREATE INDEX algorithms_moves_idx ON public.algorithms (moves)` (`...rls.sql:29`) — a plain btree is exactly correct for `WHERE moves = $1`; no trigram/GIN needed for exact equality. (Nit: the migration comment at `:28` claims "O(1)"; a btree lookup is O(log n). Harmless, but the comment overstates.)
- **RLS scoping is exactly FR-015.** Walking `alg_select` (`...rls.sql:79-87`): each row matching `moves = $1` additionally requires its owning list to be `is_system = true` **or** `user_id = auth.uid()`. So the result set is precisely "pre-built or in any of their lists" — it never leaks another user's private rows, and it is not narrowed by any `list_id` filter. No over- or under-inclusion. This holds for options A/C/D2 with no change; under B the equivalent join must be re-derived deliberately to preserve the property.
- **The normalization gap is the weak point, and no schema option fixes it.** `moves` is plain `TEXT` (`...rls.sql:24`) compared byte-for-byte. There is no trim, whitespace-collapse, case-fold, or quote-normalization anywhere in the codebase. A learner pasting `M2 U M U2 M’ U M2` with a typographic U+2019 apostrophe instead of the seeded ASCII `'`, or with a double space or trailing space, produces a **silent false negative** — the duplicate is missed, a new row is created, FR-015 quietly fails. Fixing it requires identical normalization applied at both write time and comparison time, or a normalized generated column / functional index if the raw text must stay display-verbatim.
- **The open roadmap question is still open** (`context/foundation/roadmap.md:125`): does "exactly matches" mean literal string equality (`R` ≠ `R1`, `F'` ≠ `f'`) or notation-normalized comparison? Owner: user. Block: no. The domain docs argue that once a `MoveSequence.canonical()` exists the question becomes trivial (`context/domain/01-domain-distillation.md:174`).
- **UNIQUE constraint scope:** none exists today. Global `UNIQUE(moves)` is *incompatible* with option A by construction (copies are the point). `UNIQUE(list_id, moves)` is a reasonable DB-level backstop behind the app-level check under A/D2. Per-user is not directly expressible (`algorithms` has no `user_id`; it's reached via `list_id`). Under B, global `UNIQUE(moves)` is coherent but forces seed/admin workflows to become find-or-create.
- **Check-then-insert is a TOCTOU race.** Two concurrent submissions of the same sequence can both pass the duplicate check and both insert. Same shape as the lost-update race already documented and accepted in `completePractice.ts:31-44` (archive lesson from `practice-session-core-loop`). Worth a deliberate decision rather than an accident.

### 3. Move notation — no validator, no normalizer, and a proven production failure

- **Vocabulary is defined in two places, neither canonical.** `KEY_TO_MOVE` (`src/components/app/PracticeSession.tsx:8-35`) maps keys to `R U F L B D`, rotations `x y z`, slices `M E S`, each with a prime variant, plus two sentinel modifier keys (`w` = wide → lowercases, `2` = double → appends `"2"`). The three on-screen grids `SIDE_GRID`/`CENTRAL_GRID`/`ROTATION_GRID` (`PracticeSession.tsx:54-99`) hard-code the same set again as literal cells.
- **`src/test/tokenGrammar.ts:1-31` derives the producible set** — `{base, base+"2", lower(base), lower(base)+"2"}`. Because `"2"` is always appended last, a token like `R2'` is **unreachable** by any input path. Wide moves are lowercase single letters (`r`, `u`, `f`…), never `Rw`.
- **The parser is duplicated verbatim**: `parseMoves` (`PracticeSession.tsx:216-218`) and an inline copy in `MoveSequence.astro:7` — both `moves.replace(/[()]/g, "").split(" ").filter(Boolean)`. Splits on a *literal single space*, not `/\s+/`, so a tab or newline separator would glue tokens together. Double spaces collapse fine (empty strings filtered).
- **Zero validation at every layer**: no CHECK on `moves text NOT NULL` (`...rls.sql:24`), no client validator, no server validator (no algorithm-creation endpoint exists at all). The only "validation" is at practice time — `action.move === expected` (`PracticeSession.tsx:149`), strict equality, no normalization. An out-of-grammar token means the slot never advances, no error is shown, and the session hangs forever.
- **This already happened in production.** 7 seeded rows stored `R2'`/`U2'`; every practice session on them froze silently. Fixed in three legs: corrected `algos_seed.sql`, a hand-run corrective `supabase/fixes/2026-08-24-rotation-notation.sql` (deliberately *not* a migration — DDL-only convention, and re-running the seed would duplicate rows since `algorithms` has no unique constraint), and a static regression guard `src/test/seedTokens.test.ts`. Full history in `context/archive/2026-08-24-rotation-notation-fix/`.
- **Stored format conventions** (verbatim from `supabase/algos_seed.sql`, `supabase/seed.sql`): single ASCII space separator; ASCII `'` only (grep confirms zero smart quotes); parentheses used purely as visual grouping and stripped by the parser; uppercase for faces/slices, lowercase reserved for wide moves; `R2`/`M2` with the digit adjacent; no leading/trailing or double spaces. Examples: `R U R'`, `(R U2 R' U') (R U R')`, `M U (R U R' U') M2 (U R U' r')`, `M2 U M2 U2 M2 U M2`.
- **Seeding asymmetry worth knowing:** `supabase/config.toml:65` sets `sql_paths = ["./seed.sql"]` — only the 8-row PLL `seed.sql` is auto-loaded on `db reset`. The 119-algorithm `algos_seed.sql` is not, and carries a warning that manual re-runs duplicate rows.

### 4. UI, routes, and the pages to extend

- **Routes today:** `/` (public landing), `/auth/*`, `/dashboard`, `/sets/[id]`, `/sets/[id]/[algoId]`. There is **no `src/pages/sets/index.astro`** — `/dashboard` *is* the sets index.
- **`src/pages/dashboard.astro:14-19` is the single blocking line:** `.select("id, name").eq("is_system", true).order("created_at")`. Custom lists would be invisible even if created.
- **`src/pages/sets/[id].astro` needs nothing.** It queries the list by id with **no `is_system` filter** (`:19-23`) and its algorithms by `list_id` ordered by `position` (`:29-33`); RLS already scopes both correctly for a user-owned list. Same for `/sets/[id]/[algoId]`. The browse-and-practice surface for custom lists is effectively free.
- **Data-fetch idiom** (identical on all three pages): `createClient(Astro.request.headers, Astro.cookies)`, null-guard the client, destructure `{ data, error }`, never throw. Query errors → inline banner on the current page; not-found → `Astro.redirect` with `?error=` + `encodeURIComponent`. This split was established deliberately in `browse-prebuilt-view-algorithm/plan.md:51`.
- **Astro/React boundary:** Astro owns routing, server fetch, auth guards, static markup; React owns state/handlers/fetch. Islands are per interactive unit, always `client:load` (only 3 usages app-wide). React components never touch Supabase — they call the app's own `/api/*` routes.
- **Form precedent is auth-only and native-POST.** `SignUpForm.tsx:66` is a real `<form method="POST" action="/api/auth/signup">`; React intercepts submit only to run a synchronous client-side `validate()` (`SignUpForm.tsx:22-45`), then lets the native POST through. Field errors live in local `useState`, render under the input via `FormField.tsx:58-65`, and clear per-field on keystroke. Loading state uses React 19's `useFormStatus()` inside `SubmitButton.tsx:12` — which only works because the button is a descendant of a real form. Server errors round-trip through the `?error=` query param into `ServerError.tsx`.
- **The other precedent is `fetch()` + JSON** (`PracticeSession.tsx:322-339` → `/api/practice/complete`), with structured JSON errors and explicit status codes. This is the pattern for anything called from client JS rather than a native form post.
- **Reusable primitives are thin.** Only `src/components/ui/button.tsx` exists from shadcn (configured, `new-york`, lucide icons — but no `Card`, `Input`, `Dialog`, `Form`, `Label` generated). `FormField`/`SubmitButton`/`ServerError`/`PasswordToggle` live under `src/components/auth/` and are imported nowhere else. **No modal/dialog component exists** — relevant, since the FR-015 "we found an existing algorithm, add it instead?" prompt is dialog-shaped. **No toast system** either.
- **The error banner is copy-pasted verbatim three times** (`dashboard.astro:33-37`, `sets/[id].astro:47-51`, `sets/[id]/[algoId].astro:60-64`) — and auth uses a *different* visual style (`ServerError.tsx`). Adding more pages should extract rather than add a fourth copy.
- **Topbar has no nav structure** — a single hardcoded `MemQ → /dashboard` link (`Topbar.astro:13-15`). A "My Lists" entry means extending that into a small nav, not slotting into an existing component.
- **Styling:** Tailwind v4 CSS-first, no `tailwind.config.js`. shadcn tokens are defined in `src/styles/global.css:6-111` but the actual app UI ignores them and hand-writes literal utility strings (`rounded-xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl`) copy-pasted across cards. Custom `@utility bg-cosmic` (`global.css:113-115`) is the signature background. `cn()` at `src/lib/utils.ts:4-6` for React; `.astro` files use `class:list`.

### 5. API, validation, and auth conventions

- **One JSON API route exists.** `src/pages/api/practice/complete.ts`: `POST` only; auth via `context.locals.user` → `401` if absent (`:6-12`); `request.json()` in try/catch → `400 "Invalid body"` (`:14-22`); **hand-rolled `typeof` validation** (`:24-41`); client via `createClient(...)` → `500 "Supabase not configured"` if null (`:43-49`); delegates all logic to `completePractice()` and maps `{status, body}` onto the `Response` (`:51-56`).
- **No `prerender` export anywhere** — `output: "server"` in `astro.config.mjs:11` makes every route SSR by default.
- **Auth routes are form-encoded and weaker:** `request.formData()` + `form.get("email") as string` with no runtime check, then `context.redirect` with the raw provider `error.message` URL-encoded into a query param. That raw-message forwarding was flagged as an info-disclosure smell in a prior review.
- **Zod is not a dependency.** Confirmed against `package.json` — no zod, yup, valibot, or ajv. All validation is hand-rolled `typeof` guards. **No shared error-response helper** either; `new Response(JSON.stringify({error}), {status, headers})` is duplicated per branch, 5 times in one file.
- **Middleware** (`src/middleware.ts`): builds the client, sets `context.locals.user`, and prefix-matches `PROTECTED_ROUTES = ["/dashboard", "/sets"]` via `startsWith` → redirect to `/auth/signin`. **`/api/*` is not covered** — `complete.ts` gates itself. Any new `/api/lists/...` route must do its own `locals.user` check.
- **`App.Locals` holds only `user`** (`src/env.d.ts`) — no Supabase client on locals; every page and route builds its own per request.
- **Env**: `SUPABASE_URL`/`SUPABASE_KEY` are both `optional: true` in the `astro:env` schema (`astro.config.mjs:20-25`), which is why `createClient()` can return `null` and every call site must null-check.
- **Types**: no `src/types.ts`, no DTO layer. Pages declare narrow inline shapes matching their `.select()` projection (`dashboard.astro:10`, `sets/[id].astro:14-15`) rather than using the generated `Tables<>`/`TablesInsert<>` helpers — only `completePractice.ts:13` imports `Database` (to type the client, not rows). **A create path would be the first to use `TablesInsert<"algorithm_lists">` explicitly.** Note `algorithms.Insert` requires `position: number` (non-optional, `src/db/database.types.ts:91`) — the caller must compute it.
- **All existing writes rely on RLS for authorization**, not app-level ownership checks — `completePractice.ts` never verifies the `algorithmId` belongs to a visible list.
- **Cloudflare**: `@astrojs/cloudflare` adapter, `nodejs_compat` flag (`wrangler.jsonc:6`), an unused `SESSION` KV binding. Workers runtime constraints apply (no native modules, no filesystem).

### 6. Testing conventions and quality gates

- **Test-plan risk #2 — cross-user data access** (`context/foundation/test-plan.md:42`) is the risk this slice activates: S-04 creates the first user-owned rows. Its protection row (`:61`) transfers directly: *"User A cannot read or write user B's rows via the API or a direct query"*; must challenge *"Logged-in means authorized"* and *"parent-table RLS implies child-table RLS"*; cheapest layer **integration, two distinct accounts**; anti-pattern *"single-account happy path; treating UI-hides as enforcement"*.
- **The two-account harness does not exist yet.** `src/test/integration/db.ts` provides `serviceClient()` (bypasses RLS, setup/teardown) and `createTestUser()` (returns an anon-key client signed in as a throwaway user — the real RLS-governed path), but only single-user. Test-plan §3 **Phase 3 "Authorization / isolation" is `not started`**. Also, `cleanupUserRows` (`db.ts:59-68`) deletes only `practice_sessions`/`algorithm_mastery` — it would need extending for lists/algorithms.
- **Reference integration pattern** (`persistence.int.test.ts`): `beforeAll` creates user + discovers seeded ids, `afterEach` cleanup, `afterAll` delete user; drive the seam with the authed client, then do an **independent service-role read-back** — never trust the response body as proof of persistence.
- **Unit tests are co-located** `*.test.ts(x)`, table-driven, and the codified rule is *"Oracle = the intended rule, never the function under test"* (`test-plan.md:135-138`). `completePractice.test.ts` shows the hermetic stub pattern for error branches.
- **Quality gates** (`test-plan.md:103-117`): lint + typecheck required and wired; unit/component and integration nominally required — but **CI still runs only `npm ci → astro sync → typecheck → lint → build`, with no `npm test` step.** This has been raised and skipped in two separate impl-reviews (`rotation-notation-fix` F1, `astro-check-params-types` F1). Any regression guard this slice adds is inert in CI until that's wired.
- **Per-edit hooks** (`.claude/settings.json`, reported as a finding): `PostToolUse` on `Write|Edit|MultiEdit` chains `eslint --fix`, `vitest related --run`, and an unconditional `tsc --noEmit`. Git hook is **Husky** (`npx lint-staged`) — no `lefthook.yml`, and no tests at pre-commit.
- **E2E** (`playwright/test/E2E_RULES.md`): role/label/text locators only, never CSS or XPath; `{ exact: true }` on move buttons (substring collision `R`/`R'`/`r`); no `waitForTimeout`; auth via shared `storageState`, never through the UI; every assertion must fail if the risk materializes, confirmed by a deliberate break. `playwright.config.ts:26-29` serves the **built** worker (`npm run build && npm run preview`), not `astro dev` — app changes need a rebuild before E2E sees them.
- **E2E has no DB teardown** — specs hit the real remote Supabase project and normalize state by *behavior* (start with a dirty run) rather than cleanup. **Custom-list specs break this assumption**: they create rows that persist. They will need unique naming (timestamp suffix) or an explicit cleanup strategy, and duplicate-detection specs especially risk leftover rows poisoning later runs.

### 7. Historical context and prior-review warnings

- **`plan.md` template** is consistent across all archived changes: Overview → Current State Analysis → Desired End State (+ Key Discoveries) → What We're NOT Doing → Implementation Approach → Critical Implementation Details → `Phase N` (Overview / Changes Required with **File**/**Intent**/**Contract** per item / Success Criteria split Automated vs Manual / pause-for-confirmation note) → Testing Strategy → Performance → Migration Notes → References → **Progress** (checkboxes per phase, split Automated/Manual, each appended ` — <sha>`).
- **`browse-prebuilt-view-algorithm`** built exactly the surfaces this slice extends, and explicitly listed *"No custom algorithm lists (belongs to S-04)"* as a non-goal. Its plan-review raised two CRITICALs pre-implementation: undocumented error-handling convention, and move-parser edge cases unverified against real seed data. The second matters far more here — that slice only *displayed* pre-verified seed data; this one accepts **free-form user input**.
- **Warnings from prior impl-reviews worth carrying:**
  - Server trusting client-supplied values without validation (`practice-session-core-loop` F2, skipped) — a new create endpoint must not repeat it.
  - The accepted fetch-then-upsert lost-update race (F4) — the same TOCTOU shape as check-then-insert duplicate detection.
  - Raw DB error messages echoed to the client (F6) — sanitize; map codes (`23503` → `400`) server-side, `console.error` the rest. `23505` (unique violation) handling is anticipated in the domain docs but unimplemented.
  - An unscoped read-back `SELECT` beside correctly-scoped `UPDATE`s (`rotation-notation-fix` F3) — *"inviting an operator to 'correct' a user's private row by hand."* Any query touching `algorithms` must scope by list/user, since there is no unique constraint on `name`/`moves`.
  - Manual Progress rows rubber-stamped `[x]` with the same sha as automated rows (`astro-check-params-types` F2) — each manual row should carry its confirmation basis.
  - Corrective SQL without a row-count abort is a silent no-op or silent over-write (`rotation-notation-fix` F5) — use `GET DIAGNOSTICS ... ROW_COUNT` + `RAISE EXCEPTION` in any future `fixes/` file.
- **The `context/domain/` docs are plans, not code.** All three are stamped *"This document is a PLAN, not an implementation"*; `src/lib/domain/` does not exist. They nonetheless bear directly on this slice:
  - `01` ranks **`MoveSequence` as a Value Object #1 to refactor** — *"the product of value and risk peaks here… the rule is enforced at NO layer, its violation already reached production… and S-04 (`ready`) will hand users free-form notation entry."*
  - `01` ranks **DuplicateDetection #4** — *"close it together with S-04; settle the open question on 'exactly matches' semantics at the same time — once #1's `MoveSequence` normalizes, that question becomes trivial."*
  - `02:204` proposes `MoveSequence.canonical()` explicitly annotated *"normalized form — reused later by INV-12 / FR-015"*, and its phase P0 moves `src/test/tokenGrammar.ts` → `src/lib/domain/notation/moveGrammar.ts`.
  - `03:863-869` recommends landing the ACL **before** S-04, so this slice *"adds port methods instead of adding the ninth and tenth PostgREST chain to a template."*
  - **This is a sequencing decision the plan must make explicitly**, not inherit. Doing the full ACL + aggregate refactor first is a large body of unshipped work; doing S-04 first means writing two more inline PostgREST chains and duplicating the notation grammar a third time. A middle path exists: extract only the grammar (doc 02's behavior-neutral P0) so the entry form has one validator to import.

## Code References

- `supabase/migrations/20260527000000_domain_schema_rls.sql:20-29` — `algorithms` table; `list_id NOT NULL` (the FR-015 blocker) and the prepared `algorithms_moves_idx`
- `supabase/migrations/20260527000000_domain_schema_rls.sql:61-76` — `algorithm_lists` policies; `al_insert` already permits user-owned list creation
- `supabase/migrations/20260527000000_domain_schema_rls.sql:79-98` — `alg_select` (the exact FR-015 visibility scope) and `alg_insert`
- `supabase/migrations/20260527000000_domain_schema_rls.sql:44-52` — `algorithm_mastery`, `UNIQUE (user_id, algorithm_id)` — why option A forks streaks
- `src/pages/dashboard.astro:14-19` — the `.eq("is_system", true)` filter that hides custom lists
- `src/pages/sets/[id].astro:19-33` — list + algorithms fetch, no `is_system` filter; reusable as-is
- `src/pages/api/practice/complete.ts:5-56` — the only JSON API route; auth gate, hand-rolled validation, response shape
- `src/lib/practice/completePractice.ts:31-44` — documented non-atomic multi-step write and accepted race
- `src/lib/supabase.ts:6-23` — the only client factory; returns `null` when env is absent
- `src/middleware.ts:4,18-22` — `PROTECTED_ROUTES` prefix matching; `/api/*` not covered
- `src/components/app/PracticeSession.tsx:8-35` — `KEY_TO_MOVE`, the de-facto move vocabulary
- `src/components/app/PracticeSession.tsx:216-218` — `parseMoves`, duplicated at `src/components/app/MoveSequence.astro:7`
- `src/components/app/PracticeSession.tsx:149` — strict `===` move comparison, no normalization
- `src/test/tokenGrammar.ts:1-31` — `PRODUCIBLE_TOKENS`, the only grammar guard (test-only)
- `src/test/integration/db.ts:21-68` — service vs authed client harness; single-user only
- `src/components/auth/SignUpForm.tsx:22-45,66` — the form precedent (native POST + client validate)
- `src/components/auth/SubmitButton.tsx:12` — `useFormStatus()` pending pattern
- `src/db/database.types.ts:85-91` — `algorithms.Insert` requires `position`
- `supabase/fixes/2026-08-24-rotation-notation.sql:6-12` — the production notation incident
- `supabase/config.toml:65` — only `seed.sql` auto-loads on reset

## Architecture Insights

- **RLS is the authorization layer, deliberately.** No app code duplicates ownership checks. That convention is load-bearing for this slice: the correct instinct is to lean on `al_insert`/`alg_insert` rather than hand-roll ownership logic — while proving the policies work with a two-account integration test, since this is their first real use.
- **"Backend ready, write path absent"** is the defining shape of S-04. The migration, the policies, the index, and even the browse pages are already there. The missing pieces are: a create-list path, a create-algorithm path, the dashboard filter, and the FR-015 decision.
- **The repo has two divergent write idioms** — native form POST + redirect (auth) versus JSON fetch + structured errors (practice). FR-015 needs an interactive branch ("we found a match — add the existing one?"), which fits the JSON/fetch idiom better, but there is no dialog component to host it.
- **Every abstraction this feature would want is absent**: no validation library, no shared error helper, no form abstraction, no dialog, no toast, no shared error banner, no runtime notation validator, no normalization. The plan should pick deliberately which of these to introduce versus inline — introducing all of them turns a slice into a refactor.
- **Duplication is the repo's recurring pattern** — the tokenizer twice, the error banner three times, E2E helpers across specs, the same list query in two pages. A third copy of the notation grammar is the specific one to avoid here.

## Historical Context (from prior changes)

- `context/archive/2026-05-27-domain-schema-rls/plan.md` — F-01; chose `moves TEXT` explicitly to match "PRD literal-string duplicate detection", and pre-designed `algorithms_moves_idx` for FR-015
- `context/archive/2026-05-27-browse-prebuilt-view-algorithm/plan.md:42,51` — built `/dashboard`, `/sets/[id]`, `/sets/[id]/[algoId]`; established the error-banner-vs-redirect convention; explicitly deferred custom lists to S-04
- `context/archive/2026-05-28-practice-session-core-loop/reviews/impl-review.md` — client-trusted server input (F2), accepted lost-update race (F4), raw DB error leakage (F6)
- `context/archive/2026-08-24-rotation-notation-fix/` — the notation incident, the `fixes/`-not-`migrations/` convention, and the seed-token regression guard
- `context/archive/2026-08-25-astro-check-params-types/reviews/impl-review.md` — manual-verification rubber-stamping (F2); CI test-step gap (F1, skipped again)
- `context/foundation/roadmap.md:125-126` — S-04's open question on match semantics; index-backed-query risk (already mitigated by F-01)
- `context/domain/01-03-*.md` — unimplemented refactor plans that nonetheless rank this slice's central risk (`MoveSequence` VO) as #1 and recommend sequencing an ACL before S-04

## Related Research

- `context/archive/2026-05-28-practice-session-core-loop/research.md` — practice loop internals; the consumer of whatever `moves` this feature writes
- `context/archive/2026-06-02-testing-bootstrap-core-logic-units/research.md` and `context/archive/2026-06-04-testing-persistence-integration/research.md` — the unit and integration harnesses this slice extends
- `context/foundation/lessons.md` — `Promise.all` for independent Supabase queries on server pages

## Open Questions

1. **Which FR-015 data model?** A (copy), B (`list_items`), C (link-only), or D2 (copy + `source_algorithm_id`). The deciding question is product-level: **should a practice streak follow "the same algorithm" across lists?** If yes, B is the only option that gives it for free. If no, A is far cheaper. — Owner: user. **Block: yes** for the FR-015 phase; the create-list and create-algorithm phases (FR-004/FR-005) can proceed under any option.
2. **"Exactly matches" — literal bytes or normalized?** (`roadmap.md:125`, still open.) Recommend deciding it together with #3, since normalization is the same mechanism.
3. **How much notation validation ships in this slice?** Nothing (matching current behavior, and repeating the production freeze with user data), a minimal extracted validator (`tokenGrammar.ts` → `src/lib/`, imported by form + endpoint), or the full `MoveSequence` VO from domain doc 02. Middle option looks like the proportionate one — but it is a real scope call.
4. **Sequencing vs the domain-doc refactors.** Docs 02/03 recommend ACL-then-aggregate-then-S-04. None of it is implemented. Does S-04 go first, or wait?
5. **Does the practice loop become reachable from custom lists immediately?** `/sets/[id]` and `/sets/[id]/[algoId]` already work under RLS, so practice-on-custom-algorithm arrives essentially for free — which also means an unvalidated user-entered sequence can freeze the loop the moment it's created.
6. **E2E data hygiene** — custom-list specs create persistent rows against the real remote project, which no existing spec does. Unique naming, cleanup, or both?
7. **Should `npm test` finally be wired into CI** as part of this slice, or stay a separate concern (skipped twice already)? Any regression guard added here is otherwise inert.

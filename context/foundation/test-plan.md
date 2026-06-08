# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-08

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/` (excluding generated
`src/db/database.types.ts`).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|--------------------------|--------|------------|--------------------------------|
| 1 | Finished session result fails to persist — learner completes a clean run but progress/streak is not written, and the result is lost on reload | High | High | interview Q1; PRD §Success Criteria guardrail ("practice history persists across browser sessions"); hot-spot dir `src/pages/api` (6 commits/30d) |
| 2 | Cross-user data access — a learner reaches another user's lists or progress; an endpoint checks "logged in" but not "owns this resource", or an RLS gap leaks rows | High | Medium | interview Q1; PRD §NFR ("each user's data is strictly isolated — not readable under any access path"); archive `domain-schema-rls/plan.md` (RLS on child table depends on parent-table RLS) |
| 3 | Move validation lies — a wrong move is accepted as correct (or a correct move rejected); end-state slot color is wrong (green when it should be yellow) | High | Medium | interview Q1; PRD US-01 / FR-010 / FR-011 guardrail ("no move is silently accepted as correct when it is wrong"); hot-spot dir `src/components/app` (5 commits/30d) |
| 4 | Streak miscounts — consecutive-clean count is wrong, "You're PRO!" fires off-by-one, or a lost-update race drops a clean run | Medium | High | interview Q1; PRD FR-013 (3 consecutive mistake-free sessions, per-algorithm); archive `2026-05-28-practice-session-core-loop` lesson (fetch-then-compute-then-upsert race accepted) |
| 5 | Grid input desync — a button or keyboard shortcut maps to the wrong move token; a layout rework remaps keys | Medium | High | interview Q3 (low-confidence area: "frontend + practice button grid"); hot-spot dir `src/components/app`; open change `moves-grid-update`; PRD FR-009 (dual input: grid + keyboard) |

**Abuse / security lens.** Risk #2 is the authorization/IDOR scenario — the
happy path excludes the attacker, so it is included explicitly. A second
abuse surface — the session-complete endpoint trusting a client-submitted
outcome (a learner could forge a clean result to inflate their own streak)
— is low impact (single-user, self-deception, no payments) and is recorded
in §7 negative space rather than as a top risk.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | A clean run produces a persisted row that survives a reload | "A 200 response means the write landed" | session-complete entry point, the tables written, the write path | integration (endpoint + DB read-back) | asserting the response body instead of the persisted row |
| #2 | User A cannot read or write user B's rows via the API or a direct query | "Logged-in means authorized"; "parent-table RLS implies child-table RLS" | where ownership is checked, the full RLS policy chain across related tables | integration, two distinct accounts | single-account happy path; treating UI-hides as enforcement |
| #3 | A wrong move blocks and never advances; a correct move advances; end color is binary green/yellow | "The happy path proves the loop is correct" | the move-comparison logic and the slot-state reducer | unit (pure logic) | a test that mirrors the comparison function; happy-path-only assertions |
| #4 | The count increments only on a clean run, resets on error, and triggers PRO at exactly 3 | "Final status 200 means the count is right" | the streak compute rule and the UPSERT path | unit + integration | taking the oracle from the compute function itself (tautology); ignoring the documented race |
| #5 | Each grid button and its assigned keyboard shortcut emit the correct move token | "A layout change is purely cosmetic" | the button→token map and the hotkey binding | component / unit | a DOM snapshot with no meaning; not asserting the emitted token |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|------------|-----------------|----------------|------------|--------|---------------|
| 1 | Bootstrap + core-logic units | Stand up the test runner and prove forced-recall, streak, and grid mapping hold at the logic layer | #3, #4, #5 | unit | complete | context/changes/testing-bootstrap-core-logic-units/ |
| 2 | Persistence integration | Prove a finished session actually persists and the streak UPSERT updates correctly around the session-complete write path | #1, #4 | integration | complete | context/changes/testing-persistence-integration/ |
| 3 | Authorization / isolation | Prove no cross-user leak via two-account API + RLS tests | #2 | integration / e2e | not started | — |
| 4 | Quality-gates wiring | Lock the floor in the existing GitHub Actions CI; e2e on the practice loop; optional selective visual review of slot-color states | cross-cutting | gates, e2e, (optional) AI-native visual | not started | — |

**Status vocabulary** (fixed — parser literals): `not started` → `change opened` → `researched` → `planned` → `implementing` → `complete`.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

Test-base verdict: **none** — no test-runner config and zero test files in
`src/`. Phase 1 bootstraps the runner.

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| unit + integration | Vitest | TBD | none yet — see §3 Phase 1; pairs natively with Vite/Astro, React 19 component tests via Testing Library |
| component | @testing-library/react | TBD | none yet — see §3 Phase 1; for PracticeSession island + grid mapping (#5) |
| integration (DB/API) | Vitest + Supabase client | TBD | none yet — see §3 Phase 2; two-account tests need a non-prod Supabase target (local stack or branch project) |
| e2e | Playwright | TBD | none yet — see §3 Phase 4; critical practice-loop flow only |
| (optional) AI-native | multimodal visual review — checked: 2026-06-02 | n/a | selective, practice-session slot-color states (1 screen). When NOT to use: skip when unit assertions on slot-state already cover the logic — vision adds signal only for the rendered color truth |

**Stack grounding tools (current session):**
- Docs: Context7 — available; usable for current Vitest / Playwright / Testing Library setup against Astro 6 + React 19 during Phase 1/4 research; not queried at plan time (lesson focus is strategy, not config); checked: 2026-06-02
- Search: none — Exa.ai / web search MCP not exposed in current session; checked: 2026-06-02
- Runtime/browser: none — Playwright MCP not exposed in current session; e2e tooling decided per-phase in research; checked: 2026-06-02
- Provider/platform: none — GitHub / Cloudflare / Supabase MCP not exposed; CI is GitHub Actions (`.github/workflows/ci.yml`), Supabase is remote project; checked: 2026-06-02

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase <N>" means the gate is enforced once that rollout
phase lands; before that, the gate is planned.

| Gate | Where | Required? | Catches |
|------|-------|-----------|---------|
| lint + typecheck | local + CI | required (already wired — `npm run lint` + `npm run build` on master) | syntactic / type drift |
| unit + component | local + CI | required after §3 Phase 1 | move-validation, streak, grid-mapping logic regressions |
| integration (DB/API) | CI on PR | required after §3 Phase 2 | session-persistence + authorization regressions |
| e2e on practice loop | CI on PR | required after §3 Phase 4 | broken critical user path end-to-end |
| post-edit hook | local (agent loop) | recommended (Module 3 Lesson 3) | regressions at edit time |
| multimodal visual review | CI on PR | optional (see §3 Phase 4) | slot-color rendering issues a classic diff misses |
| pre-prod smoke | between merge + prod | optional | Cloudflare Workers runtime-specific failures (e.g. <100 ms validation NFR) |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase <N>."

### 6.1 Adding a unit test
- **Location:** co-located next to the code under test, named `*.test.ts`
  (e.g. `src/lib/practice/streak.test.ts`, `src/components/app/PracticeSession.reducer.test.ts`).
- **Runner:** `npm test` (Vitest, non-watch) or `npm run test:watch` while iterating.
  Globals are on — `describe/it/expect` are available, but import them from
  `vitest` anyway so ESLint stays happy. The `@/*` alias resolves in tests.
- **Pattern (pure logic):** test only logic that is exported and pure. If the
  logic is inlined in JSX or an endpoint, first extract it to a pure function
  (see Phase 2: `computeStreak`, and the named exports on `PracticeSession.tsx`),
  then import and drive it directly with hand-built inputs.
- **Oracle = the intended rule, never the function under test.** Take expected
  values from the *spec* (e.g. "3 consecutive clean triggers PRO"; the literal
  expected move token), not by re-deriving them from the code you are testing —
  a test that mirrors the comparator proves nothing.
- **Reference test:** `src/lib/practice/streak.test.ts` (table-driven, intended-rule
  oracle). For reducer-style state logic see `PracticeSession.reducer.test.ts`.

### 6.2 Adding a component test
- **Location:** co-located, named `*.test.tsx`
  (e.g. `src/components/app/PracticeSession.test.tsx`).
- **Stack:** `@testing-library/react` + `@testing-library/user-event` under the
  `jsdom` environment (set in `vitest.config.ts`); jest-dom matchers are
  registered globally via `src/test/setup.ts`.
- **Scope:** cover only JSX-closure surfaces that pure logic cannot reach
  (modifier assembly, rendered end-state color, cross-input routing). Push
  everything else down to a unit test (§6.1) — component tests are slower.
- **Boundaries:** stub any network/`fetch` the component makes
  (`vi.stubGlobal("fetch", …)` + `vi.unstubAllGlobals()` in `afterEach`) so no
  Supabase / `astro:env` code enters the test graph. Assert observable behavior
  (emitted token via its downstream effect, rendered banner/class), never a DOM
  snapshot.
- **Reference test:** `src/components/app/PracticeSession.test.tsx`.

### 6.3 Adding an integration test
- **Location & naming:** `src/test/integration/*.int.test.ts`. The `.int.test.ts`
  suffix is what the dedicated config matches — a plain `.test.ts` here would be
  picked up by the fast jsdom suite instead and crash on the node-only client.
- **Config & runner:** node-env `vitest.config.integration.ts` (separate from the
  jsdom `vitest.config.ts` and from `astro.config.mjs`, so neither the
  Cloudflare/SSR adapter nor `astro:env` enters the graph). Run with
  `npm run test:integration` — **not** part of `npm test`. Requires a local
  Supabase stack (`npx supabase start`) and a `.env.test` (copy `.env.test.example`).
- **Credentials (safety):** the config injects ONLY keys read from `.env.test`
  (a hand-rolled loader, deliberately not Vite's `loadEnv`, so the destructive
  setup/teardown can never run against the dev/cloud DB in `.env`). Missing keys
  trip a loud guard in `src/test/integration/setup.ts` — the suite fails clearly,
  not silently.
- **Two client roles (`src/test/integration/db.ts`):** an **authed-user** client
  (anon key + signed-in throwaway user) drives the RLS-governed write path the
  endpoint actually uses; a **service-role** client (bypasses RLS) does fixture
  setup/teardown and the independent **read-back**. Both built directly from
  `@supabase/supabase-js` + `process.env` — NEVER from the app's `@/lib/supabase`
  (it imports `astro:env/server`, unresolvable under node).
- **Seam, not the route:** import the node-importable seam
  (`@/lib/practice/completePractice`), not the Astro endpoint — the route is a thin
  `astro:env`-bound wrapper that won't load under node.
- **Fixtures & cleanup:** `createTestUser` / `deleteTestUser`; `cleanupUserRows`
  (deletes the user's `practice_sessions` + `algorithm_mastery`, leaves seed
  algorithms intact); `getSeededAlgorithmIds` discovers seeded UUIDs at runtime.
  `afterEach` → `cleanupUserRows`, `afterAll` → `deleteTestUser`. Per-test cleanup
  is cheaper than `supabase db reset` and keeps seed data.
- **Reference tests:** `src/test/integration/persistence.int.test.ts` (read-back),
  `src/test/integration/streak.int.test.ts` (streak round-trip),
  `src/test/integration/smoke.int.test.ts` (connectivity).
- Two-account authorization / RLS isolation is §3 Phase 3, not covered here.

### 6.4 Adding an e2e test
- TBD — see §3 Phase 4 (critical practice-loop flow).

### 6.5 Adding a test for a new API endpoint
- **Extract a seam first.** An Astro endpoint that imports `astro:env` can't load
  under node. Lift its logic into a node-importable function that takes an
  **injected** Supabase client and returns a structured result the route maps to a
  `Response` (pattern: `src/lib/practice/completePractice.ts`, returning
  `{ status; body }`). The route keeps the auth gate, body parse/validate, and the
  `astro:env`-bound `createClient`, then delegates. Keep the refactor
  behavior-neutral (same status codes, JSON bodies, `console.error` lines).
- **Assert the request→result AND the persisted side-effect — never the body
  alone.** A 200 (or the returned object) is computed in memory and lies about
  whether the write landed. Drive the seam with the authed-user client, then prove
  the effect with an independent service-role **read-back** of the written rows.
  See `persistence.int.test.ts`: it checks `result.status` only as a non-error
  guard and asserts the persisted `practice_sessions` / `algorithm_mastery` rows.
- **Never trust a client-submitted outcome** as the oracle (forging it is the §7
  abuse surface). Expected values come from the spec (PRD), hand-written — not from
  the compute function under test (tautology).
- **Failure branches a real DB won't trigger on demand** (a mid-sequence read or
  upsert error in a non-atomic sequence) go in a **hermetic** unit test driving the
  seam with a stub client under the jsdom suite — not an integration test that would
  have to force a mid-sequence error. Reference:
  `src/lib/practice/completePractice.test.ts`. Real-constraint branches (FK,
  unique-key upsert, defaults) go in the integration suite where a stub would lie.

### 6.6 Per-rollout-phase notes
- **Phase 1 — Bootstrap + core-logic units (2026-06-04).** Stood up the project's
  first test runner: Vitest 4 + `@testing-library/{react,dom,jest-dom,user-event}`
  + jsdom. Config is a standalone `vitest.config.ts` (jsdom env, globals, `@/*`
  alias, `src/test/setup.ts`) deliberately kept independent of `astro.config.mjs`
  so the Cloudflare/SSR adapter never enters the test graph. Scripts: `npm test`
  (CI-shaped, non-watch) and `npm run test:watch`. A behavior-neutral refactor
  enabled the cheapest layer — named exports on `PracticeSession.tsx` (`reducer`,
  `parseMoves`, `KEY_TO_MOVE`, the three grid arrays) and the inlined streak rule
  extracted to pure `src/lib/practice/streak.ts` (`computeStreak`), called by
  `complete.ts`. Covered risks #3/#4/#5 with pure-unit tests + targeted component
  tests; CI test-step wiring is deferred to §3 Phase 4.
- **Phase 2 — Persistence integration (2026-06-08).** Covered risks #1 and #4 at
  the integration layer. A behavior-neutral seam refactor lifted the
  `POST /api/practice/complete` body into node-importable
  `src/lib/practice/completePractice.ts` (injected Supabase client, no `astro:env`);
  the route is now a thin wrapper. Two test layers by cost × signal: **hermetic**
  stubs (`completePractice.test.ts`, jsdom suite) for the two `500` branches a real
  DB won't trigger on demand (mastery-read error, upsert error) + the `23503`→`400`
  branch; **integration** (`*.int.test.ts`, node-env `vitest.config.integration.ts`,
  `npm run test:integration` against a local Supabase) for the persistence
  read-back (#1) and streak round-trip (#4) — proofs a stub would lie about. Added
  the two-client strategy (authed-user vs service-role) and per-test row cleanup in
  `src/test/integration/db.ts`; cookbook §6.3/§6.5 capture the pattern. **Documented,
  not tested — the fetch-then-compute-then-upsert race** (`completePractice.ts`
  doc-comment): benign/corrective under the only realistic single-user trigger (a
  fast double-submit of the SAME session yields the correct +1; an atomic fix would
  overcount), a genuine undercount only for rare concurrent *distinct* runs
  (two devices), and `mastery_reached` is monotonic so PRO is never revoked. A
  forced-interleave test would pin a near-theoretical outcome and add flake; revisit
  with an atomic Postgres RPC only if multi-device streak accuracy ever matters. See
  `context/archive/2026-05-28-practice-session-core-loop/`. Integration suite stays
  opt-in (local stack), not on the per-commit path; CI wiring is §3 Phase 4.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Auth pages and flows** — Supabase Auth + the starter own sign-in/sign-up/session; not our logic. Re-evaluate if we add custom auth logic beyond the starter. (Source: Phase 2 interview Q5.)
- **Static / marketing pages** — pixel snapshots break constantly and catch nothing. Re-evaluate if a static page gains real logic. (Source: Phase 2 interview Q5.)
- **Database existence + Cloudflare/Supabase service status** — third-party uptime, not our code. Belongs to observability/alerting, not a test. (Source: Phase 2 interview Q5.)
- **Client-forged session outcome** — low impact (single-user, self-deception, no payments). Re-evaluate if sharing, leaderboards, or payments ship. (Source: §2 abuse-lens triage.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-02
- Stack versions last verified: 2026-06-02
- AI-native tool references last verified: 2026-06-02

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.

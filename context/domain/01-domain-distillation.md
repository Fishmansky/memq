---
title: "MemQ — Domain Distillation (Ubiquitous Language, subdomains, aggregates, model↔code divergences)"
created: 2026-08-25
type: domain-distillation
---

# MemQ — Domain Distillation

> The product of this document is a MAP of the domain, not code. Every entity,
> rule and path name below was discovered from source documents and code; each
> entry carries a `file:line` citation.

## Step 0 — Project context (discovery)

### Sources that exist

| Document | Path | Role in the distillation |
|---|---|---|
| PRD (v1, `status: draft`) | `context/foundation/prd.md` | primary source of vision, FR-001…FR-015, NFRs, Business Logic, Access Control, Non-Goals |
| Shaping notes | `context/foundation/shape-notes.md` | earlier version of the same FRs plus the record of resolutions ("Socrates") |
| Roadmap (`status: active`) | `context/foundation/roadmap.md` | narrative / change history: F-01, S-01, S-02 `done`; S-03, S-04 `ready` |
| Original notes (PL) | `idea-notes.md` | earliest statement of the problem and success criteria |
| Lessons | `context/foundation/lessons.md` | one engineering rule (Promise.all), not a domain rule |
| README / AGENTS.md | `README.md`, `AGENTS.md` | stack, commands, hard repo rules |

Requirements documents DO exist — the distillation rests on them, with code used
as verification. `context/archive/` is immutable and was not modified.

### Stack and layers (where business logic lives)

Astro 6 + React 19 + TypeScript strict + Tailwind v4 + Supabase (Postgres + Auth)
+ Cloudflare Workers (`README.md:7-13`, `AGENTS.md:3`).

| Layer | Directory / file | What it actually holds |
|---|---|---|
| UI (React island) | `src/components/app/PracticeSession.tsx` | **the entire move-validation rule** — the `INPUT_MOVE` reducer (`:146-175`), tokenization (`:216-218`), token assembly from modifiers (`:291-296`) |
| UI (Astro, SSR) | `src/pages/dashboard.astro`, `src/pages/sets/[id].astro`, `src/pages/sets/[id]/[algoId].astro` | Supabase queries inline in the frontmatter, no repository layer |
| API | `src/pages/api/practice/complete.ts` | auth guard + JSON **shape** validation (`:24-35`), delegation to `completePractice` |
| "Domain" (the only extracted module) | `src/lib/practice/streak.ts`, `src/lib/practice/completePractice.ts` | the consecutive-clean-run rule (`streak.ts:22-25`) and the insert→read→compute→upsert sequence (`completePractice.ts:52-98`) |
| Persistence + rules in the DB | `supabase/migrations/20260527000000_domain_schema_rls.sql` | 4 tables, list-ownership CHECK (`:12-16`), UNIQUE `(user_id, algorithm_id)` (`:51`), 13 RLS policies (`:61-151`) |
| Middleware / access | `src/middleware.ts:4` | `PROTECTED_ROUTES = ["/dashboard", "/sets"]` |
| Content (seed) | `supabase/algos_seed.sql`, `supabase/seed.sql`, `supabase/fixes/2026-08-24-rotation-notation.sql` | pre-built F2L / OLL / PLL; one-off notation repair |

Layering conclusion: **there is no domain layer in the DDD sense**. The only two
files outside UI/API carrying a business rule are `src/lib/practice/*`. The core
rule (move correctness) lives inside a React component, next to the button-grid
layout (`PracticeSession.tsx:54-99` is UI layout data sitting in the same file as
the reducer).

## Step 1 — Ubiquitous Language

Concepts discovered, not assumed. "MISSING in code" = the term exists in the
documents but has no counterpart in the code.

| Term (domain language) | Definition | Source citation | Where it lives in code |
|---|---|---|---|
| **Learner** | the only role; an intermediate cuber building an algorithm repertoire | `prd.md:26`, "One flat role: learner" `prd.md:125` | no entity of its own — identity is `auth.users`; `user_id` in `migrations/…:8,34,46`; `context.locals.user` in `api/practice/complete.ts:6` |
| **Algorithm Set / List** | a named collection of algorithms; pre-built (system) or user-owned | FR-003 `prd.md:65`, FR-004 `prd.md:68` | table `algorithm_lists` `migrations/…:6-17`; types `src/db/database.types.ts:17-40`; read `dashboard.astro:15-19` |
| **Pre-built set / is_system** | a set shipped with the app, without an owner | "pre-built algorithm sets included with the app" `prd.md:65` | `is_system boolean` + CHECK `migrations/…:9,12-16`; filter `.eq("is_system", true)` `dashboard.astro:18` |
| **Algorithm** | name + move sequence + position within a list | FR-005 "name + move sequence" `prd.md:71`, FR-007 `prd.md:78` | `algorithms` `migrations/…:20-27`; render `AlgorithmRow.astro:12-19` |
| **Move sequence / moves** | textual Singmaster-notation sequence, e.g. `R U R' U'` | "move sequence" `prd.md:71`, `prd.md:117` | column `moves text` `migrations/…:24`; prop `moves` `PracticeSession.tsx:213` |
| **Move token** | a single move split out of the sequence, compared 1:1 | "Each button press or keypress submits a single move token" `prd.md:117` | `parseMoves()` `PracticeSession.tsx:216-218`; producible set `src/test/tokenGrammar.ts:27-30` |
| **Producible token** | a token the app is actually capable of generating from keyboard/grid | absent from the documents — **a concept born in the code** after the incident | `tokenGrammar.ts:9-30`; incident described in `supabase/fixes/2026-08-24-rotation-notation.sql:6-12` |
| **Wide / double modifier** | a modifier that transforms the base token (`R`→`r`, `R`→`R2`) | FR-009 "button grid OR keyboard shortcuts" `prd.md:85` (the modifier itself: **MISSING from the documents**) | sentinels `PracticeSession.tsx:33-34`; token assembly `:291-296` |
| **Slot** | one empty field corresponding to one move of the algorithm | "the learner is shown N blank slots (one per move)" `prd.md:117` | `slotResults: SlotResult[]` `PracticeSession.tsx:103,112`; render `:415-432` |
| **Practice Session** | a single end-to-end attempt at reproducing an algorithm from memory | US-01 `prd.md:43-47`, FR-008 `prd.md:82` | state machine `Phase` `PracticeSession.tsx:102`; row in `practice_sessions` `migrations/…:32-39` |
| **Clean run** | a completed sequence with zero errors | "green if zero errors occurred" `prd.md:119` | `is_clean` `migrations/…:36`; `isClean: errorCount === 0` `PracticeSession.tsx:327` |
| **Error count** | number of wrong attempts within an attempt | "yellow if any error occurred" `prd.md:119` | `errorCount` `PracticeSession.tsx:171`; `error_count` `migrations/…:37` |
| **Forced correction** | no way to advance without the correct move; no skip, no hints | "no skipping, no hints" `prd.md:117`; AC `prd.md:51` | the wrong branch leaves `currentIndex` untouched `PracticeSession.tsx:166-174` |
| **Consecutive clean / streak** | counter of consecutive clean runs **per algorithm** | FR-013 "3 consecutive mistake-free sessions for the same algorithm" `prd.md:98` | `computeStreak()` `streak.ts:22-25`; `consecutive_clean` `migrations/…:48` |
| **Mastery / "You're PRO!"** | the mastered state reached at 3 consecutive clean runs | FR-013 `prd.md:98`, "the mastery state triggers" `prd.md:119` | `mastery_reached` `migrations/…:49`; `newMasteryReached` `streak.ts:24`; banner `PracticeSession.tsx:376-379` |
| **Repeat or Exit** | the branch offered after a session with mistakes | FR-012 `prd.md:94` | **MISSING in code** — completion offers only "Try Again" `PracticeSession.tsx:490-499`; no "Exit" action |
| **Duplicate detection** | detecting an identical sequence on algorithm entry and proposing the existing one | FR-015 `prd.md:105`, `prd.md:121` | **MISSING in code** — only the index prepared for this rule exists `migrations/…:28-29` |
| **Total sessions completed** | the learner's global count of completed sessions | FR-014 `prd.md:101` | **MISSING in code** — `practice_sessions` is never read by the UI (grep: tests only, plus `completePractice.ts:53`) |
| **Custom list** | a list created by the learner | FR-004 `prd.md:68`, success criterion `prd.md:34` | schema + RLS ready (`migrations/…:65-76`), **NO creation path** — `dashboard.astro:18` shows `is_system = true` only |
| **Data isolation** | one learner's data is never readable by another | NFR `prd.md:111` | RLS on 4 tables `migrations/…:55-58` + 13 policies `:61-151` |

## Step 2 — Subdomain classification

Core test: what delivers success criterion `prd.md:31` ("≥ 5 algorithms executed
from memory with zero mistakes") and guardrail `prd.md:37` ("validation never
silently accepts a wrong move").

| Area / concept | Category | Justification (tied to product goals) |
|---|---|---|
| **Recall Validation** — token vs expected comparison, forced correction, no skip | **Core** | This is the entire product edge: "No focused product exists for the memorization training phase" `prd.md:22`; guardrail `prd.md:37`; roadmap north star S-02 `roadmap.md:24` |
| **Mastery / Streak** — 3 consecutive clean, sticky mastery | **Core** | Defines the "I know it from memory" moment, i.e. the point of the product; FR-013 `prd.md:98`, "the mastery state triggers" `prd.md:119` |
| **Move Notation (token grammar)** — what counts as a legal and producible move | **Core** | Without a shared token↔input grammar the core loop jams — documented production incident `supabase/fixes/2026-08-24-rotation-notation.sql:6-12`; Non-Goal "no 3D visualization" `prd.md:129` makes notation the ONLY representation of the domain |
| **Duplicate Detection (FR-015)** | **Core-adjacent → Supporting** | A product-specific rule (not off-the-shelf), but it serves content quality, not the recall loop itself; derived from FR-005 as a remedy `prd.md:72,105` |
| **Algorithm Catalog** — lists, algorithms, ordering, pre-built vs custom | **Supporting** | A necessary content carrier ("empty-state on day one kills activation" `prd.md:66`), but plain collection CRUD — the edge is not here |
| **Progress Tracking (FR-014)** — global session count | **Supporting** | Must exist (persistence guardrail `prd.md:38`), yet deliberately reduced to a single number; per-algorithm breakdown pushed out of MVP `prd.md:133` |
| **Identity & Access (auth, sessions, RLS)** | **Generic** | Email+password, one flat role `prd.md:125`; delivered by Supabase Auth + RLS; no admin/instructor split — nothing domain-specific |
| **Presentation / grid layout, hotkeys, styling** | **Generic** | Grid and keyboard input is a UX requirement `prd.md:85`, but the layout itself (`PracticeSession.tsx:54-99`) carries no domain rule |
| **Sharing, points, leaderboard, 3D, mobile, offline** | **outside the domain (Non-Goals)** | `prd.md:129-133` |

## Step 3 — Aggregate candidates and their invariants

Status legend: **enforces** = code makes violation impossible; **declares** = the
rule is written down / tested, but another path bypasses it; **ignores** = no
mechanism at all.

### A. `PracticeAttempt` — candidate core aggregate

Root: a single attempt for `(learner, algorithm)`. It does not exist as an entity
today — it is smeared across the reducer's `State` and a `practice_sessions` row.

| # | Invariant | Source citation | Status |
|---|---|---|---|
| A1 | No wrong move is silently accepted as correct | `prd.md:37`, `prd.md:50` | **enforces (client only)** — `PracticeSession.tsx:148-151,166-174`, tests `PracticeSession.reducer.test.ts:33,42` |
| A2 | Position cannot advance without a correct move (no skip, no hints) | `prd.md:117`, `prd.md:51` | **enforces (client only)** — `PracticeSession.tsx:166-174` |
| A3 | A session is "complete" only once every slot has been filled correctly | `prd.md:51` | **declares** — client: `PracticeSession.tsx:155-160`; the server accepts arbitrary `{isClean, errorCount}` with no relation to the algorithm `api/practice/complete.ts:24-41` |
| A4 | `isClean` ⇔ `errorCount === 0` (end state is binary) | `prd.md:52`, `prd.md:119` | **declares** — the client computes it correctly `PracticeSession.tsx:327`, test `PracticeSession.reducer.test.ts:65`; the API **never checks** the two fields against each other (`complete.ts:24-35` validates types only) |
| A5 | Abandoning a session mid-way corrupts neither history nor the streak | `prd.md:53` | **enforces** — `STOP` clears local state and sends nothing `PracticeSession.tsx:186-197` |
| A6 | One real attempt = at most one recorded session row | implied by FR-014 ("total sessions completed") `prd.md:101` | **ignores** — `RETRY` re-POSTs with no idempotency key `PracticeSession.tsx:183-184,318-344`; a failure after a successful INSERT produces a second row (`completePractice.ts:52-58`, no UNIQUE in `migrations/…:32-39`) |

### B. `AlgorithmMastery` (per-algorithm clean-run streak)

Root: the `(user_id, algorithm_id)` row in `algorithm_mastery`. The closest thing
to a real aggregate in the whole codebase.

| # | Invariant | Source citation | Status |
|---|---|---|---|
| B1 | A clean run increments the count by 1; any non-clean run resets it | `prd.md:119` | **enforces** — `streak.ts:23`, tests `streak.test.ts:75-89`, integration `streak.int.test.ts:59,70` |
| B2 | Mastery triggers at exactly 3 and never regresses (sticky) | FR-013 `prd.md:98` | **enforces** — `streak.ts:24`; 2/3 boundary test `streak.test.ts:84,88` |
| B3 | The streak is counted separately per algorithm | FR-013 "for the same algorithm" `prd.md:98` | **enforces** — UNIQUE `(user_id, algorithm_id)` `migrations/…:51`; isolation test `streak.int.test.ts:80` |
| B4 | The counter reflects actual session history | "The result … is recorded against the algorithm and the consecutive-clean count is updated" `prd.md:119` | **ignores** — non-atomic read-modify-write, knowingly accepted `completePractice.ts:31-44,59-93`; two sources of truth (`practice_sessions` vs `algorithm_mastery`) are never reconciled |
| B5 | The "You're PRO!" banner appears only on the 3rd clean run | FR-013 `prd.md:98`, US-01 `prd.md:47` | **enforces** — `isPro` reads the server response `PracticeSession.tsx:346`, not local state |

### C. `Algorithm` / `MoveSequence` (the sequence as a domain object)

Root: an `algorithms` row; `moves` is plain `text` today.

| # | Invariant | Source citation | Status |
|---|---|---|---|
| C1 | Every token in a sequence must be a token the learner can actually input | not stated in the PRD; forced by FR-010 "must input the correct move to advance" `prd.md:88` | **ignores at runtime / declares in tests** — no CHECK in `migrations/…:20-27`, no validation in code; the only guard is a text-level test over the seed files `src/test/seedTokens.test.ts:50-59` via `tokenGrammar.ts:27-30` |
| C2 | A sequence is non-empty and ordered | "N blank slots (one per move)" `prd.md:117` | **ignores** — `parseMoves("")` returns `[]` (`PracticeSession.reducer.test.ts:90`), and a 0-slot session has no defined start behavior |
| C3 | Grouping parentheses are presentation notation, not moves | absent from the documents — a rule discovered in the code | **enforces** — `parseMoves` strips `()` `PracticeSession.tsx:217`, duplicated in `MoveSequence.astro:7` (the same rule in two places) |
| C4 | The same sequence is not stored twice as separate algorithms | FR-015 `prd.md:105` | **ignores** — no UNIQUE and no code; only an index prepared "for" the rule exists `migrations/…:28-29` |

### D. `AlgorithmList` (content ownership and visibility)

| # | Invariant | Source citation | Status |
|---|---|---|---|
| D1 | A system list has no owner; a user list has an owner — there is no third state | "is_system=true rows are pre-built content (user_id NULL)" `migrations/…:5`; FR-003/FR-004 `prd.md:65,68` | **enforces** — CHECK `migrations/…:12-16` |
| D2 | A learner cannot modify system content | FR-003 (content "included with the app") `prd.md:65` | **enforces** — `al_insert/al_update/al_delete` policies require `is_system = false` `migrations/…:65-76`; likewise `alg_*` `migrations/…:89-128` |
| D3 | A learner's data is unreadable to others on every access path | NFR `prd.md:111` | **enforces** — RLS enabled on 4 tables `migrations/…:55-58`, `user_id = auth.uid()` policies `:131-151` |
| D4 | An algorithm belongs to exactly one list | schema + FR-006 `prd.md:74` | **enforces** — `list_id NOT NULL … ON DELETE CASCADE` `migrations/…:22` |

## Step 4 — MODEL vs CODE divergences

| # | The document says | The code does | Evidence |
|---|---|---|---|
| R-01 | "slots turn **yellow** on a completed-with-errors attempt"; end state is binary: all-green or all-yellow — FR-011 `prd.md:91-92`, AC `prd.md:52` | A slot has three states: `pending`/`correct`/`wrong`; correcting an error turns red into **green**, so every completed attempt ends all-green. Yellow exists only as a text banner color | `PracticeSession.tsx:103` (`SlotResult`), `:152-153`, `:417-431`; banner `:381-392` |
| R-02 | "Learner is offered **Repeat or Exit** after completing a session with at least one mistake" — FR-012 `prd.md:94` | Completion offers a single "Try Again" button, identical for clean and error runs; no "Exit" action and no branch | `PracticeSession.tsx:490-499`; no `Exit` anywhere in the file |
| R-03 | Move validation never accepts a wrong move; a session cannot be "completed" by skipping — `prd.md:37,50-51` | The rule lives **in the browser only**. The endpoint takes `{algorithmId, isClean, errorCount}` on the client's word: it checks field types, never sees the sequence, never verifies `isClean` against `errorCount` | `api/practice/complete.ts:24-41`; `completePractice.ts:50-58` |
| R-04 | "Learner can view total sessions completed (global count)" — FR-014 `prd.md:101`, persistence guardrail `prd.md:38` | Sessions are written but **never read back** by the app — no counting query and no place in the UI (`dashboard.astro` renders set cards only) | write `completePractice.ts:53-58`; no read — `practice_sessions` appears in `src/` only in `completePractice.ts` and tests; `dashboard.astro:15-19,43-48`; roadmap S-03 `ready` `roadmap.md:35` |
| R-05 | FR-004 / FR-005 / FR-015: custom list, algorithm entry, duplicate detection — `prd.md:68-72,105`; success criterion "≥ 1 custom list" `prd.md:34` | Schema and RLS are ready, but no write path exists: the dashboard filters `is_system = true`, so user lists would be invisible even if they were created | `dashboard.astro:18`; policies `migrations/…:65-76`; no endpoint under `src/pages/api/` (only `auth/*` and `practice/complete.ts`); roadmap S-04 `ready` `roadmap.md:36` |
| R-06 | "Unauthenticated users cannot access any app content — **login wall at root**" — `prd.md:125` | Only `/dashboard` and `/sets` are protected; `/` renders the public starter page ("10x Astro Starter") instead of a login wall | `middleware.ts:4`; `index.astro:1-8`; `Welcome.astro:35-38` |
| R-07 | "the app checks the submitted sequence against **all stored sequences**" — `prd.md:121` | The index for the rule exists in the schema, the rule itself does not; there is also no UNIQUE, so duplicates can arise from seeds too | `migrations/…:28-29`; duplication warning on re-seeding `supabase/algos_seed.sql:4-5` |
| R-08 | Input: "button grid **OR** keyboard shortcuts (letters/numbers **assigned to grid buttons**)" — FR-009 `prd.md:85-86` | Both paths work, but grid buttons never display their assigned keys — the mapping lives solely in the `KEY_TO_MOVE` table; on top of that there are `w`/`2` modifiers the PRD never describes | `PracticeSession.tsx:8-35`, `:249-268` (label = the move itself), `:291-296` |
| R-09 | An algorithm's sequence is domain data in a fixed notation — `prd.md:117,129` | `moves` is free `text` with no validation; the `R2'`/`U2'` incident froze sessions (no error, no advance) and required a manual production data repair outside migrations | `migrations/…:24`; `supabase/fixes/2026-08-24-rotation-notation.sql:6-12,34-56`; test guard `src/test/seedTokens.test.ts:6-11` |
| R-10 | The session result "is recorded against the algorithm and the consecutive-clean count is updated" as one operation — `prd.md:119` | Three independent operations with no transaction (session INSERT ‖ mastery SELECT → mastery UPSERT); a knowingly accepted lost update, plus a possible intermediate state: session written, mastery not | `completePractice.ts:31-44,52-98` |

## Step 5 — Refactor ranking

Scoring: **value** = how deeply the invariant touches the core (recall +
mastery); **risk** = how weakly it is enforced today and how quietly it fails.

| Rank | Candidate | Value | Risk | Rationale |
|---|---|---|---|---|
| **#1** | `MoveSequence` as a Value Object over `Algorithm` (C1, C2, C3; R-09, R-08) | high — notation is the only representation of the domain (Non-Goal: no 3D visualization `prd.md:129`) | **highest** — zero runtime enforcement, the failure is silent (the session stalls, no error), the incident already hit production, and S-04 (`ready`) will hand users free-form notation entry `prd.md:71` | one token grammar shared by input (`dispatchMove`), parsing (`parseMoves`, today duplicated in `MoveSequence.astro:7`) and storage; validation on algorithm creation + a CHECK/trigger in the DB |
| **#2** | `PracticeAttempt` with server-side verification (A3, A4, A6; R-03, R-01, R-02) | highest — this is literally the product guardrail `prd.md:37` | high — the rule exists only in the React reducer; the API trusts the client, so `practice_sessions` and the whole streak rest on a browser's assertion; no idempotency on `RETRY` | move attempt evaluation into a domain module (the server knows `moves`, accepts the entered sequence or a signed result), add the `isClean ⇔ errorCount === 0` consistency check and a session idempotency key |
| **#3** | `AlgorithmMastery` — atomicity and a single source of truth (B4; R-10, R-04) | high — mastery is the definition of "I know it" `prd.md:98` | medium — the streak rule itself is correct and tested; it only fails under concurrency/retry, and `mastery_reached` never regresses | a Postgres RPC doing insert+upsert in one transaction; close FR-014 off the same source while there (`count` over `practice_sessions`) |
| **#4** | `DuplicateDetection` as a rule of the `AlgorithmList` aggregate (C4; R-07) | medium — Supporting, derived from FR-005 `prd.md:72` | low today (no write path), rising with S-04 | close it together with S-04; settle the open question on "exactly matches" semantics `roadmap.md:125` at the same time — once #1's `MoveSequence` normalizes, that question becomes trivial |
| **#5** | `AlgorithmList` / access (D1–D4; R-06) | medium | lowest — the CHECK plus 13 RLS policies genuinely enforce ownership and isolation | just close the login wall on `/` (`middleware.ts:4`); the rest is sound |

**#1 to refactor: `MoveSequence` as a Value Object.** Not because it is the most
core (the most core is `PracticeAttempt`), but because the product of value and
risk peaks here: the rule is enforced at NO layer (DB, API, UI), its violation
already reached production and froze the core loop with no error signal at all,
and the next planned slice (S-04, `ready`) hands users a free text field for that
same sequence `prd.md:71`. #1 is also the precondition for doing #2 and #4
cheaply: server-side attempt verification and duplicate detection both need the
same normalized, validated sequence.

## Limits of this distillation

- Citations come only from files read in this session; `context/archive/` was
  neither opened nor modified (repo rule: the directory is immutable).
- The "enforces/declares/ignores" statuses describe the code on `master` as of
  2026-08-25 (S-03 and S-04 not yet implemented — `roadmap.md:35-36`).
- The PRD is `status: draft` (`prd.md:4`) — divergences R-01…R-10 may just as
  well be a signal to fix the document as the code; that call belongs to the
  product owner.

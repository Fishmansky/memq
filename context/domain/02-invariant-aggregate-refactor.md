---
title: "MemQ — Invariant → Guardian Aggregate: refactor plan for the attempt-integrity invariant"
created: 2026-08-25
type: refactor-plan
---

# From scattered rule to guardian aggregate — `PracticeAttempt`

> This document is a PLAN, not an implementation. No production code was
> modified. Every `file:line` citation was verified against the working tree on
> `master` at 2026-08-25.
> Companion: `context/domain/01-domain-distillation.md` (domain map — Ubiquitous
> Language, subdomains, aggregate candidates, model↔code divergences).

## Step 0 — Context discovery

### Requirements documents that exist

| Document | Path | Sections that carry rules |
|---|---|---|
| PRD (v1, `status: draft`) | `context/foundation/prd.md` | Success Criteria `:28-39`, User Stories + acceptance criteria `:41-53`, Functional Requirements `:55-106`, NFRs `:108-111`, **Business Logic** `:113-121`, Access Control `:123-125`, Non-Goals `:127-133` |
| Roadmap (`status: active`) | `context/foundation/roadmap.md` | delivered vs pending slices `:30-36`; S-03 and S-04 are `ready`, not shipped `:35-36` |
| Test plan | `context/foundation/test-plan.md` | Risk Map `:41-47`, phased rollout `:74-77`, cookbook `:119-250`, **negative space** `:252-260`, freshness triggers `:264-273` |
| Shaping notes | `context/foundation/shape-notes.md` | same FRs plus the record of resolutions |
| Repo rules | `AGENTS.md`, `README.md` | `@/*` alias, no second test runner, three existing suites |

### Stack and the layers business logic lives in

Astro 6 + React 19 + TypeScript strict + Supabase (Postgres + Auth) + Cloudflare
Workers (`README.md:7-13`). Test runners already in place: `npm test` (jsdom
unit), `npm run test:integration` (node + real Supabase), `npm run test:e2e`
(Playwright) — `package.json:10-14`.

| Layer | Where | Business logic actually present |
|---|---|---|
| UI island (browser) | `src/components/app/PracticeSession.tsx` | **the whole recall rule**: `INPUT_MOVE` reducer `:146-175`, tokenizer `parseMoves` `:216-218`, modifier assembly `dispatchMove` `:291-296`, verdict + POST `:318-344` |
| Astro SSR pages | `src/pages/sets/[id].astro:19-37`, `src/pages/sets/[id]/[algoId].astro:22-47`, `src/pages/dashboard.astro:14-26` | inline Supabase queries, no repository layer |
| API route | `src/pages/api/practice/complete.ts:5-57` | auth gate `:6-12`, JSON **shape** validation `:24-35`, delegation `:51` |
| "Domain" module (only one) | `src/lib/practice/streak.ts:22-25`, `src/lib/practice/completePractice.ts:45-107` | streak rule; insert → read → compute → upsert sequence |
| Persistence + DB rules | `supabase/migrations/20260527000000_domain_schema_rls.sql` | 4 tables, ownership CHECK `:12-16`, UNIQUE `(user_id, algorithm_id)` `:51`, RLS + 13 policies `:55-151` |
| Access | `src/middleware.ts:4` | `PROTECTED_ROUTES = ["/dashboard", "/sets"]` |
| Grammar of moves | `src/test/tokenGrammar.ts:9-30` | **a domain rule parked in the test directory**, importing from a React component `:1` |

## Step 1 — Identified business invariants

Rules that must always hold in this domain, drawn from documents *and* code.

| ID | Invariant | Source |
|---|---|---|
| **INV-01** | A recorded practice session corresponds to a reproduction that was actually completed under forced correction, and its verdict (`clean` / `errors`) is **derived** from that reproduction — never asserted by the caller | "No move is silently accepted as correct when it is wrong"; "The session cannot be 'completed' by skipping — every slot must be filled correctly" `prd.md:50-51`; guardrail `prd.md:37`; Business Logic `prd.md:117-119` |
| **INV-02** | A wrong move never advances the position; the learner cannot skip and gets no hints | `prd.md:117`; FR-010 `prd.md:88` |
| **INV-03** | `is_clean` ⇔ `error_count = 0` — the end state is binary | AC `prd.md:52`; `prd.md:119` |
| **INV-04** | One real attempt produces at most one session row | implied by FR-014 "total sessions completed (global count)" `prd.md:101` |
| **INV-05** | A clean run increments the per-algorithm streak by 1; any non-clean run resets it to 0 | `prd.md:119`; FR-013 `prd.md:98` |
| **INV-06** | Mastery triggers at exactly 3 consecutive clean runs and never regresses | FR-013 `prd.md:98` |
| **INV-07** | Recording a session and updating the streak is one atomic fact | "The result … is recorded against the algorithm and the consecutive-clean count is updated" `prd.md:119` |
| **INV-08** | Every token of a stored sequence is a token the learner can actually input | forced by FR-010 `prd.md:88`; grammar in `src/test/tokenGrammar.ts:27-30`; violation incident `supabase/fixes/2026-08-24-rotation-notation.sql:6-12` |
| **INV-09** | A sequence is non-empty and ordered (N slots, one per move) | `prd.md:117` |
| **INV-10** | A system list has no owner; a user list has an owner — no third state | migration comment `:5`; CHECK `:12-16`; FR-003/FR-004 `prd.md:65,68` |
| **INV-11** | A learner's data is unreadable to any other learner on every access path | NFR `prd.md:111` |
| **INV-12** | The same sequence is not stored twice as two algorithms | FR-015 `prd.md:105,121` |
| **INV-13** | Abandoning a session mid-way corrupts neither history nor the streak | AC `prd.md:53` |
| **INV-14** | Move feedback is perceived as instantaneous (< 100 ms) | NFR `prd.md:110` |

## Step 2 — Classification and the pick

Axes: (a) how core to the product's meaning, (b) how smeared across layers,
(c) enforced / merely declared / violable.

| ID | (a) Core-ness | (b) Spread | (c) Enforcement | Evidence |
|---|---|---|---|---|
| **INV-01** | **highest** — it IS the product: "No focused product exists for the memorization training phase" `prd.md:22`; north star S-02 `roadmap.md:24` | **5 files / 4 layers** — reducer, submit effect, route, seam, DB | **violable** — server-side there is none: the route type-checks fields `complete.ts:24-35` and the seam writes what it was handed `completePractice.ts:50-58` | see Step 3 |
| INV-02 | high | 1 file | enforced, **client only** `PracticeSession.tsx:166-174` | reducer test `PracticeSession.reducer.test.ts:33,42` |
| INV-03 | high | 3 files | **declared** — client computes it `PracticeSession.tsx:327`; API never cross-checks the two fields `complete.ts:24-35` | — |
| INV-04 | medium-high (blocks FR-014, S-03 is next `roadmap.md:35`) | 2 files | **violable** — no idempotency key, `RETRY` re-POSTs `PracticeSession.tsx:183-184,318-344`; no UNIQUE `migrations/…:32-39` | — |
| INV-05 | high | 1 file | **enforced** `streak.ts:23` + tests `streak.test.ts:75-89` | — |
| INV-06 | high | 1 file | **enforced** `streak.ts:24`, boundary tests `streak.test.ts:84,88` | — |
| INV-07 | medium-high | 1 file | **violable** — three non-transactional operations, race knowingly accepted `completePractice.ts:31-44,52-98` | test-plan `:46` |
| INV-08 | high | 3 files (component, test dir, seed) | **violable at runtime** — no CHECK `migrations/…:20-27`, no validation in code; guarded only by a text-level test over seed files `src/test/seedTokens.test.ts:50-59` | incident `supabase/fixes/2026-08-24-rotation-notation.sql:6-12` |
| INV-09 | medium | 1 file | **violable** — `parseMoves("")` → `[]` `PracticeSession.reducer.test.ts:90` | — |
| INV-10 | medium | 1 file (DB) | **enforced** — CHECK `migrations/…:12-16` | — |
| INV-11 | high (NFR) | 1 layer (DB) | **enforced** — RLS + 13 policies `migrations/…:55-151` | — |
| INV-12 | medium | 0 files | **absent** — only the index exists `migrations/…:28-29` | S-04 not shipped `roadmap.md:36` |
| INV-13 | medium | 1 file | **enforced** — `STOP` sends nothing `PracticeSession.tsx:186-197` | — |
| INV-14 | medium | 1 file | enforced by construction (pure client reducer) | — |

### Pick: **INV-01 — attempt integrity**

It is simultaneously the most core (it is the guardrail the product is sold on,
`prd.md:37`) and the least enforced (zero server-side enforcement), and it is the
most smeared: the rule that decides what gets written lives in a browser
reducer, while the write happens two layers away.

INV-03, INV-04 and INV-07 are **sub-invariants of the same fact** and get fixed
by the same aggregate — a verdict derived server-side is by construction
consistent (INV-03), a settled attempt has an identity so it can be written once
(INV-04), and one write path can be one transaction (INV-07). INV-08/INV-09 are
the **input contract** of that aggregate and become Phase 1 of this plan.

Why not INV-08 first: `01-domain-distillation.md` ranked `MoveSequence` #1 on
*value × realized risk* (a production incident already happened, and S-04 will
open free-form entry). This document's criterion is different — *core-ness ×
enforcement gap* — and under it INV-01 wins. The two rankings do not conflict:
`MoveSequence` is delivered here as Phase 1, because the aggregate cannot compare
tokens without a validated grammar.

**Honest counter-argument, recorded.** `test-plan.md:252-260` deliberately parks
"client-forged session outcome" as low impact (single-user, self-deception, no
payments). That triage stands — **anti-cheat is not the justification here**. The
justification is domain integrity under non-malicious conditions:

- a `RETRY` after a partial failure writes a second session row for one attempt
  (`PracticeSession.tsx:183-184` → `completePractice.ts:52-58`), and FR-014's
  global count (S-03, next slice `roadmap.md:35`) is exactly a count of those rows;
- nothing rejects `{isClean: true, errorCount: 5}` — one client bug silently
  corrupts the streak and mastery (`complete.ts:24-35`);
- the meaning of "clean" is a browser implementation detail, so any second client
  (e2e harness, a future surface) redefines the domain by accident.

If this plan is adopted, `test-plan.md:260` should be refreshed under its own
trigger `test-plan.md:273` ("§7 negative-space no longer matches what the team
believes") — the reason changes from "we accept forging" to "the outcome is no
longer client-supplied".

## Step 3 — Diagnosis of INV-01

### Where the rule lives today

| # | Layer | Location | What it holds |
|---|---|---|---|
| 1 | Browser reducer | `PracticeSession.tsx:146-175` | the entire comparison: expected token `:148`, match `:149`, advance `:154-155`, completion `:155-160`, wrong-move branch that counts and holds `:166-174` |
| 2 | Browser tokenizer | `PracticeSession.tsx:216-218` | what counts as a token (strips `()`, splits on space) — duplicated in `MoveSequence.astro:7` |
| 3 | Browser token assembly | `PracticeSession.tsx:291-296` | wide → lowercase, double → append `2` |
| 4 | Browser verdict + transport | `PracticeSession.tsx:318-344` | `isClean: errorCount === 0` `:327`; POST of the **conclusion**, not the evidence |
| 5 | API route | `api/practice/complete.ts:24-41` | validates only `typeof` of three fields; no domain check |
| 6 | Seam | `completePractice.ts:50-58` | inserts exactly what it was handed |
| 7 | DB | `migrations/…:32-39` | column types; no CHECK tying `is_clean` to `error_count`; no attempt identity |
| 8 | Grammar (tests) | `src/test/tokenGrammar.ts:9-30` | the producible-token set, in the test tree, importing the React component `:1` |

### Diagnosis

1. **The client is the only guardian.** Layers 5–7 are transport. A verdict is a
   domain conclusion, and the server accepts it as an input parameter
   (`complete.ts:37-41` → `completePractice.ts:50`).
2. **Enforced inconsistently across fields.** `errorCount` and `isClean` travel as
   two independent numbers/booleans; nothing checks INV-03 (`complete.ts:24-35`).
   The client happens to compute them consistently `PracticeSession.tsx:327` —
   that consistency is a coincidence of one implementation, not a contract.
3. **The evidence never leaves the browser.** The submitted token sequence exists
   only in reducer state and is discarded on submit; the server cannot re-derive
   or audit anything (`PracticeSession.tsx:318-344`).
4. **Dependency direction is inverted.** The domain grammar lives under
   `src/test/` and imports from a UI component (`tokenGrammar.ts:1`). Production
   code cannot legally depend on it, so the rule can only ever be a test.
5. **A swallowed error, not a stop.** The FK violation path maps a *domain*
   failure (unknown algorithm) to a status code after the fact
   (`completePractice.ts:67-74`), rather than refusing before any write. And when
   the mastery upsert fails after the session insert succeeded
   (`completePractice.ts:95-98`), the caller sees `500` while a session row is
   already persisted — a partial fact.
6. **No identity for the attempt.** `RETRY` re-enters `submitting`
   (`PracticeSession.tsx:183-184`) and the effect re-POSTs `:318-344`; nothing
   deduplicates (`migrations/…:32-39` has no unique key besides the PK).
7. **Not atomic.** Insert ‖ read → upsert, non-transactional, documented and
   accepted `completePractice.ts:31-44`.

## Step 4 — Design: the guardian aggregate

### Placement

```
src/lib/domain/
  notation/
    moveGrammar.ts        # producible-token set (moved out of src/test/)
    MoveToken.ts          # value object
    MoveSequence.ts       # value object: non-empty, ordered, all tokens valid
  practice/
    PracticeAttempt.ts    # AGGREGATE ROOT — the only place INV-01/02/03 is enforced
    AttemptVerdict.ts     # value object, only constructible by a settled attempt
    errors.ts             # named domain errors
    PracticeAttemptRepository.ts
```

Direction of dependency reverses: `PracticeSession.tsx` and
`src/test/tokenGrammar.ts` will import from `src/lib/domain/notation/*`, not the
other way round.

### Value objects

```ts
// MoveToken — a token the app can actually produce (INV-08)
export class MoveToken {
  private constructor(readonly value: string) {}
  static parse(raw: string): MoveToken;          // throws UnknownMoveTokenError
  equals(other: MoveToken): boolean;
}

// MoveSequence — an algorithm's moves as domain data (INV-08, INV-09)
export class MoveSequence {
  private constructor(readonly tokens: readonly MoveToken[]) {}
  static parse(raw: string): MoveSequence;       // throws EmptySequenceError | UnknownMoveTokenError
  get length(): number;
  at(index: number): MoveToken;
  canonical(): string;                           // normalized form — reused later by INV-12 / FR-015
}

// AttemptVerdict — a derived conclusion; no public constructor
export class AttemptVerdict {
  private constructor(readonly isClean: boolean, readonly errorCount: number) {}
  // INV-03 holds by construction: isClean === (errorCount === 0)
}
```

### Aggregate root

```ts
export type SubmitOutcome = "correct" | "wrong";

export class PracticeAttempt {
  private constructor(
    readonly attemptId: AttemptId,       // client-generated UUID = idempotency key (INV-04)
    readonly learnerId: LearnerId,
    readonly algorithmId: AlgorithmId,
    private readonly sequence: MoveSequence,
    private position: number,
    private errorCount: number,
    private settled: boolean,
  ) {}

  static open(args: {
    attemptId: AttemptId; learnerId: LearnerId;
    algorithmId: AlgorithmId; sequence: MoveSequence;
  }): PracticeAttempt;

  /** Precondition: !settled. Wrong token never advances position (INV-02). */
  submit(token: MoveToken): SubmitOutcome;       // throws AttemptAlreadySettledError

  get isComplete(): boolean;                     // position === sequence.length

  /** Precondition: isComplete. Derives the verdict (INV-01, INV-03). */
  settle(): AttemptVerdict;                      // throws AttemptNotCompleteError

  /** Server-side replay of a submitted log — the only way the API builds an attempt. */
  static replay(args: {
    attemptId: AttemptId; learnerId: LearnerId;
    algorithmId: AlgorithmId; sequence: MoveSequence; log: readonly MoveToken[];
  }): { attempt: PracticeAttempt; verdict: AttemptVerdict };
  // throws AttemptLogTooLongError | AttemptNotCompleteError | UnknownMoveTokenError
}
```

Pseudocode for the two load-bearing methods:

```
submit(token):
    if settled                        -> throw AttemptAlreadySettledError
    expected = sequence.at(position)
    if token.equals(expected):
        position += 1
        return "correct"
    errorCount += 1                   # position deliberately unchanged (INV-02)
    return "wrong"

settle():
    if not isComplete                 -> throw AttemptNotCompleteError(position, sequence.length)
    if settled                        -> throw AttemptAlreadySettledError
    settled = true
    return AttemptVerdict.from(errorCount)      # isClean := errorCount === 0

replay(log):
    if log.length > MAX_ATTEMPT_LOG   -> throw AttemptLogTooLongError    # fail-fast bound
    attempt = open(...)
    for token in log: attempt.submit(token)
    return { attempt, verdict: attempt.settle() }   # incomplete log throws — no write happens
```

Named domain errors (`errors.ts`), each carrying the data needed for the HTTP
mapping — **no silent state update, ever**:
`UnknownMoveTokenError`, `EmptySequenceError`, `AttemptAlreadySettledError`,
`AttemptNotCompleteError`, `AttemptLogTooLongError`, `AlgorithmNotFoundError`,
`AttemptAlreadyRecordedError`.

### Repository

Replaces scattered queries with two operations; the load is the only place the
algorithm's `moves` is read for practice purposes.

```ts
export interface PracticeAttemptRepository {
  /** Loads the algorithm the attempt is about; enforces INV-08/09 at the boundary. */
  loadAlgorithm(algorithmId: AlgorithmId): Promise<{ id: AlgorithmId; sequence: MoveSequence }>;
  //   throws AlgorithmNotFoundError (RLS-invisible row is "not found", never "empty")
  //   throws UnknownMoveTokenError  (corrupt stored content stops the operation — fail-fast)

  /** One transaction: session row + streak update (INV-04, INV-05..07). */
  record(attempt: PracticeAttempt, verdict: AttemptVerdict): Promise<MasteryState>;
  //   throws AttemptAlreadyRecordedError on a duplicate attemptId
}
```

Atomicity — one Postgres function, called via `supabase.rpc()` with the
**user's** (RLS-governed) client, so INV-11 is untouched:

```sql
-- new migration; SECURITY INVOKER so RLS still applies
CREATE FUNCTION public.record_practice_attempt(
    p_attempt_id  uuid,
    p_algorithm_id uuid,
    p_is_clean    boolean,
    p_error_count integer
) RETURNS TABLE (consecutive_clean integer, mastery_reached boolean)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
    INSERT INTO public.practice_sessions (attempt_id, user_id, algorithm_id, is_clean, error_count)
    VALUES (p_attempt_id, auth.uid(), p_algorithm_id, p_is_clean, p_error_count);
    -- ON CONFLICT (attempt_id) is NOT swallowed: the unique violation propagates and the
    -- repository maps it to AttemptAlreadyRecordedError (INV-04, fail-fast).

    RETURN QUERY
    INSERT INTO public.algorithm_mastery (user_id, algorithm_id, consecutive_clean, mastery_reached)
    VALUES (auth.uid(), p_algorithm_id, CASE WHEN p_is_clean THEN 1 ELSE 0 END, false)
    ON CONFLICT (user_id, algorithm_id) DO UPDATE
       SET consecutive_clean = CASE WHEN p_is_clean THEN algorithm_mastery.consecutive_clean + 1 ELSE 0 END,
           mastery_reached   = algorithm_mastery.mastery_reached
                               OR (CASE WHEN p_is_clean THEN algorithm_mastery.consecutive_clean + 1 ELSE 0 END) >= 3,
           updated_at        = now()
    RETURNING algorithm_mastery.consecutive_clean, algorithm_mastery.mastery_reached;
END $$;
```

Schema changes in the same migration:

```sql
ALTER TABLE public.practice_sessions ADD COLUMN attempt_id uuid;          -- backfill: gen_random_uuid()
ALTER TABLE public.practice_sessions ALTER COLUMN attempt_id SET NOT NULL;
ALTER TABLE public.practice_sessions ADD CONSTRAINT practice_sessions_attempt_unique UNIQUE (attempt_id);
ALTER TABLE public.practice_sessions ADD CONSTRAINT practice_sessions_clean_check
    CHECK ((is_clean AND error_count = 0) OR (NOT is_clean AND error_count > 0));  -- INV-03 as a last line
```

**Trade-off, stated openly:** the increment rule now exists twice — in
`computeStreak` (`streak.ts:22-25`, TS) and in the RPC (SQL). The alternative
that keeps one implementation is compare-and-set (`UPDATE … WHERE
consecutive_clean = expected`, retry on 0 rows), which trades duplication for a
retry loop. Recommendation: keep the SQL increment (atomic by construction, no
retry) and pin both against **one shared table of cases whose oracle is the PRD**
(`prd.md:98,119`) in the integration suite — the tautology trap the cookbook
warns about `test-plan.md:208`.

### Thin route

`src/pages/api/practice/complete.ts` shrinks to: parse → aggregate → error map.

```ts
// 1. auth gate (unchanged, complete.ts:6-12)
// 2. parse: { attemptId: uuid, algorithmId: uuid, moveLog: string[] }  ← evidence, not a verdict
// 3. const { sequence } = await repo.loadAlgorithm(algorithmId)
//    const { verdict }  = PracticeAttempt.replay({ ...ids, sequence, log: moveLog.map(MoveToken.parse) })
//    const mastery      = await repo.record(attempt, verdict)
// 4. 200 { isClean, errorCount, consecutiveClean, masteryReached }
```

| Domain error | HTTP | Body |
|---|---|---|
| `UnknownMoveTokenError` | 400 | `{ error: "invalid_move_token", token }` |
| `AttemptLogTooLongError` | 400 | `{ error: "attempt_log_too_long" }` |
| `AlgorithmNotFoundError` | 400 | `{ error: "Invalid algorithmId" }` (wire-compatible with `completePractice.ts:70`) |
| `AttemptNotCompleteError` | 422 | `{ error: "attempt_incomplete", position, length }` |
| `AttemptAlreadyRecordedError` | 200 | the stored verdict + mastery (idempotent replay — `RETRY` becomes safe) |
| anything else | 500 | `{ error: "Failed to record session" }` + `console.error` (as today `completePractice.ts:72`) |

Enforcement moves from the client to the server. The client keeps only what NFR
`prd.md:110` requires: optimistic slot coloring within 100 ms. It no longer
*decides* anything that gets persisted — it records the move log and sends it.

## Step 5 — Before / after, phases, tests

### Before / after per site

| Site today | Before | After |
|---|---|---|
| `PracticeSession.tsx:146-175` | reducer decides correct/wrong **and** owns the persisted truth | reducer stays for instant feedback (NFR `prd.md:110`) and appends each token to `moveLog`; it is a view of the rule, not its owner |
| `PracticeSession.tsx:216-218` + `MoveSequence.astro:7` | the tokenizer duplicated in two files | both import `MoveSequence.parse` from `src/lib/domain/notation` |
| `PracticeSession.tsx:327` | client computes `isClean` and ships the conclusion | client ships `{ attemptId, algorithmId, moveLog }`; the verdict arrives in the response |
| `PracticeSession.tsx:183-184,318-344` | `RETRY` may write a second session row | same `attemptId` is retried → `AttemptAlreadyRecordedError` → 200 replay (INV-04) |
| `PracticeSession.tsx:381-392,417-431` | slots always end all-green; yellow exists only as a banner (divergence R-01, `01-domain-distillation.md`) | end state painted from the server verdict: all-green / all-yellow per FR-011 `prd.md:91-92` |
| `api/practice/complete.ts:24-41` | `typeof` checks on three fields, no domain check | parse → aggregate → named-error map; no domain branch in the route |
| `completePractice.ts:50-58` | writes what it was handed | deleted; replaced by `PracticeAttemptRepository.record` |
| `completePractice.ts:52-98` | insert ‖ read → upsert, non-atomic, accepted race `:31-44` | one `rpc('record_practice_attempt')` call, one transaction (INV-07) |
| `streak.ts:22-25` | pure rule, correct, called from the seam | unchanged as the TS rule; mirrored in SQL, pinned by a parity test |
| `src/test/tokenGrammar.ts:1-30` | domain grammar in the test tree importing a React component | moves to `src/lib/domain/notation/moveGrammar.ts`; the test file re-exports it so `seedTokens.test.ts` / `parity.test.ts` keep working |
| `migrations/…:32-39` | no attempt identity, no `is_clean`/`error_count` link | `attempt_id` UNIQUE + CHECK on the pair |

### Phases

The project has an established test-first-friendly discipline (three runners,
cookbook `test-plan.md:119-250`, "oracle = the intended rule, never the function
under test"). Phases 1–3 are pure logic and DB behavior → **test-first**. Phases
4–6 are wiring → tests-alongside.

| Phase | Scope | Mode | Gate |
|---|---|---|---|
| **P0** | Move the grammar out of `src/test/tokenGrammar.ts` into `src/lib/domain/notation/moveGrammar.ts`; re-export from the old path. Behavior-neutral. | refactor | `npm test` green unchanged (`seedTokens.test.ts`, `parity.test.ts`) |
| **P1** | `MoveToken` + `MoveSequence` VOs (INV-08, INV-09) | **test-first** | `npm test` |
| **P2** | `PracticeAttempt` + `AttemptVerdict` + `errors.ts` (INV-01, INV-02, INV-03) — pure, no I/O | **test-first** | `npm test` |
| **P3** | Migration: `attempt_id` UNIQUE, CHECK, `record_practice_attempt` RPC (INV-04, INV-07) + regenerate `src/db/database.types.ts` | **test-first** at the integration layer | `npm run test:integration` (local stack) |
| **P4** | `PracticeAttemptRepository` + rewrite of `completePractice.ts` to `recordPracticeAttempt` seam; route becomes thin. Route accepts **both** shapes for one release (`moveLog` present → new path; legacy `{isClean, errorCount}` → old path, deprecation `console.warn`) so an open browser tab holding old JS is not broken by a deploy. | tests-alongside (hermetic seam tests, `test-plan.md:211-216`) | `npm test` + `npm run test:integration` |
| **P5** | Client rewiring: `moveLog` + stable `attemptId` per attempt; server verdict drives banner and end-state slot color (fixes R-01) | tests-alongside (component + e2e) | `npm test`, `npm run test:e2e` (`playwright/test/practice-loop-persistence.spec.ts`) |
| **P6** | Remove the legacy branch, remove the duplicated tokenizer in `MoveSequence.astro:7`, refresh `test-plan.md:260` under trigger `:273` | cleanup | full stack |

Ordering constraint: **P3 before P4** (types must exist before the repository
compiles), **P4 before P5** (server must accept the new shape before the client
sends it), and P6 only after one release of P4/P5 has shipped.

Out of scope here, unblocked by it: FR-014 (S-03) can count `practice_sessions`
rows once INV-04 holds; FR-015 (S-04) can reuse `MoveSequence.canonical()` for
duplicate detection, which also settles the open "exactly matches" question
`roadmap.md:125`.

### Test cases for the invariant

**Legal (must succeed):**

1. Full correct sequence in order → verdict `{isClean: true, errorCount: 0}`; one session row; streak `+1`.
2. Sequence with 2 wrong tokens, all corrected, completed → `{isClean: false, errorCount: 2}`; streak resets to 0.
3. Wrong token repeated 5× on the same slot, then the correct one → `errorCount = 5`, position advances exactly once.
4. Third consecutive clean attempt on the same algorithm → `masteryReached: true` at exactly 3, not at 2 (oracle: `prd.md:98`).
5. A clean attempt on algorithm B leaves algorithm A's row untouched (per-algorithm streak, `prd.md:98`).
6. Replaying the *same* `attemptId` → 200 with the identical verdict, and still exactly one session row (INV-04).
7. Parentheses in stored `moves` are grouping only — `(R U R') U'` accepts the same log as `R U R' U'` (rule discovered in `PracticeSession.tsx:217`).

**Illegal (must throw a named error, write nothing):**

8. Log shorter than the sequence → `AttemptNotCompleteError`; **zero** rows written.
9. Log ending on a wrong token → `AttemptNotCompleteError` (a wrong token never completes, INV-02).
10. Log containing a token outside the grammar (`R2'` — the historical incident, `supabase/fixes/2026-08-24-rotation-notation.sql:6-12`) → `UnknownMoveTokenError`, 400, nothing written.
11. Log longer than `MAX_ATTEMPT_LOG` → `AttemptLogTooLongError`, nothing written.
12. `algorithmId` that does not exist or is invisible under RLS → `AlgorithmNotFoundError`, nothing written (today: an FK error mapped after the attempt to write, `completePractice.ts:67-74`).
13. `submit()` after `settle()` → `AttemptAlreadySettledError`.
14. `settle()` on an incomplete attempt → `AttemptNotCompleteError`.
15. A stored algorithm whose `moves` is empty → `EmptySequenceError` on load; the practice page fails loudly instead of rendering a 0-slot session (INV-09).
16. Direct SQL insert of `{is_clean: true, error_count: 3}` → rejected by the CHECK (INV-03's last line of defense).
17. Two concurrent completions for the same `(user, algorithm)` with **distinct** `attemptId`s → streak `+2`, no lost update (the race documented at `completePractice.ts:31-44` and `test-plan.md:46`).
18. Streak parity: the same case table drives `computeStreak` (TS) and the RPC (SQL) and both must agree (guards the duplication introduced in P3).

Layering per the cookbook: 1–4, 8–11, 13–14 as pure unit tests (`npm test`,
`test-plan.md:125-141`); 5–6, 12, 15–18 as integration (`*.int.test.ts`,
`test-plan.md:158-189`), asserting the **persisted read-back**, never the
response body alone (`test-plan.md:208`); 7 stays a unit test on `MoveSequence`;
one e2e keeps proving the browser-observable streak
(`playwright/test/practice-loop-persistence.spec.ts`).

### New load-bearing names to register

The repo keeps no formal contract registry (verified — no such file under
`context/foundation/`), so these belong in `AGENTS.md` (hard rules),
`context/foundation/lessons.md`, and the change folder opened via `/10x-new`:

| Name | Kind | Contract |
|---|---|---|
| `PracticeAttempt` | aggregate root | the only place a session verdict may be produced |
| `AttemptVerdict` | value object | constructible only by `settle()`; `isClean ⇔ errorCount === 0` |
| `MoveToken`, `MoveSequence` | value objects | the only legal parse of `algorithms.moves` and of learner input |
| `MoveSequence.canonical()` | method | the normal form later reused by FR-015 duplicate detection |
| `attemptId` | wire + column | client-generated UUID; idempotency key for one attempt |
| `moveLog` | wire field | evidence replacing the `isClean`/`errorCount` verdict fields |
| `record_practice_attempt` | Postgres function | the single transactional write path for a finished attempt |
| `practice_sessions.attempt_id` (UNIQUE) | constraint | INV-04 in the database |
| `practice_sessions_clean_check` | constraint | INV-03 in the database |
| `UnknownMoveTokenError`, `EmptySequenceError`, `AttemptAlreadySettledError`, `AttemptNotCompleteError`, `AttemptLogTooLongError`, `AlgorithmNotFoundError`, `AttemptAlreadyRecordedError` | domain errors | fail-fast vocabulary; each maps to exactly one HTTP status |
| `MAX_ATTEMPT_LOG` | constant | bound on submitted evidence |

## Limits of this plan

- No production code was modified; all `file:line` citations were verified on
  `master` at 2026-08-25.
- The PRD is `status: draft` (`prd.md:4`), so divergences may equally be a reason
  to amend the document — that call belongs to the product owner.
- Adopting this plan changes a recorded team decision (`test-plan.md:260`); it
  should be refreshed via the ledger's own trigger (`test-plan.md:273`) rather
  than silently contradicted.
- The RPC assumes `SECURITY INVOKER` so RLS (INV-11) keeps applying; that must be
  proven by the two-account tests already scheduled as rollout Phase 3
  (`test-plan.md:76`), not assumed.

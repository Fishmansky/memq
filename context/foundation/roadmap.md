---
project: MemQ
version: 1
status: draft
created: 2026-05-25
updated: 2026-06-01
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: MemQ

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

MemQ targets intermediate Rubik's cube learners who can already solve the cube but need to drill algorithm sequences (OLL, PLL, CFOP) to execute them from memory reliably. Existing cube tools focus on timing and scrambling; none provide a structured recall-training loop — the gap between "knowing an algorithm exists" and "executing it from memory." The product fills that gap with a forced-recall session where every wrong move must be corrected before the learner can advance, and progress persists across browser sessions.

## North star

**S-02: Learner can practice a pre-built algorithm and get immediate move feedback** — proves the core product hypothesis — that the forced-recall loop (correct move advances; wrong move blocks until fixed; green/yellow result + streak counter) produces a usable memorization tool — and is placed as early as Prerequisites allow because everything else only matters if this works.

> "North star" here means: the smallest end-to-end slice whose successful delivery would prove the core product hypothesis — placed as early as Prerequisites allow because everything else only matters if this works.

## At a glance

| ID   | Change ID                      | Outcome (user can …)                                                                                                                      | Prerequisites          | PRD refs                                          | Status   |
|------|--------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------|------------------------|---------------------------------------------------|----------|
| F-01 | domain-schema-rls              | (foundation) all domain tables and per-user row-level isolation are live; client can read/write domain data                               | —                      | NFR (data isolation)                              | ready    |
| S-01 | browse-prebuilt-view-algorithm | sign in, land on pre-built algorithm sets within 2 clicks, browse algorithms in any set, open one to read its full move sequence           | F-01                   | FR-001, FR-002, FR-003, FR-006, FR-007            | done     |
| S-02 | practice-session-core-loop     | start a practice session, input moves via button grid or keyboard, get immediate red/green/yellow slot feedback, see streak counter, get "You're PRO!" on 3rd consecutive clean run | F-01, S-01 | US-01, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013 | done     |
| S-03 | progress-tracking              | view total sessions completed globally (persists across browser sessions)                                                                  | S-02                   | FR-014                                            | ready    |
| S-04 | custom-list-algorithm-entry    | create a custom algorithm list, add algorithms by name + move sequence, and receive a duplicate-detection prompt when the sequence matches an existing algorithm | F-01 | FR-004, FR-005, FR-015 | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme              | Chain                              | Note                                                                                    |
|--------|--------------------|------------------------------------|-----------------------------------------------------------------------------------------|
| A      | Core practice loop | `F-01` → `S-01` → `S-02` → `S-03` | North star proven (S-02 done). S-01 content decision resolved (Open Q 1). S-03 next — ready. |
| B      | Custom content     | `S-04`                             | Parallel with S-01 after F-01; independent track with no content-curation dependency.   |

## Baseline

What's already in place in the codebase as of 2026-05-25 (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6.3.1 + React 19 + Tailwind v4; pages: index, dashboard, auth/* (`src/pages/`)
- **Backend / API:** partial — auth-only API routes (signin/signup/signout, `src/pages/api/auth/`); middleware guards `/dashboard`; no domain routes yet
- **Data:** partial — Supabase client configured (`src/lib/supabase.ts`); `supabase/config.toml` present; no schema or migrations yet
- **Auth:** present — Supabase email+password, cookie-based sessions, route middleware, full auth pages (`src/pages/auth/`, `src/middleware.ts`)
- **Deploy / infra:** present — `wrangler.jsonc` (Cloudflare Workers), GitHub Actions CI/CD auto-deploys on master push (`.github/workflows/ci.yml`)
- **Observability:** absent — no logging, error tracking, or metrics

## Foundations

### F-01: Domain schema + RLS

- **Outcome:** (foundation) all domain tables exist in Supabase (algorithm_lists, algorithms, practice_sessions with consecutive-clean streak tracking); row-level security policies enforce per-user data isolation; the Supabase client can read and write domain data for all downstream slices.
- **Change ID:** domain-schema-rls
- **PRD refs:** NFR ("each authenticated user's data is strictly isolated — no user's data is readable or discoverable by another user under any access path"), FR-003 (pre-built algorithms must be queryable), FR-004, FR-005, FR-008, FR-013 (streak counter persisted per algorithm)
- **Unlocks:** S-01 (browse pre-built sets), S-02 (practice session, transitively via S-01), S-04 (custom list entry)
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Every domain slice depends on this foundation; any schema or RLS gap here cascades. Test RLS with two distinct accounts before marking any downstream slice ready — a policy hole at this layer can leak progress data between users.
- **Status:** ready

## Slices

### S-01: Browse pre-built algorithm sets + view algorithm

- **Outcome:** user can sign in (or sign up), land on a list of pre-built algorithm sets within 2 clicks, browse the algorithms in any set, and open an algorithm to read its full move sequence
- **Change ID:** browse-prebuilt-view-algorithm
- **PRD refs:** FR-001, FR-002, FR-003, FR-006, FR-007
- **Prerequisites:** F-01; pre-built algorithm content seeded into the database
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:**
  - Which algorithm sets (OLL subset, full PLL, CFOP beginner?) ship at launch, and who seeds the database rows? — Owner: user. Block: yes.
- **Risk:** This slice is on the critical path to the north star (S-02 depends on it). Resolving the content question — even with a minimal seed of 5–10 standard OLL algorithms — immediately unblocks Stream A. Delay here delays the entire north star path.
- **Status:** done

### S-02: Practice session — core loop

- **Outcome:** user can start a practice session for any algorithm, input moves via a button grid or keyboard shortcuts (letters/numbers mapped to grid buttons), receive immediate per-move feedback (wrong move → slot turns red, must input correct move to advance), see all slots turn green on a zero-error attempt or yellow on a completed-with-errors attempt, have the result persisted to their streak counter, and see "You're PRO!" after 3 consecutive mistake-free sessions for the same algorithm
- **Change ID:** practice-session-core-loop
- **PRD refs:** US-01, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013
- **Prerequisites:** F-01, S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Move validation latency: client-side DOM comparison must stay under 100 ms per NFR; verify on the Cloudflare Workers runtime before considering this slice done. — Owner: user. Block: no.
- **Risk:** The dual-input model (button grid + keyboard shortcuts, FR-009) is the most non-trivial UI component in the MVP. With `main_goal: speed`, ship the grid first; keyboard shortcuts can follow in the same slice but are scoped last. Both are must-have per PRD.
- **Follow-up:** `moves-grid-update` (open) — rework grid layout; some buttons too small/misplaced. UI polish on the delivered slice, tracked as its own change.
- **Status:** done

### S-03: Progress tracking

- **Outcome:** user can view their total sessions completed (a single global count, persisted across browser sessions)
- **Change ID:** progress-tracking
- **PRD refs:** FR-014
- **Prerequisites:** S-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Smallest slice; depends entirely on session recording from S-02 being correct. Low implementation risk. Sequenced last in Stream A.
- **Status:** ready (S-02 prerequisite delivered)

### S-04: Custom list creation + algorithm addition + duplicate detection

- **Outcome:** user can create a custom algorithm list, add algorithms to it by name and move sequence, and when a submitted sequence exactly matches an existing algorithm (pre-built or user-created), the app surfaces the existing entry so the learner can add it to their list instead of creating a duplicate
- **Change ID:** custom-list-algorithm-entry
- **PRD refs:** FR-004, FR-005, FR-015
- **Prerequisites:** F-01
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:**
  - Duplicate detection match semantics: PRD says "exactly matches" — confirm this means literal string equality (R ≠ R1, F' ≠ f') and not notation-normalized comparison. — Owner: user. Block: no.
- **Risk:** Duplicate detection (FR-015) scans all stored sequences; ensure the query is index-backed at the schema layer (F-01). At `data_volume: small` this is low risk, but the index should be designed in F-01, not retrofitted here.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                      | Suggested issue title                                        | Ready for `/10x-plan` | Notes                                                                                 |
|------------|--------------------------------|--------------------------------------------------------------|-----------------------|---------------------------------------------------------------------------------------|
| F-01       | domain-schema-rls              | Domain schema + Supabase RLS for MemQ                        | yes                   | Run `/10x-plan domain-schema-rls`; must complete before any domain slice              |
| S-01       | browse-prebuilt-view-algorithm | Browse pre-built algorithm sets + view algorithm             | yes                   | Content seeded in supabase/algos_seed.sql; run `/10x-plan browse-prebuilt-view-algorithm` |
| S-02       | practice-session-core-loop     | Practice session core loop (move input + feedback + streak)  | done                  | Archived 2026-05-29 → `context/archive/2026-05-28-practice-session-core-loop/`        |
| S-03       | progress-tracking              | Progress tracking — total sessions completed                 | yes                   | S-02 done; run `/10x-plan progress-tracking`                                          |
| S-04       | custom-list-algorithm-entry    | Custom algorithm list + algorithm entry + duplicate detection | no                    | Proposed; ready after F-01 — run `/10x-plan custom-list-algorithm-entry` in parallel with S-01 |

## Open Roadmap Questions

1. **Which pre-built algorithm sets ship at launch, and who seeds the database?** — Owner: user. Block: S-01 (and transitively S-02 — the north star).
Answer: pre-built algorithms are stored in supabase/algos_seed.sql - it has been already supplied to production database

## Parked

- **No 3D cube visualization** — Why parked: PRD §Non-Goals; avoids rendering scope spike; MVP is recall training only.
- **No sharing or social features** — Why parked: PRD §Non-Goals; lists are private in MVP.
- **No mobile app** — Why parked: PRD §Non-Goals; button grid + keyboard model is desktop-first.
- **No offline-first** — Why parked: PRD §Non-Goals; progress lives server-side, no service workers.
- **Per-algorithm practice history** — Why parked: FR-014 nice-to-have variant; total global count only is must-have for MVP.

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches the item is archived.)

- **S-01: user can sign in (or sign up), land on a list of pre-built algorithm sets within 2 clicks, browse the algorithms in any set, and open an algorithm to read its full move sequence** — Archived 2026-05-27 → `context/archive/2026-05-27-browse-prebuilt-view-algorithm/`. Lesson: —.
- **S-02: user can start a practice session, input moves via button grid or keyboard, get immediate red/green/yellow slot feedback, see streak counter, and "You're PRO!" after 3 consecutive clean runs** — Archived 2026-05-29 → `context/archive/2026-05-28-practice-session-core-loop/`. North star delivered. Lesson: streak UPSERT uses fetch-then-compute-then-upsert (no field-level increment in Supabase); accepted lost-update race for single-user profile. Grid layout polish split into `moves-grid-update`.

---
project: "MemQ"
version: 1
status: draft
created: 2026-05-18
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

Intermediate Rubik's cube learners already know how to solve the cube with a beginner method, but the jump to faster methods (OLL, PLL, CFOP) requires memorizing tens of algorithm sequences. The current practice loop — read the notation, try to reproduce it on a physical cube, fail, re-read — has no feedback mechanism. The learner cannot know whether they remembered an algorithm correctly, partially, or in the wrong order without someone watching or comparing against the source.

Existing cube tooling is optimized for speedsolvers: timers, scramblers, analysis. No focused product exists for the memorization training phase — the moment between "I know this algorithm exists" and "I can execute it from memory reliably."

## User & Persona

**Primary persona**: An intermediate cube learner — someone who can complete a solve using a beginner method and is now building a repertoire of algorithms (OLL, PLL, or similar two-look / full-set methods). They're typically learning on evenings or weekends, using notation sheets or YouTube videos as their primary sources. The moment they reach for this product: they have a list of algorithms to memorize and no reliable way to drill recall beyond re-reading.

## Success Criteria

### Primary
- Learner correctly executes ≥ 5 algorithm sequences from memory (zero mistakes in a session, end-to-end through the full practice loop).

### Secondary
- Learner creates at least 1 custom algorithm list with at least 1 algorithm of their own.

### Guardrails
- Move validation never silently accepts a wrong move — every input is either confirmed correct or marked wrong immediately.
- Practice history (sessions completed, mistake counts) persists across browser sessions; closing and reopening the app does not lose progress data.
- A first-time user reaches their first practice session within 2 clicks of logging in — no onboarding, no tutorial required.

## User Stories

### US-01: Learner completes a practice session from memory

- **Given** a logged-in learner who has opened an algorithm from a list
- **When** they choose "Practise" and input the full move sequence using the button grid or keyboard shortcuts
- **Then** each correct move advances the sequence; each wrong move highlights red and blocks progress until corrected; slots turn green (perfect attempt) or yellow (attempt with errors); the post-session screen shows outcome (errors → repeat/exit prompt; clean → streak counter updated, "You're PRO!" shown only on 3rd consecutive clean run for this algorithm)

#### Acceptance Criteria
- No move is silently accepted as correct when it is wrong
- The session cannot be "completed" by skipping — every slot must be filled correctly
- End state color is always binary: all-green (zero errors) or all-yellow (≥ 1 error)
- Leaving the session mid-way does not corrupt progress history or the consecutive-clean streak counter

## Functional Requirements

### Authentication
- FR-001: Learner can register a new account. Priority: must-have
  > Socrates: Counter-argument considered: "registration adds friction before first value — delay auth." Resolution: kept as-is; multi-user + persisted progress means auth is load-bearing from day one.

- FR-002: Learner can log in to their account. Priority: must-have
  > Socrates: Counter-argument considered: "session persistence removes need for explicit login on repeat visits." Resolution: kept; explicit login is needed on first visit and after session expiry. Long-lived sessions reduce friction on return visits — that's an implementation detail, not a reason to remove the FR.

### Algorithm Lists
- FR-003: Learner can view pre-built algorithm sets included with the app. Priority: must-have
  > Socrates: Counter-argument considered: "pre-built content is curation work before any code ships." Resolution: kept; empty-state on day one kills activation. Pre-built sets are the hook that lets learners practice immediately.

- FR-004: Learner can create a custom algorithm list. Priority: must-have
  > Socrates: Counter-argument considered: "list creation is overhead before the learner experiences the core loop — cut if pre-built sets ship." Resolution: kept; user-created lists are a stated success criterion (≥ 1 list created).

- FR-005: Learner can add an algorithm (name + move sequence) to a custom list. Priority: must-have
  > Socrates: Counter-argument considered: "free-form notation input is a UX trap." Resolution: modified — when a learner inputs a move sequence that matches an existing algorithm, the app detects the duplicate and proposes the existing algorithm instead of creating a new entry (captured as FR-015).

- FR-006: Learner can browse algorithms within any list. Priority: must-have
  > Socrates: No counter-argument. Browsing is the discovery layer before choosing to practise or view.

### Algorithm View
- FR-007: Learner can view the full move sequence of an algorithm. Priority: must-have
  > Socrates: No counter-argument. View and practise are separate intentions; a learner studies before they drill.

### Practice Session
- FR-008: Learner can start a practice session for any algorithm. Priority: must-have
  > Socrates: No counter-argument. Practice access is unrestricted — the learner decides what to drill.

- FR-009: Learner can input moves during a practice session via a button grid OR keyboard shortcuts (letters/numbers assigned to grid buttons). Priority: must-have
  > Socrates: Counter-argument considered: "button grid alone is slow for long sequences." Resolution: modified — both input methods ship together. Grid buttons have assigned keyboard labels so the learner can click or type interchangeably.

- FR-010: Learner receives immediate feedback on each move — wrong move highlighted red, must input the correct move to advance. Priority: must-have
  > Socrates: No counter-argument. Forced-correct is deliberate recall training design.

- FR-011: Learner sees all slots turn green on a perfect attempt (no wrong moves), yellow on a completed-with-errors attempt. Priority: must-have
  > Socrates: Counter-argument considered: "if mid-attempt errors occur, should it still go all-green?" Resolution: modified — color model revised. Red = current wrong move in progress. Yellow = sequence completed but with ≥ 1 error during the attempt. Green = sequence completed with zero errors.

- FR-012: Learner is offered "Repeat or Exit" after completing a session with at least one mistake. Priority: must-have
  > Socrates: Counter-argument considered: "two post-session states may confuse users." Resolution: kept; the binary branch (errors vs. clean) maps directly to the feedback loop. Both screens can be unified in visual design while keeping distinct messaging.

- FR-013: Learner sees "You're PRO!" and is offered a new session after 3 consecutive mistake-free sessions for the same algorithm. Priority: must-have
  > Socrates: Counter-argument considered: "'You're PRO!' after one clean run sets bar too low." Resolution: modified — threshold is 3 consecutive mistake-free sessions for the same algorithm. Streak counter is tracked per-algorithm and persisted.

### Progress Tracking
- FR-014: Learner can view total sessions completed (global count). Priority: must-have
  > Socrates: Counter-argument considered: "per-algorithm granularity is overkill — just show total sessions." Resolution: modified — must-have is total count only; per-algorithm breakdown is nice-to-have and out of MVP scope.

### Duplicate Detection
- FR-015: When a learner inputs a move sequence that exactly matches an existing algorithm (pre-built or in any of their lists), the app proposes the existing algorithm and lets the learner add it to their list instead of creating a duplicate. Priority: must-have
  > Socrates: Added as a Socrates-driven resolution to FR-005. No further counter-argument raised.

## Non-Functional Requirements

- Learner perceives move validation as instantaneous — feedback (slot color change) appears within 100 ms of any button press or keypress.
- Each authenticated user's data (algorithm lists, practice history, mastery state) is strictly isolated — no user's data is readable or discoverable by another user under any access path.

## Business Logic

The app evaluates whether each move the learner inputs matches the algorithm's required sequence in order, and tracks consecutive error-free completions per algorithm to determine when mastery is reached.

The input side: the learner is shown N blank slots (one per move in the algorithm). Each button press or keypress submits a single move token. The app compares the submitted token against the expected token at the current position. A match advances the position; a mismatch holds the position and marks the slot red. The learner cannot advance without inputting the correct move — no skipping, no hints.

The output side: on sequence completion, slot color reflects attempt quality — green if zero errors occurred during the attempt, yellow if any error occurred. The result (clean or with-errors) is recorded against the algorithm and the consecutive-clean count is updated. When the count reaches 3 for a given algorithm, the mastery state triggers.

The duplicate-detection rule: when a learner submits a move sequence during algorithm creation, the app checks the submitted sequence against all stored sequences (pre-built and user-created). Exact match → the existing algorithm is surfaced and the learner is offered to add it to their list instead.

## Access Control

Multi-user. Each learner signs in via email + password. One flat role: learner. Every authenticated user sees only their own algorithm lists and progress. No admin panel, no instructor-student split. Sign-up flow: create account, then immediately access the product. Unauthenticated users cannot access any app content — login wall at root.

## Non-Goals

- **No 3D cube visualization.** Practice sessions display move tokens (R, U, F'…) only. No animated or rendered cube. Avoids a major rendering scope spike and keeps the MVP focused on recall training, not visualization.
- **No sharing or social features.** Algorithm lists are private. No sharing lists between users, no point system, no leaderboard, no collaborative features. Single-user product in MVP.
- **No mobile app.** Desktop web only. The button grid + keyboard shortcut input model is desktop-first; a touch-optimized layout is a post-MVP effort.
- **No offline-first.** The app requires a network connection to function. Without a connection, learners cannot access their progress, lists, or practice sessions.
- **No per-algorithm practice history in MVP.** FR-014 tracks total sessions completed globally. Per-algorithm session breakdown is a nice-to-have deferred to post-MVP.

## Open Questions

2. **Which pre-built algorithm sets will ship at launch, and who curates them?** — Owner: user. Must be resolved before MVP ships. Block: yes for FR-003 — pre-built content must be curated and validated before the app delivers day-one value.

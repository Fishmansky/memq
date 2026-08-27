<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Home Page Rebrand

- **Plan**: `context/changes/home-page-rebrand/plan.md`
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-08-27
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations
- **Triage**: complete (2026-08-27) — F1 FIXED, F2 FIXED, F3 ACCEPTED
- **Commits reviewed**: `802f68d` (p1), `2010bcf` (p2), `abf6da2` (epilogue)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — Plan's criterion 1.1 grep can never pass again

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/home-page-rebrand/plan.md` (Phase 1 Automated Verification, and the "Verify:" line in Desired End State)
- **Detail**: The plan documents `grep -ri "astro starter\|10x-astro\|Modern Stack\|Developer Experience" src/pages src/components src/layouts` as returning no matches. It now returns 2 matches, both the new test's own regex literals (`Landing.test.ts:33-34`). The criterion's *intent* is satisfied — the three page files are clean, and the test's `SOURCES` map (lines 24-28) excludes itself, so the test passes 6/6. But the literal command is a permanent false positive for any reviewer or CI script re-running it. At implementation time the check was run with `--include='*.astro'` scoping; the plan text still carries the broad form, so the workaround is not recorded where the next reader looks.
- **Fix**: Narrow the documented command in `plan.md` to the actual page files (`src/pages/index.astro src/components/Landing.astro src/layouts/Layout.astro`) or add `--include='*.astro'`, so the recorded criterion matches what was actually verified.
  - Strength: Makes the plan's own verification reproducible; removes a standing false-failure signal.
  - Tradeoff: Edits an already-committed plan's Success Criteria block.
  - Confidence: HIGH — the mismatch is mechanical and fully reproduced.
  - Blind spot: None significant.
- **Decision**: FIXED — added `--include='*.astro'` to the grep in plan.md (Desired End State `Verify:` line and Phase 1 Automated Verification). Re-run returns no matches.

### F2 — Redundant role="presentation" on the cube panel

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/Landing.astro:81-85`
- **Detail**: The panel carries both `aria-hidden="true"` and `role="presentation"`. Either alone removes it from the accessibility tree. Not harmful and not self-contradictory — the panel holds no focusable element and no real text, only nine color spans, so nothing meaningful is suppressed. `eslint-plugin-astro`'s `jsx-a11y-recommended` (`eslint.config.js:79`) does not flag it. The algorithm name and `MoveSequence` sit in a sibling div outside the hidden panel and are correctly announced.
- **Fix**: Drop `role="presentation"`; `aria-hidden="true"` alone is sufficient.
- **Decision**: FIXED — removed `role="presentation"`; `aria-hidden="true"` retained.

### F3 — Inline style interpolation is safe here but fragile if copied

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/Landing.astro:91`
- **Detail**: ``style={`background-color: ${color}`}`` interpolates into a `style` attribute. Not exploitable: `color` comes only from the module-scope `CUBE_FACE` constant (line 11), a hardcoded hex array — no request, prop, or `Astro.locals` value reaches it. The pattern is precedented (the star-field div carried over from `Welcome.astro` uses inline style for a multi-layer radial-gradient). It is also the correct choice here rather than a shortcut: Tailwind v4 scans for literal class strings at build time, so `bg-[${color}]` would silently emit no CSS. The fragility is only on future reuse with a dynamic color source.
- **Fix**: None required. Leave as-is.
- **Decision**: ACCEPTED — no change. Source is the module-scope `CUBE_FACE` constant; Tailwind v4 build-time class scanning rules out `bg-[${color}]`.

## Evidence behind the PASS verdicts

**Plan Adherence** — all 5 Phase-1 and 2 Phase-2 planned items verified MATCH:
- Rename `Welcome.astro` → `Landing.astro`; skeleton preserved (`bg-cosmic` wrapper, 3 orb divs, star field, `<Topbar />`, centered hero); 3-card feature grid and its inline SVGs fully deleted.
- Gradient text (`from-blue-200 via-purple-200 to-pink-200 bg-clip-text text-transparent`) and type scale (`text-5xl sm:text-6xl lg:text-7xl`) kept verbatim.
- Hero copy covers intermediate solvers, OLL/PLL sets, move-by-move recall, immediate correct/wrong confirmation, three clean runs = mastered. No timer, scrambler, sharing, mobile app, offline, or 3D cube claim anywhere in the file.
- Auth CTA reads `const { user } = Astro.locals;` (matching `Topbar.astro:2`); truthy → single `/dashboard` CTA "Go to my sets"; falsy → `/auth/signin` primary + `/auth/signup` outline, button classes reused verbatim. No sign-out control.
- `index.astro` uses the `@/*` alias and passes an explicit `title`; `Layout.astro:10` default is now `"MemQ"` with `title?: string` unchanged.
- `Landing.test.ts` reads source via `node:fs` + `import.meta.url` (never `process.cwd()`), renders nothing, asserts all four required conditions, and carries the required known-limitation comment.
- Cube face: 9 tiles, all six standard colors, mixed arrangement, one bordered glass panel, `aria-hidden`, no specific OLL/PLL case (stated in a code comment). `MoveSequence` rendered with exactly `M2 U M U2 M' U M2` (= `seed.sql:13` unescaped), labeled with visible text "Ua-perm — one of the algorithms in the pre-built PLL set", which makes no claim that the face shows that algorithm's state.

**Scope Discipline** — no EXTRA changes. Verified byte-identical across `ee5a642..HEAD`: `src/components/app/MoveSequence.astro`, `src/components/Topbar.astro`, `src/middleware.ts`, `context/foundation/prd.md`. `package.json` name still `10x-astro-starter`; `public/template.png` present. No Playwright spec for `/`, no Astro Container API / `getViteConfig` change / per-file `environment: 'node'` / second vitest config. No feature grid, how-it-works steps, testimonials, footer, or 3D/animated cube.

**Pattern Consistency** — `@/*` alias used for both component imports. Glass-panel classes match `SetCard.astro:12`; secondary text `text-blue-100/70` / `text-blue-100/60` matches `Topbar.astro:11,25`; primary button classes carried from the deleted `Welcome.astro`; `bg-cosmic` from `global.css:113-115`. No invented design tokens. Test is colocated, matching the dominant repo convention (`PracticeSession.reducer.test.ts`, `createList.test.ts`, `moveGrammar.test.ts`, …) and picked up by `vitest.config.ts`'s `include: ["src/**/*.test.{ts,tsx}"]`. `Landing.test.ts` diverges from `seedTokens.test.ts:35` (`resolve(import.meta.dirname, …)` vs `new URL(…, import.meta.url)`); both are invocation-directory-independent, and the new form was verified correct by static reasoning and by running the file.

**Success Criteria** — re-run at review time:

| Check | Result |
|---|---|
| `test ! -f src/components/Welcome.astro && test -f src/components/Landing.astro` | PASS |
| `grep -q "MoveSequence" src/components/Landing.astro` | PASS |
| `npm run typecheck` | PASS — 0 errors, 0 warnings, 77 files |
| `npm run lint` | PASS — 0 errors (16 pre-existing `no-console` warnings, none in changed files) |
| `npm run build` | PASS — Complete |
| `npm test` | PASS — 11 files, 89 tests |
| `npx vitest run src/components/Landing.test.ts` | PASS — 6 tests |
| Plan's literal criterion 1.1 grep | FALSE POSITIVE — see F1 |

No client JS introduced: no `client:*` directive in any changed file. The `dist/client/_astro/*.js` chunks belong to other pages' React islands.

Manual Progress rows (1.7–1.12, 2.6–2.11) are all `[x]`, confirmed by the human at both phase gates, with diff-level supporting evidence (`aria-hidden`, `MoveSequence`, `Ua-perm`, `grid-cols-3`, both CTA branches). No rubber-stamping signal.

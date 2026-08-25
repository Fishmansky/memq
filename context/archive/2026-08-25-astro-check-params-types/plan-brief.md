# Narrow Astro.params Before Supabase `.eq()` — Plan Brief

> Full plan: `context/changes/astro-check-params-types/plan.md`

## What & Why

`npx astro check` reports 5 `ts(2345)` errors in the app's two dynamic routes —
a route param destructured from `Astro.params` is `string | undefined` under
strict mode, but Supabase's `.eq()` requires `string`. The deeper problem is
that these errors reached master invisibly: no gate in the repo type-checks
`.astro` files. This plan fixes both.

## Starting Point

`src/pages/sets/[id].astro` and `src/pages/sets/[id]/[algoId].astro` each
destructure `Astro.params` once at the top and pass the results straight into
Supabase queries with no narrowing. Surfaced by F6 of
`context/changes/rotation-notation-fix/reviews/impl-review.md`, which noted the
prior plan's type gate had been verified with `tsc --noEmit` — a tool that does
not parse `.astro`.

## Desired End State

`npx astro check` exits 0, `npm run typecheck` exists and runs it, and CI fails
any future PR introducing an `.astro` type error. Both set pages render exactly
as they do today — the guards protect a branch the router cannot reach.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Narrowing shape | Inline early-return guard at the destructure site | Astro's documented SSR pattern; narrows once per file so all 5 `.eq()` sites need no edits. |
| Non-null assertion (`id!`) | Rejected | `@typescript-eslint/no-non-null-assertion` is in `strictTypeChecked`, so it would fail `npm run lint`. |
| Missing-param UX | `Astro.redirect("/dashboard?error=…")` | Reuses the error-redirect pattern already in both files; `Astro.rewrite("/404")` would need a `404.astro` that doesn't exist. |
| Gate placement | `typecheck` npm script + CI step | CI is the enforced gate and currently type-checks zero `.astro` files; ~7s cost is negligible there. |
| Per-edit hook | Left as `tsc --noEmit` | `astro check` at ~7s per edit taxes the agent loop harder than the CI gate justifies. |
| Scope | 5 errors + gate only | Keeps a reviewable one-class diff; the gate change is already the widest part. |
| Test coverage | None; the CI gate is the guard | The guard branch is unreachable via routing, so a test could only pass vacuously. |
| Phasing | Single phase | Script and CI step are a two-line change; splitting them adds commits, not clarity. |

## Scope

**In scope:**
- Param guards in `src/pages/sets/[id].astro` and `src/pages/sets/[id]/[algoId].astro`
- Simplifying the ternary at `[algoId].astro:41` (forced by the narrowing — see risks)
- `"typecheck": "astro check"` in `package.json`
- `npm run typecheck` step in `.github/workflows/ci.yml`

**Out of scope:**
- The `Promise.all` lesson violation at `[algoId].astro:14-31` — behavior change, own change
- UUID-format validation of params — behavior change, scope creep
- Creating `src/pages/404.astro`
- Changing the `.claude/settings.json` per-edit hook
- New tests

## Architecture / Approach

Both pages destructure `Astro.params` exactly once at the top of the
frontmatter. Inserting an early-return guard immediately after that destructure
narrows the `const` for the entire remaining scope, so all five `.eq()` call
sites type-check with zero edits to the query code. The gate half adds a named
`typecheck` script and runs it in CI after `astro sync` (which generates the
types `astro check` needs) and before `lint`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Narrow params + enforce `astro check` | 0 `astro check` errors, `typecheck` script, CI gate | Narrowing `id` turns the existing ternary at `[algoId].astro:41` into a lint error — must be simplified in the same edit |

**Prerequisites:** None. `astro check` already runs locally; the change folder exists.
**Estimated effort:** ~1 session, 4 files, small diff.

## Open Risks & Assumptions

- **Lint coupling (highest-value gotcha).** `@typescript-eslint/no-unnecessary-condition`
  is in `strictTypeChecked`. Once `id` is `string`, `id ? … : "/dashboard"` at
  `[algoId].astro:41` is a provably-true condition and fails `npm run lint`.
  Adding the guard without simplifying that line breaks the build.
- **`AGENTS.md` forbids new *test* scripts in `package.json`.** `typecheck` is a
  type gate, not a test runner — not a violation, but flagged so it isn't
  reverted on review.
- Assumption: `astro check` needs no Supabase secrets in CI (both env fields are
  `optional: true` and it performs no runtime env validation). If CI disagrees,
  copy the `env` block from the existing `build` step.
- Assumption: the guard branch stays unreachable. If routing changes (e.g. an
  optional-param or rest route is added), the no-test decision should be revisited.

## Success Criteria (Summary)

- `npm run typecheck` exits 0 and `npm run lint` / `npm run build` stay clean
- CI fails on any future `.astro` type error
- `/sets/{id}` and `/sets/{id}/{algoId}` render unchanged in the browser

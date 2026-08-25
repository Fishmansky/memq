---
change_id: astro-check-params-types
title: Narrow Astro.params before passing to Supabase .eq()
status: archived
created: 2026-08-25
updated: 2026-08-25
archived_at: 2026-08-25T01:10:58Z
---

## Notes

Fix 5 `ts(2345)` errors in `src/pages/sets/[id].astro` and
`src/pages/sets/[id]/[algoId].astro` where `Astro.params` values
(`string | undefined`) are passed to Supabase `.eq()`, which requires `string`.

Surfaced by F6 of `context/changes/rotation-notation-fix/reviews/impl-review.md`:
`npx astro check` reports these 5 errors, so that plan's Progress row 4.3
("Type checking passes: `npx astro check`") was actually verified with
`npx tsc --noEmit` (exit 0) — the repo's enforced type gate. The errors are
pre-existing and untouched by `rotation-notation-fix`.

Exact sites (`npx astro check`, 2026-08-25):

| File | Line | Expression |
|---|---|---|
| `src/pages/sets/[id].astro` | 17 | `.eq("id", id)` |
| `src/pages/sets/[id].astro` | 27 | `.eq("list_id", id)` |
| `src/pages/sets/[id]/[algoId].astro` | 17 | `.eq("id", algoId)` |
| `src/pages/sets/[id]/[algoId].astro` | 18 | `.eq("list_id", id)` |
| `src/pages/sets/[id]/[algoId].astro` | 30 | `.eq("id", id)` |

All five are one class: a dynamic route param is `string | undefined` under
strict mode, and neither page narrows it before the query. Worth deciding once
whether the right response is a guard + 404 redirect, a non-null assertion, or
a shared param-narrowing helper — then applying it uniformly.

Done when `npx astro check` reports 0 errors and `npm run lint` stays clean.

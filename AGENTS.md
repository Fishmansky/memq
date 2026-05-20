# Repository Guidelines

MemQ is a Rubik's cube algorithm-memorization web app for intermediate solvers. Stack: Astro 6 + React 19 + TypeScript strict + Tailwind v4 + Supabase + Cloudflare Pages.

## Hard Rules

- Use `@/*` path alias (resolves to `./src/*`) for all intra-project imports — never use relative paths that escape a module's own directory.
- Never hardcode `SUPABASE_URL` or `SUPABASE_KEY`; load from environment only. CI supplies them as secrets via process.env or Astro's env system
- `context/archive/` is immutable — never write to or modify files under it.
- No test runner is configured; do not generate `vitest`/`jest` invocations or add test scripts to `package.json`.
- Run `astro sync` manually when adding new content collections or changing `src/content/config.ts`. CI runs it before build.


## Build, Test, and Development Commands

See @README.md

## Coding Style & Naming

TypeScript strict mode; config extends `astro/tsconfigs/strict` — see @tsconfig.json. ESLint flat config uses `strictTypeChecked` + `stylisticTypeChecked` — see @eslint.config.js; CI fails on any lint error. Prettier (with Astro and Tailwind plugins) runs automatically on commit via Husky lint-staged. Node version - see @README.md

## Commit & PR Guidelines

Conventional Commits prefixes observed in history: `feat:`, `fix:`, `refactor:`, `chore:`. CI gate on `master`: `npm run lint` + `npm run build` must both pass. PRs target `master`.

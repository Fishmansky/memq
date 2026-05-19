---
bootstrapped_at: 2026-05-19T21:14:00Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: memq
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: memq
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
```

### Why this stack

MemQ is a 3-week after-hours MVP requiring email+password auth and per-user data isolation — exactly what 10x-astro-starter ships pre-wired. Astro 6 + React 19 handles the interactive practice session UI (button grid, immediate slot coloring, keyboard shortcuts) without a heavy SPA framework, while Supabase covers authentication (FR-001, FR-002), row-level security for per-user data isolation, and PostgreSQL tables for algorithm lists and practice history. The <100 ms move-validation requirement is a client-side DOM concern — no WebSocket or realtime infra needed. Cloudflare Pages provides zero-config edge deployment. TypeScript end-to-end keeps the agent reasoning surface explicit and clears all four agent-friendly quality gates (typed, convention-based, popular in training data, well-documented). Standard path taken — recommended default for (web-app, js); first-class bootstrapper confidence means mostly-smooth scaffolding with occasional manual steps. CI on GitHub Actions with auto-deploy-on-merge matches the starter's standard shape.

## Pre-scaffold verification

| Signal      | Value    | Severity | Notes                                                                              |
| ----------- | -------- | -------- | ---------------------------------------------------------------------------------- |
| npm package | not run  | —        | cmd_template starts with `git clone`; npm package check skipped per spec           |
| GitHub repo | not run  | —        | `gh` command not found on PATH; recency check unavailable                          |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: clone starter repo without keeping its git history
**Exit code**: 0
**Git history removal**: `.bootstrap-scaffold/.git/` deleted before move-up
**Files moved**: 20 top-level items (files and directories)
**Conflicts (.scaffold siblings)**: `CLAUDE.md.scaffold` (existing `CLAUDE.md` won; scaffold's copy sidelined)
**.gitignore handling**: moved silently (no `.gitignore` existed in cwd prior to scaffold)
**.bootstrap-scaffold cleanup**: deleted

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 10 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/3/0 direct of total 0/1/10/0 (HIGH finding is transitive; 3 MODERATE packages are direct)

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** (transitive) — versions 5.6.3–5.8.0
  - Advisory: GHSA-77vg-94rm-hx3p — "Svelte devalue: DoS via sparse array deserialization"
  - CWE-770 (allocation of resources without limits)
  - CVSS 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H)
  - Fix: available (`npm audit fix`)

#### MODERATE findings

Direct packages (3):

- **@astrojs/check** (direct) — via `@astrojs/language-server` → `volar-service-yaml` → `yaml-language-server` → `yaml`
  - Fix: downgrade to `@astrojs/check@0.9.2` (semver major)
- **@astrojs/cloudflare** (direct) — via `@cloudflare/vite-plugin` and `wrangler` → `miniflare` → `ws`
  - Fix: upgrade to `@astrojs/cloudflare@12.6.13` (semver major)
- **wrangler** (direct) — via `miniflare` → `ws`
  - Fix: downgrade to `wrangler@3.107.3` (semver major)

Transitive packages (7): `@astrojs/language-server`, `@cloudflare/vite-plugin`, `miniflare`, `volar-service-yaml`, `ws` (GHSA-58qx-3vcg-4xpx — uninitialized memory disclosure, CVSS 4.4), `yaml` (GHSA-48c2-rrv3-qjmp — stack overflow via deeply nested YAML, CVSS 4.3), `yaml-language-server`.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                    | Value             |
| ----------------------- | ----------------- |
| bootstrapper_confidence | first-class       |
| quality_override        | false             |
| path_taken              | standard          |
| self_check_answers      | null              |
| team_size               | solo              |
| deployment_target       | cloudflare-pages  |
| ci_provider             | github-actions    |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true              |
| has_payments            | false             |
| has_realtime            | false             |
| has_ai                  | false             |
| has_background_jobs     | false             |

These fields are carried forward for the future M1L4 skill ("Memory Architecture") to act on. v1 bootstrapper reads them for the audit trail only.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review `CLAUDE.md.scaffold` (the starter's CLAUDE.md) — diff it against your existing `CLAUDE.md` to see what the starter ships vs what you had.
- Address audit findings per your project's risk tolerance — 1 HIGH (`devalue` DoS, transitive) and 10 MODERATE; the full breakdown is in this log. Run `npm audit fix` for auto-fixable items.

---
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
---

## Why this stack

MemQ is a 3-week after-hours MVP requiring email+password auth and per-user data isolation — exactly what 10x-astro-starter ships pre-wired. Astro 6 + React 19 handles the interactive practice session UI (button grid, immediate slot coloring, keyboard shortcuts) without a heavy SPA framework, while Supabase covers authentication (FR-001, FR-002), row-level security for per-user data isolation, and PostgreSQL tables for algorithm lists and practice history. The <100 ms move-validation requirement is a client-side DOM concern — no WebSocket or realtime infra needed. Cloudflare Pages provides zero-config edge deployment. TypeScript end-to-end keeps the agent reasoning surface explicit and clears all four agent-friendly quality gates (typed, convention-based, popular in training data, well-documented). Standard path taken — recommended default for (web-app, js); first-class bootstrapper confidence means mostly-smooth scaffolding with occasional manual steps. CI on GitHub Actions with auto-deploy-on-merge matches the starter's standard shape.

---
project: memq
researched_at: 2026-05-21
recommended_platform: Cloudflare Workers + Pages
runner_up: Netlify
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 + React 19
  runtime: Cloudflare Workers (workerd)
  database: Supabase (external, PostgreSQL + Auth)
---

## Recommendation

**Deploy on Cloudflare Workers + Pages.**

The project already targets Cloudflare Workers — `wrangler.jsonc` is present, `@astrojs/cloudflare` adapter is configured, and `.dev.vars` handles local secrets. No adapter change, no runtime migration, no deployment config rewrite. The free tier covers 100k requests/day (~3M/month), comfortably above any MVP traffic. Cloudflare scores 5/5 on all five agent-friendly criteria and is the only platform on the shortlist that costs nothing at MVP scale with zero setup delta. Cost-minimization and already-configured state both point the same direction.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Cost (MVP) |
|---|---|---|---|---|---|---|
| **Cloudflare Workers+Pages** | Pass | Pass | Pass | Pass | Pass (GA) | Free |
| Netlify | Pass | Pass | Pass | Pass | Pass (GA) | Free |
| Railway | Pass | Pass | Partial | Pass | Pass (GA) | $5/mo |
| Vercel | Pass | Pass | Pass | Pass | Partial (MCP beta) | $20/mo |
| Render | Partial | Pass | Fail | Partial | Pass (GA) | $7+/mo |
| Fly.io | Partial | Partial | Partial | Pass | Fail | $2+/mo |

**Scoring notes:**

- **Cloudflare**: `wrangler` CLI covers every operational need (deploy, rollback via `wrangler rollback [id]`, log tailing via `wrangler tail`). Docs published as `llms.txt` at `developers.cloudflare.com` and as markdown on GitHub. `wrangler deploy` / `wrangler pages deploy` are deterministic single-command operations. Multiple first-class MCP servers available (GA): `cloudflare/workers-mcp` for Workers, Cloudflare docs MCP, observability MCP.
- **Netlify**: Ties Cloudflare on criteria score and also has a free tier, but requires swapping `@astrojs/cloudflare` for `@astrojs/netlify` and adjusting to Netlify's Deno/V8 edge runtime (different compatibility surface). Official Netlify MCP Server is GA. Astro Actions currently broken with `output: 'static'` (hybrid/server mode required).
- **Railway**: Full Node.js runtime via `@astrojs/node` adapter; Railway MCP Server GA with 10+ typed tools. $5/month Hobby tier. Requires adapter swap, IPv6 binding config, and health check setup. Docs lack `llms.txt`.
- **Vercel**: Costs $20/month at Pro tier for full rollback support. Vercel MCP is beta (read-only, as of 2026-02-12). No WebSocket support on serverless. Otherwise strong CLI and llms.txt docs.
- **Render**: Free tier removed in 2026; starts at $7/month. Docs not available as llms.txt or GitHub markdown. CLI less mature.
- **Fly.io**: No free tier (eliminated Oct 2024); no official MCP; no explicit rollback CLI command documented. Fly Postgres starts at $38/month (irrelevant since Supabase is external, but signals cost trajectory).

### Shortlisted Platforms

#### 1. Cloudflare Workers + Pages (Recommended)

Already configured. Zero adapter delta. Free at MVP traffic (100k req/day). Best-in-class `wrangler` CLI with full operational coverage. First-party llms.txt and GitHub markdown docs. Multiple GA MCP servers for agents. The workerd runtime's nodejs_compat flag covers standard Supabase SSR patterns when properly configured with `@supabase/ssr`.

#### 2. Netlify

Scores identically on agent-friendly criteria. Official Netlify MCP Server is GA. Free tier still available. The gap vs. Cloudflare is entirely operational: the project would need a new adapter, a different edge runtime (Deno/V8 vs. workerd), and different secret management flows. No advantage for this project at MVP that justifies the migration cost.

#### 3. Railway

Full Node.js (not edge-constrained), GA MCP Server, simple Nixpacks auto-detection. Best option if the project ever needs persistent long-lived processes or a runtime with full Node.js compatibility. $5/month Hobby is the only cost. Loses to Cloudflare because Cloudflare is free, already configured, and scores equally on all criteria except the adapter-change cost.

## Anti-Bias Cross-Check: Cloudflare Workers + Pages

### Devil's Advocate — Weaknesses

1. **Pages ≠ Workers deploy commands**: `wrangler pages deploy` and `wrangler deploy` target different services with different routing behaviors. The project README currently references `wrangler deploy` (Workers command). Deploying to the wrong target in CI produces a working build with broken dynamic routes — the 404s surface in production, not in build logs.
2. **nodejs_compat is not full Node.js**: Third-party packages relying on Node.js internals beyond the compatibility flag's scope fail — typically only in production (not in `wrangler dev`, which runs locally with a more permissive Node.js layer). The failure mode is a cryptic runtime error, not a build error.
3. **CPU-time billing surprises**: Workers bill by CPU milliseconds, not wall-clock time. Supabase query + Astro SSR render on the free tier allows only 10ms CPU per request. A practice session page with several DB calls can silently exceed this limit, triggering CPU errors rather than slow responses.
4. **Preview URLs are public by default**: Every Pages branch deployment gets a `*.pages.dev` URL with no authentication. For an auth-gated app, unreleased features are discoverable by anyone with the URL. Cloudflare Access adds protection but requires extra setup.
5. **Pages/Workers convergence incomplete**: Cloudflare announced convergence for 2026, but as of 2026-05-21 the two deployment modes have separate CLI flows, URL namespaces (`pages.dev` vs. `workers.dev`), and secret management paths. Treating them as identical in automation scripts causes subtle production failures.

### Pre-mortem — How This Could Fail

The team deployed MemQ on Cloudflare Pages and shipped on schedule. Three months in, a pattern of intermittent auth failures emerged: users were being silently logged out mid-practice session. Root cause: the Supabase client was initialized using the standard browser-side pattern without `@supabase/ssr`'s edge-specific cookie handling (`getAll`/`setAll`). Session refresh tokens weren't being written back to the response cookies correctly in the workerd runtime. The failure was invisible in `wrangler dev` because local dev runs with a more permissive Node.js compatibility layer.

Around week eight, a CI refactor accidentally ran `wrangler deploy` instead of `wrangler pages deploy`. The build succeeded, deployed to a `workers.dev` URL, and bypassed the Pages routing configuration entirely. Dynamic routes returned 404s for two hours before the team noticed that the deployed URL was wrong.

Finally, the team discovered that practice session stat updates — a server action touching Supabase — were silently failing on the free tier's 10ms CPU limit per request. No error was thrown; the action simply returned without persisting. Progress data appeared lost from the user's perspective. The fix required upgrading to the paid Workers tier ($5/month) and rewriting the handler — not budgeted in the MVP sprint.

### Unknown Unknowns

- **`Astro.locals.runtime` removed in Astro 6**: The Cloudflare adapter's public API changed. The pattern now requires direct `cloudflare:workers` imports instead of `Astro.locals.runtime`. Code from 2024 tutorials and the pre-Astro-6 starter patterns will compile cleanly but fail at runtime in production.
- **Supabase SSR requires edge-specific initialization**: `@supabase/ssr` with `getAll`/`setAll` cookie methods wired to Astro's `cookies` API is mandatory for auth to work in the Workers runtime. The standard `createClient` pattern silently drops auth state between requests.
- **Pages and Workers have separate secret namespaces**: `wrangler secret put` writes to the Workers namespace; Pages secrets are managed via `wrangler pages secret put` or the Cloudflare dashboard. Setting secrets in the wrong namespace means env vars are undefined in production while succeeding in the wrong environment.
- **100k request/day free tier resets daily, not monthly**: A crawler pass, a monitoring bot, or a brief traffic spike can exhaust that day's quota before real users arrive. The free tier has no alerting on quota exhaustion.
- **`wrangler dev` ≠ production Workers runtime**: Local dev uses a Node.js-backed simulator. Packages that work locally may fail in production due to `nodejs_compat` coverage gaps. Only `wrangler dev --remote` replicates the actual runtime, and it requires an authenticated Cloudflare account.

## Operational Story

- **Preview deploys**: Every branch pushed to the connected GitHub repo automatically gets a `*.pages.dev` preview URL via Cloudflare Pages CI integration. These are public by default — add Cloudflare Access (zero-trust policy) to protect unreleased branches if auth bypass is a concern.
- **Secrets**: Local secrets live in `.dev.vars` (gitignored). Production secrets are set per environment via `wrangler pages secret put SUPABASE_URL` and `wrangler pages secret put SUPABASE_KEY`, or via Cloudflare dashboard → Pages → Settings → Environment variables. Rotation: run `wrangler pages secret put` with new value; redeploy to pick up.
- **Rollback**: `wrangler rollback [deployment-id]` for Workers deployments; for Pages, republish a previous deployment via Cloudflare dashboard → Pages → Deployments → select build → Rollback. Typical time-to-revert: ~60 seconds. DB schema migrations (Supabase) do not roll back automatically — plan forward-compatible migrations.
- **Approval**: Agent may run `wrangler pages deploy`, `wrangler secret put`, `wrangler tail`, `wrangler deployments list` unattended. Human-only: rotating Supabase service role keys, modifying Cloudflare DNS, changing account-level billing settings, dropping database tables.
- **Logs**: Runtime logs — `wrangler tail --env production` (streams live requests and errors). Build logs — Cloudflare Pages dashboard or `wrangler pages deployment tail [deployment-id]`. Structured JSON output available via `--format json` flag.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| `wrangler deploy` used instead of `wrangler pages deploy` in CI | Devil's advocate | H | M | Pin exact command in CI workflow; add smoke test that verifies Pages URL responds correctly after deploy |
| Supabase auth breaks silently in Workers runtime due to missing `@supabase/ssr` setup | Pre-mortem | H | H | Initialize Supabase with `@supabase/ssr` + Astro `cookies` API from day one; test auth flow against `wrangler dev --remote` before first deploy |
| CPU-time limit exceeded on free tier for SSR pages with DB calls | Pre-mortem | M | M | Profile CPU-ms per route in staging; upgrade to paid Workers tier ($5/mo) if any route approaches 10ms CPU limit |
| Preview URLs expose unreleased features publicly | Devil's advocate | M | L | Enable Cloudflare Access policy on `*.pages.dev`; or accept risk given low user count at MVP |
| `Astro.locals.runtime` removal causes silent runtime failures | Unknown unknowns | M | H | Audit all uses of `Astro.locals.runtime` before deploy; replace with `cloudflare:workers` direct imports per Astro 6 migration guide |
| Pages and Workers secret namespaces confused during CI setup | Unknown unknowns | M | H | Document exact `wrangler pages secret put` commands in deploy runbook; verify secrets visible in Pages env, not Workers env |
| `wrangler dev` ≠ production runtime masks compatibility issues | Unknown unknowns | M | M | Run `wrangler dev --remote` for auth and Supabase integration testing before each deploy |
| Free tier 100k req/day exhausted by bots/crawlers | Research finding | L | M | Add rate limiting via Cloudflare WAF rules; consider upgrading to paid tier ($5/mo) at first sign of unexpected traffic |

## Getting Started

1. **Verify CLI and auth**: `npm install -g wrangler` (or use `npx wrangler`) → `wrangler login` → `wrangler whoami` to confirm account.
2. **Create Pages project**: `wrangler pages project create memq --production-branch master` (one-time setup; links the repo to Cloudflare Pages).
3. **Set production secrets**: `wrangler pages secret put SUPABASE_URL --project-name memq` and `wrangler pages secret put SUPABASE_KEY --project-name memq` — enter values when prompted.
4. **Build and deploy**: `npm run build` → `wrangler pages deploy dist --project-name memq` (use `dist/` output directory from `astro build`). For CI, use `wrangler pages deploy` with `CLOUDFLARE_API_TOKEN` env var instead of interactive login.
5. **Tail logs**: `wrangler tail --env production` to stream live runtime logs; verify auth flow and Supabase connectivity on first deploy.

> **Node.js compat note**: Ensure `wrangler.jsonc` includes `"compatibility_flags": ["nodejs_compat"]` and `"compatibility_date": "2024-09-23"` or later. Verify `@supabase/ssr` is used (not bare `@supabase/supabase-js` createClient) in all server-side Supabase initialization.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (GitHub Actions wiring, secret injection in CI)
- Production-scale architecture (multi-region, HA, DR, Cloudflare Zero Trust for team access)

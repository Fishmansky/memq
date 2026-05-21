# Cloudflare Workers Deployment Plan — MemQ

## Context

Infrastructure research (`context/foundation/infrastructure.md`) selected Cloudflare Workers + Pages as the MVP platform. The codebase already has `@astrojs/cloudflare` adapter configured with `output: "server"`. However, `wrangler.jsonc` is set up for **Cloudflare Workers with Assets** (not Pages) — the deploy command is `wrangler deploy`, not `wrangler pages deploy`. This distinction is load-bearing: using the wrong command produces a working build deployed to the wrong runtime with broken dynamic routes.

**Goal**: Ship MemQ to Cloudflare Workers, wire secrets, add CI deploy step, verify auth flow in production runtime.

---

## Critical Discoveries

| Item | Finding | Status |
|------|---------|--------|
| Deploy type | Workers + Assets (`main` + `assets` in wrangler.jsonc) | ✅ Clear |
| Project name | `"10x-astro-starter"` in wrangler.jsonc | ✅ Renamed to `memq` |
| `nodejs_compat` flag | Present | ✅ |
| `compatibility_date` | `2026-05-08` | ✅ |
| `@supabase/ssr` with `getAll`/`setAll` | Used in `src/lib/supabase.ts` | ✅ |
| `Astro.locals.runtime` | Not used anywhere | ✅ Safe for Astro 6 |
| Secrets in `astro:env` | `optional: true` — build passes without them | ✅ CI-safe |
| CI deploy step | Missing | ⚠️ Needs GitHub secrets (6.1–6.2) |
| SESSION KV namespace | Missing — adapter auto-enables sessions | ✅ Created (`491c732a2b044c83b3ed24d6bbdef141`) |
| Astro CSRF checkOrigin | Blocks POST via `wrangler dev --remote` proxy | ✅ Disabled (`security.checkOrigin: false`) |
| Supabase key format | Publishable key (`sb_publishable_…`) — not legacy JWT | ✅ Confirmed valid |
| `.dev.vars` | Gitignored, not tracked | ✅ |

---

## Phase 0 — Pre-flight (Manual Gates)

> These steps require human action before any code runs. Agent cannot automate account creation or provide secret values.

- [x] **0.1** Confirm Cloudflare account exists at dash.cloudflare.com
- [x] **0.2** Confirm Supabase cloud project exists (or decide to use local for MVP)
- [x] **0.3** Have `SUPABASE_URL` and `SUPABASE_KEY` (anon key) values ready
- [x] **0.4** Confirm Node.js v22.14.0 active locally (`node -v`, `.nvmrc`)
- [x] **0.5** Run `npx wrangler whoami` — if not authenticated, run `npx wrangler login`

**Edge case — Supabase not set up yet**: Run `npx supabase init && npx supabase start` locally first (requires Docker + ~7 GB RAM). Copy credentials from CLI output into `.dev.vars`. Test locally before cloud deploy.

---

## Phase 1 — Code Fix: Rename Worker

**File**: `wrangler.jsonc:3`

Change `"name": "10x-astro-starter"` → `"name": "memq"`.

This determines the Worker's name in Cloudflare dashboard, the `workers.dev` subdomain, and the URL used in smoke tests. Deploying with the starter name creates a Worker named `10x-astro-starter` that can't be easily renamed later without deleting and recreating the deployment.

- [x] **1.1** Edit `wrangler.jsonc` — rename `name` field to `"memq"`

---

## Phase 2 — Local Verification

Verify the build and local runtime before touching production.

- [x] **2.1** Copy `.env.example` to `.dev.vars`, fill in Supabase credentials
  ```bash
  cp .env.example .dev.vars
  # then edit .dev.vars with real values
  ```
- [x] **2.2** Build: `npm run build` — must exit 0 with no errors
- [x] **2.3** Run against remote Workers runtime: `npx wrangler dev --remote`
  - Opens local proxy to actual Cloudflare Workers runtime (not the Node.js simulator)
  - Required because `wrangler dev` (without `--remote`) runs a permissive Node.js layer that masks `nodejs_compat` gaps
- [x] **2.4** Verify auth flow manually at `http://localhost:8787`:
  - Sign up at `/auth/signup` → confirm email (or disable email confirm in Supabase dashboard)
  - Sign in at `/auth/signin`
  - Access `/dashboard` — must load without redirect
  - Sign out → `/dashboard` must redirect to `/auth/signin`

**Edge case — `wrangler dev --remote` requires auth**: Must be logged in (`wrangler login`) and account ID accessible. If `CLOUDFLARE_ACCOUNT_ID` is not set, wrangler will prompt interactively — run `npx wrangler whoami` to confirm.

**Edge case — Supabase email confirm blocks sign-up locally**: Go to Supabase dashboard → Authentication → Email → toggle "Confirm email" OFF for local dev.

---

## Phase 3 — Production Secrets

Set secrets in the Workers namespace (NOT Pages namespace — wrangler.jsonc targets Workers).

- [x] **3.1** Set `SUPABASE_URL`:
  ```bash
  echo "<value>" | npx wrangler versions secret put SUPABASE_URL
  # used versions secret put because worker wasn't deployed yet
  ```
- [x] **3.2** Set `SUPABASE_KEY`:
  ```bash
  echo "<value>" | npx wrangler versions secret put SUPABASE_KEY
  ```
- [x] **3.3** Verify secrets visible in correct namespace:
  ```bash
  npx wrangler secret list
  # confirmed SUPABASE_URL and SUPABASE_KEY present
  ```

**Note — `wrangler secret put` vs `wrangler versions secret put`**: `wrangler secret put` fails if no version is deployed yet. Use `wrangler versions secret put` for first-time setup before initial deploy. Subsequent secret updates can use either.

**Edge case — Secret set in wrong namespace**: If secrets were accidentally set via `wrangler pages secret put` (Pages namespace), they won't be visible to the Workers runtime. `wrangler secret list` shows Workers secrets only. Fix: re-run `wrangler secret put` (no `pages` subcommand).

**Edge case — `optional: true` in astro:env masks missing secrets**: The Astro env schema marks both variables as optional, so the build succeeds even if they're unset. Runtime failures (null Supabase client) will appear as auth errors, not build errors. After setting secrets, always run a smoke test (Phase 5) before declaring success.

---

## Phase 4 — First Production Deploy

- [x] **4.1** Build: `npm run build`
- [x] **4.2** Deploy: `npx wrangler deploy`
  - Deployed URL: `https://memq.paul96guitar.workers.dev`
- [x] **4.3** Record deployed URL for smoke tests

**Edge case — `wrangler deploy` vs `wrangler pages deploy`**: The project uses Workers + Assets pattern (confirmed by `main` + `assets` fields in `wrangler.jsonc`). Do NOT run `wrangler pages deploy` — it targets a different service with different routing behavior and will produce 404s on dynamic routes.

**Edge case — CPU time limit (free tier = 10ms/request)**: The Supabase auth endpoints call `supabase.auth.signInWithPassword()` which makes an external HTTP call. External I/O (fetch/HTTP) does NOT count against CPU time — only compute does. Auth routes should be safe. However, if future routes add heavy SSR computation (e.g., algorithm sorting + DB query + render), profile with `wrangler tail` after deploy and check for CPU limit errors.

---

## Phase 5 — Production Smoke Tests

- [ ] **5.1** Open deployed URL — homepage must load (HTTP 200)
- [ ] **5.2** Navigate to `/dashboard` unauthenticated — must redirect to `/auth/signin`
- [ ] **5.3** Sign up with a real email address
- [ ] **5.4** Sign in → access `/dashboard` — must render without redirect loop
- [ ] **5.5** Sign out → verify session cleared (re-visit `/dashboard` → redirected)
- [ ] **5.6** Tail production logs during smoke test:
  ```bash
  npx wrangler tail
  # watch for errors, especially auth-related or CPU limit errors
  ```

**Edge case — Supabase auth redirect URL mismatch**: Supabase requires the site URL and redirect URLs to be explicitly allowed. In Supabase dashboard → Authentication → URL Configuration, add the Workers URL (`https://memq.*.workers.dev`) to "Redirect URLs". Without this, OAuth flows and email confirmations fail with "redirect_uri_mismatch" errors.

**Edge case — CORS errors from Supabase**: If Supabase project was created with a specific "Site URL", requests from the Workers domain may be blocked. Update "Site URL" in Supabase Auth settings to the deployed Workers URL.

---

## Phase 6 — CI/CD Deploy Automation

**File**: `.github/workflows/ci.yml`

Add a deploy step that runs on push to `master` only (not on PRs — PRs should only lint/build).

- [ ] **6.1** Create Cloudflare API token with limited scope:
  - Cloudflare dashboard → My Profile → API Tokens → Create Token
  - Template: "Edit Cloudflare Workers"
  - Scope: Account = `<your account>`, Zone Resources = none needed for Workers
  - Copy the token value (shown once)
- [ ] **6.2** Add GitHub repository secrets:
  - `CLOUDFLARE_API_TOKEN` = token from 6.1
  - `CLOUDFLARE_ACCOUNT_ID` = found in Cloudflare dashboard URL or `wrangler whoami`
  - `SUPABASE_URL` and `SUPABASE_KEY` already present for build step
- [x] **6.3** Add deploy step to `.github/workflows/ci.yml`:

```yaml
      - name: Deploy to Cloudflare Workers
        if: github.ref == 'refs/heads/master' && github.event_name == 'push'
        run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

Insert this step AFTER the `npm run build` step (deploy requires the built `dist/` directory).

- [ ] **6.4** Push to master → verify GitHub Actions run shows deploy step green
- [ ] **6.5** Confirm deployment in Cloudflare dashboard → Workers & Pages → `memq`

**Edge case — API token scoped too narrowly**: "Edit Cloudflare Workers" template grants Worker deploy rights but NOT Workers Secrets write rights. For CI to set secrets programmatically (future), a custom token with `Workers Scripts: Edit` + `Workers KV Storage: Edit` + `Workers Secrets: Edit` would be needed. For now, secrets are set manually via CLI (Phase 3) — intentional per the minimal-permissions posture.

**Edge case — Build step produces stale `dist/`**: GitHub Actions runners are ephemeral — each run starts clean. `dist/` is always built fresh from `npm run build` before `wrangler deploy`. No staleness risk.

---

## Phase 7 — Operational Wiring

- [ ] **7.1** Rollback command reference:
  ```bash
  npx wrangler deployments list          # find previous deployment ID
  npx wrangler rollback <deployment-id>  # ~60 second revert
  ```
  Note: DB migrations do NOT roll back automatically — plan forward-compatible migrations only.
- [ ] **7.2** Production log tailing:
  ```bash
  npx wrangler tail --format json
  ```
- [ ] **7.3** Verify `.dev.vars` not tracked: `git status` must NOT show `.dev.vars`

---

## Files Modified

| File | Change |
|------|--------|
| `wrangler.jsonc` | Rename `name` field: `"10x-astro-starter"` → `"memq"` |
| `wrangler.jsonc` | Add `kv_namespaces` binding for `SESSION` (ID: `491c732a2b044c83b3ed24d6bbdef141`) |
| `astro.config.mjs` | Add `security: { checkOrigin: false }` — disables Astro CSRF guard broken by wrangler proxy |
| `.github/workflows/ci.yml` | Add `wrangler deploy` step after build, master-only |

---

## Verification (End-to-End)

After all phases complete:

1. `git push origin master` triggers CI
2. CI: lint → build → `wrangler deploy` all green
3. Visit `https://memq.<account>.workers.dev`
4. Full auth flow (sign up → sign in → protected route → sign out) works in production runtime
5. `wrangler tail` shows no CPU errors or auth failures during smoke test
6. `wrangler deployments list` shows latest deployment with correct timestamp

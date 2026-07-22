# E2E Testing Rules (MemQ / Playwright)

Read before generating or editing any spec in `playwright/test/`. These constrain
output so tests stay stable and protect a real risk. Seed: `playwright/test/seed.spec.ts`.

## The rules block

- Use `getByRole`, `getByLabel`, `getByText` as primary locators.
  Fall back to `getByTestId` only when accessibility attributes are ambiguous.
- Never use CSS selectors, XPath, or DOM structure to locate elements.
- Move buttons in the practice grid collide by substring (`R` vs `R'` vs `r`):
  always pass `{ exact: true }` to `getByRole('button', { name })`.
- Each test must be independently runnable — no shared state between tests.
- Never use `page.waitForTimeout()`. Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- Assert the business outcome (banner text, persisted streak), not implementation.
- Use `storageState` for auth — never sign in through the UI. It is wired
  globally in `playwright.config.ts` (`playwright/.auth/user.json`).

## MemQ specifics

- **Auth:** all specs run signed-in via the shared `storageState`. Protected
  routes are `/dashboard` and `/sets/**` (see `src/middleware.ts`).
- **Practice loop** lives at `/sets/<listId>/<algoId>`. Reach an algorithm by its
  set page (`/sets/<listId>`) and clicking its row link (`getByRole('link',
  { name: '<algo name>' })`), so the algo UUID is never hardcoded.
- **The loop:** idle (`Start Practice`) → active (move grid) → input each move
  token in order via its exact-named button → after the last correct move the
  result POSTs to `/api/practice/complete` → complete banner.
- **Clean run banner:** `Consecutive clean: N.` Dirty run (≥1 wrong move):
  `Completed with N error(s). Streak reset.` PRO at 3 consecutive: `You're PRO! 🏆`
  (replaces the count — keep streaks below 3 in deterministic assertions).
- **Persistence is server-side and re-derived per run.** The set/dashboard pages
  render NO streak; the only browser-observable persistence signal is the
  next run's count. Prove "data survives reload" by an increment that spans a
  real `page.reload()`, not by re-reading a static page.
- **No DB cleanup from the browser.** Practice writes hit the real Supabase
  project. Normalize streak deterministically by starting each scenario with a
  dirty run (resets to 0) rather than DB teardown. Document the side effect.

## The assertion must fail if the risk materializes

Control question for every assertion: would this fail if the `test-plan.md` risk
came true? Confirm with a deliberate break (invert the production behavior, watch
the test go red, revert). If green survives the break, the assertion is decorative.

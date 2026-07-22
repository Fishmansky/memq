// practice-loop-persistence.spec.ts
//
// Risk (test-plan.md #1, High×High): "Finished session result fails to persist
//   — learner completes a clean run but progress/streak is not written, and the
//   result is lost on reload."
// Protection proof: a clean-run streak that INCREMENTS across a real SSR
//   page.reload(). The streak is server-side and re-derived from the DB on every
//   session-complete, so the only browser-observable persistence signal is the
//   next run's count. If run #1's write does not land in the DB, run #2 (after a
//   full page reload) re-reads the prior value and the count fails to advance.
// Seed/levers: playwright/test/seed.spec.ts + playwright/test/E2E_RULES.md.
// Boundaries: auth, routing, API, and DB all REAL (the integration the risk
//   lives in); nothing mocked. Auth via shared storageState (playwright.config.ts).
// Side effect: writes practice_sessions + algorithm_mastery rows for the seeded
//   user against the real Supabase project. No browser-side DB teardown exists;
//   the scenario self-normalizes by starting with a dirty run (resets streak→0),
//   which also keeps the count below the PRO threshold (3) so assertions stay
//   deterministic.
import { test, expect, type Page } from "@playwright/test";

// F2L set + "Basic 4" = "U' F' U F" (supabase/algos_seed.sql). Four direct moves.
const F2L_LIST = "00000000-0000-0000-0000-000000000002";
const ALGO_NAME = "Basic 4";
const SEQUENCE = ["U'", "F'", "U", "F"];
const WRONG_MOVE = "D"; // not the first expected token (U') → marks a wrong attempt

// Click each move token in order via its exact-named grid button.
async function inputSequence(page: Page, moves: string[]): Promise<void> {
  for (const move of moves) {
    await page.getByRole("button", { name: move, exact: true }).click();
  }
}

// Enter the active phase. PracticeSession is a client:load island — a click
// that lands before hydration is lost, so retry until the active phase (the
// "Stop" button) actually appears.
async function startSession(page: Page): Promise<void> {
  await expect(async () => {
    await page.getByRole("button", { name: "Start Practice" }).click();
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible({ timeout: 2000 });
  }).toPass();
}

// Run one full session from the idle screen and wait for its completion banner.
async function runSession(page: Page, opts: { dirty: boolean }): Promise<void> {
  await startSession(page);
  if (opts.dirty) {
    // One wrong attempt (errorCount ≥ 1) before completing → streak resets to 0.
    await page.getByRole("button", { name: WRONG_MOVE, exact: true }).click();
  }
  await inputSequence(page, SEQUENCE);
}

test("clean-run streak persists and increments across a page reload", async ({ page }) => {
  // Reach the algorithm via its set page (algo UUID stays out of the test).
  await page.goto(`/sets/${F2L_LIST}`);
  await page.getByRole("link", { name: ALGO_NAME }).click();
  await expect(page.getByRole("heading", { name: ALGO_NAME })).toBeVisible();

  // Normalize: a dirty run resets the persisted streak to 0 (deterministic start,
  // and keeps us below the PRO threshold).
  await runSession(page, { dirty: true });
  await expect(page.getByText(/Streak reset\./)).toBeVisible();

  // Real SSR reload → fresh page + island, idle screen.
  await page.reload();
  await expect(page.getByRole("button", { name: "Start Practice" })).toBeVisible();

  // Clean run #1 → first persisted clean run.
  await runSession(page, { dirty: false });
  await expect(page.getByText("Consecutive clean: 1.")).toBeVisible();

  // Real SSR reload between the two clean runs — this is the persistence boundary.
  await page.reload();
  await expect(page.getByRole("button", { name: "Start Practice" })).toBeVisible();

  // Clean run #2 → count must advance to 2. This only holds if run #1's write
  // landed in the DB and was read back after the reload. If the result were lost
  // on reload (risk #1), this would read "Consecutive clean: 1." again.
  await runSession(page, { dirty: false });
  await expect(page.getByText("Consecutive clean: 2.")).toBeVisible();
});

// rotation-notation-fix.spec.ts
//
// Risk (context/changes/rotation-notation-fix): seven seeded algorithms store
//   the non-standard token `R2'`/`U2'`. `dispatchMove`
//   (PracticeSession.tsx:291-296) assembles a token as base → lower(base) →
//   +"2", always appending "2" LAST, so it can never emit a "2" followed by a
//   "'". A slot holding such a token can never be satisfied: no error, no
//   crash, `currentIndex` never advances, the session never reaches
//   "submitting" and no banner ever renders.
// Protection proof: drive OLL 28 (`M' U' M U2' M' U' M` — the shortest of the
//   7 affected rows, one bad slot) to its completion banner. The banner is only
//   reachable if slot 4 accepts a producible double-turn token, so this test is
//   red while the live row is wrong and green once it stores `U2`.
// Phase 1 runs this BEFORE any fix lands: the remote Supabase project the
//   preview server targets is broken today, so the red is genuine, not staged.
// Seed/levers: playwright/test/seed.spec.ts + playwright/test/E2E_RULES.md.
// Boundaries: auth, routing, API, and DB all REAL — the bug lives in the DB
//   data crossing into the reducer's token comparison; nothing mocked.
// Side effect: writes practice_sessions + algorithm_mastery rows for the seeded
//   user against the real Supabase project. No browser-side DB teardown exists;
//   the scenario self-normalizes with a leading dirty run (streak → 0), which
//   also keeps the count below the PRO threshold (3) so the assertion stays
//   deterministic across re-runs.
import { test, expect, type Page } from "@playwright/test";

// OLL set + "OLL 28" = "M' U' M U2 M' U' M" (supabase/algos_seed.sql). Before
// this change the same row held "M' U' M U2' M' U' M" — the unreachable token.
const OLL_LIST = "00000000-0000-0000-0000-000000000003";
const ALGO_NAME = "OLL 28";
const WRONG_MOVE = "D"; // not the first expected token (M') → marks a wrong attempt

// Click each move token in order via its exact-named grid button. `X2` reaches
// the double-turn slot: the modifier appends "2" to the BASE, so `U2` is
// X2 + "U" (X2 + "U'" would assemble "U'2"). The modifier auto-clears on every
// INPUT_MOVE, so it is never toggled back off.
async function inputSequence(page: Page): Promise<void> {
  for (const move of ["M'", "U'", "M"]) {
    await page.getByRole("button", { name: move, exact: true }).click();
  }

  await page.getByRole("button", { name: "X2", exact: true }).click();
  await page.getByRole("button", { name: "U", exact: true }).click();

  for (const move of ["M'", "U'", "M"]) {
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

// Run one full session from the idle screen.
async function runSession(page: Page, opts: { dirty: boolean }): Promise<void> {
  await startSession(page);
  if (opts.dirty) {
    // One wrong attempt (errorCount ≥ 1) before completing → streak resets to 0.
    await page.getByRole("button", { name: WRONG_MOVE, exact: true }).click();
  }
  await inputSequence(page);
}

test("a double-turn slot is reachable: OLL 28 completes a clean run", async ({ page }) => {
  // Reach the algorithm via its set page (algo UUID stays out of the test).
  await page.goto(`/sets/${OLL_LIST}`);
  await page.getByRole("link", { name: ALGO_NAME }).click();
  await expect(page.getByRole("heading", { name: ALGO_NAME })).toBeVisible();

  // Normalize: a dirty run resets the persisted streak to 0 (deterministic
  // start, and keeps us below the PRO threshold).
  await runSession(page, { dirty: true });
  await expect(page.getByText(/Streak reset\./)).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Start Practice" })).toBeVisible();

  // Clean run → the banner the stuck slot makes unreachable. Exact count, so a
  // stale streak or a PRO banner is a failure, not a silent pass.
  await runSession(page, { dirty: false });
  await expect(page.getByText("Consecutive clean: 1.")).toBeVisible();
});

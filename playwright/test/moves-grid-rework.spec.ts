// moves-grid-rework.spec.ts
//
// Risk (test-plan.md #5, Medium×High): "Grid input desync — a button or
//   keyboard shortcut maps to the wrong move token; a layout rework remaps
//   keys." The moves-grid-update rework (context/changes/moves-grid-update)
//   made F/F'/B/B' L-shaped 2x2 buttons with f/f'/b/b' notched into their
//   corner via a `notch`-driven CSS clip-path on the big button — a risk
//   that only exists in the rendered UI: if a move token got mis-mapped to
//   the wrong button, clicking it would activate the wrong move (or nothing).
// Protection proof: drive a real algorithm ("OLL 3") whose move sequence
//   hits both new big buttons (F, F') and their notch neighbors (f, f') in
//   order; each click targets its move by exact accessible name. If a move
//   token were mis-mapped, the reducer would see the wrong token and the
//   run would end dirty (or stall) instead of reaching the clean-run banner.
// Seed/levers: playwright/test/seed.spec.ts + playwright/test/E2E_RULES.md.
// Boundaries: auth, routing, API, and DB all REAL; nothing mocked. Auth via
//   shared storageState (playwright.config.ts).
// Side effect: writes practice_sessions + algorithm_mastery rows for the
//   seeded user against the real Supabase project. No browser-side DB
//   teardown exists; the scenario self-normalizes by starting with a dirty
//   run (resets streak -> 0), which also keeps the count below the PRO
//   threshold (3) so assertions stay deterministic.
import { test, expect, type Page } from "@playwright/test";

// OLL set + "OLL 3" = "f (R U R' U') f' U' F (R U R' U') F'" (supabase/algos_seed.sql).
// 13 tokens; exercises both new L-shaped buttons (F, F') and their notches (f, f').
const OLL_LIST = "00000000-0000-0000-0000-000000000003";
const ALGO_NAME = "OLL 3";
const SEQUENCE = ["f", "R", "U", "R'", "U'", "f'", "U'", "F", "R", "U", "R'", "U'", "F'"];
const WRONG_MOVE = "D"; // not the first expected token (f) -> marks a wrong attempt

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
    // One wrong attempt (errorCount >= 1) before completing -> streak resets to 0.
    await page.getByRole("button", { name: WRONG_MOVE, exact: true }).click();
  }
  await inputSequence(page, SEQUENCE);
}

test("a clean OLL 3 run through the reworked Side grid reaches the clean-run banner", async ({ page }) => {
  // Reach the algorithm via its set page (algo UUID stays out of the test).
  await page.goto(`/sets/${OLL_LIST}`);
  // The link's accessible name is "<position> OLL 3 →"; a plain substring
  // match also hits "OLL 30".."OLL 39", so anchor with a negative lookahead
  // on a trailing digit instead of using `exact` (accessible name isn't the
  // bare algo name — it includes the row position and trailing arrow glyph).
  await page.getByRole("link", { name: new RegExp(`${ALGO_NAME}(?!\\d)`) }).click();
  await expect(page.getByRole("heading", { name: ALGO_NAME })).toBeVisible();

  // Normalize: a dirty run resets the persisted streak to 0 (deterministic
  // start, and keeps us below the PRO threshold).
  await runSession(page, { dirty: true });
  await expect(page.getByText(/Streak reset\./)).toBeVisible();

  // Completion screen's button is "Try Again", not "Start Practice" — a real
  // reload returns to the idle screen so the second run starts the same way
  // as the first (matches practice-loop-persistence.spec.ts's house style).
  await page.reload();
  await expect(page.getByRole("button", { name: "Start Practice" })).toBeVisible();

  // Clean run through the reworked grid: f (notch) -> R U R' U' -> f' (notch)
  // -> U' -> F (big button) -> R U R' U' -> F' (big button). Each click must
  // land on its own token, not the big button its notch sits inside.
  await runSession(page, { dirty: false });
  await expect(page.getByText("Consecutive clean: 1.")).toBeVisible();
});

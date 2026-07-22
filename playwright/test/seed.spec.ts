// seed.spec.ts — the E2E exemplar every MemQ spec is modeled on.
// Demonstrates the four patterns: role-based locators (exact:true for the
// colliding move buttons), full self-contained cycle, wait-for-state (never
// time), and a risk-tied test name. Auth comes from the shared storageState
// in playwright.config.ts — no UI sign-in.
//
// Risk: practice loop integrity (test-plan.md #1/#3) — a clean run must reach
// the complete banner across the real auth→routing→UI→API→DB boundary.
import { test, expect } from "@playwright/test";

// F2L set + "Basic 1" = "R U R'" (supabase/algos_seed.sql). Three direct moves.
const F2L_LIST = "00000000-0000-0000-0000-000000000002";
const CLEAN_SEQUENCE = ["R", "U", "R'"];

test("a clean practice run reaches the clean-run banner", async ({ page }) => {
  // Open the algorithm via its set page so the algo UUID is never hardcoded.
  await page.goto(`/sets/${F2L_LIST}`);
  await page.getByRole("link", { name: "Basic 1" }).click();
  await expect(page.getByRole("heading", { name: "Basic 1" })).toBeVisible();

  // idle → active. PracticeSession is a client:load island — a click before
  // hydration is lost, so retry until the active phase ("Stop") appears.
  await expect(async () => {
    await page.getByRole("button", { name: "Start Practice" }).click();
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  }).toPass();

  // Input each move token in order via its exact-named button.
  for (const move of CLEAN_SEQUENCE) {
    await page.getByRole("button", { name: move, exact: true }).click();
  }

  // Wait for the persisted result, not a timeout: the clean-run banner.
  await expect(page.getByText(/Consecutive clean: \d+\./)).toBeVisible();
});

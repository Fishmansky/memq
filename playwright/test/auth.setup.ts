// auth.setup.ts — Playwright "setup" project. Signs in ONCE through the real
// UI and saves the authenticated cookies to storageState, which every other
// spec reuses (never sign in inside an individual test). Runs before the
// chromium project via the dependency wired in playwright.config.ts.
//
// Target: the same Supabase project the preview server serves (see .dev.vars) —
// NOT the local stack in .env.test. The signed-in user must already exist and
// be email-confirmed in that project.
//
// Credentials come from the environment (never hardcoded, never committed):
//   E2E_USERNAME, E2E_PASSWORD
// Put them in a gitignored .env.e2e (see .env.e2e.example) or export them in
// the shell before running. loadE2EEnv() (playwright/test/support/e2eEnv.ts)
// reads .env.e2e if present; a shell export always wins.
import { test as setup, expect } from "@playwright/test";
import { loadE2EEnv } from "./support/e2eEnv";
import { awaitIslandsHydrated } from "./support/islands";

const STORAGE_STATE = "playwright/.auth/user.json";

setup("authenticate", async ({ page }) => {
  loadE2EEnv();
  const email = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Missing E2E credentials. Set E2E_USERNAME and E2E_PASSWORD (in a gitignored " +
        ".env.e2e or the shell) for a confirmed user in the project preview serves.",
    );
  }

  // Sign in through the real form → SSR endpoint sets the Supabase auth cookie.
  await page.goto("/auth/signin");

  // The form is a client:load React island. A fill that lands before hydration
  // writes the DOM value but never reaches React state — and the value sticks,
  // so asserting it cannot detect the race (the submit then fails with "Email is
  // required"). Wait for Astro's own hydration signal instead.
  await awaitIslandsHydrated(page);

  const emailField = page.getByLabel("Email", { exact: true });
  // exact:true so "Password" doesn't also match the "Show password" toggle.
  const passwordField = page.getByLabel("Password", { exact: true });
  await emailField.fill(email);
  await expect(emailField).toHaveValue(email);
  await passwordField.fill(password);
  await expect(passwordField).toHaveValue(password);

  await page.getByRole("button", { name: "Sign in" }).click();

  // Successful sign-in redirects to /dashboard; the top bar shows "Sign out".
  await page.waitForURL("/dashboard");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  await page.context().storageState({ path: STORAGE_STATE });
});

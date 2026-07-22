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
// the shell before running. The loader below reads .env.e2e if present.
import { existsSync, readFileSync } from "node:fs";
import { test as setup, expect } from "@playwright/test";

const STORAGE_STATE = "playwright/.auth/user.json";

// Minimal, dependency-free .env.e2e loader (dotenv is not installed). Only sets
// keys that aren't already in the environment, so a shell export wins.
function loadEnvE2E(): void {
  if (!existsSync(".env.e2e")) return;
  for (const line of readFileSync(".env.e2e", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    process.env[key] ??= value;
  }
}

setup("authenticate", async ({ page }) => {
  loadEnvE2E();
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
  // is discarded when React mounts and resets the controlled value to "". Retry
  // until the value actually sticks, proving the field is hydrated.
  const emailField = page.getByLabel("Email", { exact: true });
  // exact:true so "Password" doesn't also match the "Show password" toggle.
  const passwordField = page.getByLabel("Password", { exact: true });
  await expect(async () => {
    await emailField.fill(email);
    await expect(emailField).toHaveValue(email);
  }).toPass();
  await passwordField.fill(password);
  await expect(passwordField).toHaveValue(password);

  await page.getByRole("button", { name: "Sign in" }).click();

  // Successful sign-in redirects to /dashboard; the top bar shows "Sign out".
  await page.waitForURL("/dashboard");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  await page.context().storageState({ path: STORAGE_STATE });
});

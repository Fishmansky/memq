import { defineConfig, devices } from "@playwright/test";

// E2E config for MemQ. Single-spec runs: `npx playwright test <file>`.
// Auth is reused from a pre-captured storageState (playwright/.auth/user.json)
// — a real signed-in session against the remote Supabase project the dev
// server also targets (see .dev.vars). The app boots via the webServer block.
export default defineConfig({
  testDir: "./playwright/test",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4321",
    trace: "on-first-retry",
  },
  projects: [
    // Signs in through the UI once and writes playwright/.auth/user.json.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
  // Serve the BUILT worker (not `astro dev`): the Cloudflare workerd dev runtime
  // loads two copies of React and the client island crashes on `useReducer`.
  // The production bundle dedupes React and renders correctly. Note: `preview`
  // serves dist/, so app-code changes require a rebuild to take effect.
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:4321",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

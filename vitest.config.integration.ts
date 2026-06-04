import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Node-environment Vitest config for DB-backed integration specs (*.int.test.ts).
// Kept separate from vitest.config.ts (jsdom unit/component suite) and from
// astro.config.mjs so neither the Cloudflare/SSR adapter nor astro:env enters
// the graph. Integration specs build their own @supabase/supabase-js client from
// process.env (see src/test/integration/db.ts) — they never import the app's
// astro:env-bound @/lib/supabase.
//
// Run with: npm run test:integration (NOT part of the default `npm test`).
// Requires a local Supabase stack (npx supabase start) and a .env.test file
// (copy .env.test.example).
//
// SAFETY: credentials come ONLY from .env.test — we deliberately do NOT use
// Vite's loadEnv (which also merges .env), so the destructive setup/teardown
// (deleteTestUser, cleanupUserRows) can never accidentally run against the
// dev/cloud database configured in .env. Missing/empty keys are simply not
// injected, which trips the loud guard in src/test/integration/setup.ts.

function loadDotEnvTest(): Record<string, string> {
  const path = fileURLToPath(new URL("./.env.test", import.meta.url));
  const out: Record<string, string> = {};
  if (!existsSync(path)) {
    return out;
  }
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    const value = rawValue.replace(/^["']|["']$/g, "");
    if (key && value) {
      out[key] = value;
    }
  }
  return out;
}

const dbEnv = loadDotEnvTest();

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.int.test.ts"],
    setupFiles: ["./src/test/integration/setup.ts"],
    // Only keys actually present in .env.test reach the test workers.
    env: dbEnv,
  },
});

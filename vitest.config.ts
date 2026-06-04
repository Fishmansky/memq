import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// Standalone Vitest config, independent of astro.config.mjs, so the test
// runtime does not pull in the Cloudflare adapter / SSR plugins. The `@/*`
// alias mirrors tsconfig.json (@ -> ./src).
//
// This is the fast unit/component suite (`npm test`). DB-backed integration
// specs (*.int.test.ts) live in vitest.config.integration.ts and are excluded
// here so the default suite never needs a database.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: [...configDefaults.exclude, "src/**/*.int.test.ts"],
  },
});

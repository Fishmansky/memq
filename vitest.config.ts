import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Standalone Vitest config, independent of astro.config.mjs, so the test
// runtime does not pull in the Cloudflare adapter / SSR plugins. The `@/*`
// alias mirrors tsconfig.json (@ -> ./src).
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
  },
});

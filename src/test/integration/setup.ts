// Integration setup: fail loudly (not silently) when the test DB credentials
// are absent, so a missing local stack / .env.test produces a clear message
// rather than a cryptic connection crash deep inside a spec.

const REQUIRED = ["SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

const missing = REQUIRED.filter((key) => !process.env[key]);

if (missing.length > 0) {
  throw new Error(
    `Integration tests need ${missing.join(", ")}. ` +
      `Copy .env.test.example to .env.test and start a local Supabase stack ` +
      `(\`npx supabase start\`), then re-run \`npm run test:integration\`.`,
  );
}

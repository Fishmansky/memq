// Integration setup: fail loudly (not silently) when the test DB credentials
// are absent, so a missing local stack / .env.test produces a clear message
// rather than a cryptic connection crash deep inside a spec.
//
// It also refuses to run against anything but a local stack. These specs hold a
// service-role key, so they bypass RLS and truncate other people's rows; the
// README says "point these at a local stack, never at a shared project", and
// prose is not an enforcement mechanism.

const REQUIRED = ["SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

const missing = REQUIRED.filter((key) => !process.env[key]);

if (missing.length > 0) {
  throw new Error(
    `Integration tests need ${missing.join(", ")}. ` +
      `Copy .env.test.example to .env.test and start a local Supabase stack ` +
      `(\`npx supabase start\`), then re-run \`npm run test:integration\`.`,
  );
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "host.docker.internal", "kong"]);

const host = (() => {
  try {
    return new URL(process.env.SUPABASE_URL ?? "").hostname;
  } catch {
    return null;
  }
})();

if (host === null) {
  throw new Error(`SUPABASE_URL is not a valid URL: ${JSON.stringify(process.env.SUPABASE_URL)}`);
}

if (!LOCAL_HOSTS.has(host)) {
  throw new Error(
    `Refusing to run integration tests against non-local host "${host}". ` +
      `These specs hold a service-role key and delete rows wholesale. ` +
      `Point SUPABASE_URL at a local stack (\`npx supabase start\`).`,
  );
}

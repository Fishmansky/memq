// Shared Playwright support: environment loading + a Supabase client for
// spec teardown. NOT a spec (no `.spec.ts` suffix), so Playwright's default
// testMatch never collects it.
//
// Why a hand-rolled loader: dotenv is not installed, and the app's
// `@/lib/supabase` imports `astro:env/server`, which does not resolve in
// Playwright's node context (same constraint documented in
// src/test/integration/db.ts).
//
// Where the values come from:
//   .env.e2e   — E2E_USERNAME / E2E_PASSWORD (gitignored; see .env.e2e.example)
//   .dev.vars  — SUPABASE_URL / SUPABASE_KEY, the same project `npm run preview`
//                serves, so teardown deletes from the DB the browser wrote to
//
// Teardown uses the E2E user's OWN session (anon key + sign-in), not a
// service-role key: the F-01 policies `al_delete` / `alg_delete` already let a
// learner delete their own non-system lists and their algorithms, so cleanup
// needs no extra privilege and no extra secret.
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

const ENV_FILES = [".env.e2e", ".dev.vars"] as const;

/**
 * Load `key=value` lines from .env.e2e and .dev.vars into process.env.
 * Only sets keys that are not already present, so a shell export always wins.
 */
export function loadE2EEnv(): void {
  for (const file of ENV_FILES) {
    if (!existsSync(file)) {
      continue;
    }
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const eq = trimmed.indexOf("=");
      if (eq === -1) {
        continue;
      }
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      process.env[key] ??= value;
    }
  }
}

/** Read a required env var after loadE2EEnv(), failing loudly rather than at query time. */
function required(key: string, hint: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing ${key} for E2E teardown. ${hint}`);
  }
  return value;
}

/**
 * A Supabase client signed in as the E2E user — the same identity the browser
 * runs as via storageState. RLS applies, which is the point: teardown can only
 * reach rows this spec was allowed to create.
 */
export async function signedInUserClient(): Promise<SupabaseClient<Database>> {
  loadE2EEnv();
  const url = required("SUPABASE_URL", "Set it in .dev.vars (the project `npm run preview` serves).");
  const anonKey = required("SUPABASE_KEY", "Set it in .dev.vars alongside SUPABASE_URL.");
  const email = required("E2E_USERNAME", "Set it in a gitignored .env.e2e (see .env.e2e.example).");
  const password = required("E2E_PASSWORD", "Set it in a gitignored .env.e2e (see .env.e2e.example).");

  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw error;
  }
  return client;
}

/**
 * Delete the named lists owned by the signed-in user, and their algorithms.
 *
 * Order is load-bearing (same rule as src/test/integration/db.ts): child
 * `algorithms` rows first, then the lists. Names — not a shared prefix — scope
 * the sweep, so a teardown in one parallel worker cannot delete a list another
 * worker is still driving.
 */
export async function deleteOwnLists(client: SupabaseClient<Database>, names: string[]): Promise<void> {
  if (names.length === 0) {
    return;
  }

  const lists = await client.from("algorithm_lists").select("id").in("name", names);
  if (lists.error) {
    throw lists.error;
  }
  const listIds = lists.data.map((row) => row.id);
  if (listIds.length === 0) {
    return;
  }

  // Guarded: `.in("list_id", [])` is not a no-op filter in PostgREST.
  const algorithms = await client.from("algorithms").delete().in("list_id", listIds);
  if (algorithms.error) {
    throw algorithms.error;
  }
  const deletedLists = await client.from("algorithm_lists").delete().in("id", listIds);
  if (deletedLists.error) {
    throw deletedLists.error;
  }
}

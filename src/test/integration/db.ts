// Integration-test DB helpers. Build clients directly from @supabase/supabase-js
// + process.env — NEVER from the app's @/lib/supabase (that imports
// astro:env/server, which does not resolve under node/Vitest).
//
// Two client roles:
//  - service-role client: fixture setup/teardown + read-back cross-checks
//    (bypasses RLS). Used by helpers here.
//  - authed-user client: the RLS-governed write path the endpoint actually uses
//    (anon key + a signed-in user). Returned by createTestUser().

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

const url = process.env.SUPABASE_URL ?? "";
const anonKey = process.env.SUPABASE_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } } as const;

/** Service-role client: bypasses RLS. Setup/teardown/read-back only. */
export function serviceClient(): SupabaseClient<Database> {
  return createClient<Database>(url, serviceKey, noPersist);
}

export interface TestUser {
  userId: string;
  /** Anon-key client signed in as this user — RLS applies, like the real endpoint. */
  authedClient: SupabaseClient<Database>;
}

/** Create a throwaway, email-confirmed user and return a client signed in as them. */
export async function createTestUser(svc: SupabaseClient<Database>): Promise<TestUser> {
  const email = `int-test-${crypto.randomUUID()}@example.com`;
  const password = `pw-${crypto.randomUUID()}`;

  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    throw error;
  }

  const authedClient = createClient<Database>(url, anonKey, noPersist);
  const { error: signInError } = await authedClient.auth.signInWithPassword({ email, password });
  if (signInError) {
    throw signInError;
  }

  return { userId: data.user.id, authedClient };
}

/** Delete a throwaway user (cascades their practice_sessions / algorithm_mastery rows). */
export async function deleteTestUser(svc: SupabaseClient<Database>, userId: string): Promise<void> {
  const { error } = await svc.auth.admin.deleteUser(userId);
  if (error) {
    throw error;
  }
}

/**
 * Remove a user's own rows between tests; leaves pre-built content intact.
 *
 * Order is load-bearing. The user's `algorithms` go before their
 * `algorithm_lists` (child rows first — the FK cascade runs list → algorithms,
 * not the other way), and both go before `practice_sessions` /
 * `algorithm_mastery`: any progress row pointing at a deleted custom algorithm
 * cascades away with it, and the trailing per-user deletes then sweep whatever
 * sat on pre-built algorithms.
 */
export async function cleanupUserRows(svc: SupabaseClient<Database>, userId: string): Promise<void> {
  const lists = await svc.from("algorithm_lists").select("id").eq("user_id", userId);
  if (lists.error) {
    throw lists.error;
  }
  const listIds = lists.data.map((row) => row.id);
  if (listIds.length > 0) {
    // Guarded: `.in("list_id", [])` is not a no-op filter in PostgREST.
    const algorithms = await svc.from("algorithms").delete().in("list_id", listIds);
    if (algorithms.error) {
      throw algorithms.error;
    }
    const ownedLists = await svc.from("algorithm_lists").delete().eq("user_id", userId);
    if (ownedLists.error) {
      throw ownedLists.error;
    }
  }

  const sessions = await svc.from("practice_sessions").delete().eq("user_id", userId);
  if (sessions.error) {
    throw sessions.error;
  }
  const mastery = await svc.from("algorithm_mastery").delete().eq("user_id", userId);
  if (mastery.error) {
    throw mastery.error;
  }
}

/**
 * Fixture: create a private, user-owned list for `userId` via the service
 * client. Setup only — the RLS-governed create path is exercised by the specs
 * that assert on it, not by this helper.
 *
 * `is_system: false` and a non-null `user_id` are required *together* by
 * `algorithm_lists_ownership_check`.
 */
export async function createList(
  svc: SupabaseClient<Database>,
  userId: string,
  name = `int-test-list-${crypto.randomUUID()}`,
): Promise<string> {
  const { data, error } = await svc
    .from("algorithm_lists")
    .insert({ name, user_id: userId, is_system: false })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  return data.id;
}

/**
 * Fetch `count` seeded algorithm ids (the rows have generated UUIDs, so tests
 * discover them at runtime rather than hardcoding). Ordered by name for
 * stability across runs.
 */
export async function getSeededAlgorithmIds(svc: SupabaseClient<Database>, count = 2): Promise<string[]> {
  const { data, error } = await svc.from("algorithms").select("id").order("name").limit(count);
  if (error) {
    throw error;
  }
  if (data.length < count) {
    throw new Error(
      `Expected at least ${count} seeded algorithm(s); found ${data.length}. ` +
        `Run \`npx supabase db reset\` to load supabase/seed.sql.`,
    );
  }
  return data.map((row) => row.id);
}

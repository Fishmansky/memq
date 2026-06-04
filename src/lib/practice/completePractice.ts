// Node-importable core of POST /api/practice/complete, decoupled from HTTP and
// astro:env so it can be exercised directly in tests (hermetic stubs for the
// failure branches a real DB cannot trigger on demand; a real Supabase client
// for the persistence + streak round-trip). The route in
// src/pages/api/practice/complete.ts is a thin wrapper that builds the client,
// validates input, then maps this function's result onto a Response.
//
// Behavior here is byte-for-byte the previous inline endpoint logic: same
// insert -> read -> computeStreak -> upsert sequence, same status codes, same
// console.error calls. Do not change the streak rule or the non-atomic shape.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { computeStreak } from "@/lib/practice/streak";

export interface CompletePracticeUser {
  id: string;
}

export interface CompletePracticeInput {
  algorithmId: string;
  isClean: boolean;
  errorCount: number;
}

export type CompletePracticeResult =
  | { status: 200; body: { consecutiveClean: number; masteryReached: boolean } }
  | { status: 400; body: { error: "Invalid algorithmId" } }
  | { status: 500; body: { error: "Failed to record session" } };

/**
 * Persist a finished practice session and update the per-algorithm streak.
 *
 * NOTE (accepted lost-update race): the read of algorithm_mastery and the
 * later upsert are not atomic. Two completions for the same (user, algorithm)
 * that overlap can both read N and write N+1, so a genuinely-distinct second
 * clean run can be undercounted by one. `mastery_reached` is monotonic and
 * never regresses. Under the only realistic single-user trigger — a fast
 * double-submit / retry of the SAME session — the lost update yields the
 * correct count (one real run = +1), so it is benign there. Accepted for the
 * single-user profile; revisit with an atomic Postgres RPC only if streak
 * accuracy under genuine concurrency (multi-device) ever matters. See
 * context/archive/2026-05-28-practice-session-core-loop/plan.md.
 */
export async function completePractice(
  supabase: SupabaseClient<Database>,
  user: CompletePracticeUser,
  input: CompletePracticeInput,
): Promise<CompletePracticeResult> {
  const { algorithmId, isClean, errorCount } = input;

  const [sessionResult, masteryResult] = await Promise.all([
    supabase.from("practice_sessions").insert({
      user_id: user.id,
      algorithm_id: algorithmId,
      is_clean: isClean,
      error_count: errorCount,
    }),
    supabase
      .from("algorithm_mastery")
      .select("consecutive_clean, mastery_reached")
      .eq("user_id", user.id)
      .eq("algorithm_id", algorithmId)
      .maybeSingle(),
  ]);

  if (sessionResult.error) {
    // FK violation = unknown/invalid algorithmId → client error, not server fault.
    if (sessionResult.error.code === "23503") {
      return { status: 400, body: { error: "Invalid algorithmId" } };
    }
    console.error("practice/complete session insert failed", sessionResult.error);
    return { status: 500, body: { error: "Failed to record session" } };
  }

  if (masteryResult.error) {
    console.error("practice/complete mastery read failed", masteryResult.error);
    return { status: 500, body: { error: "Failed to record session" } };
  }

  const currentClean = masteryResult.data?.consecutive_clean ?? 0;
  const alreadyMastered = masteryResult.data?.mastery_reached ?? false;
  const { newConsecutiveClean, newMasteryReached } = computeStreak(currentClean, alreadyMastered, isClean);

  const { error: upsertError } = await supabase.from("algorithm_mastery").upsert(
    {
      user_id: user.id,
      algorithm_id: algorithmId,
      consecutive_clean: newConsecutiveClean,
      mastery_reached: newMasteryReached,
    },
    { onConflict: "user_id,algorithm_id" },
  );

  if (upsertError) {
    console.error("practice/complete mastery upsert failed", upsertError);
    return { status: 500, body: { error: "Failed to record session" } };
  }

  return {
    status: 200,
    body: {
      consecutiveClean: newConsecutiveClean,
      masteryReached: newMasteryReached,
    },
  };
}

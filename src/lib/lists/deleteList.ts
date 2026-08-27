// Node-importable core of DELETE /api/lists/:listId, decoupled from HTTP and
// astro:env so it can be exercised directly in tests. The route in
// src/pages/api/lists/[listId]/index.ts is a thin wrapper that builds the
// client, shape-checks the param, then maps this function's result onto a
// Response. Same split as createList.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

export interface DeleteListInput {
  listId: string;
}

export type DeleteListResult =
  | { status: 204 }
  | { status: 404; body: { error: "List not found" } }
  | { status: 500; body: { error: "Failed to delete list" } };

/**
 * Delete one user-owned algorithm list.
 *
 * Authorization is the `al_delete` policy, not a hand-rolled ownership check:
 * it requires `user_id = auth.uid() AND is_system = false`, so another user's
 * list and every pre-built set are already unreachable. The delete carries a
 * `.select("id")` purely so the affected rows are observable — PostgREST
 * reports a policy-filtered DELETE as 200 over an empty array, not an error.
 *
 * Zero rows means the policy excluded it (not owned, or pre-built) OR it never
 * existed, and both map to 404. That collapse is deliberate: a 403 here would
 * confirm the row exists to someone not allowed to see it — the same rule
 * addExistingAlgorithm.ts follows for an unreadable source id.
 *
 * The delete cascades: `algorithms` in this list go with it, and their
 * `practice_sessions` / `algorithm_mastery` rows cascade again. There is no
 * undo; the confirm step in the UI is the only safeguard.
 */
export async function deleteList(
  supabase: SupabaseClient<Database>,
  input: DeleteListInput,
): Promise<DeleteListResult> {
  const { data, error } = await supabase.from("algorithm_lists").delete().eq("id", input.listId).select("id");

  if (error) {
    // Log the raw error server-side; never echo it to the client — a DB error
    // string can leak schema and policy details.
    console.error("lists/deleteList delete failed", error);
    return { status: 500, body: { error: "Failed to delete list" } };
  }

  if (data.length === 0) {
    return { status: 404, body: { error: "List not found" } };
  }

  return { status: 204 };
}

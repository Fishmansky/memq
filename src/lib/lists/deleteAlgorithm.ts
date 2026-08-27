// Node-importable core of DELETE /api/algorithms/:algoId. The route in
// src/pages/api/algorithms/[algoId].ts is a thin wrapper. Same split as
// deleteList.ts.
//
// Addressed flatly, without the owning list in the path: the create route
// already documents that a `listId` path segment carries no authority
// (src/pages/api/lists/[listId]/algorithms.ts:11-12) — `alg_delete` decides.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

export interface DeleteAlgorithmInput {
  algorithmId: string;
}

export type DeleteAlgorithmResult =
  | { status: 200; body: { listId: string } }
  | { status: 404; body: { error: "Algorithm not found" } }
  | { status: 500; body: { error: "Failed to delete algorithm" } };

/**
 * Delete one algorithm from a list the caller owns.
 *
 * Authorization is the `alg_delete` policy: it requires the owning list to be
 * the caller's and non-system, so a pre-built entry and another learner's row
 * are both unreachable. Zero rows affected → 404, the same see-it-or-not
 * collapse as deleteList.ts.
 *
 * Returns 200 with a body rather than 204 because the response carries the
 * deleted row's `list_id` — the client needs it to navigate back to the list
 * page once the algorithm it was viewing is gone.
 *
 * The delete cascades into `practice_sessions` and `algorithm_mastery`; a
 * learner's *copy* of this row survives, since `source_algorithm_id` is
 * ON DELETE SET NULL.
 */
export async function deleteAlgorithm(
  supabase: SupabaseClient<Database>,
  input: DeleteAlgorithmInput,
): Promise<DeleteAlgorithmResult> {
  const { data, error } = await supabase.from("algorithms").delete().eq("id", input.algorithmId).select("id, list_id");

  if (error) {
    console.error("lists/deleteAlgorithm delete failed", error);
    return { status: 500, body: { error: "Failed to delete algorithm" } };
  }

  if (data.length === 0) {
    return { status: 404, body: { error: "Algorithm not found" } };
  }

  return { status: 200, body: { listId: data[0].list_id } };
}

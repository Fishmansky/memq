// Node-importable core of POST /api/lists/:listId/algorithms (the
// sourceAlgorithmId body shape) — the "add this one to my list instead" branch
// of FR-015.
//
// algorithms.list_id is NOT NULL, so one row is one list membership by
// construction: adding an *existing* algorithm to another list is
// unrepresentable without either a copy or a schema change. This copies the row
// and records source_algorithm_id, which keeps the one-row-one-list invariant,
// needs no RLS policy change, and breaks no read path. Consequence: the copy
// starts a fresh mastery streak (algorithm_mastery is keyed by algorithm_id).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import type { AddedAlgorithm } from "@/lib/lists/addAlgorithm";

export interface AddExistingAlgorithmInput {
  listId: string;
  sourceAlgorithmId: string;
}

export type AddExistingAlgorithmResult =
  | { status: 201; body: { status: "created"; algorithm: AddedAlgorithm } }
  | { status: 409; body: { status: "already_in_list" } }
  | { status: 404; body: { error: "Algorithm not found" } }
  | { status: 403; body: { error: "Not your list" } }
  | { status: 500; body: { error: "Failed to add algorithm" } };

const RLS_VIOLATION = "42501";

/**
 * Copy an already-visible algorithm into one of the caller's lists.
 *
 * The source row is read through the AUTHED client, so `alg_select` decides
 * visibility: an id the caller cannot see is indistinguishable from one that
 * does not exist, and both return 404. That is the intended behaviour — a 403
 * here would confirm the row exists to someone not allowed to see it.
 */
export async function addExistingAlgorithm(
  supabase: SupabaseClient<Database>,
  input: AddExistingAlgorithmInput,
): Promise<AddExistingAlgorithmResult> {
  const { listId, sourceAlgorithmId } = input;

  const { data: source, error: sourceError } = await supabase
    .from("algorithms")
    .select("id, name, moves, moves_normalized")
    .eq("id", sourceAlgorithmId)
    .maybeSingle();

  if (sourceError) {
    console.error("lists/addExistingAlgorithm source read failed", sourceError);
    return { status: 500, body: { error: "Failed to add algorithm" } };
  }
  if (!source) {
    return { status: 404, body: { error: "Algorithm not found" } };
  }

  // Don't create a second copy of a sequence the target list already holds.
  // Compared on the normalized column, so a differently-spaced copy still counts.
  const { data: existing, error: existingError } = await supabase
    .from("algorithms")
    .select("id")
    .eq("list_id", listId)
    .eq("moves_normalized", source.moves_normalized ?? "")
    .limit(1)
    .maybeSingle();

  if (existingError) {
    console.error("lists/addExistingAlgorithm duplicate check failed", existingError);
    return { status: 500, body: { error: "Failed to add algorithm" } };
  }
  if (existing) {
    return { status: 409, body: { status: "already_in_list" } };
  }

  const { data: last, error: positionError } = await supabase
    .from("algorithms")
    .select("position")
    .eq("list_id", listId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (positionError) {
    console.error("lists/addExistingAlgorithm position read failed", positionError);
    return { status: 500, body: { error: "Failed to add algorithm" } };
  }

  // 1-based, matching the seeded lists and the rendered row number.
  const position = (last?.position ?? 0) + 1;

  const { data: inserted, error: insertError } = await supabase
    .from("algorithms")
    .insert({
      list_id: listId,
      name: source.name,
      moves: source.moves,
      position,
      source_algorithm_id: source.id,
    })
    .select("id, name, moves, position")
    .single();

  if (insertError) {
    // alg_insert rejects a list the caller does not own.
    if (insertError.code === RLS_VIOLATION) {
      return { status: 403, body: { error: "Not your list" } };
    }
    console.error("lists/addExistingAlgorithm insert failed", insertError);
    return { status: 500, body: { error: "Failed to add algorithm" } };
  }

  return { status: 201, body: { status: "created", algorithm: inserted } };
}

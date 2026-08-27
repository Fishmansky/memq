// Node-importable core of PATCH /api/algorithms/:algoId — the edit counterpart
// of addAlgorithm.ts. The route in src/pages/api/algorithms/[algoId].ts is a
// thin wrapper.
//
// The result union deliberately mirrors AddAlgorithmResult so EditAlgorithmForm
// can reuse the add form's three-state response handling.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { validateMoves } from "@/lib/notation/moveGrammar";
import { LIST_NAME_MAX_LENGTH } from "@/lib/lists/createList";
import type { AddedAlgorithm } from "@/lib/lists/addAlgorithm";
import { probeDuplicates, type DuplicateMatch } from "@/lib/lists/duplicateProbe";

export interface UpdateAlgorithmInput {
  algorithmId: string;
  name: string;
  moves: string;
  createAnyway?: boolean;
}

export type UpdateAlgorithmResult =
  | { status: 200; body: { status: "updated"; algorithm: AddedAlgorithm } }
  | { status: 200; body: { status: "duplicate"; match: DuplicateMatch } }
  | { status: 409; body: { status: "already_in_list"; match: DuplicateMatch } }
  | { status: 400; body: { error: string } }
  | { status: 404; body: { error: "Algorithm not found" } }
  | { status: 500; body: { error: "Failed to update algorithm" } };

// Postgres error codes surfaced through PostgREST.
const RLS_VIOLATION = "42501";

/**
 * Edit an algorithm's name and/or move sequence.
 *
 * Authorization is the `alg_update` policy — the owning list must be the
 * caller's and non-system — plus `alg_select` on the opening read. An id the
 * caller cannot see is indistinguishable from one that does not exist, and both
 * return 404.
 *
 * Two orderings in here are load-bearing; see the numbered steps.
 */
export async function updateAlgorithm(
  supabase: SupabaseClient<Database>,
  input: UpdateAlgorithmInput,
): Promise<UpdateAlgorithmResult> {
  const { algorithmId, createAnyway } = input;

  // 1. Read the current row through the AUTHED client, so `alg_select` decides
  // visibility. This also supplies the stored normalized sequence that step 3
  // compares against, and the list id the probe needs.
  const { data: current, error: readError } = await supabase
    .from("algorithms")
    .select("id, list_id, moves_normalized")
    .eq("id", algorithmId)
    .maybeSingle();

  if (readError) {
    console.error("lists/updateAlgorithm current read failed", readError);
    return { status: 500, body: { error: "Failed to update algorithm" } };
  }
  if (!current) {
    return { status: 404, body: { error: "Algorithm not found" } };
  }

  // 2. Validate, with the same rules and the same messages the add path uses.
  const name = input.name.trim();

  if (name === "") {
    return { status: 400, body: { error: "Enter an algorithm name." } };
  }
  if (name.length > LIST_NAME_MAX_LENGTH) {
    return {
      status: 400,
      body: { error: `Algorithm name must be ${String(LIST_NAME_MAX_LENGTH)} characters or fewer.` },
    };
  }

  const validation = validateMoves(input.moves);
  if (!validation.ok) {
    return { status: 400, body: { error: validation.error } };
  }

  // 3. Is the sequence actually changing? `moves_normalized` is a generated
  // column and typed nullable, though `moves` is NOT NULL and the expression is
  // total — the ?? "" only satisfies the type.
  //
  // An unchanged sequence means this is a NAME-ONLY edit, and it must skip both
  // the probe (nothing to collide with that was not already there) and the
  // mastery reset (the streak was earned on a sequence that still stands).
  const movesChanged = validation.normalized !== (current.moves_normalized ?? "");

  if (movesChanged) {
    // 4. Re-run FR-015, EXCLUDING the row under edit: it matches its own
    // normalized sequence and sits in the target list, so without the exclusion
    // every edit would report itself as already_in_list.
    const probe = await probeDuplicates(supabase, {
      normalizedMoves: validation.normalized,
      listId: current.list_id,
      excludeAlgorithmId: algorithmId,
    });

    if (probe.kind === "error") {
      console.error("lists/updateAlgorithm duplicate query failed", probe.error);
      return { status: 500, body: { error: "Failed to update algorithm" } };
    }
    if (probe.kind === "in_this_list") {
      return { status: 409, body: { status: "already_in_list", match: probe.match } };
    }
    if (probe.kind === "elsewhere" && createAnyway !== true) {
      return { status: 200, body: { status: "duplicate", match: probe.match } };
    }

    // 5. Clear the streak BEFORE writing the new moves. The order matters and
    // there is no transaction spanning two PostgREST calls: if the update landed
    // first and this then failed, the app would claim a mastery streak for a
    // sequence that was never practised — precisely the lie the reset exists to
    // prevent. Reset-first fails the other way, into a zeroed streak on an
    // unchanged algorithm, which the learner recovers by practising. That is the
    // weaker failure, so it is the one we accept.
    //
    // `am_update` scopes this to the caller's own row, so no user_id filter is
    // needed and at most one row is affected. Zero rows is normal — it just
    // means this algorithm was never practised. `updated_at` is left alone, as
    // completePractice.ts also leaves it, rather than making one writer refresh
    // a column the other does not.
    const { error: masteryError } = await supabase
      .from("algorithm_mastery")
      .update({ consecutive_clean: 0, mastery_reached: false })
      .eq("algorithm_id", algorithmId);

    if (masteryError) {
      console.error("lists/updateAlgorithm mastery reset failed", masteryError);
      return { status: 500, body: { error: "Failed to update algorithm" } };
    }
  }

  // 6. Update. `moves` is stored RAW — display-verbatim, matching the seeded
  // rows' parenthesised grouping. `moves_normalized` is NEVER in the payload:
  // Postgres rejects a write to a generated column, and it re-derives itself
  // from `moves` anyway.
  const { data: updated, error: updateError } = await supabase
    .from("algorithms")
    .update({ name, moves: input.moves })
    .eq("id", algorithmId)
    .select("id, name, moves, position");

  if (updateError) {
    // In practice unreachable: step 1's read already proved visibility, and
    // `alg_update` shares `alg_select`'s ownership test. Mapped to 404 for
    // consistency with the read rather than adding a fourth branch.
    if (updateError.code === RLS_VIOLATION) {
      return { status: 404, body: { error: "Algorithm not found" } };
    }
    console.error("lists/updateAlgorithm update failed", updateError);
    return { status: 500, body: { error: "Failed to update algorithm" } };
  }

  if (updated.length === 0) {
    return { status: 404, body: { error: "Algorithm not found" } };
  }

  return { status: 200, body: { status: "updated", algorithm: updated[0] } };
}

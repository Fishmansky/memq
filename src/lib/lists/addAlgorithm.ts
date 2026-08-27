// Node-importable core of POST /api/lists/:listId/algorithms (the name+moves
// body shape), decoupled from HTTP and astro:env. The route in
// src/pages/api/lists/[listId]/algorithms.ts is a thin wrapper. Same split as
// completePractice.ts.
//
// This is the FR-005 + FR-015 core: validate the notation, look for an
// already-visible algorithm with the same normalized sequence, and either
// report that match or insert.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { validateMoves } from "@/lib/notation/moveGrammar";
import { LIST_NAME_MAX_LENGTH } from "@/lib/lists/createList";
import { probeDuplicates, type DuplicateMatch } from "@/lib/lists/duplicateProbe";

// Re-exported: the duplicate shape moved to duplicateProbe.ts when the edit
// path started sharing the probe, and callers keep importing it from here.
export type { DuplicateMatch };

export interface AddAlgorithmInput {
  listId: string;
  name: string;
  moves: string;
  createAnyway?: boolean;
}

export interface AddedAlgorithm {
  id: string;
  name: string;
  moves: string;
  position: number;
}

export type AddAlgorithmResult =
  | { status: 201; body: { status: "created"; algorithm: AddedAlgorithm } }
  | { status: 200; body: { status: "duplicate"; match: DuplicateMatch } }
  | { status: 409; body: { status: "already_in_list"; match: DuplicateMatch } }
  | { status: 400; body: { error: string } }
  | { status: 403; body: { error: "Not your list" } }
  | { status: 500; body: { error: "Failed to add algorithm" } };

// Postgres error codes surfaced through PostgREST.
const RLS_VIOLATION = "42501";

/**
 * Add an algorithm to a list by name + move sequence, with FR-015 duplicate
 * detection.
 *
 * Authorization is the `alg_insert` policy, not a hand-rolled ownership check:
 * `listId` is client-supplied and deliberately not trusted here — an insert
 * into a list the caller does not own is rejected by RLS and mapped to 403.
 */
export async function addAlgorithm(
  supabase: SupabaseClient<Database>,
  input: AddAlgorithmInput,
): Promise<AddAlgorithmResult> {
  const { listId, createAnyway } = input;
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

  // 1. Notation. Rejecting here is the whole point of the validator: an
  // out-of-grammar token that reaches the DB freezes a practice session
  // silently (see src/lib/notation/moveGrammar.ts).
  const validation = validateMoves(input.moves);
  if (!validation.ok) {
    return { status: 400, body: { error: validation.error } };
  }

  // 2. Duplicate detection, in the probe shared with updateAlgorithm.ts —
  // including the RLS scoping, the pre-built-wins rule, and the ordering clause
  // that fails silently if mistyped. Nothing is excluded here: on add there is
  // no row of our own to leave out.
  const probe = await probeDuplicates(supabase, {
    normalizedMoves: validation.normalized,
    listId,
  });

  if (probe.kind === "error") {
    console.error("lists/addAlgorithm duplicate query failed", probe.error);
    return { status: 500, body: { error: "Failed to add algorithm" } };
  }

  // 3a. Already in THIS list — no copy, no second row. Not overridable by
  // createAnyway: one row is one list membership.
  if (probe.kind === "in_this_list") {
    return { status: 409, body: { status: "already_in_list", match: probe.match } };
  }

  // 3b. Visible elsewhere — offer it rather than silently duplicating.
  if (probe.kind === "elsewhere" && createAnyway !== true) {
    return { status: 200, body: { status: "duplicate", match: probe.match } };
  }

  // 4. Insert. `moves` is stored RAW — display-verbatim, matching the seeded
  // rows' parenthesised grouping; `moves_normalized` is derived from it by the
  // generated column. Storing raw is only safe because validateMoves also
  // token-checked parseMoves(raw).
  const { data: last, error: positionError } = await supabase
    .from("algorithms")
    .select("position")
    .eq("list_id", listId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (positionError) {
    console.error("lists/addAlgorithm position read failed", positionError);
    return { status: 500, body: { error: "Failed to add algorithm" } };
  }

  // 1-based, not 0-based, matching the seeded lists. `position` is an ORDERING
  // KEY only — AlgorithmRow.astro takes a display index instead, so a gap left
  // by a delete is never rendered and is never backfilled here either.
  const position = (last?.position ?? 0) + 1;

  const { data: inserted, error: insertError } = await supabase
    .from("algorithms")
    .insert({ list_id: listId, name, moves: input.moves, position })
    .select("id, name, moves, position")
    .single();

  if (insertError) {
    if (insertError.code === RLS_VIOLATION) {
      return { status: 403, body: { error: "Not your list" } };
    }
    console.error("lists/addAlgorithm insert failed", insertError);
    return { status: 500, body: { error: "Failed to add algorithm" } };
  }

  return { status: 201, body: { status: "created", algorithm: inserted } };
}

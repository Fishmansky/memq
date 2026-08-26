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
import { LIST_NAME_MAX_LENGTH, type ListUser } from "@/lib/lists/createList";

export interface AddAlgorithmInput {
  listId: string;
  name: string;
  moves: string;
  createAnyway?: boolean;
}

export interface DuplicateMatch {
  id: string;
  name: string;
  moves: string;
  listName: string;
  isSystem: boolean;
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

/** Shape of one row from the duplicate-detection query. */
interface MatchRow {
  id: string;
  name: string;
  moves: string;
  list_id: string;
  algorithm_lists: { name: string; is_system: boolean };
}

function toMatch(row: MatchRow): DuplicateMatch {
  // Flatten the embedded list out, so the client never sees the join shape.
  return {
    id: row.id,
    name: row.name,
    moves: row.moves,
    listName: row.algorithm_lists.name,
    isSystem: row.algorithm_lists.is_system,
  };
}

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
  user: ListUser,
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

  // 2. Duplicate detection, scoped by RLS. `alg_select` already resolves to
  // exactly FR-015's "pre-built OR in any of the caller's lists" — no
  // hand-rolled ownership filter, and none that widens it either.
  //
  // N matches is normal, not an edge case (the seeded PLL set has a T-perm and
  // the learner may hold the same sequence in two of their own lists), so the
  // order is pinned: pre-built first, then oldest first as a stable tiebreak.
  //
  // NOTE the exact order syntax. `.order("is_system", { referencedTable:
  // "algorithm_lists" })` — the form that looks right — is a SILENT NO-OP here:
  // it returns 200 with rows in unspecified order, because referencedTable
  // orders rows *within* a to-many embed rather than ordering parents by a
  // to-one embedded column. The composite-column form below is what PostgREST
  // actually honours (order=algorithm_lists(is_system).desc). Verified against a
  // live stack; if this is ever "tidied up", determinism is lost with no error.
  const { data: matches, error: matchError } = await supabase
    .from("algorithms")
    .select("id, name, moves, list_id, algorithm_lists!inner(name, is_system)")
    .eq("moves_normalized", validation.normalized)
    .order("algorithm_lists(is_system)", { ascending: false })
    .order("created_at", { ascending: true });

  if (matchError) {
    console.error("lists/addAlgorithm duplicate query failed", matchError);
    return { status: 500, body: { error: "Failed to add algorithm" } };
  }

  const rows = matches as MatchRow[];

  // 3a. Already in THIS list — no copy, no second row.
  const inThisList = rows.find((row) => row.list_id === listId);
  if (inThisList) {
    return { status: 409, body: { status: "already_in_list", match: toMatch(inThisList) } };
  }

  // 3b. Visible elsewhere — offer it rather than silently duplicating.
  //
  // The pre-built preference is re-applied here rather than relying only on the
  // query's ORDER BY. That is deliberate: it makes this choice testable without
  // a database, and it keeps the "canonical entry wins" rule from depending on
  // a query clause that fails silently when mistyped.
  if (rows.length > 0 && createAnyway !== true) {
    const preferred = rows.find((row) => row.algorithm_lists.is_system) ?? rows[0];
    return { status: 200, body: { status: "duplicate", match: toMatch(preferred) } };
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

  // 1-based, not 0-based: AlgorithmRow.astro renders `position` verbatim as the
  // learner-visible row number, and the seeded lists start at 1.
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

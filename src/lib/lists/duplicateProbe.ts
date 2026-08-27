// The FR-015 duplicate probe, shared by addAlgorithm.ts (add) and
// updateAlgorithm.ts (edit). One copy on purpose: the ordering clause below is
// silently breakable (see the NOTE), and the pre-built-wins rule must not drift
// between the two paths — an edit that collides has to behave exactly like an
// add that collides.

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

export interface DuplicateMatch {
  id: string;
  name: string;
  moves: string;
  listName: string;
  isSystem: boolean;
}

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

export interface DuplicateProbeInput {
  /** `validateMoves(...).normalized` — never the raw string. */
  normalizedMoves: string;
  /** The list the sequence is headed for; decides in_this_list vs elsewhere. */
  listId: string;
  /**
   * Row to leave out of the probe. Required on edit: the row being edited
   * matches its own `moves_normalized` and sits in the target list, so without
   * this a name-only edit would report itself as `already_in_list`.
   */
  excludeAlgorithmId?: string;
}

export type DuplicateProbeOutcome =
  /** No visible algorithm holds this sequence. Safe to write. */
  | { kind: "clear" }
  /** The target list already holds it — no copy, no second row. */
  | { kind: "in_this_list"; match: DuplicateMatch }
  /** Visible elsewhere. The caller decides whether to offer it or proceed. */
  | { kind: "elsewhere"; match: DuplicateMatch }
  /** Query failed. The caller logs it and maps to its own 500. */
  | { kind: "error"; error: PostgrestError };

/**
 * Look for an already-visible algorithm with the same normalized sequence.
 *
 * Scoped by RLS, not by a hand-rolled filter: `alg_select` already resolves to
 * exactly FR-015's "pre-built OR in any of the caller's lists" — no ownership
 * filter here, and none that widens it either.
 *
 * N matches is normal, not an edge case (the seeded PLL set has a T-perm and
 * the learner may hold the same sequence in two of their own lists), so the
 * order is pinned: pre-built first, then oldest first as a stable tiebreak.
 */
export async function probeDuplicates(
  supabase: SupabaseClient<Database>,
  input: DuplicateProbeInput,
): Promise<DuplicateProbeOutcome> {
  const { normalizedMoves, listId, excludeAlgorithmId } = input;

  let filtered = supabase
    .from("algorithms")
    .select("id, name, moves, list_id, algorithm_lists!inner(name, is_system)")
    .eq("moves_normalized", normalizedMoves);

  if (excludeAlgorithmId !== undefined) {
    filtered = filtered.neq("id", excludeAlgorithmId);
  }

  // NOTE the exact order syntax. `.order("is_system", { referencedTable:
  // "algorithm_lists" })` — the form that looks right — is a SILENT NO-OP here:
  // it returns 200 with rows in unspecified order, because referencedTable
  // orders rows *within* a to-many embed rather than ordering parents by a
  // to-one embedded column. The composite-column form below is what PostgREST
  // actually honours (order=algorithm_lists(is_system).desc). Verified against a
  // live stack; if this is ever "tidied up", determinism is lost with no error.
  const { data: matches, error } = await filtered
    .order("algorithm_lists(is_system)", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    return { kind: "error", error };
  }

  const rows = matches as MatchRow[];

  const inThisList = rows.find((row) => row.list_id === listId);
  if (inThisList) {
    return { kind: "in_this_list", match: toMatch(inThisList) };
  }

  if (rows.length > 0) {
    // The pre-built preference is re-applied here rather than relying only on
    // the query's ORDER BY. That is deliberate: it makes this choice testable
    // without a database, and it keeps the "canonical entry wins" rule from
    // depending on a query clause that fails silently when mistyped.
    const preferred = rows.find((row) => row.algorithm_lists.is_system) ?? rows[0];
    return { kind: "elsewhere", match: toMatch(preferred) };
  }

  return { kind: "clear" };
}

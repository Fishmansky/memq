// Node-importable core of PATCH /api/lists/:listId. The route in
// src/pages/api/lists/[listId]/index.ts is a thin wrapper. Same split as
// createList.ts, whose validation rules this deliberately reuses: a name
// rejected at creation is rejected on rename, with the same message.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { LIST_NAME_MAX_LENGTH } from "@/lib/lists/createList";

export interface RenameListInput {
  listId: string;
  name: string;
}

export type RenameListResult =
  | { status: 200; body: { id: string; name: string } }
  | { status: 400; body: { error: string } }
  | { status: 404; body: { error: "List not found" } }
  | { status: 500; body: { error: "Failed to rename list" } };

/**
 * Rename one user-owned algorithm list.
 *
 * Authorization is the `al_update` policy (`user_id = auth.uid() AND
 * is_system = false`), so another user's list and every pre-built set are
 * unreachable. Zero rows affected → 404, the same see-it-or-not collapse as
 * deleteList.ts.
 *
 * No name-uniqueness check: creation does not impose one and the schema has no
 * unique constraint, so rename must not invent a rule the rest of the product
 * does not have.
 */
export async function renameList(
  supabase: SupabaseClient<Database>,
  input: RenameListInput,
): Promise<RenameListResult> {
  const name = input.name.trim();

  if (name === "") {
    return { status: 400, body: { error: "Enter a list name." } };
  }
  if (name.length > LIST_NAME_MAX_LENGTH) {
    return {
      status: 400,
      body: { error: `List name must be ${String(LIST_NAME_MAX_LENGTH)} characters or fewer.` },
    };
  }

  const { data, error } = await supabase
    .from("algorithm_lists")
    .update({ name })
    .eq("id", input.listId)
    .select("id, name");

  if (error) {
    console.error("lists/renameList update failed", error);
    return { status: 500, body: { error: "Failed to rename list" } };
  }

  if (data.length === 0) {
    return { status: 404, body: { error: "List not found" } };
  }

  return { status: 200, body: { id: data[0].id, name: data[0].name } };
}

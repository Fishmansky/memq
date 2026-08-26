// Node-importable core of POST /api/lists, decoupled from HTTP and astro:env so
// it can be exercised directly in tests. The route in
// src/pages/api/lists/index.ts is a thin wrapper that builds the client,
// validates the body shape, then maps this function's result onto a Response.
// Same split as completePractice.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

export interface ListUser {
  id: string;
}

export interface CreateListInput {
  name: string;
}

export const LIST_NAME_MAX_LENGTH = 100;

export type CreateListResult =
  | { status: 201; body: { id: string; name: string } }
  | { status: 400; body: { error: string } }
  | { status: 500; body: { error: "Failed to create list" } };

/**
 * Create a private, user-owned algorithm list.
 *
 * Authorization is the `al_insert` policy, not a hand-rolled check: it requires
 * `is_system = false AND user_id = auth.uid()`, so a caller cannot create a
 * list for someone else even though `user_id` is written here. The
 * `algorithm_lists_ownership_check` constraint additionally requires those two
 * fields to agree, which is why both are always set together.
 */
export async function createList(
  supabase: SupabaseClient<Database>,
  user: ListUser,
  input: CreateListInput,
): Promise<CreateListResult> {
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
    .insert({ name, user_id: user.id, is_system: false })
    .select("id, name")
    .single();

  if (error) {
    // Log the raw error server-side; never echo it to the client — a DB error
    // string can leak schema and policy details.
    console.error("lists/create insert failed", error);
    return { status: 500, body: { error: "Failed to create list" } };
  }

  return { status: 201, body: { id: data.id, name: data.name } };
}

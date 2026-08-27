// Shared UUID shape check for API routes.
//
// Route params are shape-checked, NOT authorized: a non-UUID reaches PostgREST
// as `.eq("id", "foo")`, Postgres raises 22P02, and a lib module's catch-all
// maps that to a 500 for what is plainly a bad request. Authorization always
// stays with RLS.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

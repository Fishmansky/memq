import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { isUuid } from "@/lib/uuid";
import { deleteAlgorithm } from "@/lib/lists/deleteAlgorithm";

// Algorithm-level mutations at /api/algorithms/:algoId — flat, without the
// owning list in the path. The create route already documents that a `listId`
// path segment carries no authority (src/pages/api/lists/[listId]/algorithms.ts):
// `alg_delete` decides, so a segment that is never read for authorization is
// not in the URL.
//
// The `context.locals.user` gate is required: src/middleware.ts does not cover
// /api/*.

export const DELETE: APIRoute = async (context) => {
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Shape-checked, not authorized — see src/lib/uuid.ts.
  const algoId = context.params.algoId;
  if (!isUuid(algoId)) {
    return new Response(JSON.stringify({ error: "Invalid algoId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: "Supabase not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await deleteAlgorithm(supabase, { algorithmId: algoId });

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
};

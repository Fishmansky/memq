import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { isUuid } from "@/lib/uuid";
import { deleteAlgorithm } from "@/lib/lists/deleteAlgorithm";
import { updateAlgorithm } from "@/lib/lists/updateAlgorithm";

// Algorithm-level mutations at /api/algorithms/:algoId — flat, without the
// owning list in the path. The create route already documents that a `listId`
// path segment carries no authority (src/pages/api/lists/[listId]/algorithms.ts):
// `alg_delete` / `alg_update` decide, so a segment that is never read for
// authorization is not in the URL.
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

export const PATCH: APIRoute = async (context) => {
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const algoId = context.params.algoId;
  if (!isUuid(algoId)) {
    return new Response(JSON.stringify({ error: "Invalid algoId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (typeof body !== "object" || body === null) {
    return new Response(JSON.stringify({ error: "Invalid body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const fields = body as Record<string, unknown>;

  // Mirrors the add route's check, including the explicit rejection of a
  // non-boolean createAnyway — a truthy string must not silently mean "yes".
  if (typeof fields.name !== "string" || typeof fields.moves !== "string") {
    return new Response(JSON.stringify({ error: "Invalid body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const createAnyway = fields.createAnyway;
  if (createAnyway !== undefined && typeof createAnyway !== "boolean") {
    return new Response(JSON.stringify({ error: "Invalid body" }), {
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

  const result = await updateAlgorithm(supabase, {
    algorithmId: algoId,
    name: fields.name,
    moves: fields.moves,
    createAnyway,
  });

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
};

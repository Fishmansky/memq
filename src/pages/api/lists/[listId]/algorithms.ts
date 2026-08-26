import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { addAlgorithm } from "@/lib/lists/addAlgorithm";
import { addExistingAlgorithm } from "@/lib/lists/addExistingAlgorithm";

// POST /api/lists/:listId/algorithms — one endpoint serving both add paths,
// discriminated by body shape:
//   { sourceAlgorithmId }              -> copy an already-visible algorithm
//   { name, moves, createAnyway? }     -> create from a typed sequence
//
// `listId` is never trusted for authorization — the alg_insert RLS policy
// decides whether the caller owns the target list, and a rejection maps to 403.
// The locals.user gate is required: src/middleware.ts does not cover /api/*.

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const listId = context.params.listId;
  if (!listId) {
    return new Response(JSON.stringify({ error: "Missing listId" }), {
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

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: "Supabase not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (typeof fields.sourceAlgorithmId === "string") {
    const result = await addExistingAlgorithm(supabase, user, {
      listId,
      sourceAlgorithmId: fields.sourceAlgorithmId,
    });
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (typeof fields.name === "string" && typeof fields.moves === "string") {
    const createAnyway = fields.createAnyway;
    if (createAnyway !== undefined && typeof createAnyway !== "boolean") {
      return new Response(JSON.stringify({ error: "Invalid body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const result = await addAlgorithm(supabase, user, {
      listId,
      name: fields.name,
      moves: fields.moves,
      createAnyway,
    });
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "Invalid body" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
};

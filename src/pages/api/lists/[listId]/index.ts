import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { isUuid } from "@/lib/uuid";
import { deleteList } from "@/lib/lists/deleteList";
import { renameList } from "@/lib/lists/renameList";

// List-level mutations at /api/lists/:listId.
//
// The `context.locals.user` gate is required, not defensive: src/middleware.ts
// prefix-matches PROTECTED_ROUTES = ["/dashboard", "/sets"], so /api/* is NOT
// covered and every API route gates itself. Authorization beyond that gate is
// RLS's (al_delete / al_update), never a hand-rolled ownership check here.

export const DELETE: APIRoute = async (context) => {
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Shape-checked, not authorized — see src/lib/uuid.ts.
  const listId = context.params.listId;
  if (!isUuid(listId)) {
    return new Response(JSON.stringify({ error: "Invalid listId" }), {
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

  const result = await deleteList(supabase, { listId });

  if (result.status === 204) {
    return new Response(null, { status: 204 });
  }

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

  const listId = context.params.listId;
  if (!isUuid(listId)) {
    return new Response(JSON.stringify({ error: "Invalid listId" }), {
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

  // The same shape check POST /api/lists performs.
  if (typeof body !== "object" || body === null || typeof (body as Record<string, unknown>).name !== "string") {
    return new Response(JSON.stringify({ error: "Invalid body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { name } = body as { name: string };

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: "Supabase not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await renameList(supabase, { listId, name });

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
};

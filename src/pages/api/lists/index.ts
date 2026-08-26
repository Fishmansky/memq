import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createList } from "@/lib/lists/createList";

// POST /api/lists — create a private, user-owned algorithm list.
//
// The `context.locals.user` gate is required, not defensive: src/middleware.ts
// prefix-matches PROTECTED_ROUTES = ["/dashboard", "/sets"], so /api/* is NOT
// covered and every API route gates itself.

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
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

  const result = await createList(supabase, user, { name });

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
};

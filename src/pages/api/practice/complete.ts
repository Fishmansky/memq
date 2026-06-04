import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { completePractice } from "@/lib/practice/completePractice";

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

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).algorithmId !== "string" ||
    typeof (body as Record<string, unknown>).isClean !== "boolean" ||
    typeof (body as Record<string, unknown>).errorCount !== "number"
  ) {
    return new Response(JSON.stringify({ error: "Invalid body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { algorithmId, isClean, errorCount } = body as {
    algorithmId: string;
    isClean: boolean;
    errorCount: number;
  };

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: "Supabase not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await completePractice(supabase, user, { algorithmId, isClean, errorCount });

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
};

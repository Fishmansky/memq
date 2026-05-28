import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

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

  const [sessionResult, masteryResult] = await Promise.all([
    supabase.from("practice_sessions").insert({
      user_id: user.id,
      algorithm_id: algorithmId,
      is_clean: isClean,
      error_count: errorCount,
    }),
    supabase
      .from("algorithm_mastery")
      .select("consecutive_clean, mastery_reached")
      .eq("user_id", user.id)
      .eq("algorithm_id", algorithmId)
      .maybeSingle(),
  ]);

  if (sessionResult.error) {
    return new Response(JSON.stringify({ error: sessionResult.error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (masteryResult.error) {
    return new Response(JSON.stringify({ error: masteryResult.error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const currentClean = masteryResult.data?.consecutive_clean ?? 0;
  const alreadyMastered = masteryResult.data?.mastery_reached ?? false;
  const newConsecutiveClean = isClean ? currentClean + 1 : 0;
  const newMasteryReached = alreadyMastered || newConsecutiveClean >= 3;

  const { error: upsertError } = await supabase.from("algorithm_mastery").upsert(
    {
      user_id: user.id,
      algorithm_id: algorithmId,
      consecutive_clean: newConsecutiveClean,
      mastery_reached: newMasteryReached,
    },
    { onConflict: "user_id,algorithm_id" },
  );

  if (upsertError) {
    return new Response(JSON.stringify({ error: upsertError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      consecutiveClean: newConsecutiveClean,
      masteryReached: newMasteryReached,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
};

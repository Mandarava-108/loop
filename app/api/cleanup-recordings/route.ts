import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Deletes screen-recording chunks belonging to sessions older than 30 days
// (see the participant consent text). Triggered daily by Vercel Cron
// (vercel.json); Vercel sends "Authorization: Bearer <CRON_SECRET>"
// automatically when that env var is set. Running it early or repeatedly is
// harmless — it only removes recordings past the 30-day mark, and task
// answers are never touched.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is not configured" },
      { status: 500 }
    );
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { persistSession: false } }
  );

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Sessions past retention that still have chunks registered.
  const { data: expired, error } = await admin
    .from("sessions")
    .select("id, recording_chunks(id, path)")
    .not("recording_type", "is", null)
    .lt("created_at", cutoff);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const chunks = (expired ?? []).flatMap(
    (s) => (s.recording_chunks ?? []) as { id: string; path: string }[]
  );
  if (chunks.length === 0) {
    return NextResponse.json({ deletedChunks: 0 });
  }

  const paths = chunks.map((c) => c.path);
  for (let i = 0; i < paths.length; i += 100) {
    const { error: rmError } = await admin.storage
      .from("recordings")
      .remove(paths.slice(i, i + 100));
    if (rmError) {
      return NextResponse.json({ error: rmError.message }, { status: 500 });
    }
  }

  const { error: delError } = await admin
    .from("recording_chunks")
    .delete()
    .in(
      "id",
      chunks.map((c) => c.id)
    );
  if (delError) {
    return NextResponse.json({ error: delError.message }, { status: 500 });
  }

  return NextResponse.json({ deletedChunks: paths.length });
}

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Receives rrweb event batches from the recording snippet running inside the
// tested site (cross-origin). Validation + chunk registration happen in the
// register_rrweb_chunk RPC (security definer): only consented, active rrweb
// sessions are accepted, with a per-session chunk cap.
//
// The snippet posts text/plain to keep requests preflight-free; the body is
// JSON: { sessionId: string, events: unknown[] }.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

const MAX_BODY_BYTES = 3_000_000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(status: number, body: object) {
  return NextResponse.json(body, { status, headers: CORS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request: NextRequest) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return reply(413, { error: "batch too large" });
  }

  let sessionId: string;
  let events: unknown[];
  try {
    const parsed = JSON.parse(text);
    sessionId = parsed.sessionId;
    events = parsed.events;
  } catch {
    return reply(400, { error: "invalid body" });
  }
  if (
    typeof sessionId !== "string" ||
    !UUID_RE.test(sessionId) ||
    !Array.isArray(events) ||
    events.length === 0
  ) {
    return reply(400, { error: "invalid body" });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );

  const payload = JSON.stringify(events);
  const { data: path, error: rpcError } = await supabase.rpc(
    "register_rrweb_chunk",
    { p_session: sessionId, p_size: payload.length }
  );
  if (rpcError) {
    return reply(500, { error: rpcError.message });
  }
  if (!path) {
    return reply(403, { error: "session not eligible" });
  }

  const { error: uploadError } = await supabase.storage
    .from("recordings")
    .upload(path, new Blob([payload], { type: "application/json" }), {
      contentType: "application/json",
      upsert: false,
    });
  if (uploadError) {
    return reply(500, { error: uploadError.message });
  }

  return reply(200, { ok: true, path });
}

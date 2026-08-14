import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ChunkPlayer from "./chunk-player";

export default async function WatchRecordingPage({
  params,
}: PageProps<"/dashboard/[testId]/responses/[sessionId]">) {
  const { testId, sessionId } = await params;
  const supabase = await createClient();

  // RLS: only the owner can read the session and its chunks.
  const { data: session } = await supabase
    .from("sessions")
    .select("id, test_id, recording_mime, created_at, tests(title)")
    .eq("id", sessionId)
    .eq("test_id", testId)
    .single<{
      id: string;
      test_id: string;
      recording_mime: string | null;
      created_at: string;
      tests: { title: string } | null;
    }>();
  if (!session) notFound();

  const { data: chunks } = await supabase
    .from("recording_chunks")
    .select("seq, path, size_bytes")
    .eq("session_id", sessionId)
    .order("seq");
  if (!chunks || chunks.length === 0) notFound();

  // Signed URLs, owner-only via storage RLS. 2h leaves room for long reviews.
  const signed = await Promise.all(
    chunks.map(async (c) => {
      const { data } = await supabase.storage
        .from("recordings")
        .createSignedUrl(c.path, 2 * 60 * 60);
      return data?.signedUrl ?? null;
    })
  );
  // The stream is only decodable as an unbroken prefix — stop at the first
  // chunk we can't sign (missing object) rather than skipping over it.
  const urls: string[] = [];
  for (const u of signed) {
    if (!u) break;
    urls.push(u);
  }
  if (urls.length === 0) notFound();

  const totalBytes = chunks
    .slice(0, urls.length)
    .reduce((sum, c) => sum + (c.size_bytes ?? 0), 0);

  return (
    <main className="flex-1 bg-[#14161B] text-[#EDEFF3]">
      <div className="mx-auto max-w-4xl px-5 py-10">
        <header className="mb-8 flex items-center gap-3 text-sm text-[#9AA1AD]">
          <Link
            href={`/dashboard/${testId}/responses`}
            className="hover:text-[#EDEFF3]"
          >
            ← Back to responses
          </Link>
        </header>

        <h1 className="text-xl font-semibold">
          {session.tests?.title ?? "Recording"}
        </h1>
        <p className="mt-1 mb-6 text-sm text-[#9AA1AD]">
          Session <span className="font-mono text-xs">{sessionId.slice(0, 8)}</span>{" "}
          · {new Date(session.created_at).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}{" "}
          · {urls.length} segment{urls.length === 1 ? "" : "s"}
          {totalBytes > 0 &&
            ` · ${(totalBytes / (1024 * 1024)).toFixed(1)} MB`}
          {urls.length < chunks.length && " · ends early (missing segment)"}
        </p>

        <ChunkPlayer
          urls={urls}
          mime={session.recording_mime ?? "video/webm"}
        />
      </div>
    </main>
  );
}

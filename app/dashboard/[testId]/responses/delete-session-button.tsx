"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Deletes one participant session: recording files, chunk records, screener
// answers, task responses, and the session row itself. Owner-only via RLS.
export default function DeleteSessionButton({
  sessionId,
}: {
  sessionId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function del() {
    if (
      !window.confirm(
        "Delete this participant session — all its answers, screener data, and recording? This cannot be undone."
      )
    ) {
      return;
    }
    setBusy(true);
    setFailed(false);
    const supabase = createClient();

    // Remove recording files first (they don't cascade with the rows).
    const { data: chunks } = await supabase
      .from("recording_chunks")
      .select("path")
      .eq("session_id", sessionId);
    const paths = (chunks ?? []).map((c) => c.path);
    if (paths.length > 0) {
      await supabase.storage.from("recordings").remove(paths);
    }

    const { error: respError } = await supabase
      .from("responses")
      .delete()
      .eq("session_id", sessionId);
    // Session row cascades recording_chunks + screener_answers.
    const { error: sessError } = await supabase
      .from("sessions")
      .delete()
      .eq("id", sessionId);

    setBusy(false);
    if (respError || sessError) {
      setFailed(true);
      return;
    }
    router.refresh();
  }

  return (
    <button
      onClick={del}
      disabled={busy}
      title="Delete this session and all its data"
      className={`mt-1.5 rounded-[7px] border px-1.5 py-1 text-xs transition ${
        failed
          ? "border-[#F0605A] text-[#F0605A]"
          : "border-[#2B2F38] text-[#565D6B] hover:border-[#F0605A] hover:text-[#F0605A]"
      }`}
    >
      {busy ? "Deleting…" : failed ? "Failed — retry" : "Delete"}
    </button>
  );
}

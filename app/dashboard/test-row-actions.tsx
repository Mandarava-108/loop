"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const btnCls =
  "rounded-[9px] border border-[#2B2F38] px-3 py-2 text-sm text-[#9AA1AD] transition hover:border-[#7C6FF0] hover:text-[#EDEFF3] disabled:opacity-40";

export default function TestRowActions({
  testId,
  title,
}: {
  testId: string;
  title: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"duplicate" | "delete" | null>(null);
  const [error, setError] = useState(false);

  async function duplicate() {
    setBusy("duplicate");
    setError(false);
    const supabase = createClient();
    try {
      const { data: t, error: e1 } = await supabase
        .from("tests")
        .select("title, site_url, config")
        .eq("id", testId)
        .single();
      if (e1 || !t) throw e1;
      const { data: created, error: e2 } = await supabase
        .from("tests")
        .insert({
          title: `${t.title} (copy)`,
          site_url: t.site_url,
          config: t.config,
        })
        .select("id")
        .single();
      if (e2 || !created) throw e2;
      const { data: tasks, error: e3 } = await supabase
        .from("tasks")
        .select("sort_order, type, prompt, description, options")
        .eq("test_id", testId)
        .order("sort_order");
      if (e3) throw e3;
      if (tasks && tasks.length > 0) {
        const { error: e4 } = await supabase
          .from("tasks")
          .insert(tasks.map((x) => ({ ...x, test_id: created.id })));
        if (e4) throw e4;
      }
      router.refresh();
    } catch {
      setError(true);
    }
    setBusy(null);
  }

  async function remove() {
    if (
      !window.confirm(
        `Delete "${title}"?\n\nThis permanently removes the test, its share link, and ALL collected data — every participant session, answer, and recording. This cannot be undone.`
      )
    ) {
      return;
    }
    setBusy("delete");
    setError(false);
    const supabase = createClient();
    try {
      // Recording files don't cascade — remove them first.
      const { data: sessions } = await supabase
        .from("sessions")
        .select("id")
        .eq("test_id", testId);
      const ids = (sessions ?? []).map((s) => s.id);
      if (ids.length > 0) {
        const { data: chunks } = await supabase
          .from("recording_chunks")
          .select("path")
          .in("session_id", ids);
        const paths = (chunks ?? []).map((c) => c.path);
        for (let i = 0; i < paths.length; i += 100) {
          await supabase.storage
            .from("recordings")
            .remove(paths.slice(i, i + 100));
        }
      }
      // Cascades: tasks, responses, sessions -> chunks + screener answers.
      const { error: e } = await supabase
        .from("tests")
        .delete()
        .eq("id", testId);
      if (e) throw e;
      router.refresh();
    } catch {
      setError(true);
    }
    setBusy(null);
  }

  return (
    <>
      <button
        onClick={duplicate}
        disabled={busy !== null}
        title="Create a copy of this test (setup only, no collected data)"
        className={btnCls}
      >
        {busy === "duplicate" ? "Duplicating…" : "Duplicate"}
      </button>
      <button
        onClick={remove}
        disabled={busy !== null}
        title="Delete this test and all its data"
        className={`${btnCls} hover:border-[#F0605A] hover:text-[#F0605A]`}
      >
        {busy === "delete" ? "Deleting…" : "Delete"}
      </button>
      {error && (
        <span className="text-xs text-[#F0605A]">failed — try again</span>
      )}
    </>
  );
}

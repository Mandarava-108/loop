"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Researcher-only verification of a self-reported task result, filled in
// after reviewing the session recording. Writes responses.verified.
export default function VerifiedSelect({
  responseId,
  initial,
}: {
  responseId: string;
  initial: "success" | "fail" | null;
}) {
  const [value, setValue] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function change(next: string) {
    const prev = value;
    setValue(next);
    setBusy(true);
    setFailed(false);
    const supabase = createClient();
    const { error } = await supabase
      .from("responses")
      .update({ verified: next === "" ? null : next })
      .eq("id", responseId);
    setBusy(false);
    if (error) {
      setValue(prev);
      setFailed(true);
    }
  }

  return (
    <div className="mt-1.5">
      <select
        value={value}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        className={`rounded-[7px] border bg-[#14161B] px-1.5 py-1 text-xs outline-none focus:outline-1 focus:outline-[#7C6FF0] ${
          value === "success"
            ? "border-[#4ECF9A] text-[#4ECF9A]"
            : value === "fail"
              ? "border-[#F0605A] text-[#F0605A]"
              : "border-[#2B2F38] text-[#9AA1AD]"
        }`}
        title="Verified result (after reviewing the recording)"
      >
        <option value="">unverified</option>
        <option value="success">verified: success</option>
        <option value="fail">verified: fail</option>
      </select>
      {failed && (
        <span className="ml-1.5 text-xs text-[#F0605A]">save failed</span>
      )}
    </div>
  );
}

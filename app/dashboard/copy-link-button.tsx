"use client";

import { useState } from "react";

export default function CopyLinkButton({ testId }: { testId: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}/t/${testId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard API unavailable (e.g. non-secure context) — show the URL.
      window.prompt("Copy the share link:", url);
    }
  }

  return (
    <button
      onClick={copy}
      className="rounded-[9px] border border-[#2B2F38] px-3 py-2 text-sm text-[#9AA1AD] transition hover:border-[#7C6FF0] hover:text-[#EDEFF3]"
    >
      {copied ? "Copied ✓" : "Copy link"}
    </button>
  );
}

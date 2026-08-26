"use client";

import { useState } from "react";

// Expandable comment bubble for a response cell — shows the participant's
// typed texts (follow-up, extra answers, confirmations) inline.
export default function CommentToggle({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        title={open ? "Hide comments" : "Show comments"}
        className={`ml-1 rounded px-0.5 text-xs transition hover:brightness-125 ${
          open ? "opacity-100" : "opacity-80"
        }`}
      >
        💬
      </button>
      {open && (
        <div className="mt-1.5 min-w-[220px] max-w-[300px] whitespace-normal rounded-md border border-[#2B2F38] bg-[#14161B] p-2.5 text-xs leading-relaxed text-[#EDEFF3]">
          {items.map((t, i) => (
            <p key={i} className={i > 0 ? "mt-2" : ""}>
              {t}
            </p>
          ))}
        </div>
      )}
    </>
  );
}

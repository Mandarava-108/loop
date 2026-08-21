"use client";

import { useEffect, useState } from "react";

// Formats a timestamp in the viewer's own timezone. Server components render
// in the deployment's timezone (UTC on Vercel), so any user-facing date must
// go through a client component like this one.
export default function LocalTime({
  iso,
  dateOnly = false,
}: {
  iso: string;
  dateOnly?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    setText(
      new Date(iso).toLocaleString(
        undefined,
        dateOnly
          ? { dateStyle: "medium" }
          : { dateStyle: "medium", timeStyle: "short" }
      )
    );
  }, [iso, dateOnly]);

  // Until hydration, render nothing rather than a UTC time that then jumps.
  return <span>{text ?? "…"}</span>;
}

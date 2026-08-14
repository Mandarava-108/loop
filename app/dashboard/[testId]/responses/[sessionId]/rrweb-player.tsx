"use client";

import { useEffect, useRef, useState } from "react";
import type { eventWithTime } from "@rrweb/types";
import "rrweb-player/dist/style.css";

// Plays a chunked rrweb recording: each chunk is a JSON array of rrweb
// events; concatenated in seq order they form one continuous replay.
export default function RrwebPlayer({ urls }: { urls: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    // rrweb-player doesn't expose a destroy API on its Svelte component in
    // all versions — clearing the container on cleanup is the reliable path.
    (async () => {
      try {
        const batches = await Promise.all(
          urls.map(async (u) => {
            const res = await fetch(u);
            if (!res.ok) throw new Error(`chunk fetch failed (${res.status})`);
            return (await res.json()) as eventWithTime[];
          })
        );
        const events = batches.flat();
        if (cancelled || events.length < 2) {
          if (events.length < 2) setError(true);
          setLoading(false);
          return;
        }
        const { default: Player } = await import("rrweb-player");
        if (cancelled) return;
        const width = Math.min(container.clientWidth, 1024);
        new Player({
          target: container,
          props: {
            events,
            width,
            height: Math.round((width * 9) / 16),
            autoPlay: false,
            showController: true,
          },
        });
        setLoading(false);
      } catch {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      container.innerHTML = "";
    };
  }, [urls]);

  return (
    <div>
      <div
        ref={containerRef}
        className="overflow-hidden rounded-xl border border-[#2B2F38] bg-[#1D2027] [&_.rr-player]:!bg-transparent"
      />
      {loading && !error && (
        <p className="mt-3 text-sm text-[#9AA1AD]">Loading replay…</p>
      )}
      {error && (
        <p className="mt-3 text-sm text-[#F0605A]">
          Couldn&apos;t load this replay — a segment may be missing. Reload the
          page to try again.
        </p>
      )}
    </div>
  );
}

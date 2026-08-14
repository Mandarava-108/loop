"use client";

import { useEffect, useRef, useState } from "react";

// Plays a chunked recording seamlessly: the chunks are byte-ranges of one
// continuous WebM stream, so appending them in order to a single MediaSource
// SourceBuffer reconstructs the exact original video.
export default function ChunkPlayer({
  urls,
  mime,
}: {
  urls: string[];
  mime: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Single chunk: it starts with the stream header, so it plays directly.
    if (urls.length === 1) {
      video.src = urls[0];
      setLoading(false);
      return;
    }

    if (typeof MediaSource === "undefined" || !MediaSource.isTypeSupported(mime)) {
      setError("unsupported");
      setLoading(false);
      return;
    }

    let cancelled = false;
    const mediaSource = new MediaSource();
    const objectUrl = URL.createObjectURL(mediaSource);
    video.src = objectUrl;

    const waitUpdate = (sb: SourceBuffer) =>
      new Promise<void>((resolve) => {
        if (!sb.updating) return resolve();
        sb.addEventListener("updateend", () => resolve(), { once: true });
      });

    mediaSource.addEventListener(
      "sourceopen",
      async () => {
        try {
          const sb = mediaSource.addSourceBuffer(mime);
          for (const url of urls) {
            if (cancelled) return;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`segment fetch failed (${res.status})`);
            const buf = await res.arrayBuffer();
            try {
              sb.appendBuffer(buf);
            } catch (e) {
              // Buffer quota exceeded — evict already-watched video and retry.
              if ((e as DOMException).name === "QuotaExceededError") {
                const evictEnd = Math.max(0, video.currentTime - 10);
                if (evictEnd > 0) {
                  sb.remove(0, evictEnd);
                  await waitUpdate(sb);
                  sb.appendBuffer(buf);
                } else {
                  throw e;
                }
              } else {
                throw e;
              }
            }
            await waitUpdate(sb);
            setLoading(false);
          }
          if (!cancelled && mediaSource.readyState === "open") {
            mediaSource.endOfStream();
          }
        } catch {
          if (!cancelled) {
            setError("failed");
            setLoading(false);
          }
        }
      },
      { once: true }
    );

    return () => {
      cancelled = true;
      URL.revokeObjectURL(objectUrl);
    };
  }, [urls, mime]);

  if (error === "unsupported") {
    return (
      <div className="rounded-xl border border-[#2B2F38] bg-[#1D2027] p-6 text-sm text-[#9AA1AD]">
        <p className="mb-3">
          This browser can&apos;t play chunked WebM recordings (try Chrome,
          Edge, or Firefox). You can download the segments instead:
        </p>
        <ol className="list-decimal pl-5">
          {urls.map((u, i) => (
            <li key={i}>
              <a
                href={u}
                download={`segment-${i + 1}.webm`}
                className="text-[#7C6FF0] hover:underline"
              >
                Segment {i + 1}
              </a>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div>
      <video
        ref={videoRef}
        controls
        playsInline
        className="w-full rounded-xl border border-[#2B2F38] bg-black"
      />
      {loading && !error && (
        <p className="mt-3 text-sm text-[#9AA1AD]">Loading recording…</p>
      )}
      {error === "failed" && (
        <p className="mt-3 text-sm text-[#F0605A]">
          Playback failed while loading a segment — reload the page to try
          again.
        </p>
      )}
    </div>
  );
}

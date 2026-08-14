"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import "./runner.css";

export type RunnerTest = { id: string; title: string; site_url: string };
export type RunnerTask = {
  id: string;
  sort_order: number;
  type: "instruction" | "rating" | "open_text";
  prompt: string;
  description: string | null;
};

type ConsentStatus = "granted" | "declined" | "permission_denied" | "unsupported";
type Phase = "consent" | "test" | "done";
type UploadState = "idle" | "uploading" | "saved" | "partial" | "failed";

// ~5-minute segments: at RECORDING_BITRATE this is ~22 MB per chunk,
// well under the bucket's 50 MB object limit.
const CHUNK_MS = 5 * 60 * 1000;
// Usability content is mostly static pages — modest bitrate stays readable.
const RECORDING_BITRATE = 600_000;

// Chrome-specific getDisplayMedia hints; other browsers ignore them.
type DisplayMediaOptions = MediaStreamConstraints & {
  preferCurrentTab?: boolean;
  selfBrowserSurface?: "include" | "exclude";
  surfaceSwitching?: "include" | "exclude";
};

export default function Runner({
  test,
  tasks,
}: {
  test: RunnerTest;
  tasks: RunnerTask[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [phase, setPhase] = useState<Phase>("consent");
  const [current, setCurrent] = useState(0);
  const [expanded, setExpanded] = useState(true); // sheet starts open for consent
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [rating, setRating] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [starting, setStarting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [method, setMethod] = useState<"screen" | "rrweb" | null>(null);
  const [iframeSrc, setIframeSrc] = useState(test.site_url);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const snippetPresentRef = useRef(false);

  const startedAtRef = useRef("");
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingActiveRef = useRef(false);
  // Blobs delivered by MediaRecorder that haven't been uploaded yet. They are
  // byte-ranges of ONE continuous WebM stream: consecutive pending blobs can
  // be merged into a single upload without corrupting the stream.
  const pendingRef = useRef<Blob[]>([]);
  const seqRef = useRef(0);
  const flushingRef = useRef(false);
  const stoppedRef = useRef<(() => void) | null>(null);

  const done = phase === "done";
  const task = tasks[current];
  const pct = done ? 100 : phase === "consent" ? 0 : Math.round((current / tasks.length) * 100);
  const isLast = current === tasks.length - 1;

  const domain = useMemo(() => {
    try {
      return new URL(test.site_url).hostname;
    } catch {
      return test.site_url;
    }
  }, [test.site_url]);

  // A new task (or phase) needs the full panel — auto-expand the desktop rail.
  useEffect(() => {
    setDesktopCollapsed(false);
  }, [current, phase]);

  // Messages from the recording snippet inside the tested site's iframe.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const d = e.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "loop:rrweb:hello") snippetPresentRef.current = true;
      if (d.type === "loop:rrweb:started" && d.sessionId === sessionId) {
        setRecording(true);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sessionId]);

  function messageIframe(msg: object) {
    iframeRef.current?.contentWindow?.postMessage(msg, "*");
  }

  // Wait briefly for the snippet to announce itself (the site may still be
  // loading when the participant consents).
  async function waitForSnippet(ms: number): Promise<boolean> {
    if (snippetPresentRef.current) return true;
    messageIframe({ type: "loop:probe" });
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 150));
      if (snippetPresentRef.current) return true;
    }
    return false;
  }

  function withSessionParam(url: string): string {
    try {
      const u = new URL(url);
      u.searchParams.set("loop_session", sessionId);
      return u.toString();
    } catch {
      return url;
    }
  }

  // Never leave the capture stream running if the participant navigates away.
  useEffect(() => {
    return () => {
      recorderRef.current?.state === "recording" && recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Upload every pending blob, merging consecutive pending blobs into one
  // chunk. If an upload fails the bytes stay queued and merge into the next
  // attempt — the stored stream never has a gap, at worst it ends early.
  async function flushUploads(): Promise<void> {
    if (flushingRef.current) return;
    flushingRef.current = true;
    try {
      while (pendingRef.current.length > 0) {
        const blobs = pendingRef.current;
        pendingRef.current = [];
        const blob = new Blob(blobs, { type: "video/webm" });
        const seq = seqRef.current;
        const path = `${test.id}/${sessionId}/${String(seq).padStart(4, "0")}.webm`;

        const { error } = await supabase.storage
          .from("recordings")
          .upload(path, blob, { contentType: "video/webm", upsert: false });
        if (error) {
          // Put the bytes back at the front of the queue for the next flush.
          pendingRef.current = [blob, ...pendingRef.current];
          return;
        }
        seqRef.current = seq + 1;

        // Register the chunk so the dashboard player can find it.
        const row = {
          session_id: sessionId,
          seq,
          path,
          size_bytes: blob.size,
        };
        let { error: rowError } = await supabase
          .from("recording_chunks")
          .insert(row);
        if (rowError) {
          await new Promise((r) => setTimeout(r, 1500));
          ({ error: rowError } = await supabase
            .from("recording_chunks")
            .insert(row));
        }
      }
    } finally {
      flushingRef.current = false;
      stoppedRef.current?.();
    }
  }

  function stopCapture() {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop(); // fires a final dataavailable, then onstop -> finishUploads
    } else {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    }
    setRecording(false);
  }

  async function finishUploads() {
    setRecording(false);
    recordingActiveRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (seqRef.current === 0 && pendingRef.current.length === 0) return;

    setUploadState("uploading");
    // Wait for any in-flight flush, then retry leftovers a few times.
    for (let i = 0; i < 4 && (pendingRef.current.length > 0 || flushingRef.current); i++) {
      if (flushingRef.current) {
        await new Promise<void>((resolve) => {
          stoppedRef.current = resolve;
        });
        stoppedRef.current = null;
      } else {
        if (i > 0) await new Promise((r) => setTimeout(r, 2000));
        await flushUploads();
      }
    }
    setUploadState(
      pendingRef.current.length === 0
        ? "saved"
        : seqRef.current > 0
          ? "partial"
          : "failed"
    );
  }

  function beginRecording(mime: string) {
    const stream = streamRef.current;
    if (!stream) return;
    try {
      const rec = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: RECORDING_BITRATE,
      });
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) {
          pendingRef.current.push(e.data);
          if (recordingActiveRef.current) void flushUploads();
        }
      };
      rec.onstop = () => void finishUploads();
      // Participant hit the browser's own "Stop sharing": save what we have.
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (rec.state !== "inactive") rec.stop();
      });
      rec.start(CHUNK_MS);
      recorderRef.current = rec;
      recordingActiveRef.current = true;
      setRecording(true);
    } catch {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  function pickMime(): string {
    return MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
  }

  async function startSession(agreed: boolean) {
    setStarting(true);
    const consentAt = new Date().toISOString();
    let status: ConsentStatus = agreed ? "granted" : "declined";
    let chosen: "screen" | "rrweb" | null = null;

    if (agreed) {
      // rrweb first (richer replays, works on mobile, no permission prompt) —
      // available when the tested site includes the Loop snippet.
      if (await waitForSnippet(2500)) {
        chosen = "rrweb";
      } else {
        const supported =
          typeof navigator !== "undefined" &&
          !!navigator.mediaDevices?.getDisplayMedia &&
          typeof MediaRecorder !== "undefined";
        if (!supported) {
          status = "unsupported";
        } else {
          try {
            const opts: DisplayMediaOptions = {
              video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 8, max: 15 },
              },
              audio: false,
              preferCurrentTab: true,
              selfBrowserSurface: "include",
              surfaceSwitching: "exclude",
            };
            streamRef.current = await navigator.mediaDevices.getDisplayMedia(
              opts as MediaStreamConstraints
            );
            chosen = "screen";
          } catch (e) {
            status =
              e instanceof DOMException && e.name === "NotAllowedError"
                ? "permission_denied"
                : "unsupported";
          }
        }
      }
    }

    const mime = chosen === "screen" ? pickMime() : null;

    // Register the session (consent outcome + recording plan). Fail-soft: if
    // this insert fails the test continues, just without recording (the
    // storage, chunk, and ingest policies only accept registered sessions).
    const { error } = await supabase.from("sessions").insert({
      id: sessionId,
      test_id: test.id,
      consent_status: status,
      consent_at: consentAt,
      recording_type: chosen,
      recording_mime: mime,
    });
    if (error && chosen) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      chosen = null;
    }
    setMethod(chosen);

    if (chosen === "screen" && mime) {
      beginRecording(mime);
    } else if (chosen === "rrweb") {
      // Two start channels, whichever reaches the snippet first: reload the
      // iframe with the session param, and postMessage a few times. The
      // "recording" indicator only turns on when the snippet confirms.
      setIframeSrc(withSessionParam(test.site_url));
      for (const delay of [0, 500, 1500, 3000]) {
        setTimeout(
          () => messageIframe({ type: "loop:start", sessionId }),
          delay
        );
      }
    }
    startedAtRef.current = new Date().toISOString();
    setStarting(false);
    setExpanded(false); // collapse the mobile sheet; desktop is unaffected
    setPhase("test");
  }

  const canSubmit =
    !submitting &&
    (task?.type === "instruction" ||
      (task?.type === "rating" ? rating !== null : text.trim().length > 0));

  async function record(answer: string) {
    setSubmitting(true);
    setSaveError(false);
    const { error } = await supabase.from("responses").insert({
      test_id: test.id,
      session_id: sessionId,
      task_id: task.id,
      answer,
      started_at: startedAtRef.current,
      submitted_at: new Date().toISOString(),
    });
    setSubmitting(false);
    if (error) {
      setSaveError(true);
      return false;
    }
    return true;
  }

  function advance() {
    if (current + 1 >= tasks.length) {
      if (method === "rrweb") {
        messageIframe({ type: "loop:stop" });
        setRecording(false);
      } else {
        stopCapture();
      }
      setPhase("done");
      setExpanded(true);
      return;
    }
    setCurrent(current + 1);
    setRating(null);
    setText("");
    startedAtRef.current = new Date().toISOString();
  }

  async function handleNext() {
    const answer =
      task.type === "instruction"
        ? "done"
        : task.type === "rating"
          ? rating!
          : text.trim();
    if (await record(answer)) advance();
  }

  async function handleSkip() {
    if (await record("skipped")) advance();
  }

  const nextLabel = submitting
    ? "Saving…"
    : isLast
      ? "Finish test"
      : task.type !== "instruction"
        ? "Submit"
        : "Done — next task";

  const eyebrow = task?.type === "instruction" ? `Task ${current + 1}` : "Question";

  const gripStep = done ? "✓" : phase === "consent" ? "i" : `${current + 1}/${tasks.length}`;
  const gripTitle = done
    ? "Test complete — thank you!"
    : phase === "consent"
      ? "Before you start"
      : task.prompt;
  const stepLabel = done
    ? "Complete"
    : phase === "consent"
      ? "Before you start"
      : `Task ${current + 1} of ${tasks.length}`;

  return (
    <div className="runner">
      <div className="site-pane">
        <div className="session-bar">
          {recording ? (
            <>
              <span className="rec-dot" /> Recording
            </>
          ) : (
            <>Session</>
          )}
          <span className="url">{domain}</span>
        </div>
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          title="Website under test"
          onLoad={() => messageIframe({ type: "loop:probe" })}
        />
      </div>

      <aside
        className={`panel${expanded ? " expanded" : ""}${
          desktopCollapsed ? " collapsed" : ""
        }`}
      >
        {/* desktop collapsed rail */}
        <button
          className="rail"
          aria-label="Expand task panel"
          aria-expanded={!desktopCollapsed}
          tabIndex={desktopCollapsed ? 0 : -1}
          onClick={() => setDesktopCollapsed(false)}
        >
          <span className="rail-chev">
            <svg viewBox="0 0 24 24">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </span>
          <span className="rail-step">{gripStep}</span>
          <span className="rail-progress">
            <span style={{ height: `${pct}%` }} />
          </span>
        </button>

        {/* mobile grip */}
        <button
          className="sheet-grip"
          aria-expanded={expanded}
          aria-controls="panelBody"
          onClick={() => setExpanded(!expanded)}
        >
          <span className="grip-bar" />
          <span className="grip-row">
            <span className="grip-step">{gripStep}</span>
            <span className="grip-title">{gripTitle}</span>
            <span className="grip-chev">
              <svg viewBox="0 0 24 24">
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </span>
          </span>
          <span className="m-progress">
            <div style={{ width: `${pct}%` }} />
          </span>
        </button>

        <div className="panel-head">
          <div className="brand">
            <span className="brand-mark" /> Loop
            <button
              className="panel-collapse"
              aria-label="Collapse task panel"
              onClick={() => setDesktopCollapsed(true)}
            >
              <svg viewBox="0 0 24 24">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
          <div className="progress-wrap">
            <div className="progress-label">
              <span>{stepLabel}</span>
              <span>{pct}%</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>

        <div className="panel-body" id="panelBody">
          {phase === "consent" && (
            <>
              <div className="task-eyebrow">Consent</div>
              <div className="task-title">Before you start</div>
              <div className="task-desc">
                If you agree, this test records:
              </div>
              <ul className="consent-list">
                <li>
                  your activity on the website being tested while you do the
                  tasks — as a screen recording of this browser tab, or as your
                  interactions with the site (taps, scrolling, typing; text you
                  type into the site is masked and never recorded)
                </li>
                <li>your task answers</li>
              </ul>
              <div className="task-desc">
                <strong>Why:</strong> usability research — to understand where
                this website is easy or hard to use.
                <br />
                <strong>Who can see it:</strong> only the researcher who created
                this test.
                <br />
                <strong>How long:</strong> recordings are automatically deleted
                after 30 days.
              </div>
              <div className="task-desc">
                Prefer not to be recorded? You can still take the test.
              </div>
            </>
          )}

          {phase === "test" && (
            <>
              <div className="task-eyebrow">{eyebrow}</div>
              <div className="task-title">{task.prompt}</div>
              {task.description && (
                <div className="task-desc">{task.description}</div>
              )}

              {task.type === "rating" && (
                <div className="answer">
                  <label>Tap a rating</label>
                  <div className="scale">
                    {["1", "2", "3", "4", "5"].map((v) => (
                      <button
                        key={v}
                        aria-pressed={rating === v}
                        onClick={() => setRating(v)}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  <div className="scale-ends">
                    <span>Very hard</span>
                    <span>Very easy</span>
                  </div>
                </div>
              )}

              {task.type === "open_text" && (
                <div className="answer">
                  <label htmlFor="freeText">Your answer</label>
                  <textarea
                    id="freeText"
                    placeholder="Type your thoughts…"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onFocus={() => setExpanded(true)}
                  />
                </div>
              )}
            </>
          )}

          {done && (
            <div className="done">
              <div className="done-ring">
                <svg viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h2>That&apos;s everything</h2>
              <p>Your responses have been saved. You can close this window.</p>
              {method === "rrweb" && (
                <p className="upload-note">Interaction recording finished.</p>
              )}
              {uploadState === "uploading" && (
                <p className="upload-note">Saving your screen recording…</p>
              )}
              {uploadState === "saved" && (
                <p className="upload-note">Screen recording saved.</p>
              )}
              {uploadState === "partial" && (
                <p className="upload-note">
                  Part of the screen recording couldn&apos;t be saved, but all
                  your answers were saved.
                </p>
              )}
              {uploadState === "failed" && (
                <p className="upload-note">
                  We couldn&apos;t save the screen recording, but all your
                  answers were saved.
                </p>
              )}
            </div>
          )}
        </div>

        {phase === "consent" && (
          <div className="panel-foot">
            <button
              className="btn"
              disabled={starting}
              onClick={() => startSession(true)}
            >
              {starting ? "Starting…" : "I agree — start the test"}
            </button>
            <button
              className="btn ghost"
              disabled={starting}
              onClick={() => startSession(false)}
            >
              Continue without recording
            </button>
          </div>
        )}

        {phase === "test" && (
          <div className="panel-foot">
            <button className="btn" disabled={!canSubmit} onClick={handleNext}>
              {nextLabel}
            </button>
            <button
              className="btn ghost"
              disabled={submitting}
              onClick={handleSkip}
            >
              Skip this task
            </button>
            {saveError && (
              <div className="save-error" role="alert">
                Couldn&apos;t save your answer — check your connection and try
                again.
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

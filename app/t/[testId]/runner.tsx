"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import "./runner.css";

export type TaskOptions = {
  key?: string;
  flag?: string;
  optional?: boolean;
  fullscreen?: boolean; // render as a question card, site not visible
  single_continue?: boolean; // one Continue button instead of did-it/gave-up
  report_labels?: { done?: string; gave_up?: string }; // custom self-report labels
  required_text?: { label: string; min?: number; store?: string };
  confirm?: { label: string; options: string[]; store?: string };
  success_criteria?: string;
};

export type RunnerTest = {
  id: string;
  title: string;
  site_url: string;
  config: Record<string, unknown> | null;
};
export type RunnerTask = {
  id: string;
  sort_order: number;
  type: "instruction" | "rating" | "open_text" | "usability_task";
  prompt: string;
  description: string | null;
  options: TaskOptions | null;
};

type ConsentStatus = "granted" | "declined" | "permission_denied" | "unsupported";
type Phase =
  | "consent"
  | "no_consent"
  | "screener"
  | "screened_out"
  | "test"
  | "done";

export type ScreenerStep = {
  id: string;
  label: string;
  options: string[];
  multi?: boolean;
  min?: number;
  exclusive?: string; // option that deselects all others (and vice versa)
  pass_if_any?: string[]; // if set, selection must intersect to pass
  strict_flag?: string; // config flag: true = failing disqualifies
  fail_tag?: string; // tag stored when failing non-strict
  disqualify_message?: string;
};
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
  // usability_task loop state
  const [stage, setStage] = useState<"work" | "rate" | "followup">("work");
  const [result, setResult] = useState<"success_claimed" | "gave_up" | null>(
    null
  );
  const [ease, setEase] = useState<number | null>(null);
  const [confirmChoice, setConfirmChoice] = useState<string | null>(null);
  const [followup, setFollowup] = useState("");
  const [extraText, setExtraText] = useState("");
  const shownAtRef = useRef(Date.now());
  const reportedAtRef = useRef(0);

  // Screener phase (config-driven; runs between consent and the first task)
  const screenerSteps = useMemo<ScreenerStep[]>(() => {
    const s = test.config?.screener;
    return Array.isArray(s) ? (s as ScreenerStep[]) : [];
  }, [test.config]);
  const [screenerIndex, setScreenerIndex] = useState(0);
  const [screenerSelected, setScreenerSelected] = useState<string[]>([]);
  const [screenedOutMessage, setScreenedOutMessage] = useState("");
  const [consentError, setConsentError] = useState(false);
  const requireRecording = test.config?.REQUIRE_RECORDING === true;

  // Swipe on the sheet grip: down collapses, up expands (plus tap-to-toggle).
  const touchStartYRef = useRef<number | null>(null);
  const swipedRef = useRef(false);

  function onGripTouchStart(e: React.TouchEvent) {
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
    swipedRef.current = false;
  }

  function onGripTouchEnd(e: React.TouchEvent) {
    const startY = touchStartYRef.current;
    touchStartYRef.current = null;
    if (startY === null) return;
    const dy = (e.changedTouches[0]?.clientY ?? startY) - startY;
    if (dy > 30) {
      swipedRef.current = true;
      setExpanded(false);
    } else if (dy < -30) {
      swipedRef.current = true;
      setExpanded(true);
    }
  }

  function onGripClick() {
    // A swipe also fires a click afterwards — don't double-toggle.
    if (swipedRef.current) {
      swipedRef.current = false;
      return;
    }
    setExpanded(!expanded);
  }
  const screenerAnswersRef = useRef<Record<string, string | string[]>>({});
  const screenerTagsRef = useRef<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [starting, setStarting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [method, setMethod] = useState<"screen" | "rrweb" | null>(null);
  const [iframeSrc, setIframeSrc] = useState(test.site_url);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const snippetPresentRef = useRef(false);
  const consentGrantedRef = useRef(false);
  const heldMimeRef = useRef<string | null>(null);
  const methodDecidedRef = useRef(false);
  const screenFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  // Overall progress, weighted by effort: the quick screener spans the first
  // 10% of the bar, the tasks the remaining 90% — so the bar roughly tracks
  // time spent, not step count.
  const screenerShare = screenerSteps.length > 0 ? 10 : 0;
  const pct = done
    ? 100
    : phase === "consent" || phase === "no_consent"
      ? 0
      : phase === "screener" || phase === "screened_out"
        ? Math.round(
            (screenerIndex / Math.max(screenerSteps.length, 1)) * screenerShare
          )
        : Math.round(
            screenerShare + (current / tasks.length) * (100 - screenerShare)
          );
  const isLast = current === tasks.length - 1;

  // A new task (or phase) needs the full panel — auto-expand the desktop rail.
  useEffect(() => {
    setDesktopCollapsed(false);
  }, [current, phase]);

  // Messages from the recording snippet inside the tested site's iframe.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const d = e.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "loop:rrweb:hello") {
        snippetPresentRef.current = true;
        void commitRrweb();
      }
      if (d.type === "loop:rrweb:started" && d.sessionId === sessionId) {
        void commitRrweb();
        setRecording(true);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sessionId]);

  function messageIframe(msg: object) {
    iframeRef.current?.contentWindow?.postMessage(msg, "*");
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
    setConsentError(false);
    const consentAt = new Date().toISOString();
    const status: ConsentStatus = agreed ? "granted" : "declined";
    consentGrantedRef.current = agreed;

    // Recording-mandatory studies: declining consent ends the study here.
    if (!agreed && requireRecording) {
      await supabase.from("sessions").insert({
        id: sessionId,
        test_id: test.id,
        consent_status: status,
        consent_at: consentAt,
        recording_type: null,
        recording_mime: null,
      });
      setStarting(false);
      setPhase("no_consent");
      return;
    }

    // Question mode: the site iframe is NOT mounted yet, so the recording
    // method can't be decided here. For screen capture the permission prompt
    // must happen on this click (user activation), so we acquire and HOLD the
    // stream now — the recorder starts only when task mode begins. If the
    // site turns out to have the rrweb snippet, the held stream is discarded
    // (rrweb takes priority).
    if (agreed) {
      const supported =
        typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getDisplayMedia &&
        typeof MediaRecorder !== "undefined";
      if (supported) {
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
          heldMimeRef.current = pickMime();
        } catch {
          // Permission denied or unavailable.
          if (requireRecording) {
            // Recording is mandatory: stay on the consent card and let them
            // try again — no way forward without sharing.
            setConsentError(true);
            setStarting(false);
            return;
          }
          // Lenient studies: rrweb may still record; consent stands.
        }
      }
    }

    // Register the session (consent outcome). recording_type is set later,
    // exactly once, via the set_session_recording RPC when task mode starts.
    // Fail-soft: an insert error never blocks the test.
    await supabase.from("sessions").insert({
      id: sessionId,
      test_id: test.id,
      consent_status: status,
      consent_at: consentAt,
      recording_type: null,
      recording_mime: null,
    });

    setIframeSrc(agreed ? withSessionParam(test.site_url) : test.site_url);
    setStarting(false);
    if (screenerSteps.length > 0) {
      setPhase("screener"); // still question mode — no site visible
    } else {
      enterTaskMode();
    }
  }

  // --- task mode entry & recording method commitment ---

  function enterTaskMode() {
    // Sheet starts open so the first task's prompt (and its answer field)
    // is immediately visible on mobile; desktop is unaffected.
    setExpanded(true);
    shownAtRef.current = Date.now();
    startedAtRef.current = new Date().toISOString();
    setPhase("test");
    // The iframe mounts now. If the snippet announces itself, rrweb wins;
    // otherwise a held screen stream is committed after a grace period.
    if (streamRef.current) {
      screenFallbackRef.current = setTimeout(() => void commitScreen(), 4000);
    }
  }

  async function commitRrweb() {
    if (methodDecidedRef.current || !consentGrantedRef.current) return;
    methodDecidedRef.current = true;
    if (screenFallbackRef.current) clearTimeout(screenFallbackRef.current);
    // Discard any held screen stream — rrweb replays are richer.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setMethod("rrweb");
    await supabase.rpc("set_session_recording", {
      p_session: sessionId,
      p_type: "rrweb",
      p_mime: null,
    });
    messageIframe({ type: "loop:start", sessionId });
  }

  async function commitScreen() {
    if (methodDecidedRef.current) return;
    const mime = heldMimeRef.current;
    if (!streamRef.current || !mime) return;
    methodDecidedRef.current = true;
    setMethod("screen");
    const { data: ok } = await supabase.rpc("set_session_recording", {
      p_session: sessionId,
      p_type: "screen",
      p_mime: mime,
    });
    if (ok) {
      beginRecording(mime);
    } else {
      // Session not eligible (insert failed earlier?) — stay honest, no
      // recording, release the capture.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setMethod(null);
    }
  }

  // --- screener phase ---

  function stopAllRecording() {
    if (screenFallbackRef.current) clearTimeout(screenFallbackRef.current);
    if (method === "rrweb") {
      messageIframe({ type: "loop:stop" });
      setRecording(false);
    } else {
      stopCapture(); // stops recorder if running, else releases held stream
    }
  }

  function toggleScreenerOption(opt: string) {
    const step = screenerSteps[screenerIndex];
    if (!step.multi) {
      setScreenerSelected([opt]);
      return;
    }
    setScreenerSelected((sel) => {
      if (sel.includes(opt)) return sel.filter((o) => o !== opt);
      // Exclusive option deselects all others, and vice versa.
      if (step.exclusive && opt === step.exclusive) return [opt];
      const base = step.exclusive ? sel.filter((o) => o !== step.exclusive) : sel;
      return [...base, opt];
    });
  }

  async function saveScreener(screenedOut: boolean) {
    await supabase.from("screener_answers").insert({
      session_id: sessionId,
      answers: screenerAnswersRef.current,
      tags: screenerTagsRef.current,
      screened_out: screenedOut,
    });
    // Fail-soft: an insert error never blocks the participant.
  }

  async function screenerContinue() {
    const step = screenerSteps[screenerIndex];
    screenerAnswersRef.current[step.id] = step.multi
      ? screenerSelected
      : screenerSelected[0];

    if (
      step.pass_if_any &&
      !screenerSelected.some((o) => step.pass_if_any!.includes(o))
    ) {
      const strict =
        !!step.strict_flag && test.config?.[step.strict_flag] === true;
      if (strict) {
        setSubmitting(true);
        await saveScreener(true);
        setSubmitting(false);
        stopAllRecording();
        setScreenedOutMessage(
          step.disqualify_message ??
            "This study isn't a fit this time — thanks for your interest!"
        );
        setPhase("screened_out");
        return;
      }
      if (step.fail_tag && !screenerTagsRef.current.includes(step.fail_tag)) {
        screenerTagsRef.current.push(step.fail_tag);
      }
    }

    if (screenerIndex + 1 >= screenerSteps.length) {
      setSubmitting(true);
      await saveScreener(false);
      setSubmitting(false);
      enterTaskMode();
    } else {
      setScreenerIndex(screenerIndex + 1);
      setScreenerSelected([]);
    }
  }

  const canSubmit =
    !submitting &&
    (task?.type === "instruction" ||
      (task?.type === "rating"
        ? rating !== null
        : task?.options?.optional === true || text.trim().length > 0));

  const requiredTextMin = task?.options?.required_text?.min ?? 1;
  const requiredTextOk =
    !task?.options?.required_text ||
    extraText.trim().length >= requiredTextMin;

  async function record(answer: string, detail?: Record<string, unknown>) {
    setSubmitting(true);
    setSaveError(false);
    const row: Record<string, unknown> = {
      test_id: test.id,
      session_id: sessionId,
      task_id: task.id,
      answer,
      started_at: startedAtRef.current,
      submitted_at: new Date().toISOString(),
    };
    if (detail) row.detail = detail; // column exists only after study-upgrade.sql
    const { error } = await supabase.from("responses").insert(row);
    setSubmitting(false);
    if (error) {
      setSaveError(true);
      return false;
    }
    return true;
  }

  function advance() {
    if (current + 1 >= tasks.length) {
      stopAllRecording();
      setPhase("done");
      setExpanded(true);
      return;
    }
    // Entering a full-screen question card unmounts the site — recording of
    // site activity ends here (the card itself isn't part of the study data).
    if (tasks[current + 1]?.options?.fullscreen) {
      stopAllRecording();
      setExpanded(true);
    }
    setCurrent(current + 1);
    setRating(null);
    setText("");
    setStage("work");
    setResult(null);
    setEase(null);
    setConfirmChoice(null);
    setFollowup("");
    setExtraText("");
    shownAtRef.current = Date.now();
    startedAtRef.current = new Date().toISOString();
  }

  // --- usability_task loop ---

  function selfReport(r: "success_claimed" | "gave_up") {
    setResult(r);
    reportedAtRef.current = Date.now();
    setStage("rate");
  }

  async function finalizeUsability(finalResult: string, finalFollowup: string) {
    const o = task.options;
    const detail: Record<string, unknown> = {
      ease,
      time_on_task_ms: reportedAtRef.current - shownAtRef.current,
    };
    if (finalFollowup.trim()) detail.followup = finalFollowup.trim();
    if (o?.required_text?.store && extraText.trim()) {
      detail[o.required_text.store] = extraText.trim();
    }
    if (o?.confirm?.store && confirmChoice) {
      detail[o.confirm.store] = confirmChoice;
    }
    if (await record(finalResult, detail)) advance();
  }

  function continueFromRate() {
    if (ease === null || result === null) return;
    if (ease <= 3 || result === "gave_up") {
      setStage("followup");
    } else {
      void finalizeUsability(result, "");
    }
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

  const eyebrow =
    task?.type === "instruction" || task?.type === "usability_task"
      ? `Task ${current + 1}`
      : "Question";

  const screenerStep = screenerSteps[screenerIndex];
  const gripStep = done
    ? "✓"
    : phase === "consent" || phase === "screened_out" || phase === "no_consent"
      ? "i"
      : phase === "screener"
        ? `${screenerIndex + 1}/${screenerSteps.length}`
        : `${current + 1}/${tasks.length}`;
  const gripTitle = done
    ? "Test complete — thank you!"
    : phase === "consent"
      ? "Before you start"
      : phase === "screener"
        ? screenerStep?.label ?? "About you"
        : phase === "screened_out" || phase === "no_consent"
          ? "Thanks for your interest"
          : task.prompt;
  const stepLabel = done
    ? "Complete"
    : phase === "consent"
      ? "Before you start"
      : phase === "screener"
        ? "About you" // the count lives in the body's muted progress line
        : phase === "screened_out" || phase === "no_consent"
          ? "Thanks"
          : `Task ${current + 1} of ${tasks.length}`;

  // Question mode: full-screen cards, the test site is NOT mounted anywhere —
  // a participant's first sight of it must be the first task, not before.
  const qmode = phase !== "test" || task?.options?.fullscreen === true;


  return (
    <div className={`runner${qmode ? " qmode" : ""}`}>
      {!qmode && (
        <div className="site-pane">
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            title="Website under test"
            onLoad={() => messageIframe({ type: "loop:probe" })}
          />
          {/* Desktop: prominent drawer handle on the panel's edge */}
          <button
            className="edge-handle"
            aria-label={
              desktopCollapsed ? "Expand task panel" : "Collapse task panel"
            }
            title={desktopCollapsed ? "Show tasks" : "Hide tasks"}
            onClick={() => setDesktopCollapsed(!desktopCollapsed)}
          >
            <svg viewBox="0 0 24 24">
              <polyline
                points={desktopCollapsed ? "15 18 9 12 15 6" : "9 18 15 12 9 6"}
              />
            </svg>
          </button>
        </div>
      )}

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
          {recording && <span className="rec-dot" title="Recording" />}
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
          onClick={onGripClick}
          onTouchStart={onGripTouchStart}
          onTouchEnd={onGripTouchEnd}
        >
          <span className="grip-bar" />
          <span className="grip-row">
            {recording && <span className="rec-dot" title="Recording" />}
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
            {recording && (
              <span className="rec-chip">
                <span className="rec-dot" /> Recording
              </span>
            )}
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
                This study takes{" "}
                {typeof test.config?.duration_text === "string"
                  ? test.config.duration_text
                  : "a few minutes"}{" "}
                and records how you use the test website: a screen recording of
                this browser tab, your taps, scrolling and typing (anything you
                type into the site is masked), and your task answers.
              </div>
              <div className="task-desc">
                Only the researcher running this test can see the recordings,
                and they&apos;re deleted after 30 days. We use them for one
                thing: finding out where the website is easy or hard to use.
              </div>
              <div className="task-desc">
                {requireRecording
                  ? "Recording is required for the study to work — if you'd rather not, simply close this tab."
                  : "Prefer not to be recorded? You can still take the test."}
              </div>
              <div className="task-desc" style={{ color: "var(--ink)" }}>
                Do you agree to take part?
              </div>
              {consentError && (
                <div className="save-error" role="alert" style={{ textAlign: "left" }}>
                  Screen sharing is required to take part. Click “I agree —
                  start the test” again, and when your browser asks, choose
                  this tab and press Share.
                </div>
              )}
            </>
          )}

          {phase === "no_consent" && (
            <div className="done">
              <h2>That&apos;s okay</h2>
              <p>
                This study needs recording to run, so it ends here. Thanks for
                your time — you can close this window.
              </p>
            </div>
          )}

          {phase === "screener" && screenerStep && (
            <>
              <div className="q-progress">
                Question {screenerIndex + 1} of {screenerSteps.length}
              </div>
              <div className="task-title">{screenerStep.label}</div>
              {screenerStep.multi && (
                <div className="q-hint">Select all that apply</div>
              )}
              <div className="choice-list">
                {screenerStep.options.map((opt) => (
                  <button
                    key={opt}
                    aria-pressed={screenerSelected.includes(opt)}
                    onClick={() => toggleScreenerOption(opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </>
          )}

          {phase === "screened_out" && (
            <div className="done">
              <h2>Thanks for your interest</h2>
              <p>{screenedOutMessage}</p>
            </div>
          )}

          {phase === "test" && task.type === "usability_task" && (
            <>
              <div className="task-eyebrow">{eyebrow}</div>

              {/* (a) Task screen: prompt + completion control only. The ease
                  question never appears here — "that" must refer to a
                  finished task. */}
              {stage === "work" && (
                <>
                  <div className="task-title">{task.prompt}</div>
                  {task.description && (
                    <div className="task-desc">{task.description}</div>
                  )}
                  {task.options?.required_text && (
                    <div className="answer">
                      <label htmlFor="extraText">
                        {task.options.required_text.label}
                      </label>
                      <textarea
                        id="extraText"
                        placeholder="Type your answer…"
                        value={extraText}
                        onChange={(e) => setExtraText(e.target.value)}
                        onFocus={() => setExpanded(true)}
                      />
                      {!requiredTextOk && (
                        <div className="char-hint">
                          At least {requiredTextMin} characters (
                          {extraText.trim().length}/{requiredTextMin})
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* (b) Ease rating: its own step, no task prompt repeated. */}
              {stage === "rate" && (
                <div className="answer">
                  <div className="task-title">
                    How easy or difficult was that?
                  </div>
                  <div className="scale">
                    {[1, 2, 3, 4, 5, 6, 7].map((v) => (
                      <button
                        key={v}
                        aria-pressed={ease === v}
                        onClick={() => setEase(v)}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  <div className="scale-ends">
                    <span>Very difficult</span>
                    <span>Very easy</span>
                  </div>

                  {task.options?.confirm && (
                    <>
                      <div className="task-title" style={{ marginTop: 28 }}>
                        {task.options.confirm.label}
                      </div>
                      <div className="choice-list">
                        {task.options.confirm.options.map((opt) => (
                          <button
                            key={opt}
                            aria-pressed={confirmChoice === opt}
                            onClick={() => setConfirmChoice(opt)}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* (c) Conditional follow-up: its own step. */}
              {stage === "followup" && (
                <div className="answer">
                  <div className="task-title">What got in the way?</div>
                  <div className="task-desc">
                    Optional — leave blank to continue.
                  </div>
                  <textarea
                    placeholder="Tell us what made it hard…"
                    value={followup}
                    onChange={(e) => setFollowup(e.target.value)}
                    onFocus={() => setExpanded(true)}
                  />
                </div>
              )}
            </>
          )}

          {phase === "test" && task.type !== "usability_task" && (
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
              <h2>Thank you for participating!</h2>
              <p>Your responses have been saved. You can close this window.</p>
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
              {requireRecording ? "I don't agree" : "Continue without recording"}
            </button>
          </div>
        )}

        {phase === "screener" && screenerStep && (
          <div className="panel-foot">
            <button
              className="btn"
              disabled={
                submitting ||
                screenerSelected.length < (screenerStep.min ?? 1)
              }
              onClick={() => void screenerContinue()}
            >
              {submitting ? "Saving…" : "Continue"}
            </button>
          </div>
        )}

        {phase === "test" && task.type === "usability_task" && (
          <div className="panel-foot">
            {stage === "work" &&
              (task.options?.single_continue ? (
                <button
                  className="btn"
                  disabled={submitting || !requiredTextOk}
                  onClick={() => selfReport("success_claimed")}
                >
                  Continue
                </button>
              ) : (
                <>
                  <button
                    className="btn"
                    disabled={submitting || !requiredTextOk}
                    onClick={() => selfReport("success_claimed")}
                  >
                    {task.options?.report_labels?.done ?? "Done — Next"}
                  </button>
                  <button
                    className="btn ghost"
                    disabled={submitting || !requiredTextOk}
                    onClick={() => selfReport("gave_up")}
                  >
                    {task.options?.report_labels?.gave_up ??
                      "I couldn't figure it out"}
                  </button>
                </>
              ))}
            {stage === "rate" && (
              <button
                className="btn"
                disabled={
                  submitting ||
                  ease === null ||
                  (!!task.options?.confirm && confirmChoice === null)
                }
                onClick={continueFromRate}
              >
                {submitting
                  ? "Saving…"
                  : isLast && !(ease !== null && (ease <= 3 || result === "gave_up"))
                    ? "Finish test"
                    : "Continue"}
              </button>
            )}
            {stage === "followup" && (
              <button
                className="btn"
                disabled={submitting}
                onClick={() => void finalizeUsability(result!, followup)}
              >
                {submitting ? "Saving…" : isLast ? "Finish test" : "Continue"}
              </button>
            )}
            {saveError && (
              <div className="save-error" role="alert">
                Couldn&apos;t save your answer — check your connection and try
                again.
              </div>
            )}
          </div>
        )}

        {phase === "test" && task.type !== "usability_task" && (
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

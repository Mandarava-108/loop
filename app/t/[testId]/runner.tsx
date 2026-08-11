"use client";

import { useMemo, useRef, useState } from "react";
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

export default function Runner({
  test,
  tasks,
}: {
  test: RunnerTest;
  tasks: RunnerTask[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [current, setCurrent] = useState(0);
  const [done, setDone] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [rating, setRating] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const startedAtRef = useRef(new Date().toISOString());

  const task = tasks[current];
  const pct = done ? 100 : Math.round((current / tasks.length) * 100);
  const isLast = current === tasks.length - 1;

  const domain = useMemo(() => {
    try {
      return new URL(test.site_url).hostname;
    } catch {
      return test.site_url;
    }
  }, [test.site_url]);

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
      setDone(true);
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

  return (
    <div className="runner">
      <div className="site-pane">
        <div className="session-bar">
          <span className="rec-dot" /> Recording session
          <span className="url">{domain}</span>
        </div>
        <iframe src={test.site_url} title="Website under test" />
      </div>

      <aside className={`panel${expanded ? " expanded" : ""}`}>
        {/* mobile grip */}
        <button
          className="sheet-grip"
          aria-expanded={expanded}
          aria-controls="panelBody"
          onClick={() => setExpanded(!expanded)}
        >
          <span className="grip-bar" />
          <span className="grip-row">
            <span className="grip-step">
              {done ? "✓" : `${current + 1}/${tasks.length}`}
            </span>
            <span className="grip-title">
              {done ? "Test complete — thank you!" : task.prompt}
            </span>
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
          </div>
          <div className="progress-wrap">
            <div className="progress-label">
              <span>{done ? "Complete" : `Task ${current + 1} of ${tasks.length}`}</span>
              <span>{pct}%</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>

        <div className="panel-body" id="panelBody">
          {done ? (
            <div className="done">
              <div className="done-ring">
                <svg viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h2>That&apos;s everything</h2>
              <p>Your responses have been saved. You can close this window.</p>
            </div>
          ) : (
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
        </div>

        {!done && (
          <div className="panel-foot">
            <button className="btn" disabled={!canSubmit} onClick={handleNext}>
              {nextLabel}
            </button>
            <button className="btn ghost" disabled={submitting} onClick={handleSkip}>
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

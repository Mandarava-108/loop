import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ExportCsvButton from "./export-csv-button";
import VerifiedSelect from "./verified-select";

type TaskOptions = {
  key?: string;
  flag?: string;
  optional?: boolean;
  required_text?: { label: string; min?: number; store?: string };
  confirm?: { label: string; options: string[]; store?: string };
  success_criteria?: string;
};

type TaskRow = {
  id: string;
  sort_order: number;
  type: "instruction" | "rating" | "open_text" | "usability_task";
  prompt: string;
  options: TaskOptions | null;
};

type ResponseRow = {
  id: string;
  session_id: string;
  task_id: string;
  answer: string;
  detail: Record<string, unknown> | null;
  verified: "success" | "fail" | null;
  started_at: string;
  submitted_at: string;
};

type Cell = {
  responseId: string | null;
  answer: string | null;
  seconds: number | null;
  detail: Record<string, unknown> | null;
  verified: "success" | "fail" | null;
};

type SessionRow = {
  sessionId: string;
  startedAt: string;
  cells: Cell[];
};

type SessionMeta = {
  id: string;
  consent_status: "granted" | "declined" | "permission_denied" | "unsupported";
};

const CONSENT_LABELS: Record<SessionMeta["consent_status"], string> = {
  granted: "consented",
  declined: "declined recording",
  permission_denied: "permission denied",
  unsupported: "not supported",
};

const RESULT_LABELS: Record<string, string> = {
  success_claimed: "did it",
  gave_up: "gave up",
};

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

export default async function ResponsesPage({
  params,
}: PageProps<"/dashboard/[testId]/responses">) {
  const { testId } = await params;
  const supabase = await createClient();

  const { data: test } = await supabase
    .from("tests")
    .select("id, title")
    .eq("id", testId)
    .single<{ id: string; title: string }>();
  if (!test) notFound();

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, sort_order, type, prompt, options")
    .eq("test_id", testId)
    .order("sort_order")
    .returns<TaskRow[]>();

  const { data: responses } = await supabase
    .from("responses")
    .select(
      "id, session_id, task_id, answer, detail, verified, started_at, submitted_at"
    )
    .eq("test_id", testId)
    .order("submitted_at")
    .returns<ResponseRow[]>();

  const taskList = tasks ?? [];
  const taskIndex = new Map(taskList.map((t, i) => [t.id, i]));

  // Group responses into one row per participant session.
  const sessions = new Map<string, SessionRow>();
  for (const r of responses ?? []) {
    let s = sessions.get(r.session_id);
    if (!s) {
      s = {
        sessionId: r.session_id,
        startedAt: r.started_at,
        cells: taskList.map(() => ({
          responseId: null,
          answer: null,
          seconds: null,
          detail: null,
          verified: null,
        })),
      };
      sessions.set(r.session_id, s);
    }
    if (r.started_at < s.startedAt) s.startedAt = r.started_at;
    const i = taskIndex.get(r.task_id);
    if (i !== undefined) {
      // For usability tasks, time-on-task is task-shown -> self-report click
      // (recorded client-side); otherwise started -> submitted.
      const ms =
        typeof r.detail?.time_on_task_ms === "number"
          ? r.detail.time_on_task_ms
          : new Date(r.submitted_at).getTime() -
            new Date(r.started_at).getTime();
      s.cells[i] = {
        responseId: r.id,
        answer: r.answer,
        seconds: Math.max(0, Math.round(ms / 1000)),
        detail: r.detail,
        verified: r.verified,
      };
    }
  }
  const rows = [...sessions.values()].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt)
  );

  // Recording metadata: consent status per session, and which sessions have
  // uploaded chunks (owner-only via RLS).
  const { data: sessionMeta } = await supabase
    .from("sessions")
    .select("id, consent_status")
    .eq("test_id", testId)
    .returns<SessionMeta[]>();
  const metaById = new Map((sessionMeta ?? []).map((m) => [m.id, m]));

  const sessionIds = rows.map((r) => r.sessionId);
  const { data: chunkRows } = sessionIds.length
    ? await supabase
        .from("recording_chunks")
        .select("session_id")
        .in("session_id", sessionIds)
    : { data: [] };
  const hasRecording = new Set((chunkRows ?? []).map((c) => c.session_id));

  // ---------- CSV (built server-side, downloaded client-side) ----------
  const header: string[] = ["session_id", "session_started_at"];
  const columns: ((c: Cell) => string)[] = [];
  taskList.forEach((t, i) => {
    if (t.type === "usability_task") {
      const key = t.options?.key ?? `task_${i + 1}`;
      header.push(`${key}_result`, `${key}_ease`, `${key}_time_s`);
      columns.push(
        (c) => str(c.answer),
        (c) => str(c.detail?.ease),
        (c) => (c.answer !== null && c.seconds !== null ? String(c.seconds) : "")
      );
      const extraStore = t.options?.required_text?.store;
      if (extraStore) {
        header.push(extraStore);
        columns.push((c) => str(c.detail?.[extraStore]));
      }
      const confirmStore = t.options?.confirm?.store;
      if (confirmStore) {
        header.push(confirmStore);
        columns.push((c) => str(c.detail?.[confirmStore]));
      }
      header.push(`${key}_followup`, `${key}_verified`);
      columns.push(
        (c) => str(c.detail?.followup),
        (c) => str(c.verified)
      );
    } else {
      const label = t.options?.key ?? `${i + 1}. ${t.prompt}`;
      header.push(label, `${label} (seconds)`);
      columns.push(
        (c) => str(c.answer),
        (c) => (c.answer !== null && c.seconds !== null ? String(c.seconds) : "")
      );
    }
  });
  const csvRows = rows.map((s) => [
    s.sessionId,
    s.startedAt,
    ...s.cells.flatMap((c) => columns.map((fn) => fn(c))),
  ]);

  return (
    <main className="flex-1 bg-[#14161B] text-[#EDEFF3]">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <header className="mb-8 flex items-center gap-3 text-sm text-[#9AA1AD]">
          <Link href="/dashboard" className="hover:text-[#EDEFF3]">
            ← Back to tests
          </Link>
        </header>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">{test.title}</h1>
            <p className="mt-1 text-sm text-[#9AA1AD]">
              {rows.length} participant session{rows.length === 1 ? "" : "s"}
            </p>
          </div>
          {rows.length > 0 && (
            <ExportCsvButton
              filename={`loop-responses-${test.id}.csv`}
              header={header}
              rows={csvRows}
            />
          )}
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-[#2B2F38] bg-[#1D2027] px-6 py-12 text-center">
            <p className="mb-1 font-medium">No responses yet</p>
            <p className="text-sm text-[#9AA1AD]">
              Share the test link with participants — sessions appear here as
              soon as the first answer is submitted.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#2B2F38]">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-[#1D2027] text-left text-[#9AA1AD]">
                  <th className="whitespace-nowrap px-4 py-3 font-medium">
                    Session
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">
                    Recording
                  </th>
                  {taskList.map((t, i) => (
                    <th
                      key={t.id}
                      className="min-w-[170px] max-w-[280px] px-4 py-3 font-medium"
                      title={
                        t.options?.success_criteria
                          ? `${t.prompt}\n\nSuccess: ${t.options.success_criteria}`
                          : t.prompt
                      }
                    >
                      <span className="mr-1.5 text-[#7C6FF0]">{i + 1}.</span>
                      {t.prompt}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr
                    key={s.sessionId}
                    className="border-t border-[#2B2F38] align-top"
                  >
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="font-mono text-xs text-[#9AA1AD]">
                        {s.sessionId.slice(0, 8)}
                      </div>
                      <div className="mt-0.5 text-xs text-[#9AA1AD]">
                        {new Date(s.startedAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {hasRecording.has(s.sessionId) ? (
                        <Link
                          href={`/dashboard/${testId}/responses/${s.sessionId}`}
                          className="rounded-[8px] border border-[#2B2F38] px-2.5 py-1.5 text-xs font-medium text-[#EDEFF3] transition hover:border-[#7C6FF0]"
                        >
                          ▶ Watch
                        </Link>
                      ) : (
                        <span
                          className="text-xs text-[#565D6B]"
                          title="No recording for this session"
                        >
                          {metaById.has(s.sessionId)
                            ? CONSENT_LABELS[
                                metaById.get(s.sessionId)!.consent_status
                              ]
                            : "—"}
                        </span>
                      )}
                    </td>
                    {s.cells.map((c, i) => {
                      const t = taskList[i];
                      if (c.answer === null) {
                        return (
                          <td key={i} className="px-4 py-3">
                            <span className="text-[#565D6B]">—</span>
                          </td>
                        );
                      }
                      if (t.type === "usability_task") {
                        const gaveUp = c.answer === "gave_up";
                        const extras: string[] = [];
                        const extraStore = t.options?.required_text?.store;
                        if (extraStore && c.detail?.[extraStore]) {
                          extras.push(`Answer: ${str(c.detail[extraStore])}`);
                        }
                        const confirmStore = t.options?.confirm?.store;
                        if (confirmStore && c.detail?.[confirmStore]) {
                          extras.push(
                            `Confirm: ${str(c.detail[confirmStore])}`
                          );
                        }
                        if (c.detail?.followup) {
                          extras.push(`Got in the way: ${str(c.detail.followup)}`);
                        }
                        return (
                          <td key={i} className="px-4 py-3">
                            <div title={extras.join("\n") || undefined}>
                              <span
                                className={
                                  gaveUp ? "text-[#F0605A]" : "text-[#4ECF9A]"
                                }
                              >
                                {RESULT_LABELS[c.answer] ?? c.answer}
                              </span>
                              {typeof c.detail?.ease === "number" && (
                                <span className="ml-1.5">
                                  · {c.detail.ease}/7
                                </span>
                              )}
                              {c.seconds !== null && (
                                <span className="ml-1.5 whitespace-nowrap text-xs text-[#565D6B]">
                                  {c.seconds}s
                                </span>
                              )}
                              {extras.length > 0 && (
                                <span className="ml-1 text-xs text-[#565D6B]">
                                  💬
                                </span>
                              )}
                            </div>
                            {c.responseId && (
                              <VerifiedSelect
                                responseId={c.responseId}
                                initial={c.verified}
                              />
                            )}
                          </td>
                        );
                      }
                      return (
                        <td key={i} className="px-4 py-3">
                          <span
                            className={
                              c.answer === "skipped"
                                ? "italic text-[#9AA1AD]"
                                : ""
                            }
                          >
                            {t.type === "rating" && c.answer !== "skipped"
                              ? `${c.answer}/5`
                              : c.answer === ""
                                ? "—"
                                : c.answer}
                          </span>
                          {c.seconds !== null && (
                            <span className="ml-1.5 whitespace-nowrap text-xs text-[#565D6B]">
                              {c.seconds}s
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

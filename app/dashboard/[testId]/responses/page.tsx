import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ExportCsvButton from "./export-csv-button";

type TaskRow = {
  id: string;
  sort_order: number;
  type: "instruction" | "rating" | "open_text";
  prompt: string;
};

type ResponseRow = {
  session_id: string;
  task_id: string;
  answer: string;
  started_at: string;
  submitted_at: string;
};

export type SessionRow = {
  sessionId: string;
  startedAt: string;
  cells: { answer: string | null; seconds: number | null }[];
};

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
    .select("id, sort_order, type, prompt")
    .eq("test_id", testId)
    .order("sort_order")
    .returns<TaskRow[]>();

  const { data: responses } = await supabase
    .from("responses")
    .select("session_id, task_id, answer, started_at, submitted_at")
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
        cells: taskList.map(() => ({ answer: null, seconds: null })),
      };
      sessions.set(r.session_id, s);
    }
    if (r.started_at < s.startedAt) s.startedAt = r.started_at;
    const i = taskIndex.get(r.task_id);
    if (i !== undefined) {
      s.cells[i] = {
        answer: r.answer,
        seconds: Math.max(
          0,
          Math.round(
            (new Date(r.submitted_at).getTime() -
              new Date(r.started_at).getTime()) /
              1000
          )
        ),
      };
    }
  }
  const rows = [...sessions.values()].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt)
  );

  return (
    <main className="flex-1 bg-[#14161B] text-[#EDEFF3]">
      <div className="mx-auto max-w-5xl px-5 py-10">
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
              tasks={taskList.map((t, i) => `${i + 1}. ${t.prompt}`)}
              rows={rows}
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
                  {taskList.map((t, i) => (
                    <th
                      key={t.id}
                      className="min-w-[160px] max-w-[280px] px-4 py-3 font-medium"
                      title={t.prompt}
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
                    {s.cells.map((c, i) => (
                      <td key={i} className="px-4 py-3">
                        {c.answer === null ? (
                          <span className="text-[#565D6B]">—</span>
                        ) : (
                          <>
                            <span
                              className={
                                c.answer === "skipped"
                                  ? "italic text-[#9AA1AD]"
                                  : ""
                              }
                            >
                              {taskList[i].type === "rating" &&
                              c.answer !== "skipped"
                                ? `${c.answer}/5`
                                : c.answer}
                            </span>
                            {c.seconds !== null && (
                              <span className="ml-1.5 whitespace-nowrap text-xs text-[#565D6B]">
                                {c.seconds}s
                              </span>
                            )}
                          </>
                        )}
                      </td>
                    ))}
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

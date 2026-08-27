import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LocalTime from "../../local-time";
import PrintButton from "./print-button";

type TaskOptions = {
  key?: string;
  optional?: boolean;
  required_text?: { label: string; store?: string };
  confirm?: { label: string; options: string[]; store?: string };
  success_criteria?: string;
};

type TaskRow = {
  id: string;
  sort_order: number;
  type: "instruction" | "rating" | "open_text" | "usability_task";
  prompt: string;
  description: string | null;
  options: TaskOptions | null;
};

type ResponseRow = {
  session_id: string;
  task_id: string;
  answer: string;
  detail: Record<string, unknown> | null;
  verified: "success" | "fail" | null;
  started_at: string;
  submitted_at: string;
};

type ScreenerRow = {
  session_id: string;
  answers: Record<string, unknown>;
  tags: string[];
  screened_out: boolean;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function fmtSecs(s: number | null): string {
  if (s === null) return "—";
  if (s < 90) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function pctFmt(n: number, of: number): string {
  return of === 0 ? "—" : `${Math.round((n / of) * 100)}%`;
}

export default async function ReportPage({
  params,
}: PageProps<"/dashboard/[testId]/report">) {
  const { testId } = await params;
  const supabase = await createClient();

  const { data: test } = await supabase
    .from("tests")
    .select("id, title, site_url")
    .eq("id", testId)
    .single<{ id: string; title: string; site_url: string }>();
  if (!test) notFound();

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, sort_order, type, prompt, description, options")
    .eq("test_id", testId)
    .order("sort_order")
    .returns<TaskRow[]>();
  const taskList = tasks ?? [];

  const { data: responses } = await supabase
    .from("responses")
    .select("session_id, task_id, answer, detail, verified, started_at, submitted_at")
    .eq("test_id", testId)
    .order("submitted_at")
    .returns<ResponseRow[]>();
  const respList = responses ?? [];

  const { data: sessionMeta } = await supabase
    .from("sessions")
    .select("id, consent_status")
    .eq("test_id", testId);
  const allSessionIds = (sessionMeta ?? []).map((m) => m.id);

  const { data: screenerRows } = allSessionIds.length
    ? await supabase
        .from("screener_answers")
        .select("session_id, answers, tags, screened_out")
        .in("session_id", allSessionIds)
        .returns<ScreenerRow[]>()
    : { data: [] as ScreenerRow[] };
  const screenerById = new Map((screenerRows ?? []).map((s) => [s.session_id, s]));
  const screenedOut = (screenerRows ?? []).filter((s) => s.screened_out).length;

  // ---- session-level aggregates ----
  const bySession = new Map<string, ResponseRow[]>();
  for (const r of respList) {
    const list = bySession.get(r.session_id) ?? [];
    list.push(r);
    bySession.set(r.session_id, list);
  }
  const sessionIds = [...bySession.keys()];
  const lastTaskId = taskList[taskList.length - 1]?.id;
  const completed = sessionIds.filter((id) =>
    bySession.get(id)!.some((r) => r.task_id === lastTaskId)
  ).length;
  const durations = sessionIds
    .map((id) => {
      const rs = bySession.get(id)!;
      const start = Math.min(...rs.map((r) => new Date(r.started_at).getTime()));
      const end = Math.max(...rs.map((r) => new Date(r.submitted_at).getTime()));
      return (end - start) / 1000;
    })
    .filter((s) => Number.isFinite(s) && s >= 0);
  const dateRange = respList.length
    ? { first: respList[0].submitted_at, last: respList[respList.length - 1].submitted_at }
    : null;

  // ---- screener breakdowns (only sessions that answered tasks) ----
  const countBy = (key: string): [string, number][] => {
    const counts = new Map<string, number>();
    for (const id of sessionIds) {
      const v = str(screenerById.get(id)?.answers?.[key]) || "(not asked)";
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  };

  // ---- per-task aggregates ----
  const taskStats = taskList.map((t) => {
    const rs = respList.filter((r) => r.task_id === t.id);
    const claimed = rs.filter((r) => r.answer === "success_claimed").length;
    const gaveUp = rs.filter((r) => r.answer === "gave_up").length;
    const verifiedS = rs.filter((r) => r.verified === "success").length;
    const verifiedF = rs.filter((r) => r.verified === "fail").length;
    const eases = rs
      .map((r) => (typeof r.detail?.ease === "number" ? r.detail.ease : null))
      .filter((n): n is number => n !== null);
    const times = rs
      .map((r) =>
        typeof r.detail?.time_on_task_ms === "number"
          ? r.detail.time_on_task_ms / 1000
          : (new Date(r.submitted_at).getTime() - new Date(r.started_at).getTime()) / 1000
      )
      .filter((n) => Number.isFinite(n) && n >= 0);
    const quotes = rs
      .map((r) => ({
        text: str(r.detail?.followup),
        session: r.session_id,
      }))
      .filter((q) => q.text);
    const extraStore = t.options?.required_text?.store;
    const extras = extraStore
      ? rs.map((r) => str(r.detail?.[extraStore])).filter(Boolean)
      : [];
    const confirmStore = t.options?.confirm?.store;
    const confirms = confirmStore
      ? rs.map((r) => str(r.detail?.[confirmStore])).filter(Boolean)
      : [];
    const openAnswers =
      t.type === "open_text" ? rs.map((r) => r.answer).filter((a) => a && a !== "skipped") : [];
    return {
      task: t,
      n: rs.length,
      claimed,
      gaveUp,
      verifiedS,
      verifiedF,
      avgEase: mean(eases),
      medTime: median(times),
      quotes,
      extras,
      confirms,
      openAnswers,
    };
  });

  const usability = taskStats.filter((s) => s.task.type === "usability_task");
  const hardest = [...usability]
    .filter((s) => s.avgEase !== null && s.n > 0)
    .sort((a, b) => (a.avgEase ?? 8) - (b.avgEase ?? 8))
    .slice(0, 3);

  const familiarityShort = (v: string) =>
    v.toLowerCase().startsWith("i've never") || v.toLowerCase().startsWith("i’ve never")
      ? "New to the teachings"
      : v.toLowerCase().startsWith("somewhat")
        ? "Somewhat familiar"
        : v.toLowerCase().startsWith("i follow")
          ? "Follows regularly"
          : v;

  return (
    <main className="report-root flex-1 bg-[#14161B] text-[#EDEFF3]">
      <style>{`
        @media print {
          .report-root { background: #fff !important; color: #111 !important; }
          .report-root .print-card { background: #fff !important; border-color: #ddd !important; }
          .report-root .print-muted { color: #555 !important; }
          .report-root .print-strong { color: #111 !important; }
          .report-root a { color: #111 !important; text-decoration: none; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
      <div className="mx-auto max-w-4xl px-5 py-10">
        <header className="mb-8 flex items-center gap-3 text-sm text-[#9AA1AD] print:hidden">
          <Link href="/dashboard" className="hover:text-[#EDEFF3]">
            ← Back to tests
          </Link>
          <Link href={`/dashboard/${testId}/responses`} className="hover:text-[#EDEFF3]">
            Raw responses
          </Link>
          <div className="ml-auto">
            <PrintButton />
          </div>
        </header>

        <h1 className="print-strong text-2xl font-semibold">{test.title}</h1>
        <p className="print-muted mt-1 text-sm text-[#9AA1AD]">
          Usability test report · {test.site_url}
          {dateRange && (
            <>
              {" "}
              · <LocalTime iso={dateRange.first} dateOnly /> –{" "}
              <LocalTime iso={dateRange.last} dateOnly />
            </>
          )}
        </p>

        {/* ---- headline numbers ---- */}
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Sessions", String(sessionIds.length)],
            ["Completed", `${completed} (${pctFmt(completed, sessionIds.length)})`],
            ["Median duration", fmtSecs(median(durations))],
            ["Screened out", String(screenedOut)],
          ].map(([label, value]) => (
            <div
              key={label}
              className="print-card rounded-xl border border-[#2B2F38] bg-[#1D2027] p-4"
            >
              <div className="print-muted text-xs text-[#9AA1AD]">{label}</div>
              <div className="print-strong mt-1 text-xl font-semibold">{value}</div>
            </div>
          ))}
        </div>

        {/* ---- participants ---- */}
        <h2 className="print-strong mt-10 mb-3 text-lg font-semibold">Participants</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["Familiarity", countBy("familiarity").map(([v, n]) => [familiarityShort(v), n] as [string, number])],
            ["Device", countBy("device")],
            ["Age", countBy("age_range")],
            ["Tech comfort", countBy("tech_comfort")],
            ["UX / project background", countBy("involvement")],
          ].map(([label, rows]) => (
            <div
              key={label as string}
              className="print-card rounded-xl border border-[#2B2F38] bg-[#1D2027] p-4"
            >
              <div className="print-muted mb-2 text-xs uppercase tracking-wide text-[#9AA1AD]">
                {label as string}
              </div>
              {(rows as [string, number][]).map(([v, n]) => (
                <div key={v} className="flex justify-between gap-2 py-0.5 text-sm">
                  <span className="print-muted truncate text-[#EDEFF3]">{v}</span>
                  <span className="print-muted text-[#9AA1AD]">{n}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* ---- hardest tasks callout ---- */}
        {hardest.length > 0 && (
          <>
            <h2 className="print-strong mt-10 mb-3 text-lg font-semibold">
              Hardest tasks (by average ease)
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {hardest.map((s) => (
                <div
                  key={s.task.id}
                  className="print-card rounded-xl border border-[#8a6d1f] bg-[#1D2027] p-4"
                >
                  <div className="print-strong text-sm font-semibold">{s.task.prompt}</div>
                  <div className="print-muted mt-1 text-sm text-[#9AA1AD]">
                    ease {s.avgEase!.toFixed(1)}/7 · {s.gaveUp} gave up ·{" "}
                    {fmtSecs(s.medTime)} median
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ---- per-task table ---- */}
        <h2 className="print-strong mt-10 mb-3 text-lg font-semibold">Task results</h2>
        <div className="print-card overflow-x-auto rounded-xl border border-[#2B2F38]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="print-muted bg-[#1D2027] text-left text-[#9AA1AD]">
                {["#", "Task", "N", "Claimed success", "Gave up", "Verified ✓/✗", "Avg ease", "Median time"].map(
                  (h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2.5 font-medium">
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {usability.map((s, i) => (
                <tr key={s.task.id} className="border-t border-[#2B2F38]">
                  <td className="print-muted px-3 py-2.5 text-[#7C6FF0]">{i + 1}</td>
                  <td className="print-strong px-3 py-2.5 font-medium">{s.task.prompt}</td>
                  <td className="px-3 py-2.5">{s.n}</td>
                  <td className="px-3 py-2.5">
                    {s.claimed}/{s.n} ({pctFmt(s.claimed, s.n)})
                  </td>
                  <td className="px-3 py-2.5">{s.gaveUp || "—"}</td>
                  <td className="px-3 py-2.5">
                    {s.verifiedS + s.verifiedF === 0
                      ? "unreviewed"
                      : `${s.verifiedS} ✓ / ${s.verifiedF} ✗`}
                  </td>
                  <td
                    className={`px-3 py-2.5 ${
                      s.avgEase !== null && s.avgEase <= 4 ? "text-[#E8C468]" : ""
                    }`}
                  >
                    {s.avgEase === null ? "—" : `${s.avgEase.toFixed(1)}/7`}
                  </td>
                  <td className="px-3 py-2.5">{fmtSecs(s.medTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ---- per-task detail ---- */}
        <h2 className="print-strong mt-10 mb-3 text-lg font-semibold">Task details & quotes</h2>
        <div className="flex flex-col gap-4">
          {taskStats.map((s, i) =>
            s.task.type === "usability_task" ? (
              <div
                key={s.task.id}
                className="print-card rounded-xl border border-[#2B2F38] bg-[#1D2027] p-4"
              >
                <div className="print-strong font-semibold">
                  <span className="mr-1.5 text-[#7C6FF0]">{i + 1}.</span>
                  {s.task.prompt}
                </div>
                {s.task.description && (
                  <p className="print-muted mt-1 text-sm text-[#9AA1AD]">{s.task.description}</p>
                )}
                {s.task.options?.success_criteria && (
                  <p className="print-muted mt-2 text-xs text-[#9AA1AD]">
                    <span className="font-semibold">Success criteria:</span>{" "}
                    {s.task.options.success_criteria}
                  </p>
                )}
                {s.extras.length > 0 && (
                  <div className="mt-3">
                    <div className="print-muted text-xs font-semibold uppercase tracking-wide text-[#9AA1AD]">
                      Answers
                    </div>
                    {s.extras.map((q, j) => (
                      <p key={j} className="print-muted mt-1 border-l-2 border-[#2B2F38] pl-3 text-sm text-[#EDEFF3]">
                        “{q}”
                      </p>
                    ))}
                  </div>
                )}
                {s.confirms.length > 0 && (
                  <div className="mt-3">
                    <div className="print-muted text-xs font-semibold uppercase tracking-wide text-[#9AA1AD]">
                      {s.task.options?.confirm?.label}
                    </div>
                    <p className="print-muted mt-1 text-sm text-[#EDEFF3]">{s.confirms.join(" · ")}</p>
                  </div>
                )}
                {s.quotes.length > 0 && (
                  <div className="mt-3">
                    <div className="print-muted text-xs font-semibold uppercase tracking-wide text-[#9AA1AD]">
                      What got in the way
                    </div>
                    {s.quotes.map((q, j) => (
                      <p key={j} className="print-muted mt-1 border-l-2 border-[#8a6d1f] pl-3 text-sm text-[#EDEFF3]">
                        “{q.text}”
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ) : s.openAnswers.length > 0 ? (
              <div
                key={s.task.id}
                className="print-card rounded-xl border border-[#2B2F38] bg-[#1D2027] p-4"
              >
                <div className="print-strong font-semibold">{s.task.prompt}</div>
                {s.openAnswers.map((a, j) => (
                  <p key={j} className="print-muted mt-2 border-l-2 border-[#2B2F38] pl-3 text-sm text-[#EDEFF3]">
                    “{a}”
                  </p>
                ))}
              </div>
            ) : null
          )}
        </div>

        <p className="print-muted mt-10 text-xs leading-relaxed text-[#9AA1AD]">
          Method: unmoderated remote usability test run with Melong. Success is
          participant-reported (“claimed”) unless marked verified by a
          researcher after reviewing the session recording. Ease is
          self-reported on a 1–7 scale (1 = very difficult, 7 = very easy).
          Time on task is measured from task shown to the participant&apos;s
          final self-report.
        </p>
      </div>
    </main>
  );
}

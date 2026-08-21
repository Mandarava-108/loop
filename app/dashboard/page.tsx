import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import CopyLinkButton from "./copy-link-button";
import LocalTime from "./local-time";
import SignOutButton from "./sign-out-button";
import TestRowActions from "./test-row-actions";

type TestRow = {
  id: string;
  title: string;
  site_url: string;
  created_at: string;
  tasks: { count: number }[];
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: tests } = await supabase
    .from("tests")
    .select("id, title, site_url, created_at, tasks(count)")
    .order("created_at", { ascending: false })
    .returns<TestRow[]>();

  return (
    <main className="flex-1 bg-[#14161B] text-[#EDEFF3]">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <header className="mb-10 flex items-center gap-2.5">
          <span
            aria-hidden
            className="h-[18px] w-[18px] -rotate-45 rounded-full border-[3px] border-[#7C6FF0] border-r-transparent"
          />
          <span className="text-lg font-semibold tracking-tight">Kora</span>
          <div className="ml-auto flex items-center gap-4 text-sm text-[#9AA1AD]">
            <span className="hidden sm:inline">{user?.email}</span>
            <SignOutButton />
          </div>
        </header>

        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Your tests</h1>
          <Link
            href="/dashboard/new"
            className="rounded-[10px] bg-[#7C6FF0] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            New test
          </Link>
        </div>

        {!tests || tests.length === 0 ? (
          <div className="rounded-xl border border-[#2B2F38] bg-[#1D2027] px-6 py-12 text-center">
            <p className="mb-1 font-medium">No tests yet</p>
            <p className="text-sm text-[#9AA1AD]">
              Create your first test and share the link with participants.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {tests.map((t) => (
              <li
                key={t.id}
                className="rounded-xl border border-[#2B2F38] bg-[#1D2027] p-4"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/dashboard/${t.id}`}
                      className="font-semibold hover:text-[#7C6FF0]"
                    >
                      {t.title}
                    </Link>
                    <p className="mt-0.5 truncate text-sm text-[#9AA1AD]">
                      {t.site_url} · {t.tasks[0]?.count ?? 0} task
                      {(t.tasks[0]?.count ?? 0) === 1 ? "" : "s"} ·{" "}
                      <LocalTime iso={t.created_at} dateOnly />
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <CopyLinkButton testId={t.id} />
                    <Link
                      href={`/dashboard/${t.id}/responses`}
                      className="rounded-[9px] border border-[#2B2F38] px-3 py-2 text-sm text-[#9AA1AD] transition hover:border-[#7C6FF0] hover:text-[#EDEFF3]"
                    >
                      Responses
                    </Link>
                    <Link
                      href={`/dashboard/${t.id}`}
                      className="rounded-[9px] border border-[#2B2F38] px-3 py-2 text-sm text-[#9AA1AD] transition hover:border-[#7C6FF0] hover:text-[#EDEFF3]"
                    >
                      Edit
                    </Link>
                    <TestRowActions testId={t.id} title={t.title} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

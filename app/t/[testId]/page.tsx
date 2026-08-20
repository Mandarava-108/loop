import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Runner, { type RunnerTask, type RunnerTest } from "./runner";

export default async function TestRunnerPage({
  params,
}: PageProps<"/t/[testId]">) {
  const { testId } = await params;
  const supabase = await createClient();

  const { data: test } = await supabase
    .from("tests")
    .select("id, title, site_url, config")
    .eq("id", testId)
    .single<RunnerTest>();
  if (!test) notFound();

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, sort_order, type, prompt, description, options")
    .eq("test_id", testId)
    .order("sort_order")
    .returns<RunnerTask[]>();

  // Feature-flagged tasks (options.flag) run only when the test's config
  // enables them; participants see no trace of skipped ones.
  const config = (test.config ?? {}) as Record<string, unknown>;
  const visible = (tasks ?? []).filter((t) => {
    const flag = t.options?.flag;
    return !flag || config[flag] === true;
  });
  if (visible.length === 0) notFound();

  return <Runner test={test} tasks={visible} />;
}

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
    .select("id, title, site_url")
    .eq("id", testId)
    .single<RunnerTest>();
  if (!test) notFound();

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, sort_order, type, prompt, description")
    .eq("test_id", testId)
    .order("sort_order")
    .returns<RunnerTask[]>();
  if (!tasks || tasks.length === 0) notFound();

  return <Runner test={test} tasks={tasks} />;
}

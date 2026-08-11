import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TestForm, { type EditorTask, type EditorTest } from "../test-form";

export default async function EditTestPage({
  params,
}: PageProps<"/dashboard/[testId]">) {
  const { testId } = await params;
  const supabase = await createClient();

  // RLS: only the owner can read their test here — anyone else gets a 404.
  const { data: test } = await supabase
    .from("tests")
    .select("id, title, site_url")
    .eq("id", testId)
    .single<EditorTest>();
  if (!test) notFound();

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, type, prompt, description")
    .eq("test_id", testId)
    .order("sort_order");

  const initialTasks: EditorTask[] = (tasks ?? []).map((t) => ({
    id: t.id,
    key: t.id,
    type: t.type,
    prompt: t.prompt,
    description: t.description ?? "",
  }));

  return <TestForm test={test} initialTasks={initialTasks} />;
}

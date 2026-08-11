"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type EditorTask = {
  id?: string; // present for tasks already in the database
  key: string; // stable client-side key
  type: "instruction" | "rating" | "open_text";
  prompt: string;
  description: string;
};

export type EditorTest = {
  id: string;
  title: string;
  site_url: string;
};

const TYPE_LABELS: Record<EditorTask["type"], string> = {
  instruction: "Instruction",
  rating: "Rating (1–5)",
  open_text: "Open text",
};

let nextKey = 0;
function newTask(): EditorTask {
  return {
    key: `new-${nextKey++}`,
    type: "instruction",
    prompt: "",
    description: "",
  };
}

const inputCls =
  "w-full rounded-[10px] border border-[#2B2F38] bg-[#14161B] px-3 py-2.5 text-[0.9rem] text-[#EDEFF3] outline-none focus:border-transparent focus:outline-2 focus:outline-[#7C6FF0]";

export default function TestForm({
  test,
  initialTasks,
}: {
  test: EditorTest | null;
  initialTasks: EditorTask[];
}) {
  const router = useRouter();
  const isNew = test === null;

  const [title, setTitle] = useState(test?.title ?? "");
  const [siteUrl, setSiteUrl] = useState(test?.site_url ?? "");
  const [tasks, setTasks] = useState<EditorTask[]>(
    initialTasks.length > 0 ? initialTasks : [newTask()]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateTask(key: string, patch: Partial<EditorTask>) {
    setTasks((ts) => ts.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  }

  function moveTask(index: number, dir: -1 | 1) {
    setTasks((ts) => {
      const next = [...ts];
      const j = index + dir;
      if (j < 0 || j >= next.length) return ts;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  function removeTask(key: string) {
    setTasks((ts) => ts.filter((t) => t.key !== key));
  }

  async function save() {
    setError(null);

    if (!title.trim()) return setError("Give the test a title.");
    let url = siteUrl.trim();
    if (!url) return setError("Enter the URL of the site to test.");
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    if (tasks.length === 0) return setError("Add at least one task.");
    if (tasks.some((t) => !t.prompt.trim()))
      return setError("Every task needs a prompt.");

    setSaving(true);
    const supabase = createClient();

    try {
      let testId = test?.id;

      if (isNew) {
        const { data, error } = await supabase
          .from("tests")
          .insert({ title: title.trim(), site_url: url })
          .select("id")
          .single();
        if (error) throw error;
        testId = data.id;
      } else {
        const { error } = await supabase
          .from("tests")
          .update({ title: title.trim(), site_url: url })
          .eq("id", testId!);
        if (error) throw error;

        const keptIds = tasks.filter((t) => t.id).map((t) => t.id!);
        const removedIds = initialTasks
          .filter((t) => t.id && !keptIds.includes(t.id))
          .map((t) => t.id!);
        if (removedIds.length > 0) {
          const { error } = await supabase
            .from("tasks")
            .delete()
            .in("id", removedIds);
          if (error) throw error;
        }
      }

      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        const row = {
          test_id: testId!,
          sort_order: i + 1,
          type: t.type,
          prompt: t.prompt.trim(),
          description: t.description.trim() || null,
        };
        const { error } = t.id
          ? await supabase.from("tasks").update(row).eq("id", t.id)
          : await supabase.from("tasks").insert(row);
        if (error) throw error;
      }

      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setSaving(false);
      setError(e instanceof Error ? e.message : "Something went wrong saving.");
    }
  }

  return (
    <main className="flex-1 bg-[#14161B] text-[#EDEFF3]">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <header className="mb-8 flex items-center gap-3 text-sm text-[#9AA1AD]">
          <Link href="/dashboard" className="hover:text-[#EDEFF3]">
            ← Back to tests
          </Link>
        </header>

        <h1 className="mb-8 text-xl font-semibold">
          {isNew ? "New test" : "Edit test"}
        </h1>

        <div className="flex flex-col gap-5">
          <label className="flex flex-col gap-1.5 text-sm text-[#9AA1AD]">
            Test title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Checkout flow — first impressions"
              className={inputCls}
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm text-[#9AA1AD]">
            Site URL to test
            <input
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              placeholder="https://your-site.com"
              inputMode="url"
              className={inputCls}
            />
          </label>
        </div>

        <h2 className="mt-10 mb-4 text-base font-semibold">
          Tasks{" "}
          <span className="ml-1 text-sm font-normal text-[#9AA1AD]">
            shown to participants in this order
          </span>
        </h2>

        <ul className="flex flex-col gap-4">
          {tasks.map((t, i) => (
            <li
              key={t.key}
              className="rounded-xl border border-[#2B2F38] bg-[#1D2027] p-4"
            >
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-md bg-[rgba(124,111,240,.16)] px-2 py-0.5 text-xs font-bold tracking-wide text-[#7C6FF0]">
                  {i + 1}
                </span>
                <select
                  value={t.type}
                  onChange={(e) =>
                    updateTask(t.key, {
                      type: e.target.value as EditorTask["type"],
                    })
                  }
                  className="rounded-[9px] border border-[#2B2F38] bg-[#14161B] px-2 py-1.5 text-sm text-[#EDEFF3] outline-none focus:outline-2 focus:outline-[#7C6FF0]"
                >
                  {(
                    Object.keys(TYPE_LABELS) as Array<EditorTask["type"]>
                  ).map((type) => (
                    <option key={type} value={type}>
                      {TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
                <div className="ml-auto flex items-center gap-1 text-[#9AA1AD]">
                  <button
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() => moveTask(i, -1)}
                    className="rounded-md px-2 py-1 hover:text-[#EDEFF3] disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    aria-label="Move down"
                    disabled={i === tasks.length - 1}
                    onClick={() => moveTask(i, 1)}
                    className="rounded-md px-2 py-1 hover:text-[#EDEFF3] disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    aria-label="Remove task"
                    onClick={() => removeTask(t.key)}
                    className="rounded-md px-2 py-1 hover:text-[#F0605A]"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <input
                value={t.prompt}
                onChange={(e) => updateTask(t.key, { prompt: e.target.value })}
                placeholder={
                  t.type === "instruction"
                    ? "e.g. Find a product you would buy"
                    : t.type === "rating"
                      ? "e.g. How easy was that?"
                      : "e.g. What would you change?"
                }
                className={`${inputCls} mb-2 font-medium`}
              />
              <textarea
                value={t.description}
                onChange={(e) =>
                  updateTask(t.key, { description: e.target.value })
                }
                placeholder="Optional description shown under the prompt"
                rows={2}
                className={`${inputCls} resize-y`}
              />
            </li>
          ))}
        </ul>

        <button
          onClick={() => setTasks((ts) => [...ts, newTask()])}
          className="mt-4 rounded-[10px] border border-dashed border-[#2B2F38] px-4 py-2.5 text-sm text-[#9AA1AD] transition hover:border-[#7C6FF0] hover:text-[#EDEFF3]"
        >
          + Add task
        </button>

        {error && (
          <p role="alert" className="mt-6 text-sm text-[#F0605A]">
            {error}
          </p>
        )}

        <div className="mt-8 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-[11px] bg-[#7C6FF0] px-6 py-3 text-[0.92rem] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {saving ? "Saving…" : isNew ? "Create test" : "Save changes"}
          </button>
          <Link href="/dashboard" className="text-sm text-[#9AA1AD] hover:text-[#EDEFF3]">
            Cancel
          </Link>
        </div>
      </div>
    </main>
  );
}

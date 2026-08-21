"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-[#14161B] px-4 text-[#EDEFF3]">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="" width={20} height={20} />
          <span className="text-lg font-semibold tracking-tight text-[#7C6FF0]">Melong</span>
        </div>

        <h1 className="mb-1 text-xl font-semibold">Researcher sign in</h1>
        <p className="mb-6 text-sm text-[#9AA1AD]">
          Participants don&apos;t need an account — just share a test link.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm text-[#9AA1AD]">
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-[10px] border border-[#2B2F38] bg-[#1D2027] px-3 text-[0.95rem] text-[#EDEFF3] outline-none focus:border-transparent focus:outline-2 focus:outline-[#7C6FF0]"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-[#9AA1AD]">
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 rounded-[10px] border border-[#2B2F38] bg-[#1D2027] px-3 text-[0.95rem] text-[#EDEFF3] outline-none focus:border-transparent focus:outline-2 focus:outline-[#7C6FF0]"
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-[#F0605A]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-2 h-[46px] rounded-[11px] bg-[#7C6FF0] text-[0.92rem] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}

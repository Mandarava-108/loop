export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-[#14161B] text-[#EDEFF3]">
      <div
        aria-hidden
        className="h-10 w-10 -rotate-45 rounded-full border-[5px] border-[#7C6FF0] border-r-transparent"
      />
      <h1 className="text-3xl font-semibold tracking-tight">Loop</h1>
      <p className="text-sm text-[#9AA1AD]">
        Same-window usability testing.
      </p>
      <a
        href="/login"
        className="mt-2 rounded-[10px] bg-[#7C6FF0] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
      >
        Researcher sign in
      </a>
    </main>
  );
}

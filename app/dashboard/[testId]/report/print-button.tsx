"use client";

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-[10px] bg-[#7C6FF0] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 print:hidden"
    >
      Print / save as PDF
    </button>
  );
}

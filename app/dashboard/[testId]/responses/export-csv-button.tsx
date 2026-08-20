"use client";

function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export default function ExportCsvButton({
  filename,
  header,
  rows,
}: {
  filename: string;
  header: string[];
  rows: string[][];
}) {
  function download() {
    const lines = [header, ...rows].map((r) => r.map(csvField).join(","));
    const blob = new Blob(["﻿" + lines.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={download}
      className="rounded-[10px] bg-[#7C6FF0] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
    >
      Export CSV
    </button>
  );
}

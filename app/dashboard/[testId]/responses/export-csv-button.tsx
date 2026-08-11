"use client";

import type { SessionRow } from "./page";

function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export default function ExportCsvButton({
  filename,
  tasks,
  rows,
}: {
  filename: string;
  tasks: string[];
  rows: SessionRow[];
}) {
  function download() {
    const header = [
      "session_id",
      "session_started_at",
      ...tasks.flatMap((t) => [t, `${t} (seconds)`]),
    ];
    const lines = [header.map(csvField).join(",")];

    for (const s of rows) {
      const cells = [
        s.sessionId,
        s.startedAt,
        ...s.cells.flatMap((c) => [
          c.answer ?? "",
          c.seconds === null ? "" : String(c.seconds),
        ]),
      ];
      lines.push(cells.map(csvField).join(","));
    }

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

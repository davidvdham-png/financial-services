"use client";

import { useRef, useState } from "react";

interface Props {
  onFiles: (files: File[]) => void;
  busy: boolean;
}

export default function UploadZone({ onFiles, busy }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Teller i.p.v. boolean: dragenter/leave vuren ook op kind-elementen, een teller
  // voorkomt het knipperen van de highlight tijdens het slepen.
  const [dragDepth, setDragDepth] = useState(0);
  const dragging = dragDepth > 0;

  function handleFiles(list: FileList | null) {
    if (!list) return;
    const files = Array.from(list).filter((f) =>
      /\.(pdf|xml)$/i.test(f.name) || f.type === "application/pdf" || f.type.includes("xml"),
    );
    if (files.length) onFiles(files);
  }

  function open() {
    inputRef.current?.click();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload PDF- of XML-facturen: sleep bestanden hierheen of activeer om te bladeren"
      aria-busy={busy}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragDepth((d) => d + 1);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => setDragDepth((d) => Math.max(0, d - 1))}
      onDrop={(e) => {
        e.preventDefault();
        setDragDepth(0);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
        dragging ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-white hover:border-slate-400"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.xml,application/pdf,text/xml,application/xml"
        multiple
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="text-3xl" aria-hidden="true">📄</div>
      <p className="text-sm font-medium text-slate-700">
        {busy ? "Bezig met herkennen…" : "Sleep PDF- of XML-facturen hierheen"}
      </p>
      <p className="text-xs text-slate-400">of klik om te bladeren — meerdere bestanden tegelijk</p>
    </div>
  );
}

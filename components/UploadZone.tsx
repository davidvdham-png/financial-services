"use client";

import { useRef, useState } from "react";

interface Props {
  onFiles: (files: File[]) => void;
  busy: boolean;
}

export default function UploadZone({ onFiles, busy }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleFiles(list: FileList | null) {
    if (!list) return;
    const files = Array.from(list).filter((f) =>
      /\.(pdf|xml)$/i.test(f.name) || f.type === "application/pdf" || f.type.includes("xml"),
    );
    if (files.length) onFiles(files);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition ${
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
      <div className="text-3xl">📄</div>
      <p className="text-sm font-medium text-slate-700">
        {busy ? "Bezig met herkennen…" : "Sleep PDF- of XML-facturen hierheen"}
      </p>
      <p className="text-xs text-slate-400">of klik om te bladeren — meerdere bestanden tegelijk</p>
    </div>
  );
}

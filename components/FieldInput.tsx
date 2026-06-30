"use client";

import { Field, FieldSource } from "@/lib/types";

const SOURCE_LABEL: Record<FieldSource, string> = {
  xml: "XML",
  regex: "auto",
  llm: "AI",
  manual: "handmatig",
  none: "—",
};

function confidenceColor(source: FieldSource, confidence: number): string {
  if (source === "manual") return "border-blue-400 bg-blue-50";
  if (source === "none" || !confidence) return "border-amber-400 bg-amber-50";
  if (confidence >= 0.85) return "border-emerald-300 bg-emerald-50";
  if (confidence >= 0.6) return "border-slate-300 bg-white";
  return "border-amber-400 bg-amber-50";
}

interface Props {
  label: string;
  field: Field<string> | Field<number>;
  type?: "text" | "number" | "date";
  onChange: (value: string) => void;
  invalid?: boolean;
}

export default function FieldInput({ label, field, type = "text", onChange, invalid }: Props) {
  const value = String(field.value ?? "");

  // Bedragvelden: tekstinvoer met decimaal-toetsenbord zodat NL-notatie ("1.234,56")
  // niet door de browser wordt geweigerd; parseAmount normaliseert bij opslaan.
  // Datumvelden: alleen een echte date-picker als de waarde al ISO is — anders zou
  // een niet-ISO waarde leeg lijken; val dan terug op tekst. (M6)
  const isoOk = value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value);
  const inputType = type === "number" ? "text" : type === "date" ? (isoOk ? "date" : "text") : "text";
  const inputMode = type === "number" ? "decimal" : undefined;

  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="flex items-center justify-between text-xs font-medium text-slate-500">
        <span>{label}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
          {SOURCE_LABEL[field.source]}
          {field.source !== "none" && field.source !== "manual" && field.confidence
            ? ` ${Math.round(field.confidence * 100)}%`
            : ""}
        </span>
      </span>
      <input
        type={inputType}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`rounded-md border px-2.5 py-1.5 text-sm outline-none transition focus:ring-2 focus:ring-blue-200 ${
          invalid ? "border-red-400 bg-red-50" : confidenceColor(field.source, field.confidence)
        }`}
      />
    </label>
  );
}

"use client";

import { Invoice } from "@/lib/types";

interface Props {
  invoices: Invoice[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  issuesById: Record<string, number>;
}

const STATUS_DOT: Record<Invoice["status"], string> = {
  ok: "bg-emerald-500",
  partial: "bg-amber-500",
  error: "bg-red-500",
};

function formatMoney(v: number | null, currency: string | null): string {
  if (v == null) return "—";
  return `${currency || "EUR"} ${v.toFixed(2)}`;
}

export default function InvoiceList({ invoices, selectedId, onSelect, issuesById }: Props) {
  if (invoices.length === 0) {
    return <p className="px-4 py-6 text-sm text-slate-400">Nog geen facturen geüpload.</p>;
  }
  return (
    <ul className="divide-y divide-slate-100">
      {invoices.map((inv) => {
        const issues = issuesById[inv.id] ?? 0;
        return (
          <li key={inv.id}>
            <button
              onClick={() => onSelect(inv.id)}
              className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition hover:bg-slate-50 ${
                selectedId === inv.id ? "bg-blue-50" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[inv.status]}`} />
                <span className="truncate text-sm font-medium text-slate-800">{inv.fileName}</span>
                <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
                  {inv.fileType}
                </span>
              </div>
              <div className="flex items-center justify-between pl-4 text-xs text-slate-500">
                <span className="truncate">{inv.supplier.name.value || "Onbekende leverancier"}</span>
                <span className="font-medium text-slate-700">
                  {formatMoney(inv.totalGross.value, inv.currency.value)}
                </span>
              </div>
              {issues > 0 && (
                <span className="pl-4 text-[11px] text-amber-600">⚠ {issues} aandachtspunt(en)</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

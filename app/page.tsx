"use client";

import { useEffect, useMemo, useState } from "react";
import { Invoice } from "@/lib/types";
import { validateInvoice } from "@/lib/validate";
import { exportCsv } from "@/lib/export/csv";
import { exportJson } from "@/lib/export/json";
import { download } from "@/lib/download";
import UploadZone from "@/components/UploadZone";
import InvoiceList from "@/components/InvoiceList";
import InvoiceDetail from "@/components/InvoiceDetail";

export default function Home() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claudeEnabled, setClaudeEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/extract")
      .then((r) => r.json())
      .then((d) => setClaudeEnabled(Boolean(d.claudeEnabled)))
      .catch(() => {});
  }, []);

  async function handleFiles(files: File[]) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      const res = await fetch("/api/extract", { method: "POST", body: form });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Verwerken mislukt");
      }
      const data = await res.json();
      const incoming: Invoice[] = Array.isArray(data.invoices) ? data.invoices : [];
      setClaudeEnabled(Boolean(data.claudeEnabled));
      setInvoices((prev) => [...prev, ...incoming]);
      if (incoming.length) setSelectedId((cur) => cur ?? incoming[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setBusy(false);
    }
  }

  function updateInvoice(next: Invoice) {
    setInvoices((prev) => prev.map((i) => (i.id === next.id ? next : i)));
  }

  function clearAll() {
    setInvoices([]);
    setSelectedId(null);
  }

  const selected = invoices.find((i) => i.id === selectedId) ?? null;

  const issuesById = useMemo(() => {
    const map: Record<string, number> = {};
    for (const inv of invoices) map[inv.id] = validateInvoice(inv).length;
    return map;
  }, [invoices]);

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Inkoopfactuur Scanner</h1>
          <p className="text-sm text-slate-500">
            Upload PDF of XML — velden worden automatisch herkend, controleer en exporteer.
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            claudeEnabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
          }`}
          title={claudeEnabled ? "Claude-herkenning actief" : "Lokale herkenning (zet ANTHROPIC_API_KEY voor AI-laag)"}
        >
          {claudeEnabled ? "AI-herkenning aan" : "Lokale herkenning"}
        </span>
      </header>

      <UploadZone onFiles={handleFiles} busy={busy} />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {invoices.length > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
          {/* Lijst */}
          <aside className="flex flex-col rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
              <span className="text-sm font-semibold text-slate-700">{invoices.length} factuur(en)</span>
              <div className="flex gap-2">
                <button
                  onClick={() => download("facturen.csv", exportCsv(invoices), "text/csv")}
                  className="text-xs text-blue-600 hover:underline"
                >
                  CSV
                </button>
                <button
                  onClick={() => download("facturen.json", exportJson(invoices), "application/json")}
                  className="text-xs text-blue-600 hover:underline"
                >
                  JSON
                </button>
                <button onClick={clearAll} className="text-xs text-slate-400 hover:text-red-600">
                  Wissen
                </button>
              </div>
            </div>
            <InvoiceList
              invoices={invoices}
              selectedId={selectedId}
              onSelect={setSelectedId}
              issuesById={issuesById}
            />
          </aside>

          {/* Detail */}
          <main className="rounded-xl border border-slate-200 bg-white p-5">
            {selected ? (
              <InvoiceDetail invoice={selected} onChange={updateInvoice} />
            ) : (
              <p className="text-sm text-slate-400">Selecteer een factuur om de details te bekijken.</p>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

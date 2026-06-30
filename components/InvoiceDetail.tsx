"use client";

import { Invoice, Party, field } from "@/lib/types";
import { validateInvoice } from "@/lib/validate";
import { parseAmount } from "@/lib/util";
import { exportUbl } from "@/lib/export/ubl";
import { exportJson } from "@/lib/export/json";
import { exportCsv } from "@/lib/export/csv";
import { download } from "@/lib/download";
import FieldInput from "./FieldInput";

interface Props {
  invoice: Invoice;
  onChange: (next: Invoice) => void;
}

export default function InvoiceDetail({ invoice, onChange }: Props) {
  const issues = validateInvoice(invoice);
  const invalidFields = new Set(issues.filter((i) => i.severity === "error").map((i) => i.field));

  function clone(): Invoice {
    return structuredClone(invoice);
  }

  function setHeader(key: keyof Invoice, raw: string, numeric = false) {
    const next = clone();
    const value = numeric ? parseAmount(raw) : raw || null;
    // @ts-expect-error — dynamische toewijzing van een Field op de header.
    next[key] = field(value as never, 1, "manual");
    onChange(next);
  }

  function setParty(party: "supplier" | "customer", key: keyof Party, raw: string) {
    const next = clone();
    next[party][key] = field(raw || null, 1, "manual");
    onChange(next);
  }

  function setLine(idx: number, key: string, raw: string, numeric: boolean) {
    const next = clone();
    const line = next.lines[idx] as unknown as Record<string, unknown>;
    line[key] = numeric ? parseAmount(raw) : raw;
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Kop */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">{invoice.fileName}</h2>
          <p className="text-xs text-slate-400">
            Formaat: {invoice.detectedFormat}
            {invoice.error ? ` — ${invoice.error}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => download(`${baseName(invoice)}.ubl.xml`, exportUbl(invoice), "application/xml")}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Export UBL
          </button>
          <button
            onClick={() => download(`${baseName(invoice)}.json`, exportJson([invoice]), "application/json")}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            JSON
          </button>
          <button
            onClick={() => download(`${baseName(invoice)}.csv`, exportCsv([invoice]), "text/csv")}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            CSV
          </button>
        </div>
      </header>

      {issues.length > 0 && (
        <ul className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {issues.map((i, n) => (
            <li key={n}>
              <span aria-hidden="true">{i.severity === "error" ? "⛔" : "⚠"}</span> {i.message}
            </li>
          ))}
        </ul>
      )}

      {/* Factuurgegevens */}
      <Section title="Factuurgegevens">
        <FieldInput label="Factuurnummer" field={invoice.invoiceNumber} onChange={(v) => setHeader("invoiceNumber", v)} invalid={invalidFields.has("invoiceNumber")} />
        <FieldInput label="Factuurdatum" type="date" field={invoice.invoiceDate} onChange={(v) => setHeader("invoiceDate", v)} invalid={invalidFields.has("invoiceDate")} />
        <FieldInput label="Vervaldatum" type="date" field={invoice.dueDate} onChange={(v) => setHeader("dueDate", v)} />
        <FieldInput label="Ordernummer" field={invoice.poNumber} onChange={(v) => setHeader("poNumber", v)} />
        <FieldInput label="Valuta" field={invoice.currency} onChange={(v) => setHeader("currency", v)} />
        <FieldInput label="Betalingskenmerk" field={invoice.paymentReference} onChange={(v) => setHeader("paymentReference", v)} />
      </Section>

      {/* Leverancier */}
      <Section title="Leverancier">
        <FieldInput label="Naam" field={invoice.supplier.name} onChange={(v) => setParty("supplier", "name", v)} />
        <FieldInput label="Adres" field={invoice.supplier.address} onChange={(v) => setParty("supplier", "address", v)} />
        <FieldInput label="BTW-nummer" field={invoice.supplier.vatNumber} onChange={(v) => setParty("supplier", "vatNumber", v)} invalid={invalidFields.has("supplier.vatNumber")} />
        <FieldInput label="KvK" field={invoice.supplier.kvk} onChange={(v) => setParty("supplier", "kvk", v)} />
        <FieldInput label="IBAN" field={invoice.supplier.iban} onChange={(v) => setParty("supplier", "iban", v)} invalid={invalidFields.has("supplier.iban")} />
      </Section>

      {/* Regels */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Regels ({invoice.lines.length})</h3>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2">Omschrijving</th>
                <th className="px-3 py-2 w-20">Aantal</th>
                <th className="px-3 py-2 w-24">Stukprijs</th>
                <th className="px-3 py-2 w-20">BTW%</th>
                <th className="px-3 py-2 w-24">Totaal</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-xs text-slate-400">
                    Geen regels herkend.
                  </td>
                </tr>
              )}
              {invoice.lines.map((l, idx) => (
                <tr key={idx} className="border-t border-slate-100">
                  <td className="px-3 py-1.5">
                    <input className="w-full rounded border border-transparent px-1 py-0.5 hover:border-slate-200 focus:border-blue-300 focus:outline-none" value={l.description} onChange={(e) => setLine(idx, "description", e.target.value, false)} />
                  </td>
                  <Cell value={l.quantity} onChange={(v) => setLine(idx, "quantity", v, true)} />
                  <Cell value={l.unitPrice} onChange={(v) => setLine(idx, "unitPrice", v, true)} />
                  <Cell value={l.vatRate} onChange={(v) => setLine(idx, "vatRate", v, true)} />
                  <Cell value={l.lineTotal} onChange={(v) => setLine(idx, "lineTotal", v, true)} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Totalen */}
      <Section title="Totalen">
        <FieldInput label="Subtotaal" type="number" field={invoice.subtotal} onChange={(v) => setHeader("subtotal", v, true)} />
        <FieldInput label="BTW" type="number" field={invoice.totalVat} onChange={(v) => setHeader("totalVat", v, true)} />
        <FieldInput label="Totaal (incl.)" type="number" field={invoice.totalGross} onChange={(v) => setHeader("totalGross", v, true)} invalid={invalidFields.has("totalGross")} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{title}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

function Cell({ value, onChange }: { value: number | null; onChange: (v: string) => void }) {
  return (
    <td className="px-3 py-1.5">
      <input
        className="w-full rounded border border-transparent px-1 py-0.5 text-right hover:border-slate-200 focus:border-blue-300 focus:outline-none"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </td>
  );
}

function baseName(inv: Invoice): string {
  return (inv.invoiceNumber.value || inv.fileName.replace(/\.[^.]+$/, "") || "factuur").replace(/[^A-Za-z0-9_-]/g, "_");
}

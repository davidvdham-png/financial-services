// CSV-export: één rij per factuur (header-niveau). Geschikt voor import in boekhouding/Excel.

import { Invoice } from "../types";

const COLUMNS: { key: string; label: string; get: (i: Invoice) => string | number | null }[] = [
  { key: "fileName", label: "Bestand", get: (i) => i.fileName },
  { key: "invoiceNumber", label: "Factuurnummer", get: (i) => i.invoiceNumber.value },
  { key: "invoiceDate", label: "Factuurdatum", get: (i) => i.invoiceDate.value },
  { key: "dueDate", label: "Vervaldatum", get: (i) => i.dueDate.value },
  { key: "supplierName", label: "Leverancier", get: (i) => i.supplier.name.value },
  { key: "supplierVat", label: "BTW-nummer", get: (i) => i.supplier.vatNumber.value },
  { key: "supplierIban", label: "IBAN", get: (i) => i.supplier.iban.value },
  { key: "poNumber", label: "Ordernummer", get: (i) => i.poNumber.value },
  { key: "currency", label: "Valuta", get: (i) => i.currency.value },
  { key: "subtotal", label: "Subtotaal", get: (i) => i.subtotal.value },
  { key: "totalVat", label: "BTW", get: (i) => i.totalVat.value },
  { key: "totalGross", label: "Totaal", get: (i) => i.totalGross.value },
];

function escape(v: string | number | null): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(invoices: Invoice[]): string {
  const header = COLUMNS.map((c) => c.label).join(";");
  const rows = invoices.map((inv) => COLUMNS.map((c) => escape(c.get(inv))).join(";"));
  return [header, ...rows].join("\r\n");
}

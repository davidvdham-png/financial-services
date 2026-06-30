// Vereenvoudigde JSON-export: platte waarden zonder confidence/source-omhulsel.

import { Invoice, Party } from "../types";

function flatParty(p: Party) {
  return {
    name: p.name.value,
    address: p.address.value,
    vatNumber: p.vatNumber.value,
    kvk: p.kvk.value,
    iban: p.iban.value,
  };
}

export function invoiceToPlain(inv: Invoice) {
  return {
    fileName: inv.fileName,
    fileType: inv.fileType,
    detectedFormat: inv.detectedFormat,
    invoiceNumber: inv.invoiceNumber.value,
    invoiceDate: inv.invoiceDate.value,
    dueDate: inv.dueDate.value,
    poNumber: inv.poNumber.value,
    currency: inv.currency.value,
    paymentReference: inv.paymentReference.value,
    supplier: flatParty(inv.supplier),
    customer: flatParty(inv.customer),
    lines: inv.lines,
    subtotal: inv.subtotal.value,
    totalVat: inv.totalVat.value,
    totalGross: inv.totalGross.value,
    vatBreakdown: inv.vatBreakdown,
  };
}

export function exportJson(invoices: Invoice[]): string {
  return JSON.stringify(invoices.map(invoiceToPlain), null, 2);
}

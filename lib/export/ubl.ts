// Genereer een minimale UBL 2.1 (Peppol/SI-UBL-stijl) factuur uit het schema.
// Bedoeld als koppel-klaar bestand richting boekhoudpakketten.

import { Invoice } from "../types";

function esc(v: string | null | undefined): string {
  if (v == null) return "";
  return String(v)
    // XML 1.0 verbiedt de meeste controlekarakters (behalve tab/LF/CR) — strip ze
    // zodat de export altijd welgevormd blijft.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function num(v: number | null): string {
  return v == null ? "0.00" : v.toFixed(2);
}

export function exportUbl(inv: Invoice): string {
  const cur = esc(inv.currency.value || "EUR");
  const lines = inv.lines
    .map((l, idx) => {
      const qty = l.quantity ?? 1;
      const amt = l.lineTotal ?? (l.unitPrice ?? 0) * qty;
      return `  <cac:InvoiceLine>
    <cbc:ID>${idx + 1}</cbc:ID>
    <cbc:InvoicedQuantity>${qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${cur}">${num(amt)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${esc(l.description)}</cbc:Name>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${cur}">${num(l.unitPrice)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017</cbc:CustomizationID>
  <cbc:ID>${esc(inv.invoiceNumber.value)}</cbc:ID>
  <cbc:IssueDate>${esc(inv.invoiceDate.value)}</cbc:IssueDate>
  ${inv.dueDate.value ? `<cbc:DueDate>${esc(inv.dueDate.value)}</cbc:DueDate>` : ""}
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>
  ${inv.poNumber.value ? `<cac:OrderReference><cbc:ID>${esc(inv.poNumber.value)}</cbc:ID></cac:OrderReference>` : ""}
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${esc(inv.supplier.name.value)}</cbc:Name></cac:PartyName>
      ${inv.supplier.vatNumber.value ? `<cac:PartyTaxScheme><cbc:CompanyID>${esc(inv.supplier.vatNumber.value)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ""}
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${esc(inv.customer.name.value)}</cbc:Name></cac:PartyName>
    </cac:Party>
  </cac:AccountingCustomerParty>
  ${inv.supplier.iban.value ? `<cac:PaymentMeans><cbc:PaymentMeansCode>58</cbc:PaymentMeansCode><cac:PayeeFinancialAccount><cbc:ID>${esc(inv.supplier.iban.value)}</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>` : ""}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${cur}">${num(inv.totalVat.value)}</cbc:TaxAmount>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="${cur}">${num(inv.subtotal.value)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${cur}">${num(inv.totalGross.value)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${cur}">${num(inv.totalGross.value)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</Invoice>`;
}

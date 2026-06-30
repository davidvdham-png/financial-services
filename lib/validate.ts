// Validatieregels voor een herkende factuur. Levert waarschuwingen op voor de UI.

import { Invoice } from "./types";
import { isValidIban } from "./util";

export interface ValidationIssue {
  field: string;
  message: string;
  severity: "warning" | "error";
}

export function validateInvoice(inv: Invoice): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Verplichte kernvelden
  if (!inv.invoiceNumber.value)
    issues.push({ field: "invoiceNumber", message: "Geen factuurnummer herkend", severity: "warning" });
  if (!inv.invoiceDate.value)
    issues.push({ field: "invoiceDate", message: "Geen factuurdatum herkend", severity: "warning" });
  if (inv.totalGross.value == null)
    issues.push({ field: "totalGross", message: "Geen totaalbedrag herkend", severity: "warning" });

  // Totaalcontrole: subtotaal + BTW ≈ totaal
  const sub = inv.subtotal.value;
  const vat = inv.totalVat.value;
  const gross = inv.totalGross.value;
  if (sub != null && vat != null && gross != null) {
    if (Math.abs(sub + vat - gross) > 0.02) {
      issues.push({
        field: "totalGross",
        message: `Subtotaal (${sub.toFixed(2)}) + BTW (${vat.toFixed(2)}) ≠ totaal (${gross.toFixed(2)})`,
        severity: "error",
      });
    }
  }

  // IBAN-checksum
  if (inv.supplier.iban.value && !isValidIban(inv.supplier.iban.value)) {
    issues.push({ field: "supplier.iban", message: "IBAN-checksum klopt niet", severity: "error" });
  }

  // NL BTW-formaat (best-effort)
  const vatNr = inv.supplier.vatNumber.value?.replace(/\s+/g, "");
  if (vatNr && /^NL/i.test(vatNr) && !/^NL\d{9}B\d{2}$/i.test(vatNr)) {
    issues.push({ field: "supplier.vatNumber", message: "BTW-nummer lijkt geen geldig NL-formaat", severity: "warning" });
  }

  return issues;
}

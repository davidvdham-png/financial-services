// XML-extractie: herkent UBL/Peppol en CII (ZUGFeRD/Factur-X) expliciet,
// met een generieke best-effort fallback voor onbekende XML-formaten.

import { XMLParser } from "fast-xml-parser";
import {
  Invoice,
  InvoiceLine,
  VatBreakdownItem,
  emptyInvoice,
  field,
  deriveStatus,
} from "../types";
import { parseAmount, normalizeDate } from "../util";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

/** Pak een waarde uit een UBL-knoop die ofwel tekst is, ofwel {#text, @_...}. */
function text(node: unknown): string | null {
  if (node == null) return null;
  if (typeof node === "string") return node.trim() || null;
  if (typeof node === "number") return String(node);
  if (typeof node === "object") {
    const t = (node as Record<string, unknown>)["#text"];
    if (t != null) return String(t).trim() || null;
  }
  return null;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Lees een attribuut (bv. currencyID) van een UBL-knoop. */
function attr(node: unknown, name: string): string | null {
  if (node && typeof node === "object") {
    const v = (node as Record<string, unknown>)["@_" + name];
    return v == null ? null : String(v);
  }
  return null;
}

export function extractXml(xmlString: string, base: Partial<Invoice>): Invoice {
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xmlString) as Record<string, unknown>;
  } catch {
    return emptyInvoice({
      ...base,
      status: "error",
      error: "Kon XML niet parsen",
      detectedFormat: "generic-xml",
      rawText: xmlString,
    });
  }

  if (parsed.Invoice || parsed.CreditNote) {
    return mapUbl((parsed.Invoice ?? parsed.CreditNote) as Record<string, unknown>, base, xmlString);
  }
  if (parsed.CrossIndustryInvoice) {
    return mapCii(parsed.CrossIndustryInvoice as Record<string, unknown>, base, xmlString);
  }
  return mapGeneric(parsed, base, xmlString);
}

// ---- UBL / Peppol -------------------------------------------------------

function mapUbl(
  inv: Record<string, unknown>,
  base: Partial<Invoice>,
  raw: string,
): Invoice {
  const out = emptyInvoice({ ...base, detectedFormat: "ubl", status: "ok", rawText: raw });
  const C = 0.98;
  // Pad-getter die ook door arrays heen leest (eerste element van een herhaalde knoop).
  const get = (path: string): unknown =>
    path.split(".").reduce<unknown>((acc, key) => {
      const node = Array.isArray(acc) ? acc[0] : acc;
      if (node && typeof node === "object") return (node as Record<string, unknown>)[key];
      return undefined;
    }, inv);

  out.invoiceNumber = field(text(inv.ID), C, "xml");
  out.invoiceDate = field(normalizeDate(text(inv.IssueDate)), C, "xml");
  out.dueDate = field(normalizeDate(text(inv.DueDate)), C, "xml");
  out.currency = field(text(inv.DocumentCurrencyCode), C, "xml");
  out.poNumber = field(text(get("OrderReference.ID")), C, "xml");

  // Partijen
  const supplier = get("AccountingSupplierParty.Party") as Record<string, unknown> | undefined;
  const customer = get("AccountingCustomerParty.Party") as Record<string, unknown> | undefined;
  fillUblParty(out.supplier, supplier, C);
  fillUblParty(out.customer, customer, C);

  // PaymentMeans kan herhaald voorkomen (UBL); doorloop alle voor IBAN + kenmerk. (M4)
  for (const pm of asArray(inv.PaymentMeans)) {
    const means = pm as Record<string, unknown>;
    if (!out.paymentReference.value) {
      const pid = text(means.PaymentID);
      if (pid) out.paymentReference = field(pid, C, "xml");
    }
    if (!out.supplier.iban.value) {
      const acc = means.PayeeFinancialAccount as Record<string, unknown> | undefined;
      const iban = text(acc?.ID);
      if (iban) out.supplier.iban = field(iban, C, "xml");
    }
  }

  // Regels
  const lines = asArray(inv.InvoiceLine ?? inv.CreditNoteLine);
  out.lines = lines.map((l): InvoiceLine => {
    const line = l as Record<string, unknown>;
    const item = line.Item as Record<string, unknown> | undefined;
    const price = line.Price as Record<string, unknown> | undefined;
    const taxCat = item?.ClassifiedTaxCategory as Record<string, unknown> | undefined;
    return {
      description: text(item?.Name) ?? text(item?.Description) ?? "",
      quantity: parseAmount(text(line.InvoicedQuantity ?? line.CreditedQuantity)),
      unitPrice: parseAmount(text(price?.PriceAmount)),
      vatRate: parseAmount(text(taxCat?.Percent)),
      lineTotal: parseAmount(text(line.LineExtensionAmount)),
    };
  });

  // Totalen
  const totals = inv.LegalMonetaryTotal as Record<string, unknown> | undefined;
  out.subtotal = field(parseAmount(text(totals?.TaxExclusiveAmount)), C, "xml");
  out.totalGross = field(
    parseAmount(text(totals?.TaxInclusiveAmount ?? totals?.PayableAmount)),
    C,
    "xml",
  );

  // BTW — UBL staat een tweede TaxTotal in de tax-accounting-valuta toe; die mag
  // niet meetellen. Som alleen de TaxTotal in de documentvaluta. (M3)
  const docCurrency = text(inv.DocumentCurrencyCode);
  const taxTotals = asArray(inv.TaxTotal);
  let totalVat: number | null = null;
  const breakdown: VatBreakdownItem[] = [];
  for (const tt of taxTotals) {
    const t = tt as Record<string, unknown>;
    const taxCur = attr(t.TaxAmount, "currencyID");
    if (docCurrency && taxCur && taxCur !== docCurrency) continue;
    const amt = parseAmount(text(t.TaxAmount));
    if (amt != null) totalVat = (totalVat ?? 0) + amt;
    for (const sub of asArray(t.TaxSubtotal)) {
      const s = sub as Record<string, unknown>;
      const cat = s.TaxCategory as Record<string, unknown> | undefined;
      breakdown.push({
        rate: parseAmount(text(cat?.Percent)),
        base: parseAmount(text(s.TaxableAmount)),
        amount: parseAmount(text(s.TaxAmount)),
      });
    }
  }
  out.totalVat = field(totalVat, C, "xml");
  out.vatBreakdown = breakdown;

  out.status = deriveStatus(out); // M2
  return out;
}

function fillUblParty(
  target: Invoice["supplier"],
  party: Record<string, unknown> | undefined,
  C: number,
) {
  if (!party) return;
  const legal = party.PartyLegalEntity as Record<string, unknown> | undefined;
  const partyName = party.PartyName as Record<string, unknown> | undefined;
  target.name = field(
    text(legal?.RegistrationName) ?? text(partyName?.Name),
    C,
    "xml",
  );

  const addr = party.PostalAddress as Record<string, unknown> | undefined;
  if (addr) {
    const parts = [
      text(addr.StreetName),
      text(addr.BuildingNumber),
      text(addr.PostalZone),
      text(addr.CityName),
      text((addr.Country as Record<string, unknown>)?.IdentificationCode),
    ].filter(Boolean);
    target.address = field(parts.join(", ") || null, C, "xml");
  }

  const taxScheme = party.PartyTaxScheme as Record<string, unknown> | undefined;
  target.vatNumber = field(text(taxScheme?.CompanyID), C, "xml");
  target.kvk = field(text(legal?.CompanyID), C, "xml");
}

// ---- CII (ZUGFeRD / Factur-X) ------------------------------------------

function mapCii(
  root: Record<string, unknown>,
  base: Partial<Invoice>,
  raw: string,
): Invoice {
  // CII is diep genest; we doen een gerichte best-effort en vullen aan met generiek.
  const out = mapGeneric(root, { ...base }, raw);
  out.detectedFormat = "cii";

  const doc = (root.ExchangedDocument ?? {}) as Record<string, unknown>;
  if (text(doc.ID)) out.invoiceNumber = field(text(doc.ID), 0.95, "xml");
  const issue = doc.IssueDateTime as Record<string, unknown> | undefined;
  const issueStr = text(issue?.DateTimeString ?? issue);
  if (issueStr) {
    // CII gebruikt vaak YYYYMMDD.
    const m = issueStr.match(/(\d{4})(\d{2})(\d{2})/);
    out.invoiceDate = field(m ? `${m[1]}-${m[2]}-${m[3]}` : normalizeDate(issueStr), 0.95, "xml");
  }
  out.status = deriveStatus(out); // M2
  return out;
}

// ---- Generieke fallback -------------------------------------------------

interface Leaf {
  path: string;
  key: string;
  value: string;
}

function collectLeaves(node: unknown, path: string, out: Leaf[], depth = 0) {
  if (depth > 30 || out.length > 5000) return;
  if (node == null) return;
  // Arrays zijn ook objecten — eerst testen, anders draait deze tak nooit.
  if (Array.isArray(node)) {
    (node as unknown[]).forEach((v) => collectLeaves(v, path, out, depth + 1));
  } else if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k.startsWith("@_")) {
        if (typeof v === "string") out.push({ path, key: k.slice(2), value: v });
        continue;
      }
      collectLeaves(v, path ? `${path}.${k}` : k, out, depth + 1);
    }
  } else {
    const key = path.split(".").pop() ?? path;
    out.push({ path, key, value: String(node) });
  }
}

function findLeaf(leaves: Leaf[], patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const hit = leaves.find((l) => re.test(l.key) || re.test(l.path));
    if (hit && hit.value.trim()) return hit.value.trim();
  }
  return null;
}

function mapGeneric(
  parsed: Record<string, unknown>,
  base: Partial<Invoice>,
  raw: string,
): Invoice {
  const out = emptyInvoice({
    ...base,
    detectedFormat: base.detectedFormat ?? "generic-xml",
    status: "partial",
    rawText: raw,
  });
  const leaves: Leaf[] = [];
  collectLeaves(parsed, "", leaves);
  const C = 0.6;

  out.invoiceNumber = field(
    findLeaf(leaves, [/invoice.*(id|number|nr|nummer)/i, /factuur.*(nr|nummer)/i, /^id$/i]),
    C,
    "xml",
  );
  const dateStr = findLeaf(leaves, [/issue.*date/i, /invoice.*date/i, /factuurdatum/i, /date$/i]);
  out.invoiceDate = field(normalizeDate(dateStr), C, "xml");
  const dueStr = findLeaf(leaves, [/due.*date/i, /vervaldatum/i, /payment.*due/i]);
  out.dueDate = field(normalizeDate(dueStr), C, "xml");
  out.currency = field(findLeaf(leaves, [/currency/i, /valuta/i]), C, "xml");

  const iban = findLeaf(leaves, [/iban/i, /financialaccount.*id/i]);
  out.supplier.iban = field(iban, C, "xml");
  out.supplier.vatNumber = field(findLeaf(leaves, [/companyid/i, /vat.*(id|number)/i, /btw/i]), C, "xml");
  out.supplier.name = field(findLeaf(leaves, [/registrationname/i, /supplier.*name/i, /seller.*name/i, /party.*name/i]), C, "xml");

  out.totalGross = field(parseAmount(findLeaf(leaves, [/payable.*amount/i, /grand.*total/i, /total.*incl/i, /totaal/i])), C, "xml");
  out.subtotal = field(parseAmount(findLeaf(leaves, [/tax.*excl/i, /net.*total/i, /subtotaal/i])), C, "xml");
  out.totalVat = field(parseAmount(findLeaf(leaves, [/tax.*amount/i, /vat.*amount/i, /btw.*bedrag/i])), C, "xml");

  return out;
}

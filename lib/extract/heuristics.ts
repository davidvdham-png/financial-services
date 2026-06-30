// Regex/heuristische herkenning van velden uit platte PDF-tekst.

import { Invoice, InvoiceLine, emptyInvoice, field, deriveStatus } from "../types";
import { parseAmount, normalizeDate, isValidIban } from "../util";

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

const DATE = "(\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\s+[a-zA-Z]+\\s+\\d{4})";
// Bedrag mét decimalen (komma of punt + 2 cijfers); voorkomt dat een BTW-/IBAN-nummer
// als bedrag wordt herkend.
const MONEY = "(\\d[\\d.,\\s]*[.,]\\d{2})";

export function extractFromText(text: string, base: Partial<Invoice>): Invoice {
  const out = emptyInvoice({
    ...base,
    detectedFormat: base.detectedFormat ?? "pdf-text",
    status: "ok",
    rawText: text,
  });
  const C = 0.55; // heuristieken zijn minder zeker dan XML

  // Factuurnummer
  out.invoiceNumber = field(
    firstMatch(text, [
      /factuu?r(?:nummer|nr)\.?\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-/.]{1,30})/i,
      /invoice\s*(?:number|no|nr)\.?\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-/.]{1,30})/i,
    ]),
    C,
    "regex",
  );

  // Datums
  out.invoiceDate = field(
    normalizeDate(
      firstMatch(text, [
        new RegExp(`factuu?rdatum\\s*[:#]?\\s*${DATE}`, "i"),
        new RegExp(`invoice\\s*date\\s*[:#]?\\s*${DATE}`, "i"),
        new RegExp(`datum\\s*[:#]?\\s*${DATE}`, "i"),
      ]),
    ),
    C,
    "regex",
  );
  out.dueDate = field(
    normalizeDate(
      firstMatch(text, [
        new RegExp(`vervaldatum\\s*[:#]?\\s*${DATE}`, "i"),
        new RegExp(`due\\s*date\\s*[:#]?\\s*${DATE}`, "i"),
        new RegExp(`betalen\\s*(?:voor|binnen)?\\s*[:#]?\\s*${DATE}`, "i"),
      ]),
    ),
    C,
    "regex",
  );

  // PO / referentie
  out.poNumber = field(
    firstMatch(text, [
      /(?:inkooporder|ordernummer|order\s*(?:no|nr|nummer)|po\s*(?:no|nr|number))\.?\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-/.]{1,30})/i,
    ]),
    C,
    "regex",
  );
  out.paymentReference = field(
    firstMatch(text, [/(?:betalingskenmerk|kenmerk|reference)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-/.\s]{2,30})/i]),
    C,
    "regex",
  );

  // Valuta
  const currency = firstMatch(text, [/\b(EUR|USD|GBP)\b/, /(€|\$|£)/]);
  out.currency = field(
    currency === "€" ? "EUR" : currency === "$" ? "USD" : currency === "£" ? "GBP" : currency,
    C,
    "regex",
  );

  // IBAN: verzamel kandidaten en kies bij voorkeur een geldige.
  const ibanCandidates = (
    text.match(/\b[A-Z]{2}\d{2}[ ]?(?:[A-Z0-9]{4}[ ]?){2,7}[A-Z0-9]{1,4}\b/g) ?? []
  ).map((c) => c.replace(/\s+/g, ""));
  const validIban = ibanCandidates.find((c) => isValidIban(c));
  if (validIban) {
    out.supplier.iban = field(validIban, 0.9, "regex");
  } else {
    // Alleen een gelabelde kandidaat als fallback (lagere zekerheid).
    const labeled = firstMatch(text, [/iban\s*[:#]?\s*([A-Z]{2}\d{2}[A-Z0-9 ]{8,30})/i]);
    if (labeled) out.supplier.iban = field(labeled.replace(/\s+/g, ""), 0.4, "regex");
  }

  // BTW-nummer
  out.supplier.vatNumber = field(
    firstMatch(text, [
      /\b(NL\s?\d{9}\s?B\s?\d{2})\b/i,
      /(?:btw|vat)[-\s]*(?:nr|nummer|no|id)?\.?\s*[:#]?\s*([A-Z]{2}[A-Z0-9 ]{6,14})/i,
    ]),
    C,
    "regex",
  );

  // KvK
  out.supplier.kvk = field(
    firstMatch(text, [/(?:kvk|k\.v\.k\.|kamer\s*van\s*koophandel)\.?\s*[:#]?\s*(\d{8})/i]),
    C,
    "regex",
  );

  // Bedragen
  out.totalGross = field(
    parseAmount(
      firstMatch(text, [
        new RegExp(`(?:totaal\\s*(?:incl|te\\s*betalen)|te\\s*betalen|total\\s*(?:amount|incl|due)|grand\\s*total)\\D{0,15}${MONEY}`, "i"),
      ]),
    ),
    C,
    "regex",
  );
  out.subtotal = field(
    parseAmount(
      firstMatch(text, [
        new RegExp(`(?:subtotaal|totaal\\s*excl|net(?:to)?\\s*(?:bedrag|total)|total\\s*excl)\\D{0,15}${MONEY}`, "i"),
      ]),
    ),
    C,
    "regex",
  );
  out.totalVat = field(
    parseAmount(
      firstMatch(text, [
        // Negatieve lookahead: sla "BTW-nummer/nr/id" over.
        new RegExp(`(?:btw|vat|tax)(?![-\\s]*(?:nummer|nr|no|id))(?:\\s*\\d{1,2}\\s*%?)?\\D{0,15}${MONEY}`, "i"),
      ]),
    ),
    C,
    "regex",
  );

  // Leveranciersnaam: eerste niet-lege regel als heuristiek.
  const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 2);
  if (firstLine) out.supplier.name = field(firstLine, 0.35, "regex");

  // Eenvoudige regelherkenning: regels met omschrijving + bedrag(en).
  out.lines = extractLines(text);

  // Status pas hier bepalen: "ok" alleen als de kernvelden herkend zijn. (M2)
  out.status = deriveStatus(out);
  return out;
}

function extractLines(text: string): InvoiceLine[] {
  const lines: InvoiceLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length < 4) continue;
    // Regel met een omschrijving gevolgd door 1-3 bedragen aan het eind.
    const m = line.match(/^(.+?)\s+((?:\d+[.,]?\d*\s*){1,4})$/);
    if (!m) continue;
    const desc = m[1].trim();
    if (/totaal|subtotaal|btw|vat|te betalen|iban|factuur|kvk|ordernummer|datum|kenmerk|telefoon|tel\.|postbus/i.test(desc)) continue;
    const nums = m[2].trim().split(/\s+/).map((n) => parseAmount(n)).filter((n): n is number => n != null);
    if (nums.length === 0) continue;
    lines.push({
      description: desc,
      quantity: nums.length >= 3 ? nums[0] : null,
      unitPrice: nums.length >= 2 ? nums[nums.length - 2] : null,
      vatRate: null,
      lineTotal: nums[nums.length - 1] ?? null,
    });
    if (lines.length >= 50) break;
  }
  return lines;
}

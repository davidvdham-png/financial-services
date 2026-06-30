// Genormaliseerd factuurschema + hulptypes voor de hele app.

export type FieldSource = "xml" | "regex" | "llm" | "manual" | "none";

/** Eén herkend veld met herkomst en betrouwbaarheid (0-1). */
export interface Field<T = string> {
  value: T | null;
  confidence: number;
  source: FieldSource;
}

export interface Party {
  name: Field;
  address: Field;
  vatNumber: Field;
  kvk: Field;
  iban: Field;
}

export interface InvoiceLine {
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  vatRate: number | null;
  lineTotal: number | null;
}

export interface VatBreakdownItem {
  rate: number | null;
  base: number | null;
  amount: number | null;
}

export type InvoiceStatus = "ok" | "partial" | "error";

export interface Invoice {
  id: string;
  fileName: string;
  fileType: "pdf" | "xml" | "unknown";
  /** ubl | cii | generic-xml | pdf-text | facturx */
  detectedFormat: string;
  status: InvoiceStatus;
  error?: string;

  supplier: Party;
  customer: Party;

  invoiceNumber: Field;
  invoiceDate: Field;
  dueDate: Field;
  poNumber: Field;
  currency: Field;
  paymentReference: Field;

  lines: InvoiceLine[];

  subtotal: Field<number>;
  totalVat: Field<number>;
  totalGross: Field<number>;
  vatBreakdown: VatBreakdownItem[];

  /** Ruwe tekst (PDF) of XML — handig voor debug/Claude-laag. */
  rawText?: string;
}

// ---- Helpers ------------------------------------------------------------

export function field<T>(
  value: T | null,
  confidence = 0,
  source: FieldSource = "none",
): Field<T> {
  // Een leeg veld heeft geen herkomst of betrouwbaarheid.
  if (value == null || value === "") return { value: null, confidence: 0, source: "none" };
  return { value, confidence, source };
}

/**
 * Leid de status af van of de kernvelden (factuurnummer, -datum, totaalbedrag)
 * herkend zijn. Voorkomt dat een lege extractie als "ok" wordt gemarkeerd.
 */
export function deriveStatus(inv: Invoice): InvoiceStatus {
  const core = [inv.invoiceNumber.value, inv.invoiceDate.value, inv.totalGross.value];
  return core.every((v) => v != null) ? "ok" : "partial";
}

export function emptyParty(): Party {
  return {
    name: field<string>(null),
    address: field<string>(null),
    vatNumber: field<string>(null),
    kvk: field<string>(null),
    iban: field<string>(null),
  };
}

export function emptyInvoice(partial: Partial<Invoice> = {}): Invoice {
  return {
    id: partial.id ?? "",
    fileName: partial.fileName ?? "",
    fileType: partial.fileType ?? "unknown",
    detectedFormat: partial.detectedFormat ?? "unknown",
    status: partial.status ?? "partial",
    supplier: emptyParty(),
    customer: emptyParty(),
    invoiceNumber: field<string>(null),
    invoiceDate: field<string>(null),
    dueDate: field<string>(null),
    poNumber: field<string>(null),
    currency: field<string>(null),
    paymentReference: field<string>(null),
    lines: [],
    subtotal: field<number>(null),
    totalVat: field<number>(null),
    totalGross: field<number>(null),
    vatBreakdown: [],
    ...partial,
  };
}

// Realistische voorbeeldfacturen voor de design-gallery — zodat elke variant
// volledig interactief is zonder de extractie-API. Gebruikt het echte Invoice-schema.

import { Invoice, Party, InvoiceLine, VatBreakdownItem, emptyInvoice, field } from "./types";

interface Seed {
  id: string;
  fileName: string;
  fileType: "pdf" | "xml";
  detectedFormat: string;
  status: Invoice["status"];
  error?: string;
  number: string | null;
  date: string | null;
  due: string | null;
  po?: string | null;
  paymentRef?: string | null;
  currency: string;
  supplier: { name: string | null; address?: string; vat?: string; kvk?: string; iban?: string };
  lines: InvoiceLine[];
  subtotal: number | null;
  vat: number | null;
  gross: number | null;
  vatBreakdown?: VatBreakdownItem[];
}

function party(s: Seed["supplier"], src: "xml" | "regex" | "llm" = "xml"): Party {
  return {
    name: field<string>(s.name ?? null, 0.95, src),
    address: field<string>(s.address ?? null, 0.9, src),
    vatNumber: field<string>(s.vat ?? null, 0.92, src),
    kvk: field<string>(s.kvk ?? null, 0.9, src),
    iban: field<string>(s.iban ?? null, 0.95, src),
  };
}

function build(s: Seed): Invoice {
  const src = s.fileType === "xml" ? ("xml" as const) : ("regex" as const);
  const conf = s.fileType === "xml" ? 0.97 : 0.6;
  const inv = emptyInvoice({
    id: s.id,
    fileName: s.fileName,
    fileType: s.fileType,
    detectedFormat: s.detectedFormat,
    status: s.status,
    error: s.error,
  });
  inv.supplier = party(s.supplier, src);
  inv.invoiceNumber = field(s.number, conf, src);
  inv.invoiceDate = field(s.date, conf, src);
  inv.dueDate = field(s.due, conf, src);
  inv.poNumber = field(s.po ?? null, conf, src);
  inv.currency = field(s.currency, conf, src);
  inv.paymentReference = field(s.paymentRef ?? null, conf, src);
  inv.lines = s.lines;
  inv.subtotal = field(s.subtotal, conf, src);
  inv.totalVat = field(s.vat, conf, src);
  inv.totalGross = field(s.gross, conf, src);
  inv.vatBreakdown = s.vatBreakdown ?? [];
  return inv;
}

const SEEDS: Seed[] = [
  {
    id: "inv_demo_1", fileName: "jansen-2024-00187.xml", fileType: "xml", detectedFormat: "ubl",
    status: "ok", number: "2024-00187", date: "2026-06-14", due: "2026-07-14",
    po: "PO-55812", paymentRef: "0187", currency: "EUR",
    supplier: { name: "Koninklijke Jansen B.V.", address: "Industrieweg 12, 3542 AD Utrecht, NL", vat: "NL001234567B01", kvk: "30112233", iban: "NL91ABNA0417164300" },
    lines: [
      { description: "Stalen profielen 40x40 (per meter)", quantity: 120, unitPrice: 1.85, vatRate: 21, lineTotal: 222 },
      { description: "Montagebeugels RVS", quantity: 48, unitPrice: 2.4, vatRate: 21, lineTotal: 115.2 },
      { description: "Arbeidsuren installatie", quantity: 6, unitPrice: 65, vatRate: 21, lineTotal: 390 },
    ],
    subtotal: 727.2, vat: 152.71, gross: 879.91,
    vatBreakdown: [{ rate: 21, base: 727.2, amount: 152.71 }],
  },
  {
    id: "inv_demo_2", fileName: "devries-logistiek.pdf", fileType: "pdf", detectedFormat: "pdf-text",
    status: "partial", number: "FV-2026-3391", date: null, due: "2026-07-02", currency: "EUR",
    supplier: { name: "De Vries Logistiek", address: "Havenstraat 88, 3071 AB Rotterdam, NL", vat: "NL008765432B01", iban: "NL68RABO0123456789" },
    lines: [
      { description: "Transport pallets (rit Rotterdam–Venlo)", quantity: 3, unitPrice: 145, vatRate: 21, lineTotal: 435 },
      { description: "Wachturen", quantity: 1.5, unitPrice: 55, vatRate: 21, lineTotal: 82.5 },
    ],
    subtotal: 517.5, vat: 108.68, gross: 626.18,
    vatBreakdown: [{ rate: 21, base: 517.5, amount: 108.68 }],
  },
  {
    id: "inv_demo_3", fileName: "technoserve-q2.xml", fileType: "xml", detectedFormat: "cii",
    status: "ok", number: "TS-9921", date: "2026-06-09", due: "2026-06-23",
    paymentRef: "9921TS", currency: "EUR",
    supplier: { name: "TechnoServe B.V.", address: "Kennispark 4, 7522 NB Enschede, NL", vat: "NL812345678B01", kvk: "08123456", iban: "NL20INGB0001234567" },
    lines: [
      { description: "SaaS-licentie Pro (per gebruiker/mnd)", quantity: 25, unitPrice: 18, vatRate: 21, lineTotal: 450 },
      { description: "Onboarding & configuratie", quantity: 1, unitPrice: 850, vatRate: 21, lineTotal: 850 },
      { description: "Support-uren (9% laag tarief)", quantity: 4, unitPrice: 95, vatRate: 9, lineTotal: 380 },
    ],
    subtotal: 1680, vat: 307.2, gross: 1987.2,
    vatBreakdown: [
      { rate: 21, base: 1300, amount: 273 },
      { rate: 9, base: 380, amount: 34.2 },
    ],
  },
  {
    id: "inv_demo_4", fileName: "bakker-scan.pdf", fileType: "pdf", detectedFormat: "pdf-text",
    status: "error", error: "Geen tekstlaag gevonden (mogelijk gescande PDF)",
    number: null, date: null, due: null, currency: "EUR",
    supplier: { name: null },
    lines: [], subtotal: null, vat: null, gross: null,
  },
  {
    id: "inv_demo_5", fileName: "groen-energie.xml", fileType: "xml", detectedFormat: "ubl",
    status: "ok", number: "GE-2026-0442", date: "2026-06-01", due: "2026-06-15",
    po: "INKOOP-2210", currency: "EUR",
    supplier: { name: "Groen Energie N.V.", address: "Zonneveld 1, 8011 AA Zwolle, NL", vat: "NL009988776B01", kvk: "05099887", iban: "NL44TRIO0391122334" },
    lines: [
      { description: "Levering elektriciteit (kWh)", quantity: 4200, unitPrice: 0.24, vatRate: 21, lineTotal: 1008 },
      { description: "Vaste leveringskosten", quantity: 1, unitPrice: 6.95, vatRate: 21, lineTotal: 6.95 },
    ],
    subtotal: 1014.95, vat: 213.14, gross: 1228.09,
    vatBreakdown: [{ rate: 21, base: 1014.95, amount: 213.14 }],
  },
];

/** Verse kopie van de demo-facturen (zodat bewerken in een variant los staat). */
export function getMockInvoices(): Invoice[] {
  return SEEDS.map(build);
}

export const DESIGN_VARIANTS = [
  { slug: "helder", name: "Helder", tagline: "Strakke Swiss-SaaS, licht & precies" },
  { slug: "cockpit", name: "Cockpit", tagline: "Donker data-terminal met KPI's" },
  { slug: "ledger", name: "Ledger", tagline: "Warm-editorial, rustig & toegankelijk" },
  { slug: "raster", name: "Raster", tagline: "Compacte power-user grid voor boekhouders" },
] as const;

// Optionele Claude-herkenningslaag. No-op zonder ANTHROPIC_API_KEY.
// Met key: stuurt de PDF-tekst naar Claude en krijgt gestructureerde velden terug,
// die de heuristiek-resultaten verrijken/overschrijven (hoogste confidence wint).

import { Invoice, field } from "../types";
import { parseAmount, normalizeDate } from "../util";

export function isClaudeEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const TOOL = {
  name: "factuur_velden",
  description: "Geef de herkende velden van de inkoopfactuur terug.",
  input_schema: {
    type: "object" as const,
    properties: {
      invoiceNumber: { type: "string" },
      invoiceDate: { type: "string", description: "ISO datum YYYY-MM-DD" },
      dueDate: { type: "string", description: "ISO datum YYYY-MM-DD" },
      poNumber: { type: "string" },
      currency: { type: "string", description: "ISO valutacode, bv. EUR" },
      paymentReference: { type: "string" },
      supplierName: { type: "string" },
      supplierVatNumber: { type: "string" },
      supplierKvk: { type: "string" },
      supplierIban: { type: "string" },
      supplierAddress: { type: "string" },
      subtotal: { type: "number" },
      totalVat: { type: "number" },
      totalGross: { type: "number" },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            quantity: { type: "number" },
            unitPrice: { type: "number" },
            vatRate: { type: "number" },
            lineTotal: { type: "number" },
          },
        },
      },
    },
  },
};

/** Verrijk een (heuristisch herkende) factuur met Claude. Faalt stil terug op de input. */
export async function enrichWithClaude(inv: Invoice): Promise<Invoice> {
  if (!isClaudeEnabled() || !inv.rawText) return inv;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

    const msg = await client.messages.create({
      model,
      max_tokens: 2048,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [
        {
          role: "user",
          content:
            "Hieronder staat de tekst van een inkoopfactuur. Haal de velden er zo nauwkeurig mogelijk uit en " +
            "roep de tool aan. Laat een veld weg als je het niet betrouwbaar kunt bepalen.\n\n---\n" +
            inv.rawText.slice(0, 24000),
        },
      ],
    });

    const block = msg.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") return inv;
    const data = block.input as Record<string, unknown>;
    return merge(inv, data);
  } catch {
    return inv; // netwerkfout/geen credits/etc. — val terug op heuristiek
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const LLM_C = 0.85;

function merge(inv: Invoice, d: Record<string, unknown>): Invoice {
  if (str(d.invoiceNumber)) inv.invoiceNumber = field(str(d.invoiceNumber), LLM_C, "llm");
  if (str(d.invoiceDate)) inv.invoiceDate = field(normalizeDate(str(d.invoiceDate)), LLM_C, "llm");
  if (str(d.dueDate)) inv.dueDate = field(normalizeDate(str(d.dueDate)), LLM_C, "llm");
  if (str(d.poNumber)) inv.poNumber = field(str(d.poNumber), LLM_C, "llm");
  if (str(d.currency)) inv.currency = field(str(d.currency), LLM_C, "llm");
  if (str(d.paymentReference)) inv.paymentReference = field(str(d.paymentReference), LLM_C, "llm");

  if (str(d.supplierName)) inv.supplier.name = field(str(d.supplierName), LLM_C, "llm");
  if (str(d.supplierVatNumber)) inv.supplier.vatNumber = field(str(d.supplierVatNumber), LLM_C, "llm");
  if (str(d.supplierKvk)) inv.supplier.kvk = field(str(d.supplierKvk), LLM_C, "llm");
  if (str(d.supplierIban)) inv.supplier.iban = field(str(d.supplierIban), LLM_C, "llm");
  if (str(d.supplierAddress)) inv.supplier.address = field(str(d.supplierAddress), LLM_C, "llm");

  const sub = parseAmount(d.subtotal as number);
  const vat = parseAmount(d.totalVat as number);
  const gross = parseAmount(d.totalGross as number);
  if (sub != null) inv.subtotal = field(sub, LLM_C, "llm");
  if (vat != null) inv.totalVat = field(vat, LLM_C, "llm");
  if (gross != null) inv.totalGross = field(gross, LLM_C, "llm");

  if (Array.isArray(d.lines) && d.lines.length && inv.lines.length === 0) {
    inv.lines = (d.lines as Record<string, unknown>[]).map((l) => ({
      description: str(l.description) ?? "",
      quantity: parseAmount(l.quantity as number),
      unitPrice: parseAmount(l.unitPrice as number),
      vatRate: parseAmount(l.vatRate as number),
      lineTotal: parseAmount(l.lineTotal as number),
    }));
  }

  return inv;
}

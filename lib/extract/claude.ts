// Optionele Claude-herkenningslaag. No-op zonder ANTHROPIC_API_KEY.
// Met key: stuurt de PDF-tekst naar Claude en krijgt gestructureerde velden terug,
// die de heuristiek-resultaten verrijken/overschrijven (hoogste confidence wint).

import { Invoice, Field, field } from "../types";
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
    return mergeClaudeFields(inv, data);
  } catch (e) {
    // netwerkfout/geen credits/verkeerde model-id/etc. — val terug op heuristiek.
    // Loggen zodat een stille mis-configuratie (bv. ongeldige ANTHROPIC_MODEL) zichtbaar is.
    console.error("[claude] verrijking mislukt, val terug op heuristiek:", e);
    return inv;
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const LLM_C = 0.85;

/**
 * Kies tussen de bestaande (heuristiek/XML) waarde en de LLM-waarde: de hoogste
 * confidence wint. Een bestaande waarde met confidence >= de LLM-confidence blijft
 * staan (zodat bv. een mod-97-gevalideerd IBAN op 0.9 niet wordt overschreven). (H3)
 */
function pick<T>(existing: Field<T>, value: T | null): Field<T> {
  const candidate = field(value, LLM_C, "llm");
  if (candidate.value == null) return existing; // LLM gaf niets bruikbaars
  if (existing.value != null && existing.confidence >= LLM_C) return existing;
  return candidate;
}

/** Verrijk een factuur met door Claude herkende velden (hoogste confidence wint). */
export function mergeClaudeFields(inv: Invoice, d: Record<string, unknown>): Invoice {
  inv.invoiceNumber = pick(inv.invoiceNumber, str(d.invoiceNumber));
  inv.invoiceDate = pick(inv.invoiceDate, normalizeDate(str(d.invoiceDate)));
  inv.dueDate = pick(inv.dueDate, normalizeDate(str(d.dueDate)));
  inv.poNumber = pick(inv.poNumber, str(d.poNumber));
  inv.currency = pick(inv.currency, str(d.currency));
  inv.paymentReference = pick(inv.paymentReference, str(d.paymentReference));

  inv.supplier.name = pick(inv.supplier.name, str(d.supplierName));
  inv.supplier.vatNumber = pick(inv.supplier.vatNumber, str(d.supplierVatNumber));
  inv.supplier.kvk = pick(inv.supplier.kvk, str(d.supplierKvk));
  inv.supplier.iban = pick(inv.supplier.iban, str(d.supplierIban));
  inv.supplier.address = pick(inv.supplier.address, str(d.supplierAddress));

  inv.subtotal = pick(inv.subtotal, parseAmount(d.subtotal as number));
  inv.totalVat = pick(inv.totalVat, parseAmount(d.totalVat as number));
  inv.totalGross = pick(inv.totalGross, parseAmount(d.totalGross as number));

  // Regels: neem de LLM-regels over als de heuristiek geen regels vond óf als de
  // heuristische regels zwak zijn (geen enkele met een herkend regeltotaal). (M7)
  const heuristicWeak =
    inv.lines.length === 0 || inv.lines.every((l) => l.lineTotal == null);
  if (Array.isArray(d.lines) && d.lines.length && heuristicWeak) {
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

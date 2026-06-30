import { describe, it, expect } from "vitest";
import { mergeClaudeFields } from "./claude";
import { extractFromText } from "./heuristics";
import { emptyInvoice, field, Invoice } from "../types";

function withRaw(over: Partial<Invoice> = {}): Invoice {
  return emptyInvoice({ id: "1", fileName: "f.pdf", rawText: "x", ...over });
}

describe("mergeClaudeFields — hoogste confidence wint (H3)", () => {
  it("behoudt een hoog-confidence IBAN boven de LLM-waarde", () => {
    const inv = withRaw();
    inv.supplier.iban = field("NL91ABNA0417164300", 0.9, "regex");
    mergeClaudeFields(inv, { supplierIban: "NL00FOUT0000000000" });
    expect(inv.supplier.iban.value).toBe("NL91ABNA0417164300");
    expect(inv.supplier.iban.source).toBe("regex");
  });

  it("overschrijft een laag-confidence veld wél met de LLM-waarde", () => {
    const inv = withRaw();
    inv.supplier.iban = field("NL00LAAG0000000000", 0.4, "regex");
    mergeClaudeFields(inv, { supplierIban: "NL91ABNA0417164300" });
    expect(inv.supplier.iban.value).toBe("NL91ABNA0417164300");
    expect(inv.supplier.iban.source).toBe("llm");
  });

  it("vult een leeg veld vanuit de LLM", () => {
    const inv = withRaw();
    mergeClaudeFields(inv, { invoiceNumber: "F-99" });
    expect(inv.invoiceNumber.value).toBe("F-99");
    expect(inv.invoiceNumber.source).toBe("llm");
  });
});

describe("mergeClaudeFields — regels (M7)", () => {
  it("neemt LLM-regels over als de heuristiek geen regeltotalen vond", () => {
    const inv = withRaw();
    inv.lines = [{ description: "ruis adresregel", quantity: null, unitPrice: null, vatRate: null, lineTotal: null }];
    mergeClaudeFields(inv, { lines: [{ description: "Widget", quantity: 2, unitPrice: 10, lineTotal: 20 }] });
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0].description).toBe("Widget");
    expect(inv.lines[0].lineTotal).toBe(20);
  });

  it("behoudt sterke heuristische regels (met totaal)", () => {
    const inv = withRaw();
    inv.lines = [{ description: "Echt product", quantity: 1, unitPrice: 50, vatRate: null, lineTotal: 50 }];
    mergeClaudeFields(inv, { lines: [{ description: "Iets anders", lineTotal: 99 }] });
    expect(inv.lines[0].description).toBe("Echt product");
  });
});

describe("extractFromText — status (M2)", () => {
  it("markeert lege herkenning als partial, niet ok", () => {
    const inv = extractFromText("hier staat geen enkel factuurveld in", { fileName: "f.pdf" });
    expect(inv.status).toBe("partial");
  });

  it("markeert volledige herkenning als ok", () => {
    const text = "Factuurnummer: F-2024-001\nFactuurdatum: 15-03-2024\nTotaal te betalen: 121,00";
    const inv = extractFromText(text, { fileName: "f.pdf" });
    expect(inv.status).toBe("ok");
  });
});

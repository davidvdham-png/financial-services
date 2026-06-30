import { describe, it, expect } from "vitest";
import { validateInvoice } from "./validate";
import { emptyInvoice, field } from "./types";

function base() {
  return emptyInvoice({ id: "1", fileName: "f.pdf" });
}

describe("validateInvoice", () => {
  it("waarschuwt bij ontbrekende kernvelden", () => {
    const issues = validateInvoice(base());
    const fields = issues.map((i) => i.field);
    expect(fields).toContain("invoiceNumber");
    expect(fields).toContain("invoiceDate");
    expect(fields).toContain("totalGross");
  });

  it("vlagt een totaal dat niet optelt (subtotaal + BTW ≠ totaal)", () => {
    const inv = base();
    inv.subtotal = field(100, 1, "manual");
    inv.totalVat = field(21, 1, "manual");
    inv.totalGross = field(130, 1, "manual"); // moet 121 zijn
    const issue = validateInvoice(inv).find((i) => i.field === "totalGross" && i.severity === "error");
    expect(issue).toBeDefined();
  });

  it("accepteert een totaal binnen de tolerantie (0,02)", () => {
    const inv = base();
    inv.subtotal = field(100, 1, "manual");
    inv.totalVat = field(21, 1, "manual");
    inv.totalGross = field(121.01, 1, "manual");
    const issue = validateInvoice(inv).find((i) => i.field === "totalGross" && i.severity === "error");
    expect(issue).toBeUndefined();
  });

  it("vlagt een ongeldig IBAN", () => {
    const inv = base();
    inv.supplier.iban = field("NL00ABNA0417164300", 1, "manual");
    const issue = validateInvoice(inv).find((i) => i.field === "supplier.iban");
    expect(issue?.severity).toBe("error");
  });

  it("vlagt een niet-NL-vormig BTW-nummer", () => {
    const inv = base();
    inv.supplier.vatNumber = field("NL12345", 1, "manual");
    const issue = validateInvoice(inv).find((i) => i.field === "supplier.vatNumber");
    expect(issue?.severity).toBe("warning");
  });
});

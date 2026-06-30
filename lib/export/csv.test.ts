import { describe, it, expect } from "vitest";
import { exportCsv } from "./csv";
import { emptyInvoice, field } from "../types";

function inv(over: Partial<ReturnType<typeof emptyInvoice>> = {}) {
  return emptyInvoice({ id: "1", fileName: "f.pdf", ...over });
}

describe("exportCsv", () => {
  it("schrijft een header en één rij per factuur met ;-scheiding", () => {
    const csv = exportCsv([inv({ invoiceNumber: field("F-001", 1, "manual") })]);
    const [header, row] = csv.split("\r\n");
    expect(header).toContain("Factuurnummer");
    expect(row).toContain("F-001");
  });

  it("quote velden met scheidingsteken, quote of newline", () => {
    const csv = exportCsv([inv({ supplier: { ...emptyInvoice().supplier, name: field('Acme; "BV"', 1, "manual") } })]);
    expect(csv).toContain('"Acme; ""BV"""');
  });

  // H2: formula-injectie voorkomen
  it("H2: neutraliseert formule-triggers (= + - @) aan begin van een veld", () => {
    const csv = exportCsv([inv({ supplier: { ...emptyInvoice().supplier, name: field("=HYPERLINK(1)", 1, "manual") } })]);
    const row = csv.split("\r\n")[1];
    // Veld mag in Excel niet als formule starten: voorafgegaan door '
    expect(row).toMatch(/'=HYPERLINK\(1\)|"'=HYPERLINK\(1\)"/);
    expect(row).not.toMatch(/(^|;)=HYPERLINK/);
  });

  it("H2: neutraliseert ook + - @ en tab/CR aan begin", () => {
    for (const trigger of ["+1", "-1", "@cmd", "\t1", "\r1"]) {
      const csv = exportCsv([inv({ supplier: { ...emptyInvoice().supplier, name: field(trigger, 1, "manual") } })]);
      const row = csv.split("\r\n")[1];
      expect(row).not.toMatch(new RegExp(`(^|;)\\${trigger[0]}`));
    }
  });

  // Laag: losse \r moet quoten
  it("quote een veld met losse carriage return", () => {
    const csv = exportCsv([inv({ supplier: { ...emptyInvoice().supplier, name: field("regel1\rregel2", 1, "manual") } })]);
    expect(csv).toContain('"');
  });
});

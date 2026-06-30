import { describe, it, expect } from "vitest";
import { extractXml } from "./xml";

const base = { id: "1", fileName: "f.xml", fileType: "xml" as const };

describe("extractXml — UBL", () => {
  const ubl = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
  <ID>F-2024-001</ID>
  <IssueDate>2024-03-15</IssueDate>
  <DocumentCurrencyCode>EUR</DocumentCurrencyCode>
  <AccountingSupplierParty><Party>
    <PartyLegalEntity><RegistrationName>Acme BV</RegistrationName></PartyLegalEntity>
  </Party></AccountingSupplierParty>
  <PaymentMeans><PayeeFinancialAccount><ID>NL91ABNA0417164300</ID></PayeeFinancialAccount></PaymentMeans>
  <TaxTotal><TaxAmount currencyID="EUR">21.00</TaxAmount></TaxTotal>
  <TaxTotal><TaxAmount currencyID="USD">25.00</TaxAmount></TaxTotal>
  <LegalMonetaryTotal>
    <TaxExclusiveAmount currencyID="EUR">100.00</TaxExclusiveAmount>
    <TaxInclusiveAmount currencyID="EUR">121.00</TaxInclusiveAmount>
  </LegalMonetaryTotal>
</Invoice>`;

  it("leest kernvelden", () => {
    const inv = extractXml(ubl, base);
    expect(inv.detectedFormat).toBe("ubl");
    expect(inv.invoiceNumber.value).toBe("F-2024-001");
    expect(inv.invoiceDate.value).toBe("2024-03-15");
    expect(inv.supplier.name.value).toBe("Acme BV");
    expect(inv.supplier.iban.value).toBe("NL91ABNA0417164300");
  });

  // M3: tweede TaxTotal in andere valuta mag niet bij de BTW worden opgeteld
  it("M3: telt alleen de BTW in de documentvaluta", () => {
    const inv = extractXml(ubl, base);
    expect(inv.totalVat.value).toBe(21);
  });

  // M4: IBAN moet ook werken als PaymentMeans een array is
  it("M4: vindt IBAN bij meerdere PaymentMeans", () => {
    const multi = ubl.replace(
      "<PaymentMeans><PayeeFinancialAccount><ID>NL91ABNA0417164300</ID></PayeeFinancialAccount></PaymentMeans>",
      "<PaymentMeans><PaymentMeansCode>30</PaymentMeansCode></PaymentMeans>" +
        "<PaymentMeans><PayeeFinancialAccount><ID>NL91ABNA0417164300</ID></PayeeFinancialAccount></PaymentMeans>",
    );
    const inv = extractXml(multi, base);
    expect(inv.supplier.iban.value).toBe("NL91ABNA0417164300");
  });

  it("valt terug op generic voor niet-factuur-XML", () => {
    const inv = extractXml("<foo><bar>1</bar></foo>", base);
    expect(inv.detectedFormat).toBe("generic-xml");
    expect(inv.status).toBe("partial");
  });
});

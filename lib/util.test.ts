import { describe, it, expect } from "vitest";
import { parseAmount, normalizeDate, isValidIban, makeId } from "./util";

describe("parseAmount", () => {
  it("parst NL-notatie met komma-decimaal", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("1234,5")).toBe(1234.5);
    expect(parseAmount("0,99")).toBe(0.99);
  });

  it("parst EN-notatie met punt-decimaal", () => {
    expect(parseAmount("1,234.56")).toBe(1234.56);
    expect(parseAmount("1234.5")).toBe(1234.5);
  });

  it("negeert valutasymbolen en spaties", () => {
    expect(parseAmount("€ 1.234,56")).toBe(1234.56);
    expect(parseAmount("EUR 50,00")).toBe(50);
  });

  it("herkent haakjes en trailing-minus als negatief", () => {
    expect(parseAmount("(50,00)")).toBe(-50);
    expect(parseAmount("50,00-")).toBe(-50);
  });

  // H1: meerdere punten als duizendtalscheiding mogen niet stil worden afgekapt
  it("H1: parst meerdere punten als duizendtalscheiding", () => {
    expect(parseAmount("1.234.567")).toBe(1234567);
    expect(parseAmount("1.234.567,89")).toBe(1234567.89);
    expect(parseAmount("1.234")).toBe(1234); // punt + exact 3 cijfers = duizendtal
  });

  // M5: minteken na valutasymbool / met spatie moet negatief opleveren
  it("M5: herkent minteken na valutasymbool als negatief", () => {
    expect(parseAmount("€-50,00")).toBe(-50);
    expect(parseAmount("EUR -50")).toBe(-50);
    expect(parseAmount("- 50,00")).toBe(-50);
  });

  it("retourneert null voor lege of niet-numerieke input", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount("geen bedrag")).toBeNull();
  });

  it("laat een getal ongemoeid", () => {
    expect(parseAmount(42.5)).toBe(42.5);
    expect(parseAmount(0)).toBe(0);
  });
});

describe("normalizeDate", () => {
  it("herkent ISO en dd-mm-yyyy", () => {
    expect(normalizeDate("2024-03-15")).toBe("2024-03-15");
    expect(normalizeDate("15-03-2024")).toBe("2024-03-15");
    expect(normalizeDate("15/03/2024")).toBe("2024-03-15");
  });

  it("herkent geschreven NL-maanden", () => {
    expect(normalizeDate("1 januari 2024")).toBe("2024-01-01");
  });

  // Laag: bereikvalidatie maand/dag
  it("weigert ongeldige maand/dag", () => {
    expect(normalizeDate("2024-13-45")).toBeNull();
    expect(normalizeDate("45-13-2024")).toBeNull();
  });

  it("retourneert null voor onherkenbare input", () => {
    expect(normalizeDate("")).toBeNull();
    expect(normalizeDate("ergens ooit")).toBeNull();
  });
});

describe("isValidIban", () => {
  it("accepteert een geldig NL-IBAN", () => {
    expect(isValidIban("NL91ABNA0417164300")).toBe(true);
    expect(isValidIban("NL91 ABNA 0417 1643 00")).toBe(true);
  });

  it("weigert een IBAN met foute checksum", () => {
    expect(isValidIban("NL00ABNA0417164300")).toBe(false);
    expect(isValidIban("onzin")).toBe(false);
    expect(isValidIban(null)).toBe(false);
  });
});

describe("makeId", () => {
  it("is stabiel voor dezelfde seed+index en uniek per index", () => {
    expect(makeId("factuur.pdf", 0)).toBe(makeId("factuur.pdf", 0));
    expect(makeId("factuur.pdf", 0)).not.toBe(makeId("factuur.pdf", 1));
  });
});

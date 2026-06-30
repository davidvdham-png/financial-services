// PDF-extractie: haalt tekst op (unpdf) en zoekt naar ingebedde Factur-X/ZUGFeRD XML.

import { getDocumentProxy } from "unpdf";
import { Invoice, emptyInvoice } from "../types";
import { extractFromText } from "./heuristics";
import { extractXml } from "./xml";

/**
 * Reconstrueer tekst mét regelstructuur uit de tekstposities.
 * pdfjs geeft losse tekstfragmenten met x/y-coördinaten; we groeperen op y-regel
 * en sorteren binnen een regel op x. Dat behoudt de lay-out die heuristieken nodig hebben.
 */
async function extractLayoutText(
  doc: Awaited<ReturnType<typeof getDocumentProxy>>,
): Promise<string> {
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as Array<{ str: string; transform: number[] }>).filter(
      (it) => typeof it.str === "string",
    );

    type Row = { y: number; parts: { x: number; s: string }[] };
    const rows: Row[] = [];
    for (const it of items) {
      const x = it.transform[4];
      const y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) < 3);
      if (!row) {
        row = { y, parts: [] };
        rows.push(row);
      }
      row.parts.push({ x, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    const lines = rows.map((r) =>
      r.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.s)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    );
    pages.push(lines.filter(Boolean).join("\n"));
  }
  return pages.join("\n");
}

/** Probeer ingebedde XML (Factur-X/ZUGFeRD) uit de PDF te halen. */
async function findEmbeddedXml(doc: Awaited<ReturnType<typeof getDocumentProxy>>): Promise<string | null> {
  try {
    const attachments = (await doc.getAttachments()) as Record<
      string,
      { content?: Uint8Array }
    > | null;
    if (!attachments) return null;
    for (const [name, att] of Object.entries(attachments)) {
      if (/\.xml$/i.test(name) && att?.content) {
        const xml = new TextDecoder("utf-8", { fatal: false }).decode(att.content);
        if (xml.includes("<")) return xml;
      }
    }
  } catch {
    // Geen attachments of niet leesbaar — geen probleem.
  }
  return null;
}

export async function extractPdf(bytes: Uint8Array, base: Partial<Invoice>): Promise<Invoice> {
  let doc;
  try {
    doc = await getDocumentProxy(bytes);
  } catch {
    return emptyInvoice({
      ...base,
      fileType: "pdf",
      status: "error",
      error: "Kon PDF niet openen",
      detectedFormat: "pdf-text",
    });
  }

  // 1) Factur-X/ZUGFeRD: ingebedde XML heeft voorrang (exact). Maar als die XML
  //    onparsebaar/leeg blijkt, vallen we alsnog terug op de tekstlaag. (M1)
  const embedded = await findEmbeddedXml(doc);
  if (embedded) {
    const inv = extractXml(embedded, { ...base, fileType: "pdf" });
    if (inv.status !== "error") {
      inv.detectedFormat = "facturx";
      return inv;
    }
  }

  // 2) Tekstlaag uitlezen (met behoud van regelstructuur) en heuristisch herkennen.
  const fullText = await extractLayoutText(doc);

  if (!fullText || fullText.trim().length < 10) {
    return emptyInvoice({
      ...base,
      fileType: "pdf",
      status: "error",
      error: "Geen tekstlaag gevonden (mogelijk gescande PDF — activeer de Claude-laag voor OCR)",
      detectedFormat: "pdf-text",
      rawText: fullText ?? "",
    });
  }

  return extractFromText(fullText, { ...base, fileType: "pdf", detectedFormat: "pdf-text" });
}

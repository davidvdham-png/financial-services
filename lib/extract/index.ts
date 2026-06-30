// Orchestrator: kies de juiste extractor per bestandstype, verrijk optioneel met
// Claude, en bereken validatiestatus.

import { Invoice, emptyInvoice } from "../types";
import { detectKind } from "../detect";
import { makeId } from "../util";
import { extractXml } from "./xml";
import { extractPdf } from "./pdf";
import { enrichWithClaude, isClaudeEnabled } from "./claude";

export interface ExtractInput {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  index: number;
}

export async function extractInvoice(input: ExtractInput): Promise<Invoice> {
  const { fileName, mimeType, bytes, index } = input;
  const id = makeId(fileName + bytes.length, index);
  const kind = detectKind(fileName, mimeType, bytes);
  const base = { id, fileName };

  let invoice: Invoice;
  try {
    if (kind === "xml") {
      const xml = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      invoice = extractXml(xml, { ...base, fileType: "xml" });
    } else if (kind === "pdf") {
      invoice = await extractPdf(bytes, base);
      // Claude-laag alleen voor PDF-tekst (XML is al exact).
      if (isClaudeEnabled() && invoice.detectedFormat === "pdf-text") {
        invoice = await enrichWithClaude(invoice);
      }
    } else {
      invoice = emptyInvoice({
        ...base,
        status: "error",
        error: "Onbekend bestandstype (alleen PDF en XML worden ondersteund)",
      });
    }
  } catch (e) {
    invoice = emptyInvoice({
      ...base,
      status: "error",
      error: e instanceof Error ? e.message : "Onbekende fout bij verwerken",
    });
  }

  return invoice;
}

// API-route: ontvangt geüploade bestanden (multipart) en geeft herkende facturen terug.

import { NextRequest, NextResponse } from "next/server";
import { extractInvoice } from "@/lib/extract";
import { isClaudeEnabled } from "@/lib/extract/claude";
import { emptyInvoice } from "@/lib/types";
import { makeId } from "@/lib/util";

export const runtime = "nodejs";
export const maxDuration = 60;

// Harde grenzen tegen geheugen-/DoS-misbruik op de functie.
const MAX_FILES = 20;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per bestand

/** Accepteer alleen PDF/XML op basis van naam of mime (server-side, niet alleen client). */
function isSupported(file: File): boolean {
  return (
    /\.(pdf|xml)$/i.test(file.name) ||
    file.type === "application/pdf" ||
    file.type.includes("xml")
  );
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Ongeldige upload" }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "Geen bestanden ontvangen" }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `Maximaal ${MAX_FILES} bestanden per keer` },
      { status: 400 },
    );
  }

  // Per bestand geïsoleerd: een geweigerd of mislukt bestand levert een
  // status:"error"-factuur op i.p.v. de hele batch te laten klappen.
  const invoices = await Promise.all(
    files.map(async (file, index) => {
      const asError = (msg: string) =>
        emptyInvoice({
          id: makeId(file.name, index),
          fileName: file.name,
          status: "error",
          error: msg,
        });

      if (!isSupported(file)) {
        return asError("Niet-ondersteund bestandstype (alleen PDF en XML)");
      }
      if (file.size > MAX_BYTES) {
        return asError(`Bestand te groot (max ${MAX_BYTES / 1024 / 1024} MB)`);
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        return await extractInvoice({
          fileName: file.name,
          mimeType: file.type,
          bytes,
          index,
        });
      } catch (e) {
        return asError(e instanceof Error ? e.message : "Kon bestand niet lezen");
      }
    }),
  );

  return NextResponse.json({ invoices, claudeEnabled: isClaudeEnabled() });
}

export async function GET() {
  return NextResponse.json({ claudeEnabled: isClaudeEnabled() });
}

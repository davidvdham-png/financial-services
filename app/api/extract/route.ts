// API-route: ontvangt geüploade bestanden (multipart) en geeft herkende facturen terug.

import { NextRequest, NextResponse } from "next/server";
import { extractInvoice } from "@/lib/extract";
import { isClaudeEnabled } from "@/lib/extract/claude";

export const runtime = "nodejs";
export const maxDuration = 60;

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

  const invoices = await Promise.all(
    files.map(async (file, index) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return extractInvoice({
        fileName: file.name,
        mimeType: file.type,
        bytes,
        index,
      });
    }),
  );

  return NextResponse.json({ invoices, claudeEnabled: isClaudeEnabled() });
}

export async function GET() {
  return NextResponse.json({ claudeEnabled: isClaudeEnabled() });
}

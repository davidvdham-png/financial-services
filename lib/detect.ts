// Bepaal het bestandstype op basis van naam, mime en inhoud.

export type FileKind = "pdf" | "xml" | "unknown";

export function detectKind(
  fileName: string,
  mimeType: string,
  bytes: Uint8Array,
): FileKind {
  const name = fileName.toLowerCase();
  if (name.endsWith(".pdf") || mimeType === "application/pdf") return "pdf";
  if (name.endsWith(".xml") || mimeType.includes("xml")) return "xml";

  // Inhoud sniffen als naam/mime niets oplevert.
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.slice(0, 1024))
    .trimStart();
  if (head.startsWith("%PDF")) return "pdf";
  if (head.startsWith("<?xml") || head.startsWith("<")) return "xml";
  return "unknown";
}

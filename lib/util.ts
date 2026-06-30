// Gedeelde hulpfuncties voor bedrag-, datum- en IBAN-verwerking.

/**
 * Parse een bedrag uit tekst met NL- of EN-notatie.
 * Voorbeelden: "1.234,56" -> 1234.56, "1,234.56" -> 1234.56, "1234,5" -> 1234.5
 */
export function parseAmount(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return isFinite(raw) ? raw : null;

  let s = String(raw).trim();
  if (!s) return null;

  // Negatief: haakjes, een minteken vóór het eerste cijfer (ook na valutasymbool/spatie),
  // of een trailing minteken. (M5)
  const negative = /\(/.test(s) || /-\s*[\d.,]/.test(s) || /[\d.,]\s*-\s*$/.test(s);
  s = s.replace(/[^\d.,]/g, "");
  if (!s) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    // Het laatst voorkomende teken is de decimaalscheiding.
    if (lastComma > lastDot) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    // Alleen komma's: decimaal als er 1-2 cijfers achter staan, anders duizendtal.
    const decimals = s.length - lastComma - 1;
    s = decimals <= 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (lastDot !== -1) {
    // Alleen punten. Meerdere punten = duizendtalscheiding; één punt met exact 3
    // cijfers erachter ook (NL-notatie zoals "1.234"). Anders is de punt decimaal. (H1)
    const dotCount = (s.match(/\./g) ?? []).length;
    const decimals = s.length - lastDot - 1;
    if (dotCount > 1 || decimals === 3) s = s.replace(/\./g, "");
  }

  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return negative ? -n : n;
}

/** Normaliseer een datum naar ISO (YYYY-MM-DD) waar mogelijk. */
export function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();

  // Maand 1-12 en dag 1-31 als minimale geldigheidscheck.
  const inRange = (m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31;

  // Al ISO?
  const iso = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso && inRange(Number(iso[2]), Number(iso[3]))) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // dd-mm-yyyy / dd/mm/yyyy / dd.mm.yyyy
  const dmy = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (dmy && inRange(Number(dmy[2]), Number(dmy[1]))) {
    const [, d, m] = dmy;
    let y = dmy[3];
    if (y.length === 2) y = (Number(y) > 70 ? "19" : "20") + y;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // "1 januari 2024"
  const months: Record<string, string> = {
    januari: "01", februari: "02", maart: "03", april: "04", mei: "05",
    juni: "06", juli: "07", augustus: "08", september: "09", oktober: "10",
    november: "11", december: "12",
    january: "01", february: "02", march: "03", may: "05", june: "06",
    july: "07", august: "08", october: "10",
  };
  const text = s.toLowerCase().match(/\b(\d{1,2})\s+([a-z]+)\s+(\d{4})\b/);
  if (text && months[text[2]]) {
    return `${text[3]}-${months[text[2]]}-${text[1].padStart(2, "0")}`;
  }
  return null;
}

/** Valideer een IBAN met de mod-97 checksum. */
export function isValidIban(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const iban = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  // Mod-97 in stukken om grote getallen te vermijden.
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    remainder = Number(String(remainder) + numeric.slice(i, i + 7)) % 97;
  }
  return remainder === 1;
}

/** Genereer een redelijk uniek id zonder externe afhankelijkheid. */
export function makeId(seed: string, index: number): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return `inv_${(h >>> 0).toString(36)}_${index}`;
}

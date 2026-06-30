# CLAUDE.md — Inkoopfactuur Scanner

Projectgeheugen + handoff voor Claude Code. Lees dit eerst bij het oppakken van dit project.

## Wat dit is
Een simpel, interactief **dashboard om inkoopfacturen te scannen en herkennen**.
Gebruikers uploaden **PDF** of **XML** (batch), velden worden **automatisch herkend**,
zijn handmatig te corrigeren, en exporteerbaar als **JSON / CSV / koppel-klaar UBL**.

Stack: **Next.js 15 (App Router) + React 19 + TypeScript + Tailwind v4**, deploybaar op Vercel.
Stateless: er wordt niets blijvend opgeslagen; alles leeft in de browsersessie.

## Status (laatst bijgewerkt: 2026-06-30)
- ✅ Volledig werkend en lokaal getest: `npm run build` groen; UBL- en PDF-route end-to-end
  geverifieerd (incl. browser-screenshot van het dashboard).
- ✅ Batch-upload, herkenning, validatie, correctie en export werken.
- Branch: **`claude/repro-contents-review-m2mkri`**.
- ⚠️ **PR #1** volgt deze branch en bevat zowel het eerdere "repo leegmaken" als deze app;
  de PR-titel ("Clear repository contents for rebuild") is daardoor verouderd.
  Openstaande keuze: PR #1 titel/omschrijving bijwerken **óf** een schone losse PR maken
  (branch herstarten vanaf `main` met alleen de app).

## Commando's
```bash
npm install            # let op: @anthropic-ai/sdk is een dependency (AI-laag, optioneel actief)
npm run dev            # http://localhost:3000
npm run build          # productiebuild (moet groen zijn vóór commit)
npm run start          # productieserver
```
Testen van de API zonder UI:
```bash
curl -s -X POST http://localhost:3000/api/extract \
  -F "files=@samples/voorbeeld-ubl.xml" -F "files=@samples/voorbeeld-tekst.pdf" | python3 -m json.tool
```

## Architectuur
```
app/
  page.tsx                Dashboard, client-state (lijst + detail + export-knoppen)
  layout.tsx, globals.css Basis-layout en Tailwind-import
  api/extract/route.ts    POST multipart → draait de extractie-pijplijn; GET → claudeEnabled
components/
  UploadZone.tsx          Drag & drop, meerdere bestanden
  InvoiceList.tsx         Linkerlijst met status/totaal/aandachtspunten
  InvoiceDetail.tsx       Bewerkbaar formulier (secties) + export per factuur
  FieldInput.tsx          Herbruikbaar veld met bron-/confidence-styling
lib/
  types.ts                Genormaliseerd Invoice-schema + helpers (field(), emptyInvoice())
  detect.ts               Bestandstype (pdf/xml/unknown) via naam/mime/inhoud
  util.ts                 parseAmount (NL/EN), normalizeDate, isValidIban (mod-97), makeId
  validate.ts             Validatieregels → ValidationIssue[]
  download.ts             Client-side bestand-download
  extract/
    index.ts              Orchestrator: kies extractor per type, optioneel Claude, return Invoice
    xml.ts                UBL/Peppol + CII (ZUGFeRD) mapping + generieke fallback
    pdf.ts                unpdf-tekst mét regelreconstructie uit posities; leest ingebedde Factur-X-XML
    heuristics.ts         Regex-herkenning uit PDF-tekst (nrs, datums, IBAN, BTW, KvK, totalen, regels)
    claude.ts             Optionele AI-laag; NO-OP zonder ANTHROPIC_API_KEY
  export/
    json.ts, csv.ts, ubl.ts   Exportformaten (UBL = koppel-klaar boekhouding)
samples/                  voorbeeld-ubl.xml, voorbeeld-tekst.pdf (voor tests)
```

### Extractie-pijplijn
`detect` → **XML**: `extract/xml.ts` (UBL → CII → generiek) · **PDF**: `extract/pdf.ts`
(ingebedde Factur-X-XML eerst, anders tekst → `heuristics.ts`) → optioneel `claude.ts`
(verrijkt alleen PDF-tekst, hoogste confidence wint) → genormaliseerd `Invoice`.

### Veldmodel
Elk header-veld is een `Field<T> = { value, confidence (0-1), source }` met
`source ∈ xml | regex | llm | manual | none`. `field()` degradeert lege waarden naar
`{null, 0, none}`. Regels (`InvoiceLine`) zijn platte waarden.

## Conventies / let op
- **Nederlandse** UI en teksten; commentaar in het Nederlands, in de stijl van bestaande code.
- Bedragen: gebruik **`parseAmount`** (handelt `1.234,56` én `1,234.56` af) — niet zelf parsen.
- Bedrag-herkenning in `heuristics.ts` vereist **decimalen** (voorkomt dat BTW-/IBAN-nummers
  als bedrag worden gepakt). Houd dat zo bij nieuwe patronen.
- IBAN altijd via **`isValidIban`** (mod-97) valideren; kies bij meerdere kandidaten de geldige.
- PDF-tekst komt mét regelstructuur binnen dankzij `extractLayoutText` (groepeert op y-positie).
  Verander dat niet zonder reden — heuristieken en regelherkenning leunen erop.
- **Claude-laag**: zet `ANTHROPIC_API_KEY` (en optioneel `ANTHROPIC_MODEL`, default
  `claude-opus-4-8`) om de AI-herkenning aan te zetten. Zonder key blijft alles lokaal.
- Na codewijziging: **`npm run build`** moet groen zijn vóór commit.

## Next steps (v2-ideeën)
- Directe **boekhoudkoppeling** (Exact Online / Twinfield / e-Boekhouden) i.p.v. alleen export.
- **Opslag/historie** (database) + zoeken/overzicht.
- **Login/authenticatie**.
- **OCR** voor gescande PDF's zonder tekstlaag. LET OP: dit werkt nu nog NIET —
  een scan zonder tekstlaag krijgt `status:"error"` en de Claude-laag krijgt alleen
  tekst (geen afbeelding), dus die wordt overgeslagen. Echte OCR vereist dat we de
  PDF-bytes als document/afbeelding naar Claude sturen.
- Losse **regels-CSV** export en betere regel-/BTW-uitsplitsing-herkenning in PDF's.
- Tests (Vitest) voor `util.ts`, `extract/xml.ts` en `heuristics.ts`.

## Git
Werk op `claude/repro-contents-review-m2mkri`. Push met `git push -u origin <branch>`.
Maak geen PR tenzij expliciet gevraagd.

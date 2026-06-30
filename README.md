# Inkoopfactuur Scanner

Een simpel, interactief dashboard om **inkoopfacturen** te scannen en herkennen.
Upload **PDF** of **XML**, laat de velden automatisch herkennen, controleer/corrigeer
ze, en exporteer koppel-klaar (JSON, CSV of UBL).

## Functies

- **Batch-upload** (drag & drop) van meerdere PDF- en XML-bestanden tegelijk.
- **Automatische herkenning** van factuurnummer, datums, leverancier (naam, adres,
  BTW-nummer, KvK, IBAN), ordernummer, regels en totalen.
- **XML**: herkent UBL/Peppol (NLCIUS), CII/ZUGFeRD en valt terug op generieke mapping
  voor onbekende formaten. Factur-X/ZUGFeRD (XML ingebed in PDF) wordt ook gelezen.
- **PDF**: tekstlaag via `unpdf`, daarna heuristische herkenning (regex).
- **Optionele AI-laag (Claude)**: zet `ANTHROPIC_API_KEY` om de herkenning te verrijken;
  zonder key werkt alles volledig lokaal.
- **Validatie**: controleert `subtotaal + BTW = totaal`, IBAN-checksum en BTW-formaat.
- **Per veld**: herkomst (XML/auto/AI/handmatig) en betrouwbaarheid zichtbaar.
- **Export**: JSON, CSV (per factuur één rij) en koppel-klaar UBL.

> Stateless: er wordt niets blijvend opgeslagen. Alles leeft in de browsersessie.

## Starten

```bash
npm install
npm run dev
# open http://localhost:3000
```

Test met `samples/voorbeeld-ubl.xml`.

## AI-laag activeren (optioneel)

Kopieer `.env.example` naar `.env.local` en zet je key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Installeer ook de SDK: `npm install @anthropic-ai/sdk`. Daarna verrijkt Claude de
herkenning van PDF-facturen automatisch (ook handig voor lastige lay-outs).

## Deployen op Vercel

Push naar GitHub en importeer in Vercel. Zet `ANTHROPIC_API_KEY` als environment
variable als je de AI-laag wilt gebruiken.

## Architectuur

```
app/
  page.tsx              Dashboard (client state)
  api/extract/route.ts  Upload-endpoint, draait de extractie-pijplijn
components/             UploadZone, InvoiceList, InvoiceDetail, FieldInput
lib/
  types.ts             Genormaliseerd factuurschema
  detect.ts            Bestandstype-detectie
  util.ts              Bedrag-/datum-/IBAN-helpers
  validate.ts          Validatieregels
  extract/             xml, pdf, heuristics, claude, index (orchestrator)
  export/              json, csv, ubl
samples/               Voorbeeldfactuur (UBL)
```

## Roadmap (out of scope v1)

- Directe API-koppeling met boekhoudpakketten (Exact, Twinfield, e-Boekhouden).
- Login/authenticatie en opslag/historie (database).
- OCR voor gescande PDF's zonder tekstlaag (komt via de Claude-laag).

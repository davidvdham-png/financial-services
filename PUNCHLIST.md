# PUNCHLIST — Inkoopfactuur Scanner

Geconsolideerde review (4 parallelle reviewers: extractie-pijplijn, lib/export,
frontend/API, config/build/security) op branch `claude/repro-contents-review-m2mkri`.
Build was groen op moment van review (`npm run build` ✓, `tsc --noEmit` ✓).

Status: ✅ = opgelost in deze branch · ⬜ = open.

## 🔴 Hoog — correctheid & data-integriteit

- ✅ **H1 — `lib/util.ts` `parseAmount`**: bedragen met meerdere punten (`1.234.567`)
  werden stil afgekapt door `parseFloat`. Nu: punten als duizendtalscheiding herkend.
- ✅ **H2 — `lib/export/csv.ts`**: CSV/Excel formula-injectie (`=`,`+`,`-`,`@`) vanuit
  ongecontroleerde factuurinput. Nu: gevaarlijke prefix met `'` ge-escaped.
- ✅ **H3 — `lib/extract/claude.ts` `merge`**: "hoogste confidence wint" klopte niet;
  LLM (0.85) overschreef onvoorwaardelijk o.a. een mod-97-gevalideerd IBAN (0.9).
  Nu: alleen overschrijven als de LLM-confidence hoger is dan de bestaande.

## 🟠 Hoog/midden — robuustheid API

- ✅ **A1 — `app/api/extract/route.ts`**: geen limiet op aantal/grootte bestanden en
  geen per-file isolatie (`Promise.all` → één corrupt bestand sloopt de hele batch).
  Nu: cap op aantal (20) + bytes (10 MB) per bestand, en `Promise.allSettled`-stijl
  isolatie zodat een mislukt bestand een `status:"error"`-factuur oplevert.
- ✅ **A2 — `route.ts`**: geen server-side type-validatie. Nu: mime/extensie-check
  server-side; niet-pdf/xml wordt geweigerd. (Rate limiting: zie open punten.)

## 🟡 Midden — extractie-kwaliteit

- ✅ **M1 — `lib/extract/pdf.ts`**: malformed ingebedde Factur-X-XML → geen tekst-fallback.
  Nu: bij `status:"error"`/leeg resultaat doorvallen naar de tekstroute.
- ✅ **M2 — `heuristics.ts` / `xml.ts`**: `status:"ok"` ook als niets herkend werd.
  Nu: status afgeleid van kernvelden (nr/datum/totaal) → anders `partial`.
- ✅ **M3 — `lib/extract/xml.ts`**: BTW-dubbeltelling bij een tweede `TaxTotal`
  (tax-accounting-valuta). Nu: alleen `TaxTotal` in de document-valuta gesommeerd.
- ✅ **M4 — `lib/extract/xml.ts` `get()`**: faalde op herhaalde UBL-knopen (array
  `PaymentMeans`). Nu: arrays afgevangen (eerste element).
- ✅ **M5 — `lib/util.ts` `parseAmount`**: negatief teken na valutasymbool (`€-50,00`)
  werd gemist. Nu: minteken vóór het eerste cijfer gedetecteerd.
- ✅ **M6 — `components/FieldInput.tsx`**: `type="number"`/`type="date"` botsen met
  NL-notatie. Nu: bedrag-/datumvelden `type="text"` + `inputMode`.
- ✅ **M7 — `lib/extract/claude.ts`**: betere LLM-regels geblokkeerd zodra heuristiek
  ook maar één (ruis)regel vond. Nu: LLM-regels nemen het over bij zwakke heuristiek.

## 🔵 Laag — netheid, a11y, docs

- ✅ **OCR-claim** in CLAUDE.md gecorrigeerd (er gebeurt geen OCR via de Claude-laag).
- ✅ **A11y UploadZone**: `role="button"`, `tabIndex`, Enter/Space, `aria-label`;
  decoratieve emoji's `aria-hidden`.
- ✅ **`claude.ts` stille `catch`**: fout wordt server-side gelogd; default-model
  gepind op dated snapshot.
- ✅ **`normalizeDate`** maand/dag-bereikvalidatie (1-12 / 1-31).
- ✅ **`collectLeaves`** array-check vóór object.
- ✅ **`csv.ts`** losse `\r` nu ook ge-quote.
- ✅ **`ubl.ts`** XML-1.0-verboden controlekarakters gestript.
- ✅ **`page.tsx`** `Array.isArray`-guard op `data.invoices`.
- ✅ **ESLint**: minimale `eslint.config.mjs` toegevoegd.
- ✅ **Vitest**: testsuite voor `util`, `csv`, `xml`, `claude-merge`, `validate`.

## ⬜ Open (bewust niet in deze ronde)

- ⬜ Rate limiting op `/api/extract` (vereist infra-keuze: Vercel WAF / Upstash).
- ⬜ Echte OCR voor gescande PDF's (PDF-bytes als document naar Claude sturen).
- ⬜ `makeId` → `crypto.randomUUID()` (cosmetisch; index borgt nu uniciteit).
- ⬜ `npm audit` vulns via optionele `canvas`→`tar` (niet in runtime-bundle).
- ⬜ Boekhoudkoppeling, opslag/historie, login (v2-roadmap).

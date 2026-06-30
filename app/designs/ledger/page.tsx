"use client";

// LEDGER — warm-editorial designvariant van het inkoopfactuur-dashboard.
// Volledig interactief met mock-data; raakt geen andere bestanden aan.

import { useMemo, useState } from "react";
import Link from "next/link";
import { getMockInvoices, DESIGN_VARIANTS } from "@/lib/mock-invoices";
import { validateInvoice } from "@/lib/validate";
import { Invoice, Field, InvoiceStatus, FieldSource } from "@/lib/types";

// ---------------------------------------------------------------------------
// Hulpfuncties
// ---------------------------------------------------------------------------

// NL-valutaformaat; één gedeelde formatter scheelt allocaties.
const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
const fmt = (v: number | null | undefined) => (v == null ? "—" : eur.format(v));

// Datum netjes tonen (input blijft een gewone string).
function fmtDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric" }).format(d);
}

// Status → leesbaar label + gedempte, verfijnde tint.
const STATUS_META: Record<InvoiceStatus, { label: string; ink: string; bg: string; dot: string }> = {
  ok: { label: "Verwerkt", ink: "#2F5D3A", bg: "rgba(94,140,106,0.14)", dot: "#5E8C6A" },
  partial: { label: "Aandacht", ink: "#8A5A1E", bg: "rgba(190,140,70,0.16)", dot: "#C08A3E" },
  error: { label: "Mislukt", ink: "#8C3A33", bg: "rgba(176,86,76,0.14)", dot: "#B0564C" },
};

// Bron → kort label voor de herkomst-chip.
const SOURCE_META: Record<FieldSource, { label: string; tint: string }> = {
  xml: { label: "XML", tint: "#0F5D5A" },
  regex: { label: "Patroon", tint: "#7A6A2E" },
  llm: { label: "Claude", tint: "#6B4A7A" },
  manual: { label: "Handmatig", tint: "#8A5A1E" },
  none: { label: "Leeg", tint: "#9A8F80" },
};

// Sleutels van de bewerkbare kop-velden (string-velden).
type EditableKey =
  | "invoiceNumber"
  | "invoiceDate"
  | "dueDate"
  | "poNumber"
  | "paymentReference"
  | "currency";

const EDITABLE_FIELDS: { key: EditableKey; label: string; type: "text" | "date" }[] = [
  { key: "invoiceNumber", label: "Factuurnummer", type: "text" },
  { key: "invoiceDate", label: "Factuurdatum", type: "date" },
  { key: "dueDate", label: "Vervaldatum", type: "date" },
  { key: "poNumber", label: "Inkoopordernr.", type: "text" },
  { key: "paymentReference", label: "Betalingskenmerk", type: "text" },
  { key: "currency", label: "Valuta", type: "text" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LedgerPage() {
  const [invoices, setInvoices] = useState<Invoice[]>(() => getMockInvoices());
  const [selectedId, setSelectedId] = useState<string | null>(() => "inv_demo_1");
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const selected = useMemo(
    () => invoices.find((i) => i.id === selectedId) ?? null,
    [invoices, selectedId],
  );

  // Validatie-issues per factuur (gememoïseerd voor de telling én het detail).
  const issuesById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof validateInvoice>>();
    for (const inv of invoices) map.set(inv.id, validateInvoice(inv));
    return map;
  }, [invoices]);

  // Samenvattingscijfers voor de bovenrand.
  const summary = useMemo(() => {
    let gross = 0;
    let issues = 0;
    const byStatus: Record<InvoiceStatus, number> = { ok: 0, partial: 0, error: 0 };
    for (const inv of invoices) {
      gross += inv.totalGross.value ?? 0;
      issues += issuesById.get(inv.id)?.length ?? 0;
      byStatus[inv.status] += 1;
    }
    return { count: invoices.length, gross, issues, byStatus };
  }, [invoices, issuesById]);

  // Korte melding die vanzelf weer verdwijnt.
  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2200);
  }

  // "Scan" een nieuwe factuur: hergebruik een demo-seed met een vers id.
  function handleScan() {
    if (scanning) return;
    setScanning(true);
    window.setTimeout(() => {
      const pool = getMockInvoices();
      const recycled = pool[invoices.length % pool.length];
      const fresh: Invoice = {
        ...structuredClone(recycled),
        id: crypto.randomUUID(),
        fileName: recycled.fileName.replace(/(\.\w+)$/, `-${(invoices.length + 1)
          .toString()
          .padStart(2, "0")}$1`),
      };
      setInvoices((prev) => [fresh, ...prev]);
      setSelectedId(fresh.id);
      setScanning(false);
      flash("Nieuwe factuur ingelezen");
    }, 700);
  }

  // Immutabele update van een bewerkbaar kop-veld → bron wordt "manual".
  function updateField(key: EditableKey, raw: string) {
    if (!selected) return;
    setSelectedId(selected.id);
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id !== selected.id) return inv;
        const next = structuredClone(inv);
        const value = raw.trim() === "" ? null : raw;
        const f = next[key] as Field;
        f.value = value;
        f.source = "manual";
        f.confidence = value == null ? 0 : 1;
        return next;
      }),
    );
  }

  // Export-knoppen — visueel + console (geen echte bestandsgeneratie nodig).
  function handleExport(kind: "CSV" | "JSON" | "UBL") {
    if (!selected) return;
    console.log(`[Ledger] Export ${kind}`, selected);
    flash(`${kind}-export voorbereid (zie console)`);
  }

  const selectedIssues = selected ? issuesById.get(selected.id) ?? [] : [];

  return (
    <div className="ledger-root">
      {/* Lettertypen via Google Fonts — Next 15 hoist de <link>. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Hanken+Grotesk:wght@400;500;600;700&display=swap"
      />

      <style>{ledgerCss}</style>

      {/* -------------------------------------------------- Header */}
      <header className="led-header">
        <div className="led-headInner">
          <div className="led-brand reveal" style={{ animationDelay: "40ms" }}>
            <div className="led-mark" aria-hidden>
              <span>₣</span>
            </div>
            <div>
              <div className="led-brandRow">
                <h1 className="led-title">Inkoopfactuur Scanner</h1>
                <span className="led-badge">Ledger-editie</span>
              </div>
              <p className="led-sub">Rustig overzicht van inkomende facturen — herkomst en cijfers naast elkaar.</p>
            </div>
          </div>

          {/* Design-switcher */}
          <nav className="led-switch reveal" style={{ animationDelay: "120ms" }} aria-label="Designvarianten">
            {DESIGN_VARIANTS.map((v) => {
              const active = v.slug === "ledger";
              return (
                <Link
                  key={v.slug}
                  href={`/designs/${v.slug}`}
                  className={`led-switchItem${active ? " is-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  title={v.tagline}
                >
                  {v.name}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Samenvatting */}
        <div className="led-stats reveal" style={{ animationDelay: "200ms" }}>
          <Stat label="Facturen" value={String(summary.count)} note="in deze stapel" />
          <Stat label="Totaal incl. btw" value={fmt(summary.gross)} note="som van alle bruto's" big />
          <Stat
            label="Aandachtspunten"
            value={String(summary.issues)}
            note={summary.issues === 0 ? "alles in orde" : "controleren aanbevolen"}
            warn={summary.issues > 0}
          />
          <div className="led-stat">
            <span className="led-statLabel">Status</span>
            <div className="led-statusTally">
              {(["ok", "partial", "error"] as InvoiceStatus[]).map((s) => (
                <span key={s} className="led-tallyItem" title={STATUS_META[s].label}>
                  <span className="led-tallyDot" style={{ background: STATUS_META[s].dot }} />
                  {summary.byStatus[s]}
                </span>
              ))}
            </div>
            <span className="led-statNote">verwerkt · aandacht · mislukt</span>
          </div>
        </div>
      </header>

      {/* -------------------------------------------------- Body */}
      <main className="led-main">
        {/* Linkerkolom: lijst */}
        <section className="led-listCol reveal" style={{ animationDelay: "260ms" }} aria-label="Factuurlijst">
          <div className="led-listHead">
            <h2 className="led-colTitle">Ingelezen facturen</h2>
            <button
              type="button"
              className="led-scanBtn"
              onClick={handleScan}
              disabled={scanning}
              aria-busy={scanning}
            >
              {scanning ? (
                <>
                  <span className="led-spinner" aria-hidden /> Inlezen…
                </>
              ) : (
                <>
                  <span aria-hidden>＋</span> Scan factuur
                </>
              )}
            </button>
          </div>

          <ul className="led-list">
            {scanning && (
              <li className="led-skeleton" aria-hidden>
                <span className="led-skelBar" style={{ width: "62%" }} />
                <span className="led-skelBar" style={{ width: "40%" }} />
              </li>
            )}
            {invoices.length === 0 && !scanning && (
              <li className="led-empty">
                <p>Nog geen facturen.</p>
                <p className="led-emptyNote">Klik op “Scan factuur” om te beginnen.</p>
              </li>
            )}
            {invoices.map((inv, idx) => {
              const meta = STATUS_META[inv.status];
              const nIssues = issuesById.get(inv.id)?.length ?? 0;
              const active = inv.id === selectedId;
              return (
                <li key={inv.id}>
                  <button
                    type="button"
                    className={`led-row reveal${active ? " is-active" : ""}`}
                    style={{ animationDelay: `${300 + idx * 45}ms` }}
                    onClick={() => setSelectedId(inv.id)}
                    aria-pressed={active}
                  >
                    <span className="led-rowDot" style={{ background: meta.dot }} aria-hidden />
                    <span className="led-rowMain">
                      <span className="led-rowSupplier">{inv.supplier.name.value ?? "Onbekende leverancier"}</span>
                      <span className="led-rowFile">{inv.fileName}</span>
                    </span>
                    <span className="led-rowRight">
                      <span className="led-rowAmount">{fmt(inv.totalGross.value)}</span>
                      <span className="led-rowTags">
                        <span className="led-statusChip" style={{ color: meta.ink, background: meta.bg }}>
                          {meta.label}
                        </span>
                        {nIssues > 0 && <span className="led-issueChip">{nIssues}⚑</span>}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Rechterkolom: detail */}
        <section className="led-detailCol" aria-label="Factuurdetail" key={selected?.id ?? "leeg"}>
          {!selected ? (
            <div className="led-detailEmpty reveal">
              <div className="led-emptyGlyph" aria-hidden>
                ❦
              </div>
              <p className="led-emptyTitle">Geen factuur geselecteerd</p>
              <p className="led-emptyNote">Kies links een factuur om de details te bekijken.</p>
            </div>
          ) : selected.status === "error" ? (
            <ErrorState invoice={selected} />
          ) : (
            <DetailPanel
              invoice={selected}
              issues={selectedIssues}
              onUpdate={updateField}
              onExport={handleExport}
            />
          )}
        </section>
      </main>

      {/* Vluchtige melding */}
      {toast && (
        <div className="led-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Samenvatting-tegel
// ---------------------------------------------------------------------------

function Stat({
  label,
  value,
  note,
  big,
  warn,
}: {
  label: string;
  value: string;
  note?: string;
  big?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="led-stat">
      <span className="led-statLabel">{label}</span>
      <span className={`led-statValue${big ? " is-big" : ""}${warn ? " is-warn" : ""}`}>{value}</span>
      {note && <span className="led-statNote">{note}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detailpaneel (verwerkt / aandacht)
// ---------------------------------------------------------------------------

function DetailPanel({
  invoice,
  issues,
  onUpdate,
  onExport,
}: {
  invoice: Invoice;
  issues: ReturnType<typeof validateInvoice>;
  onUpdate: (key: EditableKey, raw: string) => void;
  onExport: (kind: "CSV" | "JSON" | "UBL") => void;
}) {
  const meta = STATUS_META[invoice.status];
  return (
    <article className="led-detail">
      {/* Kop */}
      <header className="led-detailHead reveal">
        <div>
          <p className="led-eyebrow">{invoice.detectedFormat.toUpperCase()} · {invoice.fileName}</p>
          <h2 className="led-detailTitle">{invoice.supplier.name.value ?? "Onbekende leverancier"}</h2>
          <p className="led-detailMeta">
            {invoice.supplier.address.value ?? "Adres onbekend"}
          </p>
        </div>
        <span className="led-statusChip led-statusBig" style={{ color: meta.ink, background: meta.bg }}>
          <span className="led-tallyDot" style={{ background: meta.dot }} aria-hidden />
          {meta.label}
        </span>
      </header>

      {/* Leverancier-identiteit */}
      <div className="led-supplierGrid reveal" style={{ animationDelay: "60ms" }}>
        <IdentCell label="Btw-nummer" f={invoice.supplier.vatNumber} />
        <IdentCell label="KvK" f={invoice.supplier.kvk} />
        <IdentCell label="IBAN" f={invoice.supplier.iban} mono />
      </div>

      {/* Bewerkbare kop-velden */}
      <section className="led-card reveal" style={{ animationDelay: "120ms" }}>
        <h3 className="led-cardTitle">Kopgegevens</h3>
        <div className="led-fieldGrid">
          {EDITABLE_FIELDS.map(({ key, label, type }) => {
            const f = invoice[key] as Field;
            const src = SOURCE_META[f.source];
            const inputValue =
              type === "date" && f.value
                ? toDateInput(f.value)
                : (f.value as string | null) ?? "";
            return (
              <label key={key} className="led-field">
                <span className="led-fieldLabel">
                  {label}
                  <span className="led-srcChip" style={{ color: src.tint }} title={`Herkomst: ${src.label}`}>
                    {src.label}
                    {f.source !== "none" && f.source !== "manual" && (
                      <em className="led-conf">{Math.round(f.confidence * 100)}%</em>
                    )}
                  </span>
                </span>
                <input
                  className="led-input"
                  type={type === "date" ? "date" : "text"}
                  value={inputValue}
                  placeholder="—"
                  onChange={(e) => onUpdate(key, e.target.value)}
                />
                {type === "date" && f.value && <span className="led-fieldHint">{fmtDate(f.value)}</span>}
              </label>
            );
          })}
        </div>
      </section>

      {/* Regels */}
      <section className="led-card reveal" style={{ animationDelay: "180ms" }}>
        <h3 className="led-cardTitle">Factuurregels</h3>
        {invoice.lines.length === 0 ? (
          <p className="led-muted">Geen regels herkend.</p>
        ) : (
          <div className="led-tableWrap">
            <table className="led-table">
              <thead>
                <tr>
                  <th>Omschrijving</th>
                  <th className="num">Aantal</th>
                  <th className="num">Stuksprijs</th>
                  <th className="num">Btw</th>
                  <th className="num">Regeltotaal</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((ln, i) => (
                  <tr key={i}>
                    <td>{ln.description}</td>
                    <td className="num">{ln.quantity ?? "—"}</td>
                    <td className="num">{fmt(ln.unitPrice)}</td>
                    <td className="num">{ln.vatRate == null ? "—" : `${ln.vatRate}%`}</td>
                    <td className="num strong">{fmt(ln.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Subtotaal</td>
                  <td className="num">{fmt(invoice.subtotal.value)}</td>
                </tr>
                <tr>
                  <td colSpan={4}>Btw</td>
                  <td className="num">{fmt(invoice.totalVat.value)}</td>
                </tr>
                <tr className="led-grossRow">
                  <td colSpan={4}>Totaal incl. btw</td>
                  <td className="num">{fmt(invoice.totalGross.value)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Btw-uitsplitsing */}
        {invoice.vatBreakdown.length > 0 && (
          <div className="led-vatBreak">
            {invoice.vatBreakdown.map((b, i) => (
              <span key={i} className="led-vatPill">
                <strong>{b.rate}%</strong> over {fmt(b.base)} → {fmt(b.amount)}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Validatie */}
      <section className="led-card reveal" style={{ animationDelay: "240ms" }}>
        <h3 className="led-cardTitle">
          Controle
          <span className="led-checkCount">{issues.length === 0 ? "geen punten" : `${issues.length} punt(en)`}</span>
        </h3>
        {issues.length === 0 ? (
          <p className="led-allGood">✓ Alle automatische controles geslaagd.</p>
        ) : (
          <ul className="led-issueList">
            {issues.map((iss, i) => (
              <li key={i} className={`led-issue is-${iss.severity}`}>
                <span className="led-issueIcon" aria-hidden>
                  {iss.severity === "error" ? "✕" : "!"}
                </span>
                <div>
                  <span className="led-issueField">{iss.field}</span>
                  <span className="led-issueMsg">{iss.message}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Export */}
      <footer className="led-exportBar reveal" style={{ animationDelay: "300ms" }}>
        <span className="led-exportLabel">Exporteren als</span>
        <div className="led-exportBtns">
          {(["CSV", "JSON", "UBL"] as const).map((k) => (
            <button key={k} type="button" className="led-exportBtn" onClick={() => onExport(k)}>
              {k}
            </button>
          ))}
        </div>
      </footer>
    </article>
  );
}

// Identiteit-cel (btw/kvk/iban) met herkomst-tint.
function IdentCell({ label, f, mono }: { label: string; f: Field; mono?: boolean }) {
  const src = SOURCE_META[f.source];
  return (
    <div className="led-ident">
      <span className="led-identLabel">{label}</span>
      <span className={`led-identValue${mono ? " mono" : ""}`}>{f.value ?? "—"}</span>
      <span className="led-srcChip" style={{ color: src.tint }}>
        {src.label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Foutstaat
// ---------------------------------------------------------------------------

function ErrorState({ invoice }: { invoice: Invoice }) {
  return (
    <div className="led-detail led-errorState reveal">
      <header className="led-detailHead">
        <div>
          <p className="led-eyebrow">{invoice.detectedFormat.toUpperCase()} · {invoice.fileName}</p>
          <h2 className="led-detailTitle">Inlezen mislukt</h2>
        </div>
        <span
          className="led-statusChip led-statusBig"
          style={{ color: STATUS_META.error.ink, background: STATUS_META.error.bg }}
        >
          <span className="led-tallyDot" style={{ background: STATUS_META.error.dot }} aria-hidden />
          {STATUS_META.error.label}
        </span>
      </header>
      <div className="led-errorBox">
        <span className="led-errorGlyph" aria-hidden>
          ⚠
        </span>
        <div>
          <p className="led-errorMsg">{invoice.error ?? "Onbekende fout bij verwerking."}</p>
          <p className="led-muted">
            Probeer het document opnieuw aan te leveren als doorzoekbare PDF of als gestructureerde XML (UBL/CII).
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Klein: datum naar <input type=date>-formaat (yyyy-mm-dd)
// ---------------------------------------------------------------------------

function toDateInput(v: string): string {
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Stijl — warm-editorial "Ledger"
// ---------------------------------------------------------------------------

const ledgerCss = `
.ledger-root {
  --paper: #FAF7F2;
  --paper-2: #F6F1E9;
  --paper-3: #EFE8DB;
  --line: #E2D8C8;
  --line-strong: #D2C5B0;
  --ink: #21201C;
  --ink-soft: #5C564C;
  --ink-faint: #8B8475;
  --accent: #0F5D5A;
  --accent-deep: #0A4744;
  --accent-soft: rgba(15,93,90,0.08);
  font-family: "Hanken Grotesk", ui-sans-serif, sans-serif;
  color: var(--ink);
  background:
    radial-gradient(1200px 600px at 12% -10%, rgba(15,93,90,0.06), transparent 60%),
    radial-gradient(900px 500px at 100% 0%, rgba(140,90,30,0.05), transparent 55%),
    var(--paper);
  min-height: 100vh;
  padding: clamp(20px, 4vw, 52px);
  -webkit-font-smoothing: antialiased;
}

/* ---- Reveals ---- */
@keyframes ledRise {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.reveal { opacity: 0; animation: ledRise 0.6s cubic-bezier(0.22,0.61,0.36,1) forwards; }
@media (prefers-reduced-motion: reduce) {
  .reveal { animation: none; opacity: 1; }
}

/* ---- Header ---- */
.led-header { max-width: 1240px; margin: 0 auto 26px; }
.led-headInner {
  display: flex; flex-wrap: wrap; gap: 20px;
  align-items: flex-start; justify-content: space-between;
}
.led-brand { display: flex; gap: 16px; align-items: flex-start; }
.led-mark {
  width: 52px; height: 52px; flex: none; border-radius: 14px;
  background: linear-gradient(150deg, var(--accent), var(--accent-deep));
  color: #F3EFE6; display: grid; place-items: center;
  font-family: "Fraunces", serif; font-size: 26px; font-weight: 600;
  box-shadow: 0 8px 20px -8px rgba(15,93,90,0.5), inset 0 1px 0 rgba(255,255,255,0.2);
}
.led-brandRow { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.led-title {
  font-family: "Fraunces", serif;
  font-size: clamp(26px, 3.4vw, 40px);
  font-weight: 600; line-height: 1.02; letter-spacing: -0.01em;
  font-optical-sizing: auto; margin: 0;
}
.led-badge {
  font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--accent); background: var(--accent-soft);
  border: 1px solid rgba(15,93,90,0.2); padding: 4px 9px; border-radius: 999px;
}
.led-sub { margin: 6px 0 0; color: var(--ink-soft); font-size: 14.5px; max-width: 46ch; }

/* ---- Switcher ---- */
.led-switch {
  display: inline-flex; padding: 4px; gap: 2px;
  background: var(--paper-2); border: 1px solid var(--line);
  border-radius: 999px; box-shadow: inset 0 1px 2px rgba(0,0,0,0.03);
}
.led-switchItem {
  font-size: 13px; font-weight: 600; color: var(--ink-soft);
  padding: 7px 15px; border-radius: 999px; text-decoration: none;
  transition: background 0.25s ease, color 0.25s ease; white-space: nowrap;
}
.led-switchItem:hover { color: var(--ink); background: rgba(255,255,255,0.6); }
.led-switchItem.is-active {
  color: #F3EFE6; background: linear-gradient(150deg, var(--accent), var(--accent-deep));
  box-shadow: 0 4px 12px -5px rgba(15,93,90,0.6);
}

/* ---- Stats ---- */
.led-stats {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px;
  margin-top: 26px; background: var(--line);
  border: 1px solid var(--line); border-radius: 18px; overflow: hidden;
}
.led-stat {
  background: var(--paper-2); padding: 18px 20px;
  display: flex; flex-direction: column; gap: 4px;
}
.led-statLabel {
  font-size: 11px; font-weight: 600; letter-spacing: 0.07em;
  text-transform: uppercase; color: var(--ink-faint);
}
.led-statValue { font-family: "Fraunces", serif; font-size: 24px; font-weight: 600; letter-spacing: -0.01em; }
.led-statValue.is-big { font-size: 30px; color: var(--accent-deep); }
.led-statValue.is-warn { color: #8A5A1E; }
.led-statNote { font-size: 12px; color: var(--ink-faint); }
.led-statusTally { display: flex; gap: 14px; font-family: "Fraunces", serif; font-size: 22px; font-weight: 600; }
.led-tallyItem { display: inline-flex; align-items: center; gap: 6px; }
.led-tallyDot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }

/* ---- Layout ---- */
.led-main {
  max-width: 1240px; margin: 0 auto;
  display: grid; grid-template-columns: minmax(330px, 410px) 1fr; gap: 22px;
  align-items: start;
}
@media (max-width: 940px) { .led-main { grid-template-columns: 1fr; } .led-stats { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 560px) { .led-stats { grid-template-columns: 1fr; } }

/* ---- Lijst ---- */
.led-listCol {
  background: var(--paper-2); border: 1px solid var(--line);
  border-radius: 20px; padding: 18px; position: sticky; top: 18px;
}
.led-listHead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.led-colTitle { font-family: "Fraunces", serif; font-size: 18px; font-weight: 600; margin: 0; }
.led-scanBtn {
  display: inline-flex; align-items: center; gap: 7px; cursor: pointer;
  font-family: inherit; font-size: 13px; font-weight: 600; color: #F3EFE6;
  background: linear-gradient(150deg, var(--accent), var(--accent-deep));
  border: none; padding: 8px 14px; border-radius: 11px;
  box-shadow: 0 6px 16px -7px rgba(15,93,90,0.6);
  transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.2s ease;
}
.led-scanBtn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 10px 20px -8px rgba(15,93,90,0.7); }
.led-scanBtn:active:not(:disabled) { transform: translateY(0); }
.led-scanBtn:disabled { opacity: 0.75; cursor: progress; }
.led-spinner {
  width: 13px; height: 13px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff;
  animation: ledSpin 0.7s linear infinite;
}
@keyframes ledSpin { to { transform: rotate(360deg); } }

.led-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.led-row {
  width: 100%; text-align: left; cursor: pointer;
  display: flex; align-items: stretch; gap: 12px;
  background: var(--paper); border: 1px solid var(--line);
  border-radius: 14px; padding: 13px 14px; font-family: inherit;
  transition: border-color 0.2s ease, transform 0.18s ease, box-shadow 0.2s ease, background 0.2s ease;
}
.led-row:hover { transform: translateX(2px); border-color: var(--line-strong); box-shadow: 0 6px 16px -12px rgba(33,32,28,0.5); }
.led-row.is-active {
  border-color: var(--accent); background: #fff;
  box-shadow: 0 8px 24px -14px rgba(15,93,90,0.6), inset 3px 0 0 var(--accent);
}
.led-rowDot { width: 9px; height: 9px; border-radius: 50%; margin-top: 5px; flex: none; }
.led-rowMain { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.led-rowSupplier { font-weight: 600; font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.led-rowFile { font-size: 12px; color: var(--ink-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.led-rowRight { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; flex: none; }
.led-rowAmount { font-family: "Fraunces", serif; font-weight: 600; font-size: 15px; }
.led-rowTags { display: flex; align-items: center; gap: 5px; }
.led-statusChip {
  font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 999px; white-space: nowrap;
  display: inline-flex; align-items: center; gap: 5px;
}
.led-issueChip {
  font-size: 11px; font-weight: 700; color: #8A5A1E;
  background: rgba(190,140,70,0.16); padding: 3px 7px; border-radius: 999px;
}

.led-skeleton { display: flex; flex-direction: column; gap: 8px; padding: 16px 14px; border: 1px dashed var(--line-strong); border-radius: 14px; }
.led-skelBar { height: 10px; border-radius: 6px; background: linear-gradient(90deg, var(--paper-3), var(--line), var(--paper-3)); background-size: 200% 100%; animation: ledShimmer 1.2s ease infinite; }
@keyframes ledShimmer { to { background-position: -200% 0; } }
.led-empty, .led-detailEmpty { text-align: center; color: var(--ink-soft); padding: 40px 16px; }
.led-emptyNote { font-size: 13px; color: var(--ink-faint); margin-top: 4px; }

/* ---- Detail ---- */
.led-detailCol { min-width: 0; }
.led-detailEmpty {
  background: var(--paper-2); border: 1px solid var(--line); border-radius: 20px;
  display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 80px 20px;
}
.led-emptyGlyph { font-family: "Fraunces", serif; font-size: 44px; color: var(--accent); opacity: 0.5; }
.led-emptyTitle { font-family: "Fraunces", serif; font-size: 20px; font-weight: 600; }

.led-detail { display: flex; flex-direction: column; gap: 18px; }
.led-detailHead {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
  background: var(--paper-2); border: 1px solid var(--line); border-radius: 20px; padding: 22px 24px;
}
.led-eyebrow { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); margin: 0 0 6px; }
.led-detailTitle { font-family: "Fraunces", serif; font-size: clamp(22px, 3vw, 30px); font-weight: 600; letter-spacing: -0.01em; margin: 0; line-height: 1.05; }
.led-detailMeta { color: var(--ink-soft); font-size: 14px; margin: 7px 0 0; }
.led-statusBig { font-size: 12.5px; padding: 6px 12px; }

.led-supplierGrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
@media (max-width: 620px) { .led-supplierGrid { grid-template-columns: 1fr; } }
.led-ident { background: var(--paper-2); padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; }
.led-identLabel { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-faint); }
.led-identValue { font-size: 14px; font-weight: 500; word-break: break-word; }
.led-identValue.mono, .mono { font-family: "Fraunces", serif; font-variant-numeric: tabular-nums; letter-spacing: 0.01em; }

.led-card { background: var(--paper-2); border: 1px solid var(--line); border-radius: 20px; padding: 20px 22px; }
.led-cardTitle { font-family: "Fraunces", serif; font-size: 17px; font-weight: 600; margin: 0 0 16px; display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.led-checkCount, .led-srcChip em.led-conf { font-family: "Hanken Grotesk", sans-serif; }
.led-checkCount { font-size: 12px; font-weight: 600; color: var(--ink-faint); }

/* Velden */
.led-fieldGrid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
@media (max-width: 560px) { .led-fieldGrid { grid-template-columns: 1fr; } }
.led-field { display: flex; flex-direction: column; gap: 6px; }
.led-fieldLabel { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; font-weight: 600; color: var(--ink-soft); letter-spacing: 0.02em; }
.led-srcChip { font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; display: inline-flex; align-items: center; gap: 4px; }
.led-conf { font-style: normal; font-weight: 600; opacity: 0.7; font-size: 10px; }
.led-input {
  font-family: inherit; font-size: 14.5px; color: var(--ink);
  background: var(--paper); border: 1px solid var(--line-strong); border-radius: 11px;
  padding: 10px 12px; width: 100%; transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}
.led-input:focus { outline: none; border-color: var(--accent); background: #fff; box-shadow: 0 0 0 3px var(--accent-soft); }
.led-fieldHint { font-size: 11.5px; color: var(--ink-faint); }

/* Tabel */
.led-tableWrap { overflow-x: auto; margin: 0 -4px; }
.led-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.led-table th { text-align: left; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink-faint); padding: 0 12px 10px; border-bottom: 1px solid var(--line-strong); }
.led-table th.num, .led-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.led-table td { padding: 11px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
.led-table tbody tr:hover { background: var(--accent-soft); }
.led-table td.strong { font-weight: 600; }
.led-table tfoot td { border-bottom: none; padding: 7px 12px; color: var(--ink-soft); font-size: 13.5px; }
.led-table tfoot td:first-child { text-align: right; }
.led-grossRow td { font-family: "Fraunces", serif; font-weight: 600; font-size: 16px; color: var(--accent-deep); padding-top: 11px; border-top: 2px solid var(--line-strong); }

.led-vatBreak { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.led-vatPill { font-size: 12.5px; color: var(--ink-soft); background: var(--paper-3); border: 1px solid var(--line); padding: 5px 11px; border-radius: 999px; }
.led-vatPill strong { color: var(--accent-deep); }

/* Validatie */
.led-allGood { color: #2F5D3A; font-size: 14px; font-weight: 500; margin: 0; }
.led-issueList { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 9px; }
.led-issue { display: flex; gap: 11px; align-items: flex-start; padding: 11px 13px; border-radius: 12px; border: 1px solid; }
.led-issue.is-warning { background: rgba(190,140,70,0.09); border-color: rgba(190,140,70,0.3); }
.led-issue.is-error { background: rgba(176,86,76,0.09); border-color: rgba(176,86,76,0.32); }
.led-issueIcon { width: 20px; height: 20px; flex: none; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700; color: #fff; }
.led-issue.is-warning .led-issueIcon { background: #C08A3E; }
.led-issue.is-error .led-issueIcon { background: #B0564C; }
.led-issueField { display: block; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-faint); }
.led-issueMsg { display: block; font-size: 13.5px; color: var(--ink); margin-top: 1px; }

/* Export */
.led-exportBar { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; background: var(--paper-2); border: 1px solid var(--line); border-radius: 18px; padding: 14px 20px; }
.led-exportLabel { font-size: 12px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink-faint); }
.led-exportBtns { display: flex; gap: 8px; }
.led-exportBtn { font-family: "Fraunces", serif; font-weight: 600; font-size: 14px; cursor: pointer; color: var(--accent-deep); background: var(--paper); border: 1px solid var(--line-strong); padding: 8px 18px; border-radius: 11px; transition: background 0.2s ease, color 0.2s ease, transform 0.16s ease, border-color 0.2s ease; }
.led-exportBtn:hover { background: var(--accent); color: #F3EFE6; border-color: var(--accent); transform: translateY(-1px); }

/* Foutstaat */
.led-errorBox { display: flex; gap: 14px; align-items: flex-start; background: rgba(176,86,76,0.07); border: 1px solid rgba(176,86,76,0.28); border-radius: 16px; padding: 18px 20px; }
.led-errorGlyph { font-size: 24px; color: #B0564C; flex: none; }
.led-errorMsg { font-weight: 600; font-size: 15px; margin: 0 0 4px; color: #8C3A33; }
.led-muted { color: var(--ink-faint); font-size: 13px; margin: 0; }

/* Toast */
.led-toast {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
  background: var(--ink); color: var(--paper); font-size: 13.5px; font-weight: 500;
  padding: 11px 20px; border-radius: 999px; box-shadow: 0 12px 30px -10px rgba(0,0,0,0.5);
  animation: ledRise 0.4s cubic-bezier(0.22,0.61,0.36,1); z-index: 50;
}
`;

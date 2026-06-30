"use client";

// RASTER — compacte power-user grid voor boekhouders.
// "Excel maar mooi": hoge dichtheid, zebra-rijen, dunne scheidslijnen,
// monospace tabulaire cijfers overal en één enkel indigo accent.
// Eén bestand, volledig interactief op mock-data.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getMockInvoices, DESIGN_VARIANTS } from "@/lib/mock-invoices";
import { validateInvoice } from "@/lib/validate";
import { Invoice, Field, Party, InvoiceLine } from "@/lib/types";

// ---- Constanten & helpers ------------------------------------------------

const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
const fmtEUR = (n: number | null | undefined) => (n == null ? "—" : eur.format(n));

// Parse een NL/EN getalinvoer naar number | null (komma of punt als decimaal).
function parseNum(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// Status -> compacte chip-stijl.
const STATUS_META: Record<Invoice["status"], { label: string; fg: string; bg: string }> = {
  ok: { label: "OK", fg: "#047857", bg: "#E6F5EE" },
  partial: { label: "DEELS", fg: "#B45309", bg: "#FBF0E0" },
  error: { label: "FOUT", fg: "#B91C1C", bg: "#FBE9E7" },
};

// Bron -> korte code + kleur (subtiel, voor het herkomst-tintje per veld).
const SOURCE_META: Record<Field["source"], { code: string; color: string }> = {
  xml: { code: "XML", color: "#4F46E5" },
  regex: { code: "RGX", color: "#6B7280" },
  llm: { code: "LLM", color: "#7C3AED" },
  manual: { code: "HND", color: "#0F766E" },
  none: { code: "—", color: "#B6BAC1" },
};

// Kleur van het confidence-stipje.
function confColor(c: number): string {
  if (c >= 0.9) return "#4F46E5";
  if (c >= 0.6) return "#D97706";
  if (c > 0) return "#B91C1C";
  return "#D1D5DB";
}

// ---- Subcomponenten ------------------------------------------------------

// Bron-/confidence-indicatie: stipje + 3-letter broncode. Subtiel tot hover.
function Meta({ f }: { f: Field<unknown> }) {
  const s = SOURCE_META[f.source];
  return (
    <span className="rs-meta" title={`bron: ${f.source} · zekerheid ${(f.confidence * 100) | 0}%`}>
      <span className="rs-dot" style={{ background: confColor(f.confidence) }} />
      <span style={{ color: s.color }}>{s.code}</span>
    </span>
  );
}

// Bewerkbare cel (spreadsheet-gevoel): borderloze input, ring bij focus.
function Cell({
  value,
  onCommit,
  align = "left",
  mono = false,
  placeholder = "—",
}: {
  value: string;
  onCommit: (v: string) => void;
  align?: "left" | "right";
  mono?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      className={`rs-cell ${mono ? "rs-num" : ""}`}
      style={{ textAlign: align }}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => onCommit(e.target.value)}
    />
  );
}

// ---- Pagina --------------------------------------------------------------

export default function RasterPage() {
  const [invoices, setInvoices] = useState<Invoice[]>(() => getMockInvoices());
  const [selectedId, setSelectedId] = useState<string>(() => getMockInvoices()[0]?.id ?? "");
  const [scanning, setScanning] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Validatie per factuur (gememoïseerd op de lijst).
  const issuesByInvoice = useMemo(() => {
    const m = new Map<string, ReturnType<typeof validateInvoice>>();
    for (const inv of invoices) m.set(inv.id, validateInvoice(inv));
    return m;
  }, [invoices]);

  const selected = invoices.find((i) => i.id === selectedId) ?? null;
  const selIssues = selected ? issuesByInvoice.get(selected.id) ?? [] : [];

  // KPI-aggregaten.
  const kpi = useMemo(() => {
    let gross = 0;
    let issues = 0;
    const status: Record<Invoice["status"], number> = { ok: 0, partial: 0, error: 0 };
    for (const inv of invoices) {
      gross += inv.totalGross.value ?? 0;
      issues += issuesByInvoice.get(inv.id)?.length ?? 0;
      status[inv.status]++;
    }
    return { count: invoices.length, gross, issues, status };
  }, [invoices, issuesByInvoice]);

  // Toetsenbordnavigatie: ↑/↓ door de lijst (niet terwijl je in een cel typt).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      e.preventDefault();
      setSelectedId((cur) => {
        const idx = invoices.findIndex((i) => i.id === cur);
        const next = e.key === "ArrowDown" ? idx + 1 : idx - 1;
        if (next < 0 || next >= invoices.length) return cur;
        return invoices[next].id;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [invoices]);

  // Houd de geselecteerde rij in beeld bij toetsnavigatie.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-id="${selectedId}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  // Immutable update van één factuur via structuredClone.
  function updateInvoice(id: string, mut: (inv: Invoice) => void) {
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id !== id) return inv;
        const copy = structuredClone(inv);
        mut(copy);
        return copy;
      }),
    );
  }

  // Een Field<string> handmatig overschrijven (bron -> "manual").
  const setFieldStr = (mk: (inv: Invoice) => Field<string>, raw: string) => {
    if (!selected) return;
    updateInvoice(selected.id, (inv) => {
      const f = mk(inv);
      f.value = raw === "" ? null : raw;
      f.confidence = raw === "" ? 0 : 1;
      f.source = raw === "" ? "none" : "manual";
    });
  };

  // Een Field<number> handmatig overschrijven.
  const setFieldNum = (mk: (inv: Invoice) => Field<number>, raw: string) => {
    if (!selected) return;
    const n = parseNum(raw);
    updateInvoice(selected.id, (inv) => {
      const f = mk(inv);
      f.value = n;
      f.confidence = n == null ? 0 : 1;
      f.source = n == null ? "none" : "manual";
    });
  };

  // Een regelwaarde aanpassen.
  const setLine = (idx: number, key: keyof InvoiceLine, raw: string) => {
    if (!selected) return;
    updateInvoice(selected.id, (inv) => {
      const line = inv.lines[idx];
      if (!line) return;
      if (key === "description") line.description = raw;
      else (line[key] as number | null) = parseNum(raw);
    });
  };

  // Scan/upload: ~600ms "verwerken", recycle een seed met vers id.
  const handleScan = () => {
    if (scanning) return;
    setScanning(true);
    setTimeout(() => {
      const pool = getMockInvoices();
      const pick = structuredClone(pool[Math.floor(Math.random() * pool.length)]);
      pick.id = crypto.randomUUID();
      const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
      pick.fileName = `scan-${stamp}.${pick.fileType}`;
      setInvoices((prev) => [pick, ...prev]);
      setSelectedId(pick.id);
      setScanning(false);
    }, 600);
  };

  // Export (visueel + console.log; geen echte download in deze designvariant).
  const doExport = (kind: "CSV" | "JSON" | "UBL") => {
    if (!selected) return;
    console.log(`[RASTER] export ${kind}`, selected);
    setFlash(`${kind} geëxporteerd → console`);
    setTimeout(() => setFlash(null), 1600);
  };

  const fontLink =
    "https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Archivo+Narrow:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap";

  return (
    <div className="rs-root">
      {/* Next 15 hoist deze stylesheet-link naar <head>. */}
      <link rel="stylesheet" href={fontLink} />
      <style>{CSS}</style>

      {/* ---- Slanke header ---------------------------------------------- */}
      <header className="rs-header">
        <div className="rs-brand">
          <span className="rs-logo" />
          <span className="rs-appname">Inkoopfactuur Scanner</span>
          <span className="rs-badge">RASTER</span>
        </div>
        <nav className="rs-switch">
          {DESIGN_VARIANTS.map((v) => {
            const active = v.slug === "raster";
            return (
              <Link
                key={v.slug}
                href={`/designs/${v.slug}`}
                className={`rs-switch-link ${active ? "is-active" : ""}`}
                title={v.tagline}
              >
                {v.name}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* ---- Compacte KPI-regel ----------------------------------------- */}
      <div className="rs-kpi">
        <Kpi label="Facturen" value={String(kpi.count)} />
        <Kpi label="Totaal (incl. btw)" value={fmtEUR(kpi.gross)} mono />
        <Kpi label="Aandachtspunten" value={String(kpi.issues)} accent={kpi.issues > 0} />
        <div className="rs-kpi-status">
          <StatusPill s="ok" n={kpi.status.ok} />
          <StatusPill s="partial" n={kpi.status.partial} />
          <StatusPill s="error" n={kpi.status.error} />
        </div>
        <div className="rs-kpi-spacer" />
        <button className="rs-scan" onClick={handleScan} disabled={scanning}>
          {scanning ? (
            <>
              <span className="rs-spin" /> Verwerken…
            </>
          ) : (
            <>+ Scan / upload</>
          )}
        </button>
      </div>

      {/* ---- Body: sidebar + hoofdgrid ---------------------------------- */}
      <main className="rs-body">
        {/* Sidebar-lijst */}
        <aside className="rs-side">
          <div className="rs-side-head">
            <span>Wachtrij</span>
            <span className="rs-kbd-hint">↑/↓ navigeren</span>
          </div>
          <div className="rs-list" ref={listRef}>
            {invoices.map((inv, i) => {
              const meta = STATUS_META[inv.status];
              const n = issuesByInvoice.get(inv.id)?.length ?? 0;
              const active = inv.id === selectedId;
              return (
                <button
                  key={inv.id}
                  data-id={inv.id}
                  className={`rs-row ${i % 2 ? "odd" : ""} ${active ? "is-active" : ""}`}
                  onClick={() => setSelectedId(inv.id)}
                >
                  <span className="rs-chip" style={{ color: meta.fg, background: meta.bg }}>
                    {meta.label}
                  </span>
                  <span className="rs-row-main">
                    <span className="rs-row-file">{inv.fileName}</span>
                    <span className="rs-row-sup">{inv.supplier.name.value ?? "— onbekende leverancier"}</span>
                  </span>
                  <span className="rs-row-right">
                    <span className="rs-num rs-row-amt">{fmtEUR(inv.totalGross.value)}</span>
                    {n > 0 && <span className="rs-flag">{n}</span>}
                  </span>
                </button>
              );
            })}
            {invoices.length === 0 && <div className="rs-empty-list">Geen facturen in wachtrij.</div>}
          </div>
        </aside>

        {/* Hoofdgrid / detail */}
        <section className="rs-main">
          {!selected ? (
            <div className="rs-empty">
              <div className="rs-empty-icn">▦</div>
              <p>Selecteer een factuur uit de wachtrij of scan een nieuw bestand.</p>
            </div>
          ) : (
            <>
              {/* Toolbar */}
              <div className="rs-toolbar">
                <div className="rs-toolbar-id">
                  <span className="rs-chip" style={{ color: STATUS_META[selected.status].fg, background: STATUS_META[selected.status].bg }}>
                    {STATUS_META[selected.status].label}
                  </span>
                  <span className="rs-tb-file">{selected.fileName}</span>
                  <span className="rs-tb-fmt">{selected.detectedFormat}</span>
                </div>
                <div className="rs-export">
                  <span className="rs-export-lbl">Exporteren</span>
                  <button className="rs-exp" onClick={() => doExport("CSV")}>CSV</button>
                  <button className="rs-exp" onClick={() => doExport("JSON")}>JSON</button>
                  <button className="rs-exp rs-exp-accent" onClick={() => doExport("UBL")}>UBL</button>
                </div>
              </div>

              {selected.status === "error" ? (
                <div className="rs-error">
                  <strong>Verwerking mislukt.</strong>
                  <span>{selected.error ?? "Onbekende fout bij extractie."}</span>
                  <em>Corrigeer handmatig of scan opnieuw met een tekstlaag/OCR.</em>
                </div>
              ) : (
                <div className="rs-grids">
                  {/* Kop-velden als property-sheet */}
                  <div className="rs-panel">
                    <div className="rs-panel-h">Kopgegevens</div>
                    <div className="rs-props">
                      <Prop label="Factuurnr.">
                        <Cell value={selected.invoiceNumber.value ?? ""} onCommit={(v) => setFieldStr((i) => i.invoiceNumber, v)} mono />
                        <Meta f={selected.invoiceNumber} />
                      </Prop>
                      <Prop label="Factuurdatum">
                        <Cell value={selected.invoiceDate.value ?? ""} onCommit={(v) => setFieldStr((i) => i.invoiceDate, v)} mono placeholder="jjjj-mm-dd" />
                        <Meta f={selected.invoiceDate} />
                      </Prop>
                      <Prop label="Vervaldatum">
                        <Cell value={selected.dueDate.value ?? ""} onCommit={(v) => setFieldStr((i) => i.dueDate, v)} mono placeholder="jjjj-mm-dd" />
                        <Meta f={selected.dueDate} />
                      </Prop>
                      <Prop label="PO-nummer">
                        <Cell value={selected.poNumber.value ?? ""} onCommit={(v) => setFieldStr((i) => i.poNumber, v)} mono />
                        <Meta f={selected.poNumber} />
                      </Prop>
                      <Prop label="Betalingsref.">
                        <Cell value={selected.paymentReference.value ?? ""} onCommit={(v) => setFieldStr((i) => i.paymentReference, v)} mono />
                        <Meta f={selected.paymentReference} />
                      </Prop>
                      <Prop label="Valuta">
                        <Cell value={selected.currency.value ?? ""} onCommit={(v) => setFieldStr((i) => i.currency, v)} mono />
                        <Meta f={selected.currency} />
                      </Prop>
                    </div>
                  </div>

                  {/* Leverancier */}
                  <div className="rs-panel">
                    <div className="rs-panel-h">Leverancier</div>
                    <div className="rs-props">
                      <Prop label="Naam">
                        <Cell value={selected.supplier.name.value ?? ""} onCommit={(v) => setSupplier(selected.id, updateInvoice, "name", v)} />
                        <Meta f={selected.supplier.name} />
                      </Prop>
                      <Prop label="Adres">
                        <Cell value={selected.supplier.address.value ?? ""} onCommit={(v) => setSupplier(selected.id, updateInvoice, "address", v)} />
                        <Meta f={selected.supplier.address} />
                      </Prop>
                      <Prop label="BTW-nr.">
                        <Cell value={selected.supplier.vatNumber.value ?? ""} onCommit={(v) => setSupplier(selected.id, updateInvoice, "vatNumber", v)} mono />
                        <Meta f={selected.supplier.vatNumber} />
                      </Prop>
                      <Prop label="KvK">
                        <Cell value={selected.supplier.kvk.value ?? ""} onCommit={(v) => setSupplier(selected.id, updateInvoice, "kvk", v)} mono />
                        <Meta f={selected.supplier.kvk} />
                      </Prop>
                      <Prop label="IBAN">
                        <Cell value={selected.supplier.iban.value ?? ""} onCommit={(v) => setSupplier(selected.id, updateInvoice, "iban", v)} mono />
                        <Meta f={selected.supplier.iban} />
                      </Prop>
                    </div>
                  </div>

                  {/* Regels als spreadsheet */}
                  <div className="rs-panel rs-panel-wide">
                    <div className="rs-panel-h">
                      Regels <span className="rs-count">{selected.lines.length}</span>
                    </div>
                    <div className="rs-table-wrap">
                      <table className="rs-table">
                        <thead>
                          <tr>
                            <th className="rs-th-num">#</th>
                            <th>Omschrijving</th>
                            <th className="rs-th-r">Aantal</th>
                            <th className="rs-th-r">Stukprijs</th>
                            <th className="rs-th-r">BTW%</th>
                            <th className="rs-th-r">Regeltotaal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selected.lines.map((ln, idx) => (
                            <tr key={idx} className={idx % 2 ? "odd" : ""}>
                              <td className="rs-num rs-td-num">{idx + 1}</td>
                              <td className="rs-td-edit">
                                <Cell value={ln.description} onCommit={(v) => setLine(idx, "description", v)} placeholder="omschrijving…" />
                              </td>
                              <td className="rs-td-edit rs-td-r">
                                <Cell value={ln.quantity == null ? "" : String(ln.quantity)} onCommit={(v) => setLine(idx, "quantity", v)} align="right" mono />
                              </td>
                              <td className="rs-td-edit rs-td-r">
                                <Cell value={ln.unitPrice == null ? "" : String(ln.unitPrice)} onCommit={(v) => setLine(idx, "unitPrice", v)} align="right" mono />
                              </td>
                              <td className="rs-td-edit rs-td-r">
                                <Cell value={ln.vatRate == null ? "" : String(ln.vatRate)} onCommit={(v) => setLine(idx, "vatRate", v)} align="right" mono />
                              </td>
                              <td className="rs-td-edit rs-td-r">
                                <Cell value={ln.lineTotal == null ? "" : String(ln.lineTotal)} onCommit={(v) => setLine(idx, "lineTotal", v)} align="right" mono />
                              </td>
                            </tr>
                          ))}
                          {selected.lines.length === 0 && (
                            <tr>
                              <td colSpan={6} className="rs-td-empty">Geen regels herkend.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Totalen-strip (bewerkbaar) */}
                    <div className="rs-totals">
                      <TotalCell label="Subtotaal" f={selected.subtotal} onCommit={(v) => setFieldNum((i) => i.subtotal, v)} />
                      <TotalCell label="BTW" f={selected.totalVat} onCommit={(v) => setFieldNum((i) => i.totalVat, v)} />
                      <TotalCell label="Totaal" f={selected.totalGross} onCommit={(v) => setFieldNum((i) => i.totalGross, v)} strong />
                    </div>
                  </div>

                  {/* Validatie */}
                  <div className="rs-panel rs-panel-wide">
                    <div className="rs-panel-h">
                      Validatie <span className="rs-count">{selIssues.length}</span>
                    </div>
                    {selIssues.length === 0 ? (
                      <div className="rs-ok-line">✓ Geen aandachtspunten — factuur lijkt compleet.</div>
                    ) : (
                      <ul className="rs-issues">
                        {selIssues.map((iss, i) => (
                          <li key={i} className={`rs-issue rs-${iss.severity}`}>
                            <span className="rs-sev">{iss.severity === "error" ? "FOUT" : "LET OP"}</span>
                            <span className="rs-issue-field">{iss.field}</span>
                            <span className="rs-issue-msg">{iss.message}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {/* Export-flash */}
      {flash && <div className="rs-flash">{flash}</div>}
    </div>
  );
}

// ---- Kleine presentational helpers --------------------------------------

function Kpi({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: boolean }) {
  return (
    <div className="rs-kpi-item">
      <span className="rs-kpi-lbl">{label}</span>
      <span className={`rs-kpi-val ${mono ? "rs-num" : ""} ${accent ? "is-accent" : ""}`}>{value}</span>
    </div>
  );
}

function StatusPill({ s, n }: { s: Invoice["status"]; n: number }) {
  const m = STATUS_META[s];
  return (
    <span className="rs-statpill" style={{ color: m.fg, background: m.bg }}>
      {m.label} <b className="rs-num">{n}</b>
    </span>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rs-prop">
      <span className="rs-prop-lbl">{label}</span>
      <span className="rs-prop-val">{children}</span>
    </div>
  );
}

function TotalCell({ label, f, onCommit, strong }: { label: string; f: Field<number>; onCommit: (v: string) => void; strong?: boolean }) {
  return (
    <div className={`rs-total ${strong ? "is-strong" : ""}`}>
      <span className="rs-total-lbl">{label}</span>
      <span className="rs-total-val">
        <input
          className="rs-cell rs-num"
          style={{ textAlign: "right" }}
          value={f.value == null ? "" : String(f.value)}
          placeholder="0,00"
          spellCheck={false}
          onChange={(e) => onCommit(e.target.value)}
        />
        <Meta f={f} />
      </span>
    </div>
  );
}

// Leverancier-veld bijwerken (apart omdat het in een geneste Party zit).
function setSupplier(
  id: string,
  updater: (id: string, mut: (inv: Invoice) => void) => void,
  key: keyof Party,
  raw: string,
) {
  updater(id, (inv) => {
    const f = inv.supplier[key];
    f.value = raw === "" ? null : raw;
    f.confidence = raw === "" ? 0 : 1;
    f.source = raw === "" ? "none" : "manual";
  });
}

// ---- Stijl (RASTER) ------------------------------------------------------

const CSS = `
.rs-root {
  --bg: #F4F5F7;
  --panel: #FFFFFF;
  --ink: #1A1D21;
  --muted: #6B7280;
  --faint: #9AA0A8;
  --line: #E4E7EB;
  --line-strong: #D5D9DF;
  --accent: #4F46E5;
  --accent-soft: #EEEDFB;
  --zebra: #FAFBFC;
  font-family: "Archivo", system-ui, sans-serif;
  background: var(--bg);
  color: var(--ink);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
}
.rs-num { font-family: "IBM Plex Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; }

/* Header */
.rs-header {
  display: flex; align-items: center; justify-content: space-between;
  height: 46px; padding: 0 16px;
  background: var(--panel); border-bottom: 1px solid var(--line-strong);
}
.rs-brand { display: flex; align-items: center; gap: 9px; }
.rs-logo { width: 16px; height: 16px; border-radius: 3px; background: var(--accent);
  box-shadow: inset 0 0 0 3px var(--panel), inset 0 0 0 4px var(--accent); }
.rs-appname { font-family: "Archivo Narrow", "Archivo", sans-serif; font-weight: 700;
  font-size: 16px; letter-spacing: .01em; text-transform: uppercase; }
.rs-badge { font-family: "IBM Plex Mono", monospace; font-size: 10px; font-weight: 600;
  letter-spacing: .12em; color: var(--accent); background: var(--accent-soft);
  padding: 2px 6px; border-radius: 3px; }
.rs-switch { display: flex; gap: 2px; background: var(--bg); padding: 3px; border-radius: 6px;
  border: 1px solid var(--line); }
.rs-switch-link { font-family: "Archivo Narrow", sans-serif; font-weight: 600; font-size: 12px;
  text-transform: uppercase; letter-spacing: .04em; color: var(--muted);
  padding: 4px 10px; border-radius: 4px; text-decoration: none; transition: all .12s ease; }
.rs-switch-link:hover { color: var(--ink); background: #fff; }
.rs-switch-link.is-active { color: #fff; background: var(--accent); }

/* KPI-regel */
.rs-kpi { display: flex; align-items: stretch; gap: 0; height: 50px;
  background: var(--panel); border-bottom: 1px solid var(--line-strong); padding: 0 8px; }
.rs-kpi-item { display: flex; flex-direction: column; justify-content: center;
  padding: 0 16px; border-right: 1px solid var(--line); }
.rs-kpi-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .07em; color: var(--faint); }
.rs-kpi-val { font-size: 16px; font-weight: 700; line-height: 1.15; }
.rs-kpi-val.is-accent { color: #B45309; }
.rs-kpi-status { display: flex; align-items: center; gap: 6px; padding: 0 16px; }
.rs-kpi-spacer { flex: 1; }
.rs-statpill { font-size: 10.5px; font-weight: 600; letter-spacing: .04em;
  padding: 3px 7px; border-radius: 4px; display: inline-flex; gap: 5px; align-items: center; }
.rs-statpill b { font-weight: 700; }
.rs-scan { align-self: center; margin-right: 8px; font-family: "Archivo Narrow", sans-serif;
  font-weight: 700; font-size: 12.5px; text-transform: uppercase; letter-spacing: .05em;
  color: #fff; background: var(--accent); border: none; padding: 8px 14px; border-radius: 5px;
  cursor: pointer; display: inline-flex; align-items: center; gap: 7px; transition: background .12s; }
.rs-scan:hover:not(:disabled) { background: #4338CA; }
.rs-scan:disabled { opacity: .7; cursor: progress; }
.rs-spin { width: 11px; height: 11px; border: 2px solid rgba(255,255,255,.4);
  border-top-color: #fff; border-radius: 50%; animation: rs-spin .6s linear infinite; }
@keyframes rs-spin { to { transform: rotate(360deg); } }

/* Body */
.rs-body { flex: 1; display: flex; min-height: 0; }

/* Sidebar */
.rs-side { width: 290px; flex-shrink: 0; background: var(--panel);
  border-right: 1px solid var(--line-strong); display: flex; flex-direction: column; min-height: 0; }
.rs-side-head { display: flex; justify-content: space-between; align-items: center;
  height: 30px; padding: 0 12px; font-size: 10px; text-transform: uppercase; letter-spacing: .08em;
  color: var(--faint); border-bottom: 1px solid var(--line); background: var(--zebra); }
.rs-kbd-hint { font-family: "IBM Plex Mono", monospace; font-size: 10px; color: var(--faint); }
.rs-list { flex: 1; overflow-y: auto; }
.rs-row { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
  padding: 7px 10px; border: none; border-bottom: 1px solid var(--line); background: var(--panel);
  cursor: pointer; border-left: 2px solid transparent; transition: background .1s ease; }
.rs-row.odd { background: var(--zebra); }
.rs-row:hover { background: #F1F2F5; }
.rs-row.is-active { background: var(--accent-soft); border-left-color: var(--accent); }
.rs-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.rs-row-file { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; }
.rs-row-sup { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; }
.rs-row-right { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.rs-row-amt { font-size: 12px; font-weight: 600; }
.rs-flag { font-family: "IBM Plex Mono", monospace; font-size: 10px; font-weight: 600;
  color: #B45309; background: #FBF0E0; border-radius: 9px; padding: 0 6px; min-width: 16px;
  text-align: center; }
.rs-chip { font-family: "IBM Plex Mono", monospace; font-size: 9.5px; font-weight: 600;
  letter-spacing: .06em; padding: 2px 5px; border-radius: 3px; flex-shrink: 0; }
.rs-empty-list { padding: 20px; text-align: center; color: var(--faint); font-size: 12px; }

/* Main */
.rs-main { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
.rs-toolbar { display: flex; align-items: center; justify-content: space-between; height: 38px;
  padding: 0 14px; background: var(--panel); border-bottom: 1px solid var(--line-strong); }
.rs-toolbar-id { display: flex; align-items: center; gap: 10px; min-width: 0; }
.rs-tb-file { font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; }
.rs-tb-fmt { font-family: "IBM Plex Mono", monospace; font-size: 10px; color: var(--muted);
  background: var(--bg); border: 1px solid var(--line); padding: 1px 6px; border-radius: 3px;
  text-transform: uppercase; }
.rs-export { display: flex; align-items: center; gap: 6px; }
.rs-export-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .07em; color: var(--faint); }
.rs-exp { font-family: "IBM Plex Mono", monospace; font-size: 11px; font-weight: 600;
  color: var(--ink); background: var(--panel); border: 1px solid var(--line-strong);
  padding: 4px 11px; border-radius: 4px; cursor: pointer; transition: all .12s; }
.rs-exp:hover { border-color: var(--accent); color: var(--accent); }
.rs-exp-accent { color: #fff; background: var(--accent); border-color: var(--accent); }
.rs-exp-accent:hover { background: #4338CA; color: #fff; }

.rs-grids { flex: 1; overflow-y: auto; padding: 12px; display: grid;
  grid-template-columns: 1fr 1fr; gap: 12px; align-content: start; }
.rs-panel { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.rs-panel-wide { grid-column: 1 / -1; }
.rs-panel-h { font-family: "Archivo Narrow", sans-serif; font-weight: 700; font-size: 12px;
  text-transform: uppercase; letter-spacing: .06em; color: var(--muted);
  padding: 7px 12px; border-bottom: 1px solid var(--line); background: var(--zebra);
  display: flex; align-items: center; gap: 8px; }
.rs-count { font-family: "IBM Plex Mono", monospace; font-size: 10px; color: var(--accent);
  background: var(--accent-soft); padding: 1px 6px; border-radius: 9px; }

/* Property-sheet (kop + leverancier) */
.rs-props { display: flex; flex-direction: column; }
.rs-prop { display: grid; grid-template-columns: 116px 1fr; align-items: stretch;
  border-bottom: 1px solid var(--line); }
.rs-prop:last-child { border-bottom: none; }
.rs-prop:nth-child(even) { background: var(--zebra); }
.rs-prop-lbl { font-size: 11px; color: var(--muted); padding: 7px 12px;
  border-right: 1px solid var(--line); display: flex; align-items: center; }
.rs-prop-val { display: flex; align-items: center; gap: 6px; padding: 0 8px 0 0; min-width: 0; }

/* Bewerkbare cel */
.rs-cell { width: 100%; border: none; background: transparent; outline: none;
  font: inherit; color: var(--ink); padding: 7px 10px; border-radius: 3px;
  transition: box-shadow .1s ease, background .1s ease; }
.rs-cell.rs-num { font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums; }
.rs-cell::placeholder { color: var(--faint); }
.rs-cell:hover { background: #F3F4F7; }
.rs-cell:focus { background: #fff; box-shadow: inset 0 0 0 1.5px var(--accent); }

/* Veld-meta */
.rs-meta { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;
  font-family: "IBM Plex Mono", monospace; font-size: 9px; font-weight: 600; letter-spacing: .04em;
  opacity: .45; transition: opacity .12s; padding-right: 4px; }
.rs-prop:hover .rs-meta, .rs-total:hover .rs-meta { opacity: 1; }
.rs-dot { width: 6px; height: 6px; border-radius: 50%; }

/* Regel-tabel */
.rs-table-wrap { max-height: 320px; overflow-y: auto; }
.rs-table { width: 100%; border-collapse: collapse; }
.rs-table thead th { position: sticky; top: 0; z-index: 1; text-align: left;
  font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--faint);
  font-weight: 600; padding: 6px 10px; background: var(--zebra);
  border-bottom: 1px solid var(--line-strong); }
.rs-th-r { text-align: right; }
.rs-th-num { width: 34px; text-align: right; }
.rs-table tbody tr { border-bottom: 1px solid var(--line); }
.rs-table tbody tr.odd { background: var(--zebra); }
.rs-table tbody tr:hover { background: #F1F2F5; }
.rs-td-num { color: var(--faint); padding: 0 10px; text-align: right; width: 34px; font-size: 11px; }
.rs-td-edit { padding: 0; }
.rs-td-edit .rs-cell { padding: 6px 10px; }
.rs-td-r { text-align: right; }
.rs-td-empty { padding: 14px; text-align: center; color: var(--faint); font-size: 12px; }

/* Totalen */
.rs-totals { display: flex; justify-content: flex-end; gap: 0; border-top: 1px solid var(--line-strong);
  background: var(--zebra); }
.rs-total { display: flex; align-items: center; gap: 10px; padding: 6px 12px;
  border-left: 1px solid var(--line); }
.rs-total-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.rs-total-val { display: inline-flex; align-items: center; gap: 6px; }
.rs-total-val .rs-cell { width: 100px; font-weight: 600; }
.rs-total.is-strong .rs-total-lbl { color: var(--ink); font-weight: 700; }
.rs-total.is-strong .rs-cell { font-size: 15px; font-weight: 700; color: var(--accent); }

/* Validatie */
.rs-ok-line { padding: 12px 14px; font-size: 12px; color: #047857; }
.rs-issues { list-style: none; margin: 0; padding: 0; }
.rs-issue { display: flex; align-items: center; gap: 10px; padding: 7px 12px;
  border-bottom: 1px solid var(--line); font-size: 12px; }
.rs-issue:last-child { border-bottom: none; }
.rs-sev { font-family: "IBM Plex Mono", monospace; font-size: 9.5px; font-weight: 700;
  letter-spacing: .06em; padding: 2px 6px; border-radius: 3px; flex-shrink: 0; }
.rs-warning .rs-sev { color: #B45309; background: #FBF0E0; }
.rs-error .rs-sev { color: #B91C1C; background: #FBE9E7; }
.rs-issue-field { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: var(--accent);
  flex-shrink: 0; }
.rs-issue-msg { color: var(--ink); }

/* Error/leeg */
.rs-error { margin: 14px; padding: 16px; border: 1px solid #F3C9C4; background: #FCEFED;
  border-radius: 6px; display: flex; flex-direction: column; gap: 6px; }
.rs-error strong { color: #B91C1C; font-size: 14px; }
.rs-error span { color: var(--ink); }
.rs-error em { color: var(--muted); font-size: 12px; }
.rs-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; color: var(--faint); }
.rs-empty-icn { font-size: 40px; color: var(--line-strong); }

/* Flash */
.rs-flash { position: fixed; bottom: 18px; right: 18px; background: var(--ink); color: #fff;
  font-family: "IBM Plex Mono", monospace; font-size: 12px; padding: 9px 14px; border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,.18); animation: rs-fade .2s ease; z-index: 50; }
@keyframes rs-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
`;

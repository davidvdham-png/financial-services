"use client";

// COCKPIT — donker data-terminal voor inkoopfacturen.
// Eén zelfstandig bestand: mock-data, scan-simulatie, bewerkbare readout,
// validatie en (visuele) export. Esthetiek: bijna-zwart slate, emerald/amber
// accenten, mono-cijfers, scanline-grid en CSS-only motion.

import { useMemo, useState } from "react";
import Link from "next/link";
import { getMockInvoices, DESIGN_VARIANTS } from "@/lib/mock-invoices";
import { validateInvoice } from "@/lib/validate";
import { Invoice, Field, InvoiceStatus } from "@/lib/types";

// ---- Formatters ---------------------------------------------------------

// NL valutaformatter (tabulaire cijfers in de UI via CSS).
const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
const num = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 2 });

function fmtEur(v: number | null | undefined): string {
  return v == null ? "—" : eur.format(v);
}

// ---- Status-presentatie -------------------------------------------------

const STATUS_META: Record<InvoiceStatus, { label: string; dot: string; text: string; ring: string }> = {
  ok: { label: "OK", dot: "#34D399", text: "#34D399", ring: "rgba(52,211,153,0.35)" },
  partial: { label: "DEELS", dot: "#FBBF24", text: "#FBBF24", ring: "rgba(251,191,36,0.35)" },
  error: { label: "FOUT", dot: "#F87171", text: "#F87171", ring: "rgba(248,113,113,0.35)" },
};

// ---- Bewerkbare kop-velden ---------------------------------------------
// Elk veld wijst naar een Field<string> in de Invoice; bij bewerken klonen we
// immutably en zetten source op "manual".
interface EditableField {
  key: string;
  label: string;
  read: (i: Invoice) => Field;
}

const EDITABLE: EditableField[] = [
  { key: "invoiceNumber", label: "Factuurnr", read: (i) => i.invoiceNumber },
  { key: "invoiceDate", label: "Datum", read: (i) => i.invoiceDate },
  { key: "dueDate", label: "Vervaldatum", read: (i) => i.dueDate },
  { key: "poNumber", label: "PO-nummer", read: (i) => i.poNumber },
  { key: "paymentReference", label: "Betalingsken.", read: (i) => i.paymentReference },
  { key: "currency", label: "Valuta", read: (i) => i.currency },
  { key: "supplier.name", label: "Leverancier", read: (i) => i.supplier.name },
  { key: "supplier.address", label: "Adres", read: (i) => i.supplier.address },
  { key: "supplier.vatNumber", label: "BTW-nr", read: (i) => i.supplier.vatNumber },
  { key: "supplier.kvk", label: "KvK", read: (i) => i.supplier.kvk },
  { key: "supplier.iban", label: "IBAN", read: (i) => i.supplier.iban },
];

// Bron-afkortingen voor de readout-badges.
const SOURCE_META: Record<Field["source"], { glyph: string; tone: string }> = {
  xml: { glyph: "XML", tone: "#34D399" },
  regex: { glyph: "RGX", tone: "#FBBF24" },
  llm: { glyph: "LLM", tone: "#22D3EE" },
  manual: { glyph: "MAN", tone: "#A78BFA" },
  none: { glyph: "—", tone: "#475569" },
};

export default function CockpitPage() {
  const [invoices, setInvoices] = useState<Invoice[]>(() => getMockInvoices());
  const [selectedId, setSelectedId] = useState<string | null>(() => "inv_demo_1");
  const [scanning, setScanning] = useState(false);
  const [scanLog, setScanLog] = useState<string[]>([]);
  const [exportFlash, setExportFlash] = useState<string | null>(null);

  const selected = useMemo(
    () => invoices.find((i) => i.id === selectedId) ?? null,
    [invoices, selectedId],
  );

  // KPI-aggregaten.
  const kpis = useMemo(() => {
    const totalGross = invoices.reduce((s, i) => s + (i.totalGross.value ?? 0), 0);
    const issues = invoices.reduce((s, i) => s + validateInvoice(i).length, 0);
    const byStatus = invoices.reduce(
      (acc, i) => ((acc[i.status] = (acc[i.status] ?? 0) + 1), acc),
      {} as Record<InvoiceStatus, number>,
    );
    return { count: invoices.length, totalGross, issues, byStatus };
  }, [invoices]);

  const selectedIssues = useMemo(
    () => (selected ? validateInvoice(selected) : []),
    [selected],
  );

  // Scan-simulatie: nerveuze terminal-feed van ~700ms, daarna factuur toevoegen.
  function runScan() {
    if (scanning) return;
    setScanning(true);
    const pool = getMockInvoices();
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const fresh: Invoice = { ...pick, id: crypto.randomUUID() };

    const steps = [
      "› init scanner.daemon",
      `› mount ${fresh.fileName}`,
      `› detect format … ${fresh.detectedFormat}`,
      "› extract fields [████░░] 67%",
      "› validate checksum … iban·btw",
      "› commit → ledger ✓",
    ];
    setScanLog([]);
    steps.forEach((line, idx) => {
      setTimeout(() => setScanLog((l) => [...l, line]), 90 * (idx + 1));
    });

    setTimeout(() => {
      setInvoices((prev) => [fresh, ...prev]);
      setSelectedId(fresh.id);
      setScanning(false);
      setScanLog([]);
    }, 720);
  }

  // Immutabele veld-bewerking: clone via structuredClone, zet source=manual.
  function editField(invId: string, ef: EditableField, value: string) {
    setInvoices((prev) =>
      prev.map((i) => {
        if (i.id !== invId) return i;
        const clone = structuredClone(i);
        const f = ef.read(clone);
        f.value = value === "" ? null : value;
        f.source = "manual";
        f.confidence = 1;
        return clone;
      }),
    );
  }

  // Export (visueel / console).
  function doExport(kind: "CSV" | "JSON" | "UBL") {
    if (!selected) return;
    console.log(`[export:${kind}]`, selected.fileName, selected);
    setExportFlash(`${kind} geëxporteerd → ${selected.fileName}`);
    setTimeout(() => setExportFlash(null), 1800);
  }

  return (
    <div className="ck-root">
      {/* Fonts via gehoist <link>; mono-forward voor cijfers, Chivo voor koppen. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Chivo:wght@600;700;900&family=JetBrains+Mono:wght@400;500;700&display=swap"
      />

      <CockpitStyles />

      {/* ===== Header ===== */}
      <header className="ck-header">
        <div className="ck-brand">
          <span className="ck-reticle" aria-hidden />
          <div>
            <h1 className="ck-title">Inkoopfactuur Scanner</h1>
            <span className="ck-sub">{"// cockpit · ops-terminal"}</span>
          </div>
        </div>

        <div className="ck-headright">
          <span className={`ck-livebadge ${scanning ? "is-busy" : ""}`}>
            <span className="ck-pulse" />
            {scanning ? "SCANNING" : "LIVE"}
          </span>

          <nav className="ck-switch" aria-label="Design-varianten">
            {DESIGN_VARIANTS.map((v) => {
              const active = v.slug === "cockpit";
              return (
                <Link
                  key={v.slug}
                  href={`/designs/${v.slug}`}
                  className={`ck-switch-item ${active ? "is-active" : ""}`}
                  title={v.tagline}
                >
                  {v.name}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {/* ===== KPI-strip ===== */}
      <section className="ck-kpis">
        <Kpi i={0} label="FACTUREN" value={String(kpis.count)} accent="#22D3EE" />
        <Kpi i={1} label="TOTAAL BRUTO" value={eur.format(kpis.totalGross)} accent="#34D399" mono />
        <Kpi
          i={2}
          label="AANDACHTSPUNTEN"
          value={String(kpis.issues)}
          accent={kpis.issues ? "#FBBF24" : "#34D399"}
        />
        <Kpi
          i={3}
          label="STATUS"
          accent="#A78BFA"
          custom={
            <div className="ck-statline">
              <span style={{ color: STATUS_META.ok.text }}>{kpis.byStatus.ok ?? 0}·OK</span>
              <span style={{ color: STATUS_META.partial.text }}>{kpis.byStatus.partial ?? 0}·DEELS</span>
              <span style={{ color: STATUS_META.error.text }}>{kpis.byStatus.error ?? 0}·FOUT</span>
            </div>
          }
        />
      </section>

      {/* ===== Werkgebied ===== */}
      <main className="ck-main">
        {/* --- Lijst --- */}
        <aside className="ck-panel ck-list">
          <div className="ck-panel-head">
            <span className="ck-panel-title">INKOMEND</span>
            <button className="ck-scan" onClick={runScan} disabled={scanning}>
              {scanning ? "···" : "+ SCAN"}
            </button>
          </div>

          {scanning && (
            <div className="ck-terminal" role="status" aria-live="polite">
              {scanLog.map((l, idx) => (
                <div key={idx} className="ck-term-line" style={{ animationDelay: `${idx * 30}ms` }}>
                  {l}
                </div>
              ))}
              <span className="ck-caret" />
            </div>
          )}

          <ul className="ck-rows">
            {invoices.map((inv, idx) => {
              const sm = STATUS_META[inv.status];
              const issues = validateInvoice(inv).length;
              const active = inv.id === selectedId;
              return (
                <li
                  key={inv.id}
                  className={`ck-row ${active ? "is-active" : ""}`}
                  style={{ animationDelay: `${Math.min(idx, 12) * 28}ms` }}
                  onClick={() => setSelectedId(inv.id)}
                >
                  <span className="ck-row-status" style={{ color: sm.text }}>
                    <span className="ck-row-dot" style={{ background: sm.dot, boxShadow: `0 0 8px ${sm.ring}` }} />
                    {sm.label}
                  </span>
                  <div className="ck-row-body">
                    <span className="ck-row-supplier">{inv.supplier.name.value ?? "— onbekend —"}</span>
                    <span className="ck-row-file">{inv.fileName}</span>
                  </div>
                  <div className="ck-row-right">
                    <span className="ck-row-amount">{fmtEur(inv.totalGross.value)}</span>
                    {issues > 0 ? (
                      <span className="ck-row-issues">▲ {issues}</span>
                    ) : (
                      <span className="ck-row-clean">✓</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* --- Detail-readout --- */}
        <section className="ck-panel ck-detail">
          {!selected ? (
            <EmptyState />
          ) : selected.status === "error" ? (
            <ErrorState inv={selected} />
          ) : (
            <DetailReadout
              inv={selected}
              issues={selectedIssues}
              onEdit={(ef, val) => editField(selected.id, ef, val)}
              onExport={doExport}
            />
          )}

          {exportFlash && <div className="ck-flash">{exportFlash}</div>}
        </section>
      </main>
    </div>
  );
}

// ===== KPI-tegel =========================================================

function Kpi(props: {
  i: number;
  label: string;
  value?: string;
  accent: string;
  mono?: boolean;
  custom?: React.ReactNode;
}) {
  return (
    <div className="ck-kpi" style={{ animationDelay: `${props.i * 70}ms`, ["--accent" as string]: props.accent }}>
      <span className="ck-kpi-label">{props.label}</span>
      {props.custom ?? <span className={`ck-kpi-value ${props.mono ? "is-mono" : ""}`}>{props.value}</span>}
      <span className="ck-kpi-bar" />
    </div>
  );
}

// ===== Detail-readout ====================================================

function DetailReadout(props: {
  inv: Invoice;
  issues: ReturnType<typeof validateInvoice>;
  onEdit: (ef: EditableField, val: string) => void;
  onExport: (kind: "CSV" | "JSON" | "UBL") => void;
}) {
  const { inv, issues, onEdit, onExport } = props;
  const sm = STATUS_META[inv.status];

  return (
    <div className="ck-readout">
      {/* Kop */}
      <div className="ck-readhead">
        <div>
          <div className="ck-readtitle">
            <span className="ck-row-dot" style={{ background: sm.dot, boxShadow: `0 0 10px ${sm.ring}` }} />
            {inv.supplier.name.value ?? "— onbekende leverancier —"}
          </div>
          <div className="ck-readmeta">
            <span>{inv.fileName}</span>
            <span className="ck-chip">{inv.detectedFormat}</span>
            <span className="ck-chip">{inv.fileType.toUpperCase()}</span>
          </div>
        </div>
        <div className="ck-exports">
          {(["CSV", "JSON", "UBL"] as const).map((k) => (
            <button key={k} className="ck-export" onClick={() => onExport(k)}>
              ↓ {k}
            </button>
          ))}
        </div>
      </div>

      {/* Bewerkbare kop-velden */}
      <div className="ck-fields">
        {EDITABLE.map((ef) => {
          const f = ef.read(inv);
          const meta = SOURCE_META[f.source];
          return (
            <label key={ef.key} className="ck-fieldcell">
              <span className="ck-fieldlabel">
                {ef.label}
                <span className="ck-srcbadge" style={{ color: meta.tone, borderColor: meta.tone }}>
                  {meta.glyph}
                </span>
              </span>
              <input
                className="ck-input"
                value={f.value ?? ""}
                placeholder="— leeg —"
                spellCheck={false}
                onChange={(e) => onEdit(ef, e.target.value)}
              />
              <ConfBar conf={f.confidence} />
            </label>
          );
        })}
      </div>

      {/* Regels */}
      <div className="ck-section-label">REGELS · {inv.lines.length}</div>
      <div className="ck-table-wrap">
        <table className="ck-table">
          <thead>
            <tr>
              <th>Omschrijving</th>
              <th className="r">Aantal</th>
              <th className="r">Stuksprijs</th>
              <th className="r">BTW</th>
              <th className="r">Regeltotaal</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((ln, idx) => (
              <tr key={idx}>
                <td>{ln.description}</td>
                <td className="r mono">{ln.quantity == null ? "—" : num.format(ln.quantity)}</td>
                <td className="r mono">{fmtEur(ln.unitPrice)}</td>
                <td className="r mono">{ln.vatRate == null ? "—" : `${ln.vatRate}%`}</td>
                <td className="r mono">{fmtEur(ln.lineTotal)}</td>
              </tr>
            ))}
            {inv.lines.length === 0 && (
              <tr>
                <td colSpan={5} className="ck-emptyrow">geen regels herkend</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="r">Subtotaal</td>
              <td className="r mono">{fmtEur(inv.subtotal.value)}</td>
            </tr>
            <tr>
              <td colSpan={4} className="r">BTW</td>
              <td className="r mono">{fmtEur(inv.totalVat.value)}</td>
            </tr>
            <tr className="ck-grand">
              <td colSpan={4} className="r">TOTAAL</td>
              <td className="r mono">{fmtEur(inv.totalGross.value)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Validatie */}
      <div className="ck-section-label">
        VALIDATIE · {issues.length === 0 ? "schoon" : `${issues.length} signalen`}
      </div>
      <div className="ck-issues">
        {issues.length === 0 ? (
          <div className="ck-issue is-clean">✓ Alle controles geslaagd — geen afwijkingen.</div>
        ) : (
          issues.map((iss, idx) => (
            <div
              key={idx}
              className={`ck-issue ${iss.severity === "error" ? "is-error" : "is-warn"}`}
              style={{ animationDelay: `${idx * 40}ms` }}
            >
              <span className="ck-issue-tag">{iss.severity === "error" ? "ERR" : "WRN"}</span>
              <span className="ck-issue-field">{iss.field}</span>
              <span className="ck-issue-msg">{iss.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Confidence-balk onder elk veld.
function ConfBar({ conf }: { conf: number }) {
  const pct = Math.round(conf * 100);
  const color = conf >= 0.9 ? "#34D399" : conf >= 0.6 ? "#FBBF24" : "#F87171";
  return (
    <span className="ck-conf" title={`betrouwbaarheid ${pct}%`}>
      <span className="ck-conf-fill" style={{ width: `${pct}%`, background: color, boxShadow: `0 0 6px ${color}` }} />
    </span>
  );
}

// ===== Lege / fout-states ================================================

function EmptyState() {
  return (
    <div className="ck-empty">
      <span className="ck-reticle big" aria-hidden />
      <p className="ck-empty-title">Geen factuur geselecteerd</p>
      <p className="ck-empty-sub">Kies links een record of voer een scan uit.</p>
    </div>
  );
}

function ErrorState({ inv }: { inv: Invoice }) {
  return (
    <div className="ck-empty is-error">
      <span className="ck-errglyph" aria-hidden>✕</span>
      <p className="ck-empty-title" style={{ color: "#F87171" }}>Extractie mislukt</p>
      <p className="ck-empty-sub">{inv.error ?? "Onbekende fout bij verwerken."}</p>
      <span className="ck-chip" style={{ marginTop: 14 }}>{inv.fileName}</span>
    </div>
  );
}

// ===== Styles ============================================================

function CockpitStyles() {
  return (
    <style>{`
      .ck-root{
        --bg:#0A0E14; --panel:#0D1117; --panel2:#11161F;
        --line:rgba(148,163,184,0.12); --line2:rgba(148,163,184,0.07);
        --txt:#C9D4E3; --dim:#64748B; --emerald:#34D399; --amber:#FBBF24; --cyan:#22D3EE;
        min-height:100vh; background:var(--bg); color:var(--txt);
        font-family:"JetBrains Mono", ui-monospace, monospace;
        font-feature-settings:"tnum" 1; font-variant-numeric:tabular-nums;
        position:relative; overflow-x:hidden;
      }
      /* Scanline + grid achtergrond */
      .ck-root::before{
        content:""; position:fixed; inset:0; pointer-events:none; z-index:0;
        background-image:
          linear-gradient(var(--line2) 1px, transparent 1px),
          linear-gradient(90deg, var(--line2) 1px, transparent 1px);
        background-size:42px 42px; mask-image:radial-gradient(circle at 50% 0%, #000 0%, transparent 85%);
      }
      .ck-root::after{
        content:""; position:fixed; inset:0; pointer-events:none; z-index:0; opacity:0.35;
        background:repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0 2px, transparent 2px 4px);
        animation:ck-scan 8s linear infinite;
      }
      @keyframes ck-scan{ from{background-position:0 0} to{background-position:0 100px} }
      .ck-root > *{ position:relative; z-index:1; }

      h1,h2,.ck-title{ font-family:"Chivo", sans-serif; }

      /* Header */
      .ck-header{
        display:flex; align-items:center; justify-content:space-between; gap:16px;
        padding:18px 26px; border-bottom:1px solid var(--line);
        background:linear-gradient(180deg, rgba(13,17,23,0.9), rgba(10,14,20,0.6));
        backdrop-filter:blur(6px);
      }
      .ck-brand{ display:flex; align-items:center; gap:14px; }
      .ck-title{ font-size:18px; font-weight:900; letter-spacing:0.5px; margin:0; color:#E6EDF5; }
      .ck-sub{ font-size:11px; color:var(--dim); letter-spacing:1px; }
      .ck-reticle{
        width:26px; height:26px; border:1.5px solid var(--emerald); border-radius:50%;
        position:relative; box-shadow:0 0 12px rgba(52,211,153,0.4); flex:0 0 auto;
      }
      .ck-reticle::before,.ck-reticle::after{
        content:""; position:absolute; background:var(--emerald);
      }
      .ck-reticle::before{ left:50%; top:3px; bottom:3px; width:1px; transform:translateX(-50%); }
      .ck-reticle::after{ top:50%; left:3px; right:3px; height:1px; transform:translateY(-50%); }
      .ck-reticle.big{ width:64px; height:64px; animation:ck-spin 12s linear infinite; }
      @keyframes ck-spin{ to{ transform:rotate(360deg) } }

      .ck-headright{ display:flex; align-items:center; gap:18px; }
      .ck-livebadge{
        display:inline-flex; align-items:center; gap:8px; font-size:11px; letter-spacing:1.5px;
        font-weight:700; color:var(--emerald); padding:5px 11px; border:1px solid rgba(52,211,153,0.3);
        border-radius:4px; background:rgba(52,211,153,0.06);
      }
      .ck-livebadge.is-busy{ color:var(--amber); border-color:rgba(251,191,36,0.4); background:rgba(251,191,36,0.07); }
      .ck-pulse{ width:7px; height:7px; border-radius:50%; background:currentColor; animation:ck-blink 1.1s ease-in-out infinite; }
      @keyframes ck-blink{ 0%,100%{ opacity:1; box-shadow:0 0 8px currentColor } 50%{ opacity:0.25; box-shadow:none } }

      .ck-switch{ display:flex; gap:2px; padding:3px; border:1px solid var(--line); border-radius:6px; background:var(--panel); }
      .ck-switch-item{
        font-size:12px; padding:6px 12px; border-radius:4px; color:var(--dim); text-decoration:none;
        letter-spacing:0.4px; transition:all .18s ease; font-family:"Chivo", sans-serif; font-weight:600;
      }
      .ck-switch-item:hover{ color:var(--txt); background:var(--panel2); }
      .ck-switch-item.is-active{ color:#04150E; background:var(--emerald); box-shadow:0 0 14px rgba(52,211,153,0.4); }

      /* KPI-strip */
      .ck-kpis{
        display:grid; grid-template-columns:repeat(4,1fr); gap:14px; padding:20px 26px;
      }
      .ck-kpi{
        position:relative; padding:16px 18px; border:1px solid var(--line); border-radius:8px;
        background:linear-gradient(160deg, var(--panel2), var(--panel));
        overflow:hidden; opacity:0; transform:translateY(10px); animation:ck-rise .5s ease forwards;
      }
      .ck-kpi:hover{ border-color:color-mix(in srgb, var(--accent) 50%, transparent); box-shadow:0 0 22px -6px var(--accent); }
      @keyframes ck-rise{ to{ opacity:1; transform:none } }
      .ck-kpi-label{ display:block; font-size:10px; letter-spacing:2px; color:var(--dim); margin-bottom:8px; }
      .ck-kpi-value{ display:block; font-size:30px; font-weight:700; color:#E6EDF5; line-height:1; font-family:"Chivo", sans-serif; }
      .ck-kpi-value.is-mono{ font-family:"JetBrains Mono", monospace; font-size:26px; color:var(--accent); }
      .ck-kpi-bar{ position:absolute; left:0; bottom:0; height:2px; width:100%; background:linear-gradient(90deg, var(--accent), transparent); opacity:0.7; }
      .ck-statline{ display:flex; gap:14px; font-size:15px; font-weight:700; }

      /* Layout */
      .ck-main{ display:grid; grid-template-columns:minmax(320px, 380px) 1fr; gap:14px; padding:0 26px 26px; align-items:start; }
      .ck-panel{ border:1px solid var(--line); border-radius:10px; background:rgba(13,17,23,0.7); backdrop-filter:blur(2px); }

      /* Lijst */
      .ck-list{ display:flex; flex-direction:column; max-height:calc(100vh - 230px); }
      .ck-panel-head{ display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-bottom:1px solid var(--line); }
      .ck-panel-title{ font-size:11px; letter-spacing:2px; color:var(--dim); }
      .ck-scan{
        font-family:"JetBrains Mono", monospace; font-size:11px; font-weight:700; letter-spacing:1px;
        color:#04150E; background:var(--emerald); border:none; padding:6px 12px; border-radius:5px; cursor:pointer;
        transition:all .15s ease; box-shadow:0 0 0 rgba(52,211,153,0);
      }
      .ck-scan:hover:not(:disabled){ box-shadow:0 0 16px rgba(52,211,153,0.55); transform:translateY(-1px); }
      .ck-scan:disabled{ opacity:0.5; cursor:wait; }

      .ck-terminal{
        margin:10px 12px; padding:10px 12px; border:1px solid rgba(34,211,238,0.25); border-radius:6px;
        background:rgba(34,211,238,0.04); font-size:11px; color:var(--cyan); line-height:1.7; min-height:60px;
      }
      .ck-term-line{ opacity:0; animation:ck-typein .25s ease forwards; white-space:nowrap; }
      @keyframes ck-typein{ from{ opacity:0; transform:translateX(-4px) } to{ opacity:1; transform:none } }
      .ck-caret{ display:inline-block; width:7px; height:13px; background:var(--cyan); animation:ck-blink 0.8s steps(1) infinite; vertical-align:middle; }

      .ck-rows{ list-style:none; margin:0; padding:6px; overflow-y:auto; flex:1; }
      .ck-row{
        display:grid; grid-template-columns:62px 1fr auto; gap:10px; align-items:center;
        padding:10px 12px; border-radius:7px; cursor:pointer; border:1px solid transparent;
        opacity:0; transform:translateX(-6px); animation:ck-slidein .4s ease forwards; transition:background .15s ease, border-color .15s ease;
      }
      @keyframes ck-slidein{ to{ opacity:1; transform:none } }
      .ck-row:hover{ background:var(--panel2); }
      .ck-row.is-active{ background:linear-gradient(90deg, rgba(52,211,153,0.1), transparent); border-color:rgba(52,211,153,0.3); }
      .ck-row-status{ display:flex; align-items:center; gap:6px; font-size:10px; font-weight:700; letter-spacing:0.5px; }
      .ck-row-dot{ width:7px; height:7px; border-radius:50%; flex:0 0 auto; animation:ck-blink 2.2s ease-in-out infinite; }
      .ck-row-body{ display:flex; flex-direction:column; min-width:0; }
      .ck-row-supplier{ font-family:"Chivo", sans-serif; font-weight:600; font-size:13px; color:#E6EDF5; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .ck-row-file{ font-size:10px; color:var(--dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .ck-row-right{ display:flex; flex-direction:column; align-items:flex-end; gap:3px; }
      .ck-row-amount{ font-size:13px; font-weight:700; color:var(--txt); }
      .ck-row-issues{ font-size:10px; color:var(--amber); }
      .ck-row-clean{ font-size:11px; color:var(--emerald); }

      /* Detail */
      .ck-detail{ min-height:calc(100vh - 230px); position:relative; }
      .ck-readout{ padding:20px 22px; animation:ck-fade .35s ease; }
      @keyframes ck-fade{ from{ opacity:0 } to{ opacity:1 } }
      .ck-readhead{ display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding-bottom:16px; border-bottom:1px solid var(--line); }
      .ck-readtitle{ display:flex; align-items:center; gap:9px; font-family:"Chivo", sans-serif; font-weight:700; font-size:19px; color:#F0F5FB; }
      .ck-readmeta{ display:flex; align-items:center; gap:10px; margin-top:7px; font-size:11px; color:var(--dim); flex-wrap:wrap; }
      .ck-chip{ font-size:10px; letter-spacing:1px; padding:3px 7px; border:1px solid var(--line); border-radius:4px; color:var(--cyan); background:rgba(34,211,238,0.05); }
      .ck-exports{ display:flex; gap:6px; }
      .ck-export{
        font-family:"JetBrains Mono", monospace; font-size:11px; font-weight:700; color:var(--txt);
        background:var(--panel2); border:1px solid var(--line); padding:7px 11px; border-radius:5px; cursor:pointer;
        transition:all .15s ease;
      }
      .ck-export:hover{ border-color:var(--emerald); color:var(--emerald); box-shadow:0 0 12px -2px rgba(52,211,153,0.5); }

      .ck-fields{ display:grid; grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); gap:12px; padding:18px 0; }
      .ck-fieldcell{ display:flex; flex-direction:column; gap:5px; }
      .ck-fieldlabel{ display:flex; align-items:center; justify-content:space-between; font-size:10px; letter-spacing:1px; color:var(--dim); }
      .ck-srcbadge{ font-size:8px; font-weight:700; padding:1px 4px; border:1px solid; border-radius:3px; letter-spacing:0.5px; }
      .ck-input{
        font-family:"JetBrains Mono", monospace; font-size:13px; color:#E6EDF5; background:var(--panel);
        border:1px solid var(--line); border-radius:5px; padding:8px 10px; outline:none; transition:all .15s ease; width:100%;
      }
      .ck-input::placeholder{ color:#3B4655; }
      .ck-input:focus{ border-color:var(--emerald); box-shadow:0 0 0 1px rgba(52,211,153,0.3), 0 0 16px -4px rgba(52,211,153,0.6); background:#0B1118; }
      .ck-conf{ display:block; height:2px; background:rgba(148,163,184,0.12); border-radius:2px; overflow:hidden; }
      .ck-conf-fill{ display:block; height:100%; transition:width .3s ease; }

      .ck-section-label{ font-size:10px; letter-spacing:2px; color:var(--dim); margin:18px 0 10px; padding-bottom:6px; border-bottom:1px dashed var(--line); }

      .ck-table-wrap{ overflow-x:auto; border:1px solid var(--line); border-radius:8px; }
      .ck-table{ width:100%; border-collapse:collapse; font-size:12.5px; }
      .ck-table th{ text-align:left; font-size:10px; letter-spacing:1px; color:var(--dim); font-weight:500; padding:10px 12px; border-bottom:1px solid var(--line); background:var(--panel2); }
      .ck-table td{ padding:9px 12px; border-bottom:1px solid var(--line2); color:var(--txt); }
      .ck-table tbody tr:hover{ background:rgba(34,211,238,0.03); }
      .ck-table .r{ text-align:right; }
      .ck-table .mono{ font-family:"JetBrains Mono", monospace; }
      .ck-table tfoot td{ color:var(--dim); padding:7px 12px; border:none; }
      .ck-table tfoot .ck-grand td{ color:#F0F5FB; font-weight:700; font-size:14px; border-top:1px solid var(--line); padding-top:11px; }
      .ck-table tfoot .ck-grand td.mono{ color:var(--emerald); }
      .ck-emptyrow{ text-align:center; color:var(--dim); font-style:italic; padding:18px; }

      .ck-issues{ display:flex; flex-direction:column; gap:7px; }
      .ck-issue{
        display:flex; align-items:center; gap:11px; font-size:12px; padding:9px 12px; border-radius:6px;
        border:1px solid var(--line); background:var(--panel); opacity:0; transform:translateX(-6px); animation:ck-slidein .35s ease forwards;
      }
      .ck-issue.is-clean{ color:var(--emerald); border-color:rgba(52,211,153,0.25); background:rgba(52,211,153,0.05); }
      .ck-issue.is-warn{ border-color:rgba(251,191,36,0.3); }
      .ck-issue.is-error{ border-color:rgba(248,113,113,0.35); background:rgba(248,113,113,0.05); }
      .ck-issue-tag{ font-size:9px; font-weight:700; letter-spacing:1px; padding:2px 6px; border-radius:3px; }
      .ck-issue.is-warn .ck-issue-tag{ color:#04150E; background:var(--amber); }
      .ck-issue.is-error .ck-issue-tag{ color:#fff; background:#F87171; }
      .ck-issue-field{ font-family:"JetBrains Mono", monospace; color:var(--cyan); font-size:11px; }
      .ck-issue-msg{ color:var(--txt); }

      /* Lege / fout-states */
      .ck-empty{ display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; min-height:420px; gap:8px; padding:40px; }
      .ck-empty-title{ font-family:"Chivo", sans-serif; font-weight:700; font-size:18px; color:#E6EDF5; margin:14px 0 0; }
      .ck-empty-sub{ font-size:12px; color:var(--dim); margin:0; }
      .ck-errglyph{ width:60px; height:60px; display:flex; align-items:center; justify-content:center; font-size:30px; color:#F87171; border:2px solid rgba(248,113,113,0.4); border-radius:50%; box-shadow:0 0 24px -4px rgba(248,113,113,0.5); animation:ck-blink 2s ease-in-out infinite; }

      .ck-flash{
        position:absolute; bottom:18px; left:50%; transform:translateX(-50%);
        font-size:12px; color:#04150E; background:var(--emerald); padding:9px 16px; border-radius:6px;
        box-shadow:0 0 24px -4px rgba(52,211,153,0.7); animation:ck-flash .3s ease; font-weight:700;
      }
      @keyframes ck-flash{ from{ opacity:0; transform:translate(-50%, 8px) } to{ opacity:1; transform:translate(-50%,0) } }

      @media (max-width:920px){
        .ck-kpis{ grid-template-columns:repeat(2,1fr); }
        .ck-main{ grid-template-columns:1fr; }
        .ck-list{ max-height:none; }
      }
    `}</style>
  );
}

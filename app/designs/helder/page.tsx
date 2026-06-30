"use client";

// ───────────────────────────────────────────────────────────────────────────
// Design-variant "HELDER" — strakke Swiss-SaaS voor het inkoopfactuur-dashboard.
// Zuiver wit canvas, bijna-zwarte inkt, één zelfverzekerd kobalt-accent en
// haarlijn-borders. Alles draait op mock-data en is volledig interactief.
// ───────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import Link from "next/link";
import { getMockInvoices, DESIGN_VARIANTS } from "@/lib/mock-invoices";
import { validateInvoice } from "@/lib/validate";
import { Invoice, FieldSource, InvoiceStatus } from "@/lib/types";

// ── Designtokens ────────────────────────────────────────────────────────────
const INK = "#0B0B0C"; // bijna-zwarte inkt
const ACCENT = "#2347FF"; // zelfverzekerd elektrisch kobalt
const HAIRLINE = "#E6E6EA"; // haarlijn-border
const MUTE = "#6B6B73"; // gedempte secundaire tekst
const CANVAS = "#FFFFFF";

// Lettertypes: Bricolage Grotesque (display, distinctieve geometrische grotesk),
// Hanken Grotesk (body) en Geist Mono (mono-cijfers). Géén system-fonts.
const FONT_DISPLAY = "'Bricolage Grotesque', sans-serif";
const FONT_BODY = "'Hanken Grotesk', sans-serif";
const FONT_MONO = "'Geist Mono', ui-monospace, monospace";

// NL-valutaformaat — overal hergebruikt.
const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
const fmt = (v: number | null | undefined) => (v == null ? "—" : eur.format(v));

// ── Status-styling ──────────────────────────────────────────────────────────
const STATUS: Record<InvoiceStatus, { label: string; dot: string; tint: string; ink: string }> = {
  ok: { label: "Herkend", dot: "#0E9F6E", tint: "#ECFAF3", ink: "#0A6B4A" },
  partial: { label: "Deels", dot: "#D98A0B", tint: "#FCF5E8", ink: "#8A5A06" },
  error: { label: "Fout", dot: "#D6453D", tint: "#FCEDEC", ink: "#9A2A24" },
};

// Herkomst-labels van een veld (toont vertrouwen in de extractie).
const SOURCE_LABEL: Record<FieldSource, string> = {
  xml: "XML",
  regex: "Regex",
  llm: "AI",
  manual: "Handmatig",
  none: "—",
};

// ── Kleine presentatie-componenten ──────────────────────────────────────────

/** Subtiel chipje dat bron + betrouwbaarheid van een veld toont. */
function SourceTag({ source, confidence }: { source: FieldSource; confidence: number }) {
  const isManual = source === "manual";
  const pct = Math.round(confidence * 100);
  return (
    <span
      style={{
        fontFamily: FONT_MONO,
        fontSize: 10,
        letterSpacing: "0.04em",
        color: isManual ? ACCENT : MUTE,
        borderColor: HAIRLINE,
      }}
      className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 leading-none"
    >
      <span>{SOURCE_LABEL[source]}</span>
      {source !== "none" && !isManual && <span style={{ opacity: 0.6 }}>{pct}%</span>}
    </span>
  );
}

/** Bewerkbaar kop-veld met label en herkomst-chip. */
function FieldRow({
  label,
  value,
  source,
  confidence,
  mono,
  onChange,
}: {
  label: string;
  value: string;
  source: FieldSource;
  confidence: number;
  mono?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between">
        <span style={{ color: MUTE, fontSize: 11, letterSpacing: "0.06em" }} className="uppercase">
          {label}
        </span>
        <SourceTag source={source} confidence={confidence} />
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        style={{
          fontFamily: mono ? FONT_MONO : FONT_BODY,
          color: INK,
          borderColor: HAIRLINE,
        }}
        className="w-full rounded-lg border bg-white px-3 py-2 text-[14px] outline-none transition-[border-color,box-shadow] duration-200 focus:shadow-[0_0_0_3px_rgba(35,71,255,0.12)] focus:border-[#2347FF]"
      />
    </label>
  );
}

/** Compacte KPI-kaart in de bovenstrip. */
function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div
      style={{ borderColor: HAIRLINE }}
      className="rounded-xl border bg-white px-4 py-3.5"
    >
      <div style={{ color: MUTE, fontSize: 11, letterSpacing: "0.06em" }} className="uppercase">
        {label}
      </div>
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          color: accent ? ACCENT : INK,
          fontSize: 26,
          fontWeight: 600,
          lineHeight: 1.1,
          fontVariantNumeric: "tabular-nums",
        }}
        className="mt-1"
      >
        {value}
      </div>
      {sub && (
        <div style={{ color: MUTE, fontSize: 12 }} className="mt-0.5">
          {sub}
        </div>
      )}
    </div>
  );
}

// ── Hoofdcomponent ──────────────────────────────────────────────────────────

export default function HelderPage() {
  const [invoices, setInvoices] = useState<Invoice[]>(() => getMockInvoices());
  const [selectedId, setSelectedId] = useState<string | null>(() => "inv_demo_1");
  const [scanning, setScanning] = useState(false);
  const [exported, setExported] = useState<string | null>(null);

  const selected = invoices.find((i) => i.id === selectedId) ?? null;

  // KPI-berekeningen (memo zodat ze niet bij elke render opnieuw rekenen).
  const kpis = useMemo(() => {
    const totalGross = invoices.reduce((s, i) => s + (i.totalGross.value ?? 0), 0);
    const withIssues = invoices.filter((i) => validateInvoice(i).length > 0).length;
    const counts: Record<InvoiceStatus, number> = { ok: 0, partial: 0, error: 0 };
    invoices.forEach((i) => (counts[i.status] += 1));
    return { totalGross, withIssues, counts };
  }, [invoices]);

  // ── Upload-simulatie: ~700ms shimmer, daarna een verse factuur toevoegen. ──
  function handleScan() {
    if (scanning) return;
    setScanning(true);
    window.setTimeout(() => {
      const pool = getMockInvoices();
      const pick = pool[Math.floor(Math.random() * pool.length)];
      // Verse kloon met een nieuw id, zodat bewerken los staat van de rest.
      const fresh: Invoice = {
        ...structuredClone(pick),
        id: crypto.randomUUID(),
        fileName: pick.fileName.replace(/\.(pdf|xml)$/i, "-nieuw.$1"),
      };
      setInvoices((prev) => [fresh, ...prev]);
      setSelectedId(fresh.id);
      setScanning(false);
    }, 700);
  }

  // ── Immutable veld-updates: clone, zet waarde, markeer bron als "manual". ──
  function patchSelected(mutate: (inv: Invoice) => void) {
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id !== selectedId) return inv;
        const clone = structuredClone(inv);
        mutate(clone);
        return clone;
      }),
    );
  }

  function setSupplierName(v: string) {
    patchSelected((inv) => {
      inv.supplier.name = { value: v || null, confidence: 1, source: "manual" };
    });
  }
  function setSupplierIban(v: string) {
    patchSelected((inv) => {
      inv.supplier.iban = { value: v || null, confidence: 1, source: "manual" };
    });
  }
  function setHeaderString(key: "invoiceNumber" | "invoiceDate" | "dueDate", v: string) {
    patchSelected((inv) => {
      inv[key] = { value: v || null, confidence: 1, source: "manual" };
    });
  }
  function setAmount(key: "subtotal" | "totalVat" | "totalGross", raw: string) {
    // NL-invoer toestaan: komma → punt; lege invoer → null.
    const num = raw.trim() === "" ? null : Number(raw.replace(/\./g, "").replace(",", "."));
    patchSelected((inv) => {
      inv[key] = { value: num != null && Number.isNaN(num) ? null : num, confidence: 1, source: "manual" };
    });
  }

  // Export — visueel bevestigen + naar console (geen echte download in deze demo).
  function handleExport(kind: "CSV" | "JSON" | "UBL") {
    if (!selected) return;
    console.log(`[helder] export ${kind}`, selected);
    setExported(kind);
    window.setTimeout(() => setExported(null), 1600);
  }

  const issues = selected ? validateInvoice(selected) : [];

  return (
    <div
      style={{ background: CANVAS, color: INK, fontFamily: FONT_BODY }}
      className="min-h-screen w-full"
    >
      {/* Fonts direct in de JSX — Next 15 hoist deze naar de <head>. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700&family=Hanken+Grotesk:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap"
      />

      {/* Page-load orkestratie + micro-interacties, CSS-only. */}
      <style>{`
        @keyframes helderRise {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes helderShimmer {
          0%   { background-position: -360px 0; }
          100% { background-position: 360px 0; }
        }
        .rise { opacity: 0; animation: helderRise 0.55s cubic-bezier(0.22,0.61,0.36,1) forwards; }
        .shimmer {
          background: linear-gradient(90deg, #F3F3F6 0%, #FAFAFC 50%, #F3F3F6 100%);
          background-size: 720px 100%;
          animation: helderShimmer 1.1s linear infinite;
        }
        .row-accent { box-shadow: inset 3px 0 0 ${ACCENT}; }
        .hov { transition: background-color 0.18s ease, border-color 0.18s ease; }
        .hov:hover { background-color: #FAFAFC; }
        ::selection { background: rgba(35,71,255,0.16); }
      `}</style>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header
        style={{ borderColor: HAIRLINE, background: "rgba(255,255,255,0.82)" }}
        className="sticky top-0 z-20 border-b backdrop-blur-md"
      >
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 px-6 py-3.5">
          <div className="flex items-center gap-3">
            {/* Beeldmerk: kobalt vierkant met scan-streep. */}
            <div
              style={{ background: INK }}
              className="relative flex h-8 w-8 items-center justify-center rounded-lg"
            >
              <span style={{ background: ACCENT }} className="absolute left-1.5 right-1.5 top-2 h-[2px] rounded-full" />
              <span style={{ background: ACCENT, opacity: 0.5 }} className="absolute left-1.5 right-1.5 top-3.5 h-[2px] rounded-full" />
              <span style={{ background: ACCENT, opacity: 0.3 }} className="absolute left-1.5 right-2.5 top-5 h-[2px] rounded-full" />
            </div>
            <div className="leading-tight">
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>
                Inkoopfactuur Scanner
              </div>
              <div style={{ color: MUTE, fontSize: 11.5 }}>Herkennen · corrigeren · exporteren</div>
            </div>
            <span
              style={{ borderColor: HAIRLINE, color: "#0A6B4A", background: "#ECFAF3" }}
              className="ml-1 hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium sm:inline-flex"
            >
              <span style={{ background: "#0E9F6E" }} className="h-1.5 w-1.5 rounded-full" />
              Lokale herkenning
            </span>
          </div>

          {/* Design-switcher: links naar de andere varianten. */}
          <nav
            style={{ borderColor: HAIRLINE }}
            className="flex items-center gap-0.5 rounded-full border bg-white p-0.5"
          >
            {DESIGN_VARIANTS.map((v) => {
              const active = v.slug === "helder";
              return (
                <Link
                  key={v.slug}
                  href={`/designs/${v.slug}`}
                  title={v.tagline}
                  style={{
                    background: active ? INK : "transparent",
                    color: active ? "#fff" : MUTE,
                    fontWeight: active ? 600 : 500,
                  }}
                  className="rounded-full px-3 py-1.5 text-[12.5px] transition-colors hover:text-[#0B0B0C]"
                >
                  {v.name}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-6 py-7">
        {/* ── KPI-strip ──────────────────────────────────────────────────── */}
        <section className="rise grid grid-cols-2 gap-3 lg:grid-cols-4" style={{ animationDelay: "40ms" }}>
          <Kpi label="Facturen" value={String(invoices.length)} sub={`${kpis.counts.ok} herkend`} />
          <Kpi label="Totaalbedrag" value={fmt(kpis.totalGross)} sub="incl. BTW" accent />
          <Kpi
            label="Aandachtspunten"
            value={String(kpis.withIssues)}
            sub={kpis.withIssues === 1 ? "factuur" : "facturen"}
          />
          <Kpi
            label="Status"
            value={`${kpis.counts.ok} / ${kpis.counts.partial} / ${kpis.counts.error}`}
            sub="ok · deels · fout"
          />
        </section>

        {/* ── Werkblad: lijst + detail ───────────────────────────────────── */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[400px_1fr]">
          {/* Linker kolom: upload + lijst */}
          <div className="rise flex flex-col gap-4" style={{ animationDelay: "120ms" }}>
            {/* Upload-zone */}
            <button
              type="button"
              onClick={handleScan}
              disabled={scanning}
              style={{ borderColor: scanning ? ACCENT : HAIRLINE }}
              className="hov group relative flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed bg-white px-6 py-7 text-center transition-[border-color] disabled:cursor-wait"
            >
              <div
                style={{ background: scanning ? ACCENT : "#F4F5FA", color: scanning ? "#fff" : ACCENT }}
                className="flex h-10 w-10 items-center justify-center rounded-xl transition-colors"
              >
                {scanning ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
                    <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
                  </svg>
                )}
              </div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {scanning ? "Scannen…" : "Sleep PDF of XML hierheen"}
              </div>
              <div style={{ color: MUTE, fontSize: 12 }}>
                {scanning ? "Velden worden herkend" : "of klik om een voorbeeld te scannen"}
              </div>
            </button>

            {/* Facturenlijst */}
            <div style={{ borderColor: HAIRLINE }} className="overflow-hidden rounded-2xl border bg-white">
              <div
                style={{ borderColor: HAIRLINE, color: MUTE, fontSize: 11, letterSpacing: "0.06em" }}
                className="flex items-center justify-between border-b px-4 py-2.5 uppercase"
              >
                <span>Inbox</span>
                <span style={{ fontFamily: FONT_MONO }}>{invoices.length}</span>
              </div>

              <ul>
                {/* Shimmer-placeholder tijdens het scannen */}
                {scanning && (
                  <li style={{ borderColor: HAIRLINE }} className="border-b px-4 py-3.5">
                    <div className="shimmer mb-2 h-3 w-2/3 rounded" />
                    <div className="shimmer h-2.5 w-1/3 rounded" />
                  </li>
                )}

                {invoices.map((inv) => {
                  const active = inv.id === selectedId;
                  const n = validateInvoice(inv).length;
                  const st = STATUS[inv.status];
                  return (
                    <li key={inv.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(inv.id)}
                        style={{ borderColor: HAIRLINE, background: active ? "#FAFBFF" : "transparent" }}
                        className={`hov flex w-full items-center gap-3 border-b px-4 py-3 text-left ${active ? "row-accent" : ""}`}
                      >
                        <span style={{ background: st.dot }} className="h-2 w-2 shrink-0 rounded-full" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span style={{ fontWeight: 600, fontSize: 13.5 }} className="truncate">
                              {inv.supplier.name.value ?? "Onbekende leverancier"}
                            </span>
                            <span
                              style={{ fontFamily: FONT_MONO, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}
                              className="shrink-0"
                            >
                              {fmt(inv.totalGross.value)}
                            </span>
                          </span>
                          <span className="mt-0.5 flex items-center justify-between gap-2">
                            <span style={{ color: MUTE, fontSize: 11.5, fontFamily: FONT_MONO }} className="truncate">
                              {inv.fileName}
                            </span>
                            {n > 0 && (
                              <span
                                style={{ color: "#8A5A06", background: "#FCF5E8", fontSize: 11 }}
                                className="shrink-0 rounded-full px-1.5 py-0.5 font-medium"
                              >
                                {n} aandachtspunt{n === 1 ? "" : "en"}
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}

                {invoices.length === 0 && !scanning && (
                  <li className="px-4 py-10 text-center" style={{ color: MUTE, fontSize: 13 }}>
                    Nog geen facturen. Scan er één.
                  </li>
                )}
              </ul>
            </div>
          </div>

          {/* Rechter kolom: detail */}
          <div className="rise" style={{ animationDelay: "200ms" }}>
            {selected ? (
              <Detail
                key={selected.id}
                invoice={selected}
                issues={issues}
                exported={exported}
                onExport={handleExport}
                setSupplierName={setSupplierName}
                setSupplierIban={setSupplierIban}
                setHeaderString={setHeaderString}
                setAmount={setAmount}
              />
            ) : (
              <div
                style={{ borderColor: HAIRLINE, color: MUTE }}
                className="flex h-full min-h-[320px] items-center justify-center rounded-2xl border bg-white text-[14px]"
              >
                Selecteer een factuur om de details te zien.
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

// ── Detailpaneel ────────────────────────────────────────────────────────────

function Detail({
  invoice,
  issues,
  exported,
  onExport,
  setSupplierName,
  setSupplierIban,
  setHeaderString,
  setAmount,
}: {
  invoice: Invoice;
  issues: ReturnType<typeof validateInvoice>;
  exported: string | null;
  onExport: (k: "CSV" | "JSON" | "UBL") => void;
  setSupplierName: (v: string) => void;
  setSupplierIban: (v: string) => void;
  setHeaderString: (k: "invoiceNumber" | "invoiceDate" | "dueDate", v: string) => void;
  setAmount: (k: "subtotal" | "totalVat" | "totalGross", v: string) => void;
}) {
  const st = STATUS[invoice.status];
  const amountStr = (v: number | null) => (v == null ? "" : String(v).replace(".", ","));

  return (
    <div style={{ borderColor: HAIRLINE }} className="overflow-hidden rounded-2xl border bg-white">
      {/* Kop van de factuur */}
      <div style={{ borderColor: HAIRLINE }} className="flex flex-wrap items-start justify-between gap-4 border-b px-6 py-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              style={{ background: st.tint, color: st.ink }}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
            >
              <span style={{ background: st.dot }} className="h-1.5 w-1.5 rounded-full" />
              {st.label}
            </span>
            <span
              style={{ borderColor: HAIRLINE, color: MUTE, fontFamily: FONT_MONO }}
              className="rounded-full border px-2 py-0.5 text-[11px] uppercase"
            >
              {invoice.detectedFormat}
            </span>
          </div>
          <h2
            style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, letterSpacing: "-0.01em" }}
            className="mt-2 truncate"
          >
            {invoice.supplier.name.value ?? "Onbekende leverancier"}
          </h2>
          <div style={{ color: MUTE, fontFamily: FONT_MONO, fontSize: 12 }} className="mt-0.5 truncate">
            {invoice.fileName}
          </div>
        </div>

        {/* Groot, leesbaar totaal */}
        <div className="text-right">
          <div style={{ color: MUTE, fontSize: 11, letterSpacing: "0.06em" }} className="uppercase">
            Totaal incl. BTW
          </div>
          <div
            style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 30, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}
          >
            {fmt(invoice.totalGross.value)}
          </div>
        </div>
      </div>

      {/* Error-state */}
      {invoice.error && (
        <div style={{ background: "#FCEDEC", color: "#9A2A24", borderColor: "#F4D2CF" }} className="border-b px-6 py-3 text-[13px]">
          {invoice.error}
        </div>
      )}

      <div className="px-6 py-5">
        {/* Bewerkbare kop-velden */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FieldRow
            label="Factuurnummer"
            mono
            value={invoice.invoiceNumber.value ?? ""}
            source={invoice.invoiceNumber.source}
            confidence={invoice.invoiceNumber.confidence}
            onChange={(v) => setHeaderString("invoiceNumber", v)}
          />
          <FieldRow
            label="Factuurdatum"
            mono
            value={invoice.invoiceDate.value ?? ""}
            source={invoice.invoiceDate.source}
            confidence={invoice.invoiceDate.confidence}
            onChange={(v) => setHeaderString("invoiceDate", v)}
          />
          <FieldRow
            label="Leverancier"
            value={invoice.supplier.name.value ?? ""}
            source={invoice.supplier.name.source}
            confidence={invoice.supplier.name.confidence}
            onChange={setSupplierName}
          />
          <FieldRow
            label="IBAN"
            mono
            value={invoice.supplier.iban.value ?? ""}
            source={invoice.supplier.iban.source}
            confidence={invoice.supplier.iban.confidence}
            onChange={setSupplierIban}
          />
          <FieldRow
            label="Subtotaal (€)"
            mono
            value={amountStr(invoice.subtotal.value)}
            source={invoice.subtotal.source}
            confidence={invoice.subtotal.confidence}
            onChange={(v) => setAmount("subtotal", v)}
          />
          <FieldRow
            label="BTW (€)"
            mono
            value={amountStr(invoice.totalVat.value)}
            source={invoice.totalVat.source}
            confidence={invoice.totalVat.confidence}
            onChange={(v) => setAmount("totalVat", v)}
          />
        </div>

        {/* Validatie-issues */}
        {issues.length > 0 && (
          <div className="mt-5">
            <div style={{ color: MUTE, fontSize: 11, letterSpacing: "0.06em" }} className="mb-2 uppercase">
              Aandachtspunten
            </div>
            <ul className="flex flex-col gap-1.5">
              {issues.map((iss, i) => {
                const err = iss.severity === "error";
                return (
                  <li
                    key={i}
                    style={{
                      background: err ? "#FCEDEC" : "#FCF5E8",
                      color: err ? "#9A2A24" : "#8A5A06",
                      borderColor: err ? "#F4D2CF" : "#F0E2C4",
                    }}
                    className="flex items-start gap-2 rounded-lg border px-3 py-2 text-[12.5px]"
                  >
                    <span className="mt-0.5 shrink-0 font-semibold">{err ? "Fout" : "Let op"}</span>
                    <span>{iss.message}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Regels-tabel */}
        <div className="mt-6">
          <div style={{ color: MUTE, fontSize: 11, letterSpacing: "0.06em" }} className="mb-2 uppercase">
            Factuurregels
          </div>
          {invoice.lines.length === 0 ? (
            <div style={{ borderColor: HAIRLINE, color: MUTE }} className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px]">
              Geen regels herkend.
            </div>
          ) : (
            <div style={{ borderColor: HAIRLINE }} className="overflow-hidden rounded-xl border">
              <table className="w-full" style={{ fontVariantNumeric: "tabular-nums" }}>
                <thead>
                  <tr style={{ color: MUTE, borderColor: HAIRLINE }} className="border-b">
                    <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide">Omschrijving</th>
                    <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide">Aantal</th>
                    <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide">Stuk</th>
                    <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide">BTW</th>
                    <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide">Totaal</th>
                  </tr>
                </thead>
                <tbody style={{ fontFamily: FONT_MONO, fontSize: 12.5 }}>
                  {invoice.lines.map((ln, i) => (
                    <tr key={i} style={{ borderColor: HAIRLINE }} className={i < invoice.lines.length - 1 ? "border-b" : ""}>
                      <td style={{ fontFamily: FONT_BODY }} className="px-3 py-2 text-left text-[13px]">
                        {ln.description}
                      </td>
                      <td className="px-3 py-2 text-right">{ln.quantity ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{fmt(ln.unitPrice)}</td>
                      <td className="px-3 py-2 text-right" style={{ color: MUTE }}>
                        {ln.vatRate != null ? `${ln.vatRate}%` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{fmt(ln.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderColor: HAIRLINE, background: "#FBFBFD" }} className="border-t">
                    <td colSpan={4} style={{ color: MUTE }} className="px-3 py-2 text-right text-[12px] uppercase tracking-wide">
                      Totaal incl. BTW
                    </td>
                    <td style={{ fontFamily: FONT_MONO, fontVariantNumeric: "tabular-nums" }} className="px-3 py-2 text-right text-[13px] font-semibold">
                      {fmt(invoice.totalGross.value)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Export-acties */}
        <div style={{ borderColor: HAIRLINE }} className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
          <div style={{ color: MUTE, fontSize: 12.5 }}>
            {exported ? (
              <span style={{ color: ACCENT, fontWeight: 600 }}>{exported} geëxporteerd ✓</span>
            ) : (
              "Exporteer koppel-klaar naar de boekhouding"
            )}
          </div>
          <div className="flex items-center gap-2">
            {(["CSV", "JSON"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => onExport(k)}
                style={{ borderColor: HAIRLINE, color: INK }}
                className="hov rounded-lg border bg-white px-3.5 py-2 text-[13px] font-medium"
              >
                {k}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onExport("UBL")}
              style={{ background: ACCENT }}
              className="rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white transition-[filter] hover:brightness-110"
            >
              Export UBL
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

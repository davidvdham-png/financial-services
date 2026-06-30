// Design-gallery: overzicht van de dashboard-varianten om uit te kiezen.

import Link from "next/link";
import { DESIGN_VARIANTS } from "@/lib/mock-invoices";

// Kleine palet-hint per variant (puur decoratief voor de overzichtskaarten).
const SWATCHES: Record<string, { bg: string; ink: string; accent: string; sub: string }> = {
  helder: { bg: "#ffffff", ink: "#0b0b0c", accent: "#2540f0", sub: "#e6e6ea" },
  cockpit: { bg: "#0a0e14", ink: "#e6edf3", accent: "#34d399", sub: "#1b2330" },
  ledger: { bg: "#faf7f2", ink: "#1c1a17", accent: "#0f5d5a", sub: "#e7ded0" },
  raster: { bg: "#f4f5f7", ink: "#111318", accent: "#4f46e5", sub: "#dfe2e8" },
};

export default function DesignGallery() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-5xl px-6 py-14">
        <header className="mb-10">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
            Inkoopfactuur Scanner — design-gallery
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
            Kies een dashboard-richting
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-500">
            Vier volledig interactieve varianten met dezelfde demo-facturen. Klik je doorheen,
            test het scannen, selecteren en bewerken, en bepaal welke we doorzetten naar de
            Vercel-site. Elke variant heeft bovenin een switcher om snel te vergelijken.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {DESIGN_VARIANTS.map((v) => {
            const s = SWATCHES[v.slug] ?? SWATCHES.helder;
            return (
              <Link
                key={v.slug}
                href={`/designs/${v.slug}`}
                className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                {/* Mini-preview met de palet-hint */}
                <div className="relative h-36 overflow-hidden" style={{ background: s.bg }}>
                  <div className="absolute inset-0 p-4">
                    <div className="mb-2 h-2.5 w-24 rounded-full" style={{ background: s.accent }} />
                    <div className="mb-1.5 h-2 w-40 rounded-full" style={{ background: s.sub }} />
                    <div className="mb-1.5 h-2 w-32 rounded-full" style={{ background: s.sub }} />
                    <div className="mt-4 flex gap-2">
                      <div className="h-10 w-16 rounded-md" style={{ background: s.sub }} />
                      <div className="h-10 w-16 rounded-md" style={{ background: s.sub }} />
                      <div className="h-10 w-16 rounded-md border" style={{ borderColor: s.accent }} />
                    </div>
                  </div>
                  <span
                    className="absolute right-3 top-3 h-3 w-3 rounded-full ring-2 ring-white/40"
                    style={{ background: s.ink }}
                  />
                </div>

                <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">{v.name}</h2>
                    <p className="text-sm text-slate-500">{v.tagline}</p>
                  </div>
                  <span className="text-sm font-medium text-blue-600 transition group-hover:translate-x-0.5">
                    Bekijk →
                  </span>
                </div>
              </Link>
            );
          })}
        </div>

        <p className="mt-10 text-xs text-slate-400">
          Tip: de huidige productie-UI staat op <Link href="/" className="underline">de homepage</Link>.
        </p>
      </div>
    </div>
  );
}

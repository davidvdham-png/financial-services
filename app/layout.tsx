import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Inkoopfactuur Scanner",
  description: "Scan & herken inkoopfacturen (PDF + XML) en exporteer koppel-klaar.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl">
      <body className="antialiased">{children}</body>
    </html>
  );
}

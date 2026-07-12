import type { Metadata } from "next";
import Link from "next/link";
import { Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Fontok next/font-tal — latin + latin-ext subset (magyar ékezetek!).
// CSS-változóként kötve; a tokens.css --font-sans/--font-mono erre épül.
const hanken = Hanken_Grotesk({
  subsets: ["latin", "latin-ext"],
  variable: "--font-hanken",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI Consulting rendszer — foundation",
  description: "Generálási vertikum: nyers anyag → draft → jóváhagyás",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="hu" className={`${hanken.variable} ${jetbrains.variable}`}>
      <body className="bg-app text-ink antialiased">
        <div className="flex min-h-dvh">
          {/* Minimális oldalsáv-shell (alap-chrome). A teljes navigációs
              váz (fázis-nav, stepper) a #4 csomag dolga. */}
          <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-glass backdrop-blur-md">
            <div className="px-5 py-6">
              <Link href="/" className="block">
                <span className="block text-body font-semibold tracking-tight">
                  AI Consulting
                </span>
                <span className="mt-0.5 block font-mono text-mono-sm text-ink-tertiary">
                  rendszer · P0–P6
                </span>
              </Link>
            </div>
            <nav className="px-3">
              <Link
                href="/"
                className="block rounded-control px-2 py-1.5 text-body text-ink-secondary transition-colors duration-[var(--motion-fast)] hover:bg-sunken hover:text-ink"
              >
                Projektek
              </Link>
            </nav>
            <div className="mt-auto px-5 py-4">
              {/* nyelvváltó helye (i18n lépés) */}
            </div>
          </aside>

          <main className="min-w-0 flex-1">
            <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}

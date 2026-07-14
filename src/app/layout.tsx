import type { Metadata } from "next";
import Link from "next/link";
import { Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { SidebarNav } from "@/components/SidebarNav";
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: t("appTitle"),
    description: t("appDescription"),
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const t = await getTranslations("nav");

  return (
    <html lang={locale} className={`${hanken.variable} ${jetbrains.variable}`}>
      <body className="bg-app text-ink antialiased">
        <NextIntlClientProvider>
          <div className="flex min-h-dvh">
            {/* ── Globális sidebar (Master ◆ SIDEBAR) ──
                ≥1100px: kifejtett oszlop (220px, feliratokkal);
                <1100px: 60px-es ikon-rail (a kifejtett forma kollapszáltja). */}
            <aside className="flex w-[60px] shrink-0 flex-col items-center gap-1.5 border-r border-line-soft bg-rail py-4 min-[1100px]:hidden">
              <Link
                href="/"
                title={t("brandTitle")}
                className="mb-3 flex h-[30px] w-[30px] items-center justify-center rounded-tile bg-action font-mono text-[14px] font-bold text-white"
              >
                A
              </Link>
              <SidebarNav variant="rail" />
            </aside>
            <aside className="hidden w-[220px] shrink-0 flex-col border-r border-line-soft bg-surface min-[1100px]:flex">
              <div className="px-5 pb-3 pt-5">
                <Link href="/" className="flex items-center gap-2.5">
                  <span className="flex h-[30px] w-[30px] items-center justify-center rounded-tile bg-action font-mono text-[14px] font-bold text-white">
                    A
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-body font-bold tracking-tight">
                      {t("brandTitle")}
                    </span>
                    <span className="block font-mono text-[10px] text-ink-tertiary">
                      {t("brandSubtitle")}
                    </span>
                  </span>
                </Link>
              </div>
              <div className="px-3.5 pb-2.5 pt-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
                {t("globalLevel")}
              </div>
              <SidebarNav variant="expanded" />
              <div className="mt-auto px-4 py-4">
                <LocaleSwitcher />
              </div>
            </aside>

            {children}
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

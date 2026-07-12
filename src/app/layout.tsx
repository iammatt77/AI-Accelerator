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
            {/* Navigációs váz (#4): 3 valós + 3 placeholder szakasz.
                A nyelvváltó a #3 helyén, az oldalsáv alján marad. */}
            <aside className="glass-panel flex w-56 shrink-0 flex-col border-r border-line">
              <div className="px-5 py-6">
                <Link href="/" className="block">
                  <span className="block text-body font-semibold tracking-tight">
                    {t("brandTitle")}
                  </span>
                  <span className="mt-0.5 block font-mono text-mono-sm text-ink-tertiary">
                    {t("brandSubtitle")}
                  </span>
                </Link>
              </div>
              <SidebarNav />
              <div className="mt-auto px-5 py-4">
                <LocaleSwitcher />
              </div>
            </aside>

            <main className="min-w-0 flex-1">
              <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
            </main>
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

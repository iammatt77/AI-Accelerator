import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

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
    <html lang="hu">
      <body>
        <header className="border-b border-[var(--border)]">
          <div className="mx-auto max-w-6xl px-6 py-4">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              AI Consulting rendszer
              <span className="ml-2 font-normal text-[var(--muted)]">
                · foundation
              </span>
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}

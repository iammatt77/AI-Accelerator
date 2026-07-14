"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  IconClients,
  IconDashboard,
  IconInbox,
  IconLibrary,
  IconProjects,
  IconSettings,
} from "@/components/icons";

// Globális navigáció (Master ◆ SIDEBAR): Dashboard · Ügyfelek · Projektek ·
// Inbox · Könyvtár · ─ · Beállítások. Aktív elem = LILA KITÖLTÉS
// (#EDE6F7 háttér + #7A4FB0 szöveg) — a Master állapot-nyelvtana szerint.
// Két variáns: „expanded" (220px, felirattal) és „rail" (60px, csak ikon).

interface NavItem {
  href: string;
  key: "dashboard" | "clients" | "projects" | "inbox" | "library" | "settings";
  Icon: typeof IconDashboard;
  /** Aktívnak számító útvonal-prefixek (a href-en felül). */
  also?: string[];
  /** Elválasztó ez ELŐTT az elem előtt. */
  dividerBefore?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", key: "dashboard", Icon: IconDashboard },
  { href: "/clients", key: "clients", Icon: IconClients },
  { href: "/projects", key: "projects", Icon: IconProjects, also: ["/project/"] },
  { href: "/inbox", key: "inbox", Icon: IconInbox },
  { href: "/library", key: "library", Icon: IconLibrary },
  { href: "/settings", key: "settings", Icon: IconSettings, dividerBefore: true },
];

export function SidebarNav({ variant }: { variant: "expanded" | "rail" }) {
  const pathname = usePathname();
  const t = useTranslations("nav");

  const isActive = (item: NavItem) =>
    pathname === item.href ||
    (item.href !== "/" && pathname.startsWith(`${item.href}/`)) ||
    (item.also ?? []).some((prefix) => pathname.startsWith(prefix));

  if (variant === "rail") {
    return (
      <nav className="flex flex-col items-center gap-1.5">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.key}
              href={item.href}
              title={t(item.key)}
              aria-current={active ? "page" : undefined}
              className={`flex h-[38px] w-[38px] items-center justify-center rounded-tile transition-colors duration-[var(--motion-fast)] ${
                active
                  ? "bg-accent-fill text-action"
                  : "text-ink-tertiary hover:bg-neutral-150 hover:text-ink-secondary"
              }`}
            >
              <item.Icon size={18} />
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="space-y-px px-3.5">
      {NAV_ITEMS.map((item) => {
        const active = isActive(item);
        return (
          <div key={item.key}>
            {item.dividerBefore && <div className="mx-1.5 my-2.5 h-px bg-line-soft" />}
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-tile px-2.5 py-2 text-[12.5px] transition-colors duration-[var(--motion-fast)] ${
                active
                  ? "bg-accent-fill font-bold text-action-deep"
                  : "font-semibold text-ink-secondary hover:bg-neutral-100 hover:text-ink"
              }`}
            >
              <item.Icon size={16} className={active ? "text-action-deep" : "text-ink-tertiary"} />
              <span className="flex-1">{t(item.key)}</span>
            </Link>
          </div>
        );
      })}
    </nav>
  );
}

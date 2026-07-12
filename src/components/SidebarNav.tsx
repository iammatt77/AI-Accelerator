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

// Bal oldalsáv navigáció: 3 valós szakasz (Dashboard, Ügyfelek, Projektek)
// + 3 placeholder (Beérkező, Könyvtár, Beállítások). Aktív elem: süllyesztett
// háttér — lila NINCS (törvény 3: a navigáció nem döntési pont).

interface NavItem {
  href: string;
  key: "dashboard" | "clients" | "projects" | "inbox" | "library" | "settings";
  Icon: typeof IconDashboard;
  /** Aktívnak számító útvonal-prefixek (a href-en felül). */
  also?: string[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", key: "dashboard", Icon: IconDashboard },
  { href: "/clients", key: "clients", Icon: IconClients },
  { href: "/projects", key: "projects", Icon: IconProjects, also: ["/project/"] },
  { href: "/inbox", key: "inbox", Icon: IconInbox },
  { href: "/library", key: "library", Icon: IconLibrary },
  { href: "/settings", key: "settings", Icon: IconSettings },
];

export function SidebarNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");

  return (
    <nav className="space-y-0.5 px-3">
      {NAV_ITEMS.map(({ href, key, Icon, also }) => {
        const active =
          pathname === href ||
          (href !== "/" && pathname.startsWith(`${href}/`)) ||
          (also ?? []).some((prefix) => pathname.startsWith(prefix));
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2 rounded-control px-2 py-1.5 text-body transition-colors duration-[var(--motion-fast)] ${
              active
                ? "bg-sunken font-medium text-ink"
                : "text-ink-secondary hover:bg-sunken hover:text-ink"
            }`}
          >
            <Icon className={active ? "text-ink" : "text-ink-tertiary"} />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}

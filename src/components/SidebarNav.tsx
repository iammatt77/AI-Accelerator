"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useRef, useState } from "react";
import {
  IconClients,
  IconDashboard,
  IconInbox,
  IconLibrary,
  IconProjects,
  IconSettings,
} from "@/components/icons";

// Globális navigáció (Master ◆ SIDEBAR): Dashboard · Ügyfelek · Projektek ·
// Inbox · Könyvtár · ─ · Beállítások. Aktív elem = LILA JELÖLŐSÁV. Az
// „expanded" variánsban a jelölősáv EGY elem, ami az aktív pontra CSÚSZIK
// (transform: translateY, --dur-pill, --ease-pill) — az AICON Oldalváltás-spec
// „A" (lateral) mozgása. A pozíció mérve (divider-biztos); csak transform
// animálódik (GPU). A „rail" variáns tömör, per-elem kitöltéssel.

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

function useActiveIndex(): number {
  const pathname = usePathname();
  return NAV_ITEMS.findIndex(
    (item) =>
      pathname === item.href ||
      (item.href !== "/" && pathname.startsWith(`${item.href}/`)) ||
      (item.also ?? []).some((prefix) => pathname.startsWith(prefix)),
  );
}

export function SidebarNav({ variant }: { variant: "expanded" | "rail" }) {
  const t = useTranslations("nav");
  const activeIndex = useActiveIndex();

  if (variant === "rail") {
    return (
      <nav className="flex flex-col items-center gap-1.5">
        {NAV_ITEMS.map((item, i) => {
          const active = i === activeIndex;
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

  return <ExpandedNav activeIndex={activeIndex} t={t} />;
}

function ExpandedNav({
  activeIndex,
  t,
}: {
  activeIndex: number;
  t: (key: string) => string;
}) {
  const pathname = usePathname();
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const el = activeIndex >= 0 ? itemRefs.current[activeIndex] : null;
    setPill(el ? { top: el.offsetTop, height: el.offsetHeight } : null);
  }, [activeIndex, pathname]);

  return (
    <nav className="relative px-3.5">
      {/* Csúszó jelölősáv — egyetlen elem, csak transform animálódik. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-3.5 right-3.5 top-0 rounded-tile bg-accent-fill"
        style={
          pill
            ? {
                height: pill.height,
                transform: `translateY(${pill.top}px)`,
                opacity: 1,
                transition: "transform var(--dur-pill) var(--ease-pill)",
              }
            : { opacity: 0 }
        }
      />
      <div className="relative space-y-px">
        {NAV_ITEMS.map((item, i) => {
          const active = i === activeIndex;
          return (
            <div key={item.key}>
              {item.dividerBefore && <div className="mx-1.5 my-2.5 h-px bg-line-soft" />}
              <Link
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-tile px-2.5 py-2 text-[12.5px] transition-colors duration-[var(--motion-base)] ${
                  active
                    ? "font-bold text-action-deep"
                    : "font-semibold text-ink-secondary hover:text-ink"
                }`}
              >
                <item.Icon size={16} className={active ? "text-action-deep" : "text-ink-tertiary"} />
                <span className="flex-1">{t(item.key)}</span>
              </Link>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

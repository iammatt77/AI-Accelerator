"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { IconLock } from "@/components/icons";

// Kontextuális projekt-oszlop (Master ◆ SIDEBAR): csak /project/:id/*
// útvonalakon renderel. Cockpit · Fázis-munkafelület (Workbench / Heatmap
// alpontokkal) · Dokumentumok (badge = a kaput blokkoló elemek száma) ·
// Források · alul a zárolt fázisok (halványan, lakattal — kattintásra csak
// a feltétel-tooltip, nem navigál). Aktív elem: lila kitöltés.
// <1100px a második oszlop az ikon-railbe húzódik (Master: kollapszált mód).

export interface ProjectNavData {
  projectId: string;
  clientName: string;
  /** Aktív (in_progress / gate_pending / open) fázis, pl. "P1". */
  activePhase: string;
  /** A kaput blokkoló elemek száma (Dokumentumok-badge). */
  docsBadge: number;
  /** Zárolt fázisok tartománya, pl. "P2–P6" (üres, ha nincs). */
  lockedRange: string;
}

export function ProjectContextNav({ nav }: { nav: ProjectNavData }) {
  const pathname = usePathname();
  const t = useTranslations("nav");

  const base = `/project/${nav.projectId}`;
  const phaseHref = `${base}/phase/${nav.activePhase}`;
  const onCockpit = pathname === base;
  const onPhase = pathname.startsWith(`${base}/phase/`);
  const onDocs =
    pathname.startsWith(`${base}/documents`) || pathname.startsWith(`${base}/artifact/`);
  const onSources = pathname.startsWith(`${base}/sources`);

  const itemCls = (active: boolean) =>
    `flex items-center gap-2 rounded-tile px-2.5 py-2 text-[12.5px] transition-colors duration-[var(--motion-fast)] ${
      active
        ? "bg-accent-fill font-bold text-action-deep"
        : "font-semibold text-ink-secondary hover:bg-neutral-100 hover:text-ink"
    }`;

  return (
    <aside className="hidden w-[240px] shrink-0 flex-col border-r border-line-soft bg-context px-3.5 py-4 min-[1100px]:flex">
      <div className="truncate px-2 pb-2.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-action">
        {t("inProject")} · {nav.clientName}
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-px">
        <Link href={base} className={itemCls(onCockpit)}>
          <span className="flex-1">{t("cockpit")}</span>
        </Link>
        <Link href={phaseHref} className={itemCls(onPhase)}>
          <span className="flex-1">{t("phaseWorkspace")}</span>
          <span className="font-mono text-[10px]">{nav.activePhase}</span>
        </Link>
        {onPhase && (
          <>
            <Link
              href={phaseHref}
              className="mt-0.5 rounded-tile bg-accent-tint px-2.5 py-1 pl-[22px] text-[11.5px] font-semibold text-action-deep"
            >
              · {t("workbench")}
            </Link>
            <Link
              href={`${phaseHref}#heatmap`}
              className="px-2.5 py-1 pl-[22px] text-[11.5px] text-ink-secondary hover:text-ink"
            >
              · {t("heatmap")} ⛶
            </Link>
          </>
        )}
        <Link href={`${base}/documents`} className={itemCls(onDocs)}>
          <span className="flex-1">{t("documents")}</span>
          {nav.docsBadge > 0 && (
            <span className="rounded-pill bg-accent-fill px-1.5 py-px font-mono text-[10px] text-action-deep">
              {nav.docsBadge}
            </span>
          )}
        </Link>
        <Link href={`${base}/sources`} className={itemCls(onSources)}>
          <span className="flex-1">{t("sources")}</span>
        </Link>
        <Link
          href={`${base}/process`}
          className={itemCls(pathname.startsWith(`${base}/process`))}
        >
          <span className="flex-1">{t("processMap")}</span>
        </Link>
        <Link
          href={`${base}/requirements`}
          className={itemCls(pathname.startsWith(`${base}/requirements`))}
        >
          <span className="flex-1">{t("requirements")}</span>
        </Link>
        <Link
          href={`${base}/solution`}
          className={itemCls(pathname.startsWith(`${base}/solution`))}
        >
          <span className="flex-1">{t("solution")}</span>
        </Link>
        <div className="mt-auto">
          {nav.lockedRange && (
            <div
              title={t("lockedTooltip")}
              className="flex cursor-default items-center gap-2 px-2.5 py-2 text-[12px] font-semibold text-ink-tertiary"
            >
              <IconLock size={14} />
              <span>
                {nav.lockedRange} {t("lockedPhasesSuffix")}
              </span>
            </div>
          )}
        </div>
      </nav>
    </aside>
  );
}

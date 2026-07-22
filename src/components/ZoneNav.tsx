"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useState } from "react";
import { useTranslations } from "next-intl";
import { ZoneFlowStrip, type FlowZone } from "@/components/WorkspaceShell";
import type { GateTarget } from "@/lib/phases/tools";

// ─────────────────────────────────────────────────────────────
// Csomag B1 — zóna-navigációs állapot FÖLÉ emelve (B1-b/B1-c).
// A `PhaseZones` birtokolja az aktív-zóna állapotot és egy contextet ad,
// hogy a stepper FÖLÖTTI tool-sáv (zone-tool kártyák) és a KAPU-gombok is
// tudjanak zónát váltani — lapújratöltés nélkül. A `ZoneFlowStrip` innen
// olvassa az aktív zónát (controlled).
// ─────────────────────────────────────────────────────────────

interface ZoneNavValue {
  active: string;
  /** Zónára vált; opcionális horgonyra görget (a panel már a DOM-ban van). */
  go: (zone: string, anchor?: string) => void;
}

const ZoneNavContext = createContext<ZoneNavValue | null>(null);

export function useZoneNav(): ZoneNavValue {
  const ctx = useContext(ZoneNavContext);
  if (!ctx) throw new Error("useZoneNav a ZoneNav providerén kívül");
  return ctx;
}

export function PhaseZones({
  toolbar,
  zones,
  panels,
  defaultZone,
}: {
  toolbar: React.ReactNode;
  zones: FlowZone[];
  panels: Record<string, React.ReactNode>;
  defaultZone: string;
}) {
  const [active, setActive] = useState(defaultZone);
  const go = useCallback((zone: string, anchor?: string) => {
    setActive(zone);
    if (anchor) {
      // A panelek mind a DOM-ban vannak (csak hidden) — a váltás után a
      // horgony már látható; a következő frame-ben görgetünk hozzá.
      requestAnimationFrame(() => {
        document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, []);

  return (
    <ZoneNavContext.Provider value={{ active, go }}>
      <div className="space-y-4">
        {toolbar}
        <ZoneFlowStrip zones={zones} panels={panels} active={active} onSelect={setActive} />
      </div>
    </ZoneNavContext.Provider>
  );
}

// ── Kapu-feltétel akció-gomb (B1-c) ──────────────────────────
// Nem teljesült feltétel → a hiány orvoslási helyére visz: zóna-cél →
// kliens zóna-váltás (reload nélkül); tool-cél → a tool route-ja (Link).

export function GateCriterionAction({
  target,
  zoneLabel,
  toolLabel,
}: {
  target: GateTarget;
  /** A cél-zóna emberi neve (pl. „③ Kimenet"). */
  zoneLabel?: string;
  /** A cél-tool emberi neve (pl. „Golden set & riport"). */
  toolLabel?: string;
}) {
  const t = useTranslations("workspace");
  const cls =
    "inline-flex shrink-0 items-center gap-1 rounded-control border border-action/40 bg-action-light px-2.5 py-1 text-mono-sm font-semibold text-action-deep transition-colors duration-[var(--motion-base)] hover:bg-accent-fill";

  if (target.kind === "tool") {
    return (
      <Link href={target.path} className={cls} aria-label={t("gateGoAria", { target: toolLabel ?? "" })}>
        {toolLabel} <span aria-hidden>→</span>
      </Link>
    );
  }
  return <GateZoneButton zone={target.zone} label={zoneLabel ?? ""} cls={cls} aria={t("gateGoAria", { target: zoneLabel ?? "" })} />;
}

function GateZoneButton({
  zone,
  label,
  cls,
  aria,
}: {
  zone: string;
  label: string;
  cls: string;
  aria: string;
}) {
  const { go } = useZoneNav();
  return (
    <button type="button" onClick={() => go(zone)} className={cls} aria-label={aria}>
      {label} <span aria-hidden>→</span>
    </button>
  );
}

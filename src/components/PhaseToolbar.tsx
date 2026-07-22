"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { phaseTools, type PhaseToolDef } from "@/lib/phases/tools";
import type { PhaseId } from "@/lib/phases/config";
import {
  HeatmapFocusTrigger,
  type HeatmapPoint,
  type ShortlistItem,
} from "@/components/UseCaseHeatmap";
import { useZoneNav } from "@/components/ZoneNav";

// ─────────────────────────────────────────────────────────────
// Csomag B1-a — TOOL-SÁV: a fázis eszközei a stepper FÖLÖTT, dedikált
// blokkban. A toolok NEM a zónákban élnek. A kártyák a tool destinációjára
// visznek (route / hőtérkép-modál / zóna-váltás). P0: üres-állapot.
// A kártyák TARTALMA minimál belépő (B1: csak áthelyez/összegyűjt); a
// gazdag előnézetek a B3 dolga.
// ─────────────────────────────────────────────────────────────

export interface ToolbarHeatmapData {
  points: HeatmapPoint[];
  shortlist: ShortlistItem[];
  clientName: string;
  phaseName: string;
}

export function PhaseToolbar({
  phase,
  projectId,
  heatmap,
}: {
  phase: PhaseId;
  projectId: string;
  /** P1: a hőtérkép-tool adatai (a fókusz-modálhoz). */
  heatmap?: ToolbarHeatmapData;
}) {
  const t = useTranslations("tools");
  const tools = phaseTools(phase);
  const base = `/project/${projectId}`;

  return (
    <section className="rounded-tile border border-line bg-surface p-4 shadow-tile-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-3 bg-accent-fill px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-action-deep">
            {t("barTag")}
          </span>
          <span className="text-body font-semibold">{t("barTitle")}</span>
          <span className="font-mono text-mono-sm text-ink-tertiary">— {phase}</span>
        </div>
        {tools.length > 0 && (
          <span className="text-mono-sm text-ink-tertiary">{t("barLead")}</span>
        )}
      </div>

      {tools.length === 0 ? (
        <p className="mt-3 rounded-tile border border-dashed border-line bg-sunken px-3 py-3 text-body text-ink-tertiary">
          {t("empty")}
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              base={base}
              t={t}
              heatmap={heatmap}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ToolCard({
  tool,
  base,
  t,
  heatmap,
}: {
  tool: PhaseToolDef;
  base: string;
  t: ReturnType<typeof useTranslations>;
  heatmap?: ToolbarHeatmapData;
}) {
  const inner = (
    <span className="block">
      <span className="flex items-center gap-2">
        <span className="text-body font-semibold text-ink">{t(`names.${tool.nameKey}`)}</span>
        {tool.badge && (
          <span className="rounded-pill bg-neutral-100 px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-wide text-ink-secondary">
            {tool.badge}
          </span>
        )}
      </span>
      <span className="mt-1 block text-mono-sm leading-snug text-ink-tertiary">
        {t(`desc.${tool.descKey}`)}
      </span>
      <span className="mt-2 inline-flex items-center gap-1 text-mono-sm font-semibold text-action-deep">
        {t("open")} <span aria-hidden>→</span>
      </span>
    </span>
  );

  const cardCls =
    "block h-full rounded-tile border border-line bg-surface p-3 text-left transition-colors duration-[var(--motion-base)] hover:bg-neutral-50";

  // Hőtérkép: a MEGLÉVŐ fókusz-modál nyílik (nincs önálló route).
  if (tool.open === "heatmap" && heatmap) {
    return (
      <div id="heatmap" className={cardCls + " p-0"}>
        <HeatmapFocusTrigger
          points={heatmap.points}
          shortlist={heatmap.shortlist}
          clientName={heatmap.clientName}
          phaseName={heatmap.phaseName}
        >
          <span className="block p-3">{inner}</span>
        </HeatmapFocusTrigger>
      </div>
    );
  }

  // Zóna-cél (pl. Befolyás × érintettség → ② + Stakeholderek): kliens váltás.
  if (tool.open === "zone" && tool.zone) {
    return <ZoneToolCard tool={tool} cardCls={cardCls} inner={inner} />;
  }

  // Route-tool: átnavigál a tool önálló oldalára.
  return (
    <Link href={`${base}${tool.path ?? ""}`} className={cardCls}>
      {inner}
    </Link>
  );
}

function ZoneToolCard({
  tool,
  cardCls,
  inner,
}: {
  tool: PhaseToolDef;
  cardCls: string;
  inner: React.ReactNode;
}) {
  const { go } = useZoneNav();
  return (
    <button
      type="button"
      onClick={() => go(tool.zone as string, tool.anchor)}
      className={cardCls}
    >
      {inner}
    </button>
  );
}

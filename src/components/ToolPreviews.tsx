import { getTranslations } from "next-intl/server";
import type {
  BuilddocPreviewData,
  GoldensetPreviewData,
  HeatmapPreviewData,
  MatrixPreviewData,
  OptionsPreviewData,
  ProcessPreviewData,
  RequirementsPreviewData,
  StaleReason,
  ToolPreviews,
} from "@/lib/phases/preview-data";
import type { Quadrant } from "@/lib/stakeholders/matrix";

// ─────────────────────────────────────────────────────────────
// Epic 3 · 3.3 — a nyolc tool-előnézet (miniatűr munkafelületek).
// Szerver-komponensek: az SVG a szerveren renderelődik és ReactNode-ként
// megy át a (kliens) PhaseToolbar előnézet-slotjába — az előnézet BELÜL
// nem interaktív (F7), a kártya maga kattintható.
//
// A kanonikus terv (Refounded_Tool_elonezetek_terv.html) formanyelvei:
// pontfelhő · monogram-mátrix · lépéslánc · előtte-utána · Ü/S/M fa ·
// összevető-mátrix · kötés-gráf · eval-lista. Minden szín meglévő
// design-token (NF2), minden adat a preview-data valós leltárából (F1).
// Négy állapot (F3): üres (üres-állapot ✦ következő lépéssel) · részleges ·
// kész · elavult (⟳ a sarok-jelölőben, csak valós derivált jelre).
// Skálázás (F4): elem-plafon + „+N", karakter-csonkolás, fix geometria.
// ─────────────────────────────────────────────────────────────

const AX = {
  fontFamily: "var(--font-mono)",
  fontSize: 8,
  fill: "var(--neutral-450)",
  letterSpacing: "0.5px",
} as const;
const ND = { fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 600 } as const;
const TX = { fontFamily: "var(--font-sans)", fontSize: 10 } as const;

const trunc = (s: string, n: number) => ([...s].length > n ? [...s].slice(0, n - 1).join("") + "…" : s);

// ── Keret: 112px vászon + sarok-jelölő (vlab) ────────────────

type CornerTone = "empty" | "neutral" | "accent" | "green" | "amber" | "stale";

const CORNER_CLS: Record<CornerTone, string> = {
  empty: "bg-neutral-100 text-ink-tertiary",
  neutral: "bg-neutral-100 text-ink-secondary",
  accent: "bg-accent-fill text-action-deep",
  green: "bg-tint-done text-done-text",
  amber: "bg-tint-gate text-gate-text",
  stale: "border border-dashed border-gate bg-tint-gate text-gate-text",
};

function VizFrame({
  corner,
  tone,
  children,
}: {
  corner: string;
  tone: CornerTone;
  children: React.ReactNode;
}) {
  return (
    <span className="relative block h-[112px] overflow-hidden rounded-shell border border-neutral-150 bg-surface">
      <svg viewBox="0 0 380 112" preserveAspectRatio="xMidYMid meet" className="block h-[112px] w-full">
        {children}
      </svg>
      <span
        className={`absolute right-2.5 top-2 rounded-pill px-2 py-px font-mono text-[9px] font-bold ${CORNER_CLS[tone]}`}
      >
        {corner}
      </span>
    </span>
  );
}

/** Üres-állapot két sora (cím + ✦ következő lépés) — a galéria mintája. */
function EmptyLines({ title, hint, y = 50 }: { title: string; hint: string; y?: number }) {
  return (
    <>
      <text x={190} y={y} textAnchor="middle" style={{ ...TX, fontSize: 11, fontWeight: 600 }} fill="var(--ink-tertiary)">
        {title}
      </text>
      <text x={190} y={y + 15} textAnchor="middle" style={{ ...ND, fontSize: 8.5, fontWeight: 400 }} fill="var(--neutral-450)">
        {hint}
      </text>
    </>
  );
}

/** A sarok-jelölő ⟳-változata (stale felülír minden mást — F3). */
async function staleCorner(reason: StaleReason): Promise<string> {
  const t = await getTranslations("tools");
  return t(`preview.stale.${reason}`);
}

// ── 1 · Hőtérkép — pontfelhő tengelyekkel ────────────────────

const DOT_FILL: Record<string, string> = {
  quickwin: "var(--status-done)",
  normal: "var(--action-primary)",
  hard: "var(--status-gate)",
  excluded: "var(--neutral-400)",
};

function fieldX(score: number, span = 326, x0 = 40): number {
  return x0 + (0.08 + ((Math.min(5, Math.max(1, score)) - 1) / 4) * 0.84) * span;
}
function fieldY(score: number, span = 72, y0 = 14): number {
  return y0 + span - (0.08 + ((Math.min(5, Math.max(1, score)) - 1) / 4) * 0.84) * span;
}

export async function HeatmapPreviewViz({ data }: { data: HeatmapPreviewData }) {
  const t = await getTranslations("tools");
  const empty = data.scored === 0;
  const partial = !empty && data.scored < data.confirmedTotal;
  const corner = data.stale
    ? await staleCorner(data.stale)
    : empty
      ? t("preview.corner.empty")
      : partial
        ? t("preview.corner.scored", { scored: data.scored, total: data.confirmedTotal })
        : t("preview.corner.quickWins", { n: data.quickWins });
  const tone: CornerTone = data.stale ? "stale" : empty ? "empty" : partial ? "neutral" : "green";

  // Azonos cellára eső pontok szétterítése (a score-ok 1–5 egészek).
  const byCell = new Map<string, number>();
  const MAX_DOTS = 12;
  const shown = data.dots.slice(0, MAX_DOTS);
  return (
    <VizFrame corner={corner} tone={tone}>
      <rect x={40} y={14} width={326} height={72} fill="var(--neutral-50)" />
      <rect x={203} y={14} width={163} height={36} fill="var(--tint-done-band)" />
      <line x1={203} y1={14} x2={203} y2={86} stroke="var(--neutral-300)" strokeDasharray="3 3" />
      <line x1={40} y1={50} x2={366} y2={50} stroke="var(--neutral-300)" strokeDasharray="3 3" />
      <rect x={40} y={14} width={326} height={72} fill="none" stroke="var(--neutral-150)" />
      <text x={10} y={26} style={AX} transform="rotate(-90 10 26)" textAnchor="end">
        {t("preview.axis.value")}
      </text>
      <text x={40} y={102} style={AX}>
        {t("preview.axis.feasibility")}
      </text>
      {empty ? (
        <EmptyLines title={t("preview.empty.heatmap")} hint={t("preview.empty.heatmapHint")} />
      ) : (
        <>
          {shown.map((d, i) => {
            const key = `${d.value}:${d.feasibility}`;
            const n = byCell.get(key) ?? 0;
            byCell.set(key, n + 1);
            const dx = ((n % 3) - 1) * 11;
            const dy = Math.floor(n / 3) % 2 === 0 ? 0 : 10;
            return (
              <circle
                key={i}
                cx={fieldX(d.feasibility) + dx}
                cy={fieldY(d.value) + dy}
                r={d.cls === "quickwin" ? 7 : 6.5}
                fill={DOT_FILL[d.cls]}
              />
            );
          })}
          {data.dots.length > MAX_DOTS && (
            <text x={358} y={82} textAnchor="end" style={ND} fill="var(--ink-tertiary)">
              {t("preview.more", { n: data.dots.length - MAX_DOTS })}
            </text>
          )}
        </>
      )}
    </VizFrame>
  );
}

// ── 2 · Befolyás × érintettség — monogram-mátrix ─────────────

const QUADRANT_SLOTS: Record<Quadrant, { x: number; y: number }> = {
  keep_satisfied: { x: 48, y: 22 },
  manage_closely: { x: 210, y: 28 },
  monitor: { x: 48, y: 60 },
  keep_informed: { x: 210, y: 60 },
};

export async function StakeholderMatrixPreviewViz({ data }: { data: MatrixPreviewData }) {
  const t = await getTranslations("tools");
  const tSt = await getTranslations("stakeholders");
  const empty = data.total === 0;
  const partial = !empty && data.scored < data.total;
  const corner = data.stale
    ? await staleCorner(data.stale)
    : empty
      ? t("preview.corner.empty")
      : partial
        ? t("preview.corner.people", { scored: data.scored, total: data.total })
        : t("preview.corner.peopleDone", { n: data.scored });
  const tone: CornerTone = data.stale ? "stale" : empty ? "empty" : partial ? "neutral" : "accent";

  const byQuadrant = new Map<Quadrant, string[]>();
  for (const p of data.placed) {
    const list = byQuadrant.get(p.quadrant) ?? [];
    list.push(p.initials);
    byQuadrant.set(p.quadrant, list);
  }

  return (
    <VizFrame corner={corner} tone={tone}>
      <rect x={40} y={14} width={326} height={72} fill="var(--neutral-50)" />
      <rect x={203} y={14} width={163} height={36} fill="var(--accent-box)" />
      <line x1={203} y1={14} x2={203} y2={86} stroke="var(--neutral-300)" strokeDasharray="3 3" />
      <line x1={40} y1={50} x2={366} y2={50} stroke="var(--neutral-300)" strokeDasharray="3 3" />
      <rect x={40} y={14} width={326} height={72} fill="none" stroke="var(--neutral-150)" />
      <text x={10} y={30} style={AX} transform="rotate(-90 10 30)" textAnchor="end">
        {t("preview.axis.influence")}
      </text>
      <text x={40} y={102} style={AX}>
        {t("preview.axis.impact")}
      </text>
      {empty ? (
        <EmptyLines title={t("preview.empty.matrix")} hint={t("preview.empty.matrixHint")} />
      ) : (
        <>
          <text x={210} y={24} style={{ ...AX, fontWeight: 700 }} fill="var(--action-deep)">
            {tSt("quadrant.manage_closely.label")}
          </text>
          {(Object.keys(QUADRANT_SLOTS) as Quadrant[]).map((q) => {
            const people = byQuadrant.get(q) ?? [];
            const base = QUADRANT_SLOTS[q];
            const shown = people.slice(0, 3);
            const extra = people.length - shown.length;
            const hot = q === "manage_closely";
            return shown.map((initials, i) => {
              const col = i % 3;
              const x = base.x + col * 50;
              const y = base.y;
              return (
                <g key={`${q}-${i}`}>
                  <rect x={x} y={y} width={44} height={17} rx={8.5} fill={hot ? "var(--action-primary)" : "var(--neutral-150)"} />
                  <text x={x + 7} y={y + 12} style={ND} fill={hot ? "#fff" : "var(--ink-secondary)"}>
                    {trunc(initials, 5)}
                  </text>
                  {i === 2 && extra > 0 && (
                    <text x={x + 50} y={y + 12} style={ND} fill="var(--ink-tertiary)">
                      {t("preview.more", { n: extra })}
                    </text>
                  )}
                </g>
              );
            });
          })}
        </>
      )}
    </VizFrame>
  );
}

// ── 3+4 · Folyamattérkép — lépéslánc (AS-IS) / előtte-utána (TO-BE) ──

function stepFill(kind: "ai" | "hitl" | "other", flagged: boolean): {
  fill: string;
  stroke: string;
  fg: string;
} {
  if (kind === "ai")
    return { fill: "var(--accent-fill)", stroke: "var(--action-primary)", fg: "var(--action-deep)" };
  if (kind === "hitl")
    return { fill: "var(--tint-done)", stroke: "var(--status-done)", fg: "var(--status-done)" };
  if (flagged)
    return { fill: "var(--tint-gate-band)", stroke: "var(--status-gate)", fg: "var(--status-gate-text)" };
  return { fill: "#fff", stroke: "var(--neutral-300)", fg: "var(--ink-secondary)" };
}

function Arrow({ x, y }: { x: number; y: number }) {
  return (
    <>
      <path d={`M${x} ${y} H${x + 18}`} stroke="var(--neutral-300)" strokeWidth={1.8} />
      <path d={`M${x + 14} ${y - 4} L${x + 20} ${y} L${x + 14} ${y + 4} Z`} fill="var(--neutral-300)" />
    </>
  );
}

export async function ProcessPreviewViz({ data }: { data: ProcessPreviewData }) {
  const t = await getTranslations("tools");
  const isAsIs = data.kind === "as_is";
  const empty = data.stepTotal === 0;
  const corner = data.stale
    ? await staleCorner(data.stale)
    : empty
      ? t("preview.corner.empty")
      : isAsIs
        ? data.approved
          ? t("preview.corner.openPoints", { n: data.openTotal })
          : t("preview.corner.steps", { n: data.stepTotal })
        : data.approved && data.asIsCount !== null
          ? t("preview.corner.stepsDelta", { a: data.asIsCount, b: data.stepTotal })
          : t("preview.corner.inProgress")
  const tone: CornerTone = data.stale
    ? "stale"
    : empty
      ? "empty"
      : isAsIs
        ? data.approved
          ? "amber"
          : "neutral"
        : data.approved
          ? "accent"
          : "neutral";

  if (empty) {
    return (
      <VizFrame corner={corner} tone={tone}>
        <rect x={60} y={46} width={90} height={30} rx={7} fill="none" stroke="var(--neutral-300)" strokeDasharray="4 3" />
        <rect x={230} y={46} width={90} height={30} rx={7} fill="none" stroke="var(--neutral-300)" strokeDasharray="4 3" />
        <Arrow x={158} y={61} />
        <EmptyLines
          title={t(isAsIs ? "preview.empty.asis" : "preview.empty.tobe")}
          hint={t(isAsIs ? "preview.empty.asisHint" : "preview.empty.tobeHint")}
          y={28}
        />
      </VizFrame>
    );
  }

  if (isAsIs) {
    // Lépéslánc a lépés saját nyitott-pont jelölőjével (compliance 1. eltérés:
    // node↔fájdalompont kötés nincs — a jelölő a node open_points-a).
    const stepW = 72;
    const gap = 22;
    return (
      <VizFrame corner={corner} tone={tone}>
        {data.openTotal > 0 && (
          <text x={16} y={24} style={AX} fill="var(--status-gate-text)">
            ▲ {t("preview.bottlenecks")}
          </text>
        )}
        {data.steps.map((s, i) => {
          const x = 14 + i * (stepW + gap);
          const flagged = s.open > 0;
          const c = stepFill(s.kind, flagged);
          return (
            <g key={i}>
              {i > 0 && <Arrow x={x - gap + 2} y={61} />}
              <rect x={x} y={46} width={stepW} height={30} rx={7} fill={c.fill} stroke={c.stroke} strokeWidth={flagged ? 1.8 : 1.5} />
              <text x={x + 8} y={65} style={ND} fill={c.fg}>
                {trunc(s.title, 9)}
              </text>
              {flagged && (
                <>
                  <circle cx={x + stepW} cy={46} r={11} fill="var(--status-gate)" />
                  <text x={x + stepW} y={50} textAnchor="middle" style={{ ...ND, fontWeight: 700 }} fill="#fff">
                    {s.open > 99 ? "99" : s.open}
                  </text>
                </>
              )}
            </g>
          );
        })}
        {data.stepTotal > data.steps.length && (
          <text x={366} y={100} textAnchor="end" style={ND} fill="var(--ink-tertiary)">
            {t("preview.more", { n: data.stepTotal - data.steps.length })}
          </text>
        )}
      </VizFrame>
    );
  }

  // TO-BE: fő lánc (✦ AI-lépések) + halvány AS-IS előtte-sor (valós lépésekből).
  const widths = [110, 100, 110];
  let cursor = 16;
  return (
    <VizFrame corner={corner} tone={tone}>
      {data.steps.map((s, i) => {
        const w = widths[i] ?? 100;
        const x = cursor;
        cursor += w + 22;
        const c = stepFill(s.kind, false);
        return (
          <g key={i}>
            {i > 0 && (
              <>
                <path d={`M${x - 22} 52 H${x - 4}`} stroke="var(--action-light)" strokeWidth={1.8} />
                <path d={`M${x - 8} 48 L${x - 2} 52 L${x - 8} 56 Z`} fill="var(--action-light)" />
              </>
            )}
            <rect x={x} y={36} width={w} height={32} rx={8} fill={c.fill} stroke={c.stroke} strokeWidth={s.kind === "ai" ? 1.8 : 1.5} />
            <text x={x + 10} y={56} style={ND} fill={c.fg}>
              {s.kind === "ai" ? "✦ " : ""}
              {trunc(s.title, s.kind === "ai" ? 10 : 12)}
            </text>
          </g>
        );
      })}
      {data.stepTotal > data.steps.length && (
        <text x={366} y={56} textAnchor="end" style={ND} fill="var(--ink-tertiary)">
          {t("preview.more", { n: data.stepTotal - data.steps.length })}
        </text>
      )}
      {data.asIsSteps.length > 0 && (
        <g opacity={0.5}>
          {data.asIsSteps.map((title, i) => {
            const x = 16 + i * 92;
            return (
              <g key={i}>
                <rect x={x} y={80} width={82} height={20} rx={6} fill="none" stroke="var(--neutral-300)" strokeDasharray="4 3" />
                <text x={x + 8} y={94} style={ND} fill="var(--neutral-450)">
                  {trunc(title, 9)}
                </text>
                <line x1={x + 4} y1={90} x2={x + 76} y2={90} stroke="var(--neutral-450)" strokeWidth={1.3} />
              </g>
            );
          })}
          <text x={16 + data.asIsSteps.length * 92 + 4} y={94} style={AX}>
            {t("preview.asIsTag")}
          </text>
        </g>
      )}
    </VizFrame>
  );
}

// ── 5 · Követelmények — Ü/S/M fa ─────────────────────────────

const LEVEL_STYLE: Record<string, { fill: string; stroke: string | null; fg: string }> = {
  business: { fill: "var(--action-primary)", stroke: null, fg: "#fff" },
  stakeholder: { fill: "var(--tint-pivot)", stroke: "var(--status-pivot)", fg: "var(--status-pivot)" },
  system: { fill: "var(--tint-done)", stroke: "var(--status-done)", fg: "var(--status-done)" },
};

export async function RequirementsPreviewViz({ data }: { data: RequirementsPreviewData }) {
  const t = await getTranslations("tools");
  const total = data.counts.business + data.counts.stakeholder + data.counts.system;
  const empty = total === 0;
  const fmt = (n: number) => (n === 0 ? "–" : String(n));
  const corner = data.stale
    ? await staleCorner(data.stale)
    : empty
      ? t("preview.corner.empty")
      : `${fmt(data.counts.business)} / ${fmt(data.counts.stakeholder)} / ${fmt(data.counts.system)}`;
  const missing = [data.counts.business, data.counts.stakeholder, data.counts.system].some((n) => n === 0);
  const tone: CornerTone = data.stale ? "stale" : empty ? "empty" : missing ? "neutral" : "green";
  const badgeLetters = { business: t("preview.reqBadge.business"), stakeholder: t("preview.reqBadge.stakeholder"), system: t("preview.reqBadge.system") };

  if (empty) {
    return (
      <VizFrame corner={corner} tone={tone}>
        <rect x={20} y={18} width={24} height={19} rx={6} fill="none" stroke="var(--neutral-300)" strokeDasharray="3 3" />
        <path d="M32 37 V54 H50" stroke="var(--neutral-300)" strokeWidth={1.5} fill="none" />
        <rect x={54} y={45} width={24} height={19} rx={6} fill="none" stroke="var(--neutral-300)" strokeDasharray="3 3" />
        <EmptyLines title={t("preview.empty.requirements")} hint={t("preview.empty.requirementsHint")} y={56} />
      </VizFrame>
    );
  }

  const rows = data.chain.slice(0, 3);
  return (
    <VizFrame corner={corner} tone={tone}>
      {rows.map((row, i) => {
        const bx = 14 + i * 34;
        const by = 12 + i * 27;
        const st = LEVEL_STYLE[row.level];
        return (
          <g key={row.level}>
            {i > 0 && (
              <path
                d={`M${14 + (i - 1) * 34 + 12} ${12 + (i - 1) * 27 + 19} V${by + 9} H${bx - 4}`}
                stroke="var(--neutral-300)"
                strokeWidth={1.5}
                fill="none"
              />
            )}
            <rect x={bx} y={by} width={24} height={19} rx={6} fill={st.fill} stroke={st.stroke ?? "none"} />
            <text x={bx + 8} y={by + 14} style={{ ...ND, fontWeight: 700 }} fill={st.fg}>
              {badgeLetters[row.level]}
            </text>
            <text x={bx + 32} y={by + 14} style={{ ...TX, fontWeight: i === 0 ? 600 : 400 }} fill={i === 0 ? "var(--ink-primary)" : "var(--ink-secondary)"}>
              {trunc(row.text, 34)}
            </text>
          </g>
        );
      })}
      {data.acCount > 0 && (
        <>
          <path
            d={`M${14 + (rows.length - 1) * 34 + 12} ${12 + (rows.length - 1) * 27 + 19} V96 H${14 + rows.length * 34}`}
            stroke="var(--neutral-300)"
            strokeWidth={1.5}
            fill="none"
          />
          <rect x={18 + rows.length * 34} y={86} width={52} height={16} rx={5} fill="var(--neutral-100)" />
          <text x={25 + rows.length * 34} y={98} style={ND} fill="var(--ink-tertiary)">
            AC ×{data.acCount}
          </text>
        </>
      )}
      <text x={366} y={100} textAnchor="end" style={AX}>
        GIVEN / WHEN / THEN
      </text>
    </VizFrame>
  );
}

// ── 6 · Opció-összevető — mátrix nyertes-kiemeléssel ─────────

export async function OptionsPreviewViz({ data }: { data: OptionsPreviewData }) {
  const t = await getTranslations("tools");
  const tSolution = await getTranslations("solution");
  // Alap-szempont → i18n-felirat (solution.criteria.*); egyedi → a hordozott label.
  const criterionLabel = (c: { key: string; label: string | null }) =>
    c.label ?? tSolution(`criteria.${c.key}`);
  const empty = data.options.length === 0 || data.criteria.length === 0;
  const corner = data.stale
    ? await staleCorner(data.stale)
    : empty
      ? t("preview.corner.empty")
      : data.winnerName
        ? t("preview.corner.winner", { name: trunc(data.winnerName, 10) })
        : t("preview.corner.noWinner");
  const tone: CornerTone = data.stale ? "stale" : empty ? "empty" : data.winnerName ? "accent" : "neutral";

  const COLS = [
    { x: 116, w: 52 },
    { x: 204, w: 56 },
    { x: 290, w: 52 },
  ];
  const ROWS_Y = [40, 62, 84];
  const winnerIdx = data.options.findIndex((o) => o.selected);

  return (
    <VizFrame corner={corner} tone={tone}>
      <text x={14} y={26} style={AX}>
        {t("preview.criterionHead")}
      </text>
      {!empty &&
        data.options.map((o, ci) => {
          const col = COLS[ci];
          if (!col) return null;
          const isWin = ci === winnerIdx;
          return (
            <text
              key={ci}
              x={col.x + 16}
              y={26}
              style={{ ...ND, fontWeight: isWin ? 700 : 600 }}
              fill={isWin ? "var(--action-deep)" : "var(--ink-tertiary)"}
            >
              {trunc(o.name, 8)}
              {isWin ? " ✓" : ""}
            </text>
          );
        })}
      {winnerIdx >= 0 && COLS[winnerIdx] && (
        <rect
          x={COLS[winnerIdx].x - 8}
          y={32}
          width={COLS[winnerIdx].w + 16}
          height={66}
          rx={7}
          fill="var(--accent-box)"
          stroke="var(--action-primary)"
          strokeWidth={1.8}
        />
      )}
      {empty ? (
        <>
          {ROWS_Y.map((y) =>
            COLS.map((c, i) => (
              <rect key={`${y}-${i}`} x={c.x} y={y} width={c.w} height={11} rx={5.5} fill="var(--neutral-200)" />
            )),
          )}
          <rect x={88} y={50} width={204} height={20} rx={5} fill="#fff" opacity={0.9} />
          <EmptyLines title={t("preview.empty.options")} hint={t("preview.empty.optionsHint")} y={62} />
        </>
      ) : (
        data.criteria.map((crit, ri) => {
          const y = ROWS_Y[ri];
          if (y === undefined) return null;
          return (
            <g key={ri}>
              <text x={14} y={y + 8} style={TX} fill="var(--ink-secondary)">
                {trunc(criterionLabel(crit), 13)}
              </text>
              {data.options.map((o, ci) => {
                const col = COLS[ci];
                if (!col) return null;
                const lvl = o.levels[ri] ?? 0;
                const isWin = ci === winnerIdx;
                const frac = lvl === 0 ? 0 : lvl === 1 ? 0.32 : lvl === 2 ? 0.62 : 0.9;
                return (
                  <g key={ci}>
                    <rect x={col.x} y={y} width={col.w} height={11} rx={5.5} fill={isWin ? "var(--action-light)" : "var(--neutral-200)"} opacity={isWin ? 0.6 : 1} />
                    {frac > 0 && (
                      <rect x={col.x} y={y} width={col.w * frac} height={11} rx={5.5} fill={isWin ? "var(--action-primary)" : "var(--neutral-450)"} />
                    )}
                  </g>
                );
              })}
            </g>
          );
        })
      )}
    </VizFrame>
  );
}

// ── 7 · Megoldás-tervező — kétoszlopos kötés-gráf ────────────

export async function BuilddocPreviewViz({ data }: { data: BuilddocPreviewData }) {
  const t = await getTranslations("tools");
  const empty = data.total === 0;
  const corner = data.stale
    ? await staleCorner(data.stale)
    : empty
      ? t("preview.corner.empty")
      : t("preview.corner.components", { bound: data.boundCount, total: data.total });
  const tone: CornerTone = data.stale
    ? "stale"
    : empty
      ? "empty"
      : data.boundCount === data.total
        ? "accent"
        : "neutral";

  const LEFT_Y = [28, 56, 84];
  const RIGHT_Y = [23, 51, 79];
  return (
    <VizFrame corner={corner} tone={tone}>
      <text x={14} y={20} style={AX}>
        {t("preview.componentHead")}
      </text>
      <text x={248} y={20} style={AX}>
        {t("preview.tobeStepHead")}
      </text>
      {empty ? (
        <>
          <rect x={14} y={30} width={112} height={22} rx={6} fill="none" stroke="var(--neutral-300)" strokeDasharray="4 3" />
          <rect x={244} y={30} width={122} height={22} rx={6} fill="none" stroke="var(--neutral-300)" strokeDasharray="4 3" />
          <EmptyLines title={t("preview.empty.builddoc")} hint={t("preview.empty.builddocHint")} y={84} />
        </>
      ) : (
        <>
          {data.components.map((c, i) => {
            const y = LEFT_Y[i];
            if (y === undefined) return null;
            return (
              <g key={i}>
                <rect
                  x={14}
                  y={y}
                  width={112}
                  height={22}
                  rx={6}
                  fill={c.bound ? "var(--accent-fill)" : "#fff"}
                  stroke={c.bound ? "var(--action-primary)" : "var(--neutral-300)"}
                  strokeWidth={1.5}
                  strokeDasharray={c.bound ? undefined : "4 3"}
                />
                <text x={24} y={y + 15} style={ND} fill={c.bound ? "var(--action-deep)" : "var(--neutral-450)"}>
                  {trunc(c.name, 12)}
                </text>
                {c.bound && (
                  <path
                    d={`M126 ${y + 11} C176 ${y + 11} 200 ${(RIGHT_Y[i] ?? y) + 11} 244 ${(RIGHT_Y[i] ?? y) + 11}`}
                    stroke="var(--action-primary)"
                    strokeWidth={1.6}
                    fill="none"
                    strokeDasharray="5 4"
                    opacity={0.55}
                  />
                )}
              </g>
            );
          })}
          {data.targets.map((s, i) => {
            const y = RIGHT_Y[i];
            if (y === undefined) return null;
            const ai = s.kind === "ai";
            return (
              <g key={i}>
                <rect
                  x={244}
                  y={y}
                  width={122}
                  height={22}
                  rx={6}
                  fill={ai ? "var(--tint-done)" : "var(--surface-rail)"}
                  stroke={ai ? "var(--status-done)" : "var(--neutral-300)"}
                  strokeWidth={1.3}
                />
                <text x={254} y={y + 15} style={ND} fill={ai ? "var(--status-done)" : "var(--ink-tertiary)"}>
                  {ai ? "✦ " : ""}
                  {trunc(s.title, ai ? 12 : 14)}
                </text>
              </g>
            );
          })}
          {data.total > data.components.length && (
            <text x={130} y={108} style={ND} fill="var(--ink-tertiary)">
              {t("preview.more", { n: data.total - data.components.length })}
            </text>
          )}
        </>
      )}
    </VizFrame>
  );
}

// ── 8 · Golden set — eval-lista + küszöb-sáv ─────────────────

const VERDICT_STYLE: Record<string, { fill: string }> = {
  passed: { fill: "var(--status-done)" },
  partial: { fill: "var(--status-gate)" },
  failed: { fill: "var(--status-error)" },
};

export async function GoldensetPreviewViz({ data }: { data: GoldensetPreviewData }) {
  const t = await getTranslations("tools");
  const empty = data.total === 0;
  const overThreshold = data.threshold !== null && data.pct >= data.threshold;
  const corner = data.stale
    ? await staleCorner(data.stale)
    : empty
      ? t("preview.corner.empty")
      : data.threshold === null
        ? t("preview.corner.pctOnly", { pct: data.pct })
        : overThreshold
          ? t("preview.corner.passOk", { pct: data.pct, t: data.threshold })
          : t("preview.corner.passPct", { pct: data.pct, t: data.threshold });
  const tone: CornerTone = data.stale
    ? "stale"
    : empty
      ? "empty"
      : overThreshold
        ? "green"
        : "amber";

  const ROW_Y = [24, 48, 72];
  const barY = 88;
  const barW = 352;
  return (
    <VizFrame corner={corner} tone={tone}>
      {empty ? (
        <>
          <line x1={14} y1={30} x2={366} y2={30} stroke="var(--neutral-150)" />
          <line x1={14} y1={54} x2={366} y2={54} stroke="var(--neutral-150)" />
          <rect x={14} y={barY} width={barW} height={10} rx={5} fill="var(--neutral-200)" />
          <EmptyLines title={t("preview.empty.goldenset")} hint={t("preview.empty.goldensetHint")} y={44} />
        </>
      ) : (
        <>
          {data.cases.map((c, i) => {
            const y = ROW_Y[i];
            if (y === undefined) return null;
            const st = c.verdict ? VERDICT_STYLE[c.verdict] : null;
            return (
              <g key={i}>
                <text x={14} y={y} style={ND} fill="var(--ink-secondary)">
                  {trunc(c.displayId, 22)}
                </text>
                <text
                  x={data.total > data.cases.length && i === data.cases.length - 1 ? 316 : 366}
                  y={y}
                  textAnchor="end"
                  style={{ ...ND, fontWeight: 700 }}
                  fill={st ? st.fill : "var(--neutral-450)"}
                >
                  {c.verdict ? t(`preview.verdict.${c.verdict}`) : "—"}
                </text>
                {i < 2 && <line x1={14} y1={y + 8} x2={366} y2={y + 8} stroke="var(--neutral-150)" />}
              </g>
            );
          })}
          {data.total > data.cases.length && (
            <text x={366} y={ROW_Y[Math.min(data.cases.length, 3) - 1] ?? 72} textAnchor="end" style={ND} fill="var(--ink-tertiary)">
              {t("preview.more", { n: data.total - data.cases.length })}
            </text>
          )}
          <rect x={14} y={barY} width={barW} height={10} rx={5} fill="var(--neutral-200)" />
          {data.pct > 0 && (
            <rect
              x={14}
              y={barY}
              width={Math.max(6, (barW * Math.min(100, data.pct)) / 100)}
              height={10}
              rx={5}
              fill={overThreshold ? "var(--status-done)" : "var(--status-gate)"}
            />
          )}
          {data.threshold !== null && (
            <>
              <rect x={14 + (barW * data.threshold) / 100 - 1.25} y={barY - 5} width={2.5} height={20} rx={1.25} fill="var(--ink-primary)" />
              <text x={366} y={110} textAnchor="end" style={AX}>
                {t("preview.thresholdMark")}
              </text>
            </>
          )}
          <text x={14} y={110} style={AX} fill={overThreshold ? "var(--status-done)" : "var(--status-gate-text)"}>
            {t("preview.chipPassFail", { p: data.passed, f: data.failed })}
          </text>
        </>
      )}
    </VizFrame>
  );
}

// ── Kártya-lábléc chipek (metrikák + ⟳) ──────────────────────

function Chip({ tone, children }: { tone: "g" | "a" | "b" | "m"; children: React.ReactNode }) {
  const cls =
    tone === "g"
      ? "bg-tint-done text-done-text"
      : tone === "a"
        ? "bg-tint-gate text-gate-text"
        : tone === "b"
          ? "bg-accent-fill text-action-deep"
          : "bg-neutral-100 text-ink-secondary";
  return (
    <span className={`rounded-pill px-2 py-px font-mono text-[9.5px] font-semibold ${cls}`}>
      {children}
    </span>
  );
}

async function StaleChip({ reason }: { reason: StaleReason }) {
  const t = await getTranslations("tools");
  return (
    <span className="rounded-pill border border-dashed border-gate bg-tint-gate px-2 py-px font-mono text-[9.5px] font-semibold text-gate-text">
      {t(`preview.stale.${reason}`)}
    </span>
  );
}

async function PreviewChipsRow({ toolId, previews }: { toolId: string; previews: ToolPreviews }) {
  const t = await getTranslations("tools");
  const chips: React.ReactNode[] = [];
  if (toolId === "heatmap" && previews.heatmap) {
    const d = previews.heatmap;
    if (d.confirmedTotal > 0) chips.push(<Chip key="uc" tone="m">{t("preview.chip.useCases", { n: d.confirmedTotal })}</Chip>);
    if (d.quickWins > 0) chips.push(<Chip key="qw" tone="g">{t("preview.chip.quickWin", { n: d.quickWins })}</Chip>);
    if (d.stale) chips.push(<StaleChip key="stale" reason={d.stale} />);
  }
  if (toolId === "stakeholder_matrix" && previews.stakeholder_matrix) {
    const d = previews.stakeholder_matrix;
    const hot = d.placed.filter((p) => p.quadrant === "manage_closely").length;
    if (d.total > 0) chips.push(<Chip key="n" tone="m">{t("preview.chip.people", { n: d.total })}</Chip>);
    if (hot > 0) chips.push(<Chip key="hot" tone="b">{t("preview.chip.manageClosely", { n: hot })}</Chip>);
    if (d.stale) chips.push(<StaleChip key="stale" reason={d.stale} />);
  }
  if (toolId === "process" && previews.process) {
    const d = previews.process;
    if (d.stepTotal > 0) chips.push(<Chip key="s" tone="m">{t("preview.chip.steps", { n: d.stepTotal })}</Chip>);
    if (d.kind === "as_is" && d.openTotal > 0)
      chips.push(<Chip key="o" tone="a">{t("preview.chip.openPoints", { n: d.openTotal })}</Chip>);
    if (d.kind === "to_be") {
      const ai = d.steps.filter((s) => s.kind === "ai").length;
      if (ai > 0) chips.push(<Chip key="ai" tone="b">{t("preview.chip.aiSteps", { n: ai })}</Chip>);
    }
    if (d.stale) chips.push(<StaleChip key="stale" reason={d.stale} />);
  }
  if (toolId === "requirements" && previews.requirements) {
    const d = previews.requirements;
    if (d.acCount > 0) chips.push(<Chip key="ac" tone="g">{t("preview.chip.ac", { n: d.acCount })}</Chip>);
    if (d.stale) chips.push(<StaleChip key="stale" reason={d.stale} />);
  }
  if (toolId === "solution" && previews.solution) {
    const d = previews.solution;
    if (d.componentTotal > 0)
      chips.push(<Chip key="c" tone="m">{t("preview.chip.decided", { a: d.decidedTotal, b: d.componentTotal })}</Chip>);
    if (d.winnerName) chips.push(<Chip key="w" tone="g">{trunc(d.winnerName, 18)}</Chip>);
    if (d.stale) chips.push(<StaleChip key="stale" reason={d.stale} />);
  }
  if (toolId === "builddoc" && previews.builddoc) {
    const d = previews.builddoc;
    if (d.linkCount > 0) chips.push(<Chip key="l" tone="m">{t("preview.chip.links", { n: d.linkCount })}</Chip>);
    if (d.stale) chips.push(<StaleChip key="stale" reason={d.stale} />);
  }
  if (toolId === "goldenset" && previews.goldenset) {
    const d = previews.goldenset;
    if (d.total > 0) chips.push(<Chip key="n" tone="m">{t("preview.chip.cases", { n: d.total })}</Chip>);
    if (d.total > 0 && d.threshold !== null)
      chips.push(
        <Chip key="th" tone={d.pct >= d.threshold ? "g" : "a"}>
          {t(d.pct >= d.threshold ? "preview.chip.overThreshold" : "preview.chip.underThreshold")}
        </Chip>,
      );
    if (d.stale) chips.push(<StaleChip key="stale" reason={d.stale} />);
  }
  if (chips.length === 0) return null;
  return <span className="flex flex-wrap items-center gap-1.5">{chips}</span>;
}

// ── Slot-építő a PhaseToolbar számára ────────────────────────

export interface ToolCardExtras {
  viz: React.ReactNode;
  chips: React.ReactNode | null;
}

/** A fázis előnézet-slotjai tool-id szerint (szerver-oldali render). */
export function buildToolPreviewSlots(previews: ToolPreviews): Record<string, ToolCardExtras> {
  const out: Record<string, ToolCardExtras> = {};
  const add = (id: string, viz: React.ReactNode) => {
    out[id] = { viz, chips: <PreviewChipsRow toolId={id} previews={previews} /> };
  };
  if (previews.heatmap) add("heatmap", <HeatmapPreviewViz data={previews.heatmap} />);
  if (previews.stakeholder_matrix)
    add("stakeholder_matrix", <StakeholderMatrixPreviewViz data={previews.stakeholder_matrix} />);
  if (previews.process) add("process", <ProcessPreviewViz data={previews.process} />);
  if (previews.requirements) add("requirements", <RequirementsPreviewViz data={previews.requirements} />);
  if (previews.solution) add("solution", <OptionsPreviewViz data={previews.solution} />);
  if (previews.builddoc) add("builddoc", <BuilddocPreviewViz data={previews.builddoc} />);
  if (previews.goldenset) add("goldenset", <GoldensetPreviewViz data={previews.goldenset} />);
  return out;
}

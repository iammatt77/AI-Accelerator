"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  edgePath,
  styleOf,
  worldHeight,
  worldWidth,
  type GraphDiff,
  type ProcessEdge,
  type ProcessNode,
} from "@/lib/processmap/model";
import { ProcessChatCloseContext } from "@/components/processChatContext";
import type { ArtifactStatus } from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Folyamattérkép-nézet (#10, ref_folyamatterv.html) — a Task04-féle
// léptethető, node+SVG-él alapú, kamera-fókuszos térkép:
//   · canvas: 2D világ, húzható vászon, kamera fit ⇄ fókusz (1,3×)
//   · bejárás: node-kattintás → fókusz; döntésnél ág-választás a panelben;
//     a bejárt út lilán rajzolódik az éleken; alul breadcrumb
//   · inspector: overview / node / compare állapot
//   · overlay-ek: jelmagyarázat + nyers leirat (csak olvasható, kiemeléssel)
//   · AS-IS / TO-BE / ⇄ váltó a sötét topbarban
//   · változáskövetés-sáv (eredeti AI-verzió ⇄ szerkesztett)
// Az ADATMODELL-HÁTTÉR szekció INAKTÍV/szürke ([]HAMAROSAN) — nincs backend.
// A kulcsszámok SZÁRMAZTATOTT darabszámok (lépés/AI+HITL/nyitott pont) —
// metrika-adat híján nem fabrikálunk számot.
// ─────────────────────────────────────────────────────────────

export interface ProcessMapData {
  id: string;
  kind: "as_is" | "to_be";
  title: string;
  status: ArtifactStatus;
  version: number;
  toBeOrigin: "document" | "ai_suggested" | null;
  nodes: ProcessNode[];
  edges: ProcessEdge[];
  originalNodes: ProcessNode[];
  originalEdges: ProcessEdge[];
  diff: GraphDiff;
}

export interface ProcessSourceData {
  title: string;
  text: string;
}

type Mode = "as_is" | "to_be" | "cmp";
type Trail = { path: string[]; ve: string[] };

const FOCUS_ZOOM = 1.3;
const CANVAS_H = 700;

const OPEN_POINT_STYLE: Record<string, { c: string; bg: string }> = {
  blocker: { c: "#C0455A", bg: "#FBECEF" },
  important: { c: "#B4801E", bg: "#FBF3E0" },
  clarify: { c: "#3E9E6E", bg: "#E9F5EF" },
};

function ekey(e: ProcessEdge): string {
  return `${e.from}>${e.to}`;
}

export function ProcessMapViewer({
  projectId,
  projectLabel,
  asIs,
  toBe,
  initialKind,
  source,
  chatSlot,
  approveSlot,
}: {
  projectId: string;
  projectLabel: string;
  asIs: ProcessMapData | null;
  toBe: ProcessMapData | null;
  initialKind: "as_is" | "to_be";
  source: ProcessSourceData | null;
  /** Chat-drawer (Fázis 4) — a szülő adja, hogy a nézet ne függjön az akcióktól. */
  chatSlot?: React.ReactNode;
  /** Jóváhagyás-gomb (Fázis 5) — ugyanígy slotként. */
  approveSlot?: React.ReactNode;
}) {
  const t = useTranslations("processMap");
  const [mode, setMode] = useState<Mode>(initialKind);
  const [view, setView] = useState<"overview" | "focus">("overview");
  const [trails, setTrails] = useState<Record<"as_is" | "to_be", Trail>>({
    as_is: { path: [], ve: [] },
    to_be: { path: [], ve: [] },
  });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [srcOpen, setSrcOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const closeChat = useCallback(() => setChatOpen(false), []);
  const [showOriginal, setShowOriginal] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [vw, setVw] = useState(1180);

  useEffect(() => {
    const measure = () => {
      if (canvasRef.current) setVw(canvasRef.current.clientWidth);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const activeMap = mode === "to_be" ? toBe : asIs;
  const useOriginal = showOriginal && activeMap !== null && activeMap.diff.originalCount > 0;
  const nodes = useMemo(
    () => (activeMap ? (useOriginal ? activeMap.originalNodes : activeMap.nodes) : []),
    [activeMap, useOriginal],
  );
  const edges = activeMap ? (useOriginal ? activeMap.originalEdges : activeMap.edges) : [];
  const worldH = useMemo(() => worldHeight(nodes), [nodes]);
  const worldW = useMemo(() => worldWidth(nodes), [nodes]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const order = nodes.map((n) => n.id);
  const startId = order[0] ?? "";

  const trailKind: "as_is" | "to_be" = mode === "to_be" ? "to_be" : "as_is";
  const rawTrail = trails[trailKind];
  const path = rawTrail.path.length > 0 && nodeById.has(rawTrail.path[0]) ? rawTrail.path : [startId];
  const ve = rawTrail.ve;
  const cur = path[path.length - 1];
  const curNode = nodeById.get(cur) ?? nodes[0] ?? null;
  const isFocus = view === "focus" && mode !== "cmp" && curNode !== null;

  const setTrail = useCallback(
    (next: Trail, extra?: { view?: "overview" | "focus" }) => {
      setTrails((prev) => ({ ...prev, [trailKind]: next }));
      if (extra?.view) setView(extra.view);
      setPan({ x: 0, y: 0 });
    },
    [trailKind],
  );

  const go = useCallback(
    (id: string) => {
      const edge = edges.find((e) => e.from === cur && e.to === id);
      const nextVe = edge && !ve.includes(ekey(edge)) ? [...ve, ekey(edge)] : ve;
      setTrail({ path: [...path, id], ve: nextVe }, { view: "focus" });
    },
    [cur, edges, path, ve, setTrail],
  );

  const switchMode = (m: Mode) => {
    setMode(m);
    setView("overview");
    setPan({ x: 0, y: 0 });
    setShowOriginal(false);
  };

  // Kamera (a ref math-ja): fókuszban a node közepe 1,3×-on; egyébként fit.
  let camera = "";
  if (isFocus && curNode) {
    camera = `translate(${vw / 2 - curNode.x * FOCUS_ZOOM + pan.x}px, ${
      CANVAS_H / 2 - curNode.y * FOCUS_ZOOM + pan.y
    }px) scale(${FOCUS_ZOOM})`;
  } else {
    const s = Math.min(vw / worldW, CANVAS_H / worldH) * 0.94;
    camera = `translate(${vw / 2 - (worldW / 2) * s + pan.x}px, ${
      CANVAS_H / 2 - (worldH / 2) * s + pan.y
    }px) scale(${s})`;
  }

  const visited = new Set(path);
  const outEdges = curNode ? edges.filter((e) => e.from === curNode.id) : [];

  // Származtatott kulcsszámok (nem fabrikált metrika).
  const stats = (m: ProcessMapData | null) => {
    if (!m) return { steps: 0, ai: 0, hitl: 0, open: 0, decide: 0 };
    return {
      steps: m.nodes.length,
      ai: m.nodes.filter((n) => n.type === "ai_intervention").length,
      hitl: m.nodes.filter((n) => n.type === "control_hitl").length,
      open: m.nodes.reduce((a, n) => a + n.open_points.length, 0),
      decide: m.nodes.filter((n) => styleOf(n.type).shape === "diamond").length,
    };
  };
  const curStats = stats(activeMap);
  const summary =
    mode === "cmp"
      ? t("summaryCmp", { a: asIs?.nodes.length ?? 0, b: toBe?.nodes.length ?? 0 })
      : mode === "to_be"
        ? activeMap?.status === "approved"
          ? t("summaryTobeApproved", { v: activeMap.version, ai: curStats.ai, hitl: curStats.hitl })
          : t("summaryTobe", { steps: curStats.steps, ai: curStats.ai, hitl: curStats.hitl })
        : t("summaryAsis", { steps: curStats.steps, open: curStats.open });

  // A diff-sáv az AKTÍV terven mutat eltérést az eredeti AI-snapshothoz
  // képest (chat-szerkesztés AS-IS-en és TO-BE-n is történhet).
  const diffMap = mode !== "cmp" ? activeMap : null;
  const diffBarVisible =
    diffMap !== null && (diffMap.diff.added > 0 || diffMap.diff.modified > 0);

  // Nyers-leirat kiemelés: az aktuális node idézete a szövegben.
  const highlight = useMemo(() => {
    if (!source || !curNode?.source_ref) return null;
    const q = curNode.source_ref.quote.replace(/^[„"…\s]+|[”"…\s]+$/g, "");
    const idx = q.length > 8 ? source.text.indexOf(q) : -1;
    if (idx < 0) return null;
    return {
      before: source.text.slice(Math.max(0, idx - 160), idx),
      match: q,
      after: source.text.slice(idx + q.length, idx + q.length + 160),
    };
  }, [source, curNode]);

  const modeBtn = (m: Mode, label: string) => (
    <button
      key={m}
      type="button"
      onClick={() => switchMode(m)}
      className={`rounded-4 px-3.5 py-1 text-[12px] font-bold ${
        mode === m ? "bg-action text-white" : "text-[#B9BECE] hover:text-white"
      }`}
    >
      {label}
    </button>
  );

  const empty = mode !== "cmp" && (!activeMap || nodes.length === 0);

  return (
    <div className="flex flex-col overflow-hidden rounded-shell border border-line bg-soft shadow-card">
      {/* ── Sötét topbar ── */}
      <div className="flex flex-wrap items-center gap-3 bg-[#23262F] px-5 py-2.5 text-[#EDEEF3]">
        <span className="flex items-center gap-2 text-[15px] font-extrabold tracking-tight text-white">
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-4 bg-action text-[13px]">
            A
          </span>
          {t("moduleTitle")}
        </span>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[#9EA2B5]">
          {projectLabel}
        </span>
        {activeMap &&
          (activeMap.status === "approved" ? (
            <span className="rounded-pill bg-[rgba(62,158,110,.18)] px-2.5 py-0.5 text-[11px] font-bold text-[#7BC9A0]">
              ✓ {t("approvedBadge", { v: activeMap.version })}
            </span>
          ) : (
            <span className="rounded-pill bg-[rgba(180,128,30,.2)] px-2.5 py-0.5 text-[11px] font-bold text-[#E0C583]">
              ● {t("draftBadge")}
            </span>
          ))}
        <div className="flex-1" />
        <div className="flex rounded-control border border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.06)] p-0.5">
          {modeBtn("as_is", "AS-IS")}
          {modeBtn("to_be", "TO-BE")}
          {modeBtn("cmp", "⇄")}
        </div>
        <button
          type="button"
          onClick={() => setLegendOpen((v) => !v)}
          className="rounded-control border border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.04)] px-3 py-1.5 text-[12px] text-[#D7DAE4]"
        >
          {t("legendBtn")}
        </button>
        <button
          type="button"
          onClick={() => {
            setView("overview");
            setPan({ x: 0, y: 0 });
          }}
          className="rounded-control bg-action px-3 py-1.5 text-[12px] font-semibold text-white"
        >
          ⤢ {t("fullMapBtn")}
        </button>
        {source && (
          <button
            type="button"
            onClick={() => setSrcOpen((v) => !v)}
            className="rounded-control border border-[rgba(46,119,168,.7)] bg-[rgba(255,255,255,.04)] px-3 py-1.5 text-[12px] font-semibold text-[#9CCBE8]"
          >
            {t("rawSourceBtn")}
          </button>
        )}
        {chatSlot && activeMap && activeMap.status !== "approved" && mode === initialKind && (
          <button
            type="button"
            onClick={() => setChatOpen((v) => !v)}
            className={`rounded-control border px-3 py-1.5 text-[12px] font-semibold ${
              chatOpen
                ? "border-action bg-action text-white"
                : "border-[rgba(31, 90, 232,.7)] bg-[rgba(255,255,255,.04)] text-[#B9CCF7]"
            }`}
          >
            ✦ {t("chatBtn")}
          </button>
        )}
      </div>

      {/* ── Státusz-sor ── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-2.5">
        <span
          aria-hidden
          className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-4 text-white ${
            activeMap?.status === "approved" && mode === "to_be" ? "bg-done" : "bg-action"
          }`}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M2 6 h7 M6.5 3 L9.5 6 L6.5 9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink">{summary}</span>
        {mode === "to_be" && toBe && (
          <>
            {toBe.toBeOrigin === "ai_suggested" ? (
              <span className="rounded-pill border border-[#B9CCF7] bg-tint-action px-2.5 py-1 text-[11.5px] font-bold text-action-deep">
                ✦ {t("originAi")}
              </span>
            ) : (
              <span className="rounded-pill border border-[#B9CCF7] bg-tint-action px-2.5 py-1 text-[11.5px] font-bold text-action-deep">
                {t("originDoc")}
              </span>
            )}
            <Link
              href={`/project/${projectId}/process`}
              className="rounded-pill border border-dashed border-neutral-350 px-2.5 py-1 text-[11.5px] font-semibold text-ink-tertiary hover:text-ink-secondary"
            >
              {toBe.toBeOrigin === "ai_suggested" ? t("originDocLink") : t("originAiLink")}
            </Link>
          </>
        )}
        {/* Egyben-jóváhagyás / új iteráció — ha nincs diff-sáv, itt lakik. */}
        {!diffBarVisible && mode === initialKind && approveSlot}
      </div>

      {/* ── Változáskövetés-sáv ── */}
      {diffBarVisible && diffMap && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-accent-tint px-5 py-2">
          <span className="font-mono text-[9.5px] font-bold tracking-[0.1em] text-action-deep">
            {t("diffTitle")}
          </span>
          <span className="whitespace-nowrap text-[12px] text-ink">
            {t("diffCounts", { orig: diffMap.diff.originalCount, cur: diffMap.diff.currentCount })}
          </span>
          {diffMap.diff.added > 0 && (
            <span className="rounded-3 bg-tint-action px-2 py-px font-mono text-[9.5px] font-bold text-action-deep">
              +{diffMap.diff.added} {t("diffNew")}
            </span>
          )}
          {diffMap.diff.modified > 0 && (
            <span className="rounded-3 bg-tint-gate px-2 py-px font-mono text-[9.5px] font-bold text-gate-text">
              {diffMap.diff.modified} {t("diffMod")}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              setShowOriginal((v) => !v);
              setTrails((prev) => ({ ...prev, [trailKind]: { path: [], ve: [] } }));
              setView("overview");
            }}
            className="rounded-control border border-line bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-ink-secondary hover:bg-soft"
          >
            {showOriginal ? t("showEdited") : t("showOriginal")}
          </button>
          <div className="flex-1" />
          {diffMap.status === "approved" ? (
            <>
              <span className="text-[11.5px] text-done-text">{t("approvedNote")}</span>
              {mode === initialKind && approveSlot}
            </>
          ) : (
            <>
              <span className="text-[11px] text-ink-tertiary">{t("iterateFreely")}</span>
              {mode === initialKind && approveSlot}
            </>
          )}
        </div>
      )}

      {/* ── Törzs: canvas + inspector ── */}
      <div className="relative flex min-h-0">
        {/* CANVAS */}
        <div
          ref={canvasRef}
          onMouseDown={(e) => {
            setDragging(true);
            dragFrom.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
          }}
          onMouseMove={(e) => {
            if (dragging && dragFrom.current) {
              setPan({ x: e.clientX - dragFrom.current.x, y: e.clientY - dragFrom.current.y });
            }
          }}
          onMouseUp={() => setDragging(false)}
          onMouseLeave={() => setDragging(false)}
          className="relative min-w-0 flex-1 overflow-hidden"
          style={{
            height: CANVAS_H,
            cursor: dragging ? "grabbing" : "grab",
            background: "radial-gradient(circle at 30% 20%, #FBFBFD 0, #EAECF3 62%)",
          }}
        >
          {empty ? (
            <div className="flex h-full items-center justify-center px-8 text-center">
              <div>
                <p className="text-body text-ink-secondary">
                  {mode === "to_be" ? t("emptyTobe") : t("emptyAsis")}
                </p>
                <Link
                  href={`/project/${projectId}/process`}
                  className="mt-3 inline-block rounded-control bg-action px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-action-hover"
                >
                  {t("emptyCta")} →
                </Link>
              </div>
            </div>
          ) : mode !== "cmp" ? (
            <World
              nodes={nodes}
              edges={edges}
              ve={ve}
              visited={visited}
              cur={isFocus ? cur : null}
              camera={camera}
              camTransition={dragging ? "none" : "transform .7s cubic-bezier(.6,.02,.1,1)"}
              worldH={worldH}
              worldW={worldW}
              onGo={go}
              t={t}
            />
          ) : (
            <CompareView asIs={asIs} toBe={toBe} vw={vw} t={t} />
          )}

          {/* hint pill */}
          <div className="pointer-events-none absolute bottom-3.5 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-pill bg-[rgba(35,38,47,.92)] px-4 py-1.5 font-mono text-[11px] tracking-[0.03em] text-[#EDEEF3]">
            {mode === "cmp" ? t("hintCmp") : isFocus ? t("hintFocus") : t("hintOverview")}
          </div>

          {/* LEGENDA overlay */}
          {legendOpen && <LegendOverlay onClose={() => setLegendOpen(false)} t={t} />}

          {/* NYERS LEIRAT overlay */}
          {srcOpen && source && (
            <div className="absolute bottom-12 left-3.5 z-[18] w-[560px] max-w-[calc(100%-28px)] overflow-hidden rounded-shell border-[1.5px] border-pivot bg-surface shadow-shell">
              <div className="flex items-center gap-2 border-b border-line bg-tint-sky px-3.5 py-2.5">
                <span className="font-mono text-[10.5px] font-bold text-pivot">[{t("sourceTag")}]</span>
                <span className="min-w-0 truncate text-[12.5px] font-bold">{source.title}</span>
                <span className="shrink-0 text-[10.5px] text-ink-tertiary">{t("sourceReadonly")}</span>
                <div className="flex-1" />
                <button type="button" onClick={() => setSrcOpen(false)} className="text-[13px] text-ink-secondary">
                  ✕
                </button>
              </div>
              <div className="max-h-[240px] overflow-y-auto px-4 py-3 text-[12.5px] leading-[1.7] text-ink-secondary">
                {highlight ? (
                  <>
                    <span>…{highlight.before}</span>
                    <span className="rounded-3 bg-tint-sky px-1 py-px font-semibold text-[#1D4E6E]">
                      {highlight.match}
                    </span>
                    <span>{highlight.after}…</span>
                  </>
                ) : (
                  <span className="whitespace-pre-wrap">{source.text}</span>
                )}
                <div className="mt-2 font-mono text-[9.5px] text-ink-tertiary">
                  {highlight && curNode?.source_ref
                    ? t("sourceHighlighted", { loc: curNode.source_ref.loc })
                    : t("sourceFull")}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* INSPECTOR */}
        <div
          className="flex w-[400px] shrink-0 flex-col border-l border-neutral-350/60 bg-surface"
          style={{ height: CANVAS_H }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 pt-5">
            {mode === "cmp" ? (
              <CompareInspector asIs={asIs} toBe={toBe} t={t} />
            ) : !isFocus || !curNode ? (
              <OverviewInspector mode={mode} stats={curStats} map={activeMap} t={t} />
            ) : (
              <NodeInspector
                node={curNode}
                pos={`${order.indexOf(curNode.id) + 1}${t("posSep")}${order.length}`}
                outEdges={outEdges}
                nodeById={nodeById}
                onGo={go}
                onOpenSrc={() => setSrcOpen(true)}
                hasSource={source !== null}
                t={t}
              />
            )}
          </div>
          {/* inspector footer */}
          <div className="flex items-center gap-2 border-t border-neutral-350/60 bg-soft px-4 py-2.5">
            <button
              type="button"
              onClick={() => {
                const pp = path.slice(0, -1);
                while (pp.length > 1 && styleOf(nodeById.get(pp[pp.length - 1])?.type ?? "")?.shape !== "diamond") {
                  pp.pop();
                }
                setTrail({ path: pp.length ? pp : [startId], ve }, { view: "focus" });
              }}
              className="rounded-control border border-line bg-surface px-3 py-1.5 text-[12.5px] font-semibold hover:bg-soft"
            >
              ↶ {t("lastDecision")}
            </button>
            <button
              type="button"
              onClick={() => setTrail({ path: [startId], ve: [] }, { view: "overview" })}
              className="rounded-control border border-line bg-surface px-3 py-1.5 text-[12.5px] font-semibold hover:bg-soft"
            >
              {t("restart")}
            </button>
            <span className="ml-auto font-mono text-[11px] text-ink-tertiary">
              {t("visitedMeta", { n: path.length, total: order.length })}
            </span>
          </div>
        </div>

        {/* CHAT DRAWER (Fázis 4 — slot; a ✕ a contexten kapott bezáróval zár) */}
        {chatOpen && mode === initialKind && (
          <ProcessChatCloseContext.Provider value={closeChat}>
            {chatSlot}
          </ProcessChatCloseContext.Provider>
        )}
      </div>

      {/* ── Breadcrumbs ── */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-t border-neutral-350/60 bg-surface px-4 py-2">
        <span className="mr-1.5 shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-tertiary">
          {t("crumbsLabel")}
        </span>
        {mode !== "cmp" && path.length > 1 ? (
          path.map((id, i) => (
            <span key={`${id}-${i}`} className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setTrail({ path: path.slice(0, i + 1), ve }, { view: "focus" })}
                className={`whitespace-nowrap rounded-pill border px-2.5 py-1 text-[12px] ${
                  i === path.length - 1
                    ? "border-action bg-action text-white"
                    : "border-neutral-350 bg-soft text-ink-secondary hover:bg-sunken"
                }`}
              >
                {nodeById.get(id)?.title ?? id}
              </button>
              {i < path.length - 1 && <span className="text-[11px] text-neutral-400">›</span>}
            </span>
          ))
        ) : (
          <span className="text-[11.5px] text-neutral-400">{t("noCrumbs")}</span>
        )}
      </div>
    </div>
  );
}

// ── Világ (egy mód gráfja) ───────────────────────────────────

function World({
  nodes,
  edges,
  ve,
  visited,
  cur,
  camera,
  camTransition,
  worldH,
  worldW,
  onGo,
  t,
}: {
  nodes: ProcessNode[];
  edges: ProcessEdge[];
  ve: string[];
  visited: Set<string>;
  cur: string | null;
  camera: string;
  camTransition: string;
  worldH: number;
  worldW: number;
  onGo: (id: string) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  return (
    <div
      className="absolute left-0 top-0"
      style={{ width: worldW, height: worldH, transform: camera, transformOrigin: "0 0", transition: camTransition }}
    >
      <svg width={worldW} height={worldH} className="pointer-events-none absolute left-0 top-0">
        <defs>
          <marker id="pfArr" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M1,1 L8,4.5 L1,8" fill="none" stroke="#C7CAD6" strokeWidth="2.2" />
          </marker>
          <marker id="pfArrV" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M1,1 L8,4.5 L1,8" fill="none" stroke="#1F5AE8" strokeWidth="2.4" />
          </marker>
        </defs>
        {edges.map((e) => {
          const g = edgePath(nodes, e);
          if (!g) return null;
          const isV = ve.includes(ekey(e));
          return (
            <path
              key={e.id}
              d={g.d}
              fill="none"
              stroke={isV ? "#1F5AE8" : "#C7CAD6"}
              strokeWidth={isV ? 3.5 : 2.5}
              markerEnd={isV ? "url(#pfArrV)" : "url(#pfArr)"}
            />
          );
        })}
      </svg>
      {edges.map((e) => {
        if (!e.label) return null;
        const g = edgePath(nodes, e);
        if (!g) return null;
        const isV = ve.includes(ekey(e));
        return (
          <div
            key={`l-${e.id}`}
            className="pointer-events-none absolute whitespace-nowrap rounded-control bg-[#F4F5F9] px-2 py-0.5 font-mono text-[12px] font-semibold"
            style={{
              left: g.labelAt[0],
              top: g.labelAt[1],
              transform: "translate(-50%,-50%)",
              color: isV ? "#1E52D4" : "#8B90A3",
            }}
          >
            {e.label}
          </div>
        );
      })}
      {nodes.map((n) => {
        const st = styleOf(n.type);
        const isCur = cur === n.id;
        const isVisited = visited.has(n.id) && !isCur;
        const isNew = n.diff === "new";
        const isDiamond = st.shape === "diamond";
        const shadow = isCur
          ? "0 0 0 4px rgba(31, 90, 232,.24), 0 14px 34px rgba(22, 62, 158,.2)"
          : "0 1px 2px rgba(35,38,47,.05), 0 6px 18px rgba(35,38,47,.06)";
        // Állapot-függő keretszín (a kanonikus alak/szín ProcessNodeShape-ben).
        const borderColor = isDiamond
          ? isCur
            ? "#2E77A8"
            : visited.has(n.id)
              ? "#1F5AE8"
              : st.line
          : isNew
            ? "#1F5AE8"
            : isCur
              ? st.c
              : st.line;
        return (
          <button
            key={n.id}
            type="button"
            onClick={() => onGo(n.id)}
            className="absolute flex cursor-pointer items-center justify-center"
            style={{ left: n.x, top: n.y, transform: "translate(-50%,-50%)" }}
          >
            <ProcessNodeShape
              node={n}
              borderColor={borderColor}
              boxShadow={shadow}
              dashed={!isDiamond && isNew}
              showDiffBadge
              t={t}
            >
              {isVisited && (
                <VisitedTick className={isDiamond ? "absolute right-[18px] top-[18px] z-[2]" : "absolute -right-2 -top-2"} />
              )}
            </ProcessNodeShape>
          </button>
        );
      })}
    </div>
  );
}

function VisitedTick({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`flex h-[19px] w-[19px] items-center justify-center rounded-full border-2 border-white bg-action text-[11px] text-white ${className ?? ""}`}
    >
      ✓
    </span>
  );
}

// ── KANONIKUS node-vizuál: alak (pill/rombusz/kártya) + kitöltés + típus-
// címke + szín a `styleOf(type)` egyetlen forrásból. MINDEN felület ezt
// használja (fő canvas, bejárás/fókusz, Compare mini-térképek), így a
// típus-nyelvtan sosem tér el nézetenként. A méret azonos (n.w / rombusz
// 190×190); a Compare-oldal a világ-transzformmal kicsinyít, nem külön
// stílussal. Az állapot-függő KERET (aktuális/látogatott/új) és a
// dekorációk (✓, diff-jelvény) a hívótól jönnek propban — az ALAK/SZÍN/
// TÍPUSCÍMKE itt kanonikus.
function ProcessNodeShape({
  node,
  borderColor,
  boxShadow,
  dashed,
  showDiffBadge,
  t,
  children,
}: {
  node: ProcessNode;
  borderColor: string;
  boxShadow?: string;
  dashed?: boolean;
  showDiffBadge?: boolean;
  t: (key: string, values?: Record<string, string | number>) => string;
  children?: React.ReactNode;
}) {
  const st = styleOf(node.type);
  const isNew = node.diff === "new";

  if (st.shape === "diamond") {
    return (
      <span aria-hidden={false} className="relative flex items-center justify-center" style={{ width: 190, height: 190 }}>
        <span
          aria-hidden
          className="absolute left-1/2 top-1/2 rounded-5"
          style={{
            width: "70.7%",
            height: "70.7%",
            transform: "translate(-50%,-50%) rotate(45deg)",
            background: st.bg,
            border: `2px solid ${borderColor}`,
            boxShadow,
          }}
        />
        <span className="relative z-[1] max-w-[130px] text-center">
          <span className="mb-0.5 block font-mono text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: st.fg }}>
            {t(`nodeType.${st.labelKey}`)}
          </span>
          <span className="text-[13.5px] font-semibold leading-[1.18] text-ink">{node.title}</span>
        </span>
        {children}
      </span>
    );
  }

  return (
    <span
      className="relative block px-4 py-2.5 text-center"
      style={{
        width: node.w,
        background: st.bg,
        border: dashed ? `2px dashed ${borderColor}` : `1.5px solid ${borderColor}`,
        borderRadius: st.shape === "pill" ? 999 : 6,
        boxShadow,
      }}
    >
      <span className="flex items-center justify-center gap-1.5">
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.14em]" style={{ color: st.fg }}>
          {t(`nodeType.${st.labelKey}`)}
        </span>
        {showDiffBadge && node.diff && (
          <span
            className="rounded-3 px-1.5 py-px font-mono text-[8px] font-bold"
            style={{
              color: isNew ? "#1E52D4" : "#9A6A12",
              background: isNew ? "#E7EEFD" : "#FBF3E0",
            }}
          >
            {isNew ? t("badgeNewChat") : t("badgeModified")}
          </span>
        )}
      </span>
      <span className="mt-0.5 block text-[14px] font-semibold leading-[1.22] tracking-[-0.01em] text-ink">
        {node.title}
      </span>
      {node.sub && <span className="mt-0.5 block font-mono text-[9.5px] text-ink-tertiary">{node.sub}</span>}
      {children}
    </span>
  );
}

// ── Compare nézet: két mini-világ egymás mellett ─────────────

function CompareView({
  asIs,
  toBe,
  vw,
  t,
}: {
  asIs: ProcessMapData | null;
  toBe: ProcessMapData | null;
  vw: number;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const half = vw / 2;
  const mini = (m: ProcessMapData | null, left: number, labelKey: string, labelCls: string) => {
    if (!m) return null;
    const h = worldHeight(m.nodes);
    const w = worldWidth(m.nodes);
    const s = Math.min((half - 40) / w, (CANVAS_H - 60) / h);
    return (
      <>
        <div
          className={`absolute top-3 z-[5] rounded-3 px-2.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.1em] ${labelCls}`}
          style={{ left: left + 14 }}
        >
          {t(labelKey, { n: m.nodes.length })}
        </div>
        <div
          className="absolute top-[26px]"
          style={{ left, width: w, height: h, transform: `translate(20px,10px) scale(${s})`, transformOrigin: "0 0" }}
        >
          <svg width={w} height={h} className="pointer-events-none absolute left-0 top-0">
            {m.edges.map((e) => {
              const g = edgePath(m.nodes, e);
              return g ? <path key={e.id} d={g.d} fill="none" stroke="#C1C6D4" strokeWidth={3} /> : null;
            })}
          </svg>
          {m.nodes.map((n) => {
            const st = styleOf(n.type);
            const isNew = n.diff === "new";
            // Ugyanaz a kanonikus node-vizuál, mint a fő canvason — a méretet
            // a világ-transzform (scale) kicsinyíti, a típus-nyelvtan nem tér el.
            return (
              <div key={n.id} className="absolute" style={{ left: n.x, top: n.y, transform: "translate(-50%,-50%)" }}>
                <ProcessNodeShape
                  node={n}
                  borderColor={isNew ? "#1F5AE8" : st.line}
                  dashed={st.shape !== "diamond" && isNew}
                  t={t}
                />
              </div>
            );
          })}
        </div>
      </>
    );
  };
  return (
    <>
      {mini(asIs, 0, "cmpLabelAsis", "bg-neutral-150 text-ink-secondary")}
      {mini(toBe, half, "cmpLabelTobe", "bg-tint-action text-action-deep")}
      <div className="absolute bottom-3.5 top-[26px] w-px bg-neutral-350" style={{ left: half }} />
    </>
  );
}

// ── Inspector-panelek ────────────────────────────────────────

function OverviewInspector({
  mode,
  stats,
  map,
  t,
}: {
  mode: Mode;
  stats: { steps: number; ai: number; hitl: number; open: number; decide: number };
  map: ProcessMapData | null;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const tobe = mode === "to_be";
  return (
    <>
      <span className="inline-flex rounded-pill bg-tint-sky px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-pivot">
        {t("ovChip")}
      </span>
      <h2 className="mb-2 mt-3 text-[22px] font-extrabold leading-[1.15] tracking-tight">
        {map?.title || (tobe ? t("ovTitleTobe") : t("ovTitleAsis"))}
      </h2>
      <p className="text-[13.5px] leading-[1.55] text-ink-secondary">
        {tobe ? t("ovDescTobe") : t("ovDescAsis")}
      </p>
      <SectionRule label={t("keyNumbers")} tone="muted" />
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-tile border border-line bg-soft px-3 py-2.5">
          <div className="font-mono text-[18px] font-bold text-ink">{stats.steps}</div>
          <div className="mt-0.5 text-[11px] text-ink-tertiary">{t("kpiSteps", { d: stats.decide })}</div>
        </div>
        <div className="rounded-tile border border-line bg-soft px-3 py-2.5">
          <div
            className="font-mono text-[18px] font-bold"
            style={{ color: tobe ? "#1E52D4" : stats.open > 0 ? "#C0455A" : "#2E7050" }}
          >
            {tobe ? `${stats.ai} + ${stats.hitl}` : stats.open}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-tertiary">
            {tobe ? t("kpiAiHitl") : t("kpiOpenPoints")}
          </div>
        </div>
      </div>
      <div className="mt-3.5 rounded-tile border border-dashed border-neutral-350 bg-[#F4F5F9] px-3.5 py-2.5 text-[12.5px] text-ink-secondary">
        {t("ovHint")}
      </div>
    </>
  );
}

function SectionRule({ label, tone }: { label: string; tone: "muted" | "accent" }) {
  return (
    <div
      className={`my-5 flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.16em] ${
        tone === "accent" ? "text-action-deep" : "text-ink-tertiary"
      }`}
    >
      {label}
      <span className={`h-px flex-1 ${tone === "accent" ? "bg-tint-action" : "bg-neutral-150"}`} />
    </div>
  );
}

function NodeInspector({
  node,
  pos,
  outEdges,
  nodeById,
  onGo,
  onOpenSrc,
  hasSource,
  t,
}: {
  node: ProcessNode;
  pos: string;
  outEdges: ProcessEdge[];
  nodeById: Map<string, ProcessNode>;
  onGo: (id: string) => void;
  onOpenSrc: () => void;
  hasSource: boolean;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const st = styleOf(node.type);
  const isDecide = st.shape === "diamond";
  const hasBranches = isDecide && outEdges.length > 1;
  const hasNext = outEdges.length === 1;
  const isEnd = outEdges.length === 0;
  const diffNote =
    node.diff_note ?? (node.diff === "new" ? t("diffNoteNewDefault") : node.diff === "mod" ? t("diffNoteModDefault") : null);
  return (
    <>
      <div className="flex items-center gap-2">
        <span
          className="inline-flex rounded-pill px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em]"
          style={{ background: st.bg, color: st.fg }}
        >
          {t(`nodeType.${st.labelKey}`)}
        </span>
        <span className="font-mono text-[10px] text-ink-tertiary">{pos}</span>
      </div>
      <h2 className="mb-2 mt-3 text-[22px] font-extrabold leading-[1.12] tracking-tight">{node.title}</h2>
      <p className="mb-3.5 text-[13.5px] leading-[1.55] text-ink-secondary">{node.desc}</p>

      {hasBranches && (
        <div className="mb-1.5 flex flex-col gap-2">
          {outEdges.map((e, i) => {
            const target = nodeById.get(e.to);
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => onGo(e.to)}
                className="flex items-center gap-2.5 rounded-control border-[1.5px] border-[#AAD0E6] bg-[#E6F1F8] px-3.5 py-2.5 text-left text-[13.5px] font-semibold hover:brightness-[0.98]"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-4 border-[1.5px] border-pivot bg-surface font-mono text-[13px] font-bold text-pivot">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">{e.label ?? t("branchTo", { title: target?.title ?? e.to })}</span>
                <span className="shrink-0 font-mono text-[10px] text-ink-tertiary">→ {target?.title}</span>
              </button>
            );
          })}
        </div>
      )}
      {hasNext && (
        <button
          type="button"
          onClick={() => onGo(outEdges[0].to)}
          className="inline-flex items-center gap-2 rounded-control bg-action px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-action hover:bg-action-hover"
        >
          {t("nextStep", { title: nodeById.get(outEdges[0].to)?.title ?? "" })} →
        </button>
      )}
      {isEnd && (
        <div className="rounded-control border border-dashed border-neutral-350 bg-[#F4F5F9] px-3.5 py-2.5 text-[13px] text-ink-secondary">
          ◉ {t("endNote")}
        </div>
      )}

      {diffNote && (
        <>
          <SectionRule label={t("changeSection")} tone="accent" />
          <div className="rounded-tile border border-[#CFDBF9] bg-accent-tint px-3 py-2.5 text-[12.5px] leading-[1.55] text-ink">
            {diffNote}
          </div>
        </>
      )}

      <SectionRule label={t("sourceSection")} tone="muted" />
      {node.source_ref ? (
        <div className="rounded-tile border-[1.5px] border-pivot bg-surface px-3 py-2.5">
          <span className="rounded-3 bg-tint-sky px-1.5 py-px font-mono text-[10px] font-bold text-pivot">
            {node.source_ref.ref}
          </span>
          <p className="mt-1.5 text-[12.5px] italic leading-[1.55] text-[#4B4F60]">{node.source_ref.quote}</p>
          <p className="mt-1.5 font-mono text-[9.5px] text-ink-tertiary">{node.source_ref.loc}</p>
          {hasSource && node.source_ref.ref !== "CHAT" && (
            <button
              type="button"
              onClick={onOpenSrc}
              className="mt-1.5 font-mono text-[10.5px] font-semibold text-action-deep hover:underline"
            >
              {t("openInSource")} ↗
            </button>
          )}
        </div>
      ) : (
        <p className="text-[11.5px] text-ink-tertiary">{t("noSourceRef")}</p>
      )}

      {/* ADATMODELL-HÁTTÉR — INAKTÍV/szürke, nincs backend (HAMAROSAN). */}
      <SectionRule label={t("dataModelSection")} tone="muted" />
      <div className="rounded-tile border border-dashed border-[#CFD3DE] bg-[#F5F6F9] px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#A9AEBD" strokeWidth="1.3">
            <rect x="2.5" y="5.5" width="7" height="5" rx="1" />
            <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
          </svg>
          <span className="font-mono text-[9px] font-bold tracking-[0.1em] text-[#A9AEBD]">
            {t("comingSoonTag")}
          </span>
        </div>
        <p className="mt-1.5 text-[11.5px] leading-[1.55] text-[#A9AEBD]">{t("dataModelSoon")}</p>
        <div className="mt-2 overflow-hidden rounded-4 border border-dashed border-[#D7DAE3]">
          <div className="h-5 bg-[#EBEDF2]" />
          <div className="h-3.5 border-t border-dashed border-line" />
          <div className="h-3.5 border-t border-dashed border-line" />
        </div>
      </div>

      <SectionRule label={`${t("openPointsSection")} · ${node.open_points.length}`} tone="muted" />
      {node.open_points.length === 0 ? (
        <p className="text-[11.5px] text-ink-tertiary">{t("noOpenPoints")}</p>
      ) : (
        node.open_points.map((q, i) => {
          const s = OPEN_POINT_STYLE[q.level] ?? OPEN_POINT_STYLE.clarify;
          return (
            <div
              key={i}
              className="mb-2.5 rounded-[4px_6px_6px_4px] px-3 py-2.5"
              style={{ borderLeft: `4px solid ${s.c}`, background: s.bg }}
            >
              <span
                className="rounded-pill px-2 py-px font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-white"
                style={{ background: s.c }}
              >
                {t(`openLevel.${q.level}`)}
              </span>
              <p className="mt-1.5 text-[12.5px] leading-[1.45] text-ink">{q.text}</p>
            </div>
          );
        })
      )}
    </>
  );
}

function CompareInspector({
  asIs,
  toBe,
  t,
}: {
  asIs: ProcessMapData | null;
  toBe: ProcessMapData | null;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  // Származtatott „mi változik”: + = TO-BE AI/HITL lépések; − = AS-IS emberi
  // lépések, amelyek címe nem él tovább a TO-BE-ben. Metrika-kötés nélkül
  // VÁRT HATÁS-t nem fabrikálunk — halk jelzés megy helyette.
  const plus = (toBe?.nodes ?? []).filter((n) => n.type === "ai_intervention" || n.type === "control_hitl");
  const tobeTitles = new Set((toBe?.nodes ?? []).map((n) => n.title));
  const minus = (asIs?.nodes ?? []).filter((n) => n.type === "human" && !tobeTitles.has(n.title));
  return (
    <>
      <span className="inline-flex rounded-pill bg-tint-action px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-action-deep">
        {t("cmpChip")}
      </span>
      <h2 className="mb-2 mt-3 text-[22px] font-extrabold leading-[1.15] tracking-tight">AS-IS → TO-BE</h2>
      {!asIs || !toBe ? (
        <p className="text-[13px] leading-[1.55] text-ink-secondary">{t("cmpMissing")}</p>
      ) : (
        <>
          <div className="mt-1.5 flex flex-col gap-2">
            {plus.map((n) => (
              <div
                key={n.id}
                className="flex gap-2 rounded-5 border border-line px-3 py-2 text-[12.5px] leading-[1.5]"
                style={{ borderLeft: `3px solid ${n.type === "control_hitl" ? "#B4801E" : "#1F5AE8"}` }}
              >
                <b className="shrink-0" style={{ color: n.type === "control_hitl" ? "#9A6A12" : "#1E52D4" }}>
                  +
                </b>
                <span>
                  <b>{n.title}</b>
                  {n.sub ? ` — ${n.sub}` : ""}
                </span>
              </div>
            ))}
            {minus.map((n) => (
              <div
                key={n.id}
                className="flex gap-2 rounded-5 border border-line px-3 py-2 text-[12.5px] leading-[1.5]"
                style={{ borderLeft: "3px solid #C0455A" }}
              >
                <b className="shrink-0 text-[#A6384C]">−</b>
                <span>
                  <b>{n.title}</b> {t("cmpDropped")}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-tile border border-dashed border-neutral-350 bg-sunken px-3.5 py-2.5">
            <div className="font-mono text-[9px] font-bold tracking-[0.1em] text-ink-tertiary">
              {t("expectedImpact")}
            </div>
            <p className="mt-1 text-[11.5px] leading-[1.5] text-ink-tertiary">{t("expectedImpactNone")}</p>
          </div>
          <p className="mt-2.5 text-[11.5px] leading-[1.55] text-ink-tertiary">{t("cmpFooter")}</p>
        </>
      )}
    </>
  );
}

function LegendOverlay({
  onClose,
  t,
}: {
  onClose: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const row = (swatch: React.ReactNode, label: string) => (
    <div className="my-1.5 flex items-center gap-2.5 text-[12.5px]">
      {swatch}
      {label}
    </div>
  );
  const sq = (bg: string, line: string, extra?: string) => (
    <span
      aria-hidden
      className={`h-[15px] w-[15px] shrink-0 rounded-4 ${extra ?? ""}`}
      style={{ background: bg, border: `1.5px solid ${line}` }}
    />
  );
  return (
    <div className="absolute right-3.5 top-3.5 z-20 w-[300px] rounded-shell border border-neutral-350 bg-surface p-4 shadow-shell">
      <button type="button" onClick={onClose} className="absolute right-3 top-2 text-[15px] text-ink-tertiary">
        ×
      </button>
      <div className="mb-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.1em]">{t("legendTitle")}</div>
      {row(
        <span aria-hidden className="h-[15px] w-[15px] shrink-0 rounded-pill" style={{ background: "#E9F5EF", border: "1.5px solid #3E9E6E" }} />,
        t("legendStartEnd"),
      )}
      {row(sq("#F4F5F9", "#8B90A3"), t("legendHuman"))}
      {row(sq("#E6F1F8", "#256087"), t("legendSystem"))}
      {row(sq("#DDF0F7", "#2E77A8", "rotate-45"), t("legendDecide"))}
      {row(sq("#EAF1FE", "#1F5AE8"), t("legendAi"))}
      {row(sq("#FBF3E0", "#B4801E"), t("legendHitl"))}
      <div className="mb-1 mt-3 font-mono text-[11px] uppercase tracking-[0.05em] text-ink-tertiary">
        {t("legendOpenPoints")}
      </div>
      {row(sq("#FBECEF", "#C0455A"), t("openLevel.blocker"))}
      {row(sq("#FBF3E0", "#B4801E"), t("openLevel.important"))}
      {row(sq("#E9F5EF", "#3E9E6E"), t("openLevel.clarify"))}
      <p className="mt-2.5 border-t border-neutral-150 pt-2 text-[11px] leading-[1.5] text-ink-tertiary">
        {t("legendNote")}
      </p>
    </div>
  );
}

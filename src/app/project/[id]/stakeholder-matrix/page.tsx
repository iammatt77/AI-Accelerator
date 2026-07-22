import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { hasMatrixPoint, quadrant, type Quadrant } from "@/lib/stakeholders/matrix";
import type { ProjectRow, StakeholderRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Epic 3 · 3.4 — P1 ÖSSZESÍTETT stakeholder-mátrix (önálló tool-nézet).
// A részletlap mátrix-herójának (MatrixCard) formanyelvét nagyítja teljes
// nézetté: négy negyed a kezelési stratégiákkal (ugyanaz a terminológia:
// stakeholders.quadrant.*), az ÖSSZES megerősített stakeholder a saját
// pontszámai szerint. A hordozó: route — a 3.1 route-tool mintája.
//
// ÁTFEDÉS-KEZELÉS: a score-ok 1–5 egészek, az azonos pontszám PONTOSAN
// azonos pozíció (25 lehetséges cella) — ezért a nézet 5×5 cella-rács:
// az egy cellába esők pirulái egymás mellett sortörve, mind látható és
// kattintható (nincs „+N" csonkolás — F5). Pontszám nélküli megerősített
// stakeholder a mátrixban nem ábrázolható → külön sávban, kattinthatóan.
// ─────────────────────────────────────────────────────────────

const QUADRANT_TINT: Record<Quadrant, string> = {
  keep_satisfied: "#FAF4E8",
  manage_closely: "#EEF3FE",
  monitor: "#F4F5F8",
  keep_informed: "#EAF1F7",
};
const QUADRANT_TEXT: Record<Quadrant, string> = {
  keep_satisfied: "text-gate-text",
  manage_closely: "text-action-deep",
  monitor: "text-neutral-500",
  keep_informed: "text-pivot",
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default async function StakeholderMatrixPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createServiceSupabaseClient();

  const [{ data: projectData }, { data: shData }, t, tTools] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("stakeholders")
      .select("*")
      .eq("project_id", id)
      .order("created_at", { ascending: true }),
    getTranslations("stakeholders"),
    getTranslations("tools"),
  ]);
  if (!projectData) notFound();
  const project = projectData as ProjectRow;

  const confirmed = ((shData ?? []) as StakeholderRow[]).filter(
    (s) => s.state === "confirmed" || s.state === "manual",
  );
  const placed = confirmed.filter((s) => hasMatrixPoint(s.influence_score, s.impact_score));
  const unscored = confirmed.filter((s) => !hasMatrixPoint(s.influence_score, s.impact_score));
  const hotCount = placed.filter(
    (s) => quadrant(s.influence_score as number, s.impact_score as number) === "manage_closely",
  ).length;

  // 5×5 cella-rács: sor = befolyás (5 felül), oszlop = érintettség (1 balra).
  const cellOf = new Map<string, StakeholderRow[]>();
  for (const s of placed) {
    const key = `${s.influence_score}:${s.impact_score}`;
    const list = cellOf.get(key) ?? [];
    list.push(s);
    cellOf.set(key, list);
  }
  const cellQuadrant = (influence: number, impact: number): Quadrant =>
    quadrant(influence, impact);

  const pill = (s: StakeholderRow, hot: boolean) => (
    <Link
      key={s.id}
      href={`/project/${id}/stakeholder/${s.id}`}
      title={`${s.name}${s.title ? ` — ${s.title}` : ""}`}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-pill border py-1 pl-1 pr-2.5 shadow-card-sm transition-colors duration-[var(--motion-base)] ${
        hot
          ? "border-action-light bg-surface hover:bg-accent-fill"
          : "border-line bg-surface hover:bg-neutral-50"
      }`}
    >
      <span
        className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-pill font-mono text-[8.5px] font-bold ${
          hot ? "bg-action text-white" : "bg-neutral-150 text-ink-secondary"
        }`}
      >
        {initialsOf(s.name)}
      </span>
      <span className="truncate text-[12px] font-semibold">{s.name}</span>
    </Link>
  );

  return (
    <div className="space-y-5">
      <div>
        <Link
          href={`/project/${id}/phase/P1`}
          className="text-mono-sm text-ink-tertiary hover:text-ink-secondary hover:underline"
        >
          ← {project.name} · P1
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-title">{tTools("names.stakeholderMatrix")}</h1>
          <span className="rounded-pill bg-neutral-100 px-2 py-0.5 font-mono text-mono-sm font-semibold text-ink-secondary">
            {t("matrixView.count", { n: confirmed.length })}
          </span>
          {hotCount > 0 && (
            <span className="rounded-pill bg-accent-fill px-2 py-0.5 font-mono text-mono-sm font-semibold text-action-deep">
              {t("matrixView.hotCount", { n: hotCount })}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-body text-ink-secondary">{t("matrixView.lead")}</p>
      </div>

      {confirmed.length === 0 ? (
        <div className="card-sunken mx-auto mt-8 max-w-md p-8 text-center">
          <p className="text-body font-semibold text-ink-secondary">{t("matrixView.empty")}</p>
          <p className="mt-1 text-body text-ink-tertiary">{t("matrixView.emptyHint")}</p>
          <Link
            href={`/project/${id}/phase/P1`}
            className="mt-4 inline-flex items-center justify-center rounded-control border border-line bg-surface px-4 py-2 text-body font-medium shadow-tile-sm hover:bg-sunken"
          >
            {t("matrixView.goToP1")}
          </Link>
        </div>
      ) : (
        <div className="surface-card p-5">
          <div className="flex gap-3">
            {/* Y tengely */}
            <div className="flex items-center">
              <span
                className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-ink-tertiary"
                style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
              >
                {t("axisInfluence")} →
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="relative overflow-hidden rounded-6 border border-line-soft">
                {/* Negyed-tintek: a küszöb 3,5 → felül a 4–5-ös befolyás-sorok
                    (2/5 magasság), jobbra a 4–5-ös érintettség-oszlopok. */}
                <div className="absolute left-0 top-0 h-[40%] w-[60%]" style={{ background: QUADRANT_TINT.keep_satisfied }} />
                <div className="absolute right-0 top-0 h-[40%] w-[40%]" style={{ background: QUADRANT_TINT.manage_closely }} />
                <div className="absolute bottom-0 left-0 h-[60%] w-[60%]" style={{ background: QUADRANT_TINT.monitor }} />
                <div className="absolute bottom-0 right-0 h-[60%] w-[40%]" style={{ background: QUADRANT_TINT.keep_informed }} />
                <div className="absolute bottom-0 top-0 left-[60%] w-px bg-[#E0E3EC]" />
                <div className="absolute left-0 right-0 top-[40%] h-px bg-[#E0E3EC]" />

                {/* Negyed-címkék — a részletlap-hero terminológiája */}
                <div className={`absolute left-3 top-2 font-mono text-[9.5px] font-bold ${QUADRANT_TEXT.keep_satisfied}`}>
                  {t("quadrant.keep_satisfied.label")}
                </div>
                <div className={`absolute right-3 top-2 text-right font-mono text-[9.5px] font-bold ${QUADRANT_TEXT.manage_closely}`}>
                  {t("quadrant.manage_closely.label")}
                </div>
                <div className={`absolute bottom-2 left-3 font-mono text-[9.5px] font-bold ${QUADRANT_TEXT.monitor}`}>
                  {t("quadrant.monitor.label")}
                </div>
                <div className={`absolute bottom-2 right-3 text-right font-mono text-[9.5px] font-bold ${QUADRANT_TEXT.keep_informed}`}>
                  {t("quadrant.keep_informed.label")}
                </div>

                {/* 5×5 cella-rács — sor: befolyás 5→1, oszlop: érintettség 1→5 */}
                <div className="relative grid grid-cols-5 gap-0 px-2 py-7">
                  {[5, 4, 3, 2, 1].map((influence) =>
                    [1, 2, 3, 4, 5].map((impact) => {
                      const people = cellOf.get(`${influence}:${impact}`) ?? [];
                      const hot = cellQuadrant(influence, impact) === "manage_closely";
                      return (
                        <div
                          key={`${influence}:${impact}`}
                          className="flex min-h-[52px] flex-wrap content-center items-center justify-center gap-1.5 p-1"
                        >
                          {people.map((s) => pill(s, hot))}
                        </div>
                      );
                    }),
                  )}
                </div>
              </div>
              <div className="mt-1.5 text-center font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-ink-tertiary">
                {t("axisImpact")} →
              </div>
            </div>
          </div>

          {/* Pontszám nélküli megerősítettek — a mátrixban nem ábrázolhatók,
              de elérhetők (kattintva a részletlapon pontozhatók). */}
          {unscored.length > 0 && (
            <div className="mt-4 rounded-tile border border-dashed border-line bg-sunken px-3 py-2.5">
              <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-ink-tertiary">
                {t("matrixView.unscoredTitle", { n: unscored.length })}
              </p>
              <p className="mt-0.5 text-mono-sm text-ink-tertiary">{t("matrixView.unscoredHint")}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">{unscored.map((s) => pill(s, false))}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

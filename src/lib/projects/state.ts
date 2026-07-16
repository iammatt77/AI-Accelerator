import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPhaseBoard, type EvaluatedCriterion } from "@/lib/phases/service";
import { nextPhase as computeNextPhase, type PhaseId } from "@/lib/phases/config";
import { daysSince, STALL_THRESHOLD_DAYS, type AttentionLevel } from "@/lib/clients/portfolio";
import type { ProjectRow } from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Projekt-állapot levezetés (server-only) — az Ügyfelek- ÉS a Projektek-lap
// KÖZÖS forrása (nincs duplikáció). A meglévő állapotgép + kapu-logika +
// portfolio.ts (stagnálás-küszöb) alapján: aktív fázis, kapu met/total,
// figyelem-szint, utolsó aktivitás (max created_at / artifacts.updated_at /
// decisions.created_at — nincs projects.updated_at), stagnálás.
// Az i18n-teendő-szöveget a hívó állítja össze a `firstUnmet`/mezők alapján.
// ─────────────────────────────────────────────────────────────

export interface ProjectState {
  projectId: string;
  attention: AttentionLevel;
  /** Aktív fázis; lezártnál az utolsó completed fázis. */
  phase: PhaseId;
  isClosed: boolean;
  gateReady: boolean;
  met: number;
  total: number;
  /** Napok az utolsó aktivitás óta. */
  days: number;
  lastIso: string;
  /** Az első nem teljesült kritérium (a teendő-szöveghez); null ha nincs. */
  firstUnmet: EvaluatedCriterion | null;
  nextPhase: PhaseId;
}

export async function loadProjectStates(
  supabase: SupabaseClient,
  projects: ProjectRow[],
  nowMs: number,
): Promise<Map<string, ProjectState>> {
  const ids = projects.map((p) => p.id);
  const [artRes, decRes, boards] = await Promise.all([
    ids.length
      ? supabase.from("artifacts").select("project_id, updated_at").in("project_id", ids)
      : Promise.resolve({ data: [] as { project_id: string; updated_at: string }[] }),
    ids.length
      ? supabase.from("decisions").select("project_id, created_at").in("project_id", ids)
      : Promise.resolve({ data: [] as { project_id: string; created_at: string }[] }),
    Promise.all(projects.map((p) => loadPhaseBoard(supabase, p.id))),
  ]);

  const artByProject = new Map<string, string[]>();
  for (const a of (artRes.data ?? []) as { project_id: string; updated_at: string }[]) {
    const list = artByProject.get(a.project_id) ?? [];
    list.push(a.updated_at);
    artByProject.set(a.project_id, list);
  }
  const decByProject = new Map<string, string[]>();
  for (const d of (decRes.data ?? []) as { project_id: string; created_at: string }[]) {
    const list = decByProject.get(d.project_id) ?? [];
    list.push(d.created_at);
    decByProject.set(d.project_id, list);
  }

  const map = new Map<string, ProjectState>();
  projects.forEach((project, i) => {
    const board = boards[i] ?? [];
    const active =
      board.find((e) => e.state === "in_progress" || e.state === "gate_pending") ??
      board.find((e) => e.state === "open") ??
      null;
    const completed = board.filter((e) => e.state === "completed");
    const lastCompleted = completed.length
      ? completed[completed.length - 1].phase
      : ("P0" as PhaseId);

    let lastIso = project.created_at;
    for (const iso of artByProject.get(project.id) ?? []) if (iso > lastIso) lastIso = iso;
    for (const iso of decByProject.get(project.id) ?? []) if (iso > lastIso) lastIso = iso;
    const days = daysSince(lastIso, nowMs);

    const met = active ? active.criteria.filter((c) => c.satisfied).length : 0;
    const total = active ? active.criteria.length : 0;
    const unmet = active ? active.criteria.filter((c) => !c.satisfied) : [];
    const isClosed = !active;
    const stalled = project.status === "active" && !isClosed && days >= STALL_THRESHOLD_DAYS;

    const attention: AttentionLevel = isClosed
      ? "closed"
      : stalled
        ? "stalled"
        : unmet.length > 0
          ? "blocked"
          : active?.gateReady
            ? "ready"
            : "healthy";

    const phase = active?.phase ?? lastCompleted;
    map.set(project.id, {
      projectId: project.id,
      attention,
      phase,
      isClosed,
      gateReady: Boolean(active?.gateReady),
      met,
      total,
      days,
      lastIso,
      firstUnmet: unmet[0] ?? null,
      nextPhase: computeNextPhase(phase) ?? phase,
    });
  });
  return map;
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPhaseBoard } from "@/lib/phases/service";
import { PHASE_IDS, type PhaseId } from "@/lib/phases/config";
import type {
  ArtifactRow,
  DecisionRow,
  InputItemRow,
  PainPointRow,
  UseCaseRow,
} from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Projektlista-kártya adatai — a Dashboard kártya (src/app/(top)/page.tsx)
// státusz- és spine-számítási elveit követi, ÖNÁLLÓAN (a Dashboard fájlját
// nem érinti a csomag). Ugyanaz a nyelvtan: needs_you (RÁD VÁR) / gate
// (KAPU) / stalled (ELAKADT) / healthy (nincs pill). Nincs blokkoló-lépés
// doboz — a Projektek/Ügyfél-lap kártya kompaktabb, csak a lista-áttekintés
// funkcióját szolgálja.
// ─────────────────────────────────────────────────────────────

export type ProjectListStatus = "needs_you" | "gate" | "stalled" | "healthy";

export interface ProjectListCardData {
  id: string;
  status: ProjectListStatus;
  closedCount: number;
  totalPhases: number;
  activePhase: PhaseId | null;
  spine: { phase: PhaseId; tone: "done" | "active" | "gate" | "idle" }[];
}

const STALLED_DAYS = 7;

export async function loadProjectListCard(
  supabase: SupabaseClient,
  projectId: string,
  projectCreatedAt: string,
): Promise<ProjectListCardData> {
  const [board, artRes, inRes, ppRes, ucRes, decRes] = await Promise.all([
    loadPhaseBoard(supabase, projectId),
    supabase
      .from("artifacts")
      .select("id, status, updated_at, created_at")
      .eq("project_id", projectId),
    supabase.from("input_items").select("id, created_at").eq("project_id", projectId),
    supabase.from("pain_points").select("id, state, created_at").eq("project_id", projectId),
    supabase
      .from("use_cases")
      .select("id, state, updated_at, created_at")
      .eq("project_id", projectId),
    supabase.from("decisions").select("id, created_at").eq("project_id", projectId),
  ]);
  const artifacts = (artRes.data ?? []) as Pick<
    ArtifactRow,
    "id" | "status" | "updated_at" | "created_at"
  >[];
  const inputs = (inRes.data ?? []) as Pick<InputItemRow, "id" | "created_at">[];
  const pains = (ppRes.data ?? []) as Pick<PainPointRow, "id" | "state" | "created_at">[];
  const ucs = (ucRes.data ?? []) as Pick<UseCaseRow, "id" | "state" | "updated_at" | "created_at">[];
  const decisions = (decRes.data ?? []) as Pick<DecisionRow, "id" | "created_at">[];

  const byPhase = new Map(board.map((e) => [e.phase, e]));
  const activeEntry =
    board.find((e) => e.state === "in_progress" || e.state === "gate_pending") ??
    board.find((e) => e.state === "open") ??
    null;

  const now = new Date();
  const stamps = [
    projectCreatedAt,
    ...artifacts.map((a) => a.updated_at ?? a.created_at),
    ...inputs.map((i) => i.created_at),
    ...pains.map((p) => p.created_at),
    ...ucs.map((u) => u.updated_at ?? u.created_at),
    ...decisions.map((d) => d.created_at),
  ].filter(Boolean);
  const lastTouch = new Date(Math.max(...stamps.map((s) => new Date(s).getTime())));
  const idleDays = Math.floor((now.getTime() - lastTouch.getTime()) / (24 * 3600 * 1000));

  const confirmations =
    pains.filter((p) => p.state === "ai_suggested").length +
    ucs.filter((u) => u.state === "ai_suggested").length;
  const reviews = artifacts.filter((a) => a.status === "in_review").length;
  const gateReady = Boolean(activeEntry?.gateReady) && (activeEntry?.criteria.length ?? 0) > 0;

  const status: ProjectListStatus =
    idleDays >= STALLED_DAYS
      ? "stalled"
      : confirmations + reviews > 0
        ? "needs_you"
        : gateReady || activeEntry?.state === "gate_pending"
          ? "gate"
          : "healthy";

  const spine = PHASE_IDS.map((p) => {
    const s = byPhase.get(p)?.state;
    return {
      phase: p,
      tone:
        s === "completed"
          ? ("done" as const)
          : s === "in_progress"
            ? ("active" as const)
            : s === "gate_pending"
              ? ("gate" as const)
              : ("idle" as const),
    };
  });

  return {
    id: projectId,
    status,
    closedCount: board.filter((e) => e.state === "completed").length,
    totalPhases: PHASE_IDS.length,
    activePhase: activeEntry?.phase ?? null,
    spine,
  };
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { docStaleSince, latestChangeOf } from "@/lib/staleness";
import type { ArtifactRow } from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Csomag A (A8) doc_stale számítás — kiemelve (Epic 3 · 3.2-d), hogy a
// dedikált artifact-szerkesztő oldal ÉS a fázis-munkafelület ③ Kimenet
// zóna-kártyája (OutputCard) UGYANAZT a logikát használja, egy helyen —
// a korábbi, oldalankénti duplikált switch driftelhetett volna.
//
// A `synced_at` bélyeg utáni legfrissebb modul-entitás-változás — CSAK
// a szinkronizált (entitás-forrású/modul-mezős) típusokra értelmezett;
// a `since` a NYERS trigger-időbélyeg, az ack-szűrést (activeStaleSince)
// a hívó végzi (a subject_id-t is a hívó ismeri).
// ─────────────────────────────────────────────────────────────

export async function docStaleSinceForArtifact(
  supabase: SupabaseClient,
  projectId: string,
  artifact: Pick<ArtifactRow, "type" | "synced_at">,
): Promise<string | null> {
  if (!artifact.synced_at) return null;
  let entityLatest: string | null = null;

  if (artifact.type === "Megoldás-dokumentáció") {
    const [{ data: bc }, { data: pi }, { data: cp }] = await Promise.all([
      supabase.from("build_components").select("updated_at").eq("project_id", projectId),
      supabase.from("prompt_items").select("updated_at").eq("project_id", projectId),
      supabase.from("control_points").select("updated_at").eq("project_id", projectId),
    ]);
    entityLatest = latestChangeOf([
      ...((bc ?? []) as { updated_at: string }[]),
      ...((pi ?? []) as { updated_at: string }[]),
      ...((cp ?? []) as { updated_at: string }[]),
    ]);
  } else if (artifact.type === "Tesztriport") {
    const { data: gs } = await supabase
      .from("golden_sets")
      .select("id, updated_at")
      .eq("project_id", projectId);
    const sets = (gs ?? []) as { id: string; updated_at: string }[];
    let cases: { updated_at: string }[] = [];
    if (sets.length > 0) {
      const { data: ec } = await supabase
        .from("eval_cases")
        .select("updated_at")
        .in(
          "golden_set_id",
          sets.map((s) => s.id),
        );
      cases = (ec ?? []) as { updated_at: string }[];
    }
    entityLatest = latestChangeOf([...sets, ...cases]);
  } else if (artifact.type === "Megoldási javaslat") {
    const { data: sc } = await supabase
      .from("solution_components")
      .select("updated_at")
      .eq("project_id", projectId);
    entityLatest = latestChangeOf((sc ?? []) as { updated_at: string }[]);
  }

  return docStaleSince(artifact.synced_at, entityLatest);
}

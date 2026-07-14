import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  completeness,
  parseArtifactFields,
  typesForPhase,
  type ArtifactTypeDef,
} from "@/lib/artifacts/config";
import type { PhaseId } from "@/lib/phases/config";
import type { ArtifactRow } from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Fázis-oldal „Ebben a fázisban készült dokumentumok" szekciójának adata.
// Ugyanazt a logikát használja, amit a Projektdokumentáció tár is (a
// típus-konfig + parseArtifactFields + completeness) — fázisra szűrve,
// önálló fájlban (a tár oldalát ez nem importálja/módosítja).
// ─────────────────────────────────────────────────────────────

export interface PhaseDocTile {
  key: string;
  typeDef: ArtifactTypeDef;
  head: ArtifactRow | null;
  filled: number;
  required: number;
}

export async function loadPhaseDocTiles(
  supabase: SupabaseClient,
  projectId: string,
  phase: PhaseId,
): Promise<PhaseDocTile[]> {
  const configured = typesForPhase(phase);
  if (configured.length === 0) return [];

  const { data } = await supabase
    .from("artifacts")
    .select("*")
    .eq("project_id", projectId)
    .in(
      "type",
      configured.map((td) => td.key),
    )
    .order("version", { ascending: false });
  const rows = (data ?? []) as ArtifactRow[];

  const byType = new Map<string, ArtifactRow[]>();
  for (const a of rows) {
    const list = byType.get(a.type) ?? [];
    list.push(a);
    byType.set(a.type, list);
  }

  return configured.map((td) => {
    const versions = byType.get(td.key) ?? [];
    const head = versions[0] ?? null;
    const parsed = head ? parseArtifactFields(td, head.fields) : null;
    const done = parsed
      ? completeness(td, parsed)
      : { filled: 0, required: td.fields.filter((f) => f.required).length };
    return { key: td.key, typeDef: td, head, filled: done.filled, required: done.required };
  });
}

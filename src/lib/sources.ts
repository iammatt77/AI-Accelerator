import type { SupabaseClient } from "@supabase/supabase-js";
import type { LlmSource } from "@/lib/llm/parse";
import type { InputItemRow } from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Forrás-számozás — KANONIKUS, közös helper (#7a-ban kiemelve az
// artifact-actions-ből, mert az entitás-akciók is ugyanezt a számozást
// használják; a "use server" fájl nem exportálhat nem-action helpert).
// ─────────────────────────────────────────────────────────────

/** A projekt bemenetei stabil sorrendben (created_at, majd id) — ez adja a
 *  forrás-SZÁMOZÁST (1..n). A source_input_ids az entitáson/artefaktumon
 *  PONTOSAN ezt a sorrendet rögzíti, így a [n] hivatkozás később is
 *  ugyanarra mutat. */
export async function loadNumberedSources(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{ sources: LlmSource[]; inputIds: string[] } | { error: string }> {
  const { data, error } = await supabase
    .from("input_items")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) return { error: error.message ?? "?" };
  const rows = (data ?? []) as InputItemRow[];
  return {
    sources: rows.map((row, i) => ({
      index: i + 1,
      title: row.type,
      text: row.raw_text,
    })),
    inputIds: rows.map((row) => row.id),
  };
}

/** 1-alapú forrás-indexek → input-id-k (a kanonikus számozás szerint).
 *  Az érvénytelen index kiesik (defenzív — a parse után ilyen nem várható). */
export function indicesToInputIds(indices: number[], inputIds: string[]): string[] {
  return indices
    .map((n) => inputIds[n - 1])
    .filter((id): id is string => typeof id === "string");
}

/** input-id-k → 1-alapú forrás-indexek a megadott kanonikus sorrendben.
 *  A már nem létező input kiesik (a [n] csak élő forrásra mutathat). */
export function inputIdsToIndices(ids: string[], inputIds: string[]): number[] {
  const pos = new Map(inputIds.map((id, i) => [id, i + 1]));
  return ids
    .map((id) => pos.get(id))
    .filter((n): n is number => typeof n === "number");
}

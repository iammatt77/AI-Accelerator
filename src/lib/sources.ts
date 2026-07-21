import type { SupabaseClient } from "@supabase/supabase-js";
import type { LlmSource } from "@/lib/llm/parse";
import type { InputItemRow } from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Forrás-számozás — KANONIKUS, közös helper (#7a-ban kiemelve; Csomag A/A8:
// VERZIÓ-CSOPORT-ALAPÚ). Egy forrás frissítése új sort hoz létre ugyanabban
// a group_id csoportban (version+1) — a kanonikus [n] számozás ezért
// CSOPORTONKÉNT él: minden csoportot a LEGFRISSEBB verziója képvisel, a
// sorrend a csoport ELSŐ verziójának created_at-ja szerint STABIL (új
// verzió nem mozdítja a számozást; új forrás a sor végére kerül). A
// meglévő citációk (source_input_ids — BÁRMELY verzió-id) a csoporton át
// oldódnak fel (aliasIndex), így forrás-frissítéskor nem törnek el.
// ─────────────────────────────────────────────────────────────

export interface NumberedSources {
  /** A csoportok legfrissebb verziói, kanonikus sorrendben (1..n). */
  sources: LlmSource[];
  /** Az n. forrás LEGFRISSEBB verziójának id-ja — az ÚJ citációk erre írnak. */
  inputIds: string[];
  /** BÁRMELY verzió-id → a csoport kanonikus 1-alapú indexe (régi citációk). */
  aliasIndex: Map<string, number>;
  /** A betöltött nyers sorok (a hívó pl. verzió-történethez használhatja). */
  rows: InputItemRow[];
}

/** Tiszta számozó a MÁR betöltött sorokon (a sorrend: created_at, id).
 *  Csoportosítás: kulcs a group_id (defenzív: régi sor group_id nélkül →
 *  saját id a csoportja). A csoport-sorrend az ELSŐ betöltött (legkorábbi
 *  created_at-ú) tag pozíciója — verzió-emelés nem mozdítja a számozást. */
export function numberSourceRows(rows: InputItemRow[]): NumberedSources {
  const groupOrder: string[] = [];
  const byGroup = new Map<string, InputItemRow[]>();
  for (const row of rows) {
    const gid = row.group_id ?? row.id;
    if (!byGroup.has(gid)) {
      byGroup.set(gid, []);
      groupOrder.push(gid);
    }
    byGroup.get(gid)!.push(row);
  }

  const sources: LlmSource[] = [];
  const inputIds: string[] = [];
  const aliasIndex = new Map<string, number>();
  for (const [i, gid] of groupOrder.entries()) {
    const versions = byGroup.get(gid)!;
    const latest = versions.reduce((a, b) => ((b.version ?? 1) > (a.version ?? 1) ? b : a));
    sources.push({ index: i + 1, title: latest.type, text: latest.raw_text });
    inputIds.push(latest.id);
    for (const v of versions) aliasIndex.set(v.id, i + 1);
  }
  return { sources, inputIds, aliasIndex, rows };
}

/** A projekt bemenetei csoportonként számozva. A source_input_ids az
 *  entitáson/artefaktumon a mindenkori legfrissebb verzió-id-t rögzíti; a
 *  korábbi verziókra mutató régi hivatkozásokat az aliasIndex oldja fel. */
export async function loadNumberedSources(
  supabase: SupabaseClient,
  projectId: string,
): Promise<NumberedSources | { error: string }> {
  const { data, error } = await supabase
    .from("input_items")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) return { error: error.message ?? "?" };
  return numberSourceRows((data ?? []) as InputItemRow[]);
}

/** 1-alapú forrás-indexek → input-id-k (a csoport LEGFRISSEBB verziója).
 *  Az érvénytelen index kiesik (defenzív — a parse után ilyen nem várható). */
export function indicesToInputIds(indices: number[], inputIds: string[]): string[] {
  return indices
    .map((n) => inputIds[n - 1])
    .filter((id): id is string => typeof id === "string");
}

/** input-id-k → 1-alapú kanonikus indexek. Map (aliasIndex) esetén BÁRMELY
 *  verzió-id feloldódik a csoportján át (A8: a citáció nem törik el);
 *  tömb esetén a régi, pozicionális viselkedés (csak legfrissebb id-k). */
export function inputIdsToIndices(
  ids: string[],
  inputIds: string[] | Map<string, number>,
): number[] {
  const pos =
    inputIds instanceof Map
      ? inputIds
      : new Map(inputIds.map((id, i) => [id, i + 1]));
  const out: number[] = [];
  for (const id of ids) {
    const n = pos.get(id);
    if (typeof n === "number" && !out.includes(n)) out.push(n);
  }
  return out;
}

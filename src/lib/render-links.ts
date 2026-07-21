import type { SupabaseClient } from "@supabase/supabase-js";
import type { RenderTargetType } from "@/lib/db/types";

/** Egy renderelés-él célja (artifact_render_links sor-csíra). */
export interface RenderTarget {
  target_type: RenderTargetType;
  target_id: string;
}

/**
 * Renderelés-élek CSERÉJE (Csomag C1, C1.2): az adott (artifact, field_key)
 * hatókör MINDEN meglévő éle törlődik, majd a friss cél-lista íródik be —
 * regen/re-sync után nincs duplikátum és nincs árva régi él.
 *
 * EGY-ÍRÓ elv: ezt KIZÁRÓLAG a 4 generálás/sync action hívhatja
 * (use case-rangsor, Megoldási javaslat, syncDoc, syncReport) —
 * field-extract és kézi mentés SOHA nem ír élt.
 *
 * field_key = null → teljes-dokumentum él (entitySourced generálás);
 * kitöltve → modul-mező él. A törlés-hatókör pontosan a field_key-re
 * illeszt (null-nál IS NULL), így a mező-szintű írók nem bántják
 * egymás éleit.
 *
 * A delete+insert SZEKVENCIÁLIS (PostgREST alatt nincs tranzakció) —
 * egyfelhasználós rendszerben elfogadott; hiba esetén a következő
 * regen/sync helyreállít (dokumentált korlát).
 */
export async function replaceRenderLinks(
  supabase: SupabaseClient,
  projectId: string,
  artifactId: string,
  fieldKey: string | null,
  targets: RenderTarget[],
): Promise<{ error: string | null }> {
  let del = supabase
    .from("artifact_render_links")
    .delete()
    .eq("artifact_id", artifactId);
  del = fieldKey === null ? del.is("field_key", null) : del.eq("field_key", fieldKey);
  const { error: delErr } = await del;
  if (delErr) return { error: delErr.message };

  // dedupe — a unique index (artifact, field_key, cél) hármason él
  const seen = new Set<string>();
  const rows = targets
    .filter((t) => {
      const k = `${t.target_type}:${t.target_id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((t) => ({
      project_id: projectId,
      artifact_id: artifactId,
      field_key: fieldKey,
      target_type: t.target_type,
      target_id: t.target_id,
      rendered_at: new Date().toISOString(),
    }));
  if (rows.length === 0) return { error: null };

  const { error: insErr } = await supabase.from("artifact_render_links").insert(rows);
  if (insErr) return { error: insErr.message };
  return { error: null };
}

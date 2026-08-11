"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { parseOrgLevel, parseSourceKind } from "@/lib/sources/meta";
import type { FormState } from "./actions";

// ─────────────────────────────────────────────────────────────
// Forrás-metaadat akciók (4.2b-a): a forrás TÍPUSA és SZERVEZETI SZINTJE a
// feltöltő tudása — itt pótolható utólag, egyesével vagy kötegben. A
// metaadat a verzió-CSOPORTRA vonatkozik (group_id): a forrás frissítése
// nem változtatja meg, ki adta ki és milyen dokumentum.
// ─────────────────────────────────────────────────────────────

/** Egy forrás-csoport metaadatának beállítása (a csoport MINDEN verziójára). */
export async function setSourceMetaAction(
  projectId: string,
  groupId: string,
  rawKind: string,
  rawLevel: string,
): Promise<FormState> {
  const t = await getTranslations("sourcesPage");
  const kind = parseSourceKind(rawKind);
  const level = parseOrgLevel(rawLevel);
  if (!kind && !level) {
    return { ok: false, error: t("metaNothingToSave") };
  }
  const db = createServiceSupabaseClient();
  const patch: Record<string, string> = {};
  if (kind) patch.source_kind = kind;
  if (level) patch.org_level = level;
  const { error } = await db
    .from("input_items")
    .update(patch)
    .eq("project_id", projectId)
    .eq("group_id", groupId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/project/${projectId}/sources`);
  revalidatePath(`/project/${projectId}/catalog`);
  return { ok: true, error: null, notice: t("metaSaved") };
}

/** Kötegelt pótlás: MINDEN metaadat-hiányos forrás megkapja a megadott
 *  típust/szintet (F2 — „ne egyesével, ha sok van"). Csak a HIÁNYZÓ mezőt
 *  írja; a már megadott értéket nem írja felül. */
export async function bulkSetSourceMetaAction(
  projectId: string,
  rawKind: string,
  rawLevel: string,
): Promise<FormState> {
  const t = await getTranslations("sourcesPage");
  const kind = parseSourceKind(rawKind);
  const level = parseOrgLevel(rawLevel);
  if (!kind && !level) {
    return { ok: false, error: t("metaNothingToSave") };
  }
  const db = createServiceSupabaseClient();
  let touched = 0;
  if (kind) {
    const { data, error } = await db
      .from("input_items")
      .update({ source_kind: kind })
      .eq("project_id", projectId)
      .is("source_kind", null)
      .select("id");
    if (error) return { ok: false, error: error.message };
    touched = Math.max(touched, (data ?? []).length);
  }
  if (level) {
    const { data, error } = await db
      .from("input_items")
      .update({ org_level: level })
      .eq("project_id", projectId)
      .is("org_level", null)
      .select("id");
    if (error) return { ok: false, error: error.message };
    touched = Math.max(touched, (data ?? []).length);
  }
  revalidatePath(`/project/${projectId}/sources`);
  revalidatePath(`/project/${projectId}/catalog`);
  return { ok: true, error: null, notice: t("metaBulkSaved", { n: touched }) };
}

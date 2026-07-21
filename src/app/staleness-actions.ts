"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { InputItemRow, StaleKind } from "@/lib/db/types";
import type { FormState } from "./actions";

// ─────────────────────────────────────────────────────────────
// Csomag A (A8) — verzió/elavulás akciók:
//   newSourceVersionAction — forrás-frissítés ÚJ sorként ugyanabban a
//     verzió-csoportban (version+1); a régi verzió megmarad, a kanonikus
//     [n] számozás nem mozdul (lib/sources csoport-alapú).
//   ackStalenessAction — az „Ellenőrizve" nyugta: CSAK a feloldás tárolódik
//     (stale_acks); a jelölők maguk deriváltak (lib/staleness).
// ─────────────────────────────────────────────────────────────

const STALE_KINDS: readonly StaleKind[] = ["source_updated", "origin_drift", "doc_stale"];

interface SupabaseErrorLike {
  message?: string;
}

function errMessage(error: SupabaseErrorLike | null): string {
  return error?.message ?? "?";
}

export async function newSourceVersionAction(
  projectId: string,
  groupId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const rawText = String(formData.get("rawText") ?? "").trim();
  const nonce = Date.now();
  if (!rawText) {
    return { ok: false, error: tErrors("emptyInput"), nonce };
  }

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("input_items")
    .select("*")
    .eq("project_id", projectId)
    .eq("group_id", groupId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    return {
      ok: false,
      error: tErrors("inputsFetchFailed") + (error ? `: ${errMessage(error)}` : ""),
      nonce,
    };
  }
  const latest = data as InputItemRow;

  // Új sor ugyanabban a csoportban — cím/fázis öröklődik, a tartalom új.
  // Az uq (group_id, version) index véd a párhuzamos beszúrás ellen.
  const { error: insErr } = await supabase.from("input_items").insert({
    project_id: projectId,
    type: latest.type,
    raw_text: rawText,
    phase: latest.phase,
    group_id: groupId,
    version: (latest.version ?? 1) + 1,
  });
  if (insErr) {
    return {
      ok: false,
      error: tErrors("inputSaveFailed") + `: ${errMessage(insErr)}`,
      values: { rawText },
      nonce,
    };
  }

  await supabase.from("decisions").insert({
    project_id: projectId,
    kind: "new_source_version",
    note: `Forrás-frissítés: „${latest.type}" v${(latest.version ?? 1) + 1} (${rawText.length} karakter) — a korábbi verzió megmarad.`,
  });
  revalidatePath(`/project/${projectId}`, "layout");
  return { ok: true, error: null, nonce };
}

export async function ackStalenessAction(
  projectId: string,
  subjectType: string,
  subjectId: string,
  kind: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  if (!(STALE_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: tErrors("config", { message: kind }) };
  }

  const supabase = createServiceSupabaseClient();
  const now = new Date().toISOString();

  // Kézi upsert (select → update/insert): a lokális verifikációs shim nem
  // ismeri a PostgREST on_conflict-upsertet; az uq(subject_type,subject_id,
  // kind) index a versenyt így is lezárja.
  const { data: existing } = await supabase
    .from("stale_acks")
    .select("id")
    .eq("subject_type", subjectType)
    .eq("subject_id", subjectId)
    .eq("kind", kind)
    .maybeSingle();
  if (existing) {
    const { error } = await supabase
      .from("stale_acks")
      .update({ acked_at: now })
      .eq("id", (existing as { id: string }).id);
    if (error) return { ok: false, error: tErrors("statusChangeFailed", { message: errMessage(error) }) };
  } else {
    const { error } = await supabase.from("stale_acks").insert({
      project_id: projectId,
      subject_type: subjectType,
      subject_id: subjectId,
      kind,
      acked_at: now,
    });
    if (error) return { ok: false, error: tErrors("statusChangeFailed", { message: errMessage(error) }) };
  }

  revalidatePath(`/project/${projectId}`, "layout");
  return { ok: true, error: null };
}

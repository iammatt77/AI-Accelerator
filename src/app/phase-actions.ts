"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { isPhaseId, hasGate, isManualClose } from "@/lib/phases/config";
import { parsePhaseState } from "@/lib/phases/machine";
import type { FormState } from "./actions";

// ─────────────────────────────────────────────────────────────
// Fázis-átmeneti server actionök. A kliens állapotot NEM diktál:
// minden átmenetet itt (és a close_gate() DB-függvényben) validálunk.
// Hibák: graceful FormState (repo-konvenció), nem throw.
// ─────────────────────────────────────────────────────────────

function revalidateProject(projectId: string): void {
  revalidatePath(`/project/${projectId}`);
  revalidatePath(`/project/${projectId}/phase`, "layout");
  revalidatePath("/");
}

// „Fázis indítása": open → in_progress
export async function startPhase(
  projectId: string,
  phase: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  if (!isPhaseId(phase)) {
    return { ok: false, error: tErrors("invalidTransition") };
  }

  let supabase;
  try {
    supabase = createServiceSupabaseClient();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`Supabase kliens hiba: ${message}`);
    return { ok: false, error: tErrors("config", { message }) };
  }

  // Optimista guard az SQL-ben: csak 'open' állapotból vált — ha közben
  // más állapotba került, 0 sor frissül → érvénytelen átmenet.
  const { data, error } = await supabase
    .from("phase_instances")
    .update({ state: "in_progress" })
    .eq("project_id", projectId)
    .eq("phase", phase)
    .eq("state", "open")
    .select("id");
  if (error) {
    console.error(`Fázis indítása sikertelen: ${error.message}`);
    return {
      ok: false,
      error: tErrors("phaseActionFailed", { message: error.message }),
    };
  }
  if ((data ?? []).length === 0) {
    return { ok: false, error: tErrors("invalidTransition") };
  }

  revalidateProject(projectId);
  return { ok: true, error: null };
}

// „Kapu lezárása": in_progress | gate_pending → completed, TRANZAKCIONÁLISAN
// a close_gate() DB-függvényen át (P(n) zárás + P(n+1) nyitás + Decision
// egy tranzakcióban). Indoklás kötelező; ideiglenes-kézi fázisnál note-prefix.
export async function closeGate(
  projectId: string,
  phase: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!isPhaseId(phase)) {
    return { ok: false, error: tErrors("invalidTransition") };
  }
  if (!hasGate(phase)) {
    return { ok: false, error: tErrors("noGateForPhase", { phase }) };
  }
  if (!reason) {
    return { ok: false, error: tErrors("noteRequired") };
  }

  let supabase;
  try {
    supabase = createServiceSupabaseClient();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`Supabase kliens hiba: ${message}`);
    return { ok: false, error: tErrors("config", { message }) };
  }

  // TS-oldali elővalidálás (barátságos hiba, mielőtt a DB-hez nyúlnánk).
  const { data: row } = await supabase
    .from("phase_instances")
    .select("state")
    .eq("project_id", projectId)
    .eq("phase", phase)
    .maybeSingle();
  const state = parsePhaseState(row?.state);
  if (state !== "in_progress" && state !== "gate_pending") {
    return { ok: false, error: tErrors("invalidTransition") };
  }

  // Decision note: fázis-azonosítóval kezdődik (a fázis-oldali történet
  // szűréséhez), ideiglenes kézi zárásnál a spec szerinti prefixszel.
  const prefix = isManualClose(phase) ? "[ideiglenes kézi lezárás] " : "";
  const note = `${prefix}${phase} — ${reason}`;

  const { error } = await supabase.rpc("close_gate", {
    p_project_id: projectId,
    p_phase: phase,
    p_note: note,
  });
  if (error) {
    // A DB-függvény kivételei ismert, lefordítható hibák.
    if (error.message.includes("invalid_transition")) {
      return { ok: false, error: tErrors("invalidTransition") };
    }
    if (error.message.includes("note_required")) {
      return { ok: false, error: tErrors("noteRequired") };
    }
    console.error(`Kapu-zárás sikertelen: ${error.message}`);
    return {
      ok: false,
      error: tErrors("phaseActionFailed", { message: error.message }),
    };
  }

  revalidateProject(projectId);
  return { ok: true, error: null };
}

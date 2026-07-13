"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { isPhaseId, hasGate, isManualClose } from "@/lib/phases/config";
import { parsePhaseState } from "@/lib/phases/machine";
import { evaluatePhaseCriteria } from "@/lib/phases/service";
import { criterionLabel } from "@/lib/phases/criterion-label";
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
  // Hibaágon a beírt indoklás visszakerül a mezőbe (values + nonce —
  // React 19 hibaágon is reseteli a nem kontrollált mezőket).
  const nonce = Date.now();
  const fail = (error: string): FormState => ({
    ok: false,
    error,
    values: { reason },
    nonce,
  });

  if (!isPhaseId(phase)) {
    return fail(tErrors("invalidTransition"));
  }
  if (!hasGate(phase)) {
    return fail(tErrors("noGateForPhase", { phase }));
  }
  if (!reason) {
    return fail(tErrors("noteRequired"));
  }

  let supabase;
  try {
    supabase = createServiceSupabaseClient();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`Supabase kliens hiba: ${message}`);
    return fail(tErrors("config", { message }));
  }

  // TS-oldali elővalidálás (barátságos hiba, mielőtt a DB-hez nyúlnánk).
  // Olvasási hiba ≠ érvénytelen átmenet: azt a valódi okkal jelentjük.
  const { data: row, error: readError } = await supabase
    .from("phase_instances")
    .select("state")
    .eq("project_id", projectId)
    .eq("phase", phase)
    .maybeSingle();
  if (readError) {
    console.error(`Fázis-állapot olvasása sikertelen: ${readError.message}`);
    return fail(tErrors("phaseActionFailed", { message: readError.message }));
  }
  const state = parsePhaseState(row?.state);
  if (state !== "in_progress" && state !== "gate_pending") {
    return fail(tErrors("invalidTransition"));
  }

  // APP-SZINTŰ KAPU-ŐR (#6): a zárás elutasítva, amíg bármely KEMÉNY
  // kritérium nem teljesül — a hiányzó deliverable-ök lokalizált nevével.
  // Rétegzés: a close_gate() DB-fn az állapot-átmenet tranzakcionális őre
  // (érintetlen); a kritérium-őr itt, app-szinten él.
  const { criteria, degraded } = await evaluatePhaseCriteria(
    supabase,
    projectId,
    phase,
  );
  const unmetHard = criteria.filter((c) => c.weight === "hard" && !c.satisfied);
  if (degraded && unmetHard.length > 0) {
    // Kiértékelési hiba: nem tudjuk bizonyítani a teljesülést → fail-safe,
    // lokalizált okkal (nem nyers tokennel).
    return fail(tErrors("criteriaEvaluationFailed"));
  }
  if (unmetHard.length > 0) {
    const [tCriteria, tTypes] = await Promise.all([
      getTranslations("criteria"),
      getTranslations("artifactTypes"),
    ]);
    const names = unmetHard
      .map((criterion) => criterionLabel(criterion, tCriteria, tTypes))
      .join(", ");
    return fail(tErrors("gateBlocked", { criteria: names }));
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
      return fail(tErrors("invalidTransition"));
    }
    if (error.message.includes("note_required")) {
      return fail(tErrors("noteRequired"));
    }
    console.error(`Kapu-zárás sikertelen: ${error.message}`);
    return fail(tErrors("phaseActionFailed", { message: error.message }));
  }

  revalidateProject(projectId);
  return { ok: true, error: null };
}

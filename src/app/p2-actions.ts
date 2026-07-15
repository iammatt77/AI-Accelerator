"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { suggestBenefitInputs, suggestPilotDefinition } from "@/lib/llm";
import { loadNumberedSources } from "@/lib/sources";
import {
  getTypeDef,
  parseArtifactFields,
  type ArtifactFields,
} from "@/lib/artifacts/config";
import {
  benefitFilled,
  benefitSummary,
  parseBenefitCalc,
  parsePilotSuccess,
  pilotFieldSync,
  pilotFilled,
  type BenefitCalc,
  type PilotSuccess,
} from "@/lib/artifacts/p2";
import type { ArtifactRow } from "@/lib/db/types";
import type { FormState } from "./actions";

// ─────────────────────────────────────────────────────────────
// P2-mélység akciók (Coding-csomag #9): a Business case haszon-kalkulátor
// és a Pilot-terv sikerdefiníció strukturált mezői. Az E1-lánc a #5a/#7a/#8
// mintáján: az AI a BEMENETEKRE javasol (c-minta), az ember erősíti meg / tölti.
//
// KULCS-SZABÁLYOK:
//  - A „fék" (realizálható %) és a scale/pivot/stop döntési szabály KIZÁRÓLAG
//    emberi — a suggest-akciók sosem írják.
//  - A strukturált adat a benefit_calc / pilot_success jsonb-ben él; a meglévő
//    teljesség/approve/gate a fields-jsonb value-szinkronon át lát „kitöltöttséget".
//  - Csak draft artefaktumon írható (a státuszlánc változatlan).
// ─────────────────────────────────────────────────────────────

interface SupabaseErrorLike {
  message?: string;
}
function errMessage(e: SupabaseErrorLike | null): string {
  return e?.message ?? "?";
}
function revalidateWorkspace(projectId: string): void {
  revalidatePath(`/project/${projectId}`, "layout");
}

/** Űrlap-szám: "168" / "6 500" → szám; üres → null; nem-pozitív/rossz → null. */
function parseNum(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim().replace(/\s/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function parseText(raw: FormDataEntryValue | null): string | null {
  const s = String(raw ?? "").trim();
  return s === "" ? null : s;
}

/** Draft artefaktum betöltése + őr (project, draft, típus). */
async function loadDraftArtifact(
  projectId: string,
  artifactId: string,
  expectType: string,
): Promise<{ artifact: ArtifactRow } | { error: string }> {
  const tErrors = await getTranslations("errors");
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("artifacts")
    .select("*")
    .eq("id", artifactId)
    .maybeSingle();
  if (error || !data) {
    return { error: tErrors("artifactFetchFailed", { message: errMessage(error) }) };
  }
  const artifact = data as ArtifactRow;
  if (artifact.project_id !== projectId) {
    return { error: tErrors("artifactFetchFailed", { message: "project" }) };
  }
  if (artifact.status !== "draft") {
    return { error: tErrors("artifactNotDraft") };
  }
  if (artifact.type !== expectType) {
    return { error: tErrors("typeNotFound", { type: artifact.type }) };
  }
  return { artifact };
}

/** A fields-jsonb egy mezőjének szinkronizálása (érték + állapot). Üres érték
 *  → missing (a mező nem számít kitöltöttnek). */
function syncField(
  fields: ArtifactFields,
  key: string,
  value: string,
  confirmed: boolean,
): void {
  if (value.trim() === "") {
    fields[key] = { value: null, source_indices: [], state: "missing" };
  } else {
    fields[key] = {
      value,
      source_indices: fields[key]?.source_indices ?? [],
      state: confirmed ? "confirmed" : "manual",
    };
  }
}

// ── Business case: haszon-kalkulátor ─────────────────────────

export async function suggestBenefitInputsAction(
  projectId: string,
  artifactId: string,
  _prev: FormState,
  _fd: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const loaded = await loadDraftArtifact(projectId, artifactId, "Business case");
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const supabase = createServiceSupabaseClient();

  const src = await loadNumberedSources(supabase, projectId);
  if ("error" in src) {
    return { ok: false, error: tErrors("inputsFetchFailed") + `: ${src.error}` };
  }

  let suggestion;
  try {
    suggestion = await suggestBenefitInputs(src.sources);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: tErrors("extractFailed", { message }) };
  }

  const prev = parseBenefitCalc(loaded.artifact.benefit_calc);
  const noBasis =
    suggestion.felszabadult_kapacitas_ora_ho === null && suggestion.oradij_ft === null;
  // A javaslat a bemeneteket tölti; a féket SOHA nem érinti (megőrizzük).
  const next: BenefitCalc = {
    ...prev,
    felszabadult_kapacitas_ora_ho: suggestion.felszabadult_kapacitas_ora_ho,
    oradij_ft: suggestion.oradij_ft,
    source_indices: suggestion.source_indices,
    state: noBasis ? prev.state : "ai_suggested",
  };
  const { error } = await supabase
    .from("artifacts")
    .update({ benefit_calc: next, updated_at: new Date().toISOString() })
    .eq("id", artifactId)
    .eq("status", "draft")
    .select("id");
  if (error) {
    return { ok: false, error: tErrors("artifactSaveFailed", { message: errMessage(error) }) };
  }
  revalidateWorkspace(projectId);
  if (noBasis) {
    return { ok: true, error: null, notice: tErrors("benefitNoBasis") };
  }
  return { ok: true, error: null };
}

export async function saveBenefitAction(
  projectId: string,
  artifactId: string,
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const loaded = await loadDraftArtifact(projectId, artifactId, "Business case");
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const supabase = createServiceSupabaseClient();

  const prev = parseBenefitCalc(loaded.artifact.benefit_calc);
  const next: BenefitCalc = {
    state: prev.state,
    felszabadult_kapacitas_ora_ho: parseNum(fd.get("kapacitas")),
    oradij_ft: parseNum(fd.get("oradij")),
    realizalhato_szazalek: parseNum(fd.get("fek")), // a fék — emberi
    bevezetes_koltseg_ft: parseNum(fd.get("bevezetes")),
    uzemeltetes_koltseg_ft_ho: parseNum(fd.get("uzemeltetes")),
    source_indices: prev.source_indices,
  };
  // Mentés = emberi aktus → confirmed, ha a lánc számolható; egyébként manual
  // (részleges — a levezetett értékek zárolva a fékig).
  next.state = benefitFilled(next) ? "confirmed" : "manual";

  const typeDef = getTypeDef(loaded.artifact.type);
  const fields = typeDef ? parseArtifactFields(typeDef, loaded.artifact.fields) : ({} as ArtifactFields);
  // A meglévő teljesség/approve a fields-value-n át lát: kitöltött CSAK a
  // számolható (fékkel rögzített) lánc.
  syncField(fields, "haszon_szamitas", benefitFilled(next) ? benefitSummary(next) : "", true);

  const { error } = await supabase
    .from("artifacts")
    .update({ benefit_calc: next, fields, updated_at: new Date().toISOString() })
    .eq("id", artifactId)
    .eq("status", "draft")
    .select("id");
  if (error) {
    return { ok: false, error: tErrors("artifactSaveFailed", { message: errMessage(error) }) };
  }
  revalidateWorkspace(projectId);
  return { ok: true, error: null, nonce: Date.now() };
}

// ── Pilot-terv: sikerdefiníció ───────────────────────────────

export async function suggestPilotDefinitionAction(
  projectId: string,
  artifactId: string,
  _prev: FormState,
  _fd: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const loaded = await loadDraftArtifact(projectId, artifactId, "Pilot-terv");
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const supabase = createServiceSupabaseClient();

  const src = await loadNumberedSources(supabase, projectId);
  if ("error" in src) {
    return { ok: false, error: tErrors("inputsFetchFailed") + `: ${src.error}` };
  }

  let suggestion;
  try {
    suggestion = await suggestPilotDefinition(src.sources);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: tErrors("extractFailed", { message }) };
  }

  const prev = parsePilotSuccess(loaded.artifact.pilot_success);
  const noBasis =
    suggestion.baseline_ertek === null && suggestion.kuszob_ertek === null;
  // A javaslat a mérhető részt tölti; a döntési szabályt (scale/pivot/stop)
  // SOHA nem érinti (megőrizzük).
  const next: PilotSuccess = {
    ...prev,
    meresi_metrika: suggestion.meresi_metrika ?? prev.meresi_metrika,
    baseline_ertek: suggestion.baseline_ertek,
    baseline_egyseg: suggestion.baseline_egyseg,
    kuszob_ertek: suggestion.kuszob_ertek,
    kuszob_egyseg: suggestion.kuszob_egyseg,
    source_indices: suggestion.source_indices,
    state: noBasis ? prev.state : "ai_suggested",
  };

  // A hipotézis-javaslat a MEGLÉVŐ szöveges mezőbe kerül (ai_filled).
  const typeDef = getTypeDef(loaded.artifact.type);
  const fields = typeDef ? parseArtifactFields(typeDef, loaded.artifact.fields) : ({} as ArtifactFields);
  if (suggestion.hipotezis && !fields.hipotezis?.value) {
    fields.hipotezis = {
      value: suggestion.hipotezis,
      source_indices: suggestion.source_indices,
      state: "ai_filled",
    };
  }

  const { error } = await supabase
    .from("artifacts")
    .update({ pilot_success: next, fields, updated_at: new Date().toISOString() })
    .eq("id", artifactId)
    .eq("status", "draft")
    .select("id");
  if (error) {
    return { ok: false, error: tErrors("artifactSaveFailed", { message: errMessage(error) }) };
  }
  revalidateWorkspace(projectId);
  if (noBasis) {
    return { ok: true, error: null, notice: tErrors("pilotNoBasis") };
  }
  return { ok: true, error: null };
}

export async function savePilotDefinitionAction(
  projectId: string,
  artifactId: string,
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const loaded = await loadDraftArtifact(projectId, artifactId, "Pilot-terv");
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const supabase = createServiceSupabaseClient();

  const prev = parsePilotSuccess(loaded.artifact.pilot_success);
  const next: PilotSuccess = {
    state: prev.state,
    meresi_metrika: parseText(fd.get("metrika")),
    baseline_ertek: parseNum(fd.get("baseline_ertek")),
    baseline_egyseg: parseText(fd.get("baseline_egyseg")),
    kuszob_ertek: parseNum(fd.get("kuszob_ertek")),
    kuszob_egyseg: parseText(fd.get("kuszob_egyseg")),
    dontesi_szabaly: {
      scale_feltetel: parseText(fd.get("scale_feltetel")),
      pivot_feltetel: parseText(fd.get("pivot_feltetel")),
      stop_feltetel: parseText(fd.get("stop_feltetel")),
    },
    source_indices: prev.source_indices,
  };
  next.state = pilotFilled(next) ? "confirmed" : "manual";

  // A három meglévő kötelező mező (baseline / szamszeru_kuszob /
  // dontesi_szabaly) value-szinkronja — a teljesség/approve ezen át lát.
  const typeDef = getTypeDef(loaded.artifact.type);
  const fields = typeDef ? parseArtifactFields(typeDef, loaded.artifact.fields) : ({} as ArtifactFields);
  const sync = pilotFieldSync(next);
  syncField(fields, "baseline", sync.baseline, true);
  syncField(fields, "szamszeru_kuszob", sync.szamszeru_kuszob, true);
  syncField(fields, "dontesi_szabaly", sync.dontesi_szabaly, true);

  const { error } = await supabase
    .from("artifacts")
    .update({ pilot_success: next, fields, updated_at: new Date().toISOString() })
    .eq("id", artifactId)
    .eq("status", "draft")
    .select("id");
  if (error) {
    return { ok: false, error: tErrors("artifactSaveFailed", { message: errMessage(error) }) };
  }
  revalidateWorkspace(projectId);
  return { ok: true, error: null, nonce: Date.now() };
}

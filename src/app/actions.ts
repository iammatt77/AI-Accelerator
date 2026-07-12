"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { generateDraft } from "@/lib/llm";
import type { ArtifactRow, InputItemRow } from "@/lib/db/types";

// A draft artefaktumok típusa a foundation vertikumban (P0 összefoglaló).
const ARTIFACT_TYPE = "p0_summary";

// Űrlap-action visszatérési állapot (useActionState-hez). A hiba a felületen
// LÁTHATÓ lesz, nem némán 500-zik.
export type FormState = { ok: boolean; error: string | null };

interface SupabaseErrorLike {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

/**
 * A Supabase/PostgREST hiba minden diagnosztikus mezőjét egy olvasható
 * üzenetbe fűzi (message + code + details + hint). Így a felületen és a
 * szerver-logban is látszik a valódi ok — pl. hiányzó tábla (PGRST205),
 * ismeretlen oszlop (42703), FK-sértés (23503), RLS-tiltás (42501).
 */
function formatSupabaseError(prefix: string, error: SupabaseErrorLike | null): string {
  if (!error) return `${prefix}: ismeretlen hiba.`;
  const parts = [error.message ?? "ismeretlen hiba"];
  if (error.code) parts.push(`[${error.code}]`);
  if (error.details) parts.push(`— ${error.details}`);
  if (error.hint) parts.push(`(hint: ${error.hint})`);
  const msg = `${prefix}: ${parts.join(" ")}`;
  // Szerver-log: a teljes üzenet a terminálban is megjelenik.
  console.error(msg);
  return msg;
}

// ── (a) Kliens + projekt létrehozása ─────────────────────────
export async function createClientAndProject(formData: FormData): Promise<void> {
  const clientName = String(formData.get("clientName") ?? "").trim();
  const industry = String(formData.get("industry") ?? "").trim();
  const projectName = String(formData.get("projectName") ?? "").trim();
  const packageName = String(formData.get("package") ?? "").trim();

  const tErrors = await getTranslations("errors");
  if (!clientName || !projectName) {
    throw new Error(tErrors("requiredClientAndProject"));
  }

  const supabase = createServiceSupabaseClient();

  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .insert({ name: clientName, industry: industry || null })
    .select()
    .single();
  if (clientErr || !client) {
    throw new Error(
      tErrors("clientCreateFailed", { message: clientErr?.message ?? "?" }),
    );
  }

  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .insert({
      client_id: client.id,
      name: projectName,
      package: packageName || null,
      status: "active",
    })
    .select()
    .single();
  if (projectErr || !project) {
    throw new Error(
      tErrors("projectCreateFailed", { message: projectErr?.message ?? "?" }),
    );
  }

  // P0 fázis-rekord (most csak ez az egy kell).
  await supabase.from("phase_instances").insert({
    project_id: project.id,
    phase: "P0",
    state: "in_progress",
  });

  await logDecision(project.id, "create_project", `Projekt létrehozva: ${projectName}`);

  revalidatePath("/");
  redirect(`/project/${project.id}`);
}

// ── (b) Nyers szöveg beillesztése → input_items ──────────────
// useActionState-kompatibilis: (projectId, prevState, formData) → FormState.
// NEM dob kivételt — a hibát visszaadja, hogy a felületen LÁTHATÓ legyen.
export async function addInput(
  projectId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  const rawText = String(formData.get("rawText") ?? "").trim();
  if (!rawText) {
    return { ok: false, error: tErrors("emptyInput") };
  }

  let supabase;
  try {
    supabase = createServiceSupabaseClient();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`Supabase kliens hiba: ${message}`);
    return { ok: false, error: tErrors("config", { message }) };
  }

  const { error } = await supabase.from("input_items").insert({
    project_id: projectId,
    type: "raw",
    raw_text: rawText,
  });
  if (error) {
    return {
      ok: false,
      error: formatSupabaseError(tErrors("inputSaveFailed"), error),
    };
  }

  await logDecision(projectId, "add_input", `Nyers bemenet hozzáadva (${rawText.length} karakter).`);
  revalidatePath(`/project/${projectId}`);
  return { ok: true, error: null };
}

// ── (c) "Draft generálása" → adapter.generateDraft → mentés ──
// A kétlépéses flow (bemenet → külön "Draft generálása") szándékos (v0.2 §8).
// useActionState-kompatibilis: (projectId, prevState, formData) → FormState.
// NEM dob kivételt — a hibát visszaadja, hogy a felületen LÁTHATÓ legyen.
export async function generateDraftAction(
  projectId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const tErrors = await getTranslations("errors");
  let supabase;
  try {
    supabase = createServiceSupabaseClient();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`Supabase kliens hiba: ${message}`);
    return { ok: false, error: tErrors("config", { message }) };
  }

  const { data: inputs, error: inputErr } = await supabase
    .from("input_items")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (inputErr) {
    return {
      ok: false,
      error: formatSupabaseError(tErrors("inputsFetchFailed"), inputErr),
    };
  }
  const inputRows = (inputs ?? []) as InputItemRow[];
  if (inputRows.length === 0) {
    return { ok: false, error: tErrors("noInputForDraft") };
  }

  const rawMaterial = inputRows.map((row) => row.raw_text).join("\n\n---\n\n");
  const sourceInputIds = inputRows.map((row) => row.id);

  // ÉLŐ Anthropic-hívás az adapteren át. A hívó nem tud az Anthropicről.
  let body: string;
  try {
    ({ body } = await generateDraft({
      phase: "P0",
      rawMaterial,
      templateKey: "p0_summary",
    }));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`Draft generálás sikertelen: ${message}`);
    return { ok: false, error: tErrors("generateFailed", { message }) };
  }

  const nextVersion = await nextArtifactVersion(supabase, projectId);

  const { error: insertErr } = await supabase.from("artifacts").insert({
    project_id: projectId,
    type: ARTIFACT_TYPE,
    version: nextVersion,
    status: "draft",
    body,
    source_input_ids: sourceInputIds,
  });
  if (insertErr) {
    return {
      ok: false,
      error: formatSupabaseError(tErrors("draftSaveFailed"), insertErr),
    };
  }

  await logDecision(projectId, "generate_draft", `Draft generálva (v${nextVersion}, ${sourceInputIds.length} forrás).`);
  revalidatePath(`/project/${projectId}`);
  return { ok: true, error: null };
}

// ── (d) Draft body szerkesztése (helyben mentés, verzió nem nő) ─
export async function saveDraftBody(
  projectId: string,
  artifactId: string,
  formData: FormData,
): Promise<void> {
  const body = String(formData.get("body") ?? "");

  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("artifacts")
    .update({ body })
    .eq("id", artifactId)
    .eq("status", "draft"); // csak draft szerkeszthető helyben
  if (error) {
    const tErrors = await getTranslations("errors");
    throw new Error(
      `${tErrors("draftSaveFailed")}: ${error.message}`,
    );
  }

  await logDecision(projectId, "edit_draft", `Draft szerkesztve (${artifactId}).`);
  revalidatePath(`/project/${projectId}`);
}

// ── (e) Draft → Approved: version+1, a régi megmarad ─────────
export async function approveArtifact(
  projectId: string,
  artifactId: string,
  formData: FormData,
): Promise<void> {
  const supabase = createServiceSupabaseClient();

  const { data: current, error: fetchErr } = await supabase
    .from("artifacts")
    .select("*")
    .eq("id", artifactId)
    .single();
  if (fetchErr || !current) {
    const tErrors = await getTranslations("errors");
    throw new Error(
      tErrors("artifactFetchFailed", { message: fetchErr?.message ?? "?" }),
    );
  }
  const artifact = current as ArtifactRow;

  // A form tartalmazhatja a legfrissebb (szerkesztett) body-t.
  const body = String(formData.get("body") ?? artifact.body);
  const nextVersion = await nextArtifactVersion(supabase, projectId);

  // ÚJ, approved rekord version+1-gyel — a régi draft megmarad (audit).
  const { error: insertErr } = await supabase.from("artifacts").insert({
    project_id: projectId,
    type: artifact.type,
    version: nextVersion,
    status: "approved",
    body,
    source_input_ids: artifact.source_input_ids,
  });
  if (insertErr) {
    const tErrors = await getTranslations("errors");
    throw new Error(
      tErrors("approvedSaveFailed", { message: insertErr.message }),
    );
  }

  await logDecision(
    projectId,
    "approve_artifact",
    `Draft (v${artifact.version}) jóváhagyva → approved (v${nextVersion}).`,
  );
  revalidatePath(`/project/${projectId}`);
}

// ── segédfüggvények ──────────────────────────────────────────

/** A projekt következő artefaktum-verziószáma (globálisan növekvő). */
async function nextArtifactVersion(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  projectId: string,
): Promise<number> {
  const { data } = await supabase
    .from("artifacts")
    .select("version")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const current = (data as { version?: number } | null)?.version ?? 0;
  return current + 1;
}

/** Döntés/esemény naplózása az audit trailbe. */
async function logDecision(projectId: string, kind: string, note: string): Promise<void> {
  const supabase = createServiceSupabaseClient();
  await supabase.from("decisions").insert({ project_id: projectId, kind, note });
}

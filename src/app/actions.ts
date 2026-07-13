"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

// Űrlap-action visszatérési állapot (useActionState-hez). A hiba a felületen
// LÁTHATÓ lesz, nem némán 500-zik. A `values` a beküldött mezőértékeket adja
// vissza hiba esetén (React 19 hibaágon is reseteli a nem kontrollált
// mezőket — így nem veszik el a beillesztett szöveg); a `nonce` a mező
// remountolásához kell (key).
export type FormState = {
  ok: boolean;
  error: string | null;
  /** Nem-hiba, de LÁTHATÓ jelzés (amber): pl. „a feldolgozás sikeres volt,
   *  de nem adott használható eredményt" — ne nézzen ki néma üres sikernek. */
  notice?: string | null;
  values?: {
    rawText?: string;
    reason?: string;
    title?: string;
    fieldValue?: string;
    body?: string;
  };
  nonce?: number;
};

/* A #1-es generálási vertikum akciói (addInput, generateDraftAction,
   saveDraftBody, approveArtifact) a #5a-ban KIVEZETVE — utódaik:
   artifact-actions.ts (① bemenet fázis-címkével · ② kivonatolás +
   mező-megerősítés · ③ generálás) és a szerkesztő/státuszlánc akciók. */

// ── Kliens + projekt létrehozása ─────────────────────────────
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

  // Mind a 7 fázis-sor létrejön: P0 nyitott (indítható), P1–P6 zárt —
  // az állapotgép (v0.2 §11 / #4) szerint.
  const { error: phaseErr } = await supabase.from("phase_instances").insert(
    ["P0", "P1", "P2", "P3", "P4", "P5", "P6"].map((phase) => ({
      project_id: project.id,
      phase,
      state: phase === "P0" ? "open" : "locked",
    })),
  );
  if (phaseErr) {
    throw new Error(tErrors("phaseActionFailed", { message: phaseErr.message }));
  }

  await logDecision(project.id, "create_project", `Projekt létrehozva: ${projectName}`);

  revalidatePath("/");
  redirect(`/project/${project.id}`);
}

/** Döntés/esemény naplózása az audit trailbe. */
async function logDecision(projectId: string, kind: string, note: string): Promise<void> {
  const supabase = createServiceSupabaseClient();
  await supabase.from("decisions").insert({ project_id: projectId, kind, note });
}

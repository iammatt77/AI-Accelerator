"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type {
  KnowledgeCatalogRow,
  KnowledgeLabelSignalRow,
  Modality,
  SourceOrgLevel,
  StakeholderRow,
} from "@/lib/db/types";
import { anchorKey, type KnowledgeAnchor } from "@/lib/knowledge/anchor";
import {
  applyLabelCorrection,
  labelOneItem,
  type CorrectionPatch,
} from "@/lib/knowledge/labeling";
import type { FormState } from "./actions";

// ─────────────────────────────────────────────────────────────
// Katalógus-címkézés server actionök (Epic 4 · 4.2) — a labeling motor
// burkolói. A címkézendő elemek listája a knowledge_catalog nézet (a
// jóváhagyott cédulák); a cédula-szöveg = title + excerpt. A címkézés
// FOKOZATOS (NF2): a futtatás csak a még címkézetlen elemeket veszi.
// ─────────────────────────────────────────────────────────────

const MODALITIES: readonly Modality[] = [
  "historikus",
  "as_is",
  "normativ",
  "to_be",
  "ismeretlen",
];
const ORG_LEVELS: readonly SourceOrgLevel[] = ["hq", "helyi", "kulso", "ismeretlen"];

function cedulaText(row: KnowledgeCatalogRow): string {
  return [row.title, row.excerpt ?? ""].filter(Boolean).join(" — ");
}

function anchorOfCatalogRow(row: KnowledgeCatalogRow): KnowledgeAnchor {
  return {
    block_type: row.block_type,
    block_id: row.block_id,
    artifact_id: row.artifact_id,
    field_key: row.field_key,
  };
}

async function loadStakeholders(projectId: string) {
  const db = createServiceSupabaseClient();
  const { data } = await db
    .from("stakeholders")
    .select("*")
    .eq("project_id", projectId);
  return ((data ?? []) as StakeholderRow[]).map((s) => ({ id: s.id, name: s.name }));
}

/**
 * A projekt MÉG CÍMKÉZETLEN cédulái címkézése (4.2-a/b/c). A már címkézett
 * (signal-lal bíró) elemeket kihagyja — az újracímkézés elemenként, a
 * felületről történik. Visszaad: hány elem, ebből hány kétes, hány hiba.
 */
export async function labelCatalogAction(
  projectId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("catalog");
  const db = createServiceSupabaseClient();

  const [{ data: catData }, { data: sigData }] = await Promise.all([
    db.from("knowledge_catalog").select("*").eq("project_id", projectId),
    db.from("knowledge_label_signals").select("*").eq("project_id", projectId),
  ]);
  const rows = (catData ?? []) as KnowledgeCatalogRow[];
  const labeled = new Set(
    ((sigData ?? []) as KnowledgeLabelSignalRow[]).map((s) =>
      anchorKey({
        block_type: s.block_type,
        block_id: s.block_id,
        artifact_id: s.artifact_id,
        field_key: s.field_key,
      }),
    ),
  );
  const todo = rows.filter((r) => !labeled.has(anchorKey(anchorOfCatalogRow(r))));
  if (todo.length === 0) {
    return { ok: true, error: null, notice: t("runNothingToLabel") };
  }

  const stakeholders = await loadStakeholders(projectId);
  let done = 0;
  let doubtful = 0;
  let failed = 0;
  let embeddingFailed = 0;
  let firstError: string | null = null;
  for (const row of todo) {
    const res = await labelOneItem(
      db,
      projectId,
      anchorOfCatalogRow(row),
      cedulaText(row),
      stakeholders,
    );
    if (!res.ok) {
      failed++;
      if (!firstError) firstError = res.error;
      continue;
    }
    done++;
    if (res.data.doubtful) doubtful++;
    if (!res.data.embedding.ok) {
      embeddingFailed++;
      if (!firstError) firstError = res.data.embedding.error ?? null;
    }
  }

  revalidatePath(`/project/${projectId}/catalog`);
  if (failed > 0 || embeddingFailed > 0) {
    return {
      ok: false,
      error: t("runPartialError", {
        done,
        failed: failed + embeddingFailed,
        message: firstError ?? "?",
      }),
    };
  }
  return {
    ok: true,
    error: null,
    notice: t("runDone", { done, doubtful }),
  };
}

/** Egyetlen elem újracímkézése (a felület soráról). Az 'ember' eredetű
 *  dimenziókat a motor nem írja felül (F4). */
export async function relabelItemAction(
  projectId: string,
  anchor: KnowledgeAnchor,
  text: string,
): Promise<FormState> {
  const t = await getTranslations("catalog");
  const db = createServiceSupabaseClient();
  const stakeholders = await loadStakeholders(projectId);
  const res = await labelOneItem(db, projectId, anchor, text, stakeholders);
  revalidatePath(`/project/${projectId}/catalog`);
  if (!res.ok) return { ok: false, error: res.error };
  return {
    ok: true,
    error: null,
    notice: res.data.doubtful ? t("relabelDoneDoubtful") : t("relabelDone"),
  };
}

/** Kézi címke-mentés a szerkesztő-űrlapról (F4+F5). A form mezői a
 *  dimenziók; a napló-írás a motorban történik. */
export async function saveLabelsAction(
  projectId: string,
  anchor: KnowledgeAnchor,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("catalog");
  const db = createServiceSupabaseClient();

  const modality = String(formData.get("modality") ?? "");
  const validTime = String(formData.get("validTime") ?? "").trim();
  const scope = String(formData.get("scope") ?? "").trim();
  const orgLevel = String(formData.get("sourceOrgLevel") ?? "");
  const kind = String(formData.get("sourceKind") ?? "").trim();
  const personId = String(formData.get("sourcePersonStakeholderId") ?? "");
  const lang = String(formData.get("lang") ?? "").trim();

  if (!MODALITIES.includes(modality as Modality)) {
    return { ok: false, error: t("errInvalidModality") };
  }
  if (!ORG_LEVELS.includes(orgLevel as SourceOrgLevel)) {
    return { ok: false, error: t("errInvalidOrgLevel") };
  }

  let personName: string | null = null;
  if (personId) {
    const stakeholders = await loadStakeholders(projectId);
    personName = stakeholders.find((s) => s.id === personId)?.name ?? null;
  }

  const patch: CorrectionPatch = {
    modality: modality as Modality,
    validTime: validTime === "" ? null : validTime,
    scope: scope === "" ? null : scope,
    sourceOrgLevel: orgLevel as SourceOrgLevel,
    sourceKind: kind === "" ? null : kind,
    sourcePersonStakeholderId: personId === "" ? null : personId,
    sourcePersonName: personName,
    lang: lang === "" ? null : lang,
  };
  const res = await applyLabelCorrection(db, projectId, anchor, patch, {
    approveDoubtful: true,
  });
  revalidatePath(`/project/${projectId}/catalog`);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, error: null, notice: t("labelsSaved"), nonce: Date.now() };
}

/** Kétes elem(ek) jóváhagyása a gépi JELÖLTEKKEL, változtatás nélkül —
 *  a felülvizsgálati sor gyors útja (batch is). A napló old=new sorai a
 *  „túl óvatos volt" irányt mérik (F5). */
export async function approveDoubtfulAction(
  projectId: string,
  anchors: KnowledgeAnchor[],
): Promise<FormState> {
  const t = await getTranslations("catalog");
  const db = createServiceSupabaseClient();
  let approved = 0;
  let failed = 0;
  let firstError: string | null = null;
  for (const anchor of anchors) {
    const res = await applyLabelCorrection(db, projectId, anchor, {}, { approveDoubtful: true });
    if (res.ok) approved++;
    else {
      failed++;
      if (!firstError) firstError = res.error;
    }
  }
  revalidatePath(`/project/${projectId}/catalog`);
  if (failed > 0) {
    return {
      ok: false,
      error: t("approvePartialError", { approved, failed, message: firstError ?? "?" }),
    };
  }
  return { ok: true, error: null, notice: t("approveDone", { approved }) };
}

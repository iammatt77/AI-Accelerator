"use server";

import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type {
  FindingResolution,
  FindingType,
  KnowledgeFindingRow,
  KnowledgeMetadataRow,
  KnowledgeSupersessionRow,
} from "@/lib/db/types";
import type { KnowledgeAnchor } from "@/lib/knowledge/anchor";
import {
  checkSuppression,
  createFinding,
  createSupersession,
  deprecateElement,
  generateEmbedding,
  getMetadata,
  getSupersession,
  resolveFinding,
  setMetadata,
  similaritySearch,
  type MetadataInput,
  type Result,
  type ResolveOptions,
  type SimilarityHit,
  type SimilarityOptions,
  type SuppressionResult,
  type SupersessionView,
} from "@/lib/knowledge/store";

// ─────────────────────────────────────────────────────────────
// Tudáselem-server-actionök (Epic 4 · 4.1-d) — VÉKONY burkolók a
// lib/knowledge/store körül, service-role klienssel. A 4.2 (páronkénti
// felismerés) és a 4.4 (admin-felület) ezeket fogyasztja. NINCS UI ebben a
// csomagban; a mag (store) plain lib, hogy felület nélkül verifikálható
// legyen. A store maga végzi az érvényesítést (horgony, kötelező indoklás,
// állapotgép-ág) — a burkoló csak a klienst adja.
// ─────────────────────────────────────────────────────────────

export async function setKnowledgeMetadataAction(
  projectId: string,
  anchor: KnowledgeAnchor,
  input: MetadataInput,
): Promise<Result<KnowledgeMetadataRow>> {
  return setMetadata(createServiceSupabaseClient(), projectId, anchor, input);
}

export async function getKnowledgeMetadataAction(
  projectId: string,
  anchor: KnowledgeAnchor,
): Promise<Result<KnowledgeMetadataRow | null>> {
  return getMetadata(createServiceSupabaseClient(), projectId, anchor);
}

export async function deprecateKnowledgeElementAction(
  projectId: string,
  anchor: KnowledgeAnchor,
  reason: string,
): Promise<Result<KnowledgeMetadataRow>> {
  return deprecateElement(createServiceSupabaseClient(), projectId, anchor, reason);
}

export async function generateKnowledgeEmbeddingAction(
  projectId: string,
  anchor: KnowledgeAnchor,
  text: string,
): Promise<Result<{ model: string; modelVersion: string }>> {
  return generateEmbedding(createServiceSupabaseClient(), projectId, anchor, text);
}

export async function knowledgeSimilaritySearchAction(
  projectId: string,
  queryText: string,
  opts: SimilarityOptions = {},
): Promise<Result<SimilarityHit[]>> {
  return similaritySearch(createServiceSupabaseClient(), projectId, queryText, opts);
}

export async function createKnowledgeSupersessionAction(
  projectId: string,
  superseded: KnowledgeAnchor,
  superseding: KnowledgeAnchor,
  reason: string,
): Promise<Result<KnowledgeSupersessionRow>> {
  return createSupersession(createServiceSupabaseClient(), projectId, superseded, superseding, reason);
}

export async function getKnowledgeSupersessionAction(
  projectId: string,
  anchor: KnowledgeAnchor,
): Promise<Result<SupersessionView>> {
  return getSupersession(createServiceSupabaseClient(), projectId, anchor);
}

export async function createKnowledgeFindingAction(
  projectId: string,
  type: FindingType,
  a: KnowledgeAnchor,
  b: KnowledgeAnchor,
  evidence?: string | null,
): Promise<Result<KnowledgeFindingRow>> {
  return createFinding(createServiceSupabaseClient(), projectId, type, a, b, evidence);
}

export async function resolveKnowledgeFindingAction(
  projectId: string,
  findingId: string,
  resolution: FindingResolution,
  reason: string,
  opts: ResolveOptions = {},
): Promise<Result<{ finding: KnowledgeFindingRow; supersession?: KnowledgeSupersessionRow }>> {
  return resolveFinding(createServiceSupabaseClient(), projectId, findingId, resolution, reason, opts);
}

export async function checkKnowledgeSuppressionAction(
  projectId: string,
  type: FindingType,
  a: KnowledgeAnchor,
  b: KnowledgeAnchor,
  aFingerprint: string,
  bFingerprint: string,
): Promise<Result<SuppressionResult>> {
  return checkSuppression(
    createServiceSupabaseClient(),
    projectId,
    type,
    a,
    b,
    aFingerprint,
    bFingerprint,
  );
}

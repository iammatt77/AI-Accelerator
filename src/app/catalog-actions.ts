"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type {
  EvidenceKind,
  InputItemRow,
  KnowledgeCatalogRow,
  KnowledgeLabelSignalRow,
  Modality,
  SourceOrgLevel,
  StakeholderRow,
} from "@/lib/db/types";
import { isKnowledgeExemptField } from "@/lib/artifacts/config";
import { anchorKey, type KnowledgeAnchor } from "@/lib/knowledge/anchor";
import {
  applyLabelCorrection,
  labelOneItem,
  type CorrectionPatch,
  type SourceMeta,
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
const EVIDENCE_KINDS: readonly EvidenceKind[] = [
  "mert_adat",
  "megfigyeles",
  "velekedes",
  "hivatkozas",
  "ismeretlen",
];

function cedulaText(row: KnowledgeCatalogRow): string {
  return [row.title, row.excerpt ?? ""].filter(Boolean).join(" — ");
}

/** 4.2b (F3-b): szerkezet-mező cédulája-e a sor — ezek NEM tudáselemek, a
 *  címkéző köteg kihagyja őket (a 2.1 nézet érintetlen; a katalógus-oldal
 *  ugyanígy szűr). Az artifact-típust a hívó oldja fel (a nézet nem hordozza). */
function isExemptRow(row: KnowledgeCatalogRow, artifactTypeById: Map<string, string>): boolean {
  if (row.block_type !== "artifact_field" || !row.artifact_id || !row.field_key) return false;
  const type = artifactTypeById.get(row.artifact_id);
  return !!type && isKnowledgeExemptField(type, row.field_key);
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

/** Forrás-metaadat feloldása a cédulák source_input_ids[0]-jából (4.2b-c):
 *  a feltöltő által megadott {source_kind, org_level} a forrás-elemről.
 *  Egy kötegre EGY lekérdezés; a térkép kulcsa az input_items.id. Ha egy
 *  cédulának nincs forrás-hivatkozása, vagy a forráson nincs metaadat, a
 *  motor a mai szöveg-alapú útra esik vissza (látható bizonytalansággal). */
async function loadSourceMetaMap(
  projectId: string,
  rows: KnowledgeCatalogRow[],
): Promise<Map<string, SourceMeta>> {
  const ids = Array.from(
    new Set(rows.map((r) => r.source_input_ids?.[0]).filter((v): v is string => !!v)),
  );
  const map = new Map<string, SourceMeta>();
  if (ids.length === 0) return map;
  const db = createServiceSupabaseClient();
  const { data } = await db
    .from("input_items")
    .select("id,source_kind,org_level")
    .eq("project_id", projectId)
    .in("id", ids);
  for (const item of (data ?? []) as Pick<InputItemRow, "id" | "source_kind" | "org_level">[]) {
    map.set(item.id, { kind: item.source_kind, orgLevel: item.org_level });
  }
  return map;
}

function sourceMetaOf(
  row: KnowledgeCatalogRow | undefined,
  map: Map<string, SourceMeta>,
): SourceMeta | null {
  const firstId = row?.source_input_ids?.[0];
  return (firstId && map.get(firstId)) || null;
}

/** Egy köteg mérete — konzervatívan a serverless funkció-időkorlát alatt
 *  (elemenként 1-5 LLM-hívás + 1 embedding-hívás; a pontos korlát Vercel
 *  csomagtól függ, ezért env-ből hangolható, konzervatív alapértékkel). */
function labelBatchSize(): number {
  const n = parseInt(process.env.KNOWLEDGE_LABEL_BATCH_SIZE ?? "5", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 20) : 5;
}

export interface LabelBatchResult {
  /** Ebben a kötegben megkísérelt elemek száma. */
  processed: number;
  done: number;
  doubtful: number;
  failed: number;
  embeddingFailed: number;
  /** Még címkézetlen elemek e köteg UTÁN. */
  remaining: number;
  /** Még címkézetlen elemek e köteg ELŐTT (a teljes hátralévő munka). */
  totalTodo: number;
  firstError: string | null;
  /** Az e kötegben hibázott elemek horgonyai — a hívó a KÖVETKEZŐ hívásba
   *  skipAnchorKeys-ként adja vissza, hogy egy tartósan hibázó elem ne
   *  foglaljon le minden kötegből egy helyet (l. lent). */
  failedAnchors: KnowledgeAnchor[];
}

/**
 * A projekt MÉG CÍMKÉZETLEN cédulái közül EGY KÖTEGNYIT címkéz (4.2-a/b/c).
 * A köteg mérete a serverless funkció-időkorlát alatt marad (lásd
 * labelBatchSize). A felület kötegenként hívja, amíg `remaining` nullára
 * nem fogy — ez FOKOZATOS (NF2): minden hívás elölről lekérdezi a még
 * címkézetlen listát, így megszakadás (timeout, hálózati hiba, oldal-
 * bezárás) után a következő hívás onnan folytatja, ahol a legutóbbi
 * SIKERESEN elmentett elem volt.
 *
 * skipAnchorKeys: az EZEN A FUTTATÁSON belül már hibázott elemek horgony-
 * kulcsai. Egy hibázott elem NEM kap signal-sort, tehát enélkül a kizárás
 * nélkül minden következő hívás újra kiválasztaná — egyetlen tartósan
 * hibázó elem (pl. üres cédula-szöveg) így minden kötegből elvinne egy
 * helyet, feleslegesen sokszorozva a hiba-számot és az LLM-hívásokat. A
 * kizárás CSAK erre a futtatásra érvényes (memóriában, a kliensen) — egy
 * ÚJ "Címkézés futtatása" kattintás mindent újra megkísérel, esélyt adva a
 * tranziens hibáknak (pl. átmeneti LLM-hívási hiba) is.
 */
export async function labelCatalogBatchAction(
  projectId: string,
  skipAnchorKeys: string[] = [],
): Promise<LabelBatchResult> {
  const db = createServiceSupabaseClient();

  const [{ data: catData }, { data: sigData }, { data: artData }] = await Promise.all([
    db.from("knowledge_catalog").select("*").eq("project_id", projectId),
    db.from("knowledge_label_signals").select("*").eq("project_id", projectId),
    db.from("artifacts").select("id,type").eq("project_id", projectId),
  ]);
  const artifactTypeById = new Map(
    ((artData ?? []) as { id: string; type: string }[]).map((a) => [a.id, a.type]),
  );
  const rows = ((catData ?? []) as KnowledgeCatalogRow[]).filter(
    (r) => !isExemptRow(r, artifactTypeById),
  );
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
  const totalTodo = todo.length;
  const empty: LabelBatchResult = {
    processed: 0,
    done: 0,
    doubtful: 0,
    failed: 0,
    embeddingFailed: 0,
    remaining: totalTodo,
    totalTodo,
    firstError: null,
    failedAnchors: [],
  };
  if (totalTodo === 0) return empty;

  const skip = new Set(skipAnchorKeys);
  const selectable = todo.filter((r) => !skip.has(anchorKey(anchorOfCatalogRow(r))));
  // Minden hátralévő elem már hibázott ezen a futtatáson — nincs mit
  // megkísérelni; a hívó ezt a "processed: 0" jelzésből ismeri fel és
  // leállítja a ciklust (a hibaszám a felhalmozott failedSoFar-ban látszik).
  if (selectable.length === 0) return empty;

  const batch = selectable.slice(0, labelBatchSize());
  const [stakeholders, metaMap] = await Promise.all([
    loadStakeholders(projectId),
    loadSourceMetaMap(projectId, batch),
  ]);
  let done = 0;
  let doubtful = 0;
  let failed = 0;
  let embeddingFailed = 0;
  let firstError: string | null = null;
  const failedAnchors: KnowledgeAnchor[] = [];
  for (const row of batch) {
    const anchor = anchorOfCatalogRow(row);
    const res = await labelOneItem(
      db,
      projectId,
      anchor,
      cedulaText(row),
      stakeholders,
      sourceMetaOf(row, metaMap),
    );
    if (!res.ok) {
      failed++;
      failedAnchors.push(anchor);
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
  return {
    processed: batch.length,
    done,
    doubtful,
    failed,
    embeddingFailed,
    // A sikertelen elem (failed) NEM kap signal-sort, tehát a "todo"
    // önmagában nem fogy le miatta — csak a SIKERES (done) elemek
    // csökkentik a hátralévőt (a skip-lista tartja kordában a hibázottakat).
    remaining: totalTodo - done,
    totalTodo,
    firstError,
    failedAnchors,
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
  // A forrás-metaadat feloldásához a cédula katalógus-sora kell (a
  // source_input_ids a nézetből jön); a horgony-kulcs egyezéssel keresünk.
  const { data: catData } = await db
    .from("knowledge_catalog")
    .select("*")
    .eq("project_id", projectId)
    .eq("block_type", anchor.block_type);
  const wanted = anchorKey(anchor);
  const row = ((catData ?? []) as KnowledgeCatalogRow[]).find(
    (r) => anchorKey(anchorOfCatalogRow(r)) === wanted,
  );
  const metaMap = await loadSourceMetaMap(projectId, row ? [row] : []);
  const res = await labelOneItem(
    db,
    projectId,
    anchor,
    text,
    stakeholders,
    sourceMetaOf(row, metaMap),
  );
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
  const evidence = String(formData.get("evidenceKind") ?? "");

  if (!MODALITIES.includes(modality as Modality)) {
    return { ok: false, error: t("errInvalidModality") };
  }
  if (!ORG_LEVELS.includes(orgLevel as SourceOrgLevel)) {
    return { ok: false, error: t("errInvalidOrgLevel") };
  }
  if (!EVIDENCE_KINDS.includes(evidence as EvidenceKind)) {
    return { ok: false, error: t("errInvalidEvidence") };
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
    evidenceKind: evidence as EvidenceKind,
  };
  const res = await applyLabelCorrection(db, projectId, anchor, patch, {
    approveDoubtful: true,
  });
  revalidatePath(`/project/${projectId}/catalog`);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, error: null, notice: t("labelsSaved"), nonce: Date.now() };
}

/** Egyetlen dimenzió feloldása a felülvizsgálat-módból (17 · 1b): a
 *  kiválasztott érték a megadott dimenzióra kerül, a TÖBBI kétes dimenzió
 *  érintetlen marad (approveDoubtful: false). A napló-írás, az 'ember'
 *  eredet és a kétes-újraszámítás a meglévő applyLabelCorrection-ben —
 *  a címkézés logikája változatlan. */
export async function resolveDimensionAction(
  projectId: string,
  anchor: KnowledgeAnchor,
  dimension: "modality" | "valid_time" | "scope" | "source" | "lang" | "evidence",
  value: string | null,
): Promise<FormState> {
  const t = await getTranslations("catalog");
  const db = createServiceSupabaseClient();

  const patch: CorrectionPatch = {};
  switch (dimension) {
    case "modality":
      if (!MODALITIES.includes((value ?? "") as Modality)) {
        return { ok: false, error: t("errInvalidModality") };
      }
      patch.modality = value as Modality;
      break;
    case "source":
      if (!ORG_LEVELS.includes((value ?? "") as SourceOrgLevel)) {
        return { ok: false, error: t("errInvalidOrgLevel") };
      }
      patch.sourceOrgLevel = value as SourceOrgLevel;
      break;
    case "valid_time":
      patch.validTime = value;
      break;
    case "scope":
      patch.scope = value;
      break;
    case "lang":
      patch.lang = value;
      break;
    case "evidence":
      if (!EVIDENCE_KINDS.includes((value ?? "") as EvidenceKind)) {
        return { ok: false, error: t("errInvalidEvidence") };
      }
      patch.evidenceKind = value as EvidenceKind;
      break;
  }
  const res = await applyLabelCorrection(db, projectId, anchor, patch, {
    approveDoubtful: false,
  });
  revalidatePath(`/project/${projectId}/catalog`);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, error: null, notice: null };
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

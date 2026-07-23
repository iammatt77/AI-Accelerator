import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FindingResolution,
  FindingType,
  KnowledgeDismissalRow,
  KnowledgeEmbeddingRow,
  KnowledgeFindingRow,
  KnowledgeMetadataRow,
  KnowledgeSupersessionRow,
  Modality,
  SourceOrgLevel,
} from "@/lib/db/types";
import {
  anchorColumns,
  anchorFromRow,
  contentFingerprint,
  isValidAnchor,
  type KnowledgeAnchor,
} from "@/lib/knowledge/anchor";
import { embedOne, toVectorLiteral } from "@/lib/embeddings";

// ─────────────────────────────────────────────────────────────
// Tudáselem-tár (Epic 4 · 4.1-d, mag) — a metaadat/embedding/supersession/
// finding/dismissal szerkezetek ÍRÁSA és OLVASÁSA plain lib-ként (a
// server actionök ezt hívják createServiceSupabaseClient-tel; a 4.2/4.4
// ugyanezt fogyasztja; a self-check felület nélkül ezt hívja közvetlenül).
//
// Minden művelet READ-után-ÍR (select→update/insert) upsert-mintát követ —
// a lokális verifikációs shim nem ismeri a PostgREST on_conflict-upsertet;
// a 0017 unique-indexei a versenyt így is lezárják (mint a stale_acks).
// A horgony-szűrés eq/is-null-lal épül (shim-kompatibilis).
// ─────────────────────────────────────────────────────────────

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const MODALITIES: readonly Modality[] = [
  "historikus",
  "as_is",
  "normativ",
  "to_be",
  "ismeretlen",
];
const ORG_LEVELS: readonly SourceOrgLevel[] = ["hq", "helyi", "kulso", "ismeretlen"];

type Db = SupabaseClient;
type Query = ReturnType<ReturnType<Db["from"]>["select"]>;

function errMessage(e: { message?: string } | null): string {
  return e?.message ?? "?";
}

/** Horgony-szűrő egy select/…-query-re (eq érték / is null), adott prefixszel. */
function applyAnchorFilter(q: Query, a: KnowledgeAnchor, prefix = ""): Query {
  const cols = anchorColumns(a, prefix);
  let out = q;
  for (const [col, val] of Object.entries(cols)) {
    out = val === null ? out.is(col, null) : out.eq(col, val);
  }
  return out;
}

// ── 4.1-a: Metaadat ──────────────────────────────────────────

export interface MetadataInput {
  modality?: Modality;
  validTime?: string | null; // tstzrange literál, pl. "[2024-01-01,)"
  lang?: string | null;
  sourcePersonStakeholderId?: string | null;
  sourceOrgLevel?: SourceOrgLevel;
  sourceKind?: string | null;
  scope?: string | null;
}

/** Metaadat írása/frissítése egy horgonyra (F1). Nem érinti az elavítás-
 *  mezőket (azt a deprecateElement kezeli). Új sor default modalitás
 *  'ismeretlen' (F2). */
export async function setMetadata(
  db: Db,
  projectId: string,
  anchor: KnowledgeAnchor,
  input: MetadataInput,
): Promise<Result<KnowledgeMetadataRow>> {
  if (!isValidAnchor(anchor)) return { ok: false, error: "Érvénytelen horgony." };
  if (input.modality && !MODALITIES.includes(input.modality)) {
    return { ok: false, error: `Érvénytelen modalitás: ${input.modality}` };
  }
  if (input.sourceOrgLevel && !ORG_LEVELS.includes(input.sourceOrgLevel)) {
    return { ok: false, error: `Érvénytelen szervezeti szint: ${input.sourceOrgLevel}` };
  }

  const existing = await findOne<KnowledgeMetadataRow>(db, "knowledge_metadata", projectId, anchor);
  const now = new Date().toISOString();

  // Csak a megadott mezőket írjuk (a meglévőket megtartjuk; új sornál a
  // DB-default 'ismeretlen'/'ismeretlen' lép, ha nem adtunk értéket).
  const patch: Record<string, unknown> = { updated_at: now };
  if (input.modality !== undefined) patch.modality = input.modality;
  if (input.validTime !== undefined) patch.valid_time = input.validTime;
  if (input.lang !== undefined) patch.lang = input.lang;
  if (input.sourcePersonStakeholderId !== undefined)
    patch.source_person_stakeholder_id = input.sourcePersonStakeholderId;
  if (input.sourceOrgLevel !== undefined) patch.source_org_level = input.sourceOrgLevel;
  if (input.sourceKind !== undefined) patch.source_kind = input.sourceKind;
  if (input.scope !== undefined) patch.scope = input.scope;

  if (existing) {
    const { data, error } = await db
      .from("knowledge_metadata")
      .update(patch)
      .eq("id", existing.id)
      .select("*")
      .maybeSingle();
    if (error) return { ok: false, error: errMessage(error) };
    return { ok: true, data: data as KnowledgeMetadataRow };
  }
  const { data, error } = await db
    .from("knowledge_metadata")
    .insert({ project_id: projectId, ...anchorColumns(anchor), ...patch })
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: errMessage(error) };
  return { ok: true, data: data as KnowledgeMetadataRow };
}

/** Metaadat olvasása (F1). null = még nincs metaadat (NF2: nem hiba). */
export async function getMetadata(
  db: Db,
  projectId: string,
  anchor: KnowledgeAnchor,
): Promise<Result<KnowledgeMetadataRow | null>> {
  if (!isValidAnchor(anchor)) return { ok: false, error: "Érvénytelen horgony." };
  const row = await findOne<KnowledgeMetadataRow>(db, "knowledge_metadata", projectId, anchor);
  return { ok: true, data: row };
}

/** Explicit emberi elavítás (F9). Az indoklás KÖTELEZŐ (szerver-őr +
 *  DB-CHECK). Ha még nincs metaadat-sor, létrejön. */
export async function deprecateElement(
  db: Db,
  projectId: string,
  anchor: KnowledgeAnchor,
  reason: string,
): Promise<Result<KnowledgeMetadataRow>> {
  if (!isValidAnchor(anchor)) return { ok: false, error: "Érvénytelen horgony." };
  if (!reason || reason.trim().length === 0) {
    return { ok: false, error: "Az elavítás indoklása kötelező." };
  }
  const now = new Date().toISOString();
  const existing = await findOne<KnowledgeMetadataRow>(db, "knowledge_metadata", projectId, anchor);
  if (existing) {
    const { data, error } = await db
      .from("knowledge_metadata")
      .update({ deprecated_at: now, deprecated_reason: reason.trim(), updated_at: now })
      .eq("id", existing.id)
      .select("*")
      .maybeSingle();
    if (error) return { ok: false, error: errMessage(error) };
    return { ok: true, data: data as KnowledgeMetadataRow };
  }
  const { data, error } = await db
    .from("knowledge_metadata")
    .insert({
      project_id: projectId,
      ...anchorColumns(anchor),
      deprecated_at: now,
      deprecated_reason: reason.trim(),
      updated_at: now,
    })
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: errMessage(error) };
  return { ok: true, data: data as KnowledgeMetadataRow };
}

// ── 4.1-b: Embedding ─────────────────────────────────────────

/** Embedding-generálás egy tudáselemre (F5): az adapteren át beágyaz, majd
 *  a vektort a modell nevével+verziójával a horgonyhoz köti (upsert). */
export async function generateEmbedding(
  db: Db,
  projectId: string,
  anchor: KnowledgeAnchor,
  text: string,
): Promise<Result<{ model: string; modelVersion: string }>> {
  if (!isValidAnchor(anchor)) return { ok: false, error: "Érvénytelen horgony." };
  if (!text || text.trim().length === 0) {
    return { ok: false, error: "Üres szövegre nincs embedding." };
  }
  const { vector, model, modelVersion } = await embedOne(text);
  const literal = toVectorLiteral(vector);
  const existing = await findOne<KnowledgeEmbeddingRow>(
    db,
    "knowledge_embeddings",
    projectId,
    anchor,
  );
  const patch = {
    embedding: literal,
    model_name: model,
    model_version: modelVersion,
    content_text: text,
  };
  if (existing) {
    const { error } = await db
      .from("knowledge_embeddings")
      .update(patch)
      .eq("id", existing.id);
    if (error) return { ok: false, error: errMessage(error) };
  } else {
    const { error } = await db
      .from("knowledge_embeddings")
      .insert({ project_id: projectId, ...anchorColumns(anchor), ...patch });
    if (error) return { ok: false, error: errMessage(error) };
  }
  return { ok: true, data: { model, modelVersion } };
}

export interface SimilarityHit {
  anchor: KnowledgeAnchor;
  contentText: string;
  modelName: string;
  modelVersion: string;
  similarity: number;
}

export interface SimilarityOptions {
  scope?: string | null;
  modalityFamily?: Modality[] | null;
  exclude?: KnowledgeAnchor | null;
  matchCount?: number;
}

/** Hasonlósági keresés metaadat-ELŐszűréssel (F5). A query-szöveget
 *  beágyazza, majd a match_knowledge_embeddings RPC-t hívja (pontos KNN,
 *  a szűrő a keresés ELŐTT érvényesül). */
export async function similaritySearch(
  db: Db,
  projectId: string,
  queryText: string,
  opts: SimilarityOptions = {},
): Promise<Result<SimilarityHit[]>> {
  if (!queryText || queryText.trim().length === 0) {
    return { ok: false, error: "Üres keresési szöveg." };
  }
  const { vector } = await embedOne(queryText);
  const ex = opts.exclude ?? null;
  const { data, error } = await db.rpc("match_knowledge_embeddings", {
    query_embedding: toVectorLiteral(vector),
    p_project_id: projectId,
    p_scope: opts.scope ?? null,
    p_modality_family: opts.modalityFamily ?? null,
    p_exclude_block_type: ex?.block_type ?? null,
    p_exclude_block_id: ex?.block_id ?? null,
    p_exclude_artifact_id: ex?.artifact_id ?? null,
    p_exclude_field_key: ex?.field_key ?? null,
    match_count: opts.matchCount ?? 10,
  });
  if (error) return { ok: false, error: errMessage(error) };
  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    ok: true,
    data: rows.map((r) => ({
      anchor: anchorFromRow(r),
      contentText: String(r.content_text ?? ""),
      modelName: String(r.model_name ?? ""),
      modelVersion: String(r.model_version ?? ""),
      similarity: Number(r.similarity ?? 0),
    })),
  };
}

// ── 4.1-c: Supersession él ───────────────────────────────────

/** Irányított meghaladott→meghaladó él (F6). Az indoklás KÖTELEZŐ. A
 *  meghaladott elem NEM törlődik (a katalógus derivált). */
export async function createSupersession(
  db: Db,
  projectId: string,
  superseded: KnowledgeAnchor,
  superseding: KnowledgeAnchor,
  reason: string,
): Promise<Result<KnowledgeSupersessionRow>> {
  if (!isValidAnchor(superseded) || !isValidAnchor(superseding)) {
    return { ok: false, error: "Érvénytelen horgony." };
  }
  if (!reason || reason.trim().length === 0) {
    return { ok: false, error: "A meghaladás indoklása kötelező." };
  }
  const { data, error } = await db
    .from("knowledge_supersessions")
    .insert({
      project_id: projectId,
      ...anchorColumns(superseded, "superseded_"),
      ...anchorColumns(superseding, "superseding_"),
      reason: reason.trim(),
    })
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: errMessage(error) };
  return { ok: true, data: data as KnowledgeSupersessionRow };
}

export interface SupersessionView {
  /** Ez az elem meghaladott — ki(k) által, milyen indokkal (F6 olvasás). */
  supersededBy: { anchor: KnowledgeAnchor; reason: string; created_at: string }[];
  /** Ez az elem meghaladott másokat (irány másik oldala). */
  supersedes: { anchor: KnowledgeAnchor; reason: string; created_at: string }[];
}

/** Egy elem supersession-állapota mindkét irányban (F6). Az elavulás TÉNYE
 *  + a meghaladó elem + az INDOK — a 4.5 RAG-kontextusa. */
export async function getSupersession(
  db: Db,
  projectId: string,
  anchor: KnowledgeAnchor,
): Promise<Result<SupersessionView>> {
  if (!isValidAnchor(anchor)) return { ok: false, error: "Érvénytelen horgony." };
  const { data, error } = await db
    .from("knowledge_supersessions")
    .select("*")
    .eq("project_id", projectId);
  if (error) return { ok: false, error: errMessage(error) };
  const rows = (data ?? []) as KnowledgeSupersessionRow[];
  const key = (a: KnowledgeAnchor) =>
    [a.block_type, a.block_id ?? "", a.artifact_id ?? "", a.field_key ?? ""].join(" ");
  const target = key(anchor);
  const supersededBy: SupersessionView["supersededBy"] = [];
  const supersedes: SupersessionView["supersedes"] = [];
  for (const r of rows) {
    const from = anchorFromRow(r as unknown as Record<string, unknown>, "superseded_");
    const to = anchorFromRow(r as unknown as Record<string, unknown>, "superseding_");
    if (key(from) === target)
      supersededBy.push({ anchor: to, reason: r.reason, created_at: r.created_at });
    if (key(to) === target)
      supersedes.push({ anchor: from, reason: r.reason, created_at: r.created_at });
  }
  return { ok: true, data: { supersededBy, supersedes } };
}

// ── 4.1-c: Finding + állapotgép ──────────────────────────────

const LELET_TYPES: readonly FindingType[] = [2, 3, 6];
const RESOLVABLE_TYPES: readonly FindingType[] = [1, 4, 5];

/** Egy finding rögzítése (F7). A típus dönti az ágat: lelet (2,3,6) →
 *  status 'lelet' (nem vár műveletre); feloldható (1,4,5) → 'felismerve'. */
export async function createFinding(
  db: Db,
  projectId: string,
  type: FindingType,
  a: KnowledgeAnchor,
  b: KnowledgeAnchor,
  evidence?: string | null,
): Promise<Result<KnowledgeFindingRow>> {
  if (!isValidAnchor(a) || !isValidAnchor(b)) {
    return { ok: false, error: "Érvénytelen horgony." };
  }
  const status = LELET_TYPES.includes(type) ? "lelet" : "felismerve";
  const { data, error } = await db
    .from("knowledge_findings")
    .insert({
      project_id: projectId,
      finding_type: type,
      ...anchorColumns(a, "a_"),
      ...anchorColumns(b, "b_"),
      evidence: evidence ?? null,
      status,
    })
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: errMessage(error) };
  return { ok: true, data: data as KnowledgeFindingRow };
}

export interface ResolveOptions {
  /** Csak 'hamis_pozitiv'-hoz: a pár akkori tartalom-lenyomatai (F8). */
  fingerprints?: { a: string; b: string };
  /** Elutasítás-indoklás (a dismissal sorba). */
  dismissReason?: string | null;
}

/** Feloldható finding (1,4,5) feloldása (F7). A supersession-ágakon
 *  (a_ervenyes / b_ervenyes) `superseded_by` él keletkezik. A
 *  hamis_pozitiv sticky dismissalt ír (F8) — ehhez a tartalom-lenyomatok
 *  KÖTELEZŐEK. Az indoklás kötelező. */
export async function resolveFinding(
  db: Db,
  projectId: string,
  findingId: string,
  resolution: FindingResolution,
  reason: string,
  opts: ResolveOptions = {},
): Promise<Result<{ finding: KnowledgeFindingRow; supersession?: KnowledgeSupersessionRow }>> {
  if (!reason || reason.trim().length === 0) {
    return { ok: false, error: "A feloldás indoklása kötelező." };
  }
  const { data: found, error: e0 } = await db
    .from("knowledge_findings")
    .select("*")
    .eq("id", findingId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (e0 || !found) return { ok: false, error: e0 ? errMessage(e0) : "A finding nem található." };
  const finding = found as KnowledgeFindingRow;
  if (!RESOLVABLE_TYPES.includes(finding.finding_type)) {
    return { ok: false, error: "Lelet-típusú finding nem oldható fel (nincs mit feloldani)." };
  }
  if (finding.status !== "felismerve") {
    return { ok: false, error: "A finding már fel van oldva." };
  }
  if (resolution === "hamis_pozitiv" && !opts.fingerprints) {
    return {
      ok: false,
      error: "A hamis pozitív feloldáshoz a tartalom-lenyomatok kötelezők (sticky dismissal).",
    };
  }

  const now = new Date().toISOString();
  const { data: updated, error: e1 } = await db
    .from("knowledge_findings")
    .update({ status: resolution, resolved_at: now, resolution_reason: reason.trim() })
    .eq("id", findingId)
    .eq("status", "felismerve") // optimista őr
    .select("*")
    .maybeSingle();
  if (e1 || !updated) {
    return { ok: false, error: e1 ? errMessage(e1) : "A feloldás versenyben elveszett." };
  }

  const aAnchor = anchorFromRow(finding as unknown as Record<string, unknown>, "a_");
  const bAnchor = anchorFromRow(finding as unknown as Record<string, unknown>, "b_");

  // supersession-ág: A érvényes → B meghaladott (B→A él); B érvényes → A→B él
  let supersession: KnowledgeSupersessionRow | undefined;
  if (resolution === "a_ervenyes" || resolution === "b_ervenyes") {
    const superseded = resolution === "a_ervenyes" ? bAnchor : aAnchor;
    const superseding = resolution === "a_ervenyes" ? aAnchor : bAnchor;
    const sup = await createSupersession(db, projectId, superseded, superseding, reason.trim());
    if (!sup.ok) return { ok: false, error: sup.error };
    supersession = sup.data;
  }

  // hamis_pozitiv → sticky dismissal a pár akkori lenyomatával (F8)
  if (resolution === "hamis_pozitiv" && opts.fingerprints) {
    const { error: e2 } = await db.from("knowledge_dismissals").insert({
      project_id: projectId,
      finding_type: finding.finding_type,
      ...anchorColumns(aAnchor, "a_"),
      ...anchorColumns(bAnchor, "b_"),
      dismissed_reason: opts.dismissReason ?? reason.trim(),
      a_fingerprint: opts.fingerprints.a,
      b_fingerprint: opts.fingerprints.b,
    });
    if (e2) return { ok: false, error: errMessage(e2) };
  }

  return { ok: true, data: { finding: updated as KnowledgeFindingRow, supersession } };
}

// ── 4.1-c: Sticky dismissal ellenőrzés ───────────────────────

export interface SuppressionResult {
  /** Igaz → a párra ne keletkezzen új finding (érvényes elutasítás). */
  suppressed: boolean;
  /** Igaz → volt korábbi elutasítás (akkor is, ha a tartalom változott). */
  previouslyDismissed: boolean;
}

/** F8: egy (elem-pár + finding-típus) elutasítva volt-e, és ha igen, a
 *  tartalom változatlan-e. Ha volt elutasítás ÉS a lenyomatok egyeznek →
 *  elnyomás (nincs új finding). Ha volt, de a tartalom változott → NINCS
 *  elnyomás, de previouslyDismissed=true (a 4.2 jelzi „korábban elutasítva").
 *  A pár rendezetlen: (A,B) és (B,A) is illeszkedik. */
export async function checkSuppression(
  db: Db,
  projectId: string,
  type: FindingType,
  a: KnowledgeAnchor,
  b: KnowledgeAnchor,
  aFingerprint: string,
  bFingerprint: string,
): Promise<Result<SuppressionResult>> {
  const { data, error } = await db
    .from("knowledge_dismissals")
    .select("*")
    .eq("project_id", projectId)
    .eq("finding_type", type);
  if (error) return { ok: false, error: errMessage(error) };
  const rows = (data ?? []) as KnowledgeDismissalRow[];
  const key = (x: KnowledgeAnchor) =>
    [x.block_type, x.block_id ?? "", x.artifact_id ?? "", x.field_key ?? ""].join(" ");
  const ka = key(a);
  const kb = key(b);

  let previouslyDismissed = false;
  let suppressed = false;
  for (const r of rows) {
    const ra = anchorFromRow(r as unknown as Record<string, unknown>, "a_");
    const rb = anchorFromRow(r as unknown as Record<string, unknown>, "b_");
    const kra = key(ra);
    const krb = key(rb);
    // pár egyezés bármely sorrendben
    const sameOrder = kra === ka && krb === kb;
    const swapped = kra === kb && krb === ka;
    if (!sameOrder && !swapped) continue;
    previouslyDismissed = true;
    // a lenyomatok az elutasításkori sorrendhez igazodnak
    const fpMatch = sameOrder
      ? r.a_fingerprint === aFingerprint && r.b_fingerprint === bFingerprint
      : r.a_fingerprint === bFingerprint && r.b_fingerprint === aFingerprint;
    if (fpMatch) suppressed = true;
  }
  return { ok: true, data: { suppressed, previouslyDismissed } };
}

// ── Közös horgony-kereső (egy sor a horgonyra, projekten belül) ──
async function findOne<T>(
  db: Db,
  table: string,
  projectId: string,
  anchor: KnowledgeAnchor,
): Promise<T | null> {
  let q = db.from(table).select("*").eq("project_id", projectId) as unknown as Query;
  q = applyAnchorFilter(q, anchor);
  const { data } = await (q as unknown as { maybeSingle: () => Promise<{ data: unknown }> }).maybeSingle();
  return (data as T) ?? null;
}

/** Re-export a fingerprint-számításhoz (a hívók egy helyről kapják). */
export { contentFingerprint };

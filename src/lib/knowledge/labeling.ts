import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DimensionSignal,
  EvidenceKind,
  KnowledgeLabelCorrectionRow,
  KnowledgeLabelSignalRow,
  LabelDimension,
  Modality,
  SourceDocKind,
  SourceOrgLevel,
} from "@/lib/db/types";
import { anchorColumns, isValidAnchor, type KnowledgeAnchor } from "@/lib/knowledge/anchor";
import { generateEmbedding, setMetadata, type Result } from "@/lib/knowledge/store";
import { classifyKnowledgeItem, type KnowledgeLabelSample } from "@/lib/llm";
import { evidencePriorOf, modalityPriorOf } from "@/lib/sources/meta";
import { coerceValidTime } from "@/lib/llm/parse";

// ─────────────────────────────────────────────────────────────
// Címkéző motor (Epic 4 · 4.2-a/b/c/d, mag) — plain lib, felület nélkül
// verifikálható (mint a store.ts).
//
// KONFIDENCIA-MODELL (kutatási jelentés + spec §3):
//   · Elsődleges jel a KÉNYES TENGELYEN (modalitás): önkonzisztencia.
//     N=1 alapból; eszkaláció N=3-ra CSAK ha az első hívás konfidenciája
//     alacsony VAGY a modalitás as_is/normativ határeset (borderline);
//     3-ból nem-egyhangú szavazásnál N=5-re. A szavazatmegoszlás maga a
//     konfidencia (a fraction), ÉS eltárolódik (F2 — a felülvizsgálatnál
//     látszik: „3× megfigyelés, 2× előírás").
//   · A többi dimenzió: N=1, a verbalizált konfidencia a küszöb ellen —
//     tudottan gyenge jel, EZÉRT konzervatív a küszöb (ami alatta van, az
//     felülvizsgálatra megy, nem tipp lesz belőle).
//   · Küszöb alatt: az érintett dimenzió 'ismeretlen'/null a metaadatban,
//     a JELÖLT a signal-ban marad (a felülvizsgálat ezt kínálja fel), és
//     az elem KÉTES (doubtful) — a 4.3 felismerése kihagyja.
//
// F4: az 'ember' eredetű dimenziót a gép SOHA nem írja felül.
// F8: a címkék KIZÁRÓLAG a 4.1 setMetadata-ján mennek be — az updated_at
// bumpol, a meglévő (derivált) elavulás-jelölő minta rá tud kötni.
// ─────────────────────────────────────────────────────────────

type Db = SupabaseClient;

export const LABEL_DIMENSIONS: readonly LabelDimension[] = [
  "modality",
  "valid_time",
  "scope",
  "source",
  "lang",
  "evidence",
];

/** A forrás feltöltéskor megadott metaadata (4.2b-c) — a hívó oldja fel az
 *  elem source_input_ids[0]-jából; null = nincs forrás vagy nincs megadva. */
export interface SourceMeta {
  kind: SourceDocKind | null;
  orgLevel: SourceOrgLevel | null;
}

export interface LabelThresholds {
  /** Verbalizált konfidencia-küszöb (ez alatt: kétes / eszkaláció). */
  conf: number;
  /** Szavazat-arány küszöb az eszkalált modalitáson (pl. 0.8 → 4/5). */
  vote: number;
}

/** Konzervatív alapértékek; env-ből hangolható (a javítás-napló alapján). */
export function labelThresholds(): LabelThresholds {
  const conf = parseFloat(process.env.KNOWLEDGE_CONF_THRESHOLD ?? "0.7");
  const vote = parseFloat(process.env.KNOWLEDGE_VOTE_THRESHOLD ?? "0.8");
  return {
    conf: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.7,
    vote: Number.isFinite(vote) ? Math.max(0, Math.min(1, vote)) : 0.8,
  };
}

const SOURCE_SEP = "|";

/** A source-dimenzió napló-/összevetés-alakja: org|kind|person. */
export function serializeSourceLabel(
  orgLevel: string | null,
  kind: string | null,
  personName: string | null,
): string {
  return [orgLevel ?? "", kind ?? "", personName ?? ""].join(SOURCE_SEP);
}

function normalizeWs(s: string): string {
  return (s ?? "").trim().replace(/\s+/g, " ");
}

/** Egy sor keresése a horgonyon (eq / is null — shim-kompatibilis). */
async function findSignal(
  db: Db,
  projectId: string,
  anchor: KnowledgeAnchor,
): Promise<KnowledgeLabelSignalRow | null> {
  let q = db.from("knowledge_label_signals").select("*").eq("project_id", projectId);
  for (const [col, val] of Object.entries(anchorColumns(anchor))) {
    q = val === null ? q.is(col, null) : q.eq(col, val);
  }
  const { data } = await q.maybeSingle();
  return (data as KnowledgeLabelSignalRow) ?? null;
}

export interface StakeholderRef {
  id: string;
  name: string;
}

function matchStakeholder(
  personName: string | null,
  stakeholders: StakeholderRef[],
): StakeholderRef | null {
  if (!personName) return null;
  const needle = personName.trim().toLowerCase();
  if (!needle) return null;
  return (
    stakeholders.find((s) => s.name.trim().toLowerCase() === needle) ??
    stakeholders.find(
      (s) =>
        s.name.toLowerCase().includes(needle) || needle.includes(s.name.toLowerCase()),
    ) ??
    null
  );
}

export interface LabelOutcome {
  signal: KnowledgeLabelSignalRow;
  doubtful: boolean;
  doubtfulDimensions: LabelDimension[];
  samplesUsed: number;
  embedding: { ok: boolean; error?: string };
}

/**
 * Egy tudáselem címkézése (4.2-a/b/c): mintavétel + döntés + metaadat-írás
 * (setMetadata — 4.1) + signal-upsert + embedding (4.1 adapter). Az 'ember'
 * eredetű dimenziókat NEM írja felül (F4).
 */
export async function labelOneItem(
  db: Db,
  projectId: string,
  anchor: KnowledgeAnchor,
  text: string,
  stakeholders: StakeholderRef[],
  sourceMeta: SourceMeta | null = null,
): Promise<Result<LabelOutcome>> {
  if (!isValidAnchor(anchor)) return { ok: false, error: "Érvénytelen horgony." };
  const cedula = normalizeWs(text);
  if (!cedula) return { ok: false, error: "Üres cédula-szöveg — nincs mit címkézni." };

  const t = labelThresholds();
  const existing = await findSignal(db, projectId, anchor);
  const humanDims = new Set<LabelDimension>(
    LABEL_DIMENSIONS.filter((d) => existing?.signals?.[d]?.source === "ember"),
  );

  const stakeholderNames = stakeholders.map((s) => s.name);
  let samplesUsed = 1;
  let sample0: KnowledgeLabelSample;
  try {
    sample0 = await classifyKnowledgeItem(cedula, {
      stakeholderNames,
      sampleIndex: 0,
      sourceKind: sourceMeta?.kind ?? null,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Osztályozási hiba." };
  }

  // ── Modalitás: önkonzisztencia a kényes tengelyen ──────────
  // 4.2b-c: ha a forrás típusából van PRIOR (hivatalos dok → normativ,
  // rendszeradat/interjú → as_is), az felold: nincs eszkaláció, NEM kétes.
  // A szöveg felülírhat, ha nem-borderline és magabiztos; különben a prior
  // dönt (a borderline as_is/normativ kérdést pont a forrás-típus zárja le).
  const modalityPrior = modalityPriorOf(sourceMeta?.kind ?? null);
  const noKindNote =
    sourceMeta?.kind == null
      ? " A forrás típusa nincs megadva — a besorolás csak a szövegre támaszkodik."
      : "";
  let modalitySignal: DimensionSignal | null = null;
  if (!humanDims.has("modality") && modalityPrior) {
    const first = sample0.modality;
    const textOverrides =
      !first.borderline && first.label !== modalityPrior && first.confidence >= t.conf;
    modalitySignal = textOverrides
      ? {
          label: first.label,
          confidence: first.confidence,
          reason: `${first.reason} (a szöveg felülírja a forrás-típus alapértékét)`,
          evidence: first.evidence,
          evidence_verbatim: normalizeWs(cedula).includes(normalizeWs(first.evidence)),
          samples: 1,
          accepted: true,
          source: "gep",
        }
      : {
          label: modalityPrior,
          confidence: Math.max(first.confidence, 0.85),
          reason:
            first.label === modalityPrior && !first.borderline
              ? first.reason
              : "A forrás típusának alapértéke dönt; a szöveg nem mond ellent elég erősen.",
          evidence: first.evidence,
          evidence_verbatim: normalizeWs(cedula).includes(normalizeWs(first.evidence)),
          samples: 1,
          accepted: true,
          source: "gep",
          derived_from: "forras-metaadat",
        };
  } else if (!humanDims.has("modality")) {
    const first = sample0.modality;
    const needEscalation = first.borderline || first.confidence < t.conf;
    if (!needEscalation) {
      modalitySignal = {
        label: first.label,
        confidence: first.confidence,
        reason: first.reason,
        evidence: first.evidence,
        evidence_verbatim: normalizeWs(cedula).includes(normalizeWs(first.evidence)),
        samples: 1,
        accepted: true,
        source: "gep",
      };
    } else {
      // N=3, majd nem-egyhangúnál N=5 (spec: 3-5, NE nagy N)
      const labels: string[] = [first.label ?? "ismeretlen"];
      try {
        for (let i = 1; i < 3; i++) {
          const s = await classifyKnowledgeItem(cedula, {
            stakeholderNames,
            sampleIndex: i,
            sourceKind: sourceMeta?.kind ?? null,
          });
          labels.push(s.modality.label ?? "ismeretlen");
        }
        samplesUsed = 3;
        const tally3 = tally(labels);
        if (tally3.fraction < 1.0) {
          for (let i = 3; i < 5; i++) {
            const s = await classifyKnowledgeItem(cedula, {
              stakeholderNames,
              sampleIndex: i,
              sourceKind: sourceMeta?.kind ?? null,
            });
            labels.push(s.modality.label ?? "ismeretlen");
          }
          samplesUsed = 5;
        }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Mintavételi hiba." };
      }
      const { votes, leader, fraction } = tally(labels);
      modalitySignal = {
        label: leader,
        confidence: fraction, // az önkonzisztencia MAGA a konfidencia
        reason: first.reason,
        evidence: first.evidence,
        evidence_verbatim: normalizeWs(cedula).includes(normalizeWs(first.evidence)),
        votes,
        samples: labels.length,
        accepted: fraction >= t.vote,
        source: "gep",
      };
    }
  }

  // ── A többi dimenzió: N=1, verbalizált konfidencia a küszöb ellen ──
  const dimOf = (axis: { label: string | null; confidence: number; reason: string; evidence: string }): DimensionSignal => ({
    label: axis.label,
    confidence: axis.confidence,
    reason: axis.reason,
    evidence: axis.evidence,
    evidence_verbatim: normalizeWs(cedula).includes(normalizeWs(axis.evidence)),
    samples: 1,
    accepted: axis.confidence >= t.conf,
    source: "gep",
  });

  const signals: Partial<Record<LabelDimension, DimensionSignal>> = {
    ...(existing?.signals ?? {}),
  };
  if (modalitySignal) signals.modality = modalitySignal;
  if (!humanDims.has("valid_time")) signals.valid_time = dimOf(sample0.validTime);
  if (!humanDims.has("scope")) signals.scope = dimOf(sample0.scope);
  if (!humanDims.has("source")) {
    if (sourceMeta?.orgLevel) {
      // 4.2b-c: a szervezeti szint a feltöltő metaadatából — nem tipp.
      signals.source = {
        label: sourceMeta.orgLevel,
        confidence: 0.98,
        reason: "A forrás szervezeti szintje a feltöltéskor megadott metaadatból.",
        evidence: "",
        samples: 1,
        accepted: true,
        source: "gep",
        derived_from: "forras-metaadat",
        person_name: sample0.source.personName,
        kind: sample0.source.kind,
      };
    } else {
      signals.source = {
        ...dimOf(sample0.source),
        person_name: sample0.source.personName,
        kind: sample0.source.kind,
      };
    }
  }
  if (!humanDims.has("lang")) signals.lang = dimOf(sample0.lang);
  if (!humanDims.has("evidence")) {
    const base = dimOf(sample0.evidence);
    const evidencePrior = evidencePriorOf(sourceMeta?.kind ?? null);
    if (!base.accepted && evidencePrior) {
      // A forrás-típus alapértéke felold (spec §4) — a szöveg finomíthat,
      // de gyenge szöveg-jel mellett az alapérték áll, NEM kétes.
      signals.evidence = {
        ...base,
        label: evidencePrior,
        confidence: Math.max(base.confidence, 0.85),
        reason: "A forrás-típus alapértéke (a szövegben nincs erősebb jel).",
        accepted: true,
        derived_from: "forras-metaadat",
      };
    } else {
      signals.evidence = base;
    }
  }
  // Látható bizonytalanság (F4): ismeretlen forrás-típusnál a modalitás
  // indoka kimondja, hogy csak a szövegre támaszkodtunk.
  if (noKindNote && signals.modality && signals.modality.source === "gep") {
    signals.modality = {
      ...signals.modality,
      reason: `${signals.modality.reason ?? ""}${noKindNote}`,
    };
  }

  const doubtfulDimensions = LABEL_DIMENSIONS.filter(
    (d) => signals[d] && signals[d]!.source === "gep" && !signals[d]!.accepted,
  );
  const doubtful = doubtfulDimensions.length > 0;

  // ── Metaadat-írás a 4.1 API-n (CSAK a gépi dimenziók) ──────
  const person = matchStakeholder(
    signals.source?.person_name ?? null,
    stakeholders,
  );
  const meta: Parameters<typeof setMetadata>[3] = {};
  if (signals.modality && signals.modality.source === "gep") {
    meta.modality = (signals.modality.accepted
      ? (signals.modality.label as Modality)
      : "ismeretlen") as Modality;
  }
  if (signals.valid_time && signals.valid_time.source === "gep") {
    meta.validTime = signals.valid_time.accepted ? signals.valid_time.label : null;
  }
  if (signals.scope && signals.scope.source === "gep") {
    meta.scope = signals.scope.accepted ? signals.scope.label : null;
  }
  if (signals.source && signals.source.source === "gep") {
    meta.sourceOrgLevel = (signals.source.accepted
      ? (signals.source.label as SourceOrgLevel)
      : "ismeretlen") as SourceOrgLevel;
    meta.sourceKind = signals.source.accepted ? (signals.source.kind ?? null) : null;
    meta.sourcePersonStakeholderId = signals.source.accepted ? (person?.id ?? null) : null;
  }
  if (signals.lang && signals.lang.source === "gep") {
    meta.lang = signals.lang.accepted ? signals.lang.label : null;
  }
  if (signals.evidence && signals.evidence.source === "gep") {
    meta.evidenceKind = (signals.evidence.accepted
      ? (signals.evidence.label as EvidenceKind)
      : "ismeretlen") as EvidenceKind;
  }
  const metaRes = await setMetadata(db, projectId, anchor, meta);
  if (!metaRes.ok) return { ok: false, error: `Metaadat-írás sikertelen: ${metaRes.error}` };

  // ── Signal-upsert (horgonyonként egy sor) ──────────────────
  const now = new Date().toISOString();
  const signalPatch = {
    signals,
    doubtful,
    doubtful_dimensions: doubtfulDimensions,
    labeled_at: now,
    updated_at: now,
  };
  let signalRow: KnowledgeLabelSignalRow;
  if (existing) {
    const { data, error } = await db
      .from("knowledge_label_signals")
      .update(signalPatch)
      .eq("id", existing.id)
      .select("*")
      .maybeSingle();
    if (error || !data) return { ok: false, error: error?.message ?? "Signal-frissítés sikertelen." };
    signalRow = data as KnowledgeLabelSignalRow;
  } else {
    const { data, error } = await db
      .from("knowledge_label_signals")
      .insert({ project_id: projectId, ...anchorColumns(anchor), ...signalPatch })
      .select("*")
      .maybeSingle();
    if (error || !data) return { ok: false, error: error?.message ?? "Signal-írás sikertelen." };
    signalRow = data as KnowledgeLabelSignalRow;
  }

  // ── Embedding a 4.1 adapteren (4.2-c) — a címkék után fut ──
  const emb = await generateEmbedding(db, projectId, anchor, cedula);
  return {
    ok: true,
    data: {
      signal: signalRow,
      doubtful,
      doubtfulDimensions,
      samplesUsed,
      embedding: emb.ok ? { ok: true } : { ok: false, error: emb.error },
    },
  };
}

function tally(labels: string[]): {
  votes: Record<string, number>;
  leader: string;
  fraction: number;
} {
  const votes: Record<string, number> = {};
  for (const l of labels) votes[l] = (votes[l] ?? 0) + 1;
  let leader = labels[0];
  for (const [l, n] of Object.entries(votes)) if (n > (votes[leader] ?? 0)) leader = l;
  return { votes, leader, fraction: (votes[leader] ?? 0) / labels.length };
}

// ── 4.2-d: kézi javítás + napló ──────────────────────────────

export interface CorrectionPatch {
  modality?: Modality;
  evidenceKind?: EvidenceKind;
  validTime?: string | null;
  scope?: string | null;
  sourceOrgLevel?: SourceOrgLevel;
  sourceKind?: string | null;
  sourcePersonStakeholderId?: string | null;
  sourcePersonName?: string | null;
  lang?: string | null;
}

export interface CorrectionOutcome {
  signal: KnowledgeLabelSignalRow;
  loggedCorrections: number;
}

/**
 * Kézi címke-javítás (F4+F5): a metaadat a patch szerint frissül, az
 * érintett dimenziók 'ember' eredetűek lesznek (a gép többé nem írja felül),
 * és minden érdemi döntés a naplóba kerül:
 *   · megváltoztatott dimenzió (kétes vagy biztos) → old≠new sor;
 *   · approveDoubtful=true → a patch-ben NEM szereplő kétes dimenziók a gépi
 *     JELÖLTTEL jóváhagyódnak (old=new sor, was_doubtful=true — ebből
 *     olvasható ki a „túl óvatos volt" irány).
 * Biztos dimenzió változatlan értékkel → nincs napló-sor (no-op).
 */
export async function applyLabelCorrection(
  db: Db,
  projectId: string,
  anchor: KnowledgeAnchor,
  patch: CorrectionPatch,
  opts: { approveDoubtful?: boolean } = {},
): Promise<Result<CorrectionOutcome>> {
  if (!isValidAnchor(anchor)) return { ok: false, error: "Érvénytelen horgony." };

  const existing = await findSignal(db, projectId, anchor);
  const signals: Partial<Record<LabelDimension, DimensionSignal>> = {
    ...(existing?.signals ?? {}),
  };
  const wasDoubtful = new Set((existing?.doubtful_dimensions ?? []) as LabelDimension[]);

  interface DimEdit {
    dimension: LabelDimension;
    newLabel: string | null;
    metaPatch: Parameters<typeof setMetadata>[3];
    signalLabel: string | null;
    personName?: string | null;
    kind?: string | null;
  }
  const edits: DimEdit[] = [];

  if (patch.modality !== undefined) {
    edits.push({
      dimension: "modality",
      newLabel: patch.modality,
      metaPatch: { modality: patch.modality },
      signalLabel: patch.modality,
    });
  }
  if (patch.validTime !== undefined) {
    const coerced = coerceValidTime(patch.validTime);
    edits.push({
      dimension: "valid_time",
      newLabel: coerced,
      metaPatch: { validTime: coerced },
      signalLabel: coerced,
    });
  }
  if (patch.scope !== undefined) {
    const v = patch.scope && patch.scope.trim() !== "" ? patch.scope.trim() : null;
    edits.push({ dimension: "scope", newLabel: v, metaPatch: { scope: v }, signalLabel: v });
  }
  if (
    patch.sourceOrgLevel !== undefined ||
    patch.sourceKind !== undefined ||
    patch.sourcePersonStakeholderId !== undefined
  ) {
    const cur = signals.source;
    const org = patch.sourceOrgLevel ?? ((cur?.label ?? "ismeretlen") as SourceOrgLevel);
    const kind = patch.sourceKind !== undefined ? patch.sourceKind : (cur?.kind ?? null);
    const personName =
      patch.sourcePersonName !== undefined ? patch.sourcePersonName : (cur?.person_name ?? null);
    edits.push({
      dimension: "source",
      newLabel: serializeSourceLabel(org, kind, personName),
      metaPatch: {
        sourceOrgLevel: org,
        sourceKind: kind,
        ...(patch.sourcePersonStakeholderId !== undefined
          ? { sourcePersonStakeholderId: patch.sourcePersonStakeholderId }
          : {}),
      },
      signalLabel: org,
      personName,
      kind,
    });
  }
  if (patch.lang !== undefined) {
    const v = patch.lang && patch.lang.trim() !== "" ? patch.lang.trim() : null;
    edits.push({ dimension: "lang", newLabel: v, metaPatch: { lang: v }, signalLabel: v });
  }
  if (patch.evidenceKind !== undefined) {
    edits.push({
      dimension: "evidence",
      newLabel: patch.evidenceKind,
      metaPatch: { evidenceKind: patch.evidenceKind },
      signalLabel: patch.evidenceKind,
    });
  }

  // approveDoubtful: a patch-ben nem szereplő kétes gépi dimenziók a gépi
  // JELÖLTTEL jóváhagyódnak (változtatás nélküli jóváhagyás).
  if (opts.approveDoubtful) {
    const patched = new Set(edits.map((e) => e.dimension));
    for (const dim of wasDoubtful) {
      if (patched.has(dim)) continue;
      const sig = signals[dim];
      if (!sig || sig.source === "ember") continue;
      if (dim === "modality") {
        const label = (sig.label ?? "ismeretlen") as Modality;
        edits.push({ dimension: dim, newLabel: label, metaPatch: { modality: label }, signalLabel: label });
      } else if (dim === "valid_time") {
        edits.push({ dimension: dim, newLabel: sig.label, metaPatch: { validTime: sig.label }, signalLabel: sig.label });
      } else if (dim === "scope") {
        edits.push({ dimension: dim, newLabel: sig.label, metaPatch: { scope: sig.label }, signalLabel: sig.label });
      } else if (dim === "source") {
        const org = (sig.label ?? "ismeretlen") as SourceOrgLevel;
        edits.push({
          dimension: dim,
          newLabel: serializeSourceLabel(org, sig.kind ?? null, sig.person_name ?? null),
          metaPatch: { sourceOrgLevel: org, sourceKind: sig.kind ?? null },
          signalLabel: org,
          personName: sig.person_name ?? null,
          kind: sig.kind ?? null,
        });
      } else if (dim === "evidence") {
        const label = (sig.label ?? "ismeretlen") as EvidenceKind;
        edits.push({ dimension: dim, newLabel: label, metaPatch: { evidenceKind: label }, signalLabel: label });
      } else {
        edits.push({ dimension: dim, newLabel: sig.label, metaPatch: { lang: sig.label }, signalLabel: sig.label });
      }
    }
  }

  if (edits.length === 0) {
    return { ok: false, error: "Nincs módosítandó dimenzió." };
  }

  // Napló-sorok + signal-frissítés
  const correctionRows: Omit<KnowledgeLabelCorrectionRow, "id" | "corrected_at">[] = [];
  let metaPatch: Parameters<typeof setMetadata>[3] = {};
  for (const e of edits) {
    const cur = signals[e.dimension];
    const oldLabel =
      e.dimension === "source"
        ? cur
          ? serializeSourceLabel(cur.label, cur.kind ?? null, cur.person_name ?? null)
          : null
        : (cur?.label ?? null);
    const dimWasDoubtful = wasDoubtful.has(e.dimension);
    const changed = (oldLabel ?? "") !== (e.newLabel ?? "");
    // Napló: minden változtatás + minden kétes-feloldás (változatlan is).
    if (changed || dimWasDoubtful) {
      correctionRows.push({
        project_id: projectId,
        ...(anchorColumns(anchor) as Pick<
          KnowledgeLabelCorrectionRow,
          "block_type" | "block_id" | "artifact_id" | "field_key"
        >),
        dimension: e.dimension,
        old_label: oldLabel,
        new_label: e.newLabel,
        machine_confidence: cur?.confidence ?? null,
        was_doubtful: dimWasDoubtful,
      });
    }
    metaPatch = { ...metaPatch, ...e.metaPatch };
    signals[e.dimension] = {
      ...(cur ?? { confidence: 0, reason: null, evidence: null }),
      label: e.signalLabel,
      ...(e.dimension === "source"
        ? { person_name: e.personName ?? null, kind: e.kind ?? null }
        : {}),
      accepted: true,
      source: "ember",
    } as DimensionSignal;
    wasDoubtful.delete(e.dimension);
  }

  const metaRes = await setMetadata(db, projectId, anchor, metaPatch);
  if (!metaRes.ok) return { ok: false, error: `Metaadat-írás sikertelen: ${metaRes.error}` };

  if (correctionRows.length > 0) {
    const { error } = await db.from("knowledge_label_corrections").insert(correctionRows);
    if (error) return { ok: false, error: `Napló-írás sikertelen: ${error.message}` };
  }

  const doubtfulDimensions = LABEL_DIMENSIONS.filter(
    (d) => signals[d] && signals[d]!.source === "gep" && !signals[d]!.accepted,
  );
  const now = new Date().toISOString();
  const signalPatch = {
    signals,
    doubtful: doubtfulDimensions.length > 0,
    doubtful_dimensions: doubtfulDimensions,
    updated_at: now,
  };
  let signalRow: KnowledgeLabelSignalRow;
  if (existing) {
    const { data, error } = await db
      .from("knowledge_label_signals")
      .update(signalPatch)
      .eq("id", existing.id)
      .select("*")
      .maybeSingle();
    if (error || !data) return { ok: false, error: error?.message ?? "Signal-frissítés sikertelen." };
    signalRow = data as KnowledgeLabelSignalRow;
  } else {
    const { data, error } = await db
      .from("knowledge_label_signals")
      .insert({
        project_id: projectId,
        ...anchorColumns(anchor),
        ...signalPatch,
        labeled_at: now,
      })
      .select("*")
      .maybeSingle();
    if (error || !data) return { ok: false, error: error?.message ?? "Signal-írás sikertelen." };
    signalRow = data as KnowledgeLabelSignalRow;
  }

  return { ok: true, data: { signal: signalRow, loggedCorrections: correctionRows.length } };
}

// ── 4.2-d: hangolási kiolvasó (tiszta függvény) ──────────────

export interface CorrectionStats {
  /** Dimenziónként: túl bátor (biztos volt, átírták) / túl óvatos (kétes
   *  volt, változtatás nélkül jóváhagyva) / indokolt kétes (kétes volt és
   *  tényleg javítani kellett). */
  byDimension: Record<
    string,
    { tooBold: number; tooCautious: number; justifiedDoubt: number }
  >;
  total: number;
}

/** A javítás-naplóból kiolvasható mintázat — ez hangolja a küszöböt:
 *  sok „túl bátor" → szigorítás; sok „túl óvatos" → lazítás. */
export function summarizeCorrections(
  rows: Pick<KnowledgeLabelCorrectionRow, "dimension" | "old_label" | "new_label" | "was_doubtful">[],
): CorrectionStats {
  const byDimension: CorrectionStats["byDimension"] = {};
  for (const r of rows) {
    const d = (byDimension[r.dimension] ??= { tooBold: 0, tooCautious: 0, justifiedDoubt: 0 });
    const changed = (r.old_label ?? "") !== (r.new_label ?? "");
    if (!r.was_doubtful && changed) d.tooBold++;
    else if (r.was_doubtful && !changed) d.tooCautious++;
    else if (r.was_doubtful && changed) d.justifiedDoubt++;
  }
  return { byDimension, total: rows.length };
}

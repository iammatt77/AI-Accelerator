import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { CatalogAdmin, type CatalogAdminItem } from "@/components/CatalogAdmin";
import { anchorKey } from "@/lib/knowledge/anchor";
import { summarizeCorrections } from "@/lib/knowledge/labeling";
import { claimOf, claimUsesExcerpt, resolveOrigin } from "@/lib/knowledge/browse";
import { isKnowledgeExemptBlockType, isKnowledgeExemptField } from "@/lib/artifacts/config";
import type {
  ArtifactRow,
  ClientRow,
  InputItemRow,
  KnowledgeCatalogRow,
  KnowledgeLabelCorrectionRow,
  KnowledgeLabelSignalRow,
  KnowledgeMetadataRow,
  ProjectRow,
  StakeholderRow,
} from "@/lib/db/types";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Tudáselem-katalógus (17 · 4.2-e) — az átkeretezett admin-felület: egy
// tudáselem EGY ÁLLÍTÁS. A lista a knowledge_catalog nézetből (2.1) jön; a
// címkék a 4.1 metaadat-rétegéből; a konfidencia-jelek a 4.2 signal-
// táblájából; az EREDET (forrás-dokumentum · személy · dátum) az
// input_items + stakeholders + artifacts CSAK-OLVASÁS merge-éből.
// ─────────────────────────────────────────────────────────────

export default async function CatalogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("catalog");
  const supabase = createServiceSupabaseClient();

  const [
    { data: projectData },
    { data: catData },
    { data: metaData },
    { data: sigData },
    { data: corrData },
    { data: shData },
    { data: inputData },
    { data: artData },
  ] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase.from("knowledge_catalog").select("*").eq("project_id", id),
    supabase.from("knowledge_metadata").select("*").eq("project_id", id),
    supabase.from("knowledge_label_signals").select("*").eq("project_id", id),
    supabase.from("knowledge_label_corrections").select("*").eq("project_id", id),
    supabase.from("stakeholders").select("*").eq("project_id", id),
    supabase.from("input_items").select("*").eq("project_id", id),
    supabase.from("artifacts").select("*").eq("project_id", id),
  ]);
  if (!projectData) notFound();
  const project = projectData as ProjectRow;

  const { data: clientData } = await supabase
    .from("clients")
    .select("*")
    .eq("id", project.client_id)
    .maybeSingle();
  const client = (clientData ?? null) as ClientRow | null;

  const keyOf = (r: {
    block_type: string;
    block_id: string | null;
    artifact_id: string | null;
    field_key: string | null;
  }) =>
    anchorKey({
      block_type: r.block_type,
      block_id: r.block_id,
      artifact_id: r.artifact_id,
      field_key: r.field_key,
    });

  const metaByKey = new Map(
    ((metaData ?? []) as KnowledgeMetadataRow[]).map((m) => [keyOf(m), m]),
  );
  const sigByKey = new Map(
    ((sigData ?? []) as KnowledgeLabelSignalRow[]).map((s) => [keyOf(s), s]),
  );
  const inputsById = new Map(
    ((inputData ?? []) as InputItemRow[]).map((i) => [i.id, i]),
  );
  const artifactsById = new Map(
    ((artData ?? []) as ArtifactRow[]).map((a) => [a.id, a]),
  );
  const stakeholdersById = new Map(
    ((shData ?? []) as StakeholderRow[]).map((s) => [s.id, s]),
  );

  const items: CatalogAdminItem[] = ((catData ?? []) as KnowledgeCatalogRow[])
    // A katalógus KIZÁRÓLAG ÜGYFÉL-TUDÁS (2026-08-13 döntés): a projekt- és
    // módszertani tudás cédulái (értékelési szempontok, a mi döntéseink, a
    // build-artefaktumaink), valamint a 4.2b szerkezet-mezői kimaradnak.
    // A 2.1 `knowledge_catalog` nézet ÉRINTETLEN — adat nem vész el.
    .filter((row) => {
      if (isKnowledgeExemptBlockType(row.block_type)) return false;
      return !(
        row.block_type === "artifact_field" &&
        row.artifact_id &&
        row.field_key &&
        isKnowledgeExemptField(artifactsById.get(row.artifact_id)?.type ?? "", row.field_key)
      );
    })
    .map((row) => {
      const anchor = {
        block_type: row.block_type,
        block_id: row.block_id,
        artifact_id: row.artifact_id,
        field_key: row.field_key,
      };
      const key = anchorKey(anchor);
      const meta = metaByKey.get(key) ?? null;
      const signal = sigByKey.get(key) ?? null;
      return {
        key,
        anchor,
        title: row.title,
        excerpt: row.excerpt,
        phase: row.phase,
        blockType: row.block_type,
        cedulaText: [row.title, row.excerpt ?? ""].filter(Boolean).join(" — "),
        claim: claimOf(row),
        claimFromExcerpt: claimUsesExcerpt(row),
        sourceInputId: row.source_input_ids?.[0] ?? null,
        origin: resolveOrigin(row, {
          clientName: client?.name ?? null,
          projectName: project.name,
          inputsById,
          artifactsById,
          stakeholdersById,
          labeledPersonId: meta?.source_person_stakeholder_id ?? null,
        }),
        metadata: meta
          ? {
              modality: meta.modality,
              validTime: meta.valid_time,
              lang: meta.lang,
              scope: meta.scope,
              sourceOrgLevel: meta.source_org_level,
              sourceKind: meta.source_kind,
              sourcePersonStakeholderId: meta.source_person_stakeholder_id,
              evidenceKind: meta.evidence_kind,
            }
          : null,
        signal,
      };
    })
    .sort((a, b) => a.claim.localeCompare(b.claim, "hu"));

  const corrections = (corrData ?? []) as KnowledgeLabelCorrectionRow[];
  const stakeholders = ((shData ?? []) as StakeholderRow[]).map((s) => ({
    id: s.id,
    name: s.name,
  }));

  // „Utolsó címkézés" a fejlécbe (kinyerés-futás rekord nincs — a signals
  // legfrissebb labeled_at-ja az őszinte megfelelő).
  const lastLabeledAt = ((sigData ?? []) as KnowledgeLabelSignalRow[])
    .map((s) => s.labeled_at)
    .sort()
    .at(-1) ?? null;

  return (
    <div className="mx-auto w-full max-w-[1480px] px-5 py-6">
      <CatalogAdmin
        projectId={id}
        projectName={project.name}
        clientName={client?.name ?? null}
        items={items}
        stakeholders={stakeholders}
        tuning={summarizeCorrections(corrections)}
        sourceCount={(inputData ?? []).length}
        lastLabeledAt={lastLabeledAt}
        headerTitle={t("title")}
      />
    </div>
  );
}

import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { CatalogAdmin, type CatalogAdminItem } from "@/components/CatalogAdmin";
import { anchorKey } from "@/lib/knowledge/anchor";
import { summarizeCorrections } from "@/lib/knowledge/labeling";
import type {
  KnowledgeCatalogRow,
  KnowledgeLabelCorrectionRow,
  KnowledgeLabelSignalRow,
  KnowledgeMetadataRow,
  ProjectRow,
  StakeholderRow,
} from "@/lib/db/types";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Tudáskatalógus admin (Epic 4 · 4.2-e) — a jóváhagyott cédulák címkézése
// és felülvizsgálata. A lista a knowledge_catalog nézetből (2.1) jön; a
// címkék a 4.1 metaadat-rétegéből; a konfidencia-jelek a 4.2 signal-
// táblájából. A kétesek felülvizsgálati sora + böngészhető/szűrhető
// katalógus + javítás-napló összegzés (küszöb-hangolás iránya).
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
  ] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase.from("knowledge_catalog").select("*").eq("project_id", id),
    supabase.from("knowledge_metadata").select("*").eq("project_id", id),
    supabase.from("knowledge_label_signals").select("*").eq("project_id", id),
    supabase.from("knowledge_label_corrections").select("*").eq("project_id", id),
    supabase.from("stakeholders").select("*").eq("project_id", id),
  ]);
  if (!projectData) notFound();
  const project = projectData as ProjectRow;

  const metaByKey = new Map(
    ((metaData ?? []) as KnowledgeMetadataRow[]).map((m) => [
      anchorKey({
        block_type: m.block_type,
        block_id: m.block_id,
        artifact_id: m.artifact_id,
        field_key: m.field_key,
      }),
      m,
    ]),
  );
  const sigByKey = new Map(
    ((sigData ?? []) as KnowledgeLabelSignalRow[]).map((s) => [
      anchorKey({
        block_type: s.block_type,
        block_id: s.block_id,
        artifact_id: s.artifact_id,
        field_key: s.field_key,
      }),
      s,
    ]),
  );

  const items: CatalogAdminItem[] = ((catData ?? []) as KnowledgeCatalogRow[])
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
        metadata: meta
          ? {
              modality: meta.modality,
              validTime: meta.valid_time,
              lang: meta.lang,
              scope: meta.scope,
              sourceOrgLevel: meta.source_org_level,
              sourceKind: meta.source_kind,
              sourcePersonStakeholderId: meta.source_person_stakeholder_id,
            }
          : null,
        signal,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, "hu"));

  const corrections = (corrData ?? []) as KnowledgeLabelCorrectionRow[];
  const stakeholders = ((shData ?? []) as StakeholderRow[]).map((s) => ({
    id: s.id,
    name: s.name,
  }));

  return (
    <div className="mx-auto w-full max-w-[1080px] px-5 py-6">
      <header className="mb-5">
        <h1 className="text-title font-bold">{t("title")}</h1>
        <p className="mt-0.5 text-body text-ink-secondary">
          {project.name} · {t("subtitle")}
        </p>
      </header>
      <CatalogAdmin
        projectId={id}
        items={items}
        stakeholders={stakeholders}
        tuning={summarizeCorrections(corrections)}
      />
    </div>
  );
}

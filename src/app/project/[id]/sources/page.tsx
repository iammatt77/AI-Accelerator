import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { SourcesLibrary } from "@/components/SourcesLibrary";
import {
  deriveFileBadge,
  deriveSourceKind,
  previewLine,
  wordCount,
  type ReferenceChip,
  type SourceRow,
} from "@/lib/sources/references";
import { getTypeDef, parseArtifactFields } from "@/lib/artifacts/config";
import type { ArtifactRow, InputItemRow, ProjectRow, StakeholderRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Források — mester–részlet redesign (ref_forrastar.html). A végtelen
// szövegfal helyett kereshető lista + olvasó-panel. Minden a MEGLÉVŐ
// input_items adatból; a „hivatkozva N× / HOL" a citációk FORDÍTOTT
// aggregációja (artifacts.source_input_ids ∪ fields.source_indices, illetve
// stakeholders.source_input_ids / stakeholder_source_id) — nincs új adatmodell,
// nincs migráció; a citáció-rendszert csak OLVASSUK.
// ─────────────────────────────────────────────────────────────

export default async function ProjectSourcesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createServiceSupabaseClient();

  const [
    { data: projectData },
    { data: inputData },
    { data: artifactData },
    { data: stakeholderData },
    locale,
    t,
    tTypes,
  ] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("input_items")
      .select("*")
      .eq("project_id", id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    supabase.from("artifacts").select("id, type, version, source_input_ids, fields").eq("project_id", id),
    supabase.from("stakeholders").select("id, name, source_input_ids").eq("project_id", id),
    getLocale(),
    getTranslations("sourcesPage"),
    getTranslations("artifactTypes"),
  ]);
  if (!projectData) notFound();
  const project = projectData as ProjectRow;
  const inputs = (inputData ?? []) as InputItemRow[];
  const dateLocale = locale === "hu" ? "hu-HU" : "en-GB";
  const shortDate = (iso: string) =>
    new Date(iso).toLocaleDateString(dateLocale, {
      timeZone: "Europe/Budapest",
      month: "short",
      day: "numeric",
    });

  // Kanonikus [n]: a workspace számozásával azonos (created_at, id).
  const indexOfId = new Map(inputs.map((row, i) => [row.id, i + 1]));
  const idOfIndex = new Map(inputs.map((row, i) => [i + 1, row.id]));

  // ── Fordított aggregáció: melyik deliverable / stakeholder hivatkozik egy inputra ──
  type ArtRow = Pick<ArtifactRow, "id" | "type" | "version" | "source_input_ids" | "fields">;
  const artifacts = (artifactData ?? []) as ArtRow[];

  // Deliverable-típusonként: a legfrissebb verzió (link-cél) + a hivatkozott
  // input-id-k uniója az összes verzión át.
  const typeHead = new Map<string, { headId: string; version: number; inputIds: Set<string> }>();
  for (const a of artifacts) {
    const referenced = new Set<string>(a.source_input_ids ?? []);
    const def = getTypeDef(a.type);
    if (def) {
      const fields = parseArtifactFields(def, a.fields);
      for (const fv of Object.values(fields)) {
        for (const n of fv.source_indices) {
          const inputId = idOfIndex.get(n);
          if (inputId) referenced.add(inputId);
        }
      }
    }
    const entry = typeHead.get(a.type);
    if (!entry) {
      typeHead.set(a.type, { headId: a.id, version: a.version, inputIds: referenced });
    } else {
      if (a.version >= entry.version) {
        entry.headId = a.id;
        entry.version = a.version;
      }
      for (const rid of referenced) entry.inputIds.add(rid);
    }
  }

  const artifactLabel = (type: string): string => {
    const def = getTypeDef(type);
    return def ? tTypes(def.nameKey.replace(/^artifactTypes\./, "")) : type;
  };

  // Stakeholderek: forrás-hozzárendelés (a stakeholder source_input_ids-ében az
  // input) VAGY „tőle jött" (az input stakeholder_source_id-ja a stakeholder).
  type StkRow = Pick<StakeholderRow, "id" | "name" | "source_input_ids">;
  const stakeholders = (stakeholderData ?? []) as StkRow[];

  // input → chipek (az input stakeholder_source_id-ja is számít).
  function referencesFor(input: InputItemRow): ReferenceChip[] {
    const chips: ReferenceChip[] = [];
    for (const [type, entry] of typeHead) {
      if (entry.inputIds.has(input.id)) {
        chips.push({
          key: `art:${type}`,
          kind: "artifact",
          label: artifactLabel(type),
          href: `/project/${id}/artifact/${entry.headId}`,
        });
      }
    }
    for (const s of stakeholders) {
      const linked =
        (s.source_input_ids ?? []).includes(input.id) ||
        input.stakeholder_source_id === s.id;
      if (linked) {
        chips.push({
          key: `stk:${s.id}`,
          kind: "stakeholder",
          label: s.name,
          href: `/project/${id}/stakeholder/${s.id}`,
        });
      }
    }
    return chips;
  }

  const rows: SourceRow[] = inputs.map((input) => {
    const references = referencesFor(input);
    return {
      id: input.id,
      index: indexOfId.get(input.id) ?? 0,
      title: input.type,
      kind: deriveSourceKind(input.type),
      fileBadge: deriveFileBadge(input.type),
      phase: input.phase,
      dateLabel: shortDate(input.created_at),
      isoDate: input.created_at,
      preview: previewLine(input.raw_text),
      content: input.raw_text,
      wordCount: wordCount(input.raw_text),
      refCount: references.length,
      references,
    };
  });

  return (
    <div className="space-y-4">
      <div>
        <p className="font-mono text-mono-sm text-ink-tertiary">{project.name}</p>
        <h1 className="mt-0.5 text-title">{t("title")}</h1>
        <p className="mt-1 text-body text-ink-secondary">{t("lead")}</p>
      </div>

      {rows.length === 0 ? (
        <div className="surface-card px-4 py-8 text-center text-body text-ink-tertiary">
          {t("empty")}
        </div>
      ) : (
        <SourcesLibrary projectName={project.name} rows={rows} />
      )}
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import {
  completeness,
  getTypeDef,
  missingRequiredFields,
  parseArtifactFields,
  unconfirmedFields,
} from "@/lib/artifacts/config";
import { StatusChain } from "@/components/StatusChain";
import {
  ArtifactEditor,
  type EditorField,
  type EditorSource,
} from "@/components/ArtifactEditor";
import { StatusPill } from "@/components/StatusPill";
import type { ArtifactRow, InputItemRow, ProjectRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Artefaktum-szerkesztő oldal (design 1f). A mező-munka a ② zónában él;
// itt: mező-panel (olvasó) + body (draft: szerkeszthető) + számozott
// források kattintható [n] citációkkal. Approved: immutábilis olvasó nézet.
// ─────────────────────────────────────────────────────────────

export default async function ArtifactEditorPage({
  params,
}: {
  params: Promise<{ id: string; artifactId: string }>;
}) {
  const { id, artifactId } = await params;
  const supabase = createServiceSupabaseClient();

  const [{ data: projectData }, { data: artifactData }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("artifacts")
      .select("*")
      .eq("id", artifactId)
      .eq("project_id", id)
      .maybeSingle(),
  ]);
  if (!projectData || !artifactData) notFound();
  const project = projectData as ProjectRow;
  const artifact = artifactData as ArtifactRow;

  // Ismeretlen (konfig nélküli, pl. örökség-) típus: az oldal nem törik —
  // mező-panel nélkül, olvasó/szerkesztő body-val renderel.
  const typeDef = getTypeDef(artifact.type);

  // Számozott források: az artefaktumon rögzített sorrend (source_input_ids);
  // ha üres, a projekt összes bemenete a stabil (created_at, id) sorrendben.
  let sources: EditorSource[] = [];
  if (artifact.source_input_ids.length > 0) {
    const { data } = await supabase
      .from("input_items")
      .select("*")
      .in("id", artifact.source_input_ids);
    const byId = new Map(((data ?? []) as InputItemRow[]).map((r) => [r.id, r]));
    sources = artifact.source_input_ids
      .map((sid, i) => {
        const row = byId.get(sid);
        return row ? { index: i + 1, title: row.type, text: row.raw_text } : null;
      })
      .filter((s): s is EditorSource => s !== null);
  } else {
    const { data } = await supabase
      .from("input_items")
      .select("*")
      .eq("project_id", id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    sources = ((data ?? []) as InputItemRow[]).map((row, i) => ({
      index: i + 1,
      title: row.type,
      text: row.raw_text,
    }));
  }

  const [locale, tEditor, tArtifacts] = await Promise.all([
    getLocale(),
    getTranslations("editor"),
    getTranslations("artifacts"),
  ]);
  const tFields = await getTranslations("fields");
  const dateLocale = locale === "hu" ? "hu-HU" : "en-GB";

  const parsedFields = typeDef ? parseArtifactFields(typeDef, artifact.fields) : null;
  const editorFields: EditorField[] =
    typeDef && parsedFields
      ? typeDef.fields.map((fieldDef) => ({
          key: fieldDef.key,
          label: tFields(fieldDef.labelKey.replace(/^fields\./, "")),
          required: fieldDef.required,
          value: parsedFields[fieldDef.key].value,
          state: parsedFields[fieldDef.key].state,
          sourceIndices: parsedFields[fieldDef.key].source_indices,
        }))
      : [];
  const done =
    typeDef && parsedFields
      ? completeness(typeDef, parsedFields)
      : { filled: 0, required: 0 };
  const fieldLabel = (labelKey: string) => tFields(labelKey.replace(/^fields\./, ""));
  const missingRequiredLabels =
    typeDef && parsedFields
      ? missingRequiredFields(typeDef, parsedFields).map((f) => fieldLabel(f.labelKey))
      : [];
  const unconfirmedLabels =
    typeDef && parsedFields
      ? unconfirmedFields(typeDef, parsedFields).map((f) => fieldLabel(f.labelKey))
      : [];

  const backHref = typeDef
    ? `/project/${id}/phase/${typeDef.phase}`
    : `/project/${id}`;

  return (
    <div className="space-y-6">
      {/* Fejléc */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={backHref}
            className="text-mono-sm text-ink-tertiary hover:text-ink-secondary hover:underline"
          >
            ← {project.name}
            {typeDef ? ` · ${typeDef.phase}` : ""}
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-title">
            {artifact.type}
            <span className="font-mono text-body text-ink-tertiary">
              v{artifact.version}
            </span>
            <StatusPill
              variant={artifact.status}
              label={tArtifacts(`status.${artifact.status}`)}
            />
          </h1>
          <p className="mt-0.5 text-mono-sm text-ink-tertiary">
            {tEditor("updatedAt", {
              date: new Date(artifact.updated_at ?? artifact.created_at).toLocaleString(
                dateLocale,
                { timeZone: "Europe/Budapest" },
              ),
            })}
          </p>
        </div>
      </div>

      {!typeDef && (
        <p className="rounded-tile border border-dashed border-line px-3 py-2 text-body text-ink-tertiary">
          {tEditor("noTypeDef", { type: artifact.type })}
        </p>
      )}

      {/* Státusz-lánc: Draft → In review → Approved (+ Új verzió) */}
      <StatusChain
        projectId={id}
        artifactId={artifact.id}
        status={artifact.status}
        missingRequiredLabels={missingRequiredLabels}
        unconfirmedLabels={unconfirmedLabels}
      />

      {/* Split-view (1f) */}
      <ArtifactEditor
        projectId={id}
        artifactId={artifact.id}
        fields={editorFields}
        filled={done.filled}
        requiredCount={done.required}
        body={artifact.body}
        editable={artifact.status === "draft"}
        sources={sources}
      />
    </div>
  );
}

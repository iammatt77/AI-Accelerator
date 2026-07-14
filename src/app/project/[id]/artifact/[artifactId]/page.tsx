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
import {
  ArtifactEditor,
  type EditorField,
  type EditorSource,
  type EditorVersion,
} from "@/components/ArtifactEditor";
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

  // Rövid dátumbélyeg a v2 források-panelhez („9 Jul" stílus, tz-biztos).
  const srcDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", {
      timeZone: "Europe/Budapest",
      day: "numeric",
      month: "short",
    });

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
      .map((sid, i): EditorSource | null => {
        const row = byId.get(sid);
        return row
          ? { index: i + 1, title: row.type, text: row.raw_text, date: srcDate(row.created_at) }
          : null;
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
      date: srcDate(row.created_at),
    }));
  }

  const [locale, tEditor, tArtifacts, tTypes, tFields, tHub] = await Promise.all([
    getLocale(),
    getTranslations("editor"),
    getTranslations("artifacts"),
    getTranslations("artifactTypes"),
    getTranslations("fields"),
    getTranslations("hub"),
  ]);
  const dateLocale = locale === "hu" ? "hu-HU" : "en-GB";
  const typeName = typeDef
    ? tTypes(typeDef.nameKey.replace(/^artifactTypes\./, ""))
    : artifact.type;

  // Minden verzió (a jobb-oldali VERSIONS-sávhoz + a fej-verzió eldöntéséhez).
  const { data: versionData } = await supabase
    .from("artifacts")
    .select("id, version, status, updated_at")
    .eq("project_id", id)
    .eq("type", artifact.type)
    .order("version", { ascending: false });
  const versionRows = (versionData ?? []) as Pick<
    ArtifactRow,
    "id" | "version" | "status" | "updated_at"
  >[];
  const headVersion = versionRows[0]?.version ?? artifact.version;
  const isHead = headVersion === artifact.version;
  const editorVersions: EditorVersion[] = versionRows.map((v) => ({
    id: v.id,
    version: v.version,
    status: v.status,
    statusLabel: tArtifacts(`status.${v.status}`),
    label: new Date(v.updated_at).toLocaleDateString(dateLocale, {
      timeZone: "Europe/Budapest",
      month: "short",
      day: "numeric",
    }),
    current: v.id === artifact.id,
  }));

  const parsedFields = typeDef ? parseArtifactFields(typeDef, artifact.fields) : null;
  const editorFields: EditorField[] =
    typeDef && parsedFields
      ? typeDef.fields.map((fieldDef) => ({
          key: fieldDef.key,
          label: tFields(fieldDef.labelKey.replace(/^fields\./, "")),
          required: fieldDef.required,
          field: parsedFields[fieldDef.key],
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
    <div className="space-y-4">
      {/* Fejléc — dokumentum-identitás (a státusz-folyam a szerkesztőben) */}
      <div>
        <Link
          href={backHref}
          className="text-mono-sm text-ink-tertiary hover:text-ink-secondary hover:underline"
        >
          ← {project.name}
          {typeDef ? ` · ${typeDef.phase} · ${tHub("documentsShort")}` : ""}
        </Link>
        <h1 className="mt-1 flex flex-wrap items-baseline gap-2 text-title">
          {typeName}
          <span className="font-mono text-body text-ink-tertiary">v{artifact.version}</span>
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

      {!typeDef && (
        <p className="rounded-tile border border-dashed border-line px-3 py-2 text-body text-ink-tertiary">
          {tEditor("noTypeDef", { type: artifact.type })}
        </p>
      )}

      {/* Redesign #1: három-panel szerkesztő (FIELD MAP · dokumentum · SOURCES/
          VERSIONS) + státusz-folyam + blokkoló-sáv. A funkció változatlan. */}
      <ArtifactEditor
        projectId={id}
        artifactId={artifact.id}
        status={artifact.status}
        isHead={isHead}
        fields={editorFields}
        filled={done.filled}
        requiredCount={done.required}
        body={artifact.body}
        editable={artifact.status === "draft"}
        sources={sources}
        missingRequiredLabels={missingRequiredLabels}
        unconfirmedLabels={unconfirmedLabels}
        versions={editorVersions}
        approvedDate={
          artifact.status === "approved"
            ? new Date(artifact.updated_at ?? artifact.created_at).toLocaleDateString(
                dateLocale,
                { timeZone: "Europe/Budapest" },
              )
            : null
        }
        phaseHref={backHref}
        exportHref={`/project/${id}/artifact/${artifact.id}/export`}
      />
    </div>
  );
}

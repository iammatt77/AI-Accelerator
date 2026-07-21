import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import {
  completeness,
  getTypeDef,
  isFilled,
  missingRequiredFields,
  parseArtifactFields,
} from "@/lib/artifacts/config";
import { parseBenefitCalc, parsePilotSuccess } from "@/lib/artifacts/p2";
import {
  ArtifactEditor,
  type EditorFieldData,
  type EditorSource,
  type EditorVersion,
} from "@/components/ArtifactEditor";
import { BenefitCalculator } from "@/components/BenefitCalculator";
import { PilotSuccessDefinition } from "@/components/PilotSuccessDefinition";
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

  const [locale, tEditor, tArtifacts, tTypes, tFields] = await Promise.all([
    getLocale(),
    getTranslations("editor"),
    getTranslations("artifacts"),
    getTranslations("artifactTypes"),
    getTranslations("fields"),
  ]);
  const tP2 = await getTranslations("p2");
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
  const editorFields: EditorFieldData[] =
    typeDef && parsedFields
      ? typeDef.fields.map((fieldDef) => ({
          key: fieldDef.key,
          label: tFields(fieldDef.labelKey.replace(/^fields\./, "")),
          required: fieldDef.required,
          field: parsedFields[fieldDef.key],
          moduleOwned: fieldDef.moduleOwned,
        }))
      : [];
  const done =
    typeDef && parsedFields
      ? completeness(typeDef, parsedFields)
      : { filled: 0, required: 0 };
  const fieldLabel = (labelKey: string) => tFields(labelKey.replace(/^fields\./, ""));
  // ── P2-mélység (#9): strukturált mező-törzs a haszon-kalkulátorhoz és a
  // pilot sikerdefinícióhoz. A pilotnál a baseline + döntési szabály mezők
  // beolvadnak a „Sikerdefiníció" blokkba (kiszűrve az editor-listából; a
  // savePilot a value-szinkronnal tartja kitöltöttként). Más típus érintetlen. ──
  const isBenefit = typeDef?.key === "Business case";
  const isPilot = typeDef?.key === "Pilot-terv";
  const structuredFields: Record<string, React.ReactNode> = {};
  let displayFields = editorFields;
  if (isBenefit) {
    // A `key` a perzisztált strukturált adat aláírása: suggest/save után a
    // revalidate új prop-ot ad, de a kliens useState-je nem frissül magától —
    // az aláírás-váltás remountot kényszerít, így a mentett/javasolt értékek
    // láthatóvá válnak. Gépelés (nincs szerver-kör) nem változtatja az aláírást,
    // így a beírt érték nem vész el.
    const benefitCalc = parseBenefitCalc(artifact.benefit_calc);
    structuredFields["haszon_szamitas"] = (
      <BenefitCalculator
        key={`bc-${JSON.stringify(benefitCalc)}`}
        projectId={id}
        artifactId={artifact.id}
        calc={benefitCalc}
        editable={artifact.status === "draft"}
      />
    );
  }
  if (isPilot) {
    displayFields = editorFields
      .filter((f) => f.key !== "baseline" && f.key !== "dontesi_szabaly")
      .map((f) =>
        f.key === "szamszeru_kuszob" ? { ...f, label: tP2("pilotTitle") } : f,
      );
    const pilotSuccess = parsePilotSuccess(artifact.pilot_success);
    structuredFields["szamszeru_kuszob"] = (
      <PilotSuccessDefinition
        key={`pt-${JSON.stringify(pilotSuccess)}`}
        projectId={id}
        artifactId={artifact.id}
        pilot={pilotSuccess}
        editable={artifact.status === "draft"}
      />
    );
  }
  // Az editor fejléc-számlálója és a hiányzó-címkék a MEGJELENÍTETT mezőkből
  // (a P2-nél a subsumált mezők egyetlen Sikerdefiníció-sorrá olvadnak).
  const editorRequiredCount = displayFields.filter((f) => f.required).length;
  const editorMissingLabels = displayFields
    .filter((f) => f.required && !isFilled(f.field))
    .map((f) => f.label);
  const useP2 = isBenefit || isPilot;

  const missingRequiredLabels =
    typeDef && parsedFields
      ? missingRequiredFields(typeDef, parsedFields).map((f) => fieldLabel(f.labelKey))
      : [];

  // A HITL-lábléc „Utolsó mentés"-bélyege (tz-biztos, rövid forma).
  const savedAtLabel = new Date(artifact.updated_at ?? artifact.created_at).toLocaleDateString(
    dateLocale,
    { timeZone: "Europe/Budapest", month: "short", day: "numeric" },
  );

  // Csomag A (A1): az utolsó modul-szinkron bélyege a read-only modul-mezőkhöz.
  const syncedAtLabel = artifact.synced_at
    ? new Date(artifact.synced_at).toLocaleString(dateLocale, {
        timeZone: "Europe/Budapest",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const backHref = typeDef
    ? `/project/${id}/phase/${typeDef.phase}`
    : `/project/${id}`;

  return (
    <div className="space-y-4">
      {!typeDef && (
        <p className="rounded-tile border border-dashed border-line px-3 py-2 text-body text-ink-tertiary">
          {tEditor("noTypeDef", { type: artifact.type })}
        </p>
      )}

      {/* Master 5 v3: egy tömör konténer — fejléc (azonosság + státuszlánc) →
          összefoglaló sáv + Szerkesztés/Előnézet váltó → mező-accordion vagy
          mezőkből komponált előnézet → HITL-lábléc. */}
      <ArtifactEditor
        projectId={id}
        artifactId={artifact.id}
        status={artifact.status}
        isHead={isHead}
        fields={displayFields}
        requiredCount={useP2 ? editorRequiredCount : done.required}
        body={artifact.body}
        editable={artifact.status === "draft"}
        sources={sources}
        missingRequiredLabels={useP2 ? editorMissingLabels : missingRequiredLabels}
        versions={editorVersions}
        structuredFields={structuredFields}
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
        clientName={project.name}
        phaseLabel={typeDef ? typeDef.phase : ""}
        typeName={typeName}
        version={artifact.version}
        inputsCount={sources.length}
        nextVersion={headVersion + 1}
        savedAtLabel={savedAtLabel}
        syncedAtLabel={syncedAtLabel}
      />
    </div>
  );
}

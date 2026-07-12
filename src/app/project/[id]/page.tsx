import Link from "next/link";
import { notFound } from "next/navigation";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { saveDraftBody, approveArtifact } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { InputForm } from "@/components/InputForm";
import { GenerateForm } from "@/components/GenerateForm";
import type {
  ArtifactRow,
  ClientRow,
  InputItemRow,
  ProjectRow,
} from "@/lib/db/types";

export const dynamic = "force-dynamic";

interface ProjectWithClient extends ProjectRow {
  clients: ClientRow | null;
}

async function loadWorkspace(projectId: string) {
  const supabase = createServiceSupabaseClient();

  const { data: project } = await supabase
    .from("projects")
    .select("*, clients ( * )")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) return null;

  const [{ data: inputs }, { data: artifacts }] = await Promise.all([
    supabase
      .from("input_items")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    supabase
      .from("artifacts")
      .select("*")
      .eq("project_id", projectId)
      .order("version", { ascending: false }),
  ]);

  return {
    project: project as ProjectWithClient,
    inputs: (inputs ?? []) as InputItemRow[],
    artifacts: (artifacts ?? []) as ArtifactRow[],
  };
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadWorkspace(id);
  if (!data) notFound();

  const { project, inputs, artifacts } = data;

  // A megjelenítendő artefaktum: a legmagasabb verziójú (a lista már verzió szerint
  // csökkenő). A bal panel szerkeszthető, ha draft.
  const current = artifacts[0] ?? null;
  const inputsById = new Map(inputs.map((i) => [i.id, i]));
  const sourceInputs =
    current && current.source_input_ids.length > 0
      ? current.source_input_ids
          .map((sid) => inputsById.get(sid))
          .filter((i): i is InputItemRow => Boolean(i))
      : inputs;

  return (
    <div className="space-y-8">
      {/* Fejléc */}
      <div>
        <Link href="/" className="text-xs text-[var(--muted)] hover:underline">
          ← Projektek
        </Link>
        <h1 className="mt-2 text-lg font-semibold">{project.name}</h1>
        <p className="text-sm text-[var(--muted)]">
          {project.clients?.name ?? "ismeretlen ügyfél"}
          {project.clients?.industry ? ` · ${project.clients.industry}` : ""}
          {project.package ? ` · ${project.package}` : ""}
        </p>
      </div>

      {/* (b) Nyers szöveg beillesztése + (c) Draft generálása */}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="text-sm font-semibold">Bemenet & generálás</h2>

        <InputForm projectId={id} />

        <GenerateForm
          projectId={id}
          inputsCount={inputs.length}
          artifactsCount={artifacts.length}
        />
      </section>

      {/* (d) SPLIT-VIEW: bal = draft body (szerkeszthető), jobb = forrás */}
      <section className="grid gap-6 lg:grid-cols-2">
        {/* Bal: draft */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Draft</h2>
            {current && <StatusBadge status={current.status} version={current.version} />}
          </div>

          {!current && (
            <p className="text-sm text-[var(--muted)]">
              Még nincs artefaktum. Adj hozzá bemenetet, majd generálj draftot.
            </p>
          )}

          {current && current.status === "draft" && (
            <div className="space-y-3">
              {/* Szerkesztés + helyben mentés */}
              <form
                action={saveDraftBody.bind(null, id, current.id)}
                className="space-y-3"
              >
                <textarea
                  name="body"
                  rows={16}
                  defaultValue={current.body}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--accent)]"
                />
                <div className="flex flex-wrap gap-3">
                  <SubmitButton variant="secondary" pendingLabel="Mentés…">
                    Draft mentése
                  </SubmitButton>
                </div>
              </form>

              {/* (e) Jóváhagyás: a legfrissebb body-val, version+1 */}
              <form
                action={approveArtifact.bind(null, id, current.id)}
                className="border-t border-[var(--border)] pt-3"
              >
                <input type="hidden" name="body" value={current.body} />
                <SubmitButton pendingLabel="Jóváhagyás…">
                  Jóváhagyás (Draft → Approved)
                </SubmitButton>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  A jóváhagyás új verziót ment; a draft megmarad az audithoz.
                  (Előbb mentsd a szerkesztést, ha módosítottál.)
                </p>
              </form>
            </div>
          )}

          {current && current.status !== "draft" && (
            <pre className="whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--background)] p-3 text-sm">
              {current.body}
            </pre>
          )}
        </div>

        {/* Jobb: forrás input_item(ek) */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
          <h2 className="mb-3 text-sm font-semibold">Forrás bemenetek</h2>
          {sourceInputs.length === 0 && (
            <p className="text-sm text-[var(--muted)]">Nincs forrás bemenet.</p>
          )}
          <ul className="space-y-3">
            {sourceInputs.map((input) => (
              <li
                key={input.id}
                className="rounded-md border border-[var(--border)] bg-[var(--background)] p-3"
              >
                <div className="mb-1 text-xs text-[var(--muted)]">
                  {input.type} · {new Date(input.created_at).toLocaleString("hu-HU")}
                </div>
                <pre className="whitespace-pre-wrap text-sm">{input.raw_text}</pre>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Verziótörténet */}
      {artifacts.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Verziótörténet</h2>
          <ul className="space-y-2">
            {artifacts.map((artifact) => (
              <li
                key={artifact.id}
                className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-sm"
              >
                <span>
                  v{artifact.version} · {artifact.type}
                </span>
                <span className="flex items-center gap-3 text-[var(--muted)]">
                  <StatusBadge status={artifact.status} />
                  {new Date(artifact.created_at).toLocaleString("hu-HU")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StatusBadge({
  status,
  version,
}: {
  status: ArtifactRow["status"];
  version?: number;
}) {
  const label: Record<ArtifactRow["status"], string> = {
    draft: "Draft",
    in_review: "Review",
    approved: "Approved",
  };
  const color: Record<ArtifactRow["status"], string> = {
    draft: "border-amber-500/40 text-amber-600 dark:text-amber-400",
    in_review: "border-blue-500/40 text-blue-600 dark:text-blue-400",
    approved: "border-green-500/40 text-green-600 dark:text-green-400",
  };
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs ${color[status]}`}
    >
      {label[status]}
      {version ? ` · v${version}` : ""}
    </span>
  );
}

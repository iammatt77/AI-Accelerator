import Link from "next/link";
import { notFound } from "next/navigation";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { saveDraftBody, approveArtifact } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { InputForm } from "@/components/InputForm";
import { GenerateForm } from "@/components/GenerateForm";
import { StatusPill } from "@/components/StatusPill";
import type {
  ArtifactRow,
  ClientRow,
  InputItemRow,
  ProjectRow,
} from "@/lib/db/types";

export const dynamic = "force-dynamic";

// Az artefaktum-státusz feliratok mindkét UI-nyelven angolul maradnak
// (terminus technicus).
const STATUS_LABEL: Record<ArtifactRow["status"], string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
};

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

  // A megjelenítendő artefaktum: a legmagasabb verziójú (a lista már verzió
  // szerint csökkenő). A bal panel szerkeszthető, ha draft.
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
        <Link
          href="/"
          className="text-mono-sm text-ink-tertiary hover:text-ink-secondary hover:underline"
        >
          ← Projektek
        </Link>
        <h1 className="mt-2 text-title">{project.name}</h1>
        <p className="text-body text-ink-secondary">
          {project.clients?.name ?? "ismeretlen ügyfél"}
          {project.clients?.industry ? ` · ${project.clients.industry}` : ""}
          {project.package ? ` · ${project.package}` : ""}
        </p>
      </div>

      {/* (b) Nyers szöveg beillesztése + (c) Draft generálása */}
      <section className="glass-tile p-5">
        <h2 className="text-body font-semibold">Bemenet & generálás</h2>
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
        <div className="glass-tile p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-body font-semibold">Draft</h2>
            {current && (
              <StatusPill
                variant={current.status}
                label={`${STATUS_LABEL[current.status]} · v${current.version}`}
              />
            )}
          </div>

          {!current && (
            <p className="text-body text-ink-tertiary">
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
                  className="w-full rounded-control border border-line bg-surface px-3 py-2 font-mono text-mono-sm"
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
                className="border-t border-line pt-3"
              >
                <input type="hidden" name="body" value={current.body} />
                <SubmitButton pendingLabel="Jóváhagyás…">
                  Jóváhagyás (Draft → Approved)
                </SubmitButton>
                <p className="mt-2 text-mono-sm text-ink-tertiary">
                  A jóváhagyás új verziót ment; a draft megmarad az audithoz.
                  (Előbb mentsd a szerkesztést, ha módosítottál.)
                </p>
              </form>
            </div>
          )}

          {current && current.status !== "draft" && (
            <pre className="card-sunken whitespace-pre-wrap p-3 font-sans text-body">
              {current.body}
            </pre>
          )}
        </div>

        {/* Jobb: forrás input_item(ek) — öröklött kontextus: süllyesztett kártya */}
        <div className="glass-tile p-5">
          <h2 className="mb-3 text-body font-semibold">Forrás bemenetek</h2>
          {sourceInputs.length === 0 && (
            <p className="text-body text-ink-tertiary">Nincs forrás bemenet.</p>
          )}
          <ul className="space-y-3">
            {sourceInputs.map((input) => (
              <li key={input.id} className="card-sunken p-3">
                <div className="mb-1 text-mono-sm text-ink-tertiary">
                  {input.type} · {new Date(input.created_at).toLocaleString("hu-HU")}
                </div>
                <pre className="whitespace-pre-wrap font-sans text-body">
                  {input.raw_text}
                </pre>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Verziótörténet */}
      {artifacts.length > 0 && (
        <section>
          <h2 className="mb-3 text-body font-semibold">Verziótörténet</h2>
          <ul className="space-y-2">
            {artifacts.map((artifact) => (
              <li
                key={artifact.id}
                className="flex items-center justify-between rounded-tile border border-line bg-surface px-4 py-2 text-body shadow-tile-sm"
              >
                <span>
                  v{artifact.version} · {artifact.type}
                </span>
                <span className="flex items-center gap-3 text-ink-tertiary">
                  <StatusPill
                    variant={artifact.status}
                    label={STATUS_LABEL[artifact.status]}
                  />
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

import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import {
  completeness,
  missingRequiredFields,
  parseArtifactFields,
  typesForPhase,
  type ArtifactTypeDef,
} from "@/lib/artifacts/config";
import { PHASE_IDS, type PhaseId } from "@/lib/phases/config";
import { StatusPill } from "@/components/StatusPill";
import type { ArtifactRow, ClientRow, ProjectRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Projektdokumentáció tár (Coding-csomag #5b) — deliverable-központú:
// EGY SOR = EGY ARTEFAKTUM-TÍPUS, fázis-szekciókban (P0→P6).
// A hub-képernyő a design-nyelvből származtatva (1c komponensek +
// 1d kártya-minták + a hét törvény) — dedikált mockup nincs.
//
// Jövő-kompatibilitás (session-döntés): a placeholder-sorok a későbbi
// „részlegesen töltött, mindig létező draft" modell fogadó-vázát adják —
// v1-ben READ-ONLY előkészítés, DB-sort NEM hozunk létre.
// ─────────────────────────────────────────────────────────────

interface ProjectWithClient extends ProjectRow {
  clients: ClientRow | null;
}

export default async function DocumentsHubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createServiceSupabaseClient();

  const [{ data: projectData }, { data: artifactData }] = await Promise.all([
    supabase.from("projects").select("*, clients ( * )").eq("id", id).maybeSingle(),
    supabase
      .from("artifacts")
      .select("*")
      .eq("project_id", id)
      .order("version", { ascending: false }),
  ]);
  if (!projectData) notFound();
  const project = projectData as ProjectWithClient;
  const artifacts = (artifactData ?? []) as ArtifactRow[];

  // Típusonként csoportosítva (verzió-csökkenő sorrend a lekérdezésből).
  const byType = new Map<string, ArtifactRow[]>();
  for (const artifact of artifacts) {
    const list = byType.get(artifact.type) ?? [];
    list.push(artifact);
    byType.set(artifact.type, list);
  }

  const [locale, tHub, tPhases, tTypes, tFields, tArtifacts, tWs, tCockpit] =
    await Promise.all([
      getLocale(),
      getTranslations("hub"),
      getTranslations("phases"),
      getTranslations("artifactTypes"),
      getTranslations("fields"),
      getTranslations("artifacts"),
      getTranslations("workspace"),
      getTranslations("cockpit"),
    ]);
  const dateLocale = locale === "hu" ? "hu-HU" : "en-GB";
  const dateOptions = { timeZone: "Europe/Budapest" } as const;
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(dateLocale, dateOptions);
  const typeName = (typeDef: ArtifactTypeDef) =>
    tTypes(typeDef.nameKey.replace(/^artifactTypes\./, ""));
  const fieldLabel = (labelKey: string) => tFields(labelKey.replace(/^fields\./, ""));
  const statusLabel = (status: ArtifactRow["status"]) => tArtifacts(`status.${status}`);

  // Ad-hoc (konfigon kívüli) típusok: adat nem tűnhet el a nézetből.
  // A fázisuk a konfig hiányában ismeretlen → külön szekcióba kerülnek.
  const configuredKeys = new Set(
    PHASE_IDS.flatMap((phase) => typesForPhase(phase).map((typeDef) => typeDef.key)),
  );
  const adhocTypes = [...byType.keys()].filter((key) => !configuredKeys.has(key));

  // ── Sor-komponensek (szerver-oldali; kibontás natív <details>-szel) ──

  function VersionHistory({ versions }: { versions: ArtifactRow[] }) {
    return (
      <details className="mt-2">
        <summary className="cursor-pointer text-mono-sm text-ink-secondary hover:text-ink">
          {tHub("versionsToggle", { count: versions.length })}
        </summary>
        <ul className="mt-2 space-y-1.5">
          {versions.map((artifact) => (
            <li
              key={artifact.id}
              className="card-sunken flex flex-wrap items-center justify-between gap-2 px-3 py-1.5"
            >
              <span className="flex items-center gap-2">
                <span className="font-mono text-mono-sm text-ink-secondary">
                  v{artifact.version}
                </span>
                <StatusPill
                  variant={artifact.status}
                  label={statusLabel(artifact.status)}
                />
              </span>
              <span className="flex items-center gap-3 text-mono-sm text-ink-tertiary">
                {formatDate(artifact.updated_at ?? artifact.created_at)}
                <Link
                  href={`/project/${id}/artifact/${artifact.id}`}
                  className="text-ink-secondary hover:text-ink hover:underline"
                >
                  {tHub("openCta")}
                </Link>
                {artifact.status === "approved" && (
                  <a
                    href={`/project/${id}/artifact/${artifact.id}/export`}
                    className="text-ink-secondary hover:text-ink hover:underline"
                  >
                    {tHub("exportCta")}
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
      </details>
    );
  }

  function DeliverableRow({
    phase,
    typeDef,
    typeKey,
    versions,
  }: {
    phase: PhaseId | null;
    typeDef: ArtifactTypeDef | null;
    typeKey: string;
    versions: ArtifactRow[];
  }) {
    const head = versions[0] ?? null;

    // Placeholder-sor: konfigurált, de el nem kezdett deliverable —
    // DB-sor NÉLKÜL (a későbbi always-existing-draft modell fogadó-váza).
    if (!head) {
      return (
        <div className="rounded-tile border border-dashed border-line px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              {phase && (
                <span className="rounded-pill border border-line bg-surface px-1.5 py-px font-mono text-[10px] text-ink-secondary">
                  {phase}
                </span>
              )}
              <span className="text-body font-medium text-ink-secondary">
                {typeDef ? typeName(typeDef) : typeKey}
              </span>
              <span className="text-mono-sm text-ink-tertiary">
                {tHub("notStarted")}
              </span>
            </span>
            {phase && (
              <Link
                href={`/project/${id}/phase/${phase}`}
                className="rounded-control border border-line bg-surface px-3 py-1.5 text-body font-medium shadow-tile-sm transition-colors duration-[var(--motion-base)] hover:bg-sunken"
              >
                {tCockpit("workspaceCta", { phase })}
              </Link>
            )}
          </div>
        </div>
      );
    }

    const fields = typeDef ? parseArtifactFields(typeDef, head.fields) : null;
    const done = typeDef && fields ? completeness(typeDef, fields) : null;
    const missing =
      typeDef && fields
        ? missingRequiredFields(typeDef, fields).map((f) => fieldLabel(f.labelKey))
        : [];
    const latestApproved = versions.find((v) => v.status === "approved") ?? null;

    return (
      <div className="glass-tile px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            {phase && (
              <span className="rounded-pill border border-line bg-surface px-1.5 py-px font-mono text-[10px] text-ink-secondary">
                {phase}
              </span>
            )}
            <span className="text-body font-semibold">
              {typeDef ? typeName(typeDef) : typeKey}
            </span>
            <span className="font-mono text-mono-sm text-ink-tertiary">
              v{head.version}
            </span>
            <StatusPill variant={head.status} label={statusLabel(head.status)} />
            {/* Teljesség: konfigurált típusnál x/y; ad-hoc típusnál „—" */}
            <span
              className="rounded-pill border border-line bg-surface px-2 py-0.5 font-mono text-mono-sm text-ink-secondary"
              title={
                missing.length > 0
                  ? tHub("missingFields", { fields: missing.join(", ") })
                  : undefined
              }
            >
              {done
                ? tWs("completeness", done)
                : tHub("completenessUnknown")}
            </span>
          </span>
          <span className="flex items-center gap-3">
            <span className="text-mono-sm text-ink-tertiary">
              {formatDate(head.updated_at ?? head.created_at)}
            </span>
            <Link
              href={`/project/${id}/artifact/${head.id}`}
              className="rounded-control border border-line bg-surface px-3 py-1.5 text-body font-medium shadow-tile-sm transition-colors duration-[var(--motion-base)] hover:bg-sunken"
            >
              {tHub("openCta")}
            </Link>
            {latestApproved && (
              <a
                href={`/project/${id}/artifact/${latestApproved.id}/export`}
                className="rounded-control border border-line bg-surface px-3 py-1.5 text-body font-medium shadow-tile-sm transition-colors duration-[var(--motion-base)] hover:bg-sunken"
              >
                {tHub("exportCta")}
              </a>
            )}
          </span>
        </div>

        {/* Hiányzó kötelező mezők NÉV SZERINT — „mi hiányzik a készhez"
            hub-szinten (a tooltip mellett inline is, mindig elérhetően) */}
        {missing.length > 0 && (
          <p className="mt-1.5 text-mono-sm text-gate">
            {tHub("missingFields", { fields: missing.join(", ") })}
          </p>
        )}

        <VersionHistory versions={versions} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Fejléc + breadcrumb (a meglévő mintával konzisztens) */}
      <div>
        <Link
          href={`/project/${id}`}
          className="text-mono-sm text-ink-tertiary hover:text-ink-secondary hover:underline"
        >
          ← {project.name}
        </Link>
        <h1 className="mt-1 text-title">{tHub("title")}</h1>
        <p className="mt-0.5 text-body text-ink-secondary">{tHub("lead")}</p>
      </div>

      {/* Fázis-szekciók P0→P6 */}
      {PHASE_IDS.map((phase) => {
        const configured = typesForPhase(phase);
        return (
          <section key={phase}>
            <h2 className="mb-2 flex items-center gap-2 text-body font-semibold">
              <span className="font-mono text-ink-tertiary">{phase}</span>
              {tPhases(`${phase.toLowerCase()}.short`)}
            </h2>
            {configured.length === 0 ? (
              // 1c: halk üres állapot — a fázisnak még nincs konfigurált
              // deliverable-je (a #6+ típusai töltik fel)
              <p className="rounded-tile border border-dashed border-line px-4 py-3 text-body text-ink-tertiary">
                {tHub("emptyPhase")}
              </p>
            ) : (
              <div className="space-y-2">
                {configured.map((typeDef) => (
                  <DeliverableRow
                    key={typeDef.key}
                    phase={phase}
                    typeDef={typeDef}
                    typeKey={typeDef.key}
                    versions={byType.get(typeDef.key) ?? []}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {/* Ad-hoc (konfigon kívüli) típusok — fázisuk ismeretlen, ezért
          külön szekcióban; adat nem tűnhet el a nézetből */}
      {adhocTypes.length > 0 && (
        <section>
          <h2 className="mb-2 text-body font-semibold text-ink-secondary">
            {tHub("adhocSection")}
          </h2>
          <div className="space-y-2">
            {adhocTypes.map((typeKey) => (
              <DeliverableRow
                key={typeKey}
                phase={null}
                typeDef={null}
                typeKey={typeKey}
                versions={byType.get(typeKey) ?? []}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

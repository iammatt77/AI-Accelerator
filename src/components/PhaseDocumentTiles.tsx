import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { StatusPill } from "@/components/StatusPill";
import type { PhaseDocTile } from "@/lib/artifacts/phase-tiles";

// ─────────────────────────────────────────────────────────────
// „Ebben a fázisban készült dokumentumok" — nagy csempék a fázis-oldalon
// (nyitott ÉS lezárt fázison egyaránt), a Projektdokumentáció tár
// típusonkénti sorával azonos adaton, csak nagyobb kártya-formában
// (rounded-shell — a Dashboard/Repository nagy kártyáinak mintája).
// Kattintásra ugyanoda navigál, ahova a tár „Megnyitás" gombja is —
// a MEGLÉVŐ artefaktum-olvasó/szerkesztő oldal nyílik, nincs új
// szerkesztő-logika.
// ─────────────────────────────────────────────────────────────

export async function PhaseDocumentTiles({
  projectId,
  tiles,
  blockingKeys,
}: {
  projectId: string;
  tiles: PhaseDocTile[];
  blockingKeys: Set<string>;
}) {
  if (tiles.length === 0) return null;

  const [tPhases, tHub, tTypes, tArtifacts] = await Promise.all([
    getTranslations("phases"),
    getTranslations("hub"),
    getTranslations("artifactTypes"),
    getTranslations("artifacts"),
  ]);

  return (
    <section>
      <h2 className="mb-3 text-body font-semibold">{tPhases("documentsTitle")}</h2>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => {
          const typeName = tTypes(tile.typeDef.nameKey.replace(/^artifactTypes\./, ""));

          if (!tile.head) {
            const blocks = blockingKeys.has(tile.key);
            return (
              <div
                key={tile.key}
                className="flex flex-col gap-2 rounded-shell border-[1.5px] border-dashed border-neutral-300 bg-soft p-4"
              >
                <span className="text-[13.5px] font-bold text-ink-secondary">{typeName}</span>
                <span className="text-[12px] text-ink-tertiary">
                  {blocks ? tHub("notStartedBlocks") : tHub("notStartedOptional")}
                </span>
              </div>
            );
          }

          const pct =
            tile.required > 0 ? Math.round((tile.filled / tile.required) * 100) : 100;

          return (
            <Link
              key={tile.key}
              href={`/project/${projectId}/artifact/${tile.head.id}`}
              className="flex flex-col gap-2.5 rounded-shell border border-line bg-surface p-4 shadow-card transition-shadow duration-[var(--motion-base)] hover:shadow-shell"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-[14px] font-bold tracking-tight">
                  {typeName}
                </span>
                <StatusPill
                  variant={tile.head.status}
                  label={tArtifacts(`status.${tile.head.status}`)}
                />
              </div>
              <div className="font-mono text-[11px] text-ink-tertiary">v{tile.head.version}</div>
              {tile.required > 0 && (
                <div>
                  <div className="flex h-1.5 overflow-hidden rounded-3 bg-neutral-100">
                    <span
                      className={tile.head.status === "approved" ? "bg-done" : "bg-gate"}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-1.5 text-[11.5px] text-ink-secondary">
                    {tile.filled}/{tile.required} {tHub("requiredFieldsShort")}
                  </div>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

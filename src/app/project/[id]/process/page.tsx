import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { GenerateFromInputPanel, SuggestToBePanel } from "@/components/ProcessGenPanels";
import { StatusPill } from "@/components/StatusPill";
import type { InputItemRow, ProcessMapRow, ProjectRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Folyamattérkép — belépő/index (#10): a projekt folyamattervei (AS-IS/TO-BE,
// verziónként) + a három generálás-belépő. A nyers leirat SOHA nem íródik
// felül — a generálás csak olvassa (E1: az AI javasol, az ember hagy jóvá).
// ─────────────────────────────────────────────────────────────

export default async function ProcessIndexPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createServiceSupabaseClient();

  const [{ data: projectData }, { data: mapData }, { data: inputData }, locale, t] =
    await Promise.all([
      supabase.from("projects").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("process_maps")
        .select("id, kind, title, status, version, to_be_origin, created_at")
        .eq("project_id", id)
        .order("kind", { ascending: true })
        .order("version", { ascending: false }),
      supabase
        .from("input_items")
        .select("id, type, created_at")
        .eq("project_id", id)
        .order("created_at", { ascending: true }),
      getLocale(),
      getTranslations("processMap"),
    ]);
  if (!projectData) notFound();
  const project = projectData as ProjectRow;
  const maps = (mapData ?? []) as Pick<
    ProcessMapRow,
    "id" | "kind" | "title" | "status" | "version" | "to_be_origin" | "created_at"
  >[];
  const inputs = (inputData ?? []) as Pick<InputItemRow, "id" | "type" | "created_at">[];
  const dateLocale = locale === "hu" ? "hu-HU" : "en-GB";
  const shortDate = (iso: string) =>
    new Date(iso).toLocaleDateString(dateLocale, {
      timeZone: "Europe/Budapest",
      month: "short",
      day: "numeric",
    });

  const inputOptions = inputs.map((i, idx) => ({ id: i.id, label: `[${idx + 1}] ${i.type}` }));
  const latestAsIs = maps.find((m) => m.kind === "as_is");
  const tArtifacts = await getTranslations("artifacts");

  const mapList = (kind: "as_is" | "to_be") => {
    const list = maps.filter((m) => m.kind === kind);
    if (list.length === 0) {
      return <p className="text-[12.5px] text-ink-tertiary">{t("indexEmpty")}</p>;
    }
    return (
      <div className="space-y-2">
        {list.map((m) => (
          <Link
            key={m.id}
            href={`/project/${id}/process/${m.id}`}
            className="flex items-center gap-3 rounded-tile border border-line bg-surface px-3.5 py-2.5 shadow-card-sm hover:shadow-card"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-bold">{m.title}</span>
              <span className="block font-mono text-[10.5px] text-ink-tertiary">
                v{m.version} · {shortDate(m.created_at)}
                {m.to_be_origin && (
                  <> · {m.to_be_origin === "ai_suggested" ? t("originAi") : t("originDoc")}</>
                )}
              </span>
            </span>
            <StatusPill variant={m.status} label={tArtifacts(`status.${m.status}`)} />
          </Link>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-mono-sm text-ink-tertiary">{project.name}</p>
        <h1 className="mt-0.5 text-title">{t("moduleTitle")}</h1>
        <p className="mt-1 max-w-[760px] text-body text-ink-secondary">{t("indexLead")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* AS-IS oszlop */}
        <section className="rounded-shell border border-line bg-surface p-5 shadow-card">
          <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
            {t("asisColTitle")}
          </h2>
          <p className="mb-3 mt-1 text-[12.5px] text-ink-secondary">{t("asisColLead")}</p>
          {mapList("as_is")}
          <div className="mt-4 border-t border-line-soft pt-4">
            {inputOptions.length === 0 ? (
              <p className="text-[12.5px] text-ink-tertiary">{t("noInputs")}</p>
            ) : (
              <GenerateFromInputPanel projectId={id} kind="as_is" inputs={inputOptions} />
            )}
          </div>
        </section>

        {/* TO-BE oszlop */}
        <section className="rounded-shell border border-line bg-surface p-5 shadow-card">
          <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
            {t("tobeColTitle")}
          </h2>
          <p className="mb-3 mt-1 text-[12.5px] text-ink-secondary">{t("tobeColLead")}</p>
          {mapList("to_be")}
          <div className="mt-4 space-y-4 border-t border-line-soft pt-4">
            <div>
              <p className="mb-2 text-[12px] font-semibold text-ink">✦ {t("tobeAiEntry")}</p>
              {latestAsIs ? (
                <SuggestToBePanel projectId={id} asIsMapId={latestAsIs.id} />
              ) : (
                <p className="text-[12px] text-ink-tertiary">{t("tobeAiNeedsAsis")}</p>
              )}
            </div>
            <div>
              <p className="mb-2 text-[12px] font-semibold text-ink">{t("tobeDocEntry")}</p>
              {inputOptions.length === 0 ? (
                <p className="text-[12px] text-ink-tertiary">{t("noInputs")}</p>
              ) : (
                <GenerateFromInputPanel projectId={id} kind="to_be" inputs={inputOptions} />
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

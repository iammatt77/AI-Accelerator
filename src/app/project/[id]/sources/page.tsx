import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { InputItemRow, ProjectRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

// Források (Master ◆ SIDEBAR nav-cél): a projekt összes nyersanyaga egy
// olvasó nézetben — [n] jelölés, fázis-címke, dátum. Csak megjelenítés a
// meglévő input_items adatból; a felvétel a fázis-munkafelület Input
// zónájában történik (nincs új akció).

export default async function ProjectSourcesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createServiceSupabaseClient();

  const [{ data: projectData }, { data: inputData }, locale, t] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("input_items")
      .select("*")
      .eq("project_id", id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    getLocale(),
    getTranslations("sourcesPage"),
  ]);
  if (!projectData) notFound();
  const project = projectData as ProjectRow;
  const inputs = (inputData ?? []) as InputItemRow[];
  const dateLocale = locale === "hu" ? "hu-HU" : "en-GB";

  return (
    <div className="space-y-4">
      <div>
        <p className="font-mono text-mono-sm text-ink-tertiary">{project.name}</p>
        <h1 className="mt-0.5 text-title">{t("title")}</h1>
        <p className="mt-1 text-body text-ink-secondary">{t("lead")}</p>
      </div>

      {inputs.length === 0 ? (
        <div className="surface-card px-4 py-8 text-center text-body text-ink-tertiary">
          {t("empty")}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {inputs.map((input, i) => (
            <li key={input.id} className="surface-card p-4">
              <div className="flex items-center gap-2.5">
                <span className="shrink-0 font-mono text-mono-sm font-bold text-pivot">
                  [{i + 1}]
                </span>
                <span className="min-w-0 flex-1 truncate text-body font-semibold">
                  {input.type}
                </span>
                {input.phase && (
                  <span className="shrink-0 rounded-3 bg-neutral-150 px-1.5 py-px font-mono text-[10px] text-ink-secondary">
                    {input.phase}
                  </span>
                )}
                <span className="shrink-0 font-mono text-mono-sm text-ink-tertiary">
                  {new Date(input.created_at).toLocaleDateString(dateLocale, {
                    timeZone: "Europe/Budapest",
                  })}
                </span>
              </div>
              <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-body text-ink-secondary">
                {input.raw_text}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

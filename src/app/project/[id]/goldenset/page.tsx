import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { GoldenSetBoard } from "@/components/GoldenSetBoard";
import { loadNumberedSources, inputIdsToIndices } from "@/lib/sources";
import { getTypeDef, parseArtifactFields } from "@/lib/artifacts/config";
import type {
  ArtifactRow,
  EvalCaseRow,
  EvalCriterionRow,
  GoldenSetRow,
  ProjectRow,
  UseCaseRow,
} from "@/lib/db/types";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Golden set & Tesztriport (#14) — belépő: a P2-ben kiválasztott use case
// a horgony; nélküle a modul zárt (poka-yoke — nincs mire tesztkészletet
// építeni). A rendszer a megoldást NEM futtatja: a tényleges kimenetet a
// tanácsadó rögzíti, a Tesztriport a MEGLÉVŐ artifacts-láncon él.
// ─────────────────────────────────────────────────────────────

export default async function GoldenSetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("goldenset");
  const supabase = createServiceSupabaseClient();

  const [{ data: projectData }, { data: ucData }, { data: artData }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("use_cases")
      .select("*")
      .eq("project_id", id)
      .in("list_status", ["selected", "shortlist"])
      .order("created_at", { ascending: true }),
    supabase
      .from("artifacts")
      .select("*")
      .eq("project_id", id)
      .in("type", ["Tesztriport", "Megoldás-dokumentáció"])
      .order("version", { ascending: false }),
  ]);
  if (!projectData) notFound();
  const project = projectData as ProjectRow;

  // Use case-feloldás: selected előnyben, különben az első shortlist
  // (ugyanaz a szabály, mint az akciókban — resolveUseCase).
  const ucRows = ((ucData ?? []) as UseCaseRow[]).filter((u) => u.state !== "rejected");
  const useCase = ucRows.find((u) => u.list_status === "selected") ?? ucRows[0] ?? null;

  if (!useCase) {
    // Poka-yoke: kiválasztott use case nélkül nincs mit tesztelni.
    return (
      <main className="mx-auto flex w-full max-w-[900px] flex-col gap-4 px-6 py-10">
        <div className="flex flex-col items-center gap-3 rounded-shell border-[1.5px] border-dashed border-[#EADFC0] bg-tint-gate/40 px-6 py-10 text-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-shell bg-gate text-[16px] font-bold text-white">!</span>
          <h1 className="text-[17px] font-extrabold tracking-[-0.01em]">{t("noUseCaseTitle")}</h1>
          <p className="max-w-[520px] text-[13px] leading-[1.55] text-ink-secondary">{t("noUseCaseText")}</p>
          <Link
            href={`/project/${id}/phase/P1`}
            className="mt-1 rounded-control bg-action px-4 py-2 text-[12.5px] font-bold text-white"
          >
            {t("noUseCaseCta")} ↗
          </Link>
        </div>
      </main>
    );
  }

  const { data: setData } = await supabase
    .from("golden_sets")
    .select("*")
    .eq("use_case_id", useCase.id)
    .maybeSingle();
  const set = (setData as GoldenSetRow | null) ?? null;

  let cases: EvalCaseRow[] = [];
  let criteria: EvalCriterionRow[] = [];
  if (set) {
    const [{ data: caseData }, { data: critData }] = await Promise.all([
      supabase
        .from("eval_cases")
        .select("*")
        .eq("golden_set_id", set.id)
        .order("ord", { ascending: true }),
      supabase.from("eval_criteria").select("*").order("ord", { ascending: true }),
    ]);
    cases = (caseData ?? []) as EvalCaseRow[];
    const caseIds = new Set(cases.map((c) => c.id));
    criteria = ((critData ?? []) as EvalCriterionRow[]).filter((k) => caseIds.has(k.eval_case_id));
  }

  // Forrás-chipek a kanonikus számozás szerint (a [n] élő forrásra mutat).
  const loaded = await loadNumberedSources(supabase, id);
  const sourceChipsByCase: Record<string, { n: number; title: string }[]> = {};
  if (!("error" in loaded)) {
    const titleByIndex = new Map(loaded.sources.map((s) => [s.index, s.title]));
    for (const c of cases) {
      sourceChipsByCase[c.id] = inputIdsToIndices(c.source_input_ids ?? [], loaded.aliasIndex).map(
        (n) => ({ n, title: titleByIndex.get(n) ?? "" }),
      );
    }
  }

  // Legfrissebb verziók a két P3 deliverable-ből (version desc rendezés).
  const artifacts = (artData ?? []) as ArtifactRow[];
  const reportArtifact = artifacts.find((a) => a.type === "Tesztriport") ?? null;
  const solutionArtifact = artifacts.find((a) => a.type === "Megoldás-dokumentáció") ?? null;

  let residual: string | null = null;
  if (reportArtifact) {
    const typeDef = getTypeDef("Tesztriport");
    if (typeDef) {
      residual = parseArtifactFields(typeDef, reportArtifact.fields).maradek_kockazat?.value ?? null;
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-6 py-6">
      <GoldenSetBoard
        projectId={id}
        projectLabel={`${project.name} / P3`}
        useCaseTitle={useCase.title}
        set={set}
        cases={cases}
        criteria={criteria}
        report={
          reportArtifact
            ? { id: reportArtifact.id, status: reportArtifact.status, residual }
            : null
        }
        solutionDoc={solutionArtifact ? { status: solutionArtifact.status } : null}
        sourceChipsByCase={sourceChipsByCase}
      />
    </main>
  );
}

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { criterionLabel } from "@/lib/phases/criterion-label";
import type { NextStep } from "@/lib/phases/service";

// „Következő legjobb lépés" — az állapotgépből SZÁMÍTOTT lépés szövege és
// widgetje (hardcode tilos: minden ág a computeNextStep kimenetéből jön).

export async function nextStepLabel(step: NextStep): Promise<string> {
  const [t, tPhases, tCriteria, tTypes] = await Promise.all([
    getTranslations("nextstep"),
    getTranslations("phases"),
    getTranslations("criteria"),
    getTranslations("artifactTypes"),
  ]);
  const phaseLabel = (phase: string) =>
    `${phase} · ${tPhases(`${phase.toLowerCase()}.short`)}`;

  switch (step.kind) {
    case "all_done":
      return t("allDone");
    case "no_gate":
      return t("noGate");
    case "start":
      return t("start", { phase: phaseLabel(step.phase) });
    case "satisfy_criterion":
      return t("satisfy", {
        criterion: criterionLabel(
          { id: step.criterionId, typeKey: step.typeKey },
          tCriteria,
          tTypes,
        ),
      });
    case "close_gate":
      return step.temporary
        ? t("closeTemporary", { phase: phaseLabel(step.phase) })
        : t("close", { phase: phaseLabel(step.phase) });
  }
}

/** Pilótafülke-widget: kiszámított lépés + CTA a fázisra (döntési pont →
 *  lila akcentus, törvény 3 szerint jogosan). */
export async function NextStepWidget({
  projectId,
  step,
}: {
  projectId: string;
  step: NextStep;
}) {
  const [t, tCockpit] = await Promise.all([
    getTranslations("nextstep"),
    getTranslations("cockpit"),
  ]);
  const label = await nextStepLabel(step);
  const targetPhase =
    step.kind === "all_done" ? null : step.kind === "no_gate" ? "P6" : step.phase;

  return (
    <section className="glass-tile border-l-2 border-l-active p-4">
      <h2 className="text-mono-sm font-medium uppercase tracking-wide text-ink-tertiary">
        {tCockpit("nextStepTitle")}
      </h2>
      <p className="mt-1 text-body font-semibold">{label}</p>
      {targetPhase && (
        <Link
          href={`/project/${projectId}/phase/${targetPhase}`}
          className="mt-3 inline-flex items-center justify-center rounded-control bg-action px-3 py-1.5 text-body font-medium text-white shadow-action transition-all duration-[var(--motion-base)] hover:bg-action-hover hover:shadow-action-hover"
        >
          {t("cta")}
        </Link>
      )}
    </section>
  );
}

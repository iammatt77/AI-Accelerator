"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { FormState } from "@/app/actions";
import {
  savePilotDefinitionAction,
  suggestPilotDefinitionAction,
} from "@/app/p2-actions";
import type { PilotSuccess } from "@/lib/artifacts/p2";
import { SubmitButton } from "@/components/SubmitButton";

// ─────────────────────────────────────────────────────────────
// Pilot-terv sikerdefiníció (#9, ref: ref_P2_pilot). A poka-yoke: mérhető
// metrika + baseline → siker-küszöb egyetlen skálán (success-zóna), és egy
// ránézésre olvasható scale / pivot / stop szabály három szín-kódolt
// oszlopban. Üresen a rendszer láthatóan kényszerít (borostyán), az AI csak
// a mérhető részt javasolja (a döntési szabályt SOHA). „Alacsonyabb = jobb"
// metrikát feltételez (mint az AHT — a ref esete); a irány-váltó parkoló.
// A ref színértékei (SCALE zöld · PIVOT borostyán · STOP piros).
// ─────────────────────────────────────────────────────────────

const initialState: FormState = { ok: false, error: null };

export function PilotSuccessDefinition({
  projectId,
  artifactId,
  pilot,
  editable,
}: {
  projectId: string;
  artifactId: string;
  pilot: PilotSuccess;
  editable: boolean;
}) {
  const t = useTranslations("p2");
  const [metrika, setMetrika] = useState(pilot.meresi_metrika ?? "");
  const [baseV, setBaseV] = useState(str(pilot.baseline_ertek));
  const [baseU, setBaseU] = useState(pilot.baseline_egyseg ?? "");
  const [kuszV, setKuszV] = useState(str(pilot.kuszob_ertek));
  const [kuszU, setKuszU] = useState(pilot.kuszob_egyseg ?? "");
  const [scale, setScale] = useState(pilot.dontesi_szabaly.scale_feltetel ?? "");
  const [pivot, setPivot] = useState(pilot.dontesi_szabaly.pivot_feltetel ?? "");
  const [stop, setStop] = useState(pilot.dontesi_szabaly.stop_feltetel ?? "");

  const [saveState, saveAction] = useActionState(
    savePilotDefinitionAction.bind(null, projectId, artifactId),
    initialState,
  );
  const [suggestState, suggestAction] = useActionState(
    suggestPilotDefinitionAction.bind(null, projectId, artifactId),
    initialState,
  );

  const baseNum = num(baseV);
  const kuszNum = num(kuszV);
  const branchDone = [scale, pivot, stop].filter((s) => s.trim() !== "").length;
  const filled = kuszNum !== null && branchDone === 3;

  return (
    <form action={saveAction} className="space-y-0">
      <input type="hidden" name="metrika" value={metrika} />
      <input type="hidden" name="baseline_ertek" value={baseV} />
      <input type="hidden" name="baseline_egyseg" value={baseU} />
      <input type="hidden" name="kuszob_ertek" value={kuszV} />
      <input type="hidden" name="kuszob_egyseg" value={kuszU} />
      <input type="hidden" name="scale_feltetel" value={scale} />
      <input type="hidden" name="pivot_feltetel" value={pivot} />
      <input type="hidden" name="stop_feltetel" value={stop} />

      {/* poka-yoke figyelmeztetés, amíg nincs kész */}
      {!filled && (
        <div className="mb-3 flex items-start gap-2.5 rounded-tile border border-[#F0E3C2] bg-[#FDF6E7] px-3 py-2.5">
          <svg width="14" height="14" viewBox="0 0 12 12" className="mt-0.5 shrink-0 text-gate" aria-hidden>
            <path d="M6 1.5 L11 10 L1 10 Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M6 5 L6 7.2 M6 8.4 L6 8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <span className="text-[12px] leading-relaxed text-[#7A5B18]">{t("pokaYokeBody")}</span>
          <span className="ml-auto shrink-0 font-mono text-[10px] text-gate">
            {t("branchCount", { done: branchDone })}
          </span>
        </div>
      )}

      {editable && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <form action={suggestAction}>
            <SubmitButton pendingLabel={t("suggesting")}>{t("pilotSuggestCta")}</SubmitButton>
          </form>
          <span className="text-[10.5px] text-ink-tertiary">{t("suggestOnlyInputs")}</span>
        </div>
      )}
      {suggestState.notice && (
        <p role="status" className="mb-3 rounded-tile border border-gate/50 bg-surface px-3 py-2 text-body text-gate">
          {suggestState.notice}
        </p>
      )}

      {/* MÉRÉS · baseline → küszöb */}
      <div className="mb-2.5 flex items-center gap-2">
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
          {t("measureTitle")}
        </span>
        <span className="h-px flex-1 bg-line-soft" />
      </div>
      <div className="rounded-shell border border-[#E1E4EC] bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={metrika}
            disabled={!editable}
            onChange={(e) => setMetrika(e.target.value)}
            placeholder={t("metrikaPlaceholder")}
            className="min-w-0 flex-1 rounded-control border border-line bg-surface px-2.5 py-1.5 text-[13px] font-semibold placeholder:font-normal placeholder:text-ink-tertiary"
          />
        </div>

        {/* skála: baseline + küszöb marker, success-zóna (alacsonyabb = jobb) */}
        <MeasureBar baseline={baseNum} kuszob={kuszNum} baseUnit={baseU} kuszUnit={kuszU} t={t} />

        {/* baseline / küszöb bemenetek */}
        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <UnitInput
            tag={t("baselineTag")}
            tagCls="text-ink-secondary"
            value={baseV}
            unit={baseU}
            onValue={setBaseV}
            onUnit={setBaseU}
            editable={editable}
            valuePh={t("baselineValuePlaceholder")}
            unitPh={t("egysegPlaceholder")}
          />
          <UnitInput
            tag={t("kuszobTag")}
            tagCls="text-[#2E8B5E]"
            value={kuszV}
            unit={kuszU}
            onValue={setKuszV}
            onUnit={setKuszU}
            editable={editable}
            valuePh={t("kuszobValuePlaceholder")}
            unitPh={t("egysegPlaceholder")}
          />
        </div>
      </div>

      {/* DÖNTÉSI SZABÁLY */}
      <div className="mb-2.5 mt-4 flex items-center gap-2">
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
          {t("ruleTitle")}
        </span>
        <span className="text-[11px] text-ink-tertiary">{t("ruleHint")}</span>
        <span className="h-px flex-1 bg-line-soft" />
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <BranchInput
          kind="scale"
          label={t("scale")}
          action={t("scaleAction")}
          value={scale}
          onChange={setScale}
          editable={editable}
          placeholder={t("scaleThenPlaceholder")}
        />
        <BranchInput
          kind="pivot"
          label={t("pivot")}
          action={t("pivotAction")}
          value={pivot}
          onChange={setPivot}
          editable={editable}
          placeholder={t("pivotThenPlaceholder")}
        />
        <BranchInput
          kind="stop"
          label={t("stop")}
          action={t("stopAction")}
          value={stop}
          onChange={setStop}
          editable={editable}
          placeholder={t("stopThenPlaceholder")}
        />
      </div>

      {/* E1-lábléc */}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line-soft pt-3.5">
        {filled ? (
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-[#EAF3EE] px-2.5 py-1 text-[11px] font-semibold text-[#2E8B5E]">
            ✓ {t("filledConfirm")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-[#EAF3EE] px-2.5 py-1 text-[11px] font-semibold text-[#2E8B5E]">
            {t("e1Prerecorded")}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          {saveState.error && (
            <span role="alert" className="text-mono-sm text-danger">
              {saveState.error}
            </span>
          )}
          {saveState.ok && <span className="text-mono-sm text-done">{t("pilotSaved")}</span>}
          {editable && (
            <SubmitButton pendingLabel={t("savingPilot")}>{t("savePilotCta")}</SubmitButton>
          )}
        </div>
      </div>
    </form>
  );
}

// „Alacsonyabb = jobb" mérés-sáv: 0 → skála-max; success-zóna a küszöb alatt.
function MeasureBar({
  baseline,
  kuszob,
  baseUnit,
  kuszUnit,
  t,
}: {
  baseline: number | null;
  kuszob: number | null;
  baseUnit: string;
  kuszUnit: string;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  if (baseline === null && kuszob === null) {
    return (
      <div className="mt-3 rounded-tile border border-dashed border-[#D3D6E0] bg-[#FBFBFD] px-3 py-3 font-mono text-[11px] text-neutral-450">
        {t("pilotEmptyMetric")}
      </div>
    );
  }
  const hi = Math.max(baseline ?? 0, kuszob ?? 0);
  const scaleMax = Math.max(1, Math.ceil((hi * 1.33) / 5) * 5);
  const pct = (v: number) => Math.min(100, Math.max(0, (v / scaleMax) * 100));
  const kPct = kuszob !== null ? pct(kuszob) : null;
  const bPct = baseline !== null ? pct(baseline) : null;

  return (
    <div className="relative mt-4 h-[52px]">
      {/* success zóna (0 → küszöb) + neutral */}
      {kPct !== null && (
        <>
          <div
            className="absolute top-[16px] h-[10px] rounded-l-pill bg-[#E4F1EA]"
            style={{ left: 0, width: `${kPct}%` }}
          />
          <div
            className="absolute top-[16px] h-[10px] rounded-r-pill bg-[#EDEFF4]"
            style={{ left: `${kPct}%`, right: 0 }}
          />
          {/* küszöb marker */}
          <div className="absolute top-[8px] bottom-[8px] w-[2px] bg-done" style={{ left: `${kPct}%` }} />
          <div
            className="absolute -top-[2px] whitespace-nowrap font-mono text-[10px] font-bold text-[#2E8B5E]"
            style={{ left: `${kPct}%`, transform: "translateX(-50%)" }}
          >
            &lt; {kuszob} {kuszUnit} · {t("kuszobTag")}
          </div>
          <div
            className="absolute bottom-[-2px] font-mono text-[10px] text-[#2E8B5E]"
            style={{ left: `${kPct}%`, transform: "translateX(-50%)" }}
          >
            {t("successArrow")}
          </div>
        </>
      )}
      {/* baseline marker */}
      {bPct !== null && (
        <>
          <div
            className="absolute top-[11px] h-[20px] w-[20px] rounded-pill border-[2.5px] border-ink-secondary bg-surface shadow-[0_2px_5px_rgba(35,38,47,0.15)]"
            style={{ left: `${bPct}%`, transform: "translateX(-50%)" }}
          />
          <div
            className="absolute -top-[2px] whitespace-nowrap font-mono text-[10px] font-bold text-ink"
            style={{ left: `${bPct}%`, transform: "translateX(-50%)" }}
          >
            {baseline} {baseUnit} · {t("baselineTag")}
          </div>
        </>
      )}
      <div className="absolute -bottom-[14px] left-0 font-mono text-[9px] text-neutral-450">0</div>
      <div className="absolute -bottom-[14px] right-0 font-mono text-[9px] text-neutral-450">
        {scaleMax}
      </div>
    </div>
  );
}

const BRANCH: Record<
  "scale" | "pivot" | "stop",
  { dot: string; text: string; headBg: string; border: string }
> = {
  scale: { dot: "bg-done", text: "text-[#2E7050]", headBg: "bg-[#EFF7F2]", border: "border-[#CDE7DA]" },
  pivot: { dot: "bg-gate", text: "text-[#9A6A12]", headBg: "bg-[#FBF3E0]", border: "border-[#EAD9AE]" },
  stop: { dot: "bg-danger", text: "text-[#A6384C]", headBg: "bg-[#FBECEF]", border: "border-[#E7C3CB]" },
};

function BranchInput({
  kind,
  label,
  action,
  value,
  onChange,
  editable,
  placeholder,
}: {
  kind: "scale" | "pivot" | "stop";
  label: string;
  action: string;
  value: string;
  onChange: (v: string) => void;
  editable: boolean;
  placeholder: string;
}) {
  const c = BRANCH[kind];
  return (
    <div className={`overflow-hidden rounded-tile border ${c.border}`}>
      <div className={`flex items-center gap-1.5 px-3 py-2 ${c.headBg}`}>
        <span className={`h-2 w-2 rounded-pill ${c.dot}`} aria-hidden />
        <span className={`font-mono text-[11px] font-bold tracking-[0.04em] ${c.text}`}>{label}</span>
        <span className={`ml-auto text-[11px] ${c.text}`}>{action}</span>
      </div>
      <div className="p-2.5">
        <textarea
          value={value}
          disabled={!editable}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder={placeholder}
          className="w-full resize-none rounded-control border border-line bg-surface px-2.5 py-2 text-[11.5px] leading-relaxed placeholder:text-ink-tertiary"
        />
      </div>
    </div>
  );
}

function UnitInput({
  tag,
  tagCls,
  value,
  unit,
  onValue,
  onUnit,
  editable,
  valuePh,
  unitPh,
}: {
  tag: string;
  tagCls: string;
  value: string;
  unit: string;
  onValue: (v: string) => void;
  onUnit: (v: string) => void;
  editable: boolean;
  valuePh: string;
  unitPh: string;
}) {
  return (
    <div className="rounded-tile border border-[#E1E4EC] bg-surface p-2.5">
      <span className={`font-mono text-[9px] font-bold uppercase tracking-[0.06em] ${tagCls}`}>
        {tag}
      </span>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          value={value}
          disabled={!editable}
          onChange={(e) => onValue(e.target.value)}
          placeholder={valuePh}
          className="w-[90px] rounded-control border border-line bg-surface px-2 py-1 font-mono text-[15px] font-bold placeholder:text-neutral-400"
        />
        <input
          type="text"
          value={unit}
          disabled={!editable}
          onChange={(e) => onUnit(e.target.value)}
          placeholder={unitPh}
          className="w-[80px] rounded-control border border-line bg-surface px-2 py-1 text-[12px] placeholder:text-ink-tertiary"
        />
      </div>
    </div>
  );
}

function str(n: number | null): string {
  return n === null ? "" : String(n);
}
function num(s: string): number | null {
  const v = s.trim().replace(/\s/g, "");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { FormState } from "@/app/actions";
import {
  saveBenefitAction,
  suggestBenefitInputsAction,
} from "@/app/p2-actions";
import {
  computeBenefit,
  formatFt,
  type BenefitCalc,
} from "@/lib/artifacts/p2";
import { SubmitButton } from "@/components/SubmitButton";

// ─────────────────────────────────────────────────────────────
// Business case haszon-kalkulátor (#9, ref: ref_P2_business_case). A mező
// kibontott, számolós formája: STAGE 1 bemenetek (AI c-minta) → STAGE 2 a
// „fék" (lila döntési pont, CSAK emberi) → STAGE 3 levezetett (auto-számolt,
// szürke, szaggatott). A levezetett értékek élőben számolódnak a bemenetből
// + a fékből (computeBenefit); a fék beállításáig a lánc zárolva. A ref
// színértékei (a Handoff Master palettája).
// ─────────────────────────────────────────────────────────────

const initialState: FormState = { ok: false, error: null };

export function BenefitCalculator({
  projectId,
  artifactId,
  calc,
  editable,
}: {
  projectId: string;
  artifactId: string;
  calc: BenefitCalc;
  editable: boolean;
}) {
  const t = useTranslations("p2");
  const [kap, setKap] = useState<string>(str(calc.felszabadult_kapacitas_ora_ho));
  const [dij, setDij] = useState<string>(str(calc.oradij_ft));
  const [fek, setFek] = useState<number>(calc.realizalhato_szazalek ?? 0);
  const [fekSet, setFekSet] = useState<boolean>(calc.realizalhato_szazalek !== null);
  const [bev, setBev] = useState<string>(str(calc.bevezetes_koltseg_ft));
  const [uzem, setUzem] = useState<string>(str(calc.uzemeltetes_koltseg_ft_ho));

  const [saveState, saveAction] = useActionState(
    saveBenefitAction.bind(null, projectId, artifactId),
    initialState,
  );
  const [suggestState, suggestAction] = useActionState(
    suggestBenefitInputsAction.bind(null, projectId, artifactId),
    initialState,
  );

  // Élő levezetés a jelenlegi űrlap-értékekből.
  const live: BenefitCalc = {
    ...calc,
    felszabadult_kapacitas_ora_ho: num(kap),
    oradij_ft: num(dij),
    realizalhato_szazalek: fekSet ? fek : null,
    bevezetes_koltseg_ft: num(bev),
    uzemeltetes_koltseg_ft_ho: num(uzem),
  };
  const d = computeBenefit(live);
  const suggested = calc.state === "ai_suggested";
  const anyInput = num(kap) !== null || num(dij) !== null;

  return (
    // A javaslat- és a mentés-form TESTVÉR (nem egymásba ágyazott): a beágyazott
    // <form> érvénytelen HTML — a böngésző eldobja a belső formot, így a
    // „Bemenetek javaslata" gomb a külső (mentés) formot indítaná. Ezért a
    // kalkulátor törzse egy sima <div>, benne két különálló form.
    <div className="space-y-0">
      {/* üres állapot vezető + AI-javaslat gomb (önálló form) */}
      {!anyInput && (
        <p className="mb-3 text-[12.5px] leading-relaxed text-ink-secondary">{t("emptyLead")}</p>
      )}
      {editable && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <form action={suggestAction}>
            <SubmitButton pendingLabel={t("suggesting")}>{t("suggestCta")}</SubmitButton>
          </form>
          <span className="text-[10.5px] text-ink-tertiary">{t("suggestOnlyInputs")}</span>
        </div>
      )}
      {suggestState.notice && (
        <p role="status" className="mb-3 rounded-tile border border-gate/50 bg-surface px-3 py-2 text-body text-gate">
          {suggestState.notice}
        </p>
      )}

      {/* mentés-form: rejtett mezők + STAGE-ek + lábléc */}
      <form action={saveAction} className="space-y-0">
      {/* hidden mezők a mentéshez */}
      <input type="hidden" name="kapacitas" value={kap} />
      <input type="hidden" name="oradij" value={dij} />
      <input type="hidden" name="fek" value={fekSet ? String(fek) : ""} />
      <input type="hidden" name="bevezetes" value={bev} />
      <input type="hidden" name="uzemeltetes" value={uzem} />

      {/* STAGE 1 · BEMENETEK */}
      <StageHeader label={t("stage1")} hint={t("stage1Hint")} />
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <NumberInput
          label={t("kapacitasLabel")}
          unit={t("kapacitasUnit")}
          value={kap}
          onChange={setKap}
          editable={editable}
          tag={t("inputTag")}
          suggested={suggested && calc.felszabadult_kapacitas_ora_ho !== null}
        />
        <NumberInput
          label={t("oradijLabel")}
          unit={t("oradijUnit")}
          value={dij}
          onChange={setDij}
          editable={editable}
          tag={t("inputTag")}
          suggested={suggested && calc.oradij_ft !== null}
        />
        <NumberInput
          label={t("bevezetesLabel")}
          unit={t("bevezetesUnit")}
          value={bev}
          onChange={setBev}
          editable={editable}
          tag={t("inputTag")}
        />
        <NumberInput
          label={t("uzemeltetesInputLabel")}
          unit={t("uzemeltetesInputUnit")}
          value={uzem}
          onChange={setUzem}
          editable={editable}
          tag={t("inputTag")}
        />
      </div>

      <Connector />

      {/* STAGE 2 · A FÉK (lila döntési pont, csak emberi) */}
      <div className="rounded-shell border-[1.5px] border-[#B9CCF7] bg-[#F6F9FE] p-4 shadow-[0_6px_18px_rgba(22, 62, 158,0.08)]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#1E52D4]">
            {t("stage2")}
          </span>
          <span className="rounded-3 bg-[#E7EEFD] px-1.5 py-0.5 font-mono text-[8.5px] font-bold text-[#1E52D4]">
            {t("stage2Tag")}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-5">
          <div className="flex shrink-0 items-baseline gap-1">
            <span className="font-mono text-[34px] font-bold leading-none tracking-tight text-[#1E52D4]">
              {fekSet ? fek : "—"}
            </span>
            <span className="font-mono text-[18px] font-bold text-[#1E52D4]">%</span>
          </div>
          <div className="flex-1">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={fek}
              disabled={!editable}
              onChange={(e) => {
                setFek(Number(e.target.value));
                setFekSet(true);
              }}
              className="w-full accent-[#1F5AE8]"
              aria-label={t("stage2")}
            />
            <div className="mt-1 flex justify-between font-mono text-[9.5px] text-neutral-450">
              <span>{t("fek0")}</span>
              <span>{t("fek100")}</span>
            </div>
          </div>
        </div>
        <p className="mt-2.5 border-t border-[#E5ECFD] pt-2.5 text-[11.5px] leading-relaxed text-ink-secondary">
          {t("fekHint")} <b className="text-[#1E52D4]">{t("fekCredibility")}</b>
        </p>
      </div>

      <Connector />

      {/* STAGE 3 · LEVEZETETT (auto-számolt) */}
      <StageHeader label={t("stage3")} hint={t("stage3Hint")} />
      {!fekSet ? (
        <div className="flex items-center gap-2 rounded-tile border border-dashed border-[#CFD3DE] bg-[#F5F6F9] px-3 py-3 text-[11px] text-ink-tertiary">
          <span aria-hidden className="text-gate">
            ⚠
          </span>
          {t("lockedHint")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-shell border border-dashed border-[#CFD3DE] bg-[#F5F6F9]">
          <DerivedRow
            label={t("bruttoLabel")}
            note={t("bruttoNote")}
            formula={t("bruttoFormula", { kap: formatFt(num(kap)), dij: formatFt(num(dij)) })}
            value={`${formatFt(d.brutto_ft_ev)} ${t("ftEv")}`}
            valueCls="text-ink-secondary"
          />
          <DerivedRow
            label={t("realizaltLabel")}
            note={t("realizaltNote", { n: fek })}
            noteCls="text-[#1E52D4]"
            bg="bg-[#F4F8FE]"
            value={`${formatFt(d.realizalt_ft_ev)} ${t("ftEv")}`}
            valueCls="text-ink"
          />
          <DerivedRow
            label={t("uzemeltetesLabel")}
            note={t("uzemeltetesNote")}
            value={`− ${formatFt(d.uzemeltetes_ft_ev)} ${t("ftEv")}`}
            valueCls="text-danger"
          />
          {/* hero-sor */}
          <div className="grid grid-cols-1 border-t-[1.5px] border-[#DDE0E9] sm:grid-cols-2">
            <div className="border-b border-line-row bg-[#EFF7F2] p-[14px_16px] sm:border-b-0 sm:border-r">
              <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.08em] text-[#2E8B5E]">
                {t("nettoLabel")}
              </div>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="font-mono text-[26px] font-bold leading-none tracking-tight text-[#2E7050]">
                  {formatFt(d.netto_ft_ev)}
                </span>
                <span className="font-mono text-[13px] text-done">{t("ftEv")}</span>
              </div>
            </div>
            <div className="bg-[#F7FAFE] p-[14px_16px]">
              <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.08em] text-[#1E52D4]">
                {t("megterulesLabel")}
              </div>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="font-mono text-[26px] font-bold leading-none tracking-tight text-[#1E52D4]">
                  {d.megterules_ho !== null ? Math.round(d.megterules_ho) : "—"}
                </span>
                <span className="font-mono text-[13px] text-action">{t("megterulesUnit")}</span>
              </div>
              {d.netto_ft_ev !== null && d.netto_ft_ev > 0 && num(bev) !== null && (
                <div className="mt-1 font-mono text-[9.5px] text-ink-tertiary">
                  {t("megterulesFormula", {
                    bev: formatFt(num(bev)),
                    havi: formatFt(d.netto_ft_ev / 12),
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* E1-lábléc */}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line-soft pt-3.5">
        <span className="inline-flex items-center gap-1.5 rounded-pill bg-[#EAF3EE] px-2.5 py-1 text-[11px] font-semibold text-[#2E8B5E]">
          ✓ {t("benefitConfirmedNote")}
        </span>
        <div className="ml-auto flex items-center gap-3">
          {saveState.error && (
            <span role="alert" className="text-mono-sm text-danger">
              {saveState.error}
            </span>
          )}
          {saveState.ok && <span className="text-mono-sm text-done">{t("calcSaved")}</span>}
          {editable && (
            <SubmitButton pendingLabel={t("savingCalc")}>{t("saveCalcCta")}</SubmitButton>
          )}
        </div>
      </div>
      </form>
    </div>
  );
}

function StageHeader({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="mb-2.5 mt-0 flex items-center gap-2">
      <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-tertiary">
        {label}
      </span>
      <span className="text-[11.5px] text-ink-tertiary">{hint}</span>
      <span className="h-px flex-1 bg-line-soft" />
    </div>
  );
}

function Connector() {
  return (
    <div className="flex justify-center py-2.5" aria-hidden>
      <svg width="14" height="18" viewBox="0 0 14 18" className="text-[#B9CCF7]">
        <path
          d="M7 1 L7 13 M3 9.5 L7 14 L11 9.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function NumberInput({
  label,
  unit,
  value,
  onChange,
  editable,
  tag,
  suggested,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  editable: boolean;
  tag: string;
  suggested?: boolean;
}) {
  return (
    <div
      className={`rounded-tile border bg-surface p-3 ${
        suggested ? "border-[#EAD9AE] bg-[#FFFBF2]" : "border-[#E1E4EC]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.08em] text-ink-tertiary">
          {label}
        </span>
        {suggested ? (
          <span className="font-mono text-[8px] font-bold text-[#9A6A12]">✦ {tag}</span>
        ) : (
          <span className="rounded-[2px] bg-[#E4EEF5] px-1.5 py-px font-mono text-[8.5px] font-bold text-[#2E77A8]">
            {tag}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <input
          type="text"
          inputMode="numeric"
          value={value}
          disabled={!editable}
          onChange={(e) => onChange(e.target.value)}
          placeholder="—"
          className="w-[110px] rounded-control border border-line bg-surface px-2 py-1 font-mono text-[20px] font-bold tracking-tight text-ink placeholder:text-neutral-400 disabled:border-transparent disabled:bg-transparent disabled:px-0"
        />
        <span className="font-mono text-[12px] text-ink-tertiary">{unit}</span>
      </div>
    </div>
  );
}

function DerivedRow({
  label,
  note,
  noteCls,
  formula,
  value,
  valueCls,
  bg,
}: {
  label: string;
  note: string;
  noteCls?: string;
  formula?: string;
  value: string;
  valueCls: string;
  bg?: string;
}) {
  return (
    <div className={`flex items-center gap-3 border-b border-line-row px-4 py-2.5 ${bg ?? ""}`}>
      <div className="flex-1">
        <div className="text-[12.5px] font-semibold text-ink">
          {label}{" "}
          <span className={`font-mono text-[10px] font-normal ${noteCls ?? "text-ink-tertiary"}`}>
            {note}
          </span>
        </div>
        {formula && <div className="mt-0.5 font-mono text-[10px] text-ink-tertiary">{formula}</div>}
      </div>
      <span className={`font-mono text-[15px] font-bold ${valueCls}`}>{value}</span>
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

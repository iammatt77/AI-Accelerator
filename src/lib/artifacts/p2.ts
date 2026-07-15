// ─────────────────────────────────────────────────────────────
// P2-mélység (#9): a Business case haszon-kalkulátor és a Pilot-terv
// sikerdefiníció strukturált adatai + a levezetett-érték számítás.
//
// TISZTA modul (nincs server-only, nincs SDK) — a derivation és a parse
// önállóan tesztelhető. A levezetett értékek (bruttó/realizált/nettó/
// megtérülés) SOHA nem tárolódnak: mindig a bemenetekből + a fékből
// számolódnak (egyetlen igazságforrás a bemenet).
// ─────────────────────────────────────────────────────────────

export type P2State = "empty" | "ai_suggested" | "confirmed" | "manual";

/** A Business case „Haszon-számítás" strukturált bemenetei. A levezetett
 *  mezők (bruttó/realizált/nettó/megtérülés) NEM itt élnek — computeBenefit. */
export interface BenefitCalc {
  state: P2State;
  /** STAGE 1 · bemenetek (az AI c-minta szerint javasolhatja). */
  felszabadult_kapacitas_ora_ho: number | null;
  oradij_ft: number | null;
  /** STAGE 2 · a „fék" — KIZÁRÓLAG emberi, az AI SOHA nem tölti. */
  realizalhato_szazalek: number | null;
  /** Költség-bemenetek (emberi). */
  bevezetes_koltseg_ft: number | null;
  uzemeltetes_koltseg_ft_ho: number | null;
  /** A javasolt bemenetek forrás-indexei ([n]). */
  source_indices: number[];
}

/** A Pilot-terv sikerdefiníciója (mérés + döntési szabály). A hipotézis /
 *  résztvevők / mérési mód a MEGLÉVŐ szöveges mezőkben marad (fields jsonb). */
export interface PilotSuccess {
  state: P2State;
  /** A mért metrika neve (pl. „AHT — átlagos kezelési idő"). */
  meresi_metrika: string | null;
  baseline_ertek: number | null;
  baseline_egyseg: string | null;
  kuszob_ertek: number | null;
  kuszob_egyseg: string | null;
  /** A döntési szabály — a scale/pivot/stop feltételek KIZÁRÓLAG emberiek. */
  dontesi_szabaly: {
    scale_feltetel: string | null;
    pivot_feltetel: string | null;
    stop_feltetel: string | null;
  };
  source_indices: number[];
}

export const EMPTY_BENEFIT: BenefitCalc = {
  state: "empty",
  felszabadult_kapacitas_ora_ho: null,
  oradij_ft: null,
  realizalhato_szazalek: null,
  bevezetes_koltseg_ft: null,
  uzemeltetes_koltseg_ft_ho: null,
  source_indices: [],
};

export const EMPTY_PILOT: PilotSuccess = {
  state: "empty",
  meresi_metrika: null,
  baseline_ertek: null,
  baseline_egyseg: null,
  kuszob_ertek: null,
  kuszob_egyseg: null,
  dontesi_szabaly: { scale_feltetel: null, pivot_feltetel: null, stop_feltetel: null },
  source_indices: [],
};

// ── Levezetett értékek (auto-számolt, sosem tárolt) ──────────

export interface BenefitDerived {
  brutto_ft_ev: number | null;
  realizalt_ft_ev: number | null;
  uzemeltetes_ft_ev: number | null;
  netto_ft_ev: number | null;
  megterules_ho: number | null;
  /** Számolható-e a lánc (van kapacitás + óradíj + fék). */
  computable: boolean;
}

/**
 * A haszon-lánc levezetése (a referencia képlete):
 *   bruttó/év   = kapacitás (ó/hó) × óradíj (Ft/ó) × 12
 *   realizált/év= bruttó × (fék% / 100)
 *   üzem/év     = üzemeltetés (Ft/hó) × 12
 *   nettó/év    = realizált − üzem
 *   megtérülés  = bevezetés / (nettó / 12)      [hó]
 * Hibás/hiányzó bemenetnél SOSEM dob hibát: a nem számolható tag null marad
 * (a levezetett érték üres/– a UI-ban), a 0-osztás null-t ad.
 */
export function computeBenefit(b: BenefitCalc): BenefitDerived {
  const kap = numOrNull(b.felszabadult_kapacitas_ora_ho);
  const dij = numOrNull(b.oradij_ft);
  const fek = numOrNull(b.realizalhato_szazalek);
  const bev = numOrNull(b.bevezetes_koltseg_ft);
  const uzemHo = numOrNull(b.uzemeltetes_koltseg_ft_ho);

  const brutto = kap !== null && dij !== null ? kap * dij * 12 : null;
  const realizalt = brutto !== null && fek !== null ? brutto * (fek / 100) : null;
  const uzemEv = uzemHo !== null ? uzemHo * 12 : null;
  const netto =
    realizalt !== null ? realizalt - (uzemEv ?? 0) : null;
  const megterules =
    bev !== null && netto !== null && netto > 0 ? bev / (netto / 12) : null;

  return {
    brutto_ft_ev: brutto,
    realizalt_ft_ev: realizalt,
    uzemeltetes_ft_ev: uzemEv,
    netto_ft_ev: netto,
    megterules_ho: megterules,
    computable: kap !== null && dij !== null && fek !== null,
  };
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

// ── Defenzív parse (a DB jsonb → tipizált shape) ─────────────

function parseState(raw: unknown): P2State {
  return raw === "ai_suggested" || raw === "confirmed" || raw === "manual"
    ? raw
    : "empty";
}

function parseIndices(raw: unknown): number[] {
  return Array.isArray(raw)
    ? [...new Set(raw.filter((n): n is number => Number.isInteger(n) && (n as number) > 0))]
    : [];
}

function textOrNull(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t === "" ? null : t;
}

export function parseBenefitCalc(raw: unknown): BenefitCalc {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_BENEFIT };
  const o = raw as Record<string, unknown>;
  return {
    state: parseState(o.state),
    felszabadult_kapacitas_ora_ho: numOrNull(o.felszabadult_kapacitas_ora_ho),
    oradij_ft: numOrNull(o.oradij_ft),
    realizalhato_szazalek: numOrNull(o.realizalhato_szazalek),
    bevezetes_koltseg_ft: numOrNull(o.bevezetes_koltseg_ft),
    uzemeltetes_koltseg_ft_ho: numOrNull(o.uzemeltetes_koltseg_ft_ho),
    source_indices: parseIndices(o.source_indices),
  };
}

export function parsePilotSuccess(raw: unknown): PilotSuccess {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_PILOT };
  const o = raw as Record<string, unknown>;
  const dr =
    o.dontesi_szabaly && typeof o.dontesi_szabaly === "object" && !Array.isArray(o.dontesi_szabaly)
      ? (o.dontesi_szabaly as Record<string, unknown>)
      : {};
  return {
    state: parseState(o.state),
    meresi_metrika: textOrNull(o.meresi_metrika),
    baseline_ertek: numOrNull(o.baseline_ertek),
    baseline_egyseg: textOrNull(o.baseline_egyseg),
    kuszob_ertek: numOrNull(o.kuszob_ertek),
    kuszob_egyseg: textOrNull(o.kuszob_egyseg),
    dontesi_szabaly: {
      scale_feltetel: textOrNull(dr.scale_feltetel),
      pivot_feltetel: textOrNull(dr.pivot_feltetel),
      stop_feltetel: textOrNull(dr.stop_feltetel),
    },
    source_indices: parseIndices(o.source_indices),
  };
}

// ── Készültség + fields-value szinkron összefoglalók ─────────

/** A kalkulátor „kész" (a fields.haszon_szamitas kitöltöttnek számít), ha a
 *  lánc számolható (kapacitás + óradíj + fék megvan). */
export function benefitFilled(b: BenefitCalc): boolean {
  return computeBenefit(b).computable;
}

/** A sikerdefiníció „kész", ha a küszöb + mindhárom döntési ág megvan. */
export function pilotFilled(p: PilotSuccess): boolean {
  return (
    p.kuszob_ertek !== null &&
    Boolean(p.dontesi_szabaly.scale_feltetel) &&
    Boolean(p.dontesi_szabaly.pivot_feltetel) &&
    Boolean(p.dontesi_szabaly.stop_feltetel)
  );
}

/** Ezer-elválasztós magyar szám (JetBrains Mono valuta-megjelenítéshez). */
export function formatFt(n: number | null): string {
  if (n === null) return "—";
  return Math.round(n).toLocaleString("hu-HU").replace(/ /g, " ");
}

/** A fields.haszon_szamitas value-jába írt, ember-olvasható összefoglaló —
 *  a meglévő teljesség/approve/előnézet ezen keresztül lát „kitöltöttséget". */
export function benefitSummary(b: BenefitCalc): string {
  const d = computeBenefit(b);
  if (!d.computable) return "";
  return `Nettó ${formatFt(d.netto_ft_ev)} Ft/év · megtérülés ${
    d.megterules_ho !== null ? Math.round(d.megterules_ho) : "—"
  } hó · fék ${b.realizalhato_szazalek}%`;
}

/** A pilot sikerdefiníció mezőinek szöveg-szinkronja (baseline / küszöb /
 *  döntési szabály) — a három meglévő kötelező mezőt tölti. */
export function pilotFieldSync(p: PilotSuccess): {
  baseline: string;
  szamszeru_kuszob: string;
  dontesi_szabaly: string;
} {
  const unit = (v: number | null, u: string | null) =>
    v !== null ? `${v}${u ? ` ${u}` : ""}` : "";
  return {
    baseline: p.baseline_ertek !== null ? unit(p.baseline_ertek, p.baseline_egyseg) : "",
    szamszeru_kuszob: p.kuszob_ertek !== null ? unit(p.kuszob_ertek, p.kuszob_egyseg) : "",
    dontesi_szabaly: [
      p.dontesi_szabaly.scale_feltetel && `SCALE: ${p.dontesi_szabaly.scale_feltetel}`,
      p.dontesi_szabaly.pivot_feltetel && `PIVOT: ${p.dontesi_szabaly.pivot_feltetel}`,
      p.dontesi_szabaly.stop_feltetel && `STOP: ${p.dontesi_szabaly.stop_feltetel}`,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

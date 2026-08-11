import type { EvidenceKind, Modality, SourceDocKind, SourceOrgLevel } from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Forrás-metaadat szótár + levezetési alapértékek (4.2b) — TISZTA modul,
// kliens és szerver egyaránt használhatja. A levezetés a spec §4 táblája:
// „nem szabály, hanem erős kiindulópont — a szöveg felülírhatja".
// ─────────────────────────────────────────────────────────────

export const SOURCE_KINDS: readonly SourceDocKind[] = [
  "interju_atirat",
  "hivatalos_dokumentacio",
  "workshop_jegyzokonyv",
  "rendszeradat_riport",
  "levelezes",
  "prezentacio",
  "egyeb",
];

export const ORG_LEVELS: readonly SourceOrgLevel[] = ["hq", "helyi", "kulso", "ismeretlen"];

export function parseSourceKind(raw: string): SourceDocKind | null {
  return SOURCE_KINDS.includes(raw as SourceDocKind) ? (raw as SourceDocKind) : null;
}
export function parseOrgLevel(raw: string): SourceOrgLevel | null {
  return ORG_LEVELS.includes(raw as SourceOrgLevel) ? (raw as SourceOrgLevel) : null;
}

/** Modalitás-alapérték a forrás-típusból (spec §4). null = nincs prior
 *  (vegyes: workshop, levelezés, prezentáció, egyéb). */
export function modalityPriorOf(kind: SourceDocKind | null): Modality | null {
  switch (kind) {
    case "hivatalos_dokumentacio":
      return "normativ";
    case "rendszeradat_riport":
      return "as_is";
    case "interju_atirat":
      return "as_is";
    default:
      return null;
  }
}

/** Evidencia-alapérték a forrás-típusból (spec §4). null = a szöveg dönt
 *  (interjú: megfigyelés VAGY vélekedés; ismeretlen típus). */
export function evidencePriorOf(kind: SourceDocKind | null): EvidenceKind | null {
  switch (kind) {
    case "hivatalos_dokumentacio":
      return "hivatkozas";
    case "rendszeradat_riport":
      return "mert_adat";
    case "workshop_jegyzokonyv":
      return "megfigyeles";
    case "levelezes":
      return "velekedes";
    default:
      return null;
  }
}

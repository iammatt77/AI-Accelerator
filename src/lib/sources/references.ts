// ─────────────────────────────────────────────────────────────
// Forrástár — tiszta származtatások (nincs React/DB). A redesign a
// MEGLÉVŐ input_items adatból dolgozik; ez a modul a megjelenítéshez
// szükséges levezetéseket adja: típus-kategória (ikon + szűrő), fájl-
// jelvény, szószám, előnézet, és az átirat felszólalónkénti bontása.
//
// Backend-megfelelés (ellenőrizve): NINCS strukturált típus/formátum mező
// az input_items-en → a kategóriát és a .TXT/.CSV jelvényt a `type` szöveg-
// mezőből származtatjuk (a szűrőt ez kiszolgálja, migráció nem kell). A
// „hivatkozva N×" + „HOL hivatkozva" a szerver-oldali fordított aggregáció
// (a meglévő source_input_ids / fields.source_indices olvasása) — lásd a
// sources/page.tsx-et. Ez a modul tisztán, önállóan tesztelhető.
// ─────────────────────────────────────────────────────────────

export type SourceKind = "transcript" | "list" | "note" | "data" | "document";

/** A „hol hivatkozva" chip: egy deliverable vagy egy stakeholder, kattintható. */
export interface ReferenceChip {
  key: string;
  kind: "artifact" | "stakeholder";
  label: string;
  href: string;
}

/** Egy forrás sora a tár számára (a szerver állítja össze, a kliens jeleníti). */
/** Egy korábbi forrás-verzió a történethez (Csomag A, A8). */
export interface SourceVersionRow {
  id: string;
  version: number;
  dateLabel: string;
  content: string;
}

export interface SourceRow {
  /** A csoport LEGFRISSEBB verziójának id-ja (a sor ezt képviseli). */
  id: string;
  index: number;
  title: string;
  kind: SourceKind;
  /** ".TXT" | ".CSV" | … a `type`-ban talált kiterjesztésből; null ha nincs. */
  fileBadge: string | null;
  phase: string | null;
  dateLabel: string;
  isoDate: string;
  preview: string;
  content: string;
  wordCount: number;
  refCount: number;
  references: ReferenceChip[];
  /** Verzió-csoport (A8): a csoport kulcsa + az aktuális verziószám +
   *  a korábbi verziók (csökkenő sorrendben). */
  groupId: string;
  version: number;
  history: SourceVersionRow[];
  /** 4.2b-a: a feltöltő által megadott forrás-metaadat (null = nincs
   *  megadva — a felületen LÁTHATÓ hiány, itt pótolható). */
  sourceKind: string | null;
  orgLevel: string | null;
}

/**
 * A forrás kategóriája a `type` szövegből (kulcsszó-heurisztika, HU+EN).
 * Sorrend számít: az elsőként illeszkedő nyer. Ismeretlen → "document".
 */
export function deriveSourceKind(type: string): SourceKind {
  const s = (type ?? "").toLowerCase();
  if (/(átirat|atirat|transzkript|transcript|interjú|interju|teams|meeting|felvétel|felvetel|jegyzőkönyv|jegyzokonyv)/.test(s)) {
    return "transcript";
  }
  if (/(\.csv|\.xlsx?|export|táblázat|tablazat|adatkinyer|dataset|riport|report)/.test(s)) {
    return "data";
  }
  if (/(lista|list|névsor|nevsor|szereplők|szereplok|roster)/.test(s)) {
    return "list";
  }
  if (/(jegyzet|note|nyers|memo|vázlat|vazlat|feljegyzés|feljegyzes)/.test(s)) {
    return "note";
  }
  return "document";
}

/** A `type`-ban talált fájl-kiterjesztés nagybetűs jelvénye (".CSV"), vagy null. */
export function deriveFileBadge(type: string): string | null {
  const m = (type ?? "").match(/\.([a-z0-9]{2,4})(?:\b|$)/i);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  const allow = new Set(["txt", "csv", "md", "pdf", "doc", "docx", "xls", "xlsx", "json", "log"]);
  return allow.has(ext) ? `.${ext.toUpperCase()}` : null;
}

/** Szószám a nyers tartalomból (whitespace-tokenizálás). */
export function wordCount(text: string): number {
  const t = (text ?? "").trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

/** Egysoros előnézet: az első nem-üres sor, max `max` karakter. */
export function previewLine(text: string, max = 120): string {
  const firstLine = (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  const base = firstLine ?? (text ?? "").trim();
  return base.length > max ? `${base.slice(0, max)}…` : base;
}

export interface TranscriptTurn {
  initials: string;
  speaker: string;
  body: string;
}

const SPEAKER_TIMECODE = /^\s*\[\d{1,2}:\d{2}(?::\d{2})?\]\s*([^:]{1,48}?):\s*(.*)$/;
const SPEAKER_PLAIN = /^\s*([\p{Lu}][\p{L}.\-\s]{0,46}?):\s+(.*)$/u;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Legjobb-igyekezet átirat-bontás felszólalónként. A sorkezdő „Név: szöveg"
 * vagy „[időkód] Név: szöveg" mintát ismeri fel; a folytatósorokat az aktuális
 * felszólalóhoz fűzi. Ha < 2 felszólaló-váltás van → null (a hívó nyers
 * formázott szöveget mutat). Sosem dob; tisztán megjelenítési heurisztika.
 */
export function parseTranscript(text: string): TranscriptTurn[] | null {
  const lines = (text ?? "").split(/\r?\n/);
  const turns: TranscriptTurn[] = [];
  let current: TranscriptTurn | null = null;

  for (const line of lines) {
    const m = line.match(SPEAKER_TIMECODE) ?? line.match(SPEAKER_PLAIN);
    if (m) {
      const speaker = m[1].trim();
      if (current) turns.push(current);
      current = { initials: initialsOf(speaker), speaker, body: m[2].trim() };
    } else if (current) {
      const extra = line.trim();
      if (extra) current.body += (current.body ? " " : "") + extra;
    }
  }
  if (current) turns.push(current);

  const distinctSpeakers = new Set(turns.map((t) => t.speaker.toLowerCase()));
  if (turns.length < 2 || distinctSpeakers.size < 2) return null;
  return turns;
}

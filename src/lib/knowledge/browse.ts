import type {
  ArtifactRow,
  InputItemRow,
  KnowledgeCatalogRow,
  StakeholderRow,
} from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Katalógus-böngésző segédréteg (17 · 4.2 UI) — TISZTA függvények, a
// kliens-bundle-be is kerülhet (nincs node-függés, nincs DB-hívás).
//
// A design átkeretezése: egy tudáselem EGY ÁLLÍTÁS — a sorban az állítás
// szövege dominál, alatta az EREDET (projekt · fázis · forrás · személy).
// Itt él: az állítás-szöveg kiválasztása, az eredet-feloldás (a page által
// betöltött nyers sorokból), a többségi-érték számítás (alapérték-elnyomás)
// és a nulla-találat javaslat-számítás. Mind determinisztikus és headless
// tesztelhető.
// ─────────────────────────────────────────────────────────────

/** Az eredet-sor megjelenítendő adatai (compliance (2) táblázata). */
export interface CatalogOrigin {
  /** Ügyfél · projekt (a lapon konstans, de a design mutatja). */
  clientName: string | null;
  projectName: string;
  phase: string | null;
  /** Forrás-dokumentum címe (input_items konvenció: cím = type). */
  sourceTitle: string | null;
  /** A forráshoz kötött személy (input.stakeholder_source_id → név). */
  personName: string | null;
  /** A személy szerepe (stakeholders.title). */
  personRole: string | null;
  /** A forrás dátuma (input.created_at), ISO string. */
  sourceDate: string | null;
  /** artifact_field cédulánál: az artefaktum típusa + mező-kulcs. */
  artifactLabel: string | null;
}

/** Mi az ÁLLÍTÁS szövege egy katalógus-soron? A technikai címűeknél
 *  (artifact_field mező-kulcs, requirement display-id) a tartalom (excerpt),
 *  különben a cím. Üres tartalomnál fallback a címre — nem találunk ki
 *  szöveget. */
export function claimOf(row: {
  block_type: string;
  title: string;
  excerpt: string | null;
}): string {
  const technicalTitle =
    row.block_type === "artifact_field" || /^[A-Z]{1,4}-\d+$/.test(row.title.trim());
  if (technicalTitle && row.excerpt && row.excerpt.trim() !== "") {
    return row.excerpt.trim();
  }
  return row.title;
}

/** Igaz, ha az állítás a tartalomból (excerpt) jött — ilyenkor a cím
 *  (mező-kulcs / display-id) az eredet-sorban jelenik meg. */
export function claimUsesExcerpt(row: {
  block_type: string;
  title: string;
  excerpt: string | null;
}): boolean {
  return claimOf(row) !== row.title;
}

export function resolveOrigin(
  row: KnowledgeCatalogRow,
  ctx: {
    clientName: string | null;
    projectName: string;
    inputsById: Map<string, InputItemRow>;
    artifactsById: Map<string, ArtifactRow>;
    stakeholdersById: Map<string, StakeholderRow>;
    /** A címkézett attribúció (metadata.source_person_stakeholder_id) —
     *  fallback, ha a forráshoz nincs személy kötve. */
    labeledPersonId?: string | null;
  },
): CatalogOrigin {
  const firstInputId = (row.source_input_ids ?? [])[0] ?? null;
  const input = firstInputId ? (ctx.inputsById.get(firstInputId) ?? null) : null;
  const personId = input?.stakeholder_source_id ?? ctx.labeledPersonId ?? null;
  const person = personId ? (ctx.stakeholdersById.get(personId) ?? null) : null;
  const artifact =
    row.block_type === "artifact_field" && row.artifact_id
      ? (ctx.artifactsById.get(row.artifact_id) ?? null)
      : null;

  return {
    clientName: ctx.clientName,
    projectName: ctx.projectName,
    phase: row.phase,
    sourceTitle: input?.type ?? null,
    personName: person?.name ?? null,
    personRole: person?.title ?? null,
    sourceDate: input?.created_at ?? null,
    artifactLabel: artifact ? `${artifact.type} · ${row.field_key}` : null,
  };
}

// ── Alapérték-elnyomás ───────────────────────────────────────
// A többségi érték dimenziónként, az AKTUÁLIS szűrt listán számolva —
// adat-vezérelt, nem hardcode-olt. Csak az ettől ELTÉRŐ érték kap chipet a
// sorban; a részletpanel mindent mutat.

export interface SuppressionDims {
  sourceOrgLevel: string | null;
  lang: string | null;
  /** Az érvényesség jelenlét-szinten többségi: null (nincs) vagy "van". */
  validTime: "none" | "some" | null;
}

export function majorityValues(
  items: {
    metadata: {
      sourceOrgLevel: string;
      lang: string | null;
      validTime: string | null;
    } | null;
  }[],
): SuppressionDims {
  const labeled = items.filter((i) => i.metadata);
  if (labeled.length === 0) return { sourceOrgLevel: null, lang: null, validTime: null };
  const mode = (vals: (string | null)[]): string | null => {
    const counts = new Map<string, number>();
    for (const v of vals) counts.set(v ?? "∅", (counts.get(v ?? "∅") ?? 0) + 1);
    let best: string | null = null;
    let bestN = 0;
    for (const [k, n] of counts) {
      if (n > bestN) {
        best = k;
        bestN = n;
      }
    }
    // Csak akkor többségi, ha tényleg a lista több mint felét adja —
    // különben nincs mit elnyomni.
    return best !== null && bestN * 2 > vals.length ? (best === "∅" ? null : best) : "__none__";
  };
  const org = mode(labeled.map((i) => i.metadata!.sourceOrgLevel));
  const lang = mode(labeled.map((i) => i.metadata!.lang));
  const vt = mode(labeled.map((i) => (i.metadata!.validTime ? "some" : null)));
  return {
    sourceOrgLevel: org === "__none__" ? null : org,
    lang: lang === "__none__" ? null : lang,
    validTime: vt === "__none__" ? null : vt === "some" ? "some" : "none",
  };
}

// ── Nulla-találat javaslatok ─────────────────────────────────
// Melyik aktív szűrő a legszűkítőbb? Minden aktív szűrőre kiszámoljuk,
// hány találat lenne NÉLKÜLE — a legtöbbet visszaadó(k) az elhagyás-
// javaslatok, a várható találatszámmal.

export interface FilterSuggestion<K extends string = string> {
  /** Az elhagyandó szűrő(k) kulcsa(i). */
  drop: K[];
  /** Hány találat lenne az elhagyás után. */
  count: number;
}

export function zeroResultSuggestions<T, K extends string>(
  items: T[],
  activeFilters: { key: K; predicate: (item: T) => boolean }[],
): FilterSuggestion<K>[] {
  if (activeFilters.length === 0) return [];
  const passesAllExcept = (item: T, skip: Set<K>) =>
    activeFilters.every((f) => skip.has(f.key) || f.predicate(item));

  const single: FilterSuggestion<K>[] = activeFilters
    .map((f) => ({
      drop: [f.key],
      count: items.filter((i) => passesAllExcept(i, new Set([f.key]))).length,
    }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);

  const out: FilterSuggestion<K>[] = single.slice(0, 1);
  // Második javaslat: a legjobb egyes + a következő legszűkítőbb együtt,
  // ha az többet ad — a design „»en« + »külső« elhagyása" mintája.
  if (single.length >= 2) {
    const pair: K[] = [single[0].drop[0], single[1].drop[0]];
    const pairCount = items.filter((i) => passesAllExcept(i, new Set(pair))).length;
    if (pairCount > single[0].count) out.push({ drop: pair, count: pairCount });
    else out.push(single[1]);
  }
  return out;
}

// ── Csoportosítás hatókör szerint ────────────────────────────

export interface ScopeGroup<T> {
  /** A hatókör címkéje; null = besorolatlan (nincs scope / nincs címke). */
  scope: string | null;
  items: T[];
  doubtfulCount: number;
}

export function groupByScope<
  T extends { metadata: { scope: string | null } | null; signal: { doubtful: boolean } | null },
>(items: T[]): ScopeGroup<T>[] {
  const groups = new Map<string, T[]>();
  const NONE = " none";
  for (const item of items) {
    const key = item.metadata?.scope ?? NONE;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const named: ScopeGroup<T>[] = [...groups.entries()]
    .filter(([k]) => k !== NONE)
    .sort((a, b) => a[0].localeCompare(b[0], "hu"))
    .map(([scope, list]) => ({
      scope,
      items: list,
      doubtfulCount: list.filter((i) => i.signal?.doubtful).length,
    }));
  const none = groups.get(NONE);
  if (none) {
    named.push({
      scope: null,
      items: none,
      doubtfulCount: none.filter((i) => i.signal?.doubtful).length,
    });
  }
  return named;
}

/** Rövid dátum az eredet-sorba: "03. 04." (év nélkül, a design szerint). */
export function shortOriginDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}. ${dd}.`;
}

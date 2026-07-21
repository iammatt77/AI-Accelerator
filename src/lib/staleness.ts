import type { InputItemRow, StaleAckRow, StaleKind } from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Elavulás-jelölők (Csomag A, A8) — DERIVÁLTAK: minden jelölő időbélyeg-
// összevetésből áll elő, jelölő-állapot NEM tárolódik. Csak a feloldás
// („Ellenőrizve") kerül DB-be (stale_acks); az ack utáni ÚJABB változás
// automatikusan újra jelöl (a trigger-időbélyeg > acked_at).
//   source_updated — az entitás egy forrás RÉGEBBI verziójára hivatkozik,
//                    miközben a csoportban újabb verzió létezik
//   origin_drift   — a P2-eredet (solution_component) a seed-átvétel után
//                    változott (updated_at > seeded_at)
//   doc_stale      — a modul-entitások az utolsó dokumentum-szinkron után
//                    változtak (entitás-változás > artifacts.synced_at)
//   render_stale   — (C1.4) egy artifact renderelés-élének cél-tudáseleme
//                    az él rendered_at-jánál később módosult. A doc_stale
//                    MELLETT él (koegzisztencia — C1 záró jelentés):
//                    a doc_stale a modul-halmaz egészét figyeli él nélkül
//                    is, a render_stale a perzisztált élek cél-pontos jele.
// ─────────────────────────────────────────────────────────────

const ts = (iso: string): number => new Date(iso).getTime();

/** source_updated: a hivatkozott forrás-csoport legfrissebb verziójának
 *  created_at-ja, ha a hivatkozás NEM a legfrissebb verzióra mutat; null,
 *  ha minden hivatkozás friss. `rows` = a projekt ÖSSZES input-sora. */
export function sourceUpdatedSince(
  sourceInputIds: string[],
  rows: InputItemRow[],
): string | null {
  if (sourceInputIds.length === 0 || rows.length === 0) return null;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const latestOfGroup = new Map<string, InputItemRow>();
  for (const r of rows) {
    const gid = r.group_id ?? r.id;
    const cur = latestOfGroup.get(gid);
    if (!cur || (r.version ?? 1) > (cur.version ?? 1)) latestOfGroup.set(gid, r);
  }
  let since: string | null = null;
  for (const id of sourceInputIds) {
    const row = byId.get(id);
    if (!row) continue;
    const latest = latestOfGroup.get(row.group_id ?? row.id);
    if (latest && latest.id !== row.id && (latest.version ?? 1) > (row.version ?? 1)) {
      if (!since || ts(latest.created_at) > ts(since)) since = latest.created_at;
    }
  }
  return since;
}

/** origin_drift: a P2-eredet updated_at-ja, ha a seed-átvétel utánra esik. */
export function originDriftSince(
  seededAt: string | null,
  originUpdatedAt: string | null | undefined,
): string | null {
  if (!seededAt || !originUpdatedAt) return null;
  return ts(originUpdatedAt) > ts(seededAt) ? originUpdatedAt : null;
}

/** doc_stale: az entitások legutóbbi változása, ha az utolsó szinkron
 *  utánra esik. Sync nélkül (synced_at = null) nincs mihez mérni → null
 *  (azt az approve-őr kezeli, nem az elavulás-jelölő). */
export function docStaleSince(
  syncedAt: string | null,
  entityLatestChange: string | null,
): string | null {
  if (!syncedAt || !entityLatestChange) return null;
  return ts(entityLatestChange) > ts(syncedAt) ? entityLatestChange : null;
}

/** render_stale (C1.4): a legkésőbbi cél-változás bélyege, ha egy él
 *  cél-tudáseleme az él rendered_at-ja UTÁN módosult; null, ha minden
 *  renderelt cél friss. targetUpdatedAt kulcsa: `${target_type}:${target_id}`
 *  → updated_at (a törölt/nem található cél nem jelöl — az él árva,
 *  a következő regen/sync cseréli). */
export function renderStaleSince(
  edges: { target_type: string; target_id: string; rendered_at: string }[],
  targetUpdatedAt: Map<string, string>,
): string | null {
  let since: string | null = null;
  for (const e of edges) {
    const updated = targetUpdatedAt.get(`${e.target_type}:${e.target_id}`);
    if (!updated) continue;
    if (ts(updated) > ts(e.rendered_at)) {
      if (!since || ts(updated) > ts(since)) since = updated;
    }
  }
  return since;
}

/** source_updated TÖBB soron egyszerre (C1.4 lánc-általánosítás): bármely
 *  source_input_ids-hordozó tábla soraira — id → trigger-bélyeg, csak a
 *  jelölt sorok kerülnek a map-be. Egyetlen forrás-hivatkozású tábla
 *  (process_maps.source_input_id) sora [id]-ként adható át. */
export function sourceUpdatedForRows(
  rows: { id: string; source_input_ids: string[] }[],
  inputRows: InputItemRow[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    const since = sourceUpdatedSince(r.source_input_ids, inputRows);
    if (since) out.set(r.id, since);
  }
  return out;
}

/** A legutóbbi változás-bélyeg egy entitás-halmazon (updated_at-ok maximuma). */
export function latestChangeOf(rows: { updated_at: string }[]): string | null {
  let latest: string | null = null;
  for (const r of rows) {
    if (!latest || ts(r.updated_at) > ts(latest)) latest = r.updated_at;
  }
  return latest;
}

/** A jelölő el van-e nyugtázva: létezik ack, amely a trigger-időbélyegnél
 *  NEM régebbi. Újabb változás (since > acked_at) → újra jelöl. */
export function isAcked(
  acks: StaleAckRow[],
  subjectType: string,
  subjectId: string,
  kind: StaleKind,
  since: string,
): boolean {
  return acks.some(
    (a) =>
      a.subject_type === subjectType &&
      a.subject_id === subjectId &&
      a.kind === kind &&
      ts(a.acked_at) >= ts(since),
  );
}

/** Kényelmi feloldó: aktív (nem nyugtázott) jelölő-e — null ha nincs mit
 *  jelölni, egyébként a trigger-bélyeg. */
export function activeStaleSince(
  since: string | null,
  acks: StaleAckRow[],
  subjectType: string,
  subjectId: string,
  kind: StaleKind,
): string | null {
  if (!since) return null;
  return isAcked(acks, subjectType, subjectId, kind, since) ? null : since;
}

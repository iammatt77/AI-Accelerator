// ─────────────────────────────────────────────────────────────
// Folyamattérkép (#10, Fázis 4) — chat-szerkesztés tiszta rétege.
//
// E1/HITL: az asszisztens a STRUKTURÁLT lépéslistára tesz javaslatot
// (insert_after / update / remove) — a nyers forrást SOHA nem érinti.
// A javaslat "pending"-ként a chat_log-ba kerül; alkalmazni/elvetni az
// ember tud. Az alkalmazás determinisztikus gráf-műtét (itt), utána a
// hívó újra-layoutol; a diff a mentett original_snapshot ellenében
// számolódik (a beszúrt node id-je nincs a snapshotban → "new").
// ─────────────────────────────────────────────────────────────

import { stripCodeFences } from "@/lib/llm/parse";
import type { ProcessGraph, ProcessNode } from "./model";

export type ProposedChange =
  | {
      op: "insert_after";
      after_id: string;
      title: string;
      sub: string | null;
      type: string;
      desc: string;
      /** Mit és miért — a diff-jegyzethez és a CHAT forrás-ref idézetéhez. */
      note: string;
    }
  | {
      op: "update";
      id: string;
      title?: string;
      sub?: string;
      desc?: string;
      type?: string;
      note: string;
    }
  | { op: "remove"; id: string; note: string };

export interface ChatProposal {
  reply: string;
  changes: ProposedChange[];
}

export interface ChatEntry {
  role: "user" | "assistant";
  text: string;
  at: string;
  /** Csak assistant-bejegyzésen: a strukturált változás-javaslat. */
  proposal?: ProposedChange[];
  proposal_status?: "pending" | "applied" | "discarded";
}

function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

// ── Defenzív parse (LLM JSON → típusos javaslat) ─────────────

/**
 * A chat-LLM kimenetének parse-a. SOSEM dob rossz alak miatt: érvénytelen
 * change-elemeket kihagy (op nélkül, hiányzó id/cím), az értékeket koercionálja.
 */
export function parseChatProposal(raw: string): ChatProposal {
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFences(raw));
  } catch {
    return { reply: "", changes: [] };
  }
  if (typeof json !== "object" || json === null) return { reply: "", changes: [] };
  const obj = json as Record<string, unknown>;
  const reply = str(obj.reply);
  const changes: ProposedChange[] = [];
  if (Array.isArray(obj.changes)) {
    for (const item of obj.changes) {
      if (typeof item !== "object" || item === null) continue;
      const c = item as Record<string, unknown>;
      const note = str(c.note);
      if (c.op === "insert_after") {
        const afterId = str(c.after_id);
        const title = str(c.title);
        if (!afterId || !title) continue;
        changes.push({
          op: "insert_after",
          after_id: afterId,
          title,
          sub: str(c.sub) || null,
          type: str(c.type) || "human",
          desc: str(c.desc),
          note,
        });
      } else if (c.op === "update") {
        const id = str(c.id);
        if (!id) continue;
        const upd: ProposedChange = { op: "update", id, note };
        if (str(c.title)) upd.title = str(c.title);
        if (typeof c.sub === "string") upd.sub = c.sub.trim();
        if (str(c.desc)) upd.desc = str(c.desc);
        if (str(c.type)) upd.type = str(c.type);
        if (upd.title === undefined && upd.sub === undefined && upd.desc === undefined && upd.type === undefined)
          continue;
        changes.push(upd);
      } else if (c.op === "remove") {
        const id = str(c.id);
        if (!id) continue;
        changes.push({ op: "remove", id, note });
      }
    }
  }
  return { reply, changes };
}

// ── Chat-log jsonb → típusos lista ───────────────────────────

export function chatLogFromJson(raw: unknown): ChatEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const e = item as Record<string, unknown>;
    const role = e.role === "assistant" ? "assistant" : e.role === "user" ? "user" : null;
    if (!role) continue;
    const entry: ChatEntry = { role, text: str(e.text), at: str(e.at) };
    if (Array.isArray(e.proposal) && e.proposal.length > 0) {
      entry.proposal = e.proposal as ProposedChange[];
      entry.proposal_status =
        e.proposal_status === "applied" || e.proposal_status === "discarded"
          ? e.proposal_status
          : "pending";
    }
    out.push(entry);
  }
  return out;
}

// ── Alkalmazás (determinisztikus gráf-műtét) ─────────────────

export interface ApplyResult {
  graph: ProcessGraph;
  added: number;
  modified: number;
  removed: number;
}

/**
 * A javasolt változások alkalmazása a gráfon. Tiszta függvény — másolatokon
 * dolgozik, a pozíciókat NEM számolja (a hívó layoutol újra).
 *
 * insert_after: az after_id kimenő élei az új node-ból indulnak tovább
 * (ág-feliratok megmaradnak), after→új él kerül közéjük; az új node
 * forrás-refje CHAT (a nyers leiratra nem hivatkozhat — nem onnan jött).
 * remove: a bejövő élek a kimenő élek céljaira kötődnek át.
 */
export function applyChanges(
  graph: ProcessGraph,
  changes: ProposedChange[],
  chatLoc: string,
): ApplyResult {
  const nodes = graph.nodes.map((n) => ({ ...n }));
  let edges = graph.edges.map((e) => ({ ...e }));
  let added = 0;
  let modified = 0;
  let removed = 0;
  const nextId = () => {
    let i = 1;
    while (nodes.some((n) => n.id === `c${i}`)) i++;
    return `c${i}`;
  };
  for (const ch of changes) {
    if (ch.op === "insert_after") {
      const afterIdx = nodes.findIndex((n) => n.id === ch.after_id);
      if (afterIdx < 0) continue;
      const id = nextId();
      const node: ProcessNode = {
        id,
        title: ch.title,
        sub: ch.sub,
        type: ch.type,
        desc: ch.desc,
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        source_ref: { ref: "CHAT", quote: ch.note || ch.desc, loc: chatLoc },
        open_points: [],
        diff: "new",
        diff_note: ch.note || null,
      };
      for (const e of edges) {
        if (e.from === ch.after_id) e.from = id;
      }
      edges.push({ id: `ec_${id}`, from: ch.after_id, to: id, label: null, fs: "bottom", ts: "top", via: [] });
      nodes.splice(afterIdx + 1, 0, node);
      added++;
    } else if (ch.op === "update") {
      const n = nodes.find((x) => x.id === ch.id);
      if (!n) continue;
      if (ch.title !== undefined) n.title = ch.title;
      if (ch.sub !== undefined) n.sub = ch.sub === "" ? null : ch.sub;
      if (ch.desc !== undefined) n.desc = ch.desc;
      if (ch.type !== undefined) n.type = ch.type;
      if (ch.note) n.diff_note = ch.note;
      modified++;
    } else {
      const idx = nodes.findIndex((x) => x.id === ch.id);
      if (idx < 0) continue;
      const inbound = edges.filter((e) => e.to === ch.id);
      const outbound = edges.filter((e) => e.from === ch.id);
      edges = edges.filter((e) => e.from !== ch.id && e.to !== ch.id);
      for (const i of inbound) {
        for (const o of outbound) {
          if (edges.some((e) => e.from === i.from && e.to === o.to)) continue;
          edges.push({ ...i, id: `${i.id}_r${o.to}`, to: o.to });
        }
      }
      nodes.splice(idx, 1);
      removed++;
    }
  }
  return { graph: { nodes, edges }, added, modified, removed };
}

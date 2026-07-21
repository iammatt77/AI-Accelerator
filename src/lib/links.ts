import type {
  ComponentLinkRow,
  ComponentStepLinkRow,
  ImplLinkRow,
} from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Kötés-vetítők (Csomag A7) — az EGYSÉGES component_links tábla sorait
// vetítik a két meglévő app-modellre. A kliens-komponensek és a modell-
// libek (lib/solution, lib/builddoc) változatlanul ezekkel dolgoznak;
// a tábla-szintű egyesítés a lekérdezés + e vetítés mögött él.
//   · solution-owner sor  → ComponentStepLinkRow (P2 dokkolás)
//   · build-owner sor     → ImplLinkRow (P3 megvalósítás-kötés)
// A kötés-fajta a kitöltött owner-oszlopból áll vissza (A7.1/b).
// ─────────────────────────────────────────────────────────────

/** P2 dokkolás-vetítés: a solution-owner sorok (cél mindig tobe_node). */
export function stepLinksFrom(links: ComponentLinkRow[]): ComponentStepLinkRow[] {
  return links
    .filter(
      (l): l is ComponentLinkRow & { solution_component_id: string; process_map_id: string } =>
        l.solution_component_id !== null &&
        l.target_type === "tobe_node" &&
        l.process_map_id !== null,
    )
    .map((l) => ({
      component_id: l.solution_component_id,
      process_map_id: l.process_map_id,
      node_id: l.target_id,
    }));
}

/** P3 megvalósítás-kötés vetítés: a build-owner sorok (4 cél-típus). */
export function implLinksFrom(links: ComponentLinkRow[]): ImplLinkRow[] {
  return links
    .filter(
      (l): l is ComponentLinkRow & { build_component_id: string } =>
        l.build_component_id !== null,
    )
    .map((l) => ({
      id: l.id,
      component_id: l.build_component_id,
      target_type: l.target_type,
      target_id: l.target_id,
      process_map_id: l.process_map_id,
      state: l.state,
      created_at: l.created_at,
    }));
}

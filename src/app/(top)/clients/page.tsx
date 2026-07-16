import { getLocale, getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { PhaseId } from "@/lib/phases/config";
import { criterionLabel } from "@/lib/phases/criterion-label";
import { loadProjectStates } from "@/lib/projects/state";
import {
  ClientsPortfolio,
  type ClientVM,
  type PortfolioKpis,
} from "@/components/ClientsPortfolio";
import { attentionRank, needsAttention, weekOf, type AttentionLevel } from "@/lib/clients/portfolio";
import type { ClientRow, ProjectRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Ügyfelek — döntési felület (ref_ugyfelek.html). ÉLŐ: név/iparág, aktív
// projekt+fázis, kapu-állapot, utolsó aktivitás, stagnálás (7+ nap), a
// kapu-kritériumból származtatott teendő. PLACEHOLDER (szürke, nincs
// backend): kapcsolat-státusz, szerződés-érték, pénzügyi KPI-k. Nincs új
// CRM-adatmodell/migráció — a hiányzó CRM-adat szürke.
// ─────────────────────────────────────────────────────────────

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

interface ProjectDeriv {
  project: ProjectRow;
  attention: AttentionLevel;
  phase: PhaseId;
  phaseTone: "action" | "done" | "muted";
  todo: string;
  todoTone: ClientVM["todoTone"];
  lastIso: string;
  days: number;
  met: number;
  total: number;
}

export default async function ClientsPage() {
  const supabase = createServiceSupabaseClient();
  const [locale, t, tCriteria, tTypes] = await Promise.all([
    getLocale(),
    getTranslations("clients"),
    getTranslations("criteria"),
    getTranslations("artifactTypes"),
  ]);
  const dateLocale = locale === "hu" ? "hu-HU" : "en-GB";
  const tz = { timeZone: "Europe/Budapest" } as const;
  const nowMs = Date.now();
  const shortDate = (iso: string) =>
    new Date(iso).toLocaleDateString(dateLocale, { ...tz, month: "short", day: "numeric" });
  const timeOf = (iso: string) =>
    new Date(iso).toLocaleTimeString(dateLocale, { ...tz, hour: "2-digit", minute: "2-digit" });

  const [{ data: clientData }, { data: projectData }] = await Promise.all([
    supabase.from("clients").select("*").order("created_at", { ascending: true }),
    supabase.from("projects").select("*"),
  ]);
  const clients = (clientData ?? []) as ClientRow[];
  const projects = (projectData ?? []) as ProjectRow[];
  const projectIds = projects.map((p) => p.id);

  // Projekt-állapotok a KÖZÖS szerver-helperből (ugyanaz, mint a Projektek-lap).
  const states = await loadProjectStates(supabase, projects, nowMs);

  // A közös állapotból a lista-nézet teendő-szövege (i18n a hívónál).
  function deriveProject(project: ProjectRow): ProjectDeriv {
    const s = states.get(project.id)!;
    let todo: string;
    let todoTone: ClientVM["todoTone"];
    if (s.attention === "closed") {
      todo = t("todoClosed");
      todoTone = "done";
    } else if (s.attention === "stalled") {
      todo = t("todoStalled", { n: s.days });
      todoTone = "danger";
    } else if (s.attention === "blocked") {
      todo = t("todoGate", {
        met: s.met,
        total: s.total,
        criterion: s.firstUnmet ? criterionLabel(s.firstUnmet, tCriteria, tTypes) : "",
      });
      todoTone = "gate";
    } else if (s.attention === "ready") {
      todo = t("todoReady", { met: s.met, total: s.total, next: s.nextPhase });
      todoTone = "done";
    } else {
      todo = t("todoHealthy");
      todoTone = "muted";
    }
    return {
      project,
      attention: s.attention,
      phase: s.phase,
      phaseTone: s.isClosed ? "done" : "action",
      todo,
      todoTone,
      lastIso: s.lastIso,
      days: s.days,
      met: s.met,
      total: s.total,
    };
  }

  // Projektenkénti levezetés, majd ügyfelenként a „legfontosabb" projekt.
  const derivByClient = new Map<string, ProjectDeriv[]>();
  for (const p of projects) {
    const list = derivByClient.get(p.client_id) ?? [];
    list.push(deriveProject(p));
    derivByClient.set(p.client_id, list);
  }

  type Enriched = { client: ClientRow; top: ProjectDeriv | null };
  const enriched: Enriched[] = clients.map((client) => {
    const list = (derivByClient.get(client.id) ?? []).slice().sort((a, b) => {
      const r = attentionRank(b.attention) - attentionRank(a.attention);
      if (r !== 0) return r;
      if (a.days !== b.days) return b.days - a.days;
      return b.lastIso.localeCompare(a.lastIso);
    });
    return { client, top: list[0] ?? null };
  });

  // Figyelem-rendezés: blokkolt/áll felül, lezárt/egészséges alul.
  enriched.sort((a, b) => {
    const ra = a.top ? attentionRank(a.top.attention) : attentionRank("none");
    const rb = b.top ? attentionRank(b.top.attention) : attentionRank("none");
    if (rb !== ra) return rb - ra;
    const da = a.top?.days ?? 0;
    const db = b.top?.days ?? 0;
    if (da !== db) return db - da;
    return a.client.name.localeCompare(b.client.name);
  });

  const rows: ClientVM[] = enriched.map(({ client, top }) => {
    const attention: AttentionLevel = top?.attention ?? "none";
    const dimmed = attention === "closed" || attention === "none";
    const agoDanger = attention === "stalled";
    const lastLabel = top
      ? top.days === 0
        ? t("today", { time: timeOf(top.lastIso) })
        : shortDate(top.lastIso)
      : null;
    const agoLabel = top
      ? attention === "stalled"
        ? t("daysAgo", { n: top.days })
        : attention === "closed"
          ? t("liveSince")
          : t("weekN", { n: weekOf(top.project.created_at, nowMs) })
      : null;
    return {
      id: client.id,
      name: client.name,
      industry: client.industry,
      initials: initialsOf(client.name),
      attention,
      projectName: top?.project.name ?? null,
      phase: top?.phase ?? null,
      phaseTone: top?.phaseTone ?? "muted",
      todo: top?.todo ?? null,
      todoTone: top?.todoTone ?? "muted",
      lastLabel,
      agoLabel,
      agoDanger,
      dimmed,
      href: `/clients/${client.id}`,
    };
  });

  // KPI-k (ÉLŐ darabszámok).
  const activeProjects = projects.filter((p) => p.status === "active").length;
  const attentionRows = rows.filter((r) => needsAttention(r.attention));
  const blocked = rows.filter((r) => r.attention === "blocked").length;
  const stalled = rows.filter((r) => r.attention === "stalled").length;
  const kpis: PortfolioKpis = {
    clients: clients.length,
    activeProjects,
    attention: attentionRows.length,
    blocked,
    stalled,
  };

  // Státusz-sor (ÉLŐ, származtatott): hány ügyfél igényel figyelmet + miért.
  const reasons = enriched
    .filter((e) => e.top && needsAttention(e.top.attention))
    .slice(0, 3)
    .map((e) => {
      const top = e.top!;
      return top.attention === "stalled"
        ? t("reasonStalled", { name: e.client.name, n: top.days })
        : t("reasonGate", {
            name: e.client.name,
            phase: top.phase,
            met: top.met,
            total: top.total,
          });
    });
  const statusLine =
    attentionRows.length === 0
      ? t("statusAllClear")
      : t("statusAttention", {
          n: attentionRows.length,
          total: clients.length,
          reasons: reasons.join(" · "),
        });

  return (
    <ClientsPortfolio
      rows={rows}
      kpis={kpis}
      statusLine={statusLine}
      updatedLabel={t("updatedAt", { time: timeOf(new Date(nowMs).toISOString()) })}
    />
  );
}

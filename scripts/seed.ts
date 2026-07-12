/**
 * Demo-seed — Kovács Nyomda Kft. / „AI-felmérés — panaszkezelés"
 *
 * IDEMPOTENS: minden rekord FIX azonosítóval, `upsert` (onConflict: id) —
 * kétszeri futtatás nem duplikál. A TÉNYLEGES sémához igazodik
 * (lásd docs/state/2026-07-12-audit.md, 6. szakasz):
 *   - projekt „kezdés" → created_at (nincs külön start-oszlop)
 *   - input item címe → type oszlop (nincs title oszlop); raw_text szó szerint
 *   - decision cím + indoklás → note; kind = 'gate_close'
 *   - fázis-állapotok: phase_state ENUM-értékek (a 0002 migráció után
 *     futtatandó): P0 completed · P1 in_progress · P2–P6 locked
 *
 * Futtatás: npm run seed
 * Env: SUPABASE_URL (vagy NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
 * — process.env-ből, vagy ha ott hiányzik, a .env.local-ból. Hiány esetén
 * HANGOS hibával áll le.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// ── env betöltés ─────────────────────────────────────────────

function loadEnvLocal(): void {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (process.env[key] !== undefined) continue; // process.env nyer
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function fail(message: string): never {
  console.error(`\n✖ SEED HIBA: ${message}\n`);
  process.exit(1);
}

// ── fix azonosítók (idempotencia-kulcsok) ────────────────────

// Az ÉLŐ (frankfurti) demo-adat azonosítói (B melléklet) — a seed ezekre
// upsertál, hogy második futás ne hozzon létre duplikált demo-projektet.
const ID = {
  client: "a0000000-0000-4000-8000-000000000001",
  project: "b0000000-0000-4000-8000-000000000001",
  phases: {
    P0: "c0000000-0000-4000-8000-000000000000",
    P1: "c0000000-0000-4000-8000-000000000001",
    P2: "c0000000-0000-4000-8000-000000000002",
    P3: "c0000000-0000-4000-8000-000000000003",
    P4: "c0000000-0000-4000-8000-000000000004",
    P5: "c0000000-0000-4000-8000-000000000005",
    P6: "c0000000-0000-4000-8000-000000000006",
  } as Record<string, string>,
  inputs: [
    "d0000000-0000-4000-8000-000000000001",
    "d0000000-0000-4000-8000-000000000002",
    "d0000000-0000-4000-8000-000000000003",
  ],
  artifact: "e0000000-0000-4000-8000-000000000001",
  decision: "f0000000-0000-4000-8000-000000000001",
};

// ── seed-tartalom (a #3 spec szerint szó szerint) ────────────

const INPUT_ITEMS = [
  {
    id: ID.inputs[0],
    type: "Interjú-transzkript — üzemvezető",
    created_at: "2026-06-24T09:00:00Z",
    raw_text:
      "[04:12] Üzemvezető: …minden reggel egy kolléga végigmegy a leveleken és szétdobálja őket kategóriákba, ez simán elmegy másfél napig, mire mindenki megkapja a sajátját. Napi negyven körül jön be, hullámzik. [09:48] Üzemvezető: A sürgős reklamációk is ugyanabban a sorban állnak, mint a sima érdeklődés. Nincs előszűrés. [18:37] Üzemvezető: …nincs egységes sablonunk, mindenki úgy ír, ahogy tud, van, aki két sorban válaszol, más meg egy oldalt. A hangnem is ingadozik. [24:05] Üzemvezető: A vezetőség havi riportot kér a panasz-okokról, azt most kézzel számoljuk Excelben.",
  },
  {
    id: ID.inputs[1],
    type: "AS-IS folyamatvázlat — jegyzet",
    created_at: "2026-06-25T09:00:00Z",
    raw_text:
      "Panasz beérkezik (e-mail, központi cím) → reggeli kézi szétosztás kategóriánként (1 fő, 1–2 nap átfutás) → ügyintéző megválaszolja (saját megfogalmazás) → vezetői jóváhagyás csak kiemelt ügyfélnél → küldés → havi kézi statisztika Excelben.",
  },
  {
    id: ID.inputs[2],
    type: "panasz-export.csv — összefoglaló jegyzet",
    created_at: "2026-06-26T09:00:00Z",
    raw_text:
      "318 sor, 2026 Q2. 5 kategória fedi a 62%-ot (197/318): számlázási hiba (58), szállítási késés (52), minőségi kifogás (41), mennyiségi eltérés (28), egyéb visszatérő (18). A maradék 38% hosszú farok.",
  },
];

const CHARTER_BODY = `# Projekt-charter — AI-felmérés: panaszkezelés

## Cél
A panaszkezelési folyamat AI-alkalmasságának felmérése.

## Scope
P0–P2, Felmérés-csomag.

## Szponzor
Ügyvezető.

## Időkeret
6 hét.

## Sikerkritérium
Priorizált use case-shortlist + business case.
`;

// P0 lezárt · P1 folyamatban · P2–P6 zárt (lineáris kapu-értelmezés,
// állapotgép hiányában — lásd audit 6.2/6.4).
const PHASE_STATES: Record<string, string> = {
  P0: "completed",
  P1: "in_progress",
  P2: "locked",
  P3: "locked",
  P4: "locked",
  P5: "locked",
  P6: "locked",
};

// ── seed-lépések ─────────────────────────────────────────────

async function upsert(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown> | Record<string, unknown>[],
): Promise<void> {
  const { error } = await supabase.from(table).upsert(rows, { onConflict: "id" });
  if (error) {
    fail(
      `${table} upsert sikertelen: ${error.message}` +
        (error.code ? ` [${error.code}]` : "") +
        (error.details ? ` — ${error.details}` : "") +
        (error.hint ? ` (hint: ${error.hint})` : ""),
    );
  }
  console.log(`  ✓ ${table}: ${Array.isArray(rows) ? rows.length : 1} sor upsertelve`);
}

async function countRows(
  supabase: SupabaseClient,
  table: string,
  column: string,
  value: string,
): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(column, value);
  if (error) fail(`${table} számlálás sikertelen: ${error.message}`);
  return count ?? 0;
}

async function main(): Promise<void> {
  loadEnvLocal();

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    fail(
      "hiányzó SUPABASE_URL (vagy NEXT_PUBLIC_SUPABASE_URL) környezeti változó. " +
        "Állítsd be a .env.local-ban vagy a környezetben.",
    );
  }
  if (!serviceKey) {
    fail(
      "hiányzó SUPABASE_SERVICE_ROLE_KEY környezeti változó. " +
        "Állítsd be a .env.local-ban vagy a környezetben.",
    );
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("Seed indul — demo: Kovács Nyomda Kft. / AI-felmérés — panaszkezelés\n");

  // FK-sorrend: client → project → phases → inputs → artifact → decision
  await upsert(supabase, "clients", {
    id: ID.client,
    name: "Kovács Nyomda Kft.",
    industry: "Nyomdaipar",
  });

  await upsert(supabase, "projects", {
    id: ID.project,
    client_id: ID.client,
    name: "AI-felmérés — panaszkezelés",
    package: "Felmérés",
    status: "active",
    created_at: "2026-06-15T09:00:00Z", // kezdés (nincs külön start-oszlop)
  });

  await upsert(
    supabase,
    "phase_instances",
    Object.entries(PHASE_STATES).map(([phase, state]) => ({
      id: ID.phases[phase],
      project_id: ID.project,
      phase,
      state, // phase_state enum-érték (a 0002 migráció UTÁN futtatandó)
      cycle_count: 1,
    })),
  );

  await upsert(
    supabase,
    "input_items",
    INPUT_ITEMS.map((item) => ({ ...item, project_id: ID.project })),
  );

  await upsert(supabase, "artifacts", {
    id: ID.artifact,
    project_id: ID.project,
    type: "Projekt-charter", // az élő adat típus-értéke (P0-kritérium erre szűr)
    version: 1,
    status: "approved",
    body: CHARTER_BODY,
    source_input_ids: [],
    created_at: "2026-06-19T09:00:00Z",
  });

  await upsert(supabase, "decisions", {
    id: ID.decision,
    project_id: ID.project,
    kind: "gate_close",
    note: "P0 kapu lezárva — Charter jóváhagyva, stakeholder-kör rögzítve.",
    created_at: "2026-06-19T09:00:00Z",
  });

  // Rekordszámok (idempotencia-bizonyíték): a seedelt projekt köré szűkítve.
  console.log("\nRekordszámok (seed-hatókör):");
  const counts: [string, number][] = [
    ["clients", await countRows(supabase, "clients", "id", ID.client)],
    ["projects", await countRows(supabase, "projects", "id", ID.project)],
    [
      "phase_instances",
      await countRows(supabase, "phase_instances", "project_id", ID.project),
    ],
    ["input_items", await countRows(supabase, "input_items", "project_id", ID.project)],
    ["artifacts", await countRows(supabase, "artifacts", "project_id", ID.project)],
    ["decisions", await countRows(supabase, "decisions", "project_id", ID.project)],
  ];
  for (const [table, count] of counts) {
    console.log(`  ${table.padEnd(16)} ${count}`);
  }

  console.log("\n✓ Seed kész (idempotens — újrafuttatás nem duplikál).");
}

main().catch((e) => {
  fail(e instanceof Error ? e.message : String(e));
});

// ─────────────────────────────────────────────────────────────
// Ügyfél-portfólió — tiszta származtatások (nincs React/DB). A redesign
// ÉLŐ adata a client/projekt + állapotgép + kapu-logika + utolsó aktivitás;
// a CRM-jellegű mezők (kapcsolat-státusz, szerződés-érték, pénzügyi KPI)
// NINCSENEK a backendben → a komponens SZÜRKE placeholderként mutatja őket
// (nem fabrikál számot). Ez a modul a figyelem-rendezés és a stagnálás
// számítását adja, önállóan tesztelhetően.
//
// Stagnálás-küszöb: 7+ nap utolsó aktivitás nélkül = „áll". Ez a v0.2
// heti-ritmusú tanácsadói ciklushoz igazított, dokumentált érték (nem
// varázsszám); a CRM-csomag később felülírhatja.
// ─────────────────────────────────────────────────────────────

export const STALL_THRESHOLD_DAYS = 7;

/** ÉLŐ figyelem-szint (kapu/stagnálás-állapotból). CRM nem befolyásolja. */
export type AttentionLevel = "blocked" | "stalled" | "ready" | "healthy" | "closed" | "none";

/** Napok az adott időpont óta (egész, lefelé kerekítve). */
export function daysSince(iso: string, nowMs: number): number {
  return Math.floor((nowMs - new Date(iso).getTime()) / 86_400_000);
}

/** Hét sorszáma a kezdés óta (1-alapú), a cockpit „N. hét"-jével egyezően. */
export function weekOf(iso: string, nowMs: number): number {
  return Math.max(1, Math.floor((nowMs - new Date(iso).getTime()) / (7 * 86_400_000)) + 1);
}

/**
 * Rendezési rang: a figyelmet igénylők (blokkolt/áll) felül, a lezárt alul.
 * A ref sorrendje szerint a kapu-blokk a stagnálás fölé kerül (blocked > stalled).
 */
export function attentionRank(a: AttentionLevel): number {
  switch (a) {
    case "blocked":
      return 4;
    case "stalled":
      return 3;
    case "ready":
      return 2;
    case "healthy":
      return 1;
    case "none":
      return 0;
    case "closed":
      return -1;
  }
}

/** Figyelmet igényel-e ma (a KPI/státusz-sor számlálásához). */
export function needsAttention(a: AttentionLevel): boolean {
  return a === "blocked" || a === "stalled";
}

/** A bal szín-sáv token-osztálya a figyelem-szint szerint (ÉLŐ). */
export function barClass(a: AttentionLevel): string {
  if (a === "stalled") return "border-l-danger";
  if (a === "blocked") return "border-l-gate";
  return "border-l-transparent";
}

// Teszt/piszkozat-szűrés: a szemét-projektek (üres/teszt/próba nevűek vagy a
// magánhangzó nélküli „sdfsdf"-szerű gépelés) alapból elrejtve, a szűrőben
// elérhetők. A kritérium DOKUMENTÁLT, nem varázsszám:
//  1) a projekt VAGY az ügyfél neve tartalmaz teszt-kulcsszót (teszt/test/
//     próba/piszkozat/draft/üres/demo), VAGY
//  2) a projekt neve „placeholder-gépelés": ≤2 karakter, vagy nincs benne
//     magánhangzó (pl. „sdfsdf", „asd", „qwe").
const TEST_KEYWORDS = /(teszt|test|pr[oó]ba|piszkozat|draft|[uü]res|dummy|demo|placeholder)/i;
const HAS_VOWEL = /[aáeéiíoóöőuúüűAÁEÉIÍOÓÖŐUÚÜŰ]/;

/** Placeholder-gépelésnek tűnik-e a név (magánhangzó nélküli / túl rövid). */
function looksLikeGibberish(name: string): boolean {
  const n = name.trim();
  if (n.length <= 2) return true;
  return !HAS_VOWEL.test(n);
}

/** Teszt/piszkozat projekt-e (alapból rejtett). Lásd a fenti kritériumot. */
export function isTestProject(projectName: string, clientName: string | null): boolean {
  if (TEST_KEYWORDS.test(projectName) || TEST_KEYWORDS.test(clientName ?? "")) return true;
  return looksLikeGibberish(projectName);
}

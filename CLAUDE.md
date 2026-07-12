# CLAUDE.md — AI Consulting rendszer

A coding agent állandó belépője. Standing szabályok + routing. Minden coding-session ezzel indul; a csomagok NEM ismétlik.

---

## Mi ez a repo

Az „AI Consulting rendszer": egyfelhasználós belső munkakörnyezet, amely egy AI-implementációs tanácsadói projektet végigvezet P0–P6-on. Nyers anyag be → a rendszer strukturál és draftol → ember jóváhagy. Asszisztens, nem irattár. A rendszer **követi** a buildet, nem hosztolja.

## Stack

- **Next.js** (App Router, TypeScript) — frontend + szerveroldali API route-ok / server actions
- **Supabase** (EU / Frankfurt régió) — Postgres + Auth + Storage; encryption at rest
- **Vercel** (EU régió) — deploy
- **LLM:** direkt Anthropic API a `lib/llm` adapter mögött, **szerveroldalról**

## Adatkezelés (governance — kötelező, nem opcionális)

- **Minden LLM-hívás szerveroldalon fut** (API route / server action). Az API-kulcs SOHA nem kerül a kliensre / a böngésző-bundle-be.
- **Minden LLM-hívás egyetlen adapteren** (`lib/llm/index.ts`) megy át. Tilos közvetlen Anthropic-hívás bárhol máshol a kódban.
- **Jelenlegi csatorna:** direkt Anthropic API (Commercial Terms — no training a bemeneten, ~7 napos default retention).
- **Váltás-trigger:** az első EU-adatrezidenciát igénylő ügyfél → az adapter mögötti implementáció Bedrock EU / Vertex EU-ra vált, **a hívó kód érintése nélkül**. Ezért az adapter interfésze csatorna-független.
- **Ügyféladat nyugalmi tárolása:** Supabase EU (Frankfurt).

## Standing szabályok

- **Branch:** csak `dev`. A `main` tiltott külön rendelkezés nélkül. Preview: dev.
- **Spec-kapu:** kódba csak lezárt, Approved specből. A governing spec: *Rendszer funkcionális + UX architektúra v0.2*.
- **Nincs háttérfutás / scope-bővítés:** a csomag scope-ját tartsd; új ötlet → parkoló-lista, nem a csomagba.
- **Titkok:** `.env.local` (soha commitba, gitignore); a kulcsok listája `.env.example`-ben.

## Otthonok (hol mi van)

- **Konvenciók / keret:** project knowledge (Pool) + ez a CLAUDE.md
- **Spec, döntések, állapot:** Notion „AI CONSULTING"
- **Taszkok:** ClickUp „AI CONSULTING"
- **Kód:** ez a repo

## Kanonikus dokumentumok (Pool)

- **Rendszer funkcionális + UX architektúra v0.2** — a governing spec: entitásmodell (§4), fázis-munkaterületek (§6), generálási motor (§8), kapu-térkép/állapotgép (§11), build-sorrend (§14)
- Fázismodell (P0–P6), Fogalomtár, Coding prompt formátum, Modellprotokoll, Spec-sablon, Karbantartási protokoll

## Kód-konvenciók

- TypeScript strict; a szerver-kliens határ tiszta (LLM + titkok szerveroldalon).
- **Design tokenek:** a Claude Design handoffból, amint megvan; addig semleges, calm alap (nem véglegesíteni a vizuált a handoff előtt).
- **Egy fázis-munkaterület = egységes anatómia:** Bemenet → Munkaeszközök → Kimenet → Kapu (§5/§6).
- **Artefaktum-státusz:** Draft → Review → Approved; csak Approved folyik tovább és exportálható.
- **Poka-yoke:** a fázis-átmenetek kemény/puha kapui a §11 térkép szerint (az állapotgép, amikor sorra kerül).

## Verifikáció

- Csomagonként a „Kész, ha" szerint: **önállóan verifikálható** (leszállításkor) vagy **fázis-szinten verifikálandó** (Spec-sablon §3).

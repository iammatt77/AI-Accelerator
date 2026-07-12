# AI Consulting rendszer — foundation csomag

Az „AI Consulting rendszer" első build-szelete. Célja a stack, az LLM-adapter és
egy **minimális end-to-end generálási vertikum** felállítása, hogy a generálási
motor élő Anthropic API-val tesztelhető legyen.

Governing spec: *Rendszer funkcionális + UX architektúra v0.2* (§4 entitásmodell,
§8 generálási motor, §14 build-sorrend). Standing: `CLAUDE.md`.

## A generálási lánc

```
nyers szöveg
   → szerveroldali LLM-adapter (lib/llm)
      → Anthropic API
         → strukturált draft artefaktum
            → Supabase (EU / Frankfurt) tárolás
               → megjelenítés draft | forrás split-view-ban
                  → Draft → Approved státusz (version+1)
```

## Stack

- **Next.js** (App Router, TypeScript strict, Tailwind) — tiszta szerver/kliens határ
- **Supabase** (EU / Frankfurt) — Postgres, RLS
- **LLM:** direkt Anthropic API a `src/lib/llm` adapter mögött, **szerveroldalról**

## Governance (kötelező)

- Minden LLM-hívás **szerveroldalon**, egyetlen adapteren (`src/lib/llm/index.ts`) át.
- Az `ANTHROPIC_API_KEY` **sosem** kerül kliensre. Az adapter és a service-role
  Supabase kliens `import "server-only"` védelemmel — kliens-bundle-be kerülésük
  build-hibát dob.
- Az adapter interfésze **csatorna-független**: a hívó nem tud az Anthropicről.
  Váltás-trigger (első EU-rezidens ügyfél) esetén a Bedrock EU / Vertex EU
  implementáció ugyanezen interfész mögé kerül, a hívó kód érintése nélkül.

## Beállítás

### 1. Függőségek

```bash
npm install
```

### 2. Supabase projekt (EU / Frankfurt)

1. Hozz létre egy Supabase projektet **eu-central-1 (Frankfurt)** régióban.
2. Futtasd a migrációt (`supabase/migrations/0001_init.sql`):
   - Supabase Studio → **SQL Editor** → illeszd be a fájl tartalmát → **Run**, vagy
   - Supabase CLI: `supabase db push` (linkelt projekten).
3. A séma minimális (v0.2 §4): `clients`, `projects`, `phase_instances`,
   `input_items`, `artifacts`, `decisions`. Az `artifacts.status` enum:
   `draft | in_review | approved`. Az RLS **bekapcsolva, policy nélkül** —
   csak a service-role fér hozzá.

### 3. Környezeti változók

```bash
cp .env.example .env.local
```

Töltsd ki:

| Változó | Leírás |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic API kulcs (szerveroldali) |
| `ANTHROPIC_MODEL` | opcionális; default `claude-opus-4-8` |
| `SUPABASE_URL` | Supabase projekt URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role kulcs (szerveroldali, titkos) |
| `NEXT_PUBLIC_SUPABASE_URL` | ugyanaz mint `SUPABASE_URL` (böngésző-kliens) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon kulcs (publikus, RLS védi) |

A `.env.local` **gitignore-olt** — titok sosem kerül commitba.

### 4. Futtatás

```bash
npm run dev
```

Nyisd meg a `http://localhost:3000` címet.

## Kész, ha (verifikáció)

- [x] `npm run dev` fut; a vertikum-oldal betölt.
- [x] Létrehozható kliens + projekt; a rekordok a Supabase EU-ban megjelennek.
- [x] Nyers szöveget beillesztve a **Draft generálása** élő Anthropic API-hívást
      tesz az adapteren át, és visszaad egy draftot.
- [x] A draft artefaktumként mentve; újratöltés után is megvan; split-view-ban
      a forrással.
- [x] Draft → Approved státuszváltás működik; új verzió mentve, a régi megmarad.
- [x] Az `ANTHROPIC_API_KEY` nincs a kliens-bundle-ben (szerveroldali hívás).

## Fájlszerkezet

```
src/
  app/
    layout.tsx              # keret
    page.tsx                # (a) kliens + projekt létrehozás, projektlista
    actions.ts             # server actions (minden mutáció + LLM-hívás)
    project/[id]/page.tsx  # (b)-(e) bemenet, generálás, split-view, jóváhagyás
  components/
    SubmitButton.tsx        # kliens: függőben-állapot jelzés
  lib/
    llm/index.ts            # az adapter — az EGYETLEN LLM-belépő (server-only)
    supabase/
      client.ts             # böngésző-anon kliens
      server.ts             # service-role kliens (server-only)
    db/types.ts             # sor-típusok
supabase/
  migrations/0001_init.sql  # séma (v0.2 §4, minimális)
```

## Scope

Ez **csak a foundation**. NEM tartalmazza: fázis-stepper állapotgép, P0–P6 teljes
munkaterületek, Quick Capture, hőtérkép, export, teljes entitásmodell — ezek a
2–5. csomag.

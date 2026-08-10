# Backend compliance check — Epic 4 · 4.2 (Katalógus-címkézés + admin-felület)

**Dátum:** 2026-08-10 · **Branch:** `dev` · **Spec:** Epic 4 · 4.2 (Approved)
**Eredmény: NINCS STOP** — a spec premisszái állnak. Egy migráció szükséges (0018,
lent jelentve); a 4.1 adat-rétege érintetlen marad.

---

## (1) A 4.1 metaadat-rétege — mezők, horgony, írás

**Tábla:** `knowledge_metadata` (0017). Mezők a négydimenziós kerethez:
`modality` (CHECK: historikus/as_is/normativ/to_be/ismeretlen, default 'ismeretlen') ·
`valid_time` (tstzrange, nyitott vég OK, szövegként pl. `"[2024-01-01,)"`) ·
`lang` (szabad szöveg) · `source_person_stakeholder_id` (FK stakeholders, ref nem másolat) ·
`source_org_level` (CHECK: hq/helyi/kulso/ismeretlen) · `source_kind` (szabad) ·
`scope` (szabad) + explicit elavítás (`deprecated_at/reason`) + `created_at/updated_at`.

**Horgony:** a katalógus négyoszlopos cédula-alakja, két kizárólagos alakkal
(entitás-cédula: `block_id`; artifact_field-cédula: `artifact_id`+`field_key`) —
TS-oldalon `KnowledgeAnchor` + helperek (`src/lib/knowledge/anchor.ts`), DB-oldalon
CHECK + unique index horgonyonként.

**Írás:** `setMetadata(db, projectId, anchor, input)` (`src/lib/knowledge/store.ts:77`) —
részleges patch (csak a megadott mezők), **minden írás bumpolja az `updated_at`-ot**,
read-then-write upsert (shim-kompatibilis). Server action burkoló:
`setKnowledgeMetadataAction` (`src/app/knowledge-actions.ts`). A 4.2 címkéi EZEN az
API-n mennek be — a 4.1-et fogyasztjuk, nem írjuk át.

**A címkézendő elemek listája:** a `knowledge_catalog` nézet (0015, derive-only) adja a
jóváhagyott cédulákat: horgony + `title` + `excerpt` (≤240 kar) + phase + approved_at.
A címkézés (és az embedding) bemenete a cédula-szöveg (`title` + `excerpt`).
*Őszinte korlát:* az osztályozó a cédulát látja, nem a teljes mögöttes szövegtestet —
a 240 karakteres excerpt a katalógus kanonikus kivonata; ha kevésnek bizonyul, a
bővítés a 0015 nézet dolga lenne (nem e csomagé).

## (2) Embedding-adapter + 4.1 store

`src/lib/embeddings/index.ts`: egyetlen belépő (`embed`/`embedOne`), `EMBEDDING_DIM=1024`
**dimenzió-őr az adapterben** (eltérő dimenzió → hiba) + `vector(1024)` a DB-ben.
MOCK_EMBEDDINGS=1: determinisztikus, hálózat nélküli. Valós híváshoz env:
`EMBEDDING_PROVIDER_URL` + `EMBEDDING_API_KEY` + `EMBEDDING_MODEL` +
`EMBEDDING_MODEL_VERSION` (OpenAI-kompat `/embeddings`, hosted BGE-M3; a Vercel-en
konfigurálva — spec §5). Tárolás: `generateEmbedding(db, projectId, anchor, text)`
(`store.ts:179`) — modell név+verzió a vektorral, horgonyonként egy vektor (csere-upsert).
A 4.2-c ezt hívja változtatás nélkül. A valós szolgáltató-kapcsolat verifikációja a
korábbi füstteszten egress-korlát miatt elakadt (sandbox 403 az api.deepinfra.com-ra) —
a záró jelentés Máté-runbookot ad.

## (3) Elavulás-jelölő réteg — mire köt rá az F8

A jelölők **deriváltak** (`src/lib/staleness.ts`): állapot NEM tárolódik, minden jelölő
időbélyeg-összevetés (trigger > referencia), a feloldás a `stale_acks`
(subject_type, subject_id, kind, acked_at). A `render_stale` minta (C1.4): él
(`rendered_at`) vs cél (`updated_at`) — `renderStaleSince(edges, targetUpdatedAt)`.

**Amit a réteg egy elemtől vár: stabil azonosító + változáskor bumpolódó `updated_at`.**
A `knowledge_metadata` MINDKETTŐT adja: a horgony (unique index) az azonosító, és a
`setMetadata` minden címke-írásnál (gépi ÉS emberi) bumpolja az `updated_at`-ot.
**Következtetés (F8): a címkék a `knowledge_metadata`-ban, a `setMetadata`-n át tárolva
KONSTRUKCIÓBÓL rákötési pontot adnak** — a 4.3 findingje (created_at) vs a címke
(updated_at) összevetés pontosan a render_stale alakja, a meglévő helperekkel
számítható, `stale_acks`-szal nyugtázható. **Nincs új mechanizmus; a 4.2 semmit nem
épít ehhez, csak NEM RONTJA EL** (a címke-írás kizárólag setMetadata-n megy).

## (4) LLM-adapter — strukturált kimenet + több-mintás hívás

Minta: prompt-kikényszerített JSON („KIZÁRÓLAG érvényes JSON") + defenzív parse a
`src/lib/llm/parse.ts`-ben (`parseJsonLoose` + koerció; #6-fix elvek). A 4.2
osztályozója ugyanezt a mintát követi (nincs output_config-függés).

**Több-mintás hívásra NINCS előzmény** — a 4.2 vezeti be. **Fontos tény:** a
`temperature`/`top_p`/`top_k` a jelenlegi modellen (claude-opus-4-8) NEM elfogadott
paraméter (400) — a mintavételi változatosság a modell alapértelmezett sztochasztikus
mintavételéből jön: az önkonzisztencia = UGYANAZON hívás N-szeri megismétlése.
Ez a specnek megfelel (a spec önkonzisztenciát ír elő, nem temperature-t).

## (5) Navigáció — hova illik az admin-felület

Globális sidebar: Vezérlőpult / Ügyfelek / Projektek / Beérkező / **Könyvtár
(ComingSoon placeholder)** / Beállítások. Projekt-kontextus nav (`ProjectContextNav`):
Cockpit · Fázis-munkafelület · Dokumentumok · Források · Folyamattérkép ·
Követelmények · Megoldás-terv · Megoldás-dok. · Golden set & riport.

**Döntés:** a katalógus projekt-hatókörű (a nézet project_id-szűrt), ezért az
admin-felület **projekt-szintű route: `/project/[id]/catalog`**, új „Katalógus"
elemmel a ProjectContextNav-ban (a korábbi csomagok bevett integrációs mintája).
A globális „Könyvtár" placeholder érintetlen marad.

---

## Jelentett migráció-szükséglet: 0018 (additív, a 4.1 érintetlen)

A 4.2 új adatai közül a CÍMKÉK maguk a 4.1 tábláiba mennek (setMetadata). Amihez
viszont NINCS tárolóhely, és a spec Must-ként írja elő:

1. **`knowledge_label_signals`** — dimenziónkénti konfidencia-jel: címke + konfidencia
   + indok + bizonyíték-idézet + **szavazatmegoszlás** (F2: tárolandó és megjelenítendő)
   + dimenziónkénti eredet (gép/ember — F4: az emberi címkét a gép nem írja felül)
   + elem-szintű **kétes** jelölés (F3: a 4.3 ezen szűri ki a részvételt).
   Horgonyonként egy sor (a 0017 unique-minta).
2. **`knowledge_label_corrections`** — a javítás-napló (F5): horgony + dimenzió +
   eredeti gépi címke + új emberi címke + a gép akkori konfidenciája + kétes-volt-e
   + időpont. Append-only.

Küszöb-konfiguráció: env (`KNOWLEDGE_CONF_THRESHOLD`, `KNOWLEDGE_VOTE_THRESHOLD`)
konzervatív defaulttal — nem igényel sémát; a hangolás env-állítás.

A migrációt Máté futtatja kézzel (Supabase SQL editor), idempotens — a 0017 mintája.

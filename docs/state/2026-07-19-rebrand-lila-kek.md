# Záró jelentés — „refounded" rebrand: lila → kék, új logó, sidebar-név

**Dátum:** 2026-07-19 · **Branch:** dev · **Ref:** AICON_-_Rebrand_kivonat (lila→kék)
**Jelleg:** design-token + márka-elem csere — NEM funkció-változás. Logika,
elrendezés, tipográfiai hierarchia, státuszszínek változatlanok.

---

## 0) Backend-megfelelés (a csomag előírt első lépése)

| Elem | Hogyan van definiálva | Döntés |
|---|---|---|
| Akcentus-szín | **Szemantikus design-token réteg**: `src/styles/tokens.css` (`:root` CSS-változók) → `src/app/globals.css` `@theme inline` blokk mapolja Tailwind-osztályokra (`bg-action`, `text-action-deep`, `bg-tint-action` stb.). A komponensek KIZÁRÓLAG ezeken keresztül színeznek. | **A token-definíciót írtam át EGY helyen** (`tokens.css`) — nem vak repo-csere. A `@theme` mapping és minden Tailwind-osztálynév változatlan, csak a `var()`-ok mögötti hex változott. |
| Logó | **Nem közös komponens** — inline SVG/doboz `src/app/layout.tsx`-ben, KÉT előfordulásban (ikon-rail + kifejtett sidebar), byte-azonos méret/rádiusz (`h-[30px] w-[30px] rounded-tile`). | Kiemeltem egy lokális `LogoMark` komponensbe (ugyanabban a fájlban — a logó csak itt élt), hogy a két előfordulás ne duplikálja az SVG-t; mindkét hívás ugyanazt a doboz-geometriát örökli. |
| Sidebar-név | **i18n-kulcs**: `nav.brandTitle` (HU + EN, `messages/hu.json` / `messages/en.json`). | Mindkét nyelven `"refounded"`-re állítva (NEM fordítva — a márkanév azonos HU/EN). Az `appTitle` (böngésző-tab metaadat, "AI Consulting rendszer/System") a kiírás szerint NEM sidebar-név, ezért érintetlen. |

## 1) Akcentus-szín: token-réteg + hardcode-olt hexek

**Token-réteg (`tokens.css`) — a szín-térkép szerint, egy helyen:**
`--action-primary`, `--action-hover`, `--action-deep`, `--action-light`,
`--accent-fill`, `--accent-tint`, `--accent-deeptext`, `--status-active`,
`--tint-action` (rgba), `--accent-box`, `--accent-box-border`,
`--shadow-accent` / `--shadow-action` (rgba), `--surface-context` — mind a
megadott lila→kék párok szerint. Ez az EGY módosítás az egész rendszer
akcentusát örökölteti (nav-aktív állapot, CTA-k, fókusz-gyűrű, jelvények,
kártya-szegélyek stb. — mind `var()`-on vagy Tailwind semantic classon át).

**Token-rétegen KÍVÜLI hardcode-olt hexek — egyenkénti csere (nem vak
repo-csere; a repo-ban élő inline stílusok kártya-szegélyeihez/chip-hátteréhez
tartozó lila literálok):** 14 fájl, 121 előfordulás (`ProcessMapViewer.tsx`,
`StakeholderPage.tsx`, `BenefitCalculator.tsx`, `ComponentDetail.tsx`,
`ClientsPortfolio.tsx`, `SolutionBoard.tsx`, `DeriveStoryPanel.tsx`,
`RequirementsBoard.tsx`, `AcEditor.tsx`, `ProcessChatDrawer.tsx`, a
requirement-részlet oldalak, a stakeholder-oldal, `lib/processmap/model.ts`).

**A megadott 17 hex-pár + 5 rgb-triplet mindegyike** pontos, case-insensitive
egyezéssel cserélve.

**8 ÚJ, a listában NEM szereplő lila árnyalat is előkerült** (hue-alapú
scan: H 245–300°, S>8% az egész `src/`-en) — ezek a repo saját, később
hozzáadott lila-származékai (pl. az AI-beavatkozás folyamattérkép-node
kitöltése/szegélye `#F0EBF9`/`#CBB8E8`, amit a Master-jelentés is „lila"-ként
azonosít a kártyaleírásban). Mivel a kiírás szerint „a TELJES lila paletta"
vált kékre, ezeket **ugyanazzal a módszertannal** (a legközelebbi 2-3 megadott
pár HSL-alapú súlyozott interpolációja, azonos világosság megtartásával)
vezettem le és cseréltem:

| Hex | Szerep | Levezetett kék |
|---|---|---|
| `#F3EEFA` | `--accent-tint` (token, nem listázott) | `#EEF3FE` |
| `#FBF5FF` | `--accent-box` (token, nem listázott) | `#F6F9FE` |
| `#F0EBF9` | AI-node kitöltés (processmap) | `#EAF1FE` |
| `#CBB8E8` | AI-node szegély (processmap) | `#BED0F8` |
| `#F7F4FC` | kártya-háttér (BenefitCalculator) | `#F4F8FE` |
| `#EAE3F3` | elválasztó (BenefitCalculator) | `#E5ECFD` |
| `#E9E1F5` | kártya-szegély (RequirementsBoard) | `#E3ECFD` |
| `#7A5FA0` | „VISSZAVEZETHETŐ" felirat-szín (ComponentDetail) | `#1C50CD` |
| `#DDD0EE` | infó-doboz szegély (ProcessMapViewer) | `#CFDBF9` |
| `#A585CE` | nav-pötty (RequirementsBoard) | `#6D98F6` |

Ez explicit, dokumentált feloldás — nem tippelés: a levezetés egy python
szkripttel, a 18 megadott pár HSL-terében súlyozott legközelebbi-szomszéd
interpolációval történt (a kód a jelentéssel együtt reprodukálható).

**Copy-hiba javítva (a rebrand közvetlen következménye):** a folyamattérkép
„TELJES TÉRKÉP" leírása szó szerint ezt mondta: „A **lila** kártyák az
AI-belépési pontok…" (`processMap.ovDescTobe`, HU+EN). Mivel a kártyák
MOST kékek, a szöveg tényszerűen hamis lett volna — HU „lila"→„kék", EN
„Purple cards"→„Blue cards".

**Kódkommentek** (pl. „Típus-szín: folyamat = accent (lila)") — ezeket
SZÁNDÉKOSAN NEM módosítottam a nem-érintett fájlokban (kb. 20 helyen,
`PhaseStepper.tsx`, `EntityForms.tsx` stb.): tisztán belső dokumentáció, nulla
vizuális/funkcionális hatás, és a kiírás explicit tiltja a scope-bővítést.

## 2) Logó

`LogoMark` — fekete doboz (`#0D0D0F`, a doboz-geometria VÁLTOZATLAN:
`h-[30px] w-[30px] rounded-tile`) + a megadott SVG (18×18, a doboz 0,6×
aránya — pontosan a referencia saját 30px-es doboz-példájának aránya).
Mindkét sidebar-előfordulás (ikon-rail + kifejtett) erre az EGY komponensre
mutat.

## 3) Sidebar-név

`nav.brandTitle` → `"refounded"` mindkét `messages/*.json`-ban. A wordmark
`font-brand` (új Tailwind-alias a `--font-bricolage` CSS-változóra) +
`font-extrabold` (800) + `tracking-[-0.02em]` + `text-[#0D0D0F]`. A
**Bricolage Grotesque** betűt `next/font/google`-lel töltöttem be (nem
`<link>` tag-gel) — ez KÖVETI a repo meglévő betűtöltési architektúráját
(Hanken Grotesk + JetBrains Mono is így megy), nem vezet be egy második,
inkonzisztens mechanizmust. A `<head>`-be a Next.js automatikusan
preconnect+font-face-t generál. Az alsó meta-sor (`rendszer · P0–P6`)
változatlan.

## 4) Kemény korlátok — igazolás

- **Elrendezés/méret/spacing/logika változatlan:** a diff kizárólag
  szín-hexeket, a logó tartalmát/hátterét és egy i18n-stringet érint; egyetlen
  Tailwind spacing/layout osztály sem módosult.
- **Státuszszínek érintetlenek:** zöld `#3E9E6E`/`#2E8B5E`, borostyán
  `#B4801E`/`#9A6A12`, piros `#C0455A`, info-kék `#2E77A8` — egyik sem
  szerepelt a törlendő listában, egyik sem módosult (grep-pel igazolva,
  screenshoteken is jól megkülönböztethető a vivid accent-kéktől).
- **Nincs vak repo-csere:** a token-réteg egy helyen módosult; a
  token-rétegen kívüli cserék egyenként, a megadott (és a szükséges esetben
  levezetett) hex-pár szerint történtek.

## 5) Verifikáció

| Ellenőrzés | Eredmény |
|---|---|
| tsc strict / prod build / i18n:check | 0 hiba / zöld / **1429 kulcs HU=EN** |
| Teljes repo case-insensitive lila-sweep (26 hex + 2 rgb-triplet) | **0 találat** `src/` + `messages/`-ben |
| Hue-alapú (HSL) sweep 235–310° tartományban, S>8% | 0 lila-huejű hex marad (a fennmaradó `#FBFBFD`/`#FAFAFC`/`#FDFDFE` közel-fehér neutrálisok, lebegőpontos zaj, nem lila) |
| Cockpit, Projektek, Ügyfelek, Források, Stakeholder-lap, Folyamattérkép, Megoldás-terv (Playwright screenshot) | ✓ mindenhol kék akcentus, ✓ új logó, ✓ „refounded" wordmark |
| Folyamattérkép AI-node (a legkényesebb derivált szín) — a jelmagyarázat-swatch és a tényleges node-kitöltés egyezik | ✓ (`#EAF1FE`/`#1F5AE8`) |
| Copy-hiba (processMap.ovDescTobe „lila"→„kék") | ✓ javítva, mindkét nyelven, screenshot-igazolva |
| 0 backdrop-blur / 0 vízszintes túlcsordulás | ✓ |
| Konzol-hibák | ✓ nincs |

Screenshotok (scratchpad, nem repo): rebrand-projects, rebrand-clients,
rebrand-cockpit, rebrand-p1-workspace (gate-zárt állapot — chrome helyes),
rebrand-stakeholder, rebrand-sources, rebrand-processmap-final,
rebrand-processmap-legend, rebrand-solution.

**FONTOS — a verifikáció jellege:** ez token/CSS-szintű változás, LLM
nélkül, lokálisan (PG16 + PostgREST-shim + prod build) önállóan
verifikálható volt — nem függ valós LLM-kimenettől. A vizuális végső
igazolás a Preview-n történik (a kiírás „Kész, ha" pontja szerint).

## 6) Nálad zárandó (felhasználói teendő)

Preview-n vizuális átnézés a fő képernyőkön: cockpit, P1 munkaterület,
stakeholder-lap, forrástár, ügyfelek, projektek — nincs-e maradék lila,
a logó mindenhol az új jel, a sidebar-név „refounded".

## 7) Harness-jegyzet (nem repo-kód)

A verifikáció a korábbi #12-es session helyi PG16/PostgREST-shim stackjén
futott (ugyanaz az EcoSupport AI demo-adat); egy stakeholder-sort seedeltem
hozzá a stakeholder-lap képernyőhöz. `.env.local` törölve, a szerverek/PG
leállítva.

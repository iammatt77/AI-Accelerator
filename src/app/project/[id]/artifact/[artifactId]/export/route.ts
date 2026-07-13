import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ArtifactRow, ClientRow, InputItemRow, ProjectRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// md-export (Coding-csomag #5b): adott artefaktum-verzió letöltése
// text/markdown-ként. CSAK Approved exportálható — az őr ITT, a
// szerveroldali handlerben él (közvetlen URL-hívásra is), nem a UI-ban.
//
// A dokumentum tartalma a body-hoz hasonlóan UI-nyelvtől FÜGGETLENÜL
// magyar (i18n-védőkorlát: a deliverable nyelve fix; a felület-nyelv a
// tanácsadó kényelme, nem a leszállított dokumentumé). Csak a böngészőben
// megjelenő elutasító üzenet lokalizált.
// ─────────────────────────────────────────────────────────────

interface ProjectWithClient extends ProjectRow {
  clients: ClientRow | null;
}

// Kézi ékezet-transzliteráció (nincs slugify-függőség).
const HU_TRANSLIT: Record<string, string> = {
  á: "a",
  é: "e",
  í: "i",
  ó: "o",
  ö: "o",
  ő: "o",
  ú: "u",
  ü: "u",
  ű: "u",
};

/** ASCII-safe fájlnév-szegmens: kisbetű, ékezet-transzliteráció, minden
 *  más nem-alfanumerikus karakter kötőjellé; minta:
 *  „AI-felmérés — panaszkezelés" → „ai-felmeres-panaszkezeles". */
function asciiSlug(text: string): string {
  return text
    .toLowerCase()
    .split("")
    .map((ch) => HU_TRANSLIT[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Graceful, lokalizált szöveges elutasítás (nem 500). */
async function reject(status: number, key: "notFound" | "notApproved") {
  let message: string;
  try {
    const t = await getTranslations("export");
    message = t(key);
  } catch {
    // A lokalizáció hibája nem akadályozhatja a graceful elutasítást.
    message =
      key === "notFound"
        ? "Az artefaktum nem található."
        : "Csak jóváhagyott (Approved) artefaktum exportálható.";
  }
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

const dateFormat = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "Europe/Budapest",
  dateStyle: "long",
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> },
) {
  const { id, artifactId } = await params;
  const supabase = createServiceSupabaseClient();

  const { data: artifactData, error } = await supabase
    .from("artifacts")
    .select("*")
    .eq("id", artifactId)
    .eq("project_id", id)
    .maybeSingle();
  if (error || !artifactData) {
    return reject(404, "notFound");
  }
  const artifact = artifactData as ArtifactRow;

  // A „csak Approved exportálható" szabály (Fogalomtár §4) — szerveroldalon.
  if (artifact.status !== "approved") {
    return reject(403, "notApproved");
  }

  const { data: projectData } = await supabase
    .from("projects")
    .select("*, clients ( * )")
    .eq("id", id)
    .maybeSingle();
  if (!projectData) {
    return reject(404, "notFound");
  }
  const project = projectData as ProjectWithClient;

  // „Források" függelék: az [n] jelölők a source_input_ids SORRENDJE
  // szerint oldódnak fel (ugyanaz a számozás, mint a szerkesztőben).
  let sourceLines: string[] = [];
  if (artifact.source_input_ids.length > 0) {
    const { data: inputData } = await supabase
      .from("input_items")
      .select("*")
      .in("id", artifact.source_input_ids);
    const byId = new Map(((inputData ?? []) as InputItemRow[]).map((r) => [r.id, r]));
    sourceLines = artifact.source_input_ids
      .map((sid, i) => {
        const row = byId.get(sid);
        return row
          ? `- [${i + 1}] ${row.type} (${dateFormat.format(new Date(row.created_at))})`
          : null;
      })
      .filter((line): line is string => line !== null);
  }

  // Fejléc-blokk + body + (ha van forrás) függelék — fix magyar.
  const documentDate = dateFormat.format(
    new Date(artifact.updated_at ?? artifact.created_at),
  );
  const parts = [
    `# ${artifact.type} — ${project.name}`,
    "",
    `- Projekt: ${project.name}`,
    `- Ügyfél: ${project.clients?.name ?? "—"}`,
    `- Típus: ${artifact.type}`,
    `- Verzió: v${artifact.version} (Approved)`,
    `- Dátum: ${documentDate}`,
    "",
    "---",
    "",
    artifact.body.trim(),
  ];
  if (sourceLines.length > 0) {
    parts.push("", "---", "", "## Források", "", ...sourceLines);
  }
  const markdown = parts.join("\n") + "\n";

  const filename = `${asciiSlug(project.name)}_${asciiSlug(artifact.type)}_v${artifact.version}.md`;

  return new Response(markdown, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

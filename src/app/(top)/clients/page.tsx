import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ClientRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

// Ügyfelek — valós lista, a Dashboard/Repository tömör-lapos kártya-
// nyelvén: fehér sor-kártya, avatar-monogram, projekt-szám pill.

interface ClientWithCount extends ClientRow {
  projects: { count: number }[];
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default async function ClientsPage() {
  const supabase = createServiceSupabaseClient();
  const [tClients, tEmpty, tErrors] = await Promise.all([
    getTranslations("clients"),
    getTranslations("empty"),
    getTranslations("errors"),
  ]);

  const { data, error } = await supabase
    .from("clients")
    .select("*, projects ( count )")
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(tErrors("clientFetchFailed", { message: error.message }));
  }
  const clients = (data ?? []) as ClientWithCount[];

  return (
    <div>
      <h1 className="text-title">{tClients("listTitle")}</h1>

      {clients.length === 0 ? (
        <p className="mt-6 rounded-tile border border-dashed border-line p-6 text-body text-ink-tertiary">
          {tEmpty("noClients")}
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {clients.map((client) => {
            const count = client.projects?.[0]?.count ?? 0;
            return (
              <Link
                key={client.id}
                href={`/clients/${client.id}`}
                className="flex items-center gap-3 rounded-shell border border-line bg-surface p-4 shadow-card transition-shadow duration-[var(--motion-base)] hover:shadow-shell"
              >
                <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-control border border-line bg-sunken font-mono text-[12px] font-bold text-ink-secondary">
                  {initialsOf(client.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-bold tracking-tight">
                    {client.name}
                  </span>
                  <span className="block truncate text-[11.5px] text-ink-tertiary">
                    {client.industry ?? "—"}
                  </span>
                </span>
                <span className="shrink-0 rounded-pill border border-line bg-sunken px-2.5 py-1 font-mono text-[11px] font-semibold text-ink-secondary">
                  {count > 0
                    ? tClients("projectCount", { n: count })
                    : tClients("projectCountZero")}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

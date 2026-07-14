import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ClientRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

// Ügyfelek — valós lista projekt-számmal.

interface ClientWithCount extends ClientRow {
  projects: { count: number }[];
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
      <ul className="mt-6 grid gap-4 lg:grid-cols-2">
        {clients.length === 0 && (
          <li className="rounded-tile border border-dashed border-line p-6 text-body text-ink-tertiary">
            {tEmpty("noClients")}
          </li>
        )}
        {clients.map((client) => (
          <li key={client.id}>
            <Link
              href={`/clients/${client.id}`}
              className="surface-card surface-card-interactive block p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{client.name}</span>
                <span className="font-mono text-metric text-ink-secondary">
                  {client.projects?.[0]?.count ?? 0}
                </span>
              </div>
              <div className="mt-1 text-body text-ink-secondary">
                {client.industry ?? "—"}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Szerveroldali (service-role) Supabase kliens.
// Megkerüli az RLS-t; kizárólag szerver-környezetben (server action / route)
// példányosítható. A "server-only" import build-hibát dob, ha kliens-bundle-be
// kerülne — ez a governance-garancia, hogy a service-role kulcs sosem szivárog.
export function createServiceSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env var missing (.env.local)",
    );
  }

  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

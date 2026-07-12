import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Böngésző-oldali (anon) Supabase kliens.
// Csak a publikus, RLS-védett felületet éri el. Service-role kulcs SOHA nem
// kerül ide. A foundation vertikumban minden mutáció szerveroldalon fut, de a
// spec §2 külön böngésző-anon klienst ír elő — ez az.
export function createBrowserSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY env var missing (.env.local)",
    );
  }

  return createClient(url, anonKey);
}

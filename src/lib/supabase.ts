import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const buildUrl = import.meta.env.VITE_SUPABASE_URL;
const buildKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

export let supabase: SupabaseClient | null = buildUrl && buildKey ? createClient(buildUrl, buildKey) : null;
let loading: Promise<SupabaseClient | null> | null = null;

export function ensureSupabase(): Promise<SupabaseClient | null> {
  if (supabase) return Promise.resolve(supabase);
  if (!loading) {
    loading = fetch("/api/public-config", { cache: "no-store" })
      .then(async response => {
        if (!response.ok) return null;
        const config = await response.json() as { url?: string; key?: string };
        if (!config.url || !config.key) return null;
        supabase = createClient(config.url, config.key);
        return supabase;
      })
      .catch(() => null);
  }
  return loading;
}

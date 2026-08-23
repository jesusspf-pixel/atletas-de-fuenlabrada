import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// La clave publishable de Supabase es pública por diseño (igual que la que ya
// se entrega al navegador en los despliegues de Vite). El respaldo evita que
// Cloudflare deje cerrado el acceso si no inyecta las variables VITE_* al build.
// Nunca contiene la service_role ni secretos de Stripe.
const url = import.meta.env.VITE_SUPABASE_URL || "https://refqwgxihcdaeshqdhlq.supabase.co";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_CNlB4f3cvFzsOD7QFN7lkA_V2SvLrw_";

export let supabase: SupabaseClient | null = createClient(url, key);
export const isSupabaseConfigured = true;

export function ensureSupabase(): Promise<SupabaseClient | null> {
  return Promise.resolve(supabase);
}

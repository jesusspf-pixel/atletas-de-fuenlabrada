import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Pages compila las variables VITE_* dentro del navegador. Este es el arranque
// estable del acceso; los pagos usan Functions aparte y no alteran este cliente.
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

export let supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
export const isSupabaseConfigured = Boolean(supabase);

// Compatibilidad con las pantallas ya desplegadas: no intenta cargar una
// configuración remota que pueda bloquear el inicio de sesión.
export function ensureSupabase(): Promise<SupabaseClient | null> {
  return Promise.resolve(supabase);
}

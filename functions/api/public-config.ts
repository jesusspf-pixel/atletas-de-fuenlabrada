type Env = {
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
};

export const onRequestGet = ({ env }: { env: Env }) => {
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL || "https://refqwgxihcdaeshqdhlq.supabase.co";
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "sb_publishable_CNlB4f3cvFzsOD7QFN7lkA_V2SvLrw_";
  if (!url || !key) {
    return Response.json({ error: "Configuración pública no disponible." }, {
      status: 503,
      headers: { "cache-control": "no-store" }
    });
  }
  return Response.json({ url, key, vapidPublicKey: env.VAPID_PUBLIC_KEY || null }, { headers: { "cache-control": "no-store" } });
};

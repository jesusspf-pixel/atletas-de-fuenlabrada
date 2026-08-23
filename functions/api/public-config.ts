type Env = {
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  SUPABASE_ANON_KEY?: string;
};

export const onRequestGet = ({ env }: { env: Env }) => {
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    return Response.json({ error: "Configuración pública no disponible." }, {
      status: 503,
      headers: { "cache-control": "no-store" }
    });
  }
  return Response.json({ url, key }, { headers: { "cache-control": "no-store" } });
};

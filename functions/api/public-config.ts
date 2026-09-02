type Env = {
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
};

export const onRequestGet = ({ env }: { env: Env }) => {
  // Review builds must fail closed when their isolated Supabase variables are
  // missing. Never fall back to the production project from a preview.
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    return Response.json({ error: "Configuración pública no disponible." }, {
      status: 503,
      headers: { "cache-control": "no-store" }
    });
  }
  return Response.json({ url, key, vapidPublicKey: env.VAPID_PUBLIC_KEY || null }, { headers: { "cache-control": "no-store" } });
};

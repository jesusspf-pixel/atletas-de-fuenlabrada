type RateLimitEnv = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

export async function consumePublicRateLimit(
  request: Request,
  env: RateLimitEnv,
  action: string,
  subject: string,
  maximum: number,
  windowSeconds: number,
) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return false;
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${action}|${subject.trim().toLowerCase()}|${ip}`),
  );
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/consume_public_rate_limit`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      target_action: action,
      target_key_hash: hex(digest),
      max_requests: maximum,
      window_seconds: windowSeconds,
    }),
  });
  // Deployments may briefly run before the matching migration reaches the
  // database. Do not lock legitimate users out during that narrow window.
  if (response.status === 404) return true;
  if (!response.ok) return false;
  return (await response.json().catch(() => false)) === true;
}

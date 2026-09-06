interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY: string;
}

type AuthUser = { email?: string | null; email_confirmed_at?: string | null; deleted_at?: string | null };
const TARGET_HASHES = new Set([
  "fafd55e87e0bdaeda28d18f3d08b03cb888c6bbb84e7b1f9303b0740edb248b7",
  "f2ffe0964ab9e8148d09d50f4171c49947726561f59d87e17a64277e4429378b",
  "3dee3031dc1dfa7f11f639ac557d169294a9240e8740174034782879e29111a0",
]);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, "0")).join("");

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "La sesión ha caducado." }, 401);
  const serviceHeaders = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
  const authResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${token}` } });
  const currentUser = await authResponse.json().catch(() => null) as { id?: string } | null;
  if (!authResponse.ok || !currentUser?.id) return json({ error: "La sesión ha caducado." }, 401);
  const profileResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${currentUser.id}&select=role`, { headers: serviceHeaders });
  const profiles = await profileResponse.json().catch(() => []) as { role?: string }[];
  if (!["owner", "admin"].includes(profiles[0]?.role || "")) return json({ error: "Solo administración puede realizar este envío." }, 403);

  const usersResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, { headers: serviceHeaders });
  const payload = await usersResponse.json().catch(() => null) as { users?: AuthUser[] } | AuthUser[] | null;
  if (!usersResponse.ok || !payload) return json({ error: "No se pudieron localizar las cuentas antiguas." }, 502);
  const users = Array.isArray(payload) ? payload : payload.users || [];
  const recipients: string[] = [];
  for (const user of users) {
    const email = user.email?.trim().toLowerCase();
    if (email && !user.deleted_at && !user.email_confirmed_at && TARGET_HASHES.has(await hash(email))) recipients.push(email);
  }
  if (recipients.length !== TARGET_HASHES.size) return json({ error: `Solo se localizaron ${recipients.length} de las 3 cuentas antiguas. No se ha enviado nada.` }, 409);

  const subject = "Aclaración sobre el correo anterior del Club Atletas de Fuenlabrada";
  const text = "Hola:\n\nEl correo anterior sobre completar el registro se envió por error al detectar una cuenta antigua que quedó incompleta.\n\nTu atleta ya está correctamente dado de alta en el club mediante otra cuenta confirmada. No tienes que repetir la inscripción, confirmar esta cuenta antigua ni realizar ningún pago. Puedes ignorar el mensaje anterior y seguir utilizando la cuenta habitual con la que accedes actualmente.\n\nDisculpa las molestias.\n\nClub Atletas de Fuenlabrada";
  const html = `<div style="font-family:Arial,sans-serif;color:#10233f;line-height:1.65;max-width:640px;margin:auto"><h2 style="color:#1559b2">Aclaración sobre el correo anterior</h2><p>Hola:</p><p>El correo anterior sobre completar el registro se envió por error al detectar una cuenta antigua que quedó incompleta.</p><p><strong>Tu atleta ya está correctamente dado de alta en el club mediante otra cuenta confirmada.</strong> No tienes que repetir la inscripción, confirmar esta cuenta antigua ni realizar ningún pago.</p><p>Puedes ignorar el mensaje anterior y seguir utilizando la cuenta habitual con la que accedes actualmente.</p><p>Disculpa las molestias.</p><hr style="border:0;border-top:1px solid #dbe6f2;margin:28px 0"><p style="font-size:13px;color:#617087">Club Atletas de Fuenlabrada</p></div>`;
  const response = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(recipients.map((email) => ({ from: "Club Atletas de Fuenlabrada <info@atletasdefuenlabrada.com>", reply_to: "info@atletasdefuenlabrada.com", to: [email], subject, text, html }))),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { message?: string } | null;
    return json({ error: detail?.message || "El proveedor de correo no aceptó el envío." }, 502);
  }
  return json({ sent: recipients.length });
};

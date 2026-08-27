type Env = { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string; RESEND_API_KEY?: string };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const safe = (value: string) => value.replace(/[<>&"']/g, character => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[character] || character);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.RESEND_API_KEY) return json({ error: "Servicio de invitaciones no configurado." }, 503);
  const { batchToken } = await request.json<{ batchToken?: string }>().catch(() => ({}));
  if (!batchToken) return json({ error: "Falta el identificador seguro del envío." }, 400);
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" };
  const batchResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/family_invitation_delivery_batches?token=eq.${encodeURIComponent(batchToken)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id,status,total_count,sent_count,failed_count`, { headers });
  const batch = (await batchResponse.json().catch(() => []))?.[0];
  if (!batch) return json({ error: "El envío no existe o ha caducado." }, 404);
  if (batch.status === "completed") return json({ ok: true, alreadyCompleted: true, sent: batch.sent_count, failed: batch.failed_count });
  await fetch(`${env.SUPABASE_URL}/rest/v1/family_invitation_delivery_batches?id=eq.${batch.id}`, { method: "PATCH", headers, body: JSON.stringify({ status: "processing" }) });
  // Pages Functions have a per-request subrequest limit. Each invitation needs
  // three calls (mark sending, Resend, mark result), so process a safe chunk and
  // let the caller continue the same auditable batch without duplicating sent mail.
  const chunkSize = 12;
  const invitationsResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/family_renewal_invitations?delivery_batch_id=eq.${batch.id}&delivery_status=in.(pending,failed)&select=id,email,token&order=created_at.asc&limit=${chunkSize}`, { headers });
  const invitations = await invitationsResponse.json().catch(() => []);
  let sent = Number(batch.sent_count || 0), failed = 0;
  const failures: Array<{ id: string; error: string }> = [];
  for (const invitation of invitations) {
    await fetch(`${env.SUPABASE_URL}/rest/v1/family_renewal_invitations?id=eq.${invitation.id}`, { method: "PATCH", headers, body: JSON.stringify({ delivery_status: "sending", delivery_error: null }) });
    const link = `https://atletasdefuenlabrada.com/?renewal=${invitation.token}`;
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: "Club Atletas de Fuenlabrada <info@atletasdefuenlabrada.com>", to: [invitation.email], subject: "Completa tu renovación · Atletas de Fuenlabrada", html: `<div style="font-family:Arial,sans-serif;color:#10233f;line-height:1.6"><h2 style="color:#1559b2">Tu acceso al club ya está preparado</h2><p>Hola:</p><p>Como miembro del Club Atletas de Fuenlabrada, puedes completar tu ficha familiar y la de los atletas a tu cargo mediante el siguiente enlace personal.</p><p><strong>La matrícula ya consta como abonada</strong>, por lo que no volverá a cobrarse durante este proceso.</p><p><a href="${safe(link)}" style="display:inline-block;padding:13px 20px;border-radius:10px;background:#1559b2;color:#fff;text-decoration:none;font-weight:bold">Completar mi renovación</a></p><p>Este enlace es personal, está asociado a ${safe(invitation.email)} y caduca en 30 días.</p><p>Club Atletas de Fuenlabrada</p></div>` }) });
    if (response.ok) {
      sent += 1;
      await fetch(`${env.SUPABASE_URL}/rest/v1/family_renewal_invitations?id=eq.${invitation.id}`, { method: "PATCH", headers, body: JSON.stringify({ delivery_status: "sent", delivered_at: new Date().toISOString(), delivery_error: null }) });
    } else {
      failed += 1;
      const detail = await response.text();
      const error = `Resend ${response.status}: ${detail.slice(0, 300)}`;
      failures.push({ id: invitation.id, error });
      await fetch(`${env.SUPABASE_URL}/rest/v1/family_renewal_invitations?id=eq.${invitation.id}`, { method: "PATCH", headers, body: JSON.stringify({ delivery_status: "failed", delivery_error: error }) });
    }
  }
  const status = failed ? (sent ? "partial" : "failed") : invitations.length < chunkSize ? "completed" : "processing";
  await fetch(`${env.SUPABASE_URL}/rest/v1/family_invitation_delivery_batches?id=eq.${batch.id}`, { method: "PATCH", headers, body: JSON.stringify({ status, sent_count: sent, failed_count: failed, result: { failures }, completed_at: new Date().toISOString() }) });
  return json({ ok: failed === 0, status, sent, failed, processed: invitations.length, continue: status === "processing" });
};

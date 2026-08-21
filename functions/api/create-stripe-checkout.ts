const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function onRequestPost(context: any) {
  const env = context.env as { STRIPE_SECRET_KEY?: string; SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  if (!env.STRIPE_SECRET_KEY || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "El pago con tarjeta aún no está conectado por el club." }, 503);
  const token = context.request.headers.get("authorization");
  if (!token) return json({ error: "Inicia sesión para pagar." }, 401);
  const { orderId } = await context.request.json().catch(() => ({}));
  if (!orderId) return json({ error: "Falta el pedido." }, 400);
  const auth = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: token } });
  const user = await auth.json().catch(() => null) as { id?: string } | null;
  if (!auth.ok || !user?.id) return json({ error: "No se pudo validar la sesión." }, 401);
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" };
  const orderResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/club_orders?id=eq.${encodeURIComponent(orderId)}&select=id,created_by,total_cents,status,club_order_items(product_name,size,quantity,unit_price_cents)`, { headers });
  const [order] = await orderResponse.json().catch(() => []) as any[];
  if (!orderResponse.ok || !order || order.created_by !== user.id) return json({ error: "No se encontró tu pedido." }, 404);
  if (order.status === "cancelled") return json({ error: "Este pedido está cancelado." }, 409);
  const line = order.club_order_items?.[0];
  if (!line) return json({ error: "El pedido no tiene artículos." }, 400);
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", `${new URL(context.request.url).origin}/?checkout=success`);
  params.set("cancel_url", `${new URL(context.request.url).origin}/?checkout=cancelled`);
  params.set("payment_method_types[0]", "card");
  params.set("line_items[0][price_data][currency]", "eur");
  params.set("line_items[0][price_data][product_data][name]", `${line.product_name}${line.size ? ` · talla ${line.size}` : ""}`);
  params.set("line_items[0][price_data][unit_amount]", String(line.unit_price_cents));
  params.set("line_items[0][quantity]", String(line.quantity));
  params.set("metadata[order_id]", order.id);
  const stripe = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" }, body: params });
  const checkout = await stripe.json().catch(() => ({})) as { id?: string; url?: string; error?: { message?: string } };
  if (!stripe.ok || !checkout.url) return json({ error: checkout.error?.message || "Stripe no pudo iniciar el pago." }, 502);
  await fetch(`${env.SUPABASE_URL}/rest/v1/club_orders?id=eq.${encodeURIComponent(order.id)}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ stripe_checkout_session_id: checkout.id, payment_status: "pending", updated_at: new Date().toISOString() }) });
  return json({ url: checkout.url });
}

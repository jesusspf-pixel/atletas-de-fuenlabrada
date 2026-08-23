import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type RuleSet = {
  monthly_cents: number; term_autumn_cents: number; term_winter_cents: number; term_spring_cents: number;
  full_rate_through_day: number; half_rate_through_day: number; family_discount_members: number;
  monthly_family_discount_percent: number; enrolment_family_discount_percent: number;
};
type Membership = { id: string; season: string; plan: "monthly" | "term"; athletes?: { first_name: string; last_name: string } | null };
type Draft = {
  id: string; membership_id: string; charge_kind: "enrolment" | "recurring" | "manual"; scheduled_for: string;
  calculated_amount_cents: number; approved_amount_cents: number | null; discount_cents: number; status: string;
  admin_note: string | null; override_reason: string | null; athletes?: { first_name: string; last_name: string } | null;
  memberships?: { season: string; plan: string } | null;
};

const euro = (cents: number | null | undefined) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format((cents || 0) / 100);
const field = (value: number) => (value / 100).toFixed(2);

export default function BillingControlCenter() {
  const [rules, setRules] = useState<RuleSet | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [membershipId, setMembershipId] = useState("");
  const [kind, setKind] = useState<"enrolment" | "recurring">("recurring");
  const [scheduledFor, setScheduledFor] = useState(new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState("");

  const load = async () => {
    const client = supabase; if (!client) return;
    setBusy(true);
    const [rulesResult, membershipsResult, draftsResult] = await Promise.all([
      client.from("club_billing_rules").select("*").eq("id", true).maybeSingle(),
      client.from("memberships").select("id,season,plan,athletes(first_name,last_name)").order("created_at", { ascending: false }),
      client.from("billing_charge_drafts").select("id,membership_id,charge_kind,scheduled_for,calculated_amount_cents,approved_amount_cents,discount_cents,status,admin_note,override_reason,athletes(first_name,last_name),memberships(season,plan)").order("scheduled_for", { ascending: true }),
    ]);
    if (rulesResult.data) setRules(rulesResult.data as RuleSet);
    setMemberships((membershipsResult.data ?? []) as unknown as Membership[]);
    setDrafts((draftsResult.data ?? []) as unknown as Draft[]);
    setMessage(rulesResult.error?.message || membershipsResult.error?.message || draftsResult.error?.message || "");
    setBusy(false);
  };
  useEffect(() => { void load(); }, []);

  const totals = useMemo(() => ({
    forecast: drafts.filter(d => ["awaiting_admin", "approved", "checkout_pending"].includes(d.status)).reduce((sum, d) => sum + (d.approved_amount_cents ?? d.calculated_amount_cents), 0),
    approved: drafts.filter(d => d.status === "approved").reduce((sum, d) => sum + (d.approved_amount_cents ?? 0), 0),
    paid: drafts.filter(d => d.status === "paid").reduce((sum, d) => sum + (d.approved_amount_cents ?? d.calculated_amount_cents), 0),
    review: drafts.filter(d => d.status === "awaiting_admin").length,
  }), [drafts]);

  const saveRules = async (event: FormEvent) => {
    event.preventDefault(); const client = supabase; if (!client || !rules) return;
    setBusy(true); setMessage("");
    const { error } = await client.from("club_billing_rules").upsert({ id: true, ...rules, updated_at: new Date().toISOString() });
    setBusy(false); setMessage(error ? error.message : "Reglas de cálculo guardadas.");
  };

  const createDraft = async (event: FormEvent) => {
    event.preventDefault(); const client = supabase; if (!client || !membershipId) return;
    setBusy(true); setMessage("");
    const { error } = await client.rpc("create_billing_charge_draft", {
      target_membership_id: membershipId, target_kind: kind, target_scheduled_for: scheduledFor,
    });
    if (!error) { setMembershipId(""); await load(); }
    else setBusy(false);
    setMessage(error ? error.message : "Borrador calculado. Revísalo antes de aprobarlo.");
  };

  const updateDraft = async (draft: Draft, nextStatus: string) => {
    const client = supabase; if (!client) return;
    const amount = Number(window.prompt("Importe final en euros", field(draft.approved_amount_cents ?? draft.calculated_amount_cents)));
    if (!Number.isFinite(amount) || amount < 0) return;
    const reason = window.prompt("Motivo del ajuste o de la decisión (obligatorio si cambias el importe)", draft.override_reason || draft.admin_note || "") ?? "";
    if (Math.round(amount * 100) !== draft.calculated_amount_cents && !reason.trim()) {
      setMessage("Indica el motivo del ajuste para conservar la trazabilidad."); return;
    }
    setBusy(true); setMessage("");
    const { error } = await client.from("billing_charge_drafts").update({
      approved_amount_cents: Math.round(amount * 100), status: nextStatus,
      override_reason: reason.trim() || null, admin_note: reason.trim() || draft.admin_note,
    }).eq("id", draft.id);
    if (!error) await load(); else { setBusy(false); setMessage(error.message); }
  };

  const prepareStripeCheckout = async (draft: Draft) => {
    const client = supabase; if (!client) return;
    setBusy(true); setMessage(""); setCheckoutUrl("");
    const { data: sessionData } = await client.auth.getSession();
    const response = await fetch("/api/create-approved-charge-checkout", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sessionData.session?.access_token || ""}` },
      body: JSON.stringify({ draftId: draft.id }),
    });
    const body = await response.json().catch(() => ({})) as { url?: string; error?: string };
    setBusy(false);
    if (!response.ok || !body.url) return setMessage(body.error || "No se pudo preparar Stripe.");
    setCheckoutUrl(body.url);
    setMessage("Enlace de pago Stripe preparado. Puedes abrirlo o enviarlo a la familia.");
    void load();
  };

  if (!rules) return <section className="panel"><h2>Cuotas y cobros</h2><p>{busy ? "Cargando centro de control…" : message || "No se pudo cargar la configuración de cobros."}</p></section>;

  return <section className="billing-control">
    <div className="page-head"><div><small>ADMINISTRACIÓN</small><h1>Centro de cuotas y cobros</h1><p>Primero se calcula y revisa; solo después se autoriza el pago. Todo cambio queda registrado.</p></div><button className="outline" disabled={busy} onClick={() => void load()}>Actualizar</button></div>
    <section className="metric-grid">
      <article className="metric"><small>Previsión pendiente</small><b>{euro(totals.forecast)}</b></article>
      <article className="metric"><small>Listo para aprobar</small><b>{totals.review}</b></article>
      <article className="metric"><small>Aprobado, pendiente de cobro</small><b>{euro(totals.approved)}</b></article>
      <article className="metric"><small>Registrado como cobrado</small><b>{euro(totals.paid)}</b></article>
    </section>

    <section className="two-columns">
      <form className="panel stacked-form" onSubmit={saveRules}>
        <h2>Reglas editables</h2>
        <label>Cuota mensual (€)<input type="number" min="0" step="0.01" value={field(rules.monthly_cents)} onChange={e => setRules({ ...rules, monthly_cents: Math.round(Number(e.target.value || 0) * 100) })} /></label>
        <label>Septiembre–noviembre (€)<input type="number" min="0" step="0.01" value={field(rules.term_autumn_cents)} onChange={e => setRules({ ...rules, term_autumn_cents: Math.round(Number(e.target.value || 0) * 100) })} /></label>
        <label>Diciembre–febrero (€)<input type="number" min="0" step="0.01" value={field(rules.term_winter_cents)} onChange={e => setRules({ ...rules, term_winter_cents: Math.round(Number(e.target.value || 0) * 100) })} /></label>
        <label>Marzo–junio · 4 meses (93 €)<input type="number" min="0" step="0.01" value={field(rules.term_spring_cents)} onChange={e => setRules({ ...rules, term_spring_cents: Math.round(Number(e.target.value || 0) * 100) })} /></label>
        <label>Cuota completa hasta el día<input type="number" min="1" max="28" value={rules.full_rate_through_day} onChange={e => setRules({ ...rules, full_rate_through_day: Number(e.target.value) })} /></label>
        <label>Media cuota hasta el día<input type="number" min="1" max="28" value={rules.half_rate_through_day} onChange={e => setRules({ ...rules, half_rate_through_day: Number(e.target.value) })} /></label>
        <label>Descuento familiar desde atletas activos<input type="number" min="1" value={rules.family_discount_members} onChange={e => setRules({ ...rules, family_discount_members: Number(e.target.value) })} /></label>
        <label>Descuento mensual familiar (%)<input type="number" min="0" max="100" step="0.01" value={rules.monthly_family_discount_percent} onChange={e => setRules({ ...rules, monthly_family_discount_percent: Number(e.target.value) })} /></label>
        <label>Descuento matrícula familiar (%)<input type="number" min="0" max="100" step="0.01" value={rules.enrolment_family_discount_percent} onChange={e => setRules({ ...rules, enrolment_family_discount_percent: Number(e.target.value) })} /></label>
        <button disabled={busy}>Guardar reglas</button>
      </form>

      <form className="panel stacked-form" onSubmit={createDraft}>
        <h2>Preparar cobro</h2>
        <p>Calcula el importe aplicando la fecha de alta, el tipo de cuota y los descuentos familiares. Después podrás modificarlo antes de aprobarlo.</p>
        <label>Atleta y cuota<select required value={membershipId} onChange={e => setMembershipId(e.target.value)}><option value="">Selecciona una cuota</option>{memberships.map(m => <option key={m.id} value={m.id}>{m.athletes?.first_name} {m.athletes?.last_name} · {m.plan === "monthly" ? "Mensual" : "Trimestral"} · {m.season}</option>)}</select></label>
        <label>Concepto<select value={kind} onChange={e => setKind(e.target.value as "enrolment" | "recurring")}><option value="recurring">Cuota</option><option value="enrolment">Matrícula</option></select></label>
        <label>Fecha prevista<input type="date" value={scheduledFor} onChange={e => setScheduledFor(e.target.value)} /></label>
        <button disabled={busy || !membershipId}>{busy ? "Calculando…" : "Crear borrador calculado"}</button>
        <small>Nunca genera un cobro automático: queda «Pendiente de revisión».</small>
      </form>
    </section>

    {message && <p className={message.includes("guardadas") || message.includes("Borrador") || message.includes("preparado") ? "success-note panel" : "error-note panel"}>{message}</p>}
    {checkoutUrl && <article className="panel"><h2>Enlace de pago preparado</h2><p className="link-box">{checkoutUrl}</p><button onClick={() => window.location.assign(checkoutUrl)}>Abrir Stripe Checkout</button> <button className="outline" onClick={() => void navigator.clipboard.writeText(checkoutUrl)}>Copiar enlace para la familia</button></article>}
    <section className="panel table"><h2>Control financiero de cuotas</h2>{drafts.map(draft => <div className="row" key={draft.id}><span><b>{draft.athletes?.first_name} {draft.athletes?.last_name}</b><small>{draft.charge_kind === "enrolment" ? "Matrícula" : "Cuota"} · {draft.memberships?.plan === "monthly" ? "Mensual" : "Trimestral"} · prevista {new Date(draft.scheduled_for).toLocaleDateString("es-ES")}</small></span><span><small>Calculado</small><b>{euro(draft.calculated_amount_cents)}</b>{draft.discount_cents > 0 && <small>Descuento: {euro(draft.discount_cents)}</small>}</span><span><small>Final</small><b>{euro(draft.approved_amount_cents ?? draft.calculated_amount_cents)}</b><small>{draft.status}</small></span><span>{draft.status === "awaiting_admin" && <><button disabled={busy} onClick={() => void updateDraft(draft, "approved")}>Revisar y aprobar</button> <button className="outline" disabled={busy} onClick={() => void updateDraft(draft, "waived")}>Eximir</button></>}{draft.status === "approved" && <><button disabled={busy} onClick={() => void prepareStripeCheckout(draft)}>Preparar pago Stripe</button> <button className="outline" disabled={busy} onClick={() => void updateDraft(draft, "awaiting_admin")}>Volver a revisión</button></>}</span></div>)}{!drafts.length && <p>Aún no hay cuotas preparadas. Crea el primer borrador arriba.</p>}</section>
  </section>;
}

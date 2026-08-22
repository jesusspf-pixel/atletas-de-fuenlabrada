import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Membership = {
  id: string;
  athlete_id: string;
  season: string;
  plan: "monthly" | "term";
  enrolment_fee_status: string;
  enrolment_fee_cents: number | null;
  fee_provider: string;
  billing_status?: string | null;
  next_billing_on?: string | null;
  stripe_price_amount_cents?: number | null;
  athletes?: { first_name: string; last_name: string; training_category?: string | null; official_competition_category?: string | null } | null;
};

type Preview = { membershipId: string; url: string; athlete: string; enrolment: number; recurring: number; everyMonths: number; totalToday: number };

const euro = (cents: number) => `${(cents / 100).toFixed(2).replace(".00", "")} €`;
const statusLabel = (value?: string | null) => ({ not_configured: "Pendiente de configurar", checkout_pending: "Pago pendiente", active: "Activa", past_due: "Pago fallido", cancelled: "Cancelada", paused: "Pausada" } as Record<string,string>)[value || ""] || value || "Pendiente";

export default function MembershipBillingPage({ role }: { role: string | null }) {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const manager = role === "owner" || role === "admin";

  const load = async () => {
    const client = supabase; if (!client) return;
    setLoading(true);
    const { data, error } = await client.from("memberships").select("id,athlete_id,season,plan,enrolment_fee_status,enrolment_fee_cents,fee_provider,billing_status,next_billing_on,stripe_price_amount_cents,athletes(first_name,last_name,training_category,official_competition_category)").order("created_at", { ascending: false });
    setMemberships((data ?? []) as unknown as Membership[]);
    if (error) setNotice(error.message);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const prepare = async (membershipId: string) => {
    const client = supabase; if (!client) return;
    setBusyId(membershipId); setNotice(""); setPreview(null);
    const { data } = await client.auth.getSession();
    const response = await fetch("/api/create-membership-checkout", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token || ""}` },
      body: JSON.stringify({ membershipId }),
    });
    const result = await response.json().catch(() => ({}));
    setBusyId("");
    if (!response.ok || !result.url) return setNotice(result.error || "No se pudo preparar el pago.");
    setPreview({
      membershipId,
      url: result.url,
      athlete: result.summary?.athlete || "Atleta",
      enrolment: Number(result.summary?.enrolment_cents || 0),
      recurring: Number(result.summary?.recurring_cents || 0),
      everyMonths: Number(result.summary?.recurring_every_months || 1),
      totalToday: Number(result.summary?.total_today_cents || 0),
    });
  };

  return <main className="club-shell"><aside className="club-side"><div className="portal-brand"><b>AF</b><span>CUOTAS<small>Y COBROS</small></span></div><div className="side-user"><a className="button-link outline" href="/">← Volver a la aplicación</a></div></aside><section className="club-content"><header className="topbar"><span>Club Atletas de Fuenlabrada · Pagos</span></header><div className="page-head"><div><h1>Cuotas y cobros</h1><p>{manager ? "Estado real de las cuotas y suscripciones del club." : "Revisa el importe antes de configurar el pago recurrente con tarjeta."}</p></div></div>

    <section className="two-columns"><article className="panel"><h2>Pago con tarjeta</h2><p>Los pagos recurrentes se gestionan mediante Stripe. El club no almacena el número de tarjeta ni el CVV.</p><p><b>Cuota mensual:</b> 35 € · <b>Cuota trimestral:</b> 70 €.</p></article><article className="panel"><h2>Estado</h2><p>{manager ? "Las suscripciones activas, impagos y cancelaciones se actualizan automáticamente mediante webhook." : "Antes de entrar en Stripe verás matrícula, cuota y total del primer cobro."}</p></article></section>

    {notice && <p className="error-note">{notice}</p>}
    {loading ? <article className="panel"><p>Cargando cuotas…</p></article> : <div className="cards">{memberships.map(item => <article className="panel" key={item.id}><small>{item.season}</small><h2>{item.athletes?.first_name} {item.athletes?.last_name}</h2><p><b>{item.plan === "monthly" ? "Mensual · 35 €" : "Trimestral · 70 €"}</b></p><p>Matrícula: {item.enrolment_fee_status === "paid" ? "abonada" : item.enrolment_fee_cents != null ? euro(item.enrolment_fee_cents) : "se calculará según categoría"}</p><p>Stripe: <b>{statusLabel(item.billing_status)}</b>{item.next_billing_on ? ` · próximo cobro ${new Date(item.next_billing_on).toLocaleDateString("es-ES")}` : ""}</p>{!manager && item.billing_status !== "active" && <button disabled={busyId === item.id} onClick={() => void prepare(item.id)}>{busyId === item.id ? "Preparando…" : "Revisar importe y configurar tarjeta"}</button>}</article>)}{!memberships.length && <article className="panel"><p>No hay cuotas creadas todavía.</p></article>}</div>}

    {preview && <section className="panel" style={{maxWidth:720,marginTop:24}}><small>RESUMEN ANTES DE PAGAR</small><h2>{preview.athlete}</h2><div className="table"><div className="row"><span>Matrícula</span><b>{euro(preview.enrolment)}</b></div><div className="row"><span>{preview.everyMonths === 1 ? "Cuota mensual" : "Cuota trimestral"}</span><b>{euro(preview.recurring)}</b></div><div className="row"><span><b>Total del primer cobro</b></span><b>{euro(preview.totalToday)}</b></div></div><p>Después se cobrarán <b>{euro(preview.recurring)}</b> cada {preview.everyMonths === 1 ? "mes" : "3 meses"}, hasta que la membresía sea cancelada.</p><div className="inline-actions"><button onClick={() => window.location.assign(preview.url)}>Continuar a Stripe y añadir tarjeta</button><button className="outline" onClick={() => setPreview(null)}>Cancelar</button></div></section>}
  </section></main>;
}

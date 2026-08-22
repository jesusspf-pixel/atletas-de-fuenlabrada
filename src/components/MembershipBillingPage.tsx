import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Membership = {
  id: string;
  season: string;
  plan: "monthly" | "term";
  enrolment_fee_status: string;
  enrolment_fee_cents: number | null;
  billing_status?: string | null;
  next_billing_on?: string | null;
  stripe_price_amount_cents?: number | null;
  athletes?: { first_name: string; last_name: string } | null;
};

type Preview = {
  membershipId: string;
  url: string;
  athlete: string;
  enrolment: number;
  recurring: number;
  everyMonths: number;
  totalToday: number;
};

const euro = (cents?: number | null) => cents == null ? "—" : `${(cents / 100).toFixed(2).replace(".00", "")} €`;
const statusLabel = (value?: string | null) => ({
  not_configured: "Pendiente de configurar",
  checkout_pending: "Pago pendiente",
  active: "Activa",
  past_due: "Pago fallido",
  cancelled: "Cancelada",
  paused: "Pausada",
} as Record<string, string>)[value || ""] || value || "Pendiente";

export default function MembershipBillingPage({ role }: { role: string | null }) {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const manager = role === "owner" || role === "admin";
  const params = new URLSearchParams(window.location.search);
  const billingResult = params.get("billing");

  const load = async () => {
    const client = supabase;
    if (!client) return;
    setLoading(true);
    const { data, error: queryError } = await client.from("memberships")
      .select("id,season,plan,enrolment_fee_status,enrolment_fee_cents,billing_status,next_billing_on,stripe_price_amount_cents,athletes(first_name,last_name)")
      .order("created_at", { ascending: false });
    setMemberships((data ?? []) as unknown as Membership[]);
    setError(queryError?.message || "");
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const prepare = async (membershipId: string) => {
    const client = supabase;
    if (!client) return;
    setBusyId(membershipId);
    setError("");
    setPreview(null);
    const { data } = await client.auth.getSession();
    const response = await fetch("/api/create-membership-checkout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${data.session?.access_token || ""}`,
      },
      body: JSON.stringify({ membershipId }),
    });
    const result = await response.json().catch(() => ({}));
    setBusyId("");
    if (!response.ok || !result.url) {
      setError(result.error || "No se pudo preparar el pago.");
      return;
    }
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

  return <main className="club-shell">
    <aside className="club-side">
      <div className="portal-brand"><b>AF</b><span>CUOTAS<small>Y COBROS</small></span></div>
      <div className="side-user"><a className="button-link outline" href="/">← Volver a la aplicación</a></div>
    </aside>
    <section className="club-content">
      <header className="topbar"><span>Club Atletas de Fuenlabrada · Pagos</span></header>
      <div className="page-head"><div><h1>Cuotas y cobros</h1><p>{manager ? "Estado de matrículas, cuotas y suscripciones del club." : "Revisa el importe y configura la tarjeta de forma segura en Stripe."}</p></div></div>

      {billingResult === "success" && <p className="success-note panel">Pago de prueba completado. El estado se actualizará automáticamente en cuanto Stripe confirme el evento.</p>}
      {billingResult === "cancelled" && <p className="error-note panel">No se ha realizado ningún cobro. Puedes volver a intentarlo cuando quieras.</p>}

      <section className="two-columns">
        <article className="panel"><h2>Stripe · modo prueba</h2><p>La cuenta del club está conectada a Stripe en entorno de prueba.</p><p><b>Mensual:</b> 35 € · <b>Trimestral:</b> 70 €.</p></article>
        <article className="panel"><h2>Seguridad</h2><p>La aplicación no almacena números de tarjeta ni CVV. Los datos se introducen directamente en Stripe.</p></article>
      </section>

      {error && <p className="error-note panel">{error}</p>}
      {loading ? <article className="panel"><p>Cargando cuotas…</p></article> : <div className="cards">
        {memberships.map(item => <article className="panel" key={item.id}>
          <small>{item.season}</small>
          <h2>{item.athletes?.first_name || "Atleta"} {item.athletes?.last_name || ""}</h2>
          <p><b>{item.plan === "monthly" ? "Cuota mensual · 35 €" : "Cuota trimestral · 70 €"}</b></p>
          <p>Matrícula: {item.enrolment_fee_status === "paid" ? "abonada" : euro(item.enrolment_fee_cents) === "—" ? "se calculará según categoría" : euro(item.enrolment_fee_cents)}</p>
          <p>Estado Stripe: <b>{statusLabel(item.billing_status)}</b></p>
          {item.next_billing_on && <p>Próximo cobro: {new Date(item.next_billing_on).toLocaleDateString("es-ES")}</p>}
          {!manager && item.billing_status !== "active" && <button disabled={busyId === item.id} onClick={() => void prepare(item.id)}>{busyId === item.id ? "Preparando…" : "Revisar importe y configurar tarjeta"}</button>}
        </article>)}
        {!memberships.length && <article className="panel"><p>No hay cuotas creadas todavía.</p></article>}
      </div>}

      {preview && <section className="panel" style={{ maxWidth: 720, marginTop: 24 }}>
        <small>RESUMEN ANTES DE PAGAR</small>
        <h2>{preview.athlete}</h2>
        <div className="table">
          <div className="row"><span>Matrícula</span><b>{euro(preview.enrolment)}</b></div>
          <div className="row"><span>{preview.everyMonths === 1 ? "Cuota mensual" : "Cuota trimestral"}</span><b>{euro(preview.recurring)}</b></div>
          <div className="row"><span><b>Total del primer cobro</b></span><b>{euro(preview.totalToday)}</b></div>
        </div>
        <p>Después se cobrarán <b>{euro(preview.recurring)}</b> cada {preview.everyMonths === 1 ? "mes" : "3 meses"}, hasta que la suscripción sea cancelada.</p>
        <p><small>Estás en modo prueba: no se realizará ningún cargo real.</small></p>
        <div className="inline-actions">
          <button onClick={() => window.location.assign(preview.url)}>Continuar a Stripe</button>
          <button className="outline" onClick={() => setPreview(null)}>Cancelar</button>
        </div>
      </section>}
    </section>
  </main>;
}

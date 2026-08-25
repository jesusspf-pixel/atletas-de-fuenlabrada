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

const euro = (cents?: number | null) => cents == null ? "—" : `${(cents / 100).toFixed(2).replace(".00", "")} €`;
const statusLabel = (value?: string | null) => ({ not_configured: "Pendiente de configurar", checkout_pending: "Pago pendiente", active: "Activa", past_due: "Pago fallido", cancelled: "Cancelada", paused: "Pausada" } as Record<string,string>)[value || ""] || value || "Pendiente";

export default function MembershipBillingPage({ role }: { role: string | null }) {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const manager = role === "owner" || role === "admin";

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    void client.from("memberships")
      .select("id,season,plan,enrolment_fee_status,enrolment_fee_cents,billing_status,next_billing_on,stripe_price_amount_cents,athletes(first_name,last_name)")
      .order("created_at", { ascending: false })
      .then(({ data, error: queryError }) => {
        setMemberships((data ?? []) as unknown as Membership[]);
        setError(queryError?.message || "");
        setLoading(false);
      });
  }, []);

  return <main className="club-shell"><aside className="club-side"><div className="portal-brand"><b>AF</b><span>CUOTAS<small>Y COBROS</small></span></div><div className="side-user"><a className="button-link outline" href="/">← Volver a la aplicación</a></div></aside><section className="club-content"><header className="topbar"><span>Club Atletas de Fuenlabrada · Pagos</span></header><div className="page-head"><div><h1>Cuotas y cobros</h1><p>{manager ? "Estado de matrículas, cuotas y suscripciones del club." : "Consulta tu modalidad, matrícula y estado del pago recurrente."}</p></div></div><section className="two-columns"><article className="panel"><h2>Stripe preparado</h2><p>La cuenta real del club está conectada de forma segura con Stripe.</p><p><b>Mensual:</b> 35 € · <b>Trimestral:</b> 70 €.</p></article><article className="panel"><h2>Seguridad</h2><p>La aplicación no almacena números de tarjeta ni CVV. Los datos de pago se gestionan directamente en Stripe.</p></article></section>{error && <p className="error-note">{error}</p>}{loading ? <article className="panel"><p>Cargando cuotas…</p></article> : <div className="cards">{memberships.map(item => <article className="panel" key={item.id}><small>{item.season}</small><h2>{item.athletes?.first_name || "Atleta"} {item.athletes?.last_name || ""}</h2><p><b>{item.plan === "monthly" ? "Cuota mensual · 35 €" : "Cuota trimestral · 70 €"}</b></p><p>Matrícula: {item.enrolment_fee_status === "paid" ? "abonada" : euro(item.enrolment_fee_cents)}</p><p>Estado Stripe: <b>{statusLabel(item.billing_status)}</b></p>{item.next_billing_on && <p>Próximo cobro: {new Date(item.next_billing_on).toLocaleDateString("es-ES")}</p>}</article>)}{!memberships.length && <article className="panel"><p>No hay cuotas creadas todavía.</p></article>}</div>}</section></main>;
}

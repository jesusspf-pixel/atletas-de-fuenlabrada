import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type AthleteRow = {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  club_status: string;
  license_status: string;
  training_groups?: { name: string } | { name: string }[] | null;
  profiles?: { full_name: string | null; email: string; phone: string | null } | { full_name: string | null; email: string; phone: string | null }[] | null;
  families?: {
    emergency_phone: string | null;
    profiles?: { full_name: string | null; email: string; phone: string | null } | { full_name: string | null; email: string; phone: string | null }[] | null;
  } | { emergency_phone: string | null; profiles?: { full_name: string | null; email: string; phone: string | null } | { full_name: string | null; email: string; phone: string | null }[] | null }[] | null;
};

type ChargeRow = {
  id: string;
  athlete_id: string;
  charge_kind: string;
  scheduled_for: string;
  period_starts_on: string | null;
  period_ends_on: string | null;
  calculated_amount_cents: number;
  approved_amount_cents: number | null;
  status: string;
  created_at: string;
  athletes?: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null;
  memberships?: { plan: string; season: string } | { plan: string; season: string }[] | null;
};

const one = <T,>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;

const euro = (cents: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);

const statusLabel: Record<string, string> = {
  awaiting_admin: "Pendiente de revisión",
  approved: "Programada",
  checkout_pending: "Pendiente de pago",
  paid: "Pagada",
  failed: "Impagada",
  waived: "Exenta",
  cancelled: "Cancelada",
};

export default function AdministrativeViewer({ section }: { section: string }) {
  const [athletes, setAthletes] = useState<AthleteRow[]>([]);
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    if (!supabase) return;
    setLoading(true);
    const [athleteResult, chargeResult] = await Promise.all([
      supabase
        .from("athletes")
        .select("id,first_name,last_name,birth_date,club_status,license_status,training_groups(name),profiles:user_profile_id(full_name,email,phone),families!athletes_family_id_fkey(emergency_phone,profiles:profiles!families_primary_profile_id_fkey(full_name,email,phone))")
        .order("last_name", { ascending: true }),
      supabase
        .from("billing_charge_drafts")
        .select("id,athlete_id,charge_kind,scheduled_for,period_starts_on,period_ends_on,calculated_amount_cents,approved_amount_cents,status,created_at,athletes(first_name,last_name),memberships(season,plan)")
        .order("scheduled_for", { ascending: false }),
    ]);
    setAthletes((athleteResult.data ?? []) as unknown as AthleteRow[]);
    setCharges((chargeResult.data ?? []) as unknown as ChargeRow[]);
    setError(athleteResult.error?.message || chargeResult.error?.message || "");
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const visibleAthletes = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es");
    if (!needle) return athletes;
    return athletes.filter((athlete) => {
      const ownProfile = one(athlete.profiles);
      const family = one(athlete.families);
      const guardian = one(family?.profiles);
      return [athlete.first_name, athlete.last_name, ownProfile?.email, ownProfile?.phone, guardian?.full_name, guardian?.email, guardian?.phone]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("es")
        .includes(needle);
    });
  }, [athletes, search]);

  const visibleCharges = useMemo(
    () => charges.filter((charge) => status === "all" || charge.status === status),
    [charges, status],
  );

  if (loading) return <article className="panel"><p>Cargando información…</p></article>;
  if (error) return <article className="panel"><p className="error-note">No se pudo cargar la información: {error}</p></article>;

  if (section === "Cuotas") {
    const paid = charges.filter((charge) => charge.status === "paid");
    const failed = charges.filter((charge) => ["failed", "checkout_pending"].includes(charge.status));
    return <section className="readonly-admin-view">
      <div className="page-head"><div><small>SOLO LECTURA</small><h1>Cuotas y pagos</h1><p>Consulta el estado de los cobros. Este perfil no puede ejecutar ninguna operación.</p></div></div>
      <section className="metric-grid readonly-summary">
        <article className="metric"><small>COBRADAS</small><b>{paid.length}</b><span>{euro(paid.reduce((sum, charge) => sum + (charge.approved_amount_cents ?? charge.calculated_amount_cents), 0))}</span></article>
        <article className="metric"><small>IMPAGADAS</small><b>{failed.length}</b><span>{euro(failed.reduce((sum, charge) => sum + (charge.approved_amount_cents ?? charge.calculated_amount_cents), 0))}</span></article>
        <article className="metric"><small>TOTAL REGISTROS</small><b>{charges.length}</b><span>Historial visible</span></article>
      </section>
      <article className="panel readonly-toolbar"><label>Estado<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Todos</option><option value="paid">Pagadas</option><option value="approved">Programadas</option><option value="failed">Impagadas</option><option value="checkout_pending">Pendientes de pago</option><option value="waived">Exentas</option><option value="cancelled">Canceladas</option></select></label></article>
      <article className="panel table readonly-table">
        {visibleCharges.map((charge) => {
          const athlete = one(charge.athletes);
          const membership = one(charge.memberships);
          const amount = charge.approved_amount_cents ?? charge.calculated_amount_cents;
          return <div className="row" key={charge.id}>
            <span><b>{athlete ? `${athlete.first_name} ${athlete.last_name}` : "Atleta"}</b><small>{charge.charge_kind === "enrolment" ? "Matrícula" : charge.charge_kind === "recurring" ? "Cuota" : "Ajuste"} · {membership?.plan === "term" ? "Trimestral" : "Mensual"}</small></span>
            <span><b>{euro(amount)}</b><small>{membership?.season || "Temporada actual"}</small></span>
            <span><b>{statusLabel[charge.status] || charge.status}</b><small>{new Date(`${charge.scheduled_for}T12:00:00`).toLocaleDateString("es-ES")}</small></span>
          </div>;
        })}
        {!visibleCharges.length && <p>No hay cobros con este filtro.</p>}
      </article>
    </section>;
  }

  if (section === "Atletas") return <section className="readonly-admin-view">
    <div className="page-head"><div><small>SOLO LECTURA</small><h1>Atletas</h1><p>Datos de contacto, grupo y estado administrativo. No se permite modificar fichas.</p></div></div>
    <article className="panel readonly-toolbar"><label>Buscar atleta o familiar<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, correo o teléfono" /></label></article>
    <article className="panel table readonly-table">
      {visibleAthletes.map((athlete) => {
        const profile = one(athlete.profiles);
        const family = one(athlete.families);
        const guardian = one(family?.profiles);
        const group = one(athlete.training_groups);
        return <div className="row readonly-athlete-row" key={athlete.id}>
          <span><b>{athlete.first_name} {athlete.last_name}</b><small>{group?.name || "Sin grupo"} · {athlete.club_status}</small></span>
          <span><b>{profile?.email || guardian?.email || "Sin correo"}</b><small>{profile?.phone || guardian?.phone || family?.emergency_phone || "Sin teléfono"}</small></span>
          <span><b>{athlete.license_status}</b><small>{athlete.birth_date ? new Date(`${athlete.birth_date}T12:00:00`).toLocaleDateString("es-ES") : "Sin fecha de nacimiento"}</small></span>
        </div>;
      })}
      {!visibleAthletes.length && <p>No hay atletas que coincidan con la búsqueda.</p>}
    </article>
  </section>;

  return <section className="readonly-admin-view">
    <div className="page-head"><div><small>ADMINISTRACIÓN · SOLO LECTURA</small><h1>Panel de consulta</h1><p>Acceso limitado a atletas y pagos, sin permisos para realizar cambios.</p></div></div>
    <section className="metric-grid readonly-summary"><article className="metric"><small>ATLETAS</small><b>{athletes.length}</b><span>Fichas consultables</span></article><article className="metric"><small>COBROS</small><b>{charges.length}</b><span>Operaciones visibles</span></article><article className="metric"><small>IMPAGADAS</small><b>{charges.filter((charge) => ["failed", "checkout_pending"].includes(charge.status)).length}</b><span>Requieren seguimiento</span></article></section>
    <article className="panel"><h2>Permisos de esta cuenta</h2><p>Puede consultar información de atletas y cuotas. No puede editar datos, validar altas, cambiar importes, realizar cobros ni acceder a la configuración del club.</p></article>
  </section>;
}

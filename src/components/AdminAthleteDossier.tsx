import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import "./admin-athlete-dossier.css";

type Props = { athleteId: string; adminProfileId: string; onBack: () => void };
type Athlete = {
  id: string; first_name: string; last_name: string; birth_date: string | null; club_status: string;
  license_status: string; license_number: string | null; user_profile_id: string | null;
  profiles?: { full_name: string | null; email: string; phone: string | null } | null;
  training_groups?: { name: string; schedule_days: string | null; starts_at: string | null; ends_at: string | null } | null;
  families?: { emergency_phone: string | null; profiles?: { full_name: string | null; email: string; phone: string | null } | null } | null;
  memberships?: { plan: string; billing_status: string; enrolment_fee_cents: number | null }[];
};
type Charge = { id: string; charge_kind: string; scheduled_for: string | null; approved_amount_cents: number | null; calculated_amount_cents: number; status: string; period_starts_on: string | null; period_ends_on: string | null };
type Note = { id: string; body: string; created_at: string; coach_profile_id: string; profiles?: { full_name: string | null } | null };

const euro = (cents: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
const date = (value: string | null) => value ? new Date(value).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "Sin fecha";
const statusLabel: Record<string, string> = { paid: "Pagado", approved: "Programado", collecting: "En proceso", failed: "Rechazado", cancelled: "Cancelado", waived: "Exento", awaiting_admin: "Pendiente de aprobación" };

export default function AdminAthleteDossier({ athleteId, adminProfileId, onBack }: Props) {
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [avatar, setAvatar] = useState("");
  const [charges, setCharges] = useState<Charge[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!supabase) return;
    setLoading(true);
    const [athleteResult, avatarResult, chargeResult, noteResult] = await Promise.all([
      supabase.from("athletes").select("id,first_name,last_name,birth_date,club_status,license_status,license_number,user_profile_id,profiles:user_profile_id(full_name,email,phone),training_groups(name,schedule_days,starts_at,ends_at),families(emergency_phone,profiles(full_name,email,phone)),memberships(plan,billing_status,enrolment_fee_cents)").eq("id", athleteId).single(),
      supabase.from("athlete_profile_settings").select("avatar_url").eq("athlete_id", athleteId).maybeSingle(),
      supabase.from("billing_charge_drafts").select("id,charge_kind,scheduled_for,approved_amount_cents,calculated_amount_cents,status,period_starts_on,period_ends_on").eq("athlete_id", athleteId).order("scheduled_for", { ascending: false }),
      supabase.from("coach_athlete_notes").select("id,body,created_at,coach_profile_id,profiles:coach_profile_id(full_name)").eq("athlete_id", athleteId).order("created_at", { ascending: false }),
    ]);
    if (athleteResult.error) setNotice(athleteResult.error.message);
    setAthlete((athleteResult.data as unknown as Athlete) || null);
    setAvatar(avatarResult.data?.avatar_url || "");
    setCharges((chargeResult.data || []) as Charge[]);
    setNotes((noteResult.data || []) as unknown as Note[]);
    setLoading(false);
  };
  useEffect(() => { void load(); }, [athleteId]);

  const paid = useMemo(() => charges.filter(item => item.status === "paid").reduce((sum, item) => sum + (item.approved_amount_cents ?? item.calculated_amount_cents), 0), [charges]);
  const pending = useMemo(() => charges.filter(item => ["approved", "collecting", "awaiting_admin"].includes(item.status)), [charges]);
  const next = [...pending].filter(item => item.scheduled_for && new Date(item.scheduled_for) >= new Date(new Date().toDateString())).sort((a, b) => (a.scheduled_for || "").localeCompare(b.scheduled_for || ""))[0];
  const failed = charges.filter(item => item.status === "failed");

  const saveNote = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !note.trim()) return;
    setNotice("");
    const { error } = await supabase.from("coach_athlete_notes").insert({ athlete_id: athleteId, coach_profile_id: adminProfileId, body: note.trim(), private_to_staff: true });
    if (error) return setNotice(error.message);
    setNote(""); setNotice("Nota privada guardada."); void load();
  };

  if (loading) return <article className="panel">Abriendo expediente…</article>;
  if (!athlete) return <article className="panel error-note">No se ha podido abrir el expediente.</article>;
  const membership = athlete.memberships?.[0];
  const initials = `${athlete.first_name[0] || ""}${athlete.last_name[0] || ""}`;
  const contact = athlete.families?.profiles || athlete.profiles;
  return <section className="admin-athlete-dossier">
    <header className="dossier-hero"><button className="outline" onClick={onBack}>← Volver a grupos</button><div className="dossier-person">{avatar ? <img src={avatar} alt={`Foto de ${athlete.first_name}`} /> : <i>{initials}</i>}<div><small>EXPEDIENTE DEL ATLETA</small><h1>{athlete.first_name} {athlete.last_name}</h1><p>{athlete.training_groups?.name || "Sin grupo"} · {athlete.club_status === "active" ? "Alta activa" : "Alta en revisión"}</p></div></div></header>
    <section className="dossier-metrics"><article><small>Total cobrado</small><b>{euro(paid)}</b></article><article><small>Próximo cobro</small><b>{next ? euro(next.approved_amount_cents ?? next.calculated_amount_cents) : "—"}</b><span>{next ? date(next.scheduled_for) : "Sin cobros programados"}</span></article><article className={failed.length ? "danger" : "ok"}><small>Cargos rechazados</small><b>{failed.length}</b></article><article><small>Plan de cuota</small><b>{membership?.plan === "monthly" ? "Mensual" : membership?.plan === "term" ? "Trimestral" : "Sin asignar"}</b></article></section>
    <section className="dossier-grid"><article className="panel dossier-info"><header><small>INFORMACIÓN</small><h2>Datos y contacto</h2></header><dl><div><dt>Grupo</dt><dd>{athlete.training_groups?.name || "Sin asignar"}</dd></div><div><dt>Horario</dt><dd>{athlete.training_groups?.schedule_days || "Pendiente"} {athlete.training_groups?.starts_at ? `· ${athlete.training_groups.starts_at.slice(0,5)}–${athlete.training_groups.ends_at?.slice(0,5)}` : ""}</dd></div><div><dt>Licencia</dt><dd>{athlete.license_status === "active" ? athlete.license_number || "Activa" : "Pendiente"}</dd></div><div><dt>Fecha de nacimiento</dt><dd>{date(athlete.birth_date)}</dd></div><div><dt>Responsable</dt><dd>{contact?.full_name || "Atleta adulto"}</dd></div><div><dt>Correo</dt><dd>{contact?.email || "No indicado"}</dd></div><div><dt>Teléfono</dt><dd>{contact?.phone || athlete.families?.emergency_phone || "No indicado"}</dd></div></dl></article>
      <form className="panel dossier-note" onSubmit={saveNote}><header><small>SEGUIMIENTO INTERNO</small><h2>Nota privada del club</h2></header><p>Solo la administración y los entrenadores autorizados pueden verla.</p><textarea value={note} onChange={event => setNote(event.target.value)} placeholder="Escribe una observación, acuerdo o seguimiento…" required /><button>Guardar nota</button>{notice && <p className={notice.includes("guardada") ? "success-note" : "error-note"}>{notice}</p>}<div className="note-history">{notes.map(item => <article key={item.id}><p>{item.body}</p><small>{item.profiles?.full_name || "Administración"} · {date(item.created_at)}</small></article>)}{!notes.length && <span>Aún no hay notas privadas.</span>}</div></form>
    </section>
    <article className="panel dossier-charges"><header><div><small>CUOTAS Y PAGOS</small><h2>Histórico económico completo</h2></div><span>{charges.length} movimientos</span></header><div className="dossier-charge-list">{charges.map(item => { const amount = item.approved_amount_cents ?? item.calculated_amount_cents; return <div className={`dossier-charge ${item.status}`} key={item.id}><i>€</i><span><b>{item.charge_kind === "enrolment" ? "Matrícula" : item.charge_kind === "recurring" ? "Cuota" : "Cargo del club"}</b><small>{item.period_starts_on ? `${date(item.period_starts_on)} – ${date(item.period_ends_on)}` : date(item.scheduled_for)}</small></span><strong>{euro(amount)}</strong><em>{statusLabel[item.status] || item.status}</em></div> })}{!charges.length && <p>No hay movimientos económicos asignados a este atleta.</p>}</div></article>
  </section>;
}

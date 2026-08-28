import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import "./admin-athlete-dossier.css";

type Props = { athleteId: string; adminProfileId: string; onBack: () => void };
type Athlete = {
  id: string; first_name: string; last_name: string; birth_date: string | null; club_status: string; training_group_id: string | null;
  license_status: string; license_number: string | null; user_profile_id: string | null;
  profiles?: { full_name: string | null; email: string; phone: string | null } | null;
  training_groups?: { name: string; schedule_days: string | null; starts_at: string | null; ends_at: string | null } | null;
  families?: { emergency_phone: string | null; profiles?: { full_name: string | null; email: string; phone: string | null } | null } | null;
  memberships?: { id: string; plan: "monthly" | "term"; billing_status: string; enrolment_fee_cents: number | null; enrolment_fee_status: string | null }[];
};
type Group = { id: string; name: string; active: boolean };
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
  const [groups, setGroups] = useState<Group[]>([]);
  const [status, setStatus] = useState("pending_review");
  const [groupId, setGroupId] = useState("");
  const [licenseStatus, setLicenseStatus] = useState("pending");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<"monthly" | "term">("term");
  const [enrolmentFee, setEnrolmentFee] = useState("0.00");
  const [waiveEnrolment, setWaiveEnrolment] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!supabase) return;
    setLoading(true);
    const [athleteResult, avatarResult, chargeResult, noteResult, groupResult] = await Promise.all([
      supabase.from("athletes").select("id,first_name,last_name,birth_date,club_status,training_group_id,license_status,license_number,user_profile_id,profiles:user_profile_id(full_name,email,phone),training_groups(name,schedule_days,starts_at,ends_at),families(emergency_phone,profiles(full_name,email,phone)),memberships(id,plan,billing_status,enrolment_fee_cents,enrolment_fee_status)").eq("id", athleteId).single(),
      supabase.from("athlete_profile_settings").select("avatar_url").eq("athlete_id", athleteId).maybeSingle(),
      supabase.from("billing_charge_drafts").select("id,charge_kind,scheduled_for,approved_amount_cents,calculated_amount_cents,status,period_starts_on,period_ends_on").eq("athlete_id", athleteId).order("scheduled_for", { ascending: false }),
      supabase.from("coach_athlete_notes").select("id,body,created_at,coach_profile_id,profiles:coach_profile_id(full_name)").eq("athlete_id", athleteId).order("created_at", { ascending: false }),
      supabase.from("training_groups").select("id,name,active").eq("active", true).order("name"),
    ]);
    if (athleteResult.error) setNotice(athleteResult.error.message);
    const loaded = (athleteResult.data as unknown as Athlete) || null;
    setAthlete(loaded);
    if (loaded) {
      const loadedMembership = loaded.memberships?.[0];
      setStatus(loaded.club_status === "pending_review" ? "active" : loaded.club_status);
      setGroupId(loaded.training_group_id || "");
      setLicenseStatus(loaded.license_status || "pending");
      setLicenseNumber(loaded.license_number || "");
      setSelectedPlan(loadedMembership?.plan || "term");
      setEnrolmentFee(((loadedMembership?.enrolment_fee_cents || 0) / 100).toFixed(2));
      setWaiveEnrolment(loadedMembership?.enrolment_fee_status === "paid");
    }
    setAvatar(avatarResult.data?.avatar_url || "");
    setCharges((chargeResult.data || []) as Charge[]);
    setNotes((noteResult.data || []) as unknown as Note[]);
    setGroups((groupResult.data || []) as Group[]);
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

  const saveManagement = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !athlete) return;
    setSaving(true); setNotice("");
    const membership = athlete.memberships?.[0];
    const initialApproval = athlete.club_status === "pending_review" && status === "active";
    if (initialApproval) {
      if (!membership) { setSaving(false); return setNotice("No se encontró el plan económico de esta inscripción."); }
      const cents = waiveEnrolment ? 0 : Math.round(Number(enrolmentFee.replace(",", ".")) * 100);
      if (!Number.isFinite(cents) || cents < 0) { setSaving(false); return setNotice("Indica un importe de matrícula válido."); }
      const economic = await supabase.from("memberships").update({ plan: selectedPlan, enrolment_fee_cents: cents }).eq("id", membership.id);
      if (economic.error) { setSaving(false); return setNotice(economic.error.message); }
      const approval = await supabase.rpc("approve_registration_and_schedule", { target_athlete_id: athlete.id, waive_enrolment: waiveEnrolment });
      if (approval.error) { setSaving(false); return setNotice(approval.error.message); }
      const draftId = Array.isArray(approval.data) ? approval.data[0]?.enrolment_draft_id : null;
      if (draftId) {
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch("/api/collect-approved-charge", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token || ""}` }, body: JSON.stringify({ draftId }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) { setSaving(false); await load(); return setNotice(result.error || "El banco ha rechazado la matrícula. El atleta continúa pendiente."); }
      }
    }
    const update = await supabase.from("athletes").update({ training_group_id: groupId || null, club_status: initialApproval ? "active" : status, license_status: licenseStatus, license_number: licenseNumber || null }).eq("id", athlete.id);
    setSaving(false);
    if (update.error) return setNotice(update.error.message);
    setNotice(initialApproval ? (waiveEnrolment ? "Alta validada: matrícula exenta y cuotas programadas." : "Alta validada, matrícula cobrada y cuotas programadas.") : "Ficha actualizada.");
    await load();
  };

  const changeBillingPlan = async () => {
    if (!supabase || !athlete) return;
    const membership = athlete.memberships?.[0];
    if (!membership) return setNotice("No se encontró el plan económico de este atleta.");
    if (membership.plan === selectedPlan) return setNotice("El atleta ya tiene seleccionado ese plan de cuotas.");
    const from = membership.plan === "monthly" ? "mensual" : "trimestral";
    const to = selectedPlan === "monthly" ? "mensual" : "trimestral";
    if (!window.confirm(`Se cambiará el plan ${from} por el plan ${to}. Los pagos realizados se conservarán y se sustituirán únicamente las cuotas futuras. ¿Continuar?`)) return;
    setSaving(true); setNotice("");
    const { error } = await supabase.rpc("change_membership_billing_plan", { target_membership_id: membership.id, target_plan: selectedPlan });
    setSaving(false);
    if (error) return setNotice(error.message);
    setNotice(`Plan cambiado a ${to}. Se ha generado el nuevo calendario de cuotas.`);
    await load();
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
    <form className="panel dossier-management" onSubmit={saveManagement}><header><div><small>ADMINISTRACIÓN DEPORTIVA</small><h2>Validación, cuota y asignación</h2></div><span>{athlete.club_status === "pending_review" ? "Pendiente de validar" : "Ficha activa"}</span></header><div className="dossier-management-grid"><label>Estado de alta<select value={status} onChange={e => setStatus(e.target.value)}><option value="pending_review">En revisión</option><option value="active">Activo</option><option value="inactive">Acceso suspendido</option><option value="withdrawn">Baja del club</option></select></label>{athlete.club_status === "pending_review" && status === "active" && <><label>Plan de cuotas<select value={selectedPlan} onChange={e => setSelectedPlan(e.target.value as "monthly" | "term")}><option value="monthly">Mensual · 35 €</option><option value="term">Trimestral · 70 €</option></select></label><label>Matrícula final (€)<input disabled={waiveEnrolment} min="0" step="0.01" inputMode="decimal" value={enrolmentFee} onChange={e => setEnrolmentFee(e.target.value)} /></label><label className="dossier-check"><input type="checkbox" checked={waiveEnrolment} onChange={e => setWaiveEnrolment(e.target.checked)} /><span><b>Matrícula ya abonada o exenta</b><small>No se realizará un nuevo cargo.</small></span></label></>}{athlete.club_status !== "pending_review" && membership && <label>Plan de cuotas<select value={selectedPlan} onChange={e => setSelectedPlan(e.target.value as "monthly" | "term")}><option value="monthly">Mensual · 35 €</option><option value="term">Trimestral · 70 €</option></select><small>Los cobros ya realizados se conservarán.</small><button type="button" className="outline" disabled={saving || selectedPlan === membership.plan} onClick={() => void changeBillingPlan()}>Cambiar plan y reprogramar cuotas</button></label>}<label>Grupo<select value={groupId} onChange={e => setGroupId(e.target.value)}><option value="">Sin grupo</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label>Licencia<select value={licenseStatus} onChange={e => setLicenseStatus(e.target.value)}><option value="pending">Pendiente</option><option value="active">Activa</option><option value="rejected">Rechazada</option></select></label><label>Número de licencia<input value={licenseNumber} onChange={e => setLicenseNumber(e.target.value)} placeholder="Ej. M-12345" /></label></div><button className="dossier-primary" disabled={saving}>{saving ? "Procesando…" : athlete.club_status === "pending_review" && status === "active" ? "Validar alta, cobrar matrícula y programar cuotas" : "Guardar cambios"}</button>{notice && <p className={notice.includes("validada") || notice.includes("actualizada") || notice.includes("cambiado") ? "success-note" : "error-note"}>{notice}</p>}</form>
    <article className="panel dossier-charges"><header><div><small>CUOTAS Y PAGOS</small><h2>Histórico económico completo</h2></div><span>{charges.length} movimientos</span></header><div className="dossier-charge-list">{charges.map(item => { const amount = item.approved_amount_cents ?? item.calculated_amount_cents; return <div className={`dossier-charge ${item.status}`} key={item.id}><i>€</i><span><b>{item.charge_kind === "enrolment" ? "Matrícula" : item.charge_kind === "recurring" ? "Cuota" : "Cargo del club"}</b><small>{item.period_starts_on ? `${date(item.period_starts_on)} – ${date(item.period_ends_on)}` : date(item.scheduled_for)}</small></span><strong>{euro(amount)}</strong><em>{statusLabel[item.status] || item.status}</em></div> })}{!charges.length && <p>No hay movimientos económicos asignados a este atleta.</p>}</div></article>
  </section>;
}

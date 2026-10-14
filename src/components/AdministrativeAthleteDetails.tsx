import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { apiFetch } from "../lib/clubApi";
import "./administrative-athlete-details.css";

type Contact = { full_name: string | null; email: string | null; phone: string | null };
type Family = {
  relationship_to_athlete: string; dni_nie: string; address_line: string;
  postal_code: string; locality: string; province: string; emergency_phone: string | null;
  profiles: Contact | null;
  family_guardians: { relationship: string; access_status: string; profiles: Contact | null }[];
};
type Dossier = {
  id: string; first_name: string; last_name: string; birth_date: string; federative_sex: string;
  dni_nie: string | null; club_status: string; license_status: string; license_number: string | null;
  federation_license: string | null; training_category: string | null; official_competition_category: string | null;
  federation_license_requested: boolean; training_groups: { name: string } | null;
  profiles: Contact | null; families: Family | null;
  federation_license_applications: { status: string; training_category: string; competition_category: string; submitted_at: string; form_data: Record<string, unknown> }[];
};
const labels: Record<string, string> = {
  nationality: "Nacionalidad", birthplace: "Lugar de nacimiento", previous_license: "Licencia anterior", previous_club: "Club anterior",
  guardian_name: "Nombre y apellidos del padre, madre o tutor", guardian_dni_nie: "DNI / NIE del tutor", guardian_phone: "Teléfono del tutor", guardian_email: "Correo del tutor",
  address_line: "Dirección", postal_code: "Código postal", locality: "Localidad", province: "Provincia", athlete_email: "Correo del atleta", athlete_phone: "Teléfono del atleta",
};
const statuses: Record<string, string> = { active: "Activo", inactive: "Inactivo", withdrawn: "Baja", draft: "Borrador", pending_review: "Pendiente de revisión", pending: "Pendiente", rejected: "Rechazada", expired: "Caducada", ready_to_file: "Lista para tramitar", filed: "Tramitada", completed: "Completada", not_required: "No requerida" };
function valueText(value: unknown): string {
  if (value == null || value === "") return "No indicado";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function Field({ label, value }: { label: string; value: unknown }) {
  const text = valueText(value);
  return <div><dt>{label}</dt><dd>{/teléfono/i.test(label) && value ? <a href={`tel:${text.replace(/[^+\d]/g, "")}`}>{text}</a> : /correo/i.test(label) && typeof value === "string" && /^[^\s@]+@[^\s@]+$/.test(value) ? <a href={`mailto:${value}`}>{text}</a> : text}</dd></div>;
}
function ContactFields({ person }: { person: Contact | null }) {
  return <><Field label="Nombre y apellidos" value={person?.full_name} /><Field label="Correo electrónico" value={person?.email} /><Field label="Teléfono" value={person?.phone} /></>;
}
export default function AdministrativeAthleteDetails({ athleteId, onClose }: { athleteId: string; onClose: () => void }) {
  const [athlete, setAthlete] = useState<Dossier | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setAthlete(null); setError("");
    void (async () => {
      try {
        const session = await supabase?.auth.getSession();
        const token = session?.data.session?.access_token;
        if (!token) throw new Error("Inicia sesión de nuevo para consultar la ficha.");
        const response = await apiFetch(`/api/administrative-athlete-dossier?athleteId=${encodeURIComponent(athleteId)}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        const data = await response.json() as { athlete?: Dossier; error?: string };
        if (!response.ok || !data.athlete) throw new Error(data.error || "No se pudo cargar la ficha.");
        if (active) setAthlete(data.athlete);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "No se pudo cargar la ficha."); }
    })();
    return () => { active = false; controller.abort(); };
  }, [athleteId, attempt]);
  return <section className="administrative-dossier" aria-label="Ficha completa del atleta">
    <button type="button" onClick={onClose}>← Volver al listado</button>
    <div aria-live="polite">{error ? <article className="panel"><p role="alert">{error}</p><button onClick={() => setAttempt(attempt + 1)}>Reintentar</button></article> : !athlete ? <p>Cargando ficha completa…</p> : null}</div>
    {athlete && <>
      <h2>{athlete.first_name} {athlete.last_name}</h2>
      <article className="panel"><h3>Datos del atleta</h3><dl>
        <Field label="Nombre" value={athlete.first_name} /><Field label="Apellidos" value={athlete.last_name} />
        <Field label="Fecha de nacimiento" value={new Date(`${athlete.birth_date}T12:00:00`).toLocaleDateString("es-ES")} />
        <Field label="DNI / NIE" value={athlete.dni_nie} /><Field label="Sexo federativo" value={athlete.federative_sex} />
        <Field label="Grupo" value={athlete.training_groups?.name} /><Field label="Categoría de entrenamiento" value={athlete.training_category} />
        <Field label="Categoría de competición" value={athlete.official_competition_category} /><Field label="Estado en el club" value={statuses[athlete.club_status] || athlete.club_status} />
        <Field label="Estado de licencia" value={statuses[athlete.license_status] || athlete.license_status} /><Field label="Número de licencia" value={athlete.license_number} />
        <Field label="Licencia federativa" value={athlete.federation_license} /><Field label="Solicita licencia federativa" value={athlete.federation_license_requested} />
        {athlete.profiles && <ContactFields person={athlete.profiles} />}
      </dl></article>
      {athlete.families ? <article className="panel"><h3>Padre, madre o tutor principal</h3><dl>
        <ContactFields person={athlete.families.profiles} /><Field label="Relación con el atleta" value={athlete.families.relationship_to_athlete.replaceAll("_", " ")} />
        <Field label="DNI / NIE del responsable" value={athlete.families.dni_nie} /><Field label="Teléfono de emergencia" value={athlete.families.emergency_phone} />
        <Field label="Dirección" value={athlete.families.address_line} /><Field label="Código postal" value={athlete.families.postal_code} /><Field label="Localidad" value={athlete.families.locality} /><Field label="Provincia" value={athlete.families.province} />
      </dl>
        {athlete.families.family_guardians?.map((guardian, index) => <section key={index}><h4>Contacto familiar · {guardian.relationship.replaceAll("_", " ")}</h4><dl><ContactFields person={guardian.profiles} /><Field label="Acceso familiar" value={guardian.access_status === "active" ? "Activo" : "Revocado"} /></dl></section>)}
      </article> : <article className="panel"><p>No hay una familia vinculada. Consulta el contacto del atleta y los datos de su solicitud federativa.</p></article>}
      <article className="panel"><h3>Datos rellenados para la federación</h3><p>Información presentada en la inscripción; puede diferir del contacto actual.</p>
        {athlete.federation_license_applications.length ? athlete.federation_license_applications.map((form, index) => <dl key={index}>
          <Field label="Estado de la solicitud" value={statuses[form.status] || form.status} /><Field label="Categoría FAM" value={form.training_category} /><Field label="Categoría de competición" value={form.competition_category} />
          <Field label="Fecha de solicitud" value={new Date(form.submitted_at).toLocaleDateString("es-ES")} />
          {Object.entries(form.form_data || {}).map(([key, value]) => <Field key={key} label={labels[key] || key.replaceAll("_", " ")} value={value} />)}
        </dl>) : <p>No consta una solicitud federativa para este atleta.</p>}
      </article>
    </>}
  </section>;
}

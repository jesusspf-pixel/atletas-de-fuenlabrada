import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import "./public-club-site.css";

type PublicGroup = {
  id: string;
  name: string;
  category_label: string;
  schedule_days?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  active: boolean;
};

type ClubIdentity = {
  club_name: string;
  logo_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address_line: string | null;
  season_label: string | null;
  registration_open: boolean | null;
  registration_message: string | null;
};

const time = (value?: string | null) => value ? value.slice(0, 5) : "";

export default function PublicClubSite({ onLogin, onSignup }: { onLogin: () => void; onSignup: () => void }) {
  const [identity, setIdentity] = useState<ClubIdentity | null>(null);
  const [groups, setGroups] = useState<PublicGroup[]>([]);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    void Promise.all([
      client.from("club_settings").select("club_name,logo_url,contact_email,contact_phone,address_line,season_label,registration_open,registration_message").eq("id", true).maybeSingle(),
      client.from("training_groups").select("id,name,category_label,schedule_days,starts_at,ends_at,active").eq("active", true).order("starts_at"),
    ]).then(([clubResult, groupResult]) => {
      if (clubResult.data) setIdentity(clubResult.data as ClubIdentity);
      if (groupResult.data) setGroups(groupResult.data as PublicGroup[]);
    });
  }, []);

  const name = identity?.club_name || "Club Atletas de Fuenlabrada";
  const email = identity?.contact_email || "info@atletasdefuenlabrada.com";
  const scroll = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return <main className="public-club-site">
    <header className="public-nav">
      <button className="public-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Volver al inicio">
        {identity?.logo_url ? <img src={identity.logo_url} alt="Escudo del club" /> : <b>AF</b>}
        <span>CLUB ATLETAS<small>DE FUENLABRADA</small></span>
      </button>
      <nav>
        <button onClick={() => scroll("club")}>El club</button>
        <button onClick={() => scroll("grupos")}>Grupos</button>
        <button onClick={() => scroll("inscripcion")}>Inscripción</button>
        <button onClick={() => scroll("contacto")}>Contacto</button>
      </nav>
      <button className="public-login" onClick={onLogin}>Acceso privado</button>
    </header>

    <section className="public-hero">
      <div className="public-hero-copy">
        <small>ATLETISMO · ESCUELA · COMPETICIÓN · RUNNING</small>
        <h1>Tu pista.<br />Tu equipo.<br /><em>Tu mejor versión.</em></h1>
        <p>Un club para empezar, crecer y seguir disfrutando del atletismo a cualquier edad. Entrenamiento organizado, seguimiento deportivo y una comunidad que comparte pista.</p>
        <div className="public-hero-actions">
          <button className="public-primary" onClick={onSignup}>Quiero inscribirme</button>
          <button className="public-secondary" onClick={() => scroll("grupos")}>Ver grupos y horarios</button>
        </div>
        <div className="public-season"><span>Temporada</span><b>{identity?.season_label || "2026 / 27"}</b></div>
      </div>
      <div className="public-hero-art" aria-hidden="true">
        <div className="track-ring ring-one" />
        <div className="track-ring ring-two" />
        <div className="track-ring ring-three" />
        <div className="hero-stat"><b>AF</b><span>Fuenlabrada</span></div>
      </div>
    </section>

    <section className="public-intro" id="club">
      <div><small>MUCHO MÁS QUE ENTRENAR</small><h2>Un club pensado para acompañar toda la vida deportiva.</h2></div>
      <p>Desde los primeros pasos en atletismo hasta el entrenamiento de adultos y máster. Cada grupo trabaja con objetivos adaptados a su edad y nivel, con entrenadores, planificación y seguimiento dentro de la propia plataforma del club.</p>
    </section>

    <section className="public-values">
      <article><span>01</span><h3>Escuela de atletismo</h3><p>Aprendizaje progresivo de carrera, saltos y lanzamientos desde las categorías más pequeñas.</p></article>
      <article><span>02</span><h3>Competición</h3><p>Calendario, convocatorias, resultados y marcas reunidos en un mismo entorno para atletas y familias.</p></article>
      <article><span>03</span><h3>Running y Máster</h3><p>Entrenamiento para adultos con objetivos personales, seguimiento de actividad y conexión deportiva.</p></article>
      <article><span>04</span><h3>Una app para el club</h3><p>Plan semanal, avisos, cuotas, tienda, competiciones y evolución deportiva desde una sola cuenta.</p></article>
    </section>

    <section className="public-groups" id="grupos">
      <div className="public-section-head"><small>ENTRENA CON NOSOTROS</small><h2>Grupos y horarios</h2><p>Encuentra el grupo que corresponde a tu categoría. La asignación definitiva se confirma durante la revisión de la inscripción.</p></div>
      <div className="public-groups-grid">
        {groups.length ? groups.map(group => <article key={group.id}><small>{group.category_label}</small><h3>{group.name}</h3><p>{group.schedule_days || "Horario pendiente de confirmar"}</p>{(group.starts_at || group.ends_at) && <b>{time(group.starts_at)}{group.ends_at ? ` — ${time(group.ends_at)}` : ""}</b>}</article>) : <>
          <article><small>INICIACIÓN</small><h3>Escuela</h3><p>Categorías de formación</p><b>Consulta horarios</b></article>
          <article><small>DESARROLLO</small><h3>Categorías menores</h3><p>Entrenamiento técnico y multilateral</p><b>Consulta disponibilidad</b></article>
          <article><small>RENDIMIENTO</small><h3>Competición</h3><p>Preparación por especialidades</p><b>Según grupo</b></article>
          <article><small>ADULTOS</small><h3>Máster / Running</h3><p>Entrenamiento y seguimiento</p><b>Varias sesiones</b></article>
        </>}
      </div>
    </section>

    <section className="public-digital">
      <div className="public-digital-card"><small>TODO EN TU CUENTA</small><h2>El club también continúa fuera de la pista.</h2><p>Cada atleta o familia dispone de su espacio personal para consultar lo que necesita durante la temporada.</p><div className="public-chip-row"><span>Plan semanal</span><span>Resultados</span><span>Marcas</span><span>Competiciones</span><span>Avisos</span><span>Cuotas</span></div></div>
      <div className="public-phone-mock"><div><small>ESTA SEMANA</small><b>Plan de entrenamiento</b><span>Tu entrenador publica aquí el trabajo del grupo.</span></div><div><small>MI TEMPORADA</small><b>Marcas y resultados</b><span>Tu evolución deportiva siempre disponible.</span></div></div>
    </section>

    <section className="public-join" id="inscripcion">
      <div><small>INSCRIPCIONES</small><h2>Empieza tu temporada con nosotros.</h2><p>{identity?.registration_message || "Crea tu cuenta, completa los datos del atleta y el club revisará la solicitud antes de activar el alta."}</p></div>
      <div className="public-join-steps"><span><b>1</b>Crea tu cuenta</span><span><b>2</b>Completa la inscripción</span><span><b>3</b>El club revisa el alta</span></div>
      <button className="public-primary" onClick={onSignup}>{identity?.registration_open === false ? "Solicitar información" : "Iniciar inscripción"}</button>
    </section>

    <section className="public-contact" id="contacto">
      <div><small>DÓNDE ENTRENAMOS</small><h2>Fuenlabrada</h2><p>{identity?.address_line || "Instalaciones deportivas del club en Fuenlabrada."}</p></div>
      <div className="public-contact-data"><a href={`mailto:${email}`}>{email}</a>{identity?.contact_phone && <a href={`tel:${identity.contact_phone.replace(/\s/g, "")}`}>{identity.contact_phone}</a>}<button onClick={onLogin}>Ya soy del club → Acceder</button></div>
    </section>

    <footer className="public-footer"><div className="public-brand">{identity?.logo_url ? <img src={identity.logo_url} alt="" /> : <b>AF</b>}<span>{name.toUpperCase()}</span></div><p>Club Atletas de Fuenlabrada · Plataforma oficial del club.</p><button onClick={onLogin}>Acceso familias, atletas y equipo</button></footer>
  </main>;
}

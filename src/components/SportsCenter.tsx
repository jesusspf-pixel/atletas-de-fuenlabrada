import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { AthleteResults, ClubRankings } from "./AthleteResults";

type Role = "owner" | "admin" | "coach" | "parent" | "adult_athlete" | "minor_athlete";
type Profile = { id: string; email: string; full_name: string | null; role: Role };
type Group = { id: string; name: string; category_label: string; colour: string; schedule_days?: string | null; starts_at?: string | null; ends_at?: string | null };
type Athlete = { id: string; first_name: string; last_name: string; license_number: string | null; federation_license?: string | null; license_status: string; training_group_id: string | null; user_profile_id?: string | null; training_groups?: Group | null };
type Note = { id: string; athlete_id: string; body: string; coach_profile_id: string; created_at: string };
type Message = { id: string; athlete_id: string | null; training_group_id: string | null; subject: string; body: string; created_at: string };

const displayLicense = (athlete: Athlete) => athlete.federation_license || athlete.license_number || (athlete.license_status === "active" ? "Activa" : "Pendiente");

export default function SportsCenter() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedAthleteId, setSelectedAthleteId] = useState("");
  const [mode, setMode] = useState<"athletes" | "ranking">("athletes");

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    const boot = async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      if (!data.session) { setLoading(false); return; }
      const { data: profileData } = await supabase.from("profiles").select("id,email,full_name,role").eq("id", data.session.user.id).maybeSingle();
      setProfile(profileData as Profile | null);
      setLoading(false);
    };
    void boot();
  }, []);

  useEffect(() => {
    if (!profile || !supabase) return;
    const load = async () => {
      const athleteQuery = supabase.from("athletes").select("id,first_name,last_name,license_number,federation_license,license_status,training_group_id,user_profile_id,training_groups(*)").order("last_name");
      const { data: athleteData } = await athleteQuery;
      setAthletes((athleteData ?? []) as Athlete[]);
      if (profile.role === "coach") {
        const { data: linkData } = await supabase.from("training_group_coaches").select("training_groups(*)").eq("coach_profile_id", profile.id);
        const ownGroups = (linkData ?? []).map((row: any) => row.training_groups).filter(Boolean) as Group[];
        setGroups(ownGroups);
        if (!selectedGroupId && ownGroups[0]) setSelectedGroupId(ownGroups[0].id);
      } else if (["owner", "admin"].includes(profile.role)) {
        const { data: groupData } = await supabase.from("training_groups").select("*").order("name");
        setGroups((groupData ?? []) as Group[]);
      }
    };
    void load();
  }, [profile?.id]);

  if (loading) return <main className="secure-screen"><section className="access-box"><h1>Cargando área deportiva…</h1></section></main>;
  if (!session || !profile) return <main className="secure-screen"><section className="access-box"><h1>Área deportiva</h1><p>Inicia sesión primero en la aplicación del club.</p><a className="button-link" href="/">Volver al acceso</a></section></main>;

  const isStaff = ["owner", "admin", "coach"].includes(profile.role);
  const visibleAthletes = profile.role === "coach" && selectedGroupId ? athletes.filter(a => a.training_group_id === selectedGroupId) : athletes;
  const selected = athletes.find(a => a.id === selectedAthleteId) || null;

  return <main className="club-shell sports-center-shell">
    <aside className="club-side">
      <div className="portal-brand"><b>AF</b><span>ÁREA<small>DEPORTIVA</small></span></div>
      <small className="side-role">{profile.role === "coach" ? "Entrenador" : profile.role === "parent" ? "Familia" : profile.role === "owner" ? "Propietario" : profile.role === "admin" ? "Administrador" : "Atleta"}</small>
      <nav>
        <button className={mode === "athletes" ? "selected" : ""} onClick={() => setMode("athletes")}>{profile.role === "coach" ? "Mis grupos" : "Marcas"}</button>
        {isStaff && <button className={mode === "ranking" ? "selected" : ""} onClick={() => setMode("ranking")}>Ranking interno</button>}
      </nav>
      <div className="side-user"><b>{profile.full_name || profile.email}</b><small>Resultados, marcas y seguimiento</small><a className="button-link outline" href="/">Volver a la aplicación</a></div>
    </aside>
    <section className="club-content">
      <header className="topbar"><span>Club Atletas de Fuenlabrada · Área deportiva</span></header>
      {mode === "ranking" ? <ClubRankings /> : profile.role === "coach" ? <CoachSports profile={profile} groups={groups} athletes={visibleAthletes} selectedGroupId={selectedGroupId} setSelectedGroupId={id => { setSelectedGroupId(id); setSelectedAthleteId(""); }} selected={selected} selectAthlete={setSelectedAthleteId} /> : <MemberSports profile={profile} athletes={athletes} selected={selected} selectAthlete={setSelectedAthleteId} />}
    </section>
  </main>;
}

function CoachSports({ profile, groups, athletes, selectedGroupId, setSelectedGroupId, selected, selectAthlete }: { profile: Profile; groups: Group[]; athletes: Athlete[]; selectedGroupId: string; setSelectedGroupId: (id: string) => void; selected: Athlete | null; selectAthlete: (id: string) => void }) {
  const currentGroup = groups.find(g => g.id === selectedGroupId);
  return <>
    <div className="page-head"><div><h1>Mis grupos</h1><p>Entra en un grupo para abrir cada atleta, guardar notas, marcas y enviar mensajes.</p></div></div>
    <section className="cards">{groups.map(group => <button key={group.id} className={`panel group-card group-button ${selectedGroupId === group.id ? "selected-row" : ""}`} onClick={() => setSelectedGroupId(group.id)}><i style={{ background: group.colour }} /><h2>{group.name}</h2><p>{group.category_label}</p><small>{group.schedule_days || "Horario pendiente"}</small></button>)}{!groups.length && <article className="panel empty">No tienes grupos asignados.</article>}</section>
    {currentGroup && <><div className="page-head"><div><h1>{currentGroup.name}</h1><p>{athletes.length} atleta(s) · pulsa uno para abrir su ficha deportiva.</p></div><GroupMessage profile={profile} group={currentGroup} /></div><article className="panel table">{athletes.map(a => <button className={`row athlete-row ${selected?.id === a.id ? "selected-row" : ""}`} key={a.id} onClick={() => selectAthlete(a.id)}><span><b>{a.first_name} {a.last_name}</b><small>{currentGroup.category_label}</small></span><span>Licencia: {displayLicense(a)}</span><span>Ver ficha →</span></button>)}{!athletes.length && <p className="empty">No hay atletas asignados a este grupo.</p>}</article></>}
    {selected && <CoachAthlete profile={profile} athlete={selected} />}
  </>;
}

function CoachAthlete({ profile, athlete }: { profile: Profile; athlete: Athlete }) {
  const [notes, setNotes] = useState<Note[]>([]); const [note, setNote] = useState(""); const [notice, setNotice] = useState("");
  const loadNotes = async () => { if (!supabase) return; const { data } = await supabase.from("coach_athlete_notes").select("id,athlete_id,body,coach_profile_id,created_at").eq("athlete_id", athlete.id).order("created_at", { ascending: false }); setNotes((data ?? []) as Note[]); };
  useEffect(() => { void loadNotes(); }, [athlete.id]);
  const saveNote = async (e: FormEvent) => { e.preventDefault(); if (!supabase || !note.trim()) return; const { error } = await supabase.from("coach_athlete_notes").insert({ athlete_id: athlete.id, coach_profile_id: profile.id, body: note.trim(), private_to_staff: true }); if (error) return setNotice(error.message); setNote(""); setNotice("Nota privada guardada."); void loadNotes(); };
  return <section className="athlete-detail"><div className="page-head"><div><h1>{athlete.first_name} {athlete.last_name}</h1><p>{athlete.training_groups?.name || "Grupo"} · Licencia {displayLicense(athlete)}</p></div></div><div className="two-columns"><form className="panel stacked-form" onSubmit={saveNote}><h2>Nota privada</h2><p>Solo la ve el cuerpo técnico autorizado.</p><textarea required value={note} onChange={e => setNote(e.target.value)} placeholder="Ej. Hoy mejoró mucho la salida; 60 m en 9.18." /><button>Guardar nota</button>{notice && <p className={notice.startsWith("Nota") ? "success-note" : "error-note"}>{notice}</p>}<div className="coach-note-list">{notes.map(item => <article key={item.id}><p>{item.body}</p><small>{new Date(item.created_at).toLocaleString("es-ES")}</small></article>)}{!notes.length && <small>No hay notas todavía.</small>}</div></form><AthleteMessage profile={profile} athlete={athlete} /></div><AthleteResults athleteId={athlete.id} canAddTraining coachProfileId={profile.id} /></section>;
}

function AthleteMessage({ profile, athlete }: { profile: Profile; athlete: Athlete }) {
  const [subject, setSubject] = useState(""); const [body, setBody] = useState(""); const [notice, setNotice] = useState("");
  const send = async (e: FormEvent) => { e.preventDefault(); if (!supabase) return; const { error } = await supabase.from("coach_athlete_messages").insert({ coach_profile_id: profile.id, athlete_id: athlete.id, training_group_id: athlete.training_group_id, subject, body }); if (error) return setNotice(error.message); setSubject(""); setBody(""); setNotice("Mensaje enviado a la familia del atleta."); };
  return <form className="panel stacked-form" onSubmit={send}><h2>Mensaje sobre {athlete.first_name}</h2><label>Asunto<input required value={subject} onChange={e => setSubject(e.target.value)} /></label><label>Mensaje<textarea required value={body} onChange={e => setBody(e.target.value)} /></label><button>Enviar mensaje</button>{notice && <p className={notice.startsWith("Mensaje") ? "success-note" : "error-note"}>{notice}</p>}</form>;
}

function GroupMessage({ profile, group }: { profile: Profile; group: Group }) {
  const [open, setOpen] = useState(false); const [subject, setSubject] = useState(""); const [body, setBody] = useState(""); const [notice, setNotice] = useState("");
  const send = async (e: FormEvent) => { e.preventDefault(); if (!supabase) return; const { error } = await supabase.from("coach_athlete_messages").insert({ coach_profile_id: profile.id, training_group_id: group.id, athlete_id: null, subject, body }); if (error) return setNotice(error.message); setSubject(""); setBody(""); setNotice("Mensaje enviado a las familias del grupo."); };
  if (!open) return <button onClick={() => setOpen(true)}>Mensaje al grupo</button>;
  return <form className="panel inline-form group-message-form" onSubmit={send}><label>Asunto<input required value={subject} onChange={e => setSubject(e.target.value)} /></label><label>Mensaje<input required value={body} onChange={e => setBody(e.target.value)} /></label><button>Enviar</button><button type="button" className="outline" onClick={() => setOpen(false)}>Cerrar</button>{notice && <small>{notice}</small>}</form>;
}

function MemberSports({ profile, athletes, selected, selectAthlete }: { profile: Profile; athletes: Athlete[]; selected: Athlete | null; selectAthlete: (id: string) => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  useEffect(() => { if (!supabase) return; void supabase.from("coach_athlete_messages").select("id,athlete_id,training_group_id,subject,body,created_at").order("created_at", { ascending: false }).then(({ data }) => setMessages((data ?? []) as Message[])); }, [profile.id]);
  const selectedMessages = selected ? messages.filter(message => message.athlete_id === selected.id || (!message.athlete_id && message.training_group_id === selected.training_group_id)) : [];
  return <><div className="page-head"><div><h1>{profile.role === "parent" ? "Marcas de mis atletas" : "Mis marcas"}</h1><p>Resultados oficiales, mejores marcas y evolución deportiva.</p></div></div><section className="cards">{athletes.map(a => <button key={a.id} className={`panel athlete-summary ${selected?.id === a.id ? "selected-row" : ""}`} onClick={() => selectAthlete(a.id)}><h2>{a.first_name} {a.last_name}</h2><p>{a.training_groups?.name || "Grupo pendiente"}</p><small>Licencia: {displayLicense(a)} · Ver marcas →</small></button>)}</section>{selected && <section className="athlete-detail"><div className="page-head"><div><h1>{selected.first_name} {selected.last_name}</h1><p>{selected.training_groups?.name || "Sin grupo"} · Licencia {displayLicense(selected)}</p></div></div>{selectedMessages.length > 0 && <article className="panel"><h2>Mensajes del entrenador</h2>{selectedMessages.map(message => <article className="summary-line" key={message.id}><span><b>{message.subject}</b><small>{message.body}</small></span><small>{new Date(message.created_at).toLocaleString("es-ES")}</small></article>)}</article>}<AthleteResults athleteId={selected.id} /></section>}</>;
}

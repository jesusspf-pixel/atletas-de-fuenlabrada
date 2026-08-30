import { FormEvent, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { AthleteResults } from "./AthleteResults";
import HistoricalRanking from "./HistoricalRanking";
import ClubChallenge from "./ClubChallenge";
import AppNavIcon from "./AppNavIcon";
import { withOfficialTrainingSchedule, withOfficialTrainingSchedules } from "../lib/trainingGroupSchedule";

type Role = "owner" | "admin" | "coach" | "parent" | "adult_athlete" | "minor_athlete";
type Profile = { id: string; email: string; full_name: string | null; role: Role };
type Group = { id: string; name: string; category_label: string; colour: string; schedule_days?: string | null; starts_at?: string | null; ends_at?: string | null };
type Athlete = { id: string; first_name: string; last_name: string; license_number: string | null; federation_license?: string | null; license_status: string; training_group_id: string | null; user_profile_id?: string | null; training_groups?: Group | null };
type Note = { id: string; athlete_id: string; body: string; coach_profile_id: string; created_at: string };
type CoachMessage = { id: string; athlete_id: string | null; training_group_id: string | null; subject: string; body: string; created_at: string };
type Entry = { athlete_id: string; status: string; competition_events?: { title: string; starts_at: string; venue: string | null }[] | null };

const displayLicense = (athlete: Athlete) => athlete.federation_license || athlete.license_number || (athlete.license_status === "active" ? "Activa" : "Pendiente");
const requested = () => new URLSearchParams(window.location.search);

export default function SportsCenter() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedAthleteId, setSelectedAthleteId] = useState("");
  const [mode, setMode] = useState<"athletes" | "ranking" | "challenge">(requested().get("view") === "ranking" ? "ranking" : "athletes");
  const [challengeAthleteId, setChallengeAthleteId] = useState("");
  const [athleteAvatars, setAthleteAvatars] = useState<Record<string,string>>({});

  useEffect(() => {
    const client = supabase; if (!client) { setLoading(false); return; }
    const boot = async () => {
      const { data } = await client.auth.getSession(); setSession(data.session);
      if (!data.session) { setLoading(false); return; }
      const { data: profileData } = await client.from("profiles").select("id,email,full_name,role").eq("id", data.session.user.id).maybeSingle();
      const requestedAthleteId = requested().get("athleteId");
      if (profileData && ["owner", "admin"].includes(profileData.role) && requestedAthleteId) {
        window.sessionStorage.setItem("admin-performance-athlete", requestedAthleteId);
        window.location.replace(`/?access=1&section=Atletas&athleteId=${encodeURIComponent(requestedAthleteId)}`);
        return;
      }
      setProfile(profileData as Profile | null); setLoading(false);
    };
    void boot();
  }, []);

  useEffect(() => {
    const client = supabase; if (!profile || !client) return;
    const load = async () => {
      const { data: athleteData } = await client.from("athletes").select("id,first_name,last_name,license_number,federation_license,license_status,training_group_id,user_profile_id,training_groups(*)").order("last_name");
      const ownAthletes = ((athleteData ?? []) as unknown as Athlete[]).map(athlete => athlete.training_groups ? { ...athlete, training_groups: withOfficialTrainingSchedule(athlete.training_groups) } : athlete);
      setAthletes(ownAthletes);
      if (ownAthletes.length) {
        const { data: avatarData } = await client.from("athlete_profile_settings").select("athlete_id,avatar_url").in("athlete_id", ownAthletes.map(athlete => athlete.id));
        setAthleteAvatars(Object.fromEntries((avatarData || []).filter(item => item.avatar_url).map(item => [item.athlete_id, item.avatar_url])));
      }
      let selectedChallengeAthleteId = "";
      if (ownAthletes.length) {
        const { data: challengeSettings } = await client.from("athlete_profile_settings").select("athlete_id").in("athlete_id", ownAthletes.map(athlete => athlete.id)).eq("challenge_opt_in", true).limit(1);
        selectedChallengeAthleteId = challengeSettings?.[0]?.athlete_id || "";
        setChallengeAthleteId(selectedChallengeAthleteId);
      }
      const athleteId = requested().get("athleteId");
      const athleteName = requested().get("athleteName")?.toLowerCase();
      const targetAthlete = athleteId ? ownAthletes.find(a => a.id === athleteId) : athleteName ? ownAthletes.find(a => `${a.first_name} ${a.last_name}`.toLowerCase() === athleteName) : null;
      if (targetAthlete) setSelectedAthleteId(targetAthlete.id);
      else if (["adult_athlete", "minor_athlete"].includes(profile.role) && ownAthletes.length === 1) setSelectedAthleteId(ownAthletes[0].id);
      if (requested().get("view") === "ranking") setMode("ranking");
      if (requested().get("view") === "challenge" && selectedChallengeAthleteId) setMode("challenge");

      if (profile.role === "coach") {
        const { data: linkData } = await client.from("training_group_coaches").select("training_groups(*)").eq("coach_profile_id", profile.id);
        const ownGroups = withOfficialTrainingSchedules((linkData ?? []).map((row: any) => row.training_groups).filter(Boolean) as Group[]);
        setGroups(ownGroups);
        const requestedGroupId = requested().get("groupId");
        const requestedName = requested().get("groupName");
        const targetGroup = targetAthlete?.training_group_id ? ownGroups.find(group => group.id === targetAthlete.training_group_id) : requestedGroupId ? ownGroups.find(group => group.id === requestedGroupId) : requestedName ? ownGroups.find(group => group.name === requestedName) : null;
        setSelectedGroupId(current => targetGroup?.id || current);
      } else if (["owner", "admin"].includes(profile.role)) {
        const { data: groupData } = await client.from("training_groups").select("*").order("name");
        setGroups(withOfficialTrainingSchedules((groupData ?? []) as Group[]));
      }
    };
    void load();
  }, [profile]);

  if (loading) return <main className="secure-screen"><section className="access-box"><h1>Cargando área deportiva…</h1></section></main>;
  if (!session || !profile) return <main className="secure-screen"><section className="access-box"><h1>Área deportiva</h1><p>Inicia sesión primero en la aplicación del club.</p><a className="button-link" href="/">Volver al acceso</a></section></main>;

  const visibleAthletes = profile.role === "coach" && selectedGroupId ? athletes.filter(a => a.training_group_id === selectedGroupId) : athletes;
  const selected = athletes.find(a => a.id === selectedAthleteId) || null;

  const mainMenu=[...(profile.role==="coach"?["Inicio","Mi perfil","Mis grupos","Planificación","Asistencia","Carreras","Avisos","Club Challenge"]:["owner","admin"].includes(profile.role)?["Inicio","Atletas","Grupos","Cuotas","Carreras","Asistencia","Avisos","Invitaciones","Tienda","Configuración"]:profile.role==="minor_athlete"?["Inicio","Mi perfil","Carreras","Avisos"]:["Inicio",profile.role==="parent"?"Mis atletas":"Mi perfil","Carreras","Cuotas","Avisos","Tienda","Challenge"]),"Salir"];
  const menuAvatar=athleteAvatars[athletes[0]?.id];
  const isStaff = profile.role === "coach" || ["owner", "admin"].includes(profile.role);
  return <main className={`club-shell sports-center-shell visual-next-shell ${profile.role === "coach" ? "coach-next-shell" : ["owner","admin"].includes(profile.role) ? "admin-next-shell" : "member-next-shell"}`}><aside className="club-side">{menuAvatar?<div className="portal-brand member-menu-avatar"><img src={menuAvatar} alt="Foto de perfil"/></div>:<a className="sports-home-mark" href="/" aria-label="Volver al inicio">AF</a>}<small className="side-role">{profile.role === "coach" ? "Entrenador" : profile.role === "parent" ? "Familia" : profile.role === "owner" ? "Propietario" : profile.role === "admin" ? "Administrador" : "Atleta"}</small><nav>{mainMenu.map(item=><button data-main-nav="true" key={item} className={(item==="Challenge"&&mode==="challenge")?"selected":""} onClick={()=>item==="Challenge"&&challengeAthleteId?setMode("challenge"):item==="Club Challenge"?setMode("challenge"):window.location.assign(`/?section=${encodeURIComponent(item)}`)}><AppNavIcon name={item}/><span>{item}</span></button>)}{!isStaff&&<button onClick={()=>window.location.assign(`/?section=${encodeURIComponent("Marcas")}`)}><AppNavIcon name="Marcas"/><span>Marcas</span></button>}<button className={mode === "ranking" ? "selected" : ""} onClick={() => setMode("ranking")}><AppNavIcon name="Ranking del club"/><span>Ranking</span></button>{isStaff&&<button className={mode === "athletes" ? "selected" : ""} onClick={() => setMode("athletes")}><AppNavIcon name="Mis grupos"/><span>{profile.role === "coach" ? "Mis grupos" : "Atletas"}</span></button>}</nav><div className="side-user"><b>{profile.full_name || profile.email}</b><small>Resultados, marcas y seguimiento</small><a className="button-link outline" href="/club">← Web del club</a></div></aside><section className="club-content"><div className="visual-page-body">{mode === "ranking" ? <HistoricalRanking /> : mode === "challenge" && (profile.role === "coach" || challengeAthleteId) ? <><div className="page-head"><div><h1>Club Challenge</h1><p>Tu reto semanal y la clasificación del club.</p></div><button className="outline" onClick={() => setMode("athletes")}>Volver a atletas y marcas</button></div><ClubChallenge athleteId={challengeAthleteId || undefined} /></> : profile.role === "coach" ? <CoachSports profile={profile} groups={groups} athletes={visibleAthletes} avatars={athleteAvatars} selectedGroupId={selectedGroupId} setSelectedGroupId={id => { setSelectedGroupId(id); setSelectedAthleteId(""); }} selected={selected} selectAthlete={setSelectedAthleteId} /> : <MemberSports profile={profile} athletes={athletes} avatars={athleteAvatars} selected={selected} selectAthlete={setSelectedAthleteId} />}</div></section></main>;
}

function AthleteParticipation({ athleteId }: { athleteId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  useEffect(() => { const client = supabase; if (!client) return; void client.from("competition_entries").select("athlete_id,status,competition_events(title,starts_at,venue)").eq("athlete_id", athleteId).order("created_at", { ascending: false }).then(({ data }) => setEntries((data ?? []) as Entry[])); }, [athleteId]);
  return <article className="panel"><h2>Competiciones</h2>{entries.length ? entries.map((entry,index) => <p key={`${entry.athlete_id}-${index}`}><b>{entry.competition_events?.[0]?.title || "Competición"}</b><br /><small>{entry.competition_events?.[0]?.starts_at ? new Date(entry.competition_events[0].starts_at).toLocaleDateString("es-ES") : "Fecha pendiente"}{entry.competition_events?.[0]?.venue ? ` · ${entry.competition_events[0].venue}` : ""} · {entry.status}</small></p>) : <p>Aún no hay competiciones registradas para este atleta.</p>}</article>;
}

function CoachSports({ profile, groups, athletes, avatars, selectedGroupId, setSelectedGroupId, selected, selectAthlete }: { profile: Profile; groups: Group[]; athletes: Athlete[]; avatars:Record<string,string>; selectedGroupId: string; setSelectedGroupId: (id: string) => void; selected: Athlete | null; selectAthlete: (id: string) => void }) {
  const currentGroup = groups.find(g => g.id === selectedGroupId);
  if(selected)return <CoachAthlete profile={profile} athlete={selected} back={()=>selectAthlete("")}/>;
  if(currentGroup)return <><div className="page-head"><div><button className="outline" onClick={()=>setSelectedGroupId("")}>← Mis grupos</button><h1>{currentGroup.name}</h1><p>{athletes.length} atleta(s) · pulsa uno para abrir su ficha individual.</p></div><GroupMessage profile={profile} group={currentGroup}/></div><article className="panel table">{athletes.map(a=><button className="row athlete-row" key={a.id} onClick={()=>selectAthlete(a.id)}><span className="athlete-list-person">{avatars[a.id]?<img src={avatars[a.id]} alt=""/>:<i>{`${a.first_name[0]||""}${a.last_name[0]||""}`}</i>}<span><b>{a.first_name} {a.last_name}</b><small>{currentGroup.category_label}</small></span></span><span>Licencia: {displayLicense(a)}</span><span>Ver ficha →</span></button>)}{!athletes.length&&<p>Este grupo todavía no tiene atletas visibles.</p>}</article></>;
  return <><div className="page-head"><div><h1>Mis grupos</h1><p>Selecciona un grupo para abrirlo en su propia pantalla.</p></div></div><section className="cards">{groups.map(group=><button key={group.id} className="panel group-card group-button" onClick={()=>setSelectedGroupId(group.id)}><i style={{background:group.colour}}/><h2>{group.name}</h2><p>{group.category_label}</p><small>{group.schedule_days||"Horario pendiente"}</small></button>)}</section></>;
}

function CoachAthlete({ profile, athlete, back }: { profile: Profile; athlete: Athlete; back:()=>void }) {
  const [notes, setNotes] = useState<Note[]>([]); const [note, setNote] = useState(""); const [notice, setNotice] = useState("");
  const loadNotes = async () => { const client = supabase; if (!client) return; const { data } = await client.from("coach_athlete_notes").select("id,athlete_id,body,coach_profile_id,created_at").eq("athlete_id", athlete.id).order("created_at", { ascending: false }); setNotes((data ?? []) as Note[]); };
  useEffect(() => { void loadNotes(); }, [athlete.id]);
  const saveNote = async (e: FormEvent) => { e.preventDefault(); const client = supabase; if (!client || !note.trim()) return; const { error } = await client.from("coach_athlete_notes").insert({ athlete_id: athlete.id, coach_profile_id: profile.id, body: note.trim(), private_to_staff: true }); if (error) return setNotice(error.message); setNote(""); setNotice("Nota privada guardada."); void loadNotes(); };
  return <section className="athlete-detail"><div className="page-head"><div><button className="outline" onClick={back}>← Volver al grupo</button><h1>{athlete.first_name} {athlete.last_name}</h1><p>{athlete.training_groups?.name || "Grupo"} · Licencia {displayLicense(athlete)}</p></div></div><article className="panel"><small>DATOS DEL ATLETA</small><h2>{athlete.first_name} {athlete.last_name}</h2><p>Grupo: {athlete.training_groups?.name||"Sin asignar"} · Licencia: {displayLicense(athlete)}</p></article><AthleteContact athleteId={athlete.id}/><div className="detail-grid"><AthleteMessage profile={profile} athlete={athlete}/><form className="panel stacked-form" onSubmit={saveNote}><h2>Nota privada</h2><p>Solo la ve el cuerpo técnico autorizado.</p><textarea required value={note} onChange={e=>setNote(e.target.value)}/><button>Guardar nota</button>{notice&&<p className={notice.startsWith("Nota")?"success-note":"error-note"}>{notice}</p>}<div className="coach-note-list">{notes.map(item=><article key={item.id}><p>{item.body}</p><small>{new Date(item.created_at).toLocaleString("es-ES")}</small></article>)}</div></form></div><AthleteParticipation athleteId={athlete.id}/><AthleteResults athleteId={athlete.id} athleteName={`${athlete.first_name} ${athlete.last_name}`} canAddTraining coachProfileId={profile.id} canPlanFitness canRecordFitness={false} showPerformance={/running/i.test(athlete.training_groups?.name||"")}/></section>;
}

function AthleteContact({athleteId}:{athleteId:string}){
  const[contacts,setContacts]=useState<{name:string;relationship:string;phone:string}[]>([]),[loading,setLoading]=useState(true);
  useEffect(()=>{let active=true;const load=async()=>{const client=supabase;if(!client)return setLoading(false);const{data}=await client.auth.getSession();if(!data.session)return setLoading(false);const response=await fetch(`/api/coach-athlete-contact?athleteId=${encodeURIComponent(athleteId)}`,{headers:{authorization:`Bearer ${data.session.access_token}`}});const payload=await response.json().catch(()=>null) as {contacts?:typeof contacts}|null;if(active){setContacts(payload?.contacts||[]);setLoading(false)}};void load();return()=>{active=false}},[athleteId]);
  const label=(value:string)=>value==="padre"?"Padre":value==="madre"?"Madre":value==="tutor_legal"?"Tutor/a legal":"Contacto personal";
  return <article className="panel coach-contact-card"><small>DATOS DE CONTACTO</small><h2>Familia o tutor</h2>{loading?<p>Cargando contacto…</p>:contacts.length?<div className="coach-contact-list">{contacts.map((contact,index)=><div key={`${contact.name}-${index}`}><span><b>{contact.name}</b><small>{label(contact.relationship)}</small></span>{contact.phone?<a href={`tel:${contact.phone.replace(/\s/g,"")}`}>{contact.phone}</a>:<em>Teléfono no disponible</em>}</div>)}</div>:<p>No hay un contacto familiar registrado para este atleta.</p>}</article>;
}

function AthleteMessage({ profile, athlete }: { profile: Profile; athlete: Athlete }) {
  const [subject, setSubject] = useState(""); const [body, setBody] = useState(""); const [notice, setNotice] = useState("");
  const send = async (e: FormEvent) => { e.preventDefault(); const client = supabase; if (!client) return; const { error } = await client.from("coach_athlete_messages").insert({ coach_profile_id: profile.id, athlete_id: athlete.id, training_group_id: athlete.training_group_id, subject, body }); if (error) return setNotice(error.message); setSubject(""); setBody(""); setNotice("Mensaje enviado a la familia del atleta."); };
  return <form className="panel stacked-form" onSubmit={send}><h2>Mensaje a {athlete.first_name}</h2><label>Asunto<input required value={subject} onChange={e => setSubject(e.target.value)} /></label><label>Mensaje<textarea required value={body} onChange={e => setBody(e.target.value)} /></label><button>Enviar mensaje</button>{notice && <p>{notice}</p>}</form>;
}

function GroupMessage({ profile, group }: { profile: Profile; group: Group }) {
  const [open, setOpen] = useState(false); const [subject, setSubject] = useState(""); const [body, setBody] = useState(""); const [notice, setNotice] = useState("");
  const send = async (e: FormEvent) => { e.preventDefault(); const client = supabase; if (!client) return; const { error } = await client.from("coach_athlete_messages").insert({ coach_profile_id: profile.id, training_group_id: group.id, athlete_id: null, subject, body }); if (error) return setNotice(error.message); setSubject(""); setBody(""); setNotice("Mensaje enviado a las familias del grupo."); };
  if (!open) return <button onClick={() => setOpen(true)}>Mensaje al grupo</button>;
  return <form className="panel inline-form group-message-form" onSubmit={send}><label>Asunto<input required value={subject} onChange={e => setSubject(e.target.value)} /></label><label>Mensaje<input required value={body} onChange={e => setBody(e.target.value)} /></label><button>Enviar</button><button type="button" className="outline" onClick={() => setOpen(false)}>Cerrar</button>{notice && <small>{notice}</small>}</form>;
}

function MemberSports({ profile, athletes, avatars, selected, selectAthlete }: { profile: Profile; athletes: Athlete[]; avatars:Record<string,string>; selected: Athlete | null; selectAthlete: (id: string) => void }) {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [athleteSearch, setAthleteSearch] = useState("");
  const normalizedSearch = athleteSearch.trim().toLocaleLowerCase("es-ES");
  const displayedAthletes = normalizedSearch ? athletes.filter(athlete => `${athlete.first_name} ${athlete.last_name}`.toLocaleLowerCase("es-ES").includes(normalizedSearch)) : athletes;
  useEffect(() => { const client = supabase; if (!client) return; void client.from("coach_athlete_messages").select("id,athlete_id,training_group_id,subject,body,created_at").order("created_at", { ascending: false }).then(({ data }) => setMessages((data ?? []) as CoachMessage[])); }, [profile.id]);
  const selectedMessages = selected ? messages.filter(message => message.athlete_id === selected.id || (!message.athlete_id && message.training_group_id === selected.training_group_id)) : [];
  const heading = profile.role === "parent" ? "Mis atletas" : ["owner","admin"].includes(profile.role) ? "Fichas deportivas" : "Mi ficha deportiva";
  const isOwnAdultCard = ["adult_athlete", "minor_athlete"].includes(profile.role);
  if (isOwnAdultCard && selected) return <section className="athlete-detail member-own-sports"><div className="page-head"><div><h1>Mi ficha deportiva</h1><p>{selected.first_name} {selected.last_name} · {selected.training_groups?.name || "Sin grupo"} · Licencia {displayLicense(selected)}</p></div></div><div className="detail-grid"><AthleteParticipation athleteId={selected.id} />{selectedMessages.length > 0 && <article className="panel"><h2>Mensajes del entrenador</h2>{selectedMessages.map(message => <article className="summary-line" key={message.id}><span><b>{message.subject}</b><small>{message.body}</small></span><small>{new Date(message.created_at).toLocaleString("es-ES")}</small></article>)}</article>}</div><AthleteResults athleteId={selected.id} athleteName={`${selected.first_name} ${selected.last_name}`} /></section>;
  return <><div className="page-head"><div><h1>{heading}</h1><p>Licencia, competiciones, resultados oficiales y marcas de entrenamiento en una sola ficha.</p></div></div><section className="panel athlete-search"><label>Buscar atleta<input type="search" value={athleteSearch} onChange={event => setAthleteSearch(event.target.value)} placeholder="Nombre o apellidos" /></label><small>{displayedAthletes.length} atleta(s) encontrado(s)</small></section><section className="cards">{displayedAthletes.map(a => <button key={a.id} className={`panel athlete-summary ${selected?.id === a.id ? "selected-row" : ""}`} onClick={() => selectAthlete(a.id)}><span className="athlete-list-person">{avatars[a.id]?<img src={avatars[a.id]} alt=""/>:<i>{`${a.first_name[0]||""}${a.last_name[0]||""}`}</i>}<span><h2>{a.first_name} {a.last_name}</h2><p>{a.training_groups?.name || "Grupo pendiente"}</p></span></span><small>Licencia: {displayLicense(a)} · Ver ficha deportiva →</small></button>)}</section>{!displayedAthletes.length && <article className="panel"><p>No hay atletas que coincidan con la búsqueda.</p></article>}{selected && <section className="athlete-detail"><div className="page-head"><div><h1>{selected.first_name} {selected.last_name}</h1><p>{selected.training_groups?.name || "Sin grupo"} · Licencia {displayLicense(selected)}</p></div></div><div className="detail-grid"><AthleteParticipation athleteId={selected.id} />{selectedMessages.length > 0 && <article className="panel"><h2>Mensajes del entrenador</h2>{selectedMessages.map(message => <article className="summary-line" key={message.id}><span><b>{message.subject}</b><small>{message.body}</small></span><small>{new Date(message.created_at).toLocaleString("es-ES")}</small></article>)}</article>}</div><AthleteResults athleteId={selected.id} athleteName={`${selected.first_name} ${selected.last_name}`} showPerformance={/running/i.test(selected.training_groups?.name||"")}/></section>}</>;
}

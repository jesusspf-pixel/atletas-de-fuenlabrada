import { FormEvent, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { AthleteResults } from "./AthleteResults";
import HistoricalRanking from "./HistoricalRanking";
import ClubChallenge from "./ClubChallenge";

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
  const [mode, setMode] = useState<"athletes" | "ranking" | "challenge">("athletes");
  const [challengeAthleteId, setChallengeAthleteId] = useState("");

  useEffect(() => {
    const client = supabase; if (!client) { setLoading(false); return; }
    const boot = async () => {
      const { data } = await client.auth.getSession(); setSession(data.session);
      if (!data.session) { setLoading(false); return; }
      const { data: profileData } = await client.from("profiles").select("id,email,full_name,role").eq("id", data.session.user.id).maybeSingle();
      setProfile(profileData as Profile | null); setLoading(false);
    };
    void boot();
  }, []);

  useEffect(() => {
    const client = supabase; if (!profile || !client) return;
    const load = async () => {
      const { data: athleteData } = await client.from("athletes").select("id,first_name,last_name,license_number,federation_license,license_status,training_group_id,user_profile_id,training_groups(*)").order("last_name");
      const ownAthletes = (athleteData ?? []) as unknown as Athlete[];
      setAthletes(ownAthletes);
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
      if (requested().get("view") === "challenge" && selectedChallengeAthleteId) setMode("challenge");

      if (profile.role === "coach") {
        const { data: linkData } = await client.from("training_group_coaches").select("training_groups(*)").eq("coach_profile_id", profile.id);
        const ownGroups = (linkData ?? []).map((row: any) => row.training_groups).filter(Boolean) as Group[];
        setGroups(ownGroups);
        const requestedName = requested().get("groupName");
        const targetGroup = targetAthlete?.training_group_id ? ownGroups.find(group => group.id === targetAthlete.training_group_id) : requestedName ? ownGroups.find(group => group.name === requestedName) : null;
        setSelectedGroupId(current => targetGroup?.id || current || ownGroups[0]?.id || "");
      } else if (["owner", "admin"].includes(profile.role)) {
        const { data: groupData } = await client.from("training_groups").select("*").order("name");
        setGroups((groupData ?? []) as Group[]);
      }
    };
    void load();
  }, [profile]);

  if (loading) return <main className="secure-screen"><section className="access-box"><h1>Cargando área deportiva…</h1></section></main>;
  if (!session || !profile) return <main className="secure-screen"><section className="access-box"><h1>Área deportiva</h1><p>Inicia sesión primero en la aplicación del club.</p><a className="button-link" href="/">Volver al acceso</a></section></main>;

  const isStaff = ["owner", "admin", "coach"].includes(profile.role);
  const visibleAthletes = profile.role === "coach" && selectedGroupId ? athletes.filter(a => a.training_group_id === selectedGroupId) : athletes;
  const selected = athletes.find(a => a.id === selectedAthleteId) || null;

  return <main className="club-shell sports-center-shell"><aside className="club-side"><div className="portal-brand"><b>AF</b><span>ÁREA<small>DEPORTIVA</small></span></div><small className="side-role">{profile.role === "coach" ? "Entrenador" : profile.role === "parent" ? "Familia" : profile.role === "owner" ? "Propietario" : profile.role === "admin" ? "Administrador" : "Atleta"}</small><nav><button className={mode === "athletes" ? "selected" : ""} onClick={() => setMode("athletes")}>{profile.role === "coach" ? "Mis grupos" : "Atletas y marcas"}</button>{challengeAthleteId && <button className={mode === "challenge" ? "selected" : ""} onClick={() => setMode("challenge")}>🏆 Club Challenge</button>}{isStaff && <button className={mode === "ranking" ? "selected" : ""} onClick={() => setMode("ranking")}>Ranking interno</button>}</nav><div className="side-user"><b>{profile.full_name || profile.email}</b><small>Resultados, marcas y seguimiento</small><a className="button-link outline" href="/">Volver a la aplicación</a><a className="button-link outline" href="/club">← Web del club</a></div></aside><section className="club-content"><header className="topbar"><span>Club Atletas de Fuenlabrada · Área deportiva</span></header>{mode === "challenge" && challengeAthleteId ? <><div className="page-head"><div><h1>Club Challenge</h1><p>Tu reto semanal y la clasificación del club.</p></div><button className="outline" onClick={() => setMode("athletes")}>Volver a atletas y marcas</button></div><ClubChallenge athleteId={challengeAthleteId} /></> : mode === "ranking" ? <HistoricalRanking /> : profile.role === "coach" ? <CoachSports profile={profile} groups={groups} athletes={visibleAthletes} selectedGroupId={selectedGroupId} setSelectedGroupId={id => { setSelectedGroupId(id); setSelectedAthleteId(""); }} selected={selected} selectAthlete={setSelectedAthleteId} /> : <MemberSports profile={profile} athletes={athletes} selected={selected} selectAthlete={setSelectedAthleteId} />}</section></main>;
}

function AthleteParticipation({ athleteId }: { athleteId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  useEffect(() => { const client = supabase; if (!client) return; void client.from("competition_entries").select("athlete_id,status,competition_events(title,starts_at,venue)").eq("athlete_id", athleteId).order("created_at", { ascending: false }).then(({ data }) => setEntries((data ?? []) as Entry[])); }, [athleteId]);
  return <article className="panel"><h2>Competiciones</h2>{entries.length ? entries.map((entry,index) => <p key={`${entry.athlete_id}-${index}`}><b>{entry.competition_events?.[0]?.title || "Competición"}</b><br /><small>{entry.competition_events?.[0]?.starts_at ? new Date(entry.competition_events[0].starts_at).toLocaleDateString("es-ES") : "Fecha pendiente"}{entry.competition_events?.[0]?.venue ? ` · ${entry.competition_events[0].venue}` : ""} · {entry.status}</small></p>) : <p>Aún no hay competiciones registradas para este atleta.</p>}</article>;
}

function CoachSports({ profile, groups, athletes, selectedGroupId, setSelectedGroupId, selected, selectAthlete }: { profile: Profile; groups: Group[]; athletes: Athlete[]; selectedGroupId: string; setSelectedGroupId: (id: string) => void; selected: Athlete | null; selectAthlete: (id: string) => void }) {
  const currentGroup = groups.find(g => g.id === selectedGroupId);
  return <><div className="page-head"><div><h1>Mis grupos</h1><p>Entra en un grupo para abrir cada atleta, guardar notas, marcas y enviar mensajes.</p></div></div><section className="cards">{groups.map(group => <button key={group.id} className={`panel group-card group-button ${selectedGroupId === group.id ? "selected-row" : ""}`} onClick={() => setSelectedGroupId(group.id)}><i style={{ background: group.colour }} /><h2>{group.name}</h2><p>{group.category_label}</p><small>{group.schedule_days || "Horario pendiente"}</small></button>)}</section>{currentGroup && <><div className="page-head"><div><h1>{currentGroup.name}</h1><p>{athletes.length} atleta(s) · pulsa uno para abrir su ficha deportiva.</p></div><GroupMessage profile={profile} group={currentGroup} /></div><article className="panel table">{athletes.map(a => <button className={`row athlete-row ${selected?.id === a.id ? "selected-row" : ""}`} key={a.id} onClick={() => selectAthlete(a.id)}><span><b>{a.first_name} {a.last_name}</b><small>{currentGroup.category_label}</small></span><span>Licencia: {displayLicense(a)}</span><span>Ver ficha →</span></button>)}</article></>}{selected && <CoachAthlete profile={profile} athlete={selected} />}</>;
}

function CoachAthlete({ profile, athlete }: { profile: Profile; athlete: Athlete }) {
  const [notes, setNotes] = useState<Note[]>([]); const [note, setNote] = useState(""); const [notice, setNotice] = useState("");
  const loadNotes = async () => { const client = supabase; if (!client) return; const { data } = await client.from("coach_athlete_notes").select("id,athlete_id,body,coach_profile_id,created_at").eq("athlete_id", athlete.id).order("created_at", { ascending: false }); setNotes((data ?? []) as Note[]); };
  useEffect(() => { void loadNotes(); }, [athlete.id]);
  const saveNote = async (e: FormEvent) => { e.preventDefault(); const client = supabase; if (!client || !note.trim()) return; const { error } = await client.from("coach_athlete_notes").insert({ athlete_id: athlete.id, coach_profile_id: profile.id, body: note.trim(), private_to_staff: true }); if (error) return setNotice(error.message); setNote(""); setNotice("Nota privada guardada."); void loadNotes(); };
  return <section className="athlete-detail"><div className="page-head"><div><h1>{athlete.first_name} {athlete.last_name}</h1><p>{athlete.training_groups?.name || "Grupo"} · Licencia {displayLicense(athlete)}</p></div></div><div className="detail-grid"><AthleteParticipation athleteId={athlete.id} /><form className="panel stacked-form" onSubmit={saveNote}><h2>Nota privada</h2><p>Solo la ve el cuerpo técnico autorizado.</p><textarea required value={note} onChange={e => setNote(e.target.value)} /><button>Guardar nota</button>{notice && <p className={notice.startsWith("Nota") ? "success-note" : "error-note"}>{notice}</p>}<div className="coach-note-list">{notes.map(item => <article key={item.id}><p>{item.body}</p><small>{new Date(item.created_at).toLocaleString("es-ES")}</small></article>)}</div></form><AthleteMessage profile={profile} athlete={athlete} /></div><AthleteResults athleteId={athlete.id} canAddTraining coachProfileId={profile.id} /></section>;
}

function AthleteMessage({ profile, athlete }: { profile: Profile; athlete: Athlete }) {
  const [subject, setSubject] = useState(""); const [body, setBody] = useState(""); const [notice, setNotice] = useState("");
  const send = async (e: FormEvent) => { e.preventDefault(); const client = supabase; if (!client) return; const { error } = await client.from("coach_athlete_messages").insert({ coach_profile_id: profile.id, athlete_id: athlete.id, training_group_id: athlete.training_group_id, subject, body }); if (error) return setNotice(error.message); setSubject(""); setBody(""); setNotice("Mensaje enviado a la familia del atleta."); };
  return <form className="panel stacked-form" onSubmit={send}><h2>Mensaje sobre {athlete.first_name}</h2><label>Asunto<input required value={subject} onChange={e => setSubject(e.target.value)} /></label><label>Mensaje<textarea required value={body} onChange={e => setBody(e.target.value)} /></label><button>Enviar mensaje</button>{notice && <p>{notice}</p>}</form>;
}

function GroupMessage({ profile, group }: { profile: Profile; group: Group }) {
  const [open, setOpen] = useState(false); const [subject, setSubject] = useState(""); const [body, setBody] = useState(""); const [notice, setNotice] = useState("");
  const send = async (e: FormEvent) => { e.preventDefault(); const client = supabase; if (!client) return; const { error } = await client.from("coach_athlete_messages").insert({ coach_profile_id: profile.id, training_group_id: group.id, athlete_id: null, subject, body }); if (error) return setNotice(error.message); setSubject(""); setBody(""); setNotice("Mensaje enviado a las familias del grupo."); };
  if (!open) return <button onClick={() => setOpen(true)}>Mensaje al grupo</button>;
  return <form className="panel inline-form group-message-form" onSubmit={send}><label>Asunto<input required value={subject} onChange={e => setSubject(e.target.value)} /></label><label>Mensaje<input required value={body} onChange={e => setBody(e.target.value)} /></label><button>Enviar</button><button type="button" className="outline" onClick={() => setOpen(false)}>Cerrar</button>{notice && <small>{notice}</small>}</form>;
}

function MemberSports({ profile, athletes, selected, selectAthlete }: { profile: Profile; athletes: Athlete[]; selected: Athlete | null; selectAthlete: (id: string) => void }) {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  useEffect(() => { const client = supabase; if (!client) return; void client.from("coach_athlete_messages").select("id,athlete_id,training_group_id,subject,body,created_at").order("created_at", { ascending: false }).then(({ data }) => setMessages((data ?? []) as CoachMessage[])); }, [profile.id]);
  const selectedMessages = selected ? messages.filter(message => message.athlete_id === selected.id || (!message.athlete_id && message.training_group_id === selected.training_group_id)) : [];
  const heading = profile.role === "parent" ? "Mis atletas" : ["owner","admin"].includes(profile.role) ? "Fichas deportivas" : "Mi ficha deportiva";
  return <><div className="page-head"><div><h1>{heading}</h1><p>Licencia, competiciones, resultados oficiales y marcas de entrenamiento en una sola ficha.</p></div></div><section className="cards">{athletes.map(a => <button key={a.id} className={`panel athlete-summary ${selected?.id === a.id ? "selected-row" : ""}`} onClick={() => selectAthlete(a.id)}><h2>{a.first_name} {a.last_name}</h2><p>{a.training_groups?.name || "Grupo pendiente"}</p><small>Licencia: {displayLicense(a)} · Ver ficha deportiva →</small></button>)}</section>{selected && <section className="athlete-detail"><div className="page-head"><div><h1>{selected.first_name} {selected.last_name}</h1><p>{selected.training_groups?.name || "Sin grupo"} · Licencia {displayLicense(selected)}</p></div></div><div className="detail-grid"><AthleteParticipation athleteId={selected.id} />{selectedMessages.length > 0 && <article className="panel"><h2>Mensajes del entrenador</h2>{selectedMessages.map(message => <article className="summary-line" key={message.id}><span><b>{message.subject}</b><small>{message.body}</small></span><small>{new Date(message.created_at).toLocaleString("es-ES")}</small></article>)}</article>}</div><AthleteResults athleteId={selected.id} /></section>}</>;
}

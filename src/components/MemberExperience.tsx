import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import AthleteProfileEditor from "./AthleteProfileEditor";

type Athlete = {
  id: string;
  first_name: string;
  last_name: string;
  club_status: string;
  license_status: string;
  license_number: string | null;
  federation_license?: string | null;
  training_group_id: string | null;
  training_groups?: { name: string; category_label: string } | null;
};
type Ledger = { id: string; charge_kind: "enrolment" | "recurring" | "manual"; approved_amount_cents: number | null; calculated_amount_cents: number; status: string; scheduled_for: string | null };
type Entry = { athlete_id: string; status: string; competition_events?: { title: string; starts_at: string; venue: string | null }[] | null };
type TrainingPlan = { id: string; title: string; body: string; week_starts_on: string; training_group_id: string; published_at: string | null };
type TrainingDocument = { id: string; title: string; storage_path: string; training_group_id: string | null; created_at: string };
type ProfileSettings = { athlete_id: string; avatar_url: string | null; cover_url: string | null; bio: string | null; challenge_opt_in: boolean; show_activity_to_club: boolean };
type GroupMate = { id: string; first_name: string; last_name: string; avatar_url?: string | null };
type GroupCoach = { coach_profile_id: string; full_name: string; avatar_url?: string | null; role_label?: string };
type PlanDay = { day: string; load: string; sections: { label: string; value: string }[] };

const euro = (cents: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
const licenseText = (athlete: Athlete) => athlete.federation_license || athlete.license_number || (athlete.license_status === "active" ? "Activa" : "Pendiente");
const parseWeeklyPlan = (body: string): PlanDay[] => body.split(/\n\n(?=(?:LUNES|MARTES|MIÉRCOLES|JUEVES|VIERNES|SÁBADO|DOMINGO)\n)/).map(block => { const lines=block.split("\n").filter(Boolean); const day=lines.shift()||""; if(!/^(LUNES|MARTES|MIÉRCOLES|JUEVES|VIERNES|SÁBADO|DOMINGO)$/.test(day))return null; const load=lines.shift()||""; const sections=lines.map(line=>{const separator=line.indexOf(":");return separator>0?{label:line.slice(0,separator),value:line.slice(separator+1).trim()}:{label:"Detalle",value:line}}); return {day:day.charAt(0)+day.slice(1).toLowerCase(),load,sections}; }).filter((item):item is PlanDay=>Boolean(item));

export default function MemberExperience({ profileId }: { profileId: string }) {
  const [mode, setMode] = useState<"home" | "profile" | "group" | null>(null);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [documents, setDocuments] = useState<TrainingDocument[]>([]);
  const [profileSettings, setProfileSettings] = useState<ProfileSettings | null>(null);
  const [planNotice, setPlanNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [groupMates, setGroupMates] = useState<GroupMate[]>([]);
  const [groupCoaches, setGroupCoaches] = useState<GroupCoach[]>([]);
  const [activePlanDay, setActivePlanDay] = useState(0);

  useEffect(() => {
    const detect = () => {
      const selected = document.querySelector<HTMLButtonElement>(".club-side nav button.selected")?.textContent?.replace(/\d+/g, "").trim() || "";
      setMode(selected.startsWith("Inicio") ? "home" : selected.startsWith("Mi perfil") ? "profile" : selected.startsWith("Mi grupo") ? "group" : null);
    };
    detect();
    const observer = new MutationObserver(detect);
    const nav = document.querySelector(".club-side nav");
    if (nav) observer.observe(nav, { attributes: true, subtree: true, attributeFilter: ["class"] });
    document.addEventListener("click", detect, true);
    return () => { observer.disconnect(); document.removeEventListener("click", detect, true); };
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!supabase) return;
      setLoading(true);
      const { data: athleteData } = await supabase.from("athletes").select("id,first_name,last_name,club_status,license_status,license_number,federation_license,training_group_id,training_groups(name,category_label)").eq("user_profile_id", profileId).order("created_at");
      const mine = (athleteData ?? []) as unknown as Athlete[];
      setAthletes(mine);
      if (!mine.length) { setLedger([]); setEntries([]); setPlans([]); setDocuments([]); setProfileSettings(null); setLoading(false); return; }
      const ids = mine.map(a => a.id);
      const groupIds = [...new Set(mine.map(a => a.training_group_id).filter((id): id is string => Boolean(id)))];
      const [{ data: ledgerData }, { data: entryData }, planResult, documentResult, settingsResult] = await Promise.all([
        supabase.from("billing_charge_drafts").select("id,charge_kind,approved_amount_cents,calculated_amount_cents,status,scheduled_for").in("athlete_id", ids).order("scheduled_for", { ascending: true }),
        supabase.from("competition_entries").select("athlete_id,status,competition_events(title,starts_at,venue)").in("athlete_id", ids).order("created_at", { ascending: false }),
        groupIds.length ? supabase.from("training_plans").select("id,title,body,week_starts_on,training_group_id,published_at").in("training_group_id", groupIds).not("published_at", "is", null).order("published_at", { ascending: false, nullsFirst: false }).limit(Math.max(20, groupIds.length * 5)) : Promise.resolve({ data: [] }),
        groupIds.length ? supabase.from("club_documents").select("id,title,storage_path,training_group_id,created_at").eq("document_type", "training_plan").in("training_group_id", groupIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
        supabase.from("athlete_profile_settings").select("athlete_id,avatar_url,cover_url,bio,challenge_opt_in,show_activity_to_club").eq("athlete_id", mine[0].id).maybeSingle(),
      ]);
      setLedger((ledgerData ?? []) as Ledger[]);
      setEntries((entryData ?? []) as Entry[]);
      setPlans((planResult.data ?? []) as TrainingPlan[]);
      setDocuments((documentResult.data ?? []) as TrainingDocument[]);
      setProfileSettings((settingsResult.data as ProfileSettings | null) ?? null);
      setLoading(false);
    };
    void load();
  }, [profileId, refreshVersion]);

  useEffect(() => {
    if (!supabase) return;
    const refresh = () => setRefreshVersion(value => value + 1);
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60000);
    const channel = supabase.channel(`member-plans-${profileId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "training_plans" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "club_documents" }, refresh)
      .subscribe();
    return () => { document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("focus", refresh); window.clearInterval(timer); void supabase?.removeChannel(channel); };
  }, [profileId]);

  const athlete = athletes[0] || null;

  useEffect(() => {
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<ProfileSettings>).detail;
      if (detail && athlete && detail.athlete_id === athlete.id) setProfileSettings(detail);
    };
    window.addEventListener("athlete-profile-updated", onUpdated);
    return () => window.removeEventListener("athlete-profile-updated", onUpdated);
  }, [athlete?.id]);

  useEffect(() => { document.getElementById("global-athlete-header")?.remove(); document.getElementById("athlete-global-header-styles")?.remove(); }, [mode]);

  const upcomingFee = useMemo(() => ledger.find(item => ["awaiting_admin", "approved", "checkout_pending"].includes(item.status) && (!item.scheduled_for || new Date(item.scheduled_for).getTime() >= Date.now() - 86400000)) || null, [ledger]);
  const upcomingCompetition = useMemo(() => entries.map(entry => ({ entry, event: entry.competition_events?.[0] })).filter(item => item.event && new Date(item.event.starts_at).getTime() >= Date.now()).sort((a, b) => new Date(a.event!.starts_at).getTime() - new Date(b.event!.starts_at).getTime())[0] || null, [entries]);
  const currentPlan = useMemo(() => athlete?.training_group_id ? plans.find(plan => plan.training_group_id === athlete.training_group_id) || null : null, [athlete, plans]);
  const planDays = useMemo(() => currentPlan ? parseWeeklyPlan(currentPlan.body) : [], [currentPlan]);
  useEffect(() => { setActivePlanDay(0); }, [currentPlan?.id]);
  const currentPlanDocument = useMemo(() => {
    if (!athlete?.training_group_id || !currentPlan) return null;
    const weekStart = new Date(`${currentPlan.week_starts_on}T00:00:00`);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
    return documents.find(doc => doc.training_group_id === athlete.training_group_id && new Date(doc.created_at) >= weekStart && new Date(doc.created_at) < weekEnd) || null;
  }, [athlete, currentPlan, documents]);

  const openPlanPdf = async () => {
    if (!supabase || !currentPlanDocument) return;
    setPlanNotice("");
    const { data, error } = await supabase.storage.from("club-private-documents").createSignedUrl(currentPlanDocument.storage_path, 120);
    if (error || !data) return setPlanNotice(error?.message || "No se pudo abrir el PDF del plan.");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const openGroup = async () => {
    if (!supabase || !athlete?.training_group_id) return;
    const { data } = await supabase.rpc("get_member_group_roster", { target_group_id: athlete.training_group_id });
    const roster = (data ?? []) as { person_type: string; person_id: string; display_name: string; avatar_url: string | null; role_label?: string }[];
    setGroupCoaches(roster.filter(person => person.person_type === "coach").map(person => ({ coach_profile_id: person.person_id, full_name: person.display_name, avatar_url: person.avatar_url, role_label: person.role_label })));
    setGroupMates(roster.filter(person => person.person_type === "athlete").map(person => { const words = person.display_name.trim().split(/\s+/); return { id: person.person_id, first_name: words[0] || "Atleta", last_name: words.slice(1).join(" "), avatar_url: person.avatar_url }; }));
  };

  const goTo = (label: string) => [...document.querySelectorAll<HTMLButtonElement>(".club-side nav button")].find(item => item.textContent?.trim().startsWith(label))?.click();
  useEffect(() => { if (mode === "group") void openGroup(); }, [mode, athlete?.training_group_id]);

  if (!mode) return null;
  if (loading) return <section className="member-experience"><article className="panel">Cargando tu información…</article></section>;
  if (!athlete) return <section className="member-experience"><div className="page-head"><div><h1>Mi perfil</h1><p>Tu inscripción deportiva todavía no está vinculada a esta cuenta.</p></div></div></section>;

  if (mode === "home") return <section className="design-v2-stage member-live-home"><header className="design-v2-hero"><div><small>INICIO · MI TEMPORADA</small><h1>Todo empieza<br/>aquí.</h1><p>{athlete.training_groups?.name || "Grupo pendiente"} · Licencia {licenseText(athlete)}</p></div></header><section className="design-v2-float">
    <div className="design-v2-title"><div><small>ESTA SEMANA</small><h2>Tu entrenamiento</h2></div><button onClick={() => [...document.querySelectorAll<HTMLButtonElement>(".club-side nav button")].find(item => item.textContent?.trim().startsWith("Mi perfil"))?.click()}>Mi perfil →</button></div>
    <article className="member-live-plan member-week-plan"><div><small>PLAN DE ENTRENAMIENTO</small>{currentPlan?<><h2>{currentPlan.title}</h2><span>Semana del {new Date(`${currentPlan.week_starts_on}T12:00:00`).toLocaleDateString("es-ES")}</span>{planDays.length?<><nav className="member-plan-days">{planDays.map((item,index)=><button type="button" key={item.day} className={activePlanDay===index?"active":""} onClick={()=>setActivePlanDay(index)}><b>{item.day.slice(0,3)}</b><small>{item.day}</small></button>)}</nav><section className="member-plan-session"><header><div><small>SESIÓN</small><h3>{planDays[activePlanDay]?.day}</h3></div><span>{planDays[activePlanDay]?.load}</span></header><div>{planDays[activePlanDay]?.sections.map(section=><article key={section.label}><small>{section.label.toUpperCase()}</small><p>{section.value}</p></article>)}</div></section></>:<p className="member-plan-legacy">{currentPlan.body}</p>}</>:<><h2>Sin plan publicado todavía</h2><p>Cuando tu entrenador publique el plan aparecerá aquí automáticamente.</p></>}</div>{currentPlanDocument&&<button type="button" className="member-plan-pdf" onClick={()=>void openPlanPdf()}>Abrir PDF adjunto&nbsp; ›</button>}{planNotice&&<p className="error-note">{planNotice}</p>}</article>
    <header className="design-v2-section-head"><div><small>RESUMEN</small><h2>Tu actividad en el club</h2></div></header><section className={`member-live-cards${/running/i.test(athlete.training_groups?.name||"")?" has-performance":""}`}><article><i>✓</i><small>ESTADO</small><b>{athlete.club_status==="active"?"Activo":"En revisión"}</b><span>Alta en el club</span></article><article><i>◎</i><small>LICENCIA</small><b>{licenseText(athlete)}</b><span>{athlete.license_status==="active"?"Licencia activa":"Pendiente de tramitar"}</span></article><button className="member-summary-action" onClick={() => setMode("group")}><i>↗</i><small>GRUPO</small><b>{athlete.training_groups?.name||"Pendiente"}</b><span>{athlete.training_groups?.category_label||"Sin asignar"} · Ver grupo</span></button>{/running/i.test(athlete.training_groups?.name||"")&&<button className="member-summary-action member-performance-action" onClick={()=>goTo("Rendimiento")}><i>⌁</i><small>RENDIMIENTO</small><b>Mi evolución</b><span>Forma, fatiga y carga · Ver análisis</span></button>}</section>
    <section className="design-v2-bottom member-live-bottom"><button className="member-bottom-action" onClick={() => goTo("Cuotas")}><header><div><small>PRÓXIMA CUOTA</small><h3>{upcomingFee?upcomingFee.charge_kind==="enrolment"?"Matrícula":"Cuota del club":"Sin cuotas programadas"}</h3></div></header>{upcomingFee?<div><i>€</i><span><b>{euro(upcomingFee.approved_amount_cents??upcomingFee.calculated_amount_cents)}</b><small>{upcomingFee.scheduled_for?new Date(upcomingFee.scheduled_for).toLocaleDateString("es-ES"):"Fecha pendiente"}</small></span><em>›</em></div>:<p>Las próximas cuotas aparecerán aquí.</p>}</button><article><header><div><small>PRÓXIMA COMPETICIÓN</small><h3>{upcomingCompetition?.event?.title||"Sin próxima competición"}</h3></div></header>{upcomingCompetition?.event?<div><i>↗</i><span><b>{upcomingCompetition.event.venue||"Ubicación pendiente"}</b><small>{new Date(upcomingCompetition.event.starts_at).toLocaleDateString("es-ES")}</small></span><em/></div>:<p>Las competiciones confirmadas aparecerán aquí.</p>}</article></section>
  </section></section>;

  if (mode === "group") return <section className="member-group-page"><header><div><small>TU EQUIPO</small><h1>{athlete.training_groups?.name}</h1><p>Entrenadores y atletas que forman tu grupo.</p></div></header><div className="member-group-content"><div><h2>Entrenadores</h2><div className="member-roster">{groupCoaches.map(coach => <article key={coach.coach_profile_id}>{coach.avatar_url ? <img src={coach.avatar_url} alt="" /> : <span className="roster-avatar">{coach.full_name.split(" ").map(word => word[0]).slice(0,2).join("")}</span>}<b>{coach.full_name}</b><small>{coach.role_label || "Entrenador"}</small></article>)}{!groupCoaches.length && <p>No hay entrenador asignado todavía.</p>}</div></div><div><h2>Atletas</h2><div className="member-roster">{groupMates.map(mate => { const avatar = mate.id === athlete.id ? profileSettings?.avatar_url : mate.avatar_url; return <article key={mate.id}>{avatar ? <img src={avatar} alt="" /> : <span className="roster-avatar">{mate.first_name[0]}{mate.last_name[0]}</span>}<b>{mate.first_name} {mate.last_name}</b><small>{mate.id === athlete.id ? "Tú" : athlete.training_groups?.name}</small></article>})}{!groupMates.length && <p>No hay atletas activos en este grupo.</p>}</div></div></div></section>;

  return <section className="member-experience member-profile-page design-v2-stage">
    <header className="design-v2-hero member-profile-hero"><div><small>MI PERFIL</small><h1>{athlete.first_name}<br/>{athlete.last_name}</h1><p>{athlete.training_groups?.name || "Grupo pendiente"} · Licencia {licenseText(athlete)}</p></div></header>
    <section className="design-v2-float member-profile-sheet"><div className="design-v2-title"><div><small>IDENTIDAD DEPORTIVA</small><h2>Tu perfil en el club</h2></div></div><section className="profile-private-editor">
      <AthleteProfileEditor athleteId={athlete.id} canEdit />
    </section>
    <section className="profile-sports-summary profile-sports-next">
      <small>FICHA DEPORTIVA PÚBLICA</small>
      <h2>Resultados, marcas y ranking</h2>
      <p>Consulta tus mejores marcas de entrenamiento y competición, tu histórico y tu posición en el club.</p>
      <div><span><i>↗</i><b>Marcas de entrenamiento</b><small>Registro personal y evolución</small></span><span><i>★</i><b>Resultados oficiales</b><small>Competiciones y mejores marcas</small></span></div>
      <button onClick={() => window.location.assign(`/?section=${encodeURIComponent("Marcas")}`)}>Abrir mi ficha deportiva →</button>
    </section>
    <section className="profile-sports-summary profile-sports-next dependents-access-card">
      <small>FAMILIA</small>
      <h2>Personas a mi cargo</h2>
      <p>Añade y gestiona menores desde tu misma cuenta. Tu perfil deportivo seguirá siendo el principal y la cuenta pasará también a funcionar como cuenta de familia.</p>
      <button onClick={() => window.location.assign(`/?section=${encodeURIComponent("Mis menores")}`)}>Gestionar personas a mi cargo →</button>
    </section>
  </section></section>;
}

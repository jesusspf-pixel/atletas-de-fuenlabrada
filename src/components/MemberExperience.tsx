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

const euro = (cents: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
const licenseText = (athlete: Athlete) => athlete.federation_license || athlete.license_number || (athlete.license_status === "active" ? "Activa" : "Pendiente");
const mondayKey = (value = new Date()) => {
  const date = new Date(value);
  date.setHours(12, 0, 0, 0);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date.toISOString().slice(0, 10);
};

export default function MemberExperience({ profileId }: { profileId: string }) {
  const [mode, setMode] = useState<"home" | "profile" | null>(null);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [documents, setDocuments] = useState<TrainingDocument[]>([]);
  const [profileSettings, setProfileSettings] = useState<ProfileSettings | null>(null);
  const [planNotice, setPlanNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    const detect = () => {
      const selected = document.querySelector<HTMLButtonElement>(".club-side nav button.selected")?.textContent?.replace(/\d+/g, "").trim() || "";
      setMode(selected.startsWith("Inicio") ? "home" : selected.startsWith("Mi perfil") ? "profile" : null);
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
        groupIds.length ? supabase.from("training_plans").select("id,title,body,week_starts_on,training_group_id,published_at").in("training_group_id", groupIds).eq("week_starts_on", mondayKey()).order("published_at", { ascending: false }) : Promise.resolve({ data: [] }),
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

  useEffect(() => {
    if (!athlete) return;
    const content = document.querySelector<HTMLElement>(".club-content");
    const topbar = content?.querySelector<HTMLElement>(".topbar");
    if (!content || !topbar) return;

    let style = document.getElementById("athlete-global-header-styles") as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "athlete-global-header-styles";
      style.textContent = `
        .athlete-global-header{position:relative!important;display:block!important;min-height:170px;margin:18px 24px 8px;padding:0;border-radius:22px;overflow:hidden;background:linear-gradient(135deg,#173f7c,#2464c8);background-size:cover;background-position:center;box-shadow:0 10px 30px rgba(15,35,70,.12)}
        .athlete-global-header::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(5,20,45,.62),rgba(5,20,45,.08) 70%);pointer-events:none}
        .athlete-global-avatar{position:absolute;left:24px;bottom:20px;width:78px;height:78px;border-radius:50%;object-fit:cover;border:4px solid #fff;background:#fff;z-index:1;box-shadow:0 5px 16px rgba(0,0,0,.18)}
        .athlete-global-avatar-placeholder{display:grid;place-items:center;color:#2563eb;font-weight:900;font-size:22px}
        .athlete-global-copy{position:absolute;left:120px;right:24px;bottom:24px;color:#fff;z-index:1;text-shadow:0 1px 3px rgba(0,0,0,.28)}
        .athlete-global-copy h2{margin:0 0 4px;font-size:28px;color:#fff}.athlete-global-copy p{margin:0;color:#fff;font-weight:700}
        @media(max-width:700px){.athlete-global-header{min-height:145px;margin:12px 14px 6px;border-radius:18px}.athlete-global-avatar{width:64px;height:64px;left:16px;bottom:16px}.athlete-global-copy{left:94px;bottom:19px}.athlete-global-copy h2{font-size:20px}}
      `;
      document.head.appendChild(style);
    }

    let header = document.getElementById("global-athlete-header") as HTMLElement | null;
    if (!header) {
      header = document.createElement("section");
      header.id = "global-athlete-header";
      header.className = "topbar athlete-global-header";
      topbar.insertAdjacentElement("afterend", header);
    }
    header.style.backgroundImage = profileSettings?.cover_url
      ? `linear-gradient(90deg,rgba(5,20,45,.48),rgba(5,20,45,.05)), url("${profileSettings.cover_url.replace(/"/g, "%22")}")`
      : "linear-gradient(135deg,#173f7c,#2464c8)";
    header.replaceChildren();

    if (profileSettings?.avatar_url) {
      const image = document.createElement("img");
      image.className = "athlete-global-avatar";
      image.src = profileSettings.avatar_url;
      image.alt = `Foto de ${athlete.first_name} ${athlete.last_name}`;
      header.appendChild(image);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "athlete-global-avatar athlete-global-avatar-placeholder";
      placeholder.textContent = `${athlete.first_name.charAt(0)}${athlete.last_name.charAt(0)}`.toUpperCase();
      header.appendChild(placeholder);
    }

    const copy = document.createElement("div");
    copy.className = "athlete-global-copy";
    const name = document.createElement("h2"); name.textContent = `${athlete.first_name} ${athlete.last_name}`;
    const meta = document.createElement("p"); meta.textContent = `${athlete.training_groups?.name || "Grupo pendiente"} · Licencia ${licenseText(athlete)}`;
    copy.append(name, meta); header.appendChild(copy);

    return () => { header?.remove(); style?.remove(); };
  }, [athlete?.id, athlete?.first_name, athlete?.last_name, athlete?.training_groups?.name, athlete?.license_status, athlete?.license_number, athlete?.federation_license, profileSettings?.avatar_url, profileSettings?.cover_url]);

  const upcomingFee = useMemo(() => ledger.find(item => ["awaiting_admin", "approved", "checkout_pending"].includes(item.status) && (!item.scheduled_for || new Date(item.scheduled_for).getTime() >= Date.now() - 86400000)) || null, [ledger]);
  const upcomingCompetition = useMemo(() => entries.map(entry => ({ entry, event: entry.competition_events?.[0] })).filter(item => item.event && new Date(item.event.starts_at).getTime() >= Date.now()).sort((a, b) => new Date(a.event!.starts_at).getTime() - new Date(b.event!.starts_at).getTime())[0] || null, [entries]);
  const currentPlan = useMemo(() => athlete?.training_group_id ? plans.find(plan => plan.training_group_id === athlete.training_group_id) || null : null, [athlete, plans]);
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

  if (!mode) return null;
  if (loading) return <section className="member-experience"><article className="panel">Cargando tu información…</article></section>;
  if (!athlete) return <section className="member-experience"><div className="page-head"><div><h1>Mi perfil</h1><p>Tu inscripción deportiva todavía no está vinculada a esta cuenta.</p></div></div></section>;

  if (mode === "home") return <section className="member-experience">
    <div className="page-head"><div><small>MI TEMPORADA</small><h1>{athlete.first_name} {athlete.last_name}</h1><p>Resumen de tu situación en el club.</p></div><button onClick={() => [...document.querySelectorAll<HTMLButtonElement>(".club-side nav button")].find(item => item.textContent?.trim().startsWith("Mi perfil"))?.click()}>Abrir mi perfil →</button></div>
    <section className="metric-grid member-home-grid">
      <article className="metric"><small>Estado</small><b>{athlete.club_status === "active" ? "Activo" : "En revisión"}</b><small>Alta en el club</small></article>
      <article className="metric"><small>Licencia</small><b>{licenseText(athlete)}</b><small>{athlete.license_status === "active" ? "Licencia activa" : "Pendiente de tramitar"}</small></article>
      <article className="metric"><small>Grupo</small><b>{athlete.training_groups?.name || "Pendiente"}</b><small>{athlete.training_groups?.category_label || "Sin asignar"}</small></article>
    </section>
    <article className="panel member-week-plan">
      <small>PLAN DE ENTRENAMIENTO · ESTA SEMANA</small>
      {currentPlan ? <><h2>{currentPlan.title}</h2><p style={{ whiteSpace: "pre-wrap" }}>{currentPlan.body}</p><small>Semana del {new Date(`${currentPlan.week_starts_on}T12:00:00`).toLocaleDateString("es-ES")}</small>{currentPlanDocument && <div><button type="button" className="outline" onClick={() => void openPlanPdf()}>Abrir PDF del plan</button></div>}</> : <><h2>Sin plan publicado todavía</h2><p>Cuando tu entrenador publique el plan de esta semana aparecerá aquí automáticamente.</p></>}
      {planNotice && <p className="error-note">{planNotice}</p>}
    </article>
    <section className="two-columns member-next-grid">
      <article className="panel"><small>PRÓXIMA CUOTA</small>{upcomingFee ? <><h2>{upcomingFee.charge_kind === "enrolment" ? "Matrícula" : "Cuota del club"}</h2><p><b>{euro(upcomingFee.approved_amount_cents ?? upcomingFee.calculated_amount_cents)}</b></p><small>{upcomingFee.scheduled_for ? new Date(upcomingFee.scheduled_for).toLocaleDateString("es-ES") : "Fecha pendiente"} · {upcomingFee.status === "awaiting_admin" ? "Pendiente de revisión" : upcomingFee.status === "approved" ? "Aprobada" : "Pendiente de pago"}</small></> : <><h2>Sin cuotas programadas</h2><p>Las próximas cuotas aprobadas aparecerán aquí.</p></>}</article>
      <article className="panel"><small>PRÓXIMA COMPETICIÓN</small>{upcomingCompetition?.event ? <><h2>{upcomingCompetition.event.title}</h2><p>{upcomingCompetition.event.venue || "Ubicación pendiente"}</p><small>{new Date(upcomingCompetition.event.starts_at).toLocaleDateString("es-ES")} · {upcomingCompetition.entry.status}</small></> : <><h2>Sin próxima competición</h2><p>Las competiciones en las que estés inscrito aparecerán aquí.</p></>}</article>
    </section>
  </section>;

  return <section className="member-experience member-profile-page">
    <div className="page-head"><div><small>PERFIL DEPORTIVO</small><h1>{athlete.first_name} {athlete.last_name}</h1><p>{athlete.training_groups?.name || "Grupo pendiente"} · Licencia {licenseText(athlete)}</p></div></div>
    <section className="profile-private-editor">
      <AthleteProfileEditor athleteId={athlete.id} canEdit />
    </section>
    <section className="panel profile-sports-summary">
      <small>FICHA DEPORTIVA PÚBLICA</small>
      <h2>Resultados, marcas y ranking</h2>
      <p>Consulta tus competiciones, resultados oficiales, mejores marcas, histórico y Club Challenge en la ficha deportiva. Esta pantalla no permite editar tu perfil.</p>
      <button onClick={() => window.location.assign(`/deportivo?athleteId=${encodeURIComponent(athlete.id)}`)}>Abrir ficha deportiva y rankings →</button>
    </section>
  </section>;
}

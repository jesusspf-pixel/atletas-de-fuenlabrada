import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import AthleteProfileEditor from "./AthleteProfileEditor";
import ExternalSports from "./ExternalSports";
import { AthleteResults } from "./AthleteResults";

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
type Ledger = { id: string; description: string; amount_cents: number; status: string; scheduled_for: string | null };
type Entry = { athlete_id: string; status: string; competition_events?: { title: string; starts_at: string; venue: string | null }[] | null };

const euro = (cents: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
const licenseText = (athlete: Athlete) => athlete.federation_license || athlete.license_number || (athlete.license_status === "active" ? "Activa" : "Pendiente");

export default function MemberExperience({ profileId }: { profileId: string }) {
  const [mode, setMode] = useState<"home" | "profile" | null>(null);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

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
      if (!mine.length) { setLedger([]); setEntries([]); setLoading(false); return; }
      const ids = mine.map(a => a.id);
      const [{ data: ledgerData }, { data: entryData }] = await Promise.all([
        supabase.from("payment_ledger").select("id,description,amount_cents,status,scheduled_for").in("athlete_id", ids).order("scheduled_for", { ascending: true }),
        supabase.from("competition_entries").select("athlete_id,status,competition_events(title,starts_at,venue)").in("athlete_id", ids).order("created_at", { ascending: false }),
      ]);
      setLedger((ledgerData ?? []) as Ledger[]);
      setEntries((entryData ?? []) as Entry[]);
      setLoading(false);
    };
    void load();
  }, [profileId]);

  const athlete = athletes[0] || null;
  const upcomingFee = useMemo(() => ledger.find(item => item.status !== "paid" && (!item.scheduled_for || new Date(item.scheduled_for).getTime() >= Date.now() - 86400000)) || null, [ledger]);
  const upcomingCompetition = useMemo(() => entries.map(entry => ({ entry, event: entry.competition_events?.[0] })).filter(item => item.event && new Date(item.event.starts_at).getTime() >= Date.now()).sort((a, b) => new Date(a.event!.starts_at).getTime() - new Date(b.event!.starts_at).getTime())[0] || null, [entries]);

  if (!mode) return null;
  if (loading) return <section className="member-experience"><article className="panel">Cargando tu información…</article></section>;
  if (!athlete) return <section className="member-experience"><div className="page-head"><div><h1>Mi perfil</h1><p>Tu inscripción deportiva todavía no está vinculada a esta cuenta.</p></div></div></section>;

  if (mode === "home") return <section className="member-experience">
    <div className="page-head"><div><small>MI TEMPORADA</small><h1>{athlete.first_name} {athlete.last_name}</h1><p>Resumen de tu situación en el club.</p></div><button onClick={() => document.querySelector<HTMLButtonElement>(".club-side nav button:nth-child(2)")?.click()}>Abrir mi perfil →</button></div>
    <section className="metric-grid member-home-grid">
      <article className="metric"><small>Estado</small><b>{athlete.club_status === "active" ? "Activo" : "En revisión"}</b><small>Alta en el club</small></article>
      <article className="metric"><small>Licencia</small><b>{licenseText(athlete)}</b><small>{athlete.license_status === "active" ? "Licencia activa" : "Pendiente de tramitar"}</small></article>
      <article className="metric"><small>Grupo</small><b>{athlete.training_groups?.name || "Pendiente"}</b><small>{athlete.training_groups?.category_label || "Sin asignar"}</small></article>
    </section>
    <section className="two-columns member-next-grid">
      <article className="panel"><small>PRÓXIMA CUOTA</small>{upcomingFee ? <><h2>{upcomingFee.description}</h2><p><b>{euro(upcomingFee.amount_cents)}</b></p><small>{upcomingFee.scheduled_for ? new Date(upcomingFee.scheduled_for).toLocaleDateString("es-ES") : "Fecha pendiente"} · {upcomingFee.status}</small></> : <><h2>Sin cobros pendientes</h2><p>Cuando administración valide las cuotas aparecerán aquí.</p></>}</article>
      <article className="panel"><small>PRÓXIMA COMPETICIÓN</small>{upcomingCompetition?.event ? <><h2>{upcomingCompetition.event.title}</h2><p>{upcomingCompetition.event.venue || "Ubicación pendiente"}</p><small>{new Date(upcomingCompetition.event.starts_at).toLocaleDateString("es-ES")} · {upcomingCompetition.entry.status}</small></> : <><h2>Sin próxima competición</h2><p>Las competiciones en las que estés inscrito aparecerán aquí.</p></>}</article>
    </section>
  </section>;

  return <section className="member-experience member-profile-page">
    <div className="page-head"><div><small>PERFIL DEPORTIVO</small><h1>{athlete.first_name} {athlete.last_name}</h1><p>{athlete.training_groups?.name || "Grupo pendiente"} · Licencia {licenseText(athlete)}</p></div></div>
    <AthleteProfileEditor athleteId={athlete.id} canEdit />
    <section className="profile-shortcuts">
      <button onClick={() => window.location.assign(`/deportivo?athleteId=${encodeURIComponent(athlete.id)}`)}>Resultados y mejores marcas →</button>
    </section>
    <AthleteResults athleteId={athlete.id} canAddTraining={false} />
    <ExternalSports athleteId={athlete.id} />
  </section>;
}

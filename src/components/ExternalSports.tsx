import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Integration = { id: string; athlete_id: string; provider: string; status: string; connected_at: string; last_synced_at: string | null };
type Activity = { id: string; provider: string; provider_activity_id: string; activity_type: string | null; name: string | null; started_at: string; distance_m: number | null; moving_time_s: number | null; elevation_gain_m: number | null; average_heartrate: number | null; source_url: string | null };

const km = (metres: number | null) => metres == null ? "—" : `${(metres / 1000).toFixed(2)} km`;
const duration = (seconds: number | null) => { if (seconds == null) return "—"; const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = Math.floor(seconds % 60); return h ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${m}:${String(s).padStart(2,"0")}`; };
const pace = (metres: number | null, seconds: number | null) => { if (!metres || !seconds) return "—"; const perKm = seconds / (metres / 1000); return `${Math.floor(perKm / 60)}:${String(Math.round(perKm % 60)).padStart(2,"0")}/km`; };

export default function ExternalSports({ athleteId }: { athleteId: string }) {
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [canConnect, setCanConnect] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const client = supabase; if (!client) return;
    const { data: sessionData } = await client.auth.getSession();
    const [{ data: athlete }, { data: integrations }, { data: activityData }] = await Promise.all([
      client.from("athletes").select("user_profile_id").eq("id", athleteId).maybeSingle(),
      client.from("athlete_external_integrations").select("id,athlete_id,provider,status,connected_at,last_synced_at").eq("athlete_id", athleteId).eq("provider", "strava").maybeSingle(),
      client.from("external_sport_activities").select("id,provider,provider_activity_id,activity_type,name,started_at,distance_m,moving_time_s,elevation_gain_m,average_heartrate,source_url").eq("athlete_id", athleteId).order("started_at", { ascending: false }).limit(100),
    ]);
    setCanConnect(Boolean(sessionData.session?.user.id && athlete?.user_profile_id === sessionData.session.user.id));
    setIntegration((integrations as Integration | null) ?? null);
    setActivities((activityData ?? []) as Activity[]);
  };
  useEffect(() => { void load(); }, [athleteId]);

  useEffect(() => {
    const state = new URLSearchParams(window.location.search).get("strava");
    if (state === "connected") { setNotice("Strava conectado correctamente. Pulsa sincronizar para cargar tus actividades."); void load(); }
  }, []);

  const connect = async () => {
    const client = supabase; if (!client) return; setBusy(true); setNotice("");
    const { data } = await client.auth.getSession();
    const response = await fetch("/api/strava-connect", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token || ""}` }, body: JSON.stringify({ athleteId }) });
    const result = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok || !result.url) return setNotice(result.error || "No se pudo iniciar la conexión con Strava.");
    window.location.assign(result.url);
  };

  const sync = async () => {
    const client = supabase; if (!client) return; setBusy(true); setNotice("");
    const { data } = await client.auth.getSession();
    const response = await fetch("/api/strava-sync", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token || ""}` }, body: JSON.stringify({ athleteId }) });
    const result = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) return setNotice(result.error || "No se pudo sincronizar Strava.");
    setNotice(`${result.synced ?? 0} actividades revisadas desde Strava.`); void load();
  };

  const now = Date.now();
  const week = useMemo(() => activities.filter(item => new Date(item.started_at).getTime() >= now - 7 * 86400000), [activities]);
  const month = useMemo(() => activities.filter(item => new Date(item.started_at).getTime() >= now - 30 * 86400000), [activities]);
  const totalKm = (rows: Activity[]) => rows.reduce((sum, item) => sum + Number(item.distance_m || 0), 0) / 1000;

  return <section className="external-sports">
    <article className="panel"><div className="table-title"><div><h2>Conexiones deportivas</h2><p>Entrenamientos registrados automáticamente desde aplicaciones deportivas.</p></div>{canConnect && (!integration || integration.status !== "connected") && <button disabled={busy} onClick={() => void connect()}>{busy ? "Conectando…" : "Conectar Strava"}</button>}{canConnect && integration?.status === "connected" && <button disabled={busy} onClick={() => void sync()}>{busy ? "Sincronizando…" : "Sincronizar Strava"}</button>}</div>{integration?.status === "connected" ? <p><b>Strava conectado</b>{integration.last_synced_at ? ` · Última sincronización ${new Date(integration.last_synced_at).toLocaleString("es-ES")}` : " · Pendiente de primera sincronización"}</p> : <p>{canConnect ? "Puedes conectar tu cuenta personal de Strava. El club nunca recibe tu contraseña." : "Este atleta todavía no ha conectado Strava."}</p>}{notice && <p className={notice.includes("correctamente") || notice.includes("revisadas") ? "success-note" : "error-note"}>{notice}</p>}</article>

    {activities.length > 0 && <><section className="metric-grid"><article className="metric"><small>Últimos 7 días</small><b>{totalKm(week).toFixed(1)} km</b><small>{week.length} actividad(es)</small></article><article className="metric"><small>Últimos 30 días</small><b>{totalKm(month).toFixed(1)} km</b><small>{month.length} actividad(es)</small></article><article className="metric"><small>Actividades guardadas</small><b>{activities.length}</b><small>Strava</small></article></section><article className="panel table"><h2>Actividad reciente</h2>{activities.slice(0,20).map(item => <div className="row" key={item.id}><span><b>{item.name || item.activity_type || "Actividad"}</b><small>{new Date(item.started_at).toLocaleString("es-ES")}</small></span><span><b>{km(item.distance_m)}</b><small>{duration(item.moving_time_s)} · {pace(item.distance_m,item.moving_time_s)}</small></span><span><small>{item.elevation_gain_m != null ? `+${Math.round(item.elevation_gain_m)} m` : ""}{item.average_heartrate != null ? ` · ${Math.round(item.average_heartrate)} ppm` : ""}</small>{item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer">Ver en Strava ↗</a>}</span></div>)}</article></>}
  </section>;
}

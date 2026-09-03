import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

type Integration = { id: string; athlete_id: string; provider: string; provider_athlete_id: string | null; provider_display_name: string | null; provider_avatar_url: string | null; status: string; connected_at: string; last_synced_at: string | null };
type Activity = { id: string; provider: string; provider_activity_id: string; activity_type: string | null; name: string | null; started_at: string; distance_m: number | null; moving_time_s: number | null; elevation_gain_m: number | null; average_heartrate: number | null; source_url: string | null };

const km = (metres: number | null) => metres == null ? "—" : `${(metres / 1000).toFixed(2)} km`;
const duration = (seconds: number | null) => { if (seconds == null) return "—"; const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = Math.floor(seconds % 60); return h ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${m}:${String(s).padStart(2,"0")}`; };
const pace = (metres: number | null, seconds: number | null) => { if (!metres || !seconds) return "—"; const perKm = seconds / (metres / 1000); return `${Math.floor(perKm / 60)}:${String(Math.round(perKm % 60)).padStart(2,"0")}/km`; };
const runningTypes = new Set(["run", "trailrun", "virtualrun", "wheelchair"]);
const activityType = (activity: Activity) => String(activity.activity_type || "").trim().toLowerCase();
const isRunningActivity = (activity: Activity) => runningTypes.has(activityType(activity));

export default function ExternalSports({ athleteId }: { athleteId: string }) {
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [canConnect, setCanConnect] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const autoSyncAttempted = useRef(false);

  const load = async () => {
    const client = supabase; if (!client) return;
    const { data: sessionData } = await client.auth.getSession();
    const [{ data: athlete }, { data: integrations }, { data: activityData }] = await Promise.all([
      client.from("athletes").select("user_profile_id").eq("id", athleteId).maybeSingle(),
      client.from("athlete_external_integrations").select("id,athlete_id,provider,provider_athlete_id,provider_display_name,provider_avatar_url,status,connected_at,last_synced_at").eq("athlete_id", athleteId).eq("provider", "strava").maybeSingle(),
      client.from("external_sport_activities").select("id,provider,provider_activity_id,activity_type,name,started_at,distance_m,moving_time_s,elevation_gain_m,average_heartrate,source_url").eq("athlete_id", athleteId).order("started_at", { ascending: false }).limit(100),
    ]);
    setCanConnect(Boolean(sessionData.session?.user.id && athlete?.user_profile_id === sessionData.session.user.id));
    setIntegration((integrations as Integration | null) ?? null);
    setActivities((activityData ?? []) as Activity[]);
  };
  useEffect(() => { void load(); }, [athleteId]);

  useEffect(() => {
    const state = new URLSearchParams(window.location.search).get("strava");
    if (state === "connected") { setNotice("Strava conectado correctamente. Puedes sincronizar tus actividades."); void load(); }
    if (state === "disconnected") { setNotice("Strava se ha desconectado de esta ficha."); void load(); }
  }, []);

  const authHeaders = async () => {
    const client = supabase; if (!client) return null;
    const { data } = await client.auth.getSession();
    return { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token || ""}` };
  };

  const connect = async () => {
    setBusy(true); setNotice("");
    const headers = await authHeaders(); if (!headers) return;
    const response = await fetch("/api/strava-connect", { method: "POST", headers, body: JSON.stringify({ athleteId }) });
    const result = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok || !result.url) return setNotice(result.error || "No se pudo iniciar la conexión con Strava.");
    window.location.assign(result.url);
  };

  const sync = async () => {
    setBusy(true); setNotice("");
    const headers = await authHeaders(); if (!headers) return;
    const response = await fetch("/api/strava-sync", { method: "POST", headers, body: JSON.stringify({ athleteId }) });
    const result = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) return setNotice(result.error || "No se pudo sincronizar Strava.");
    setNotice(`${result.synced ?? 0} actividades revisadas desde Strava.`); void load();
  };

  useEffect(() => {
    if (!canConnect || integration?.status !== "connected" || autoSyncAttempted.current) return;
    const stale = !integration.last_synced_at || Date.now() - new Date(integration.last_synced_at).getTime() > 30 * 60 * 1000;
    if (!stale) return;
    autoSyncAttempted.current = true;
    void sync();
  }, [canConnect, integration?.id, integration?.status, integration?.last_synced_at]);

  const disconnect = async () => {
    if (!window.confirm("¿Desconectar Strava? Se revocará la autorización y se eliminarán de la plataforma todas las actividades importadas.")) return;
    setBusy(true); setNotice("");
    const headers = await authHeaders(); if (!headers) return;
    const response = await fetch("/api/strava-disconnect", { method: "POST", headers, body: JSON.stringify({ athleteId }) });
    const result = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) return setNotice(result.error || "No se pudo desconectar Strava.");
    setNotice("Strava desconectado."); void load();
  };

  const now = Date.now();
  const runningActivities = useMemo(() => activities.filter(isRunningActivity), [activities]);
  const week = useMemo(() => runningActivities.filter(item => new Date(item.started_at).getTime() >= now - 7 * 86400000), [runningActivities]);
  const totalKm = (rows: Activity[]) => rows.reduce((sum, item) => sum + Number(item.distance_m || 0), 0) / 1000;

  return <section className="external-sports">
    <article className="panel"><div className="table-title"><div><h2>Conexiones deportivas</h2><p>Tu espacio privado para consultar carreras importadas desde Strava.</p></div>{canConnect && (!integration || integration.status !== "connected") && <button disabled={busy} onClick={() => void connect()}>{busy ? "Conectando…" : "Conectar con Strava"}</button>}{canConnect && integration?.status === "connected" && <div className="inline-actions"><button disabled={busy} onClick={() => void sync()}>{busy ? "Sincronizando…" : "Sincronizar Strava"}</button><button className="outline" disabled={busy} onClick={() => void disconnect()}>Desconectar</button></div>}</div>{!canConnect?<p>Los datos importados desde Strava son privados y solo puede verlos el propio atleta autenticado.</p>:integration?.status === "connected" ? <div className="strava-identity">{integration.provider_avatar_url && <img className="provider-avatar" src={integration.provider_avatar_url} alt="Perfil de Strava" />}<div><p><b>Strava conectado: {integration.provider_display_name || "Cuenta Strava"}</b>{integration.provider_athlete_id ? ` · ID ${integration.provider_athlete_id}` : ""}</p><small>Conectado el {new Date(integration.connected_at).toLocaleDateString("es-ES")}{integration.last_synced_at ? ` · Última sincronización ${new Date(integration.last_synced_at).toLocaleString("es-ES")}` : " · Pendiente de primera sincronización"}</small></div></div> : <p>Vas a conectar tu cuenta personal de Strava. Solo importamos actividades de carrera de los últimos 7 días; no se usan para IA, no se muestran a entrenadores o administradores y se eliminan al desconectar. El club nunca recibe tu contraseña.</p>}{notice && <p className={notice.includes("correctamente") || notice.includes("revisadas") || notice.includes("desconectado") ? "success-note" : "error-note"}>{notice}</p>}</article>

    {canConnect && activities.length > 0 && <><section className="metric-grid"><article className="metric"><small>Carrera · últimos 7 días</small><b>{totalKm(week).toFixed(1)} km</b><small>{week.length} carrera(s)</small></article><article className="metric"><small>Actividades recientes</small><b>{week.length}</b><small>solo carrera</small></article><article className="metric"><small>Carreras privadas</small><b>{runningActivities.length}</b><small>Retención máxima: 7 días</small></article></section><article className="panel table"><h2>Tus carreras recientes</h2><p>Esta información solo es visible para ti y se mantiene separada del análisis de IA y del panel del entrenador.</p>{runningActivities.length ? runningActivities.slice(0,20).map(item => <div className="row" key={item.id}><span><b>{item.name || "Carrera"}</b><small>Carrera · {new Date(item.started_at).toLocaleString("es-ES")}</small></span><span><b>{km(item.distance_m)}</b><small>{duration(item.moving_time_s)} · {pace(item.distance_m,item.moving_time_s)}</small></span><span><small>{item.elevation_gain_m != null ? `+${Math.round(item.elevation_gain_m)} m` : ""}{item.average_heartrate != null ? ` · ${Math.round(item.average_heartrate)} ppm` : ""}</small>{item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer">Ver en Strava ↗</a>}</span></div>) : <p>No hay carreras sincronizadas todavía.</p>}</article></>}
  </section>;
}

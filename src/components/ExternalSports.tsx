import { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Health, type Workout } from "@capgo/capacitor-health";
import { supabase } from "../lib/supabase";

type Integration = { id: string; athlete_id: string; provider: string; provider_athlete_id: string | null; provider_display_name: string | null; provider_avatar_url: string | null; status: string; connected_at: string; last_synced_at: string | null };
type Activity = { id: string; provider: string; provider_activity_id: string; activity_type: string | null; name: string | null; started_at: string; distance_m: number | null; moving_time_s: number | null; elevation_gain_m: number | null; average_heartrate: number | null; source_url: string | null };

const km = (metres: number | null) => metres == null ? "—" : `${(metres / 1000).toFixed(2)} km`;
const duration = (seconds: number | null) => { if (seconds == null) return "—"; const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = Math.floor(seconds % 60); return h ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${m}:${String(s).padStart(2,"0")}`; };
const pace = (metres: number | null, seconds: number | null) => { if (!metres || !seconds) return "—"; const perKm = seconds / (metres / 1000); return `${Math.floor(perKm / 60)}:${String(Math.round(perKm % 60)).padStart(2,"0")}/km`; };
const runningTypes = new Set(["run", "trailrun", "virtualrun", "wheelchair"]);
const cyclingTypes = new Set(["ride", "virtualride", "ebikeride", "mountainbikeride", "gravelride"]);
const walkingTypes = new Set(["walk", "hike"]);
const activityType = (activity: Activity) => String(activity.activity_type || "").trim().toLowerCase();
const isRunningActivity = (activity: Activity) => runningTypes.has(activityType(activity));
const excludedActivityLabel = (activity: Activity) => {
  const type = activityType(activity);
  if (cyclingTypes.has(type)) return "Bicicleta · excluida";
  if (walkingTypes.has(type)) return "Caminata · excluida";
  return `${activity.activity_type || "Otro deporte"} · excluida`;
};

export default function ExternalSports({ athleteId }: { athleteId: string }) {
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [canConnect, setCanConnect] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [healthConnected, setHealthConnected] = useState(false);
  const autoSyncAttempted = useRef(false);
  const healthAutoSyncAttempted = useRef(false);

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
    if (!window.confirm("¿Desconectar Strava de esta ficha deportiva? Las actividades ya importadas se conservarán como histórico.")) return;
    setBusy(true); setNotice("");
    const headers = await authHeaders(); if (!headers) return;
    const response = await fetch("/api/strava-disconnect", { method: "POST", headers, body: JSON.stringify({ athleteId }) });
    const result = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) return setNotice(result.error || "No se pudo desconectar Strava.");
    setNotice("Strava desconectado."); void load();
  };

  const healthReadTypes = ["workouts", "heartRate"] as const;
  const averageHeartRate = async (workout: Workout) => {
    try {
      const { samples } = await Health.readSamples({ dataType: "heartRate", startDate: workout.startDate, endDate: workout.endDate, limit: 1000 });
      if (!samples.length) return null;
      return samples.reduce((sum, sample) => sum + Number(sample.value || 0), 0) / samples.length;
    } catch { return null; }
  };

  const syncDeviceHealth = async () => {
    setBusy(true); setNotice("");
    try {
      const availability = await Health.isAvailable();
      if (!availability.available) throw new Error("Health Connect no está disponible en este dispositivo. Comprueba que está instalado y actualizado.");
      const authorization = await Health.requestAuthorization({ read: [...healthReadTypes], write: [] });
      if (!authorization.readAuthorized.includes("workouts")) throw new Error("Necesitamos permiso para leer los entrenamientos. Puedes cambiarlo en Health Connect.");
      setHealthConnected(true);
      const endDate = new Date();
      const startDate = new Date(Date.now() - 30 * 86400000);
      const { workouts } = await Health.queryWorkouts({ startDate: startDate.toISOString(), endDate: endDate.toISOString(), limit: 100, ascending: false });
      const running = workouts.filter(item => ["running", "runningTreadmill", "trackAndField", "wheelchairRunPace"].includes(item.workoutType));
      const activities = await Promise.all(running.map(async item => ({
        id: item.platformId || `${item.sourceId || item.sourceName || "device"}:${item.startDate}:${item.duration}`,
        activityType: "run",
        name: item.workoutType === "runningTreadmill" ? "Carrera en cinta" : "Carrera",
        startedAt: item.startDate,
        endedAt: item.endDate,
        durationSeconds: Math.round(item.duration),
        distanceMetres: item.totalDistance ?? null,
        calories: item.totalEnergyBurned ?? null,
        averageHeartRate: authorization.readAuthorized.includes("heartRate") ? await averageHeartRate(item) : null,
        sourceName: item.sourceName ?? null,
      })));
      const headers = await authHeaders();
      if (!headers) throw new Error("No se pudo comprobar tu sesión.");
      const endpoint = Capacitor.isNativePlatform() ? "https://atletasdefuenlabrada.com/api/device-health-sync" : "/api/device-health-sync";
      const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ athleteId, activities }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "No se pudieron sincronizar los entrenamientos.");
      setNotice(`${result.synced ?? 0} carreras revisadas desde Health Connect.`);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo conectar Health Connect.");
    } finally { setBusy(false); }
  };

  useEffect(() => {
    if (!canConnect || Capacitor.getPlatform() !== "android" || healthAutoSyncAttempted.current) return;
    healthAutoSyncAttempted.current = true;
    void Health.checkAuthorization({ read: [...healthReadTypes], write: [] }).then(status => {
      if (status.readAuthorized.includes("workouts")) void syncDeviceHealth();
    }).catch(() => undefined);
  }, [canConnect, athleteId]);

  const now = Date.now();
  const runningActivities = useMemo(() => activities.filter(isRunningActivity), [activities]);
  const excludedActivities = useMemo(() => activities.filter(item => !isRunningActivity(item)), [activities]);
  const week = useMemo(() => runningActivities.filter(item => new Date(item.started_at).getTime() >= now - 7 * 86400000), [runningActivities]);
  const month = useMemo(() => runningActivities.filter(item => new Date(item.started_at).getTime() >= now - 30 * 86400000), [runningActivities]);
  const totalKm = (rows: Activity[]) => rows.reduce((sum, item) => sum + Number(item.distance_m || 0), 0) / 1000;

  return <section className="external-sports">
    <article className="panel"><div className="table-title"><div><h2>Conectar reloj o aplicación</h2><p>Autoriza una vez y recuperaremos automáticamente tus carreras registradas.</p></div>{canConnect && Capacitor.getPlatform() === "android" && <button disabled={busy} onClick={() => void syncDeviceHealth()}>{busy ? "Sincronizando…" : healthConnected ? "Sincronizar Health Connect" : "Conectar Health Connect"}</button>}{canConnect && (!integration || integration.status !== "connected") && <button className="outline" disabled={busy} onClick={() => void connect()}>{busy ? "Conectando…" : "Conectar Strava"}</button>}{canConnect && integration?.status === "connected" && <div className="inline-actions"><button className="outline" disabled={busy} onClick={() => void sync()}>{busy ? "Sincronizando…" : "Sincronizar Strava"}</button><button className="outline" disabled={busy} onClick={() => void disconnect()}>Desconectar</button></div>}</div>{Capacitor.getPlatform() === "android" && <p><b>Health Connect</b> reúne automáticamente los datos que comparten Garmin Connect, Polar Flow, Samsung Health, Fitbit y otros servicios instalados en tu Android.</p>}{integration?.status === "connected" ? <div className="strava-identity">{integration.provider_avatar_url && <img className="provider-avatar" src={integration.provider_avatar_url} alt="Perfil de Strava" />}<div><p><b>Strava conectado: {integration.provider_display_name || "Cuenta Strava"}</b>{integration.provider_athlete_id ? ` · ID ${integration.provider_athlete_id}` : ""}</p><small>Conectado el {new Date(integration.connected_at).toLocaleDateString("es-ES")}{integration.last_synced_at ? ` · Última sincronización ${new Date(integration.last_synced_at).toLocaleString("es-ES")}` : " · Pendiente de primera sincronización"}</small></div></div> : <p>{canConnect ? "Puedes usar Health Connect en Android o conectar Strava. El club nunca recibe las contraseñas de tus servicios deportivos." : "Este atleta todavía no ha conectado una fuente deportiva."}</p>}{notice && <p className={notice.includes("correctamente") || notice.includes("revisadas") || notice.includes("desconectado") ? "success-note" : "error-note"}>{notice}</p>}</article>

    {activities.length > 0 && <><section className="metric-grid"><article className="metric"><small>Carrera · últimos 7 días</small><b>{totalKm(week).toFixed(1)} km</b><small>{week.length} carrera(s)</small></article><article className="metric"><small>Carrera · últimos 30 días</small><b>{totalKm(month).toFixed(1)} km</b><small>{month.length} carrera(s)</small></article><article className="metric"><small>Carreras guardadas</small><b>{runningActivities.length}</b><small>{excludedActivities.length} de otros deportes excluidas</small></article></section><article className="panel table"><h2>Carreras recientes</h2><p>Solo las actividades de carrera cuentan para métricas, carga, logros y Club Challenge.</p>{runningActivities.length ? runningActivities.slice(0,20).map(item => <div className="row" key={item.id}><span><b>{item.name || "Carrera"}</b><small>Carrera · {new Date(item.started_at).toLocaleString("es-ES")}</small></span><span><b>{km(item.distance_m)}</b><small>{duration(item.moving_time_s)} · {pace(item.distance_m,item.moving_time_s)}</small></span><span><small>{item.elevation_gain_m != null ? `+${Math.round(item.elevation_gain_m)} m` : ""}{item.average_heartrate != null ? ` · ${Math.round(item.average_heartrate)} ppm` : ""}</small>{item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer">Ver en Strava ↗</a>}</span></div>) : <p>No hay carreras sincronizadas todavía.</p>}</article>{excludedActivities.length > 0 && <details className="panel table"><summary><b>Otros deportes excluidos ({excludedActivities.length})</b></summary><p>Se conservan para identificar correctamente la actividad, pero no suman kilómetros, carga, rachas ni puntos del Challenge.</p>{excludedActivities.slice(0,20).map(item => <div className="row" key={item.id}><span><b>{item.name || item.activity_type || "Actividad"}</b><small>{excludedActivityLabel(item)} · {new Date(item.started_at).toLocaleString("es-ES")}</small></span><span><b>{km(item.distance_m)}</b><small>{duration(item.moving_time_s)}</small></span><span>{item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer">Ver en Strava ↗</a>}</span></div>)}</details>}</>}
  </section>;
}

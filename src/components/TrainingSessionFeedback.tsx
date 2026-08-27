import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Activity = {
  id: string;
  provider: string;
  activity_type: string | null;
  name: string | null;
  started_at: string;
  distance_m: number | null;
  moving_time_s: number | null;
  elevation_gain_m: number | null;
  average_heartrate: number | null;
  max_heartrate: number | null;
};

type Feedback = {
  id: string;
  external_activity_id: string | null;
  completion_status: "completed" | "partial" | "not_completed";
  source: "manual" | "strava" | "garmin" | "mixed";
  activity_type: string | null;
  duration_minutes: number | null;
  distance_m: number | null;
  elevation_gain_m: number | null;
  average_heartrate: number | null;
  max_heartrate: number | null;
  rpe: number | null;
  feeling: number | null;
  fatigue_before: number | null;
  fatigue_after: number | null;
  pain_level: "none" | "mild" | "moderate" | "high";
  pain_area: string | null;
  strength_volume: string | null;
  strength_intensity: number | null;
  not_completed_reason: string | null;
  athlete_notes: string | null;
};

const dayIndexes: Record<string, number> = { lunes: 0, martes: 1, miércoles: 2, jueves: 3, viernes: 4, sábado: 5, domingo: 6 };
const dateKey = (value: Date) => value.toLocaleDateString("en-CA");
const numberOrNull = (value: FormDataEntryValue | null) => value === null || value === "" ? null : Number(value);

export default function TrainingSessionFeedback({ planId, athleteId, weekStartsOn, planDay }: { planId: string; athleteId: string; weekStartsOn: string; planDay: string }) {
  const [open, setOpen] = useState(false);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState("");
  const [completion, setCompletion] = useState<Feedback["completion_status"]>("completed");
  const [pain, setPain] = useState<Feedback["pain_level"]>("none");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const sessionDate = useMemo(() => {
    const date = new Date(`${weekStartsOn}T12:00:00`);
    date.setDate(date.getDate() + (dayIndexes[planDay.toLowerCase()] ?? 0));
    return dateKey(date);
  }, [weekStartsOn, planDay]);

  const load = async () => {
    if (!supabase) return;
    const start = new Date(`${sessionDate}T00:00:00`);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const [{ data: activityData }, { data: feedbackData }] = await Promise.all([
      supabase.from("external_sport_activities").select("id,provider,activity_type,name,started_at,distance_m,moving_time_s,elevation_gain_m,average_heartrate,max_heartrate").eq("athlete_id", athleteId).gte("started_at", start.toISOString()).lt("started_at", end.toISOString()).order("started_at"),
      supabase.from("training_session_feedback").select("id,external_activity_id,completion_status,source,activity_type,duration_minutes,distance_m,elevation_gain_m,average_heartrate,max_heartrate,rpe,feeling,fatigue_before,fatigue_after,pain_level,pain_area,strength_volume,strength_intensity,not_completed_reason,athlete_notes").eq("training_plan_id", planId).eq("athlete_id", athleteId).eq("plan_day", planDay).maybeSingle(),
    ]);
    setActivities((activityData ?? []) as Activity[]);
    const saved = (feedbackData as Feedback | null) ?? null;
    setFeedback(saved);
    setSelectedActivityId(saved?.external_activity_id || ((activityData?.length === 1 ? activityData[0].id : "") as string));
    setCompletion(saved?.completion_status || "completed");
    setPain(saved?.pain_level || "none");
  };

  useEffect(() => { void load(); }, [planId, athleteId, planDay, sessionDate]);
  const selected = activities.find(item => item.id === selectedActivityId) || null;

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const data = new FormData(event.currentTarget);
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) return setNotice("Vuelve a iniciar sesión antes de guardar.");
    const hasProvider = Boolean(selected);
    const payload = {
      training_plan_id: planId,
      athlete_id: athleteId,
      external_activity_id: selected?.id || null,
      session_date: sessionDate,
      plan_day: planDay,
      completion_status: completion,
      source: hasProvider ? "mixed" : "manual",
      activity_type: selected?.activity_type || String(data.get("activity_type") || "Entrenamiento"),
      duration_minutes: selected?.moving_time_s != null ? Math.round(selected.moving_time_s / 60) : numberOrNull(data.get("duration_minutes")),
      distance_m: selected?.distance_m ?? ((numberOrNull(data.get("distance_km")) ?? 0) * 1000 || null),
      elevation_gain_m: selected?.elevation_gain_m ?? numberOrNull(data.get("elevation_gain_m")),
      average_heartrate: selected?.average_heartrate ?? numberOrNull(data.get("average_heartrate")),
      max_heartrate: selected?.max_heartrate ?? numberOrNull(data.get("max_heartrate")),
      rpe: completion === "not_completed" ? null : numberOrNull(data.get("rpe")),
      feeling: completion === "not_completed" ? null : numberOrNull(data.get("feeling")),
      fatigue_before: numberOrNull(data.get("fatigue_before")),
      fatigue_after: completion === "not_completed" ? null : numberOrNull(data.get("fatigue_after")),
      pain_level: pain,
      pain_area: pain === "none" ? null : String(data.get("pain_area") || "") || null,
      strength_volume: String(data.get("strength_volume") || "") || null,
      strength_intensity: numberOrNull(data.get("strength_intensity")),
      not_completed_reason: completion === "not_completed" ? String(data.get("not_completed_reason") || "") || null : null,
      athlete_notes: String(data.get("athlete_notes") || "") || null,
      created_by: session.session.user.id,
      updated_at: new Date().toISOString(),
    };
    setBusy(true); setNotice("");
    const query = feedback
      ? supabase.from("training_session_feedback").update(payload).eq("id", feedback.id)
      : supabase.from("training_session_feedback").insert(payload);
    const { error } = await query;
    setBusy(false);
    if (error) return setNotice(error.message);
    setNotice("Entrenamiento guardado. Tu entrenador ya puede consultarlo.");
    await load();
  };

  if (!open) return <div className="session-feedback-launch"><button type="button" onClick={() => setOpen(true)}>{feedback ? "Editar entrenamiento realizado" : "Registrar mi entrenamiento"}</button>{feedback && <span>✓ Registrado · RPE {feedback.rpe ?? "—"}</span>}</div>;

  return <form className="session-feedback-form" onSubmit={save}>
    <header><div><small>SEGUIMIENTO · {new Date(`${sessionDate}T12:00:00`).toLocaleDateString("es-ES")}</small><h3>¿Qué hiciste realmente?</h3></div><button type="button" className="outline" onClick={() => setOpen(false)}>Cerrar</button></header>
    <label>Estado de la sesión<select value={completion} onChange={event => setCompletion(event.target.value as Feedback["completion_status"])}><option value="completed">Completada</option><option value="partial">Completada parcialmente</option><option value="not_completed">No realizada</option></select></label>

    {completion === "not_completed" ? <label>Motivo<select name="not_completed_reason" defaultValue={feedback?.not_completed_reason || ""} required><option value="">Selecciona un motivo</option><option>Lesión o molestias</option><option>Enfermedad</option><option>Fatiga</option><option>Falta de tiempo</option><option>Otro motivo</option></select></label> : <>
      {activities.length > 0 && <label>Actividad detectada<select value={selectedActivityId} onChange={event => setSelectedActivityId(event.target.value)}><option value="">No vincular; introducir manualmente</option>{activities.map(item => <option key={item.id} value={item.id}>{item.provider.toUpperCase()} · {item.name || item.activity_type || "Actividad"} · {new Date(item.started_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</option>)}</select><small>Al vincularla usamos sus datos y solo te preguntamos lo que el reloj no conoce.</small></label>}
      {selected ? <section className="session-import-summary"><span><small>DURACIÓN</small><b>{selected.moving_time_s != null ? `${Math.round(selected.moving_time_s / 60)} min` : "Sin dato"}</b></span><span><small>DISTANCIA</small><b>{selected.distance_m != null ? `${(selected.distance_m / 1000).toFixed(2)} km` : "Sin dato"}</b></span><span><small>PULSO MEDIO</small><b>{selected.average_heartrate != null ? `${Math.round(selected.average_heartrate)} ppm` : "Sin dato"}</b></span></section> : <section className="session-manual-grid"><label>Tipo de entrenamiento<input name="activity_type" defaultValue={feedback?.activity_type || ""} placeholder="Rodaje, series, fuerza…" required /></label><label>Duración real (min)<input type="number" min="1" max="1440" name="duration_minutes" defaultValue={feedback?.duration_minutes || ""} required /></label><label>Distancia (km)<input type="number" min="0" step="0.01" name="distance_km" defaultValue={feedback?.distance_m != null ? feedback.distance_m / 1000 : ""} /></label><label>Desnivel positivo (m)<input type="number" min="0" name="elevation_gain_m" defaultValue={feedback?.elevation_gain_m || ""} /></label><label>FC media<input type="number" min="30" max="250" name="average_heartrate" defaultValue={feedback?.average_heartrate || ""} /></label><label>FC máxima<input type="number" min="30" max="250" name="max_heartrate" defaultValue={feedback?.max_heartrate || ""} /></label></section>}
      <section className="session-manual-grid"><label>Esfuerzo percibido · RPE<select name="rpe" defaultValue={feedback?.rpe || ""} required><option value="">Selecciona 1–10</option>{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label><label>Sensaciones<select name="feeling" defaultValue={feedback?.feeling || ""} required><option value="">Selecciona 1–5</option><option value="1">1 · Muy malas</option><option value="2">2 · Malas</option><option value="3">3 · Normales</option><option value="4">4 · Buenas</option><option value="5">5 · Muy buenas</option></select></label><label>Fatiga antes<select name="fatigue_before" defaultValue={feedback?.fatigue_before || ""}><option value="">Sin indicar</option>{[1,2,3,4,5].map(value => <option key={value}>{value}</option>)}</select></label><label>Fatiga después<select name="fatigue_after" defaultValue={feedback?.fatigue_after || ""}><option value="">Sin indicar</option>{[1,2,3,4,5].map(value => <option key={value}>{value}</option>)}</select></label></section>
      <label>Trabajo de fuerza<input name="strength_volume" defaultValue={feedback?.strength_volume || ""} placeholder="Ej.: 3×8 sentadilla + core" /></label><label>Intensidad de fuerza (1–10)<input type="number" min="1" max="10" name="strength_intensity" defaultValue={feedback?.strength_intensity || ""} /></label>
    </>}

    <section className="session-manual-grid"><label>Molestias<select value={pain} onChange={event => setPain(event.target.value as Feedback["pain_level"])}><option value="none">Ninguna</option><option value="mild">Leves</option><option value="moderate">Moderadas</option><option value="high">Altas</option></select></label>{pain !== "none" && <label>Zona de la molestia<input name="pain_area" defaultValue={feedback?.pain_area || ""} placeholder="Gemelo, rodilla…" required /></label>}</section>
    <label>Comentario para el entrenador<textarea name="athlete_notes" defaultValue={feedback?.athlete_notes || ""} placeholder="Cómo ha ido la sesión, qué has cambiado o cualquier observación." /></label>
    <footer><button disabled={busy}>{busy ? "Guardando…" : "Guardar entrenamiento"}</button>{notice && <p className={notice.startsWith("Entrenamiento") ? "success-note" : "error-note"}>{notice}</p>}</footer>
  </form>;
}

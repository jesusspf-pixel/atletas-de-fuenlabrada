import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Row = {
  id: string;
  session_date: string;
  plan_day: string;
  completion_status: "completed" | "partial" | "not_completed";
  source: string;
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
  pain_level: string;
  pain_area: string | null;
  strength_volume: string | null;
  strength_intensity: number | null;
  not_completed_reason: string | null;
  athlete_notes: string | null;
  training_plans?: { title: string } | null;
};

const statusText = { completed: "Completada", partial: "Parcial", not_completed: "No realizada" };

export default function CoachTrainingFeedback({ athleteId }: { athleteId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (!supabase) return;
    void supabase.from("training_session_feedback").select("id,session_date,plan_day,completion_status,source,activity_type,duration_minutes,distance_m,elevation_gain_m,average_heartrate,max_heartrate,rpe,feeling,fatigue_before,fatigue_after,pain_level,pain_area,strength_volume,strength_intensity,not_completed_reason,athlete_notes,training_plans(title)").eq("athlete_id", athleteId).order("session_date", { ascending: false }).limit(20).then(({ data }) => setRows((data ?? []) as unknown as Row[]));
  }, [athleteId]);

  const summary = useMemo(() => {
    const completed = rows.filter(row => row.completion_status !== "not_completed");
    const minutes = completed.reduce((sum, row) => sum + Number(row.duration_minutes || 0), 0);
    const km = completed.reduce((sum, row) => sum + Number(row.distance_m || 0), 0) / 1000;
    const load = completed.reduce((sum, row) => sum + Number(row.duration_minutes || 0) * Number(row.rpe || 0), 0);
    return { completed: completed.length, minutes, km, load };
  }, [rows]);

  return <article className="panel coach-feedback-history"><header><div><small>PLANIFICADO FRENTE A REALIZADO</small><h2>Seguimiento de entrenamientos</h2></div></header>
    {rows.length > 0 && <section className="coach-feedback-summary"><span><small>SESIONES</small><b>{summary.completed}</b></span><span><small>VOLUMEN</small><b>{summary.minutes} min</b></span><span><small>DISTANCIA</small><b>{summary.km.toFixed(1)} km</b></span><span><small>CARGA sRPE</small><b>{summary.load}</b></span></section>}
    <div className="coach-feedback-list">{rows.map(row => <article className={`coach-feedback-row ${row.pain_level !== "none" ? "has-pain" : ""}`} key={row.id}><header><div><small>{new Date(`${row.session_date}T12:00:00`).toLocaleDateString("es-ES")} · {row.plan_day}</small><h3>{row.training_plans?.title || row.activity_type || "Entrenamiento"}</h3></div><span>{statusText[row.completion_status]}</span></header>{row.completion_status === "not_completed" ? <p><b>Motivo:</b> {row.not_completed_reason || "No indicado"}</p> : <div className="coach-feedback-metrics"><span><small>ORIGEN</small><b>{row.source.toUpperCase()}</b></span><span><small>DURACIÓN</small><b>{row.duration_minutes ?? "—"} min</b></span><span><small>DISTANCIA</small><b>{row.distance_m != null ? `${(row.distance_m / 1000).toFixed(2)} km` : "—"}</b></span><span><small>RPE</small><b>{row.rpe ?? "—"}/10</b></span><span><small>SENSACIONES</small><b>{row.feeling ?? "—"}/5</b></span><span><small>CARGA</small><b>{row.duration_minutes && row.rpe ? row.duration_minutes * row.rpe : "—"}</b></span></div>}{row.average_heartrate != null && <p>FC media {Math.round(row.average_heartrate)} ppm{row.max_heartrate != null ? ` · máxima ${Math.round(row.max_heartrate)} ppm` : ""}{row.elevation_gain_m != null ? ` · +${Math.round(row.elevation_gain_m)} m` : ""}</p>}{row.strength_volume && <p><b>Fuerza:</b> {row.strength_volume}{row.strength_intensity ? ` · intensidad ${row.strength_intensity}/10` : ""}</p>}{row.pain_level !== "none" && <p className="feedback-pain"><b>⚠ Molestias {row.pain_level}</b>{row.pain_area ? ` · ${row.pain_area}` : ""}</p>}{row.athlete_notes && <blockquote>{row.athlete_notes}</blockquote>}</article>)}{!rows.length && <p>El atleta todavía no ha registrado cómo realizó sus sesiones.</p>}</div>
  </article>;
}

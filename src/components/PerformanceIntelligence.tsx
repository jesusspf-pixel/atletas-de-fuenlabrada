import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import PerformanceAdvanced from "./PerformanceAdvanced";
import "./performance-intelligence.css";

type Activity = {
  id: string;
  activity_type: string | null;
  started_at: string;
  distance_m: number | null;
  moving_time_s: number | null;
  average_heartrate: number | null;
  relative_effort: number | null;
};
type Feedback = {
  id: string;
  session_date: string;
  duration_minutes: number | null;
  rpe: number | null;
  sleep_quality: number | null;
  fatigue_feeling: number | null;
  muscle_soreness: number | null;
  mood: number | null;
  pain_or_discomfort: boolean;
  sensations: string | null;
};
type Day = {
  date: string;
  load: number;
  fitness: number;
  fatigue: number;
  form: number;
};
type AiInsight = {
  headline: string;
  summary: string;
  actions: string[];
  confidence: "baja" | "media" | "alta";
  alert: boolean;
};
const runs = new Set(["run", "trailrun", "virtualrun", "wheelchair"]);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const label = (value: number) =>
  value > 12
    ? "Muy fresco"
    : value > 4
      ? "Fresco"
      : value > -10
        ? "Equilibrado"
        : value > -22
          ? "Fatiga acumulada"
          : "Recuperación prioritaria";
const colour = (value: number) =>
  value > -10 ? "#24b681" : value > -22 ? "#f2a93b" : "#ee5d68";
const scaleText = {
  rpe: (value: string) => Number(value) <= 2 ? "Muy suave" : Number(value) <= 4 ? "Suave" : Number(value) <= 6 ? "Moderado" : Number(value) <= 8 ? "Intenso" : "Máximo",
  sleep: (value: string) => Number(value) <= 1 ? "Dormí muy mal" : Number(value) <= 2 ? "Dormí mal" : Number(value) === 3 ? "Sueño normal" : Number(value) === 4 ? "Dormí bien" : "Dormí muy bien",
  fatigue: (value: string) => Number(value) <= 1 ? "Nada fatigado" : Number(value) <= 2 ? "Poca fatiga" : Number(value) === 3 ? "Fatiga moderada" : Number(value) === 4 ? "Fatiga alta" : "Fatiga muy alta",
  soreness: (value: string) => Number(value) <= 1 ? "Sin molestias" : Number(value) <= 2 ? "Molestia leve" : Number(value) === 3 ? "Molestia moderada" : Number(value) === 4 ? "Molestia alta" : "Molestia muy alta",
  mood: (value: string) => Number(value) <= 1 ? "Ánimo muy bajo" : Number(value) <= 2 ? "Ánimo bajo" : Number(value) === 3 ? "Ánimo normal" : Number(value) === 4 ? "Buen ánimo" : "Ánimo excelente",
};

function buildTimeline(activities: Activity[], feedback: Feedback[]) {
  const byDay = new Map<string, number>();
  const sources = new Set<string>();
  activities
    .filter((a) => runs.has(String(a.activity_type || "").toLowerCase()))
    .forEach((a) => {
      const day = a.started_at.slice(0, 10);
      const minutes = Number(a.moving_time_s || 0) / 60;
      const load = Number(a.relative_effort || 0) || minutes;
      byDay.set(day, (byDay.get(day) || 0) + load);
      if (a.relative_effort) sources.add("strava-effort");
      else sources.add("strava-duration");
    });
  feedback.forEach((f) => {
    if (!f.rpe || !f.duration_minutes) return;
    byDay.set(f.session_date, Number(f.rpe) * Number(f.duration_minutes));
    sources.add("rpe");
  });
  let fitness = 0,
    fatigue = 0;
  const days: Day[] = [];
  const start = new Date();
  start.setDate(start.getDate() - 89);
  for (let i = 0; i < 90; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const date = iso(d),
      load = byDay.get(date) || 0;
    fitness += (load - fitness) / 42;
    fatigue += (load - fatigue) / 7;
    days.push({ date, load, fitness, fatigue, form: fitness - fatigue });
  }
  return { days, sources };
}
function path(values: number[], width = 700, height = 180) {
  const min = Math.min(...values, 0),
    max = Math.max(...values, 1),
    range = Math.max(1, max - min),
    points = values.map((value, index) => ({
      x: (index / Math.max(1, values.length - 1)) * width,
      y: height - ((value - min) / range) * height,
    }));
  if (!points.length) return "";
  return points.slice(1).reduce((result, point, index) => {
    const previous = points[index],
      distance = (point.x - previous.x) * 0.38;
    return `${result} C${previous.x + distance},${previous.y} ${point.x - distance},${point.y} ${point.x},${point.y}`;
  }, `M${points[0].x},${points[0].y}`);
}

function chartPoint(values: number[], index: number, width = 700, height = 180) {
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = Math.max(1, max - min);
  return {
    x: (index / Math.max(1, values.length - 1)) * width,
    y: height - ((values[index] - min) / range) * height,
  };
}

export default function PerformanceIntelligence({
  athleteId,
  canRecord = true,
}: {
  athleteId: string;
  canRecord?: boolean;
}) {
  const [activities, setActivities] = useState<Activity[]>([]),
    [feedback, setFeedback] = useState<Feedback[]>([]),
    [notice, setNotice] = useState("");
  const [dataReady, setDataReady] = useState(false);
  const [aiInsight, setAiInsight] = useState<AiInsight | null>(null),
    [aiLoading, setAiLoading] = useState(false),
    [aiError, setAiError] = useState("");
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);
  const [form, setForm] = useState({
    date: iso(new Date()),
    duration: "",
    distance: "",
    rpe: "5",
    sleep: "3",
    fatigue: "3",
    soreness: "2",
    mood: "3",
    pain: false,
    painNotes: "",
    sensations: "",
  });
  const load = async () => {
    if (!supabase) return;
    setDataReady(false);
    const since = new Date();
    since.setDate(since.getDate() - 120);
    const [a, f] = await Promise.all([
      supabase
        .from("external_sport_activities")
        .select(
          "id,activity_type,started_at,distance_m,moving_time_s,average_heartrate,relative_effort",
        )
        .eq("athlete_id", athleteId)
        .gte("started_at", since.toISOString())
        .order("started_at"),
      supabase
        .from("athlete_training_feedback")
        .select(
          "id,session_date,duration_minutes,rpe,sleep_quality,fatigue_feeling,muscle_soreness,mood,pain_or_discomfort,sensations",
        )
        .eq("athlete_id", athleteId)
        .gte("session_date", iso(since))
        .order("session_date"),
    ]);
    setActivities((a.data || []) as Activity[]);
    setFeedback((f.data || []) as Feedback[]);
    setDataReady(true);
  };
  useEffect(() => {
    setAiInsight(null);
    setAiError("");
    void load();
  }, [athleteId]);
  const timeline = useMemo(
    () => buildTimeline(activities, feedback),
    [activities, feedback],
  );
  const latest = timeline.days.at(-1)!;
  const week = timeline.days.slice(-7);
  const previous = timeline.days.slice(-14, -7);
  const weekLoad = week.reduce((s, d) => s + d.load, 0),
    previousLoad = previous.reduce((s, d) => s + d.load, 0);
  const change = previousLoad ? (weekLoad / previousLoad - 1) * 100 : 0;
  const wellness = feedback.slice(-7);
  const readiness = wellness.length
    ? Math.round(
        (wellness.reduce(
          (s, f) =>
            s +
            ((f.sleep_quality || 3) +
              (6 - (f.fatigue_feeling || 3)) +
              (6 - (f.muscle_soreness || 3)) +
              (f.mood || 3)),
          0,
        ) /
          (wellness.length * 20)) *
          100,
      )
    : null;
  const reliable =
    timeline.sources.has("strava-effort") || timeline.sources.has("rpe");
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;
    const { error } = await supabase
      .from("athlete_training_feedback")
      .insert({
        athlete_id: athleteId,
        session_date: form.date,
        duration_minutes: Number(form.duration) || null,
        distance_m: form.distance
          ? Number(form.distance.replace(",", ".")) * 1000
          : null,
        rpe: Number(form.rpe),
        sleep_quality: Number(form.sleep),
        fatigue_feeling: Number(form.fatigue),
        muscle_soreness: Number(form.soreness),
        mood: Number(form.mood),
        pain_or_discomfort: form.pain,
        pain_notes: form.painNotes || null,
        sensations: form.sensations || null,
        created_by: user.id,
      });
    if (error) return setNotice(error.message);
    setNotice("Sesión y sensaciones registradas.");
    setForm({
      ...form,
      duration: "",
      distance: "",
      pain: false,
      painNotes: "",
      sensations: "",
    });
    void load();
  };
  const analyse = async () => {
    if (!supabase || aiLoading) return;
    setAiLoading(true);
    setAiError("");
    const session = (await supabase.auth.getSession()).data.session;
    if (!session) {
      setAiError("Inicia sesión de nuevo.");
      setAiLoading(false);
      return;
    }
    const recentPain = feedback
      .slice(-14)
      .some((item) => item.pain_or_discomfort);
    try {
      const response = await fetch("/api/performance-insight", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          athleteId,
          metrics: {
            fitness: latest.fitness,
            fatigue: latest.fatigue,
            form: latest.form,
            weekLoad,
            previousWeekLoad: previousLoad,
            changePercent: previousLoad ? change : null,
            readiness,
            dataConfidence: reliable ? "medium_high" : "initial",
            sources: [...timeline.sources],
            recentPain,
            wellnessEntries: wellness.length,
            runningActivities: activities.filter((item) =>
              runs.has(String(item.activity_type || "").toLowerCase()),
            ).length,
          },
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        insight?: AiInsight;
        error?: string;
      };
      if (!response.ok || !data.insight)
        throw new Error(data.error || "No se pudo generar el análisis.");
      setAiInsight(data.insight);
    } catch (error) {
      setAiError(
        error instanceof Error
          ? error.message
          : "No se pudo generar el análisis.",
      );
    } finally {
      setAiLoading(false);
    }
  };
  useEffect(() => {
    if (
      dataReady &&
      (activities.length > 0 || feedback.length > 0) &&
      !aiInsight &&
      !aiLoading
    )
      void analyse();
  }, [athleteId, dataReady, activities.at(-1)?.id, feedback.at(-1)?.id]);
  return (
    <section className="performance-hub">
      <PerformanceAdvanced athleteId={athleteId} />
      <header className="performance-hero">
        <div>
          <small>SPORTMED PERFORMANCE · 90 DÍAS</small>
          <h2>Estado de rendimiento</h2>
          <p>
            Carga real de carrera, recuperación y tendencia en un único panel.
          </p>
        </div>
        <div className="readiness-summary">
          <div
            className="readiness-ring"
            title="0 indica recuperación muy baja y 100 una disposición muy alta para entrenar."
            style={
              {
                "--score": `${readiness ?? Math.max(0, Math.min(100, 60 + latest.form))}`,
              } as React.CSSProperties
            }
          >
            <b>{readiness ?? "—"}</b>
            <span>disposición</span>
          </div>
          <small className="readiness-help">0 = recuperación baja · 100 = disposición alta</small>
        </div>
      </header>
      <div className="performance-kpis">
        <article>
          <small>FORMA</small>
          <b>{latest.fitness.toFixed(0)}</b>
          <span>Carga sostenida · 42 días</span>
          <em>Tu base de entrenamiento acumulada; cambia lentamente.</em>
        </article>
        <article>
          <small>FATIGA</small>
          <b>{latest.fatigue.toFixed(0)}</b>
          <span>Carga reciente · 7 días</span>
          <em>Cuanto más sube, mayor carga reciente necesita asimilar el cuerpo.</em>
        </article>
        <article style={{ borderColor: colour(latest.form) }}>
          <small>FRESCURA</small>
          <b>
            {latest.form > 0 ? "+" : ""}
            {latest.form.toFixed(0)}
          </b>
          <span>{label(latest.form)}</span>
          <em>Forma menos fatiga: negativo indica cansancio; positivo, frescura.</em>
        </article>
        <article>
          <small>CARGA SEMANAL</small>
          <b>{weekLoad.toFixed(0)}</b>
          <span>
            {previousLoad
              ? `${change >= 0 ? "+" : ""}${change.toFixed(0)}% vs. semana anterior`
              : "Construyendo referencia"}
          </span>
          <em>Suma de la carga de los últimos 7 días; sirve para comparar semanas.</em>
        </article>
      </div>
      <article className="performance-chart">
        <header>
          <div>
            <h3>Curva forma–fatiga</h3>
            <p>
              Cuanto mayor es la separación, más importante es revisar la
              recuperación.
            </p>
          </div>
          <span className={reliable ? "confidence good" : "confidence"}>
            {reliable ? "Confianza media/alta" : "Estimación inicial"}
          </span>
        </header>
        {hoveredDay !== null && timeline.days[hoveredDay] && (
          <div
            className={`performance-chart-tooltip${hoveredDay < 9 ? " at-start" : hoveredDay > timeline.days.length - 10 ? " at-end" : ""}`}
            style={{
              left: `${(hoveredDay / Math.max(1, timeline.days.length - 1)) * 100}%`,
            }}
          >
            <b>
              {new Date(`${timeline.days[hoveredDay].date}T12:00:00`).toLocaleDateString(
                "es-ES",
                { day: "2-digit", month: "short", year: "numeric" },
              )}
            </b>
            <span>Forma {timeline.days[hoveredDay].fitness.toFixed(1)}</span>
            <span>Fatiga {timeline.days[hoveredDay].fatigue.toFixed(1)}</span>
            <span>
              Frescura {timeline.days[hoveredDay].form > 0 ? "+" : ""}
              {timeline.days[hoveredDay].form.toFixed(1)}
            </span>
          </div>
        )}
        <svg
          viewBox="0 0 700 190"
          preserveAspectRatio="none"
          role="img"
          aria-label="Evolución de forma y fatiga"
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const ratio = Math.max(
              0,
              Math.min(1, (event.clientX - bounds.left) / bounds.width),
            );
            setHoveredDay(Math.round(ratio * (timeline.days.length - 1)));
          }}
          onPointerLeave={() => setHoveredDay(null)}
        >
          <defs>
            <linearGradient id="fitnessFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#2475dd" stopOpacity=".28" />
              <stop offset="1" stopColor="#2475dd" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d={`${path(timeline.days.map((d) => d.fitness))} L700,190 L0,190 Z`}
            fill="url(#fitnessFill)"
          />
          <path
            d={path(timeline.days.map((d) => d.fitness))}
            fill="none"
            stroke="#2475dd"
            strokeWidth="4"
          />
          <path
            d={path(timeline.days.map((d) => d.fatigue))}
            fill="none"
            stroke="#ef7b55"
            strokeWidth="3"
          />
          {hoveredDay !== null && timeline.days[hoveredDay] && (
            <>
              <line
                className="chart-cursor-line"
                x1={chartPoint(timeline.days.map((d) => d.fitness), hoveredDay).x}
                x2={chartPoint(timeline.days.map((d) => d.fitness), hoveredDay).x}
                y1="0"
                y2="190"
              />
              <circle
                className="chart-cursor-point fitness"
                cx={chartPoint(timeline.days.map((d) => d.fitness), hoveredDay).x}
                cy={chartPoint(timeline.days.map((d) => d.fitness), hoveredDay).y}
                r="5"
              />
              <circle
                className="chart-cursor-point fatigue"
                cx={chartPoint(timeline.days.map((d) => d.fatigue), hoveredDay).x}
                cy={chartPoint(timeline.days.map((d) => d.fatigue), hoveredDay).y}
                r="5"
              />
            </>
          )}
        </svg>
        <footer>
          <span>
            <i className="fitness" />
            Forma
          </span>
          <span>
            <i className="fatigue" />
            Fatiga
          </span>
          <small>
            Los cálculos son orientativos y no sustituyen valoración médica.
          </small>
        </footer>
      </article>
      <div className={`performance-insight${aiInsight?.alert ? " alert" : ""}`}>
        <i>✦</i>
        <div>
          <small>
            {aiInsight
              ? `ANÁLISIS CLAUDE · CONFIANZA ${aiInsight.confidence.toUpperCase()}`
              : "ANÁLISIS INTELIGENTE · ACTUALIZACIÓN DIARIA"}
          </small>
          <h3>{aiInsight?.headline || label(latest.form)}</h3>
          <p>
            {aiInsight?.summary ||
              (weekLoad === 0
                ? "No hay suficiente actividad reciente. Sincroniza Strava o registra el entrenamiento manualmente."
                : latest.form < -22
                  ? "La carga reciente supera claramente la carga asimilada. Conviene revisar sensaciones y recuperación antes de aumentar intensidad."
                  : latest.form < -10
                    ? "Hay fatiga acumulada compatible con una semana de carga. Vigila sueño, molestias y respuesta al próximo entrenamiento."
                    : "La relación entre carga reciente y carga sostenida está en una zona equilibrada.")}
          </p>
          {aiInsight && aiInsight.actions.length > 0 && (
            <ul>
              {aiInsight.actions.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          )}
          {aiLoading && (
            <span className="ai-analysis-status">
              Actualizando el análisis diario…
            </span>
          )}
          {aiError && <span className="ai-analysis-error">{aiError}</span>}
        </div>
      </div>
      {canRecord && (
        <form className="performance-feedback" onSubmit={save}>
          <header>
            <div>
              <small>COMPLETAR LOS DATOS</small>
              <h3>¿Cómo ha ido el entrenamiento?</h3>
            </div>
            <span>Solo preguntamos lo que el dispositivo no aporta.</span>
          </header>
          <div className="performance-form-grid">
            <label>
              Fecha
              <input
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </label>
            <label>
              Duración (min)
              <input
                type="number"
                min="1"
                required
                value={form.duration}
                onChange={(e) => setForm({ ...form, duration: e.target.value })}
              />
            </label>
            <label>
              Distancia (km)
              <input
                inputMode="decimal"
                value={form.distance}
                onChange={(e) => setForm({ ...form, distance: e.target.value })}
              />
            </label>
            <label>
              Esfuerzo RPE · {form.rpe}/10
              <input
                type="range"
                min="1"
                max="10"
                value={form.rpe}
                onChange={(e) => setForm({ ...form, rpe: e.target.value })}
              />
              <small><b>{scaleText.rpe(form.rpe)}</b> · 1 muy suave · 10 esfuerzo máximo</small>
            </label>
            <label>
              Sueño · {form.sleep}/5
              <input
                type="range"
                min="1"
                max="5"
                value={form.sleep}
                onChange={(e) => setForm({ ...form, sleep: e.target.value })}
              />
              <small><b>{scaleText.sleep(form.sleep)}</b> · 1 muy mal · 5 muy bien</small>
            </label>
            <label>
              Fatiga percibida · {form.fatigue}/5
              <input
                type="range"
                min="1"
                max="5"
                value={form.fatigue}
                onChange={(e) => setForm({ ...form, fatigue: e.target.value })}
              />
              <small><b>{scaleText.fatigue(form.fatigue)}</b> · 1 nada fatigado · 5 fatiga muy alta</small>
            </label>
            <label>
              Molestia muscular · {form.soreness}/5
              <input
                type="range"
                min="1"
                max="5"
                value={form.soreness}
                onChange={(e) => setForm({ ...form, soreness: e.target.value })}
              />
              <small><b>{scaleText.soreness(form.soreness)}</b> · 1 sin molestias · 5 muy altas</small>
            </label>
            <label>
              Ánimo · {form.mood}/5
              <input
                type="range"
                min="1"
                max="5"
                value={form.mood}
                onChange={(e) => setForm({ ...form, mood: e.target.value })}
              />
              <small><b>{scaleText.mood(form.mood)}</b> · 1 muy bajo · 5 excelente</small>
            </label>
            <label className="wide check">
              <input
                type="checkbox"
                checked={form.pain}
                onChange={(e) => setForm({ ...form, pain: e.target.checked })}
              />
              <span>He tenido dolor o una molestia concreta</span>
            </label>
            {form.pain && (
              <label className="wide">
                ¿Dónde y cómo?
                <input
                  value={form.painNotes}
                  onChange={(e) =>
                    setForm({ ...form, painNotes: e.target.value })
                  }
                />
              </label>
            )}
            <label className="wide">
              Sensaciones
              <textarea
                value={form.sensations}
                onChange={(e) =>
                  setForm({ ...form, sensations: e.target.value })
                }
                placeholder="Qué salió bien, qué costó y cualquier observación…"
              />
            </label>
          </div>
          <button>Guardar entrenamiento y sensaciones</button>
          {notice && (
            <p
              className={
                notice.startsWith("Sesión") ? "success-note" : "error-note"
              }
            >
              {notice}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

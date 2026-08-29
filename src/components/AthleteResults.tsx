import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import ExternalSports from "./ExternalSports";
import FitnessTests from "./FitnessTests";
import PerformanceIntelligence from "./PerformanceIntelligence";
import { verifiedOfficialResults } from "../data/verifiedOfficialResults";

type EventDef = { id: string; code: string; name: string; result_kind: string; sort_direction: "asc" | "desc" };
type Result = {
  id: string; athlete_id: string | null; athletics_event_id: string; competition_name: string; competition_date: string;
  venue: string | null; season: string | null; category_label: string | null; competition_environment?: "indoor" | "outdoor" | "unknown"; result_text: string; result_value: number | null;
  result_unit: string | null; position: number | null; wind: number | null; source: string; official: boolean; verified: boolean;
  athletics_events?: EventDef | null;
};
type PB = { athlete_id: string; athletics_event_id: string; event_name: string; competition_environment?: "indoor" | "outdoor" | "unknown"; result_text: string; competition_name: string; competition_date: string; source: string; official: boolean };
type Props = { athleteId: string; athleteName?: string; canAddTraining?: boolean; coachProfileId?: string; canPlanFitness?: boolean; canRecordFitness?: boolean; showPerformance?: boolean };

type Unit = "seconds" | "minutes_seconds" | "meters" | "centimeters" | "points" | "repetitions" | "position" | "other";
const unitLabels: Record<Unit, string> = {
  seconds: "segundos",
  minutes_seconds: "minutos y segundos",
  meters: "metros",
  centimeters: "centímetros",
  points: "puntos",
  repetitions: "repeticiones",
  position: "posición",
  other: "otro",
};
const sourceLabel = (source: string) => source === "fam" ? "FAM" : source === "rfea" ? "RFEA" : source === "training" ? "Entrenamiento" : "Manual";
const environmentLabel = (environment?: string) => environment === "indoor" ? "Pista cubierta" : environment === "outdoor" ? "Aire libre" : "Sin identificar";

function normalizedName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9\s]/g, " ").trim().toLocaleLowerCase("es-ES").replace(/\s+/g, " ");
}


function sameAthleteName(registeredName: string, historicName: string) {
  const registered = normalizedName(registeredName);
  const historic = normalizedName(historicName.replace(/^0\s+/, ""));
  return registered === historic || registered.startsWith(historic + " ") || historic.startsWith(registered + " ");
}

function historicEnvironment(competition: string) {
  const name = competition.toLocaleUpperCase("es-ES");
  if (/PISTA\s+CUBIERTA|\bP\.?\s*C\.?\b|\bPC\b|GALLUR/.test(name)) return "indoor";
  return "outdoor";
}

function withoutDuplicateResults(rows: Result[]) {
  const seen = new Set<string>();
  return rows.filter(row => {
    const mark = row.result_value !== null
      ? `value:${row.result_value}`
      : `text:${row.result_text.trim().toLocaleLowerCase("es-ES")}`;
    const key = [row.athlete_id || "", row.athletics_event_id, row.competition_date, mark].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function withoutDuplicateRankingRows(rows: any[]) {
  const seen = new Set<string>();
  return [...rows]
    .sort((left, right) => String(right.athlete_name || "").length - String(left.athlete_name || "").length)
    .filter(row => {
      const mark = row.result_value !== null && row.result_value !== undefined
        ? `value:${row.result_value}`
        : `text:${String(row.result_text || "").trim().toLocaleLowerCase("es-ES")}`;
      const person = String(row.athlete_name || [row.first_name, row.last_name].filter(Boolean).join(" "))
        .trim().toLocaleLowerCase("es-ES").split(/\\s+/).slice(0, 2).join(" ");
      const key = [person, row.athletics_event_id || "", row.competition_date || "", row.category_label || "", row.competition_environment || "", mark].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function parseResult(raw: string, unit: Unit) {
  const clean = raw.trim().replace(",", ".");
  if (unit === "minutes_seconds") {
    const parts = clean.split(":").map(Number);
    if (parts.length === 2 && parts.every(Number.isFinite)) return { value: parts[0] * 60 + parts[1], text: `${raw.trim()} min` };
  }
  const value = Number(clean);
  if (!Number.isFinite(value)) return { value: null, text: raw.trim() };
  const suffix: Record<Unit, string> = { seconds: " segundos", minutes_seconds: "", meters: " metros", centimeters: " centímetros", points: " puntos", repetitions: " repeticiones", position: "", other: "" };
  return { value, text: unit === "position" ? `Puesto ${raw.trim()}` : `${raw.trim()}${suffix[unit]}` };
}

export function AthleteResults({ athleteId, athleteName = "", canAddTraining = false, coachProfileId, canPlanFitness = false, canRecordFitness = true, showPerformance = false }: Props) {
  const [events, setEvents] = useState<EventDef[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [pbs, setPbs] = useState<PB[]>([]);
  const [notice, setNotice] = useState("");
  const [resultEventId, setResultEventId] = useState("");
  const [resultSort, setResultSort] = useState<"date" | "best">("date");
  const [form, setForm] = useState({ eventId: "", customName: "", customKind: "time", result: "", unit: "seconds" as Unit, date: new Date().toISOString().slice(0, 10), competition: "Entrenamiento", position: "" });
  const historicResults = useMemo(() => {
    const unique = new Map<string, typeof verifiedOfficialResults[number]>();
    for (const row of verifiedOfficialResults) {
      if (!athleteName || !sameAthleteName(athleteName, row.athlete_name)) continue;
      const key = [row.event_name, row.competition_date, row.result_text, historicEnvironment(row.competition_name)].join("|");
      const current = unique.get(key);
      if (!current || row.athlete_name.length > current.athlete_name.length) unique.set(key, row);
    }
    return [...unique.values()].sort((a, b) => String(b.competition_date).localeCompare(String(a.competition_date)));
  }, [athleteName]);

  const load = async () => {
    const client = supabase; if (!client) return;
    const [{ data: eventData }, { data: resultData }, { data: pbData }] = await Promise.all([
      client.from("athletics_events").select("id,code,name,result_kind,sort_direction").eq("active", true).order("name"),
      client.from("athlete_results").select("*,athletics_events(id,code,name,result_kind,sort_direction)").eq("athlete_id", athleteId).order("competition_date", { ascending: false }),
      client.from("athlete_personal_bests").select("*").eq("athlete_id", athleteId),
    ]);
    setEvents((eventData ?? []) as EventDef[]);
    setResults(withoutDuplicateResults((resultData ?? []) as Result[]));
    setPbs((pbData ?? []) as PB[]);
  };
  useEffect(() => { void load(); }, [athleteId]);

  const visibleResults = useMemo(() => {
    const selected = results.filter(row => !resultEventId || row.athletics_event_id === resultEventId);
    return [...selected].sort((left, right) => {
      if (resultSort === "date") return new Date(right.competition_date).getTime() - new Date(left.competition_date).getTime();
      const direction = left.athletics_events?.sort_direction || right.athletics_events?.sort_direction || "asc";
      const leftValue = left.result_value, rightValue = right.result_value;
      if (leftValue !== null && rightValue !== null && leftValue !== rightValue) return direction === "desc" ? rightValue - leftValue : leftValue - rightValue;
      if (leftValue !== null && rightValue === null) return -1;
      if (leftValue === null && rightValue !== null) return 1;
      return new Date(right.competition_date).getTime() - new Date(left.competition_date).getTime();
    });
  }, [results, resultEventId, resultSort]);
  const officialResults = visibleResults.filter(row => row.official || row.source === "fam" || row.source === "rfea");
  const trainingResults = visibleResults.filter(row => !row.official && row.source === "training");
  const officialBests = pbs.filter(pb => pb.official || pb.source === "fam" || pb.source === "rfea");

  const addTrainingResult = async (e: FormEvent) => {
    e.preventDefault();
    const client = supabase; if (!client || !coachProfileId) return;
    setNotice("");
    let eventId = form.eventId;
    if (eventId === "__other__") {
      if (!form.customName.trim()) return setNotice("Indica el nombre de la otra prueba.");
      const { data, error } = await client.rpc("ensure_training_event", { custom_name: form.customName.trim(), custom_result_kind: form.customKind });
      if (error || !data) return setNotice(error?.message || "No se pudo crear la prueba personalizada.");
      eventId = data as string;
    }
    if (!eventId) return setNotice("Selecciona una prueba.");
    const parsed = parseResult(form.result, form.unit);
    if (!form.result.trim()) return setNotice("Indica el resultado.");
    const { error } = await client.from("athlete_results").insert({
      athlete_id: athleteId,
      athletics_event_id: eventId,
      competition_name: form.competition || "Entrenamiento",
      competition_date: form.date,
      result_text: parsed.text,
      result_value: parsed.value,
      result_unit: unitLabels[form.unit],
      position: form.position ? Number(form.position) : form.unit === "position" && parsed.value ? Number(parsed.value) : null,
      official: false,
      verified: true,
      source: "training",
      created_by: coachProfileId,
    });
    if (error) return setNotice(error.message);
    setForm({ ...form, result: "", position: "", customName: "" });
    setNotice("Marca de entrenamiento guardada.");
    void load();
  };

  return <section className="results-workspace">
    {historicResults.length > 0 && <article className="panel"><h2>Marcas oficiales vinculadas</h2><p>Resultados FAM/RFEA de 2024, 2025 y 2026 asociados automáticamente por coincidencia de nombre.</p><section className="result-event">{historicResults.map(row => <div className="result-row" key={row.id}><span><b>{row.event_name}</b><small>{row.result_text} · {row.competition_name}</small></span><span>{new Date(row.competition_date + "T00:00:00").toLocaleDateString("es-ES")}</span><span>{environmentLabel(historicEnvironment(row.competition_name))} · Oficial</span></div>)}</section></article>}
    <article className="panel"><h2>Mejores marcas oficiales</h2><p>Marcas logradas en competición y vinculadas al ranking oficial.</p>{officialBests.length ? <div className="results-best-grid">{officialBests.map(pb => <div className="result-best" key={`${pb.athlete_id}-${pb.athletics_event_id}-${pb.competition_environment || "unknown"}`}><small>{pb.event_name}</small><b>{pb.result_text}</b><span>{pb.competition_name} · {new Date(pb.competition_date).toLocaleDateString("es-ES")}</span><em>{environmentLabel(pb.competition_environment)} · {sourceLabel(pb.source)} · Oficial</em></div>)}</div> : <p>Aún no hay mejores marcas oficiales registradas.</p>}</article>

    <article className="panel"><div className="table-title"><div><h2>Histórico de resultados oficiales</h2><p>Participaciones y resultados obtenidos en competición.</p></div><div className="result-tools"><label>Prueba<select value={resultEventId} onChange={event => setResultEventId(event.target.value)}><option value="">Todas las pruebas</option>{events.map(event => <option value={event.id} key={event.id}>{event.name}</option>)}</select></label><div className="result-sort" aria-label="Ordenar resultados"><span>Ordenar</span><button type="button" className={resultSort === "date" ? "selected" : "outline"} onClick={() => setResultSort("date")}>Fecha ↓</button><button type="button" className={resultSort === "best" ? "selected" : "outline"} onClick={() => setResultSort("best")}>Marca ↑</button></div></div></div>{officialResults.length ? <section className="result-event">{officialResults.map(row => <div className="result-row" key={row.id}><span><b>{row.athletics_events?.name || "Prueba"}</b><small>{row.result_text} · {row.competition_name}</small></span><span>{new Date(row.competition_date).toLocaleDateString("es-ES")}{row.venue ? ` · ${row.venue}` : ""}</span><span>{row.position ? `Puesto ${row.position} · ` : ""}{environmentLabel(row.competition_environment)} · Oficial</span></div>)}</section> : <p>Todavía no hay resultados oficiales asociados a este atleta.</p>}</article>
    <article className="panel training-results-panel"><div className="table-title"><div><h2>Marcas de entrenamiento</h2><p>Resultados registrados durante las sesiones del club.</p></div></div>{trainingResults.length ? <section className="result-event">{trainingResults.map(row => <div className="result-row" key={row.id}><span><b>{row.athletics_events?.name || "Prueba"}</b><small>{row.result_text} · {row.competition_name}</small></span><span>{new Date(row.competition_date).toLocaleDateString("es-ES")}</span><span>Entrenamiento</span></div>)}</section> : <p>Todavía no hay marcas de entrenamiento registradas.</p>}</article>

    {showPerformance && <PerformanceIntelligence athleteId={athleteId} canRecord={!canAddTraining} />}
    <ExternalSports athleteId={athleteId} />
    <FitnessTests athleteId={athleteId} canPlan={canPlanFitness} canRecord={canRecordFitness} />

    {canAddTraining && <form className="panel stacked-form" onSubmit={addTrainingResult}><h2>Añadir marca de entrenamiento</h2><label>Prueba<select required value={form.eventId} onChange={e => setForm({ ...form, eventId: e.target.value })}><option value="">Selecciona una prueba</option>{events.map(event => <option value={event.id} key={event.id}>{event.name}</option>)}<option value="__other__">+ Otra prueba…</option></select></label>{form.eventId === "__other__" && <div className="ops-grid"><label>Nombre de la prueba<input required value={form.customName} onChange={e => setForm({ ...form, customName: e.target.value })} placeholder="Ej. 30 m lanzados, pentasalto…" /></label><label>Tipo de medición<select value={form.customKind} onChange={e => setForm({ ...form, customKind: e.target.value })}><option value="time">Tiempo</option><option value="distance">Distancia</option><option value="points">Puntos</option><option value="position">Posición</option><option value="other">Otro</option></select></label></div>}<div className="ops-grid"><label>Resultado<input required value={form.result} onChange={e => setForm({ ...form, result: e.target.value })} placeholder={form.unit === "minutes_seconds" ? "Ej. 7:34" : "Ej. 9,18"} /></label><label>Unidad<select value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value as Unit })}>{Object.entries(unitLabels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label></div><label>Fecha<input type="date" required value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label><label>Sesión/competición<input required value={form.competition} onChange={e => setForm({ ...form, competition: e.target.value })} placeholder="Entrenamiento del martes" /></label><label>Puesto (si aplica)<input type="number" min="1" value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} /></label><button>Guardar marca</button>{notice && <p className={notice.startsWith("Marca") ? "success-note" : "error-note"}>{notice}</p>}</form>}
  </section>;
}

export function ClubRankings() {
  const [rows, setRows] = useState<any[]>([]); const [events, setEvents] = useState<EventDef[]>([]); const [eventId, setEventId] = useState(""); const [season, setSeason] = useState(""); const [category, setCategory] = useState(""); const [environment, setEnvironment] = useState("");
  const officialCategories = ["Sub 8", "Sub 10", "Sub 12", "Sub 14", "Sub 16", "Sub 18", "Sub 20", "Sub 23", "Absoluto", "Máster"];
  useEffect(() => { const client = supabase; if (!client) return; void Promise.all([client.from("athletics_events").select("id,code,name,result_kind,sort_direction").order("name"), client.from("club_event_rankings").select("*")]).then(([eventResult, rankingResult]) => { setEvents((eventResult.data ?? []) as EventDef[]); setRows(withoutDuplicateRankingRows((rankingResult.data ?? []) as any[])); }); }, []);
  const seasons = [...new Set(rows.map(row => row.season).filter(Boolean))].sort().reverse();
  const categories = [...new Set([...officialCategories, ...rows.map(row => row.category_label).filter(Boolean)])];
  const filtered = rows.filter(row => (!eventId || row.athletics_event_id === eventId) && (!season || row.season === season) && (!category || row.category_label === category) && (!environment || row.competition_environment === environment) && Number(row.ranking_position) <= 20).sort((a,b) => Number(a.ranking_position) - Number(b.ranking_position));
  return <><div className="page-head"><div><h1>Ranking histórico del club</h1><p>Top 20 por prueba, categoría, temporada y superficie. Pista cubierta y aire libre se clasifican por separado.</p></div></div><article className="panel inline-form"><label>Prueba<select value={eventId} onChange={e => setEventId(e.target.value)}><option value="">Todas</option>{events.map(event => <option value={event.id} key={event.id}>{event.name}</option>)}</select></label><label>Temporada<select value={season} onChange={e => setSeason(e.target.value)}><option value="">Todas</option>{seasons.map(value => <option key={value}>{value}</option>)}</select></label><label>Categoría<select value={category} onChange={e => setCategory(e.target.value)}><option value="">Todas</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label><label>Superficie<select value={environment} onChange={e => setEnvironment(e.target.value)}><option value="">Todas</option><option value="indoor">Pista cubierta</option><option value="outdoor">Aire libre</option><option value="unknown">Sin identificar</option></select></label></article><article className="panel table">{filtered.map((row, index) => <div className={"row historical-rank " + (Number(row.ranking_position) <= 8 ? "top-eight" : "")} key={`${row.athlete_id || row.athlete_name}-${row.athletics_event_id}-${row.season}-${index}`}><span><b>{Number(row.ranking_position) <= 8 ? "★ " : "#"}{row.ranking_position} · {row.athlete_name || [row.first_name, row.last_name].filter(Boolean).join(" ") || "Atleta"}</b><small>{row.event_name} · {row.category_label || "Sin categoría"} · {environmentLabel(row.competition_environment)}</small></span><span><b>{row.result_text}</b><small>{Number(row.ranking_position) <= 8 ? "TOP 8 HISTÓRICO" : "Top 20 histórico"}</small></span><span>{row.competition_name}<small>{new Date(row.competition_date).toLocaleDateString("es-ES")}</small></span></div>)}{!filtered.length && <p>Aún no hay resultados oficiales verificados para este filtro.</p>}</article></>;
}

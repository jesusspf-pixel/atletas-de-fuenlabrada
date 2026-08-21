import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type EventDef = { id: string; code: string; name: string; result_kind: string; sort_direction: "asc" | "desc" };
type Result = {
  id: string; athlete_id: string | null; athletics_event_id: string; competition_name: string; competition_date: string;
  venue: string | null; season: string | null; category_label: string | null; result_text: string; result_value: number | null;
  result_unit: string | null; position: number | null; wind: number | null; source: string; official: boolean; verified: boolean;
  athletics_events?: EventDef | null;
};
type PB = { athlete_id: string; athletics_event_id: string; event_name: string; result_text: string; competition_name: string; competition_date: string; source: string; official: boolean };

type Props = { athleteId: string; canAddTraining?: boolean; coachProfileId?: string };

const sourceLabel = (source: string) => source === "fam" ? "FAM" : source === "rfea" ? "RFEA" : source === "training" ? "Entrenamiento" : "Manual";

export function AthleteResults({ athleteId, canAddTraining = false, coachProfileId }: Props) {
  const [events, setEvents] = useState<EventDef[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [pbs, setPbs] = useState<PB[]>([]);
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ eventId: "", resultText: "", resultValue: "", unit: "s", date: new Date().toISOString().slice(0, 10), competition: "Entrenamiento", position: "", notes: "" });

  const load = async () => {
    if (!supabase) return;
    const [{ data: eventData }, { data: resultData }, { data: pbData }] = await Promise.all([
      supabase.from("athletics_events").select("id,code,name,result_kind,sort_direction").eq("active", true).order("name"),
      supabase.from("athlete_results").select("*,athletics_events(id,code,name,result_kind,sort_direction)").eq("athlete_id", athleteId).order("competition_date", { ascending: false }),
      supabase.from("athlete_personal_bests").select("*").eq("athlete_id", athleteId)
    ]);
    setEvents((eventData ?? []) as EventDef[]);
    setResults((resultData ?? []) as Result[]);
    setPbs((pbData ?? []) as PB[]);
  };
  useEffect(() => { void load(); }, [athleteId]);

  const byEvent = useMemo(() => events.map(event => ({ event, rows: results.filter(row => row.athletics_event_id === event.id), pb: pbs.find(pb => pb.athletics_event_id === event.id) })).filter(item => item.rows.length), [events, results, pbs]);

  const addTrainingResult = async (e: FormEvent) => {
    e.preventDefault(); if (!supabase || !coachProfileId || !form.eventId) return;
    setNotice("");
    const { error } = await supabase.from("athlete_results").insert({
      athlete_id: athleteId,
      athletics_event_id: form.eventId,
      competition_name: form.competition || "Entrenamiento",
      competition_date: form.date,
      result_text: form.resultText,
      result_value: form.resultValue ? Number(form.resultValue.replace(",", ".")) : null,
      result_unit: form.unit || null,
      position: form.position ? Number(form.position) : null,
      official: false,
      verified: true,
      source: "training",
      created_by: coachProfileId
    });
    if (error) return setNotice(error.message);
    setForm({ ...form, resultText: "", resultValue: "", position: "", notes: "" });
    setNotice("Marca de entrenamiento guardada.");
    void load();
  };

  return <section className="results-workspace">
    <article className="panel"><h2>Mejores marcas</h2>{pbs.length ? <div className="results-best-grid">{pbs.map(pb => <div className="result-best" key={`${pb.athlete_id}-${pb.athletics_event_id}`}><small>{pb.event_name}</small><b>{pb.result_text}</b><span>{pb.competition_name} · {new Date(pb.competition_date).toLocaleDateString("es-ES")}</span><em>{sourceLabel(pb.source)}{pb.official ? " · Oficial" : ""}</em></div>)}</div> : <p>Aún no hay mejores marcas registradas.</p>}</article>

    <article className="panel"><h2>Histórico de resultados</h2>{byEvent.length ? byEvent.map(({ event, rows, pb }) => <section className="result-event" key={event.id}><h3>{event.name}{pb ? <small> · Mejor: {pb.result_text}</small> : null}</h3>{rows.map(row => <div className="result-row" key={row.id}><span><b>{row.result_text}</b><small>{row.competition_name}</small></span><span>{new Date(row.competition_date).toLocaleDateString("es-ES")}{row.venue ? ` · ${row.venue}` : ""}</span><span>{row.position ? `Puesto ${row.position} · ` : ""}{sourceLabel(row.source)}{row.official ? " · Oficial" : ""}</span></div>)}</section>) : <p>Todavía no hay resultados asociados a este atleta.</p>}</article>

    {canAddTraining && <form className="panel stacked-form" onSubmit={addTrainingResult}><h2>Añadir marca de entrenamiento</h2><label>Prueba<select required value={form.eventId} onChange={e => setForm({ ...form, eventId: e.target.value })}><option value="">Selecciona una prueba</option>{events.map(event => <option value={event.id} key={event.id}>{event.name}</option>)}</select></label><label>Marca mostrada<input required value={form.resultText} onChange={e => setForm({ ...form, resultText: e.target.value })} placeholder="Ej. 9.18 o 4,32 m" /></label><label>Valor numérico para ranking<input value={form.resultValue} onChange={e => setForm({ ...form, resultValue: e.target.value })} placeholder="Ej. 9.18" /></label><label>Unidad<input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="s, m, puntos…" /></label><label>Fecha<input type="date" required value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label><label>Sesión/competición<input required value={form.competition} onChange={e => setForm({ ...form, competition: e.target.value })} /></label><label>Puesto (si aplica)<input type="number" min="1" value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} /></label><button>Guardar marca</button>{notice && <p className={notice.startsWith("Marca") ? "success-note" : "error-note"}>{notice}</p>}</form>}
  </section>;
}

export function ClubRankings() {
  const [rows, setRows] = useState<any[]>([]); const [events, setEvents] = useState<EventDef[]>([]); const [eventId, setEventId] = useState(""); const [season, setSeason] = useState(""); const [category, setCategory] = useState("");
  useEffect(() => { if (!supabase) return; void Promise.all([supabase.from("athletics_events").select("id,code,name,result_kind,sort_direction").order("name"), supabase.from("club_event_rankings").select("*")]).then(([eventResult, rankingResult]) => { setEvents((eventResult.data ?? []) as EventDef[]); setRows(rankingResult.data ?? []); }); }, []);
  const seasons = [...new Set(rows.map(row => row.season).filter(Boolean))]; const categories = [...new Set(rows.map(row => row.category_label).filter(Boolean))];
  const filtered = rows.filter(row => (!eventId || row.athletics_event_id === eventId) && (!season || row.season === season) && (!category || row.category_label === category)).sort((a,b) => Number(a.ranking_position) - Number(b.ranking_position));
  return <><div className="page-head"><div><h1>Ranking del club</h1><p>Clasificación interna calculada automáticamente a partir de resultados oficiales verificados.</p></div></div><article className="panel inline-form"><label>Prueba<select value={eventId} onChange={e => setEventId(e.target.value)}><option value="">Todas</option>{events.map(event => <option value={event.id} key={event.id}>{event.name}</option>)}</select></label><label>Temporada<select value={season} onChange={e => setSeason(e.target.value)}><option value="">Todas</option>{seasons.map(value => <option key={value}>{value}</option>)}</select></label><label>Categoría<select value={category} onChange={e => setCategory(e.target.value)}><option value="">Todas</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label></article><article className="panel table">{filtered.map((row, index) => <div className="row" key={`${row.athlete_id}-${row.athletics_event_id}-${row.season}-${index}`}><span><b>#{row.ranking_position} · {row.first_name} {row.last_name}</b><small>{row.event_name} · {row.category_label || "Sin categoría"}</small></span><span><b>{row.result_text}</b></span><span>{row.competition_name}<small>{new Date(row.competition_date).toLocaleDateString("es-ES")}</small></span></div>)}{!filtered.length && <p>No hay resultados oficiales verificados para este filtro.</p>}</article></>;
}

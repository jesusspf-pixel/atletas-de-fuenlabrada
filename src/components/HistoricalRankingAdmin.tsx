import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import HistoricalRanking from "./HistoricalRanking";

type ReviewStatus = "pending" | "reviewed" | "hidden";
type MetricType = "time" | "distance" | "weight";
type Source = "FAM" | "RFEA" | "manual";

type Performance = {
  id: string;
  historical_athlete_id: string;
  discipline: string;
  category: string | null;
  season: string | null;
  metric_type: MetricType;
  performance_value: number | null;
  performance_display: string;
  result_date: string | null;
  competition_name: string | null;
  source: Source;
  source_url: string | null;
  source_club_name: string | null;
  review_status: ReviewStatus;
  notes: string | null;
  historical_athletes: { id: string; canonical_name: string } | null;
};

type FormState = {
  athleteName: string;
  discipline: string;
  category: string;
  season: string;
  metricType: MetricType;
  performanceValue: string;
  performanceDisplay: string;
  resultDate: string;
  competitionName: string;
  source: Source;
  sourceUrl: string;
  sourceClubName: string;
  notes: string;
};

const blank: FormState = {
  athleteName: "",
  discipline: "",
  category: "",
  season: "2025/2026",
  metricType: "time",
  performanceValue: "",
  performanceDisplay: "",
  resultDate: "",
  competitionName: "",
  source: "FAM",
  sourceUrl: "",
  sourceClubName: "Atletas de Fuenlabrada",
  notes: ""
};

const statusText: Record<ReviewStatus, string> = {
  pending: "Pendiente de revisión",
  reviewed: "Revisado · público",
  hidden: "Oculto"
};

export default function HistoricalRankingAdmin() {
  const [rows, setRows] = useState<Performance[]>([]);
  const [filter, setFilter] = useState<"all" | ReviewStatus>("pending");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<FormState>(blank);

  const selected = useMemo(() => rows.find(row => row.id === selectedId) || null, [rows, selectedId]);

  const reload = async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("official_performances")
      .select("id,historical_athlete_id,discipline,category,season,metric_type,performance_value,performance_display,result_date,competition_name,source,source_url,source_club_name,review_status,notes,historical_athletes(id,canonical_name)")
      .order("result_date", { ascending: false, nullsFirst: false })
      .limit(300);
    setRows((data || []) as unknown as Performance[]);
    setNotice(error?.message || "");
    setLoading(false);
  };

  useEffect(() => { void reload(); }, []);

  useEffect(() => {
    if (!selected) return;
    setForm({
      athleteName: selected.historical_athletes?.canonical_name || "",
      discipline: selected.discipline,
      category: selected.category || "",
      season: selected.season || "",
      metricType: selected.metric_type,
      performanceValue: selected.performance_value?.toString() || "",
      performanceDisplay: selected.performance_display,
      resultDate: selected.result_date || "",
      competitionName: selected.competition_name || "",
      source: selected.source,
      sourceUrl: selected.source_url || "",
      sourceClubName: selected.source_club_name || "",
      notes: selected.notes || ""
    });
    setNotice("");
  }, [selectedId]);

  const startNew = () => {
    setSelectedId("");
    setForm(blank);
    setNotice("");
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    const athleteName = form.athleteName.trim();
    if (!athleteName || !form.discipline.trim() || !form.performanceDisplay.trim()) {
      setNotice("Indica atleta, prueba y marca.");
      return;
    }
    const numericValue = form.performanceValue.trim() === "" ? null : Number(form.performanceValue.replace(",", "."));
    if (numericValue !== null && !Number.isFinite(numericValue)) {
      setNotice("El valor de orden debe ser un número válido.");
      return;
    }
    setBusy("save");
    setNotice("");

    let athleteId = selected?.historical_athlete_id || "";
    if (selected?.historical_athletes && selected.historical_athletes.canonical_name !== athleteName) {
      const { error } = await supabase.from("historical_athletes").update({ canonical_name: athleteName }).eq("id", athleteId);
      if (error) { setBusy(""); setNotice(error.message); return; }
    }
    if (!athleteId) {
      const { data: existing, error: findError } = await supabase
        .from("historical_athletes")
        .select("id")
        .ilike("canonical_name", athleteName)
        .maybeSingle();
      if (findError) { setBusy(""); setNotice(findError.message); return; }
      if (existing) athleteId = existing.id;
      else {
        const { data: created, error: createError } = await supabase
          .from("historical_athletes")
          .insert({ canonical_name: athleteName })
          .select("id")
          .single();
        if (createError || !created) { setBusy(""); setNotice(createError?.message || "No se pudo crear el atleta histórico."); return; }
        athleteId = created.id;
      }
    }

    const payload = {
      historical_athlete_id: athleteId,
      discipline: form.discipline.trim(),
      category: form.category.trim() || null,
      season: form.season.trim() || null,
      metric_type: form.metricType,
      performance_value: numericValue,
      performance_display: form.performanceDisplay.trim(),
      result_date: form.resultDate || null,
      competition_name: form.competitionName.trim() || null,
      source: form.source,
      source_url: form.sourceUrl.trim() || null,
      source_club_name: form.sourceClubName.trim() || null,
      notes: form.notes.trim() || null
    };
    const result = selected
      ? await supabase.from("official_performances").update(payload).eq("id", selected.id)
      : await supabase.from("official_performances").insert(payload);
    setBusy("");
    if (result.error) { setNotice(result.error.message); return; }
    setNotice(selected ? "Registro actualizado." : "Registro añadido como pendiente de revisión.");
    await reload();
    if (!selected) startNew();
  };

  const updateStatus = async (row: Performance, status: ReviewStatus) => {
    if (!supabase) return;
    setBusy(row.id + status);
    const { error } = await supabase.from("official_performances").update({ review_status: status }).eq("id", row.id);
    setBusy("");
    setNotice(error?.message || (status === "reviewed" ? "Registro revisado y visible en el ranking público." : status === "hidden" ? "Registro oculto." : "Registro devuelto a revisión."));
    await reload();
  };

  const remove = async (row: Performance) => {
    if (!supabase || !window.confirm("¿Eliminar este registro del ranking? Esta acción no se puede deshacer.")) return;
    setBusy(row.id + "delete");
    const { error } = await supabase.from("official_performances").delete().eq("id", row.id);
    setBusy("");
    setNotice(error?.message || "Registro eliminado.");
    if (!error && selectedId === row.id) startNew();
    await reload();
  };

  const block = async (row: Performance) => {
    if (!supabase || !row.historical_athletes) return;
    const reason = window.prompt("Motivo del bloqueo (opcional):", "No pertenece al club");
    if (reason === null) return;
    setBusy(row.id + "block");
    const { data: existing, error: lookupError } = await supabase
      .from("official_import_blocks")
      .select("id")
      .ilike("blocked_name", row.historical_athletes.canonical_name)
      .eq("source", row.source)
      .maybeSingle();
    const { error } = lookupError || existing
      ? { error: lookupError }
      : await supabase.from("official_import_blocks").insert({
        blocked_name: row.historical_athletes.canonical_name,
        source: row.source,
        reason: reason || null
      });
    if (!error) await supabase.from("official_performances").update({ review_status: "hidden" }).eq("id", row.id);
    setBusy("");
    setNotice(error?.message || "Nombre bloqueado para futuras importaciones y registro ocultado.");
    await reload();
  };

  const visibleRows = rows.filter(row => filter === "all" || row.review_status === filter);

  return <section>
    <HistoricalRanking />
    <div className="page-head">
      <div><h1>Ranking histórico</h1><p>Controla los registros oficiales antes de que aparezcan públicamente. La importación de FAM y RFEA se añadirá sobre este listado.</p></div>
      <button onClick={startNew}>Añadir registro</button>
    </div>

    <form className="panel stacked-form" onSubmit={save}>
      <h2>{selected ? "Editar registro oficial" : "Nuevo registro oficial"}</h2>
      <div className="ops-grid">
        <label>Atleta<input required value={form.athleteName} onChange={event => setForm({ ...form, athleteName: event.target.value })} placeholder="Nombre y apellidos" /></label>
        <label>Prueba<input required value={form.discipline} onChange={event => setForm({ ...form, discipline: event.target.value })} placeholder="600 m lisos" /></label>
        <label>Categoría<input value={form.category} onChange={event => setForm({ ...form, category: event.target.value })} placeholder="Sub 12" /></label>
        <label>Temporada<input value={form.season} onChange={event => setForm({ ...form, season: event.target.value })} placeholder="2025/2026" /></label>
        <label>Tipo de resultado<select value={form.metricType} onChange={event => setForm({ ...form, metricType: event.target.value as MetricType })}><option value="time">Tiempo</option><option value="distance">Distancia</option><option value="weight">Peso</option></select></label>
        <label>Valor para ordenar<input inputMode="decimal" value={form.performanceValue} onChange={event => setForm({ ...form, performanceValue: event.target.value })} placeholder="Ej. 98.42 segundos" /></label>
        <label>Marca visible<input required value={form.performanceDisplay} onChange={event => setForm({ ...form, performanceDisplay: event.target.value })} placeholder="1:38.42 / 4,56 m / 42 kg" /></label>
        <label>Fecha<input type="date" value={form.resultDate} onChange={event => setForm({ ...form, resultDate: event.target.value })} /></label>
        <label>Competición<input value={form.competitionName} onChange={event => setForm({ ...form, competitionName: event.target.value })} placeholder="Control FAM" /></label>
        <label>Fuente<select value={form.source} onChange={event => setForm({ ...form, source: event.target.value as Source })}><option value="FAM">FAM</option><option value="RFEA">RFEA</option><option value="manual">Manual</option></select></label>
        <label>Enlace de la fuente<input type="url" value={form.sourceUrl} onChange={event => setForm({ ...form, sourceUrl: event.target.value })} placeholder="https://…" /></label>
        <label>Club publicado<input value={form.sourceClubName} onChange={event => setForm({ ...form, sourceClubName: event.target.value })} placeholder="Atletas de Fuenlabrada" /></label>
      </div>
      <label>Notas<textarea value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} placeholder="Observaciones internas; no se publican." /></label>
      <button disabled={busy === "save"}>{busy === "save" ? "Guardando…" : selected ? "Guardar cambios" : "Guardar para revisión"}</button>
      {selected && <button type="button" className="outline" onClick={startNew}>Cancelar edición</button>}
      {notice && <p className={notice.includes("No ") || notice.includes("Indica") ? "error-note" : "success-note"}>{notice}</p>}
    </form>

    <div className="inline-form panel">
      <label>Ver<select value={filter} onChange={event => setFilter(event.target.value as "all" | ReviewStatus)}><option value="pending">Pendientes</option><option value="reviewed">Revisados</option><option value="hidden">Ocultos</option><option value="all">Todos</option></select></label>
      <small>{rows.filter(row => row.review_status === "pending").length} pendiente(s) de revisión.</small>
    </div>

    <article className="panel table">
      {loading ? <div className="empty">Cargando ranking…</div> : visibleRows.map(row => <div className="row" key={row.id}>
        <span><b>{row.historical_athletes?.canonical_name || "Atleta sin nombre"}</b><small>{row.category || "Categoría sin indicar"} · {row.season || "Temporada sin indicar"}</small></span>
        <span><b>{row.discipline}</b><small>{row.competition_name || "Sin competición"}{row.result_date ? " · " + new Date(row.result_date + "T00:00:00").toLocaleDateString("es-ES") : ""}</small></span>
        <span><b>{row.performance_display}</b><small>{row.source}{row.source_url ? " · fuente enlazada" : ""}</small></span>
        <span><small>{statusText[row.review_status]}</small><div className="ranking-actions"><button className="plain" onClick={() => setSelectedId(row.id)}>Editar</button>{row.review_status !== "reviewed" && <button className="plain" disabled={busy === row.id + "reviewed"} onClick={() => void updateStatus(row, "reviewed")}>Revisar</button>}{row.review_status !== "hidden" && <button className="plain" disabled={busy === row.id + "hidden"} onClick={() => void updateStatus(row, "hidden")}>Ocultar</button>}<button className="plain" disabled={busy === row.id + "block"} onClick={() => void block(row)}>Bloquear</button><button className="plain danger-link" disabled={busy === row.id + "delete"} onClick={() => void remove(row)}>Borrar</button></div></span>
      </div>)}
      {!loading && !visibleRows.length && <div className="empty">No hay registros en este estado.</div>}
    </article>
  </section>;
}

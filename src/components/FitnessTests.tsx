import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type FitnessTest = {
  id: string;
  test_type: string;
  protocol: string | null;
  status: "planned" | "completed" | "cancelled";
  scheduled_for: string | null;
  completed_on: string | null;
  vo2_max: number | null;
  device: string | null;
  notes: string | null;
};

type Props = { athleteId: string; canPlan?: boolean; canRecord?: boolean };

const today = () => new Date().toISOString().slice(0, 10);

export default function FitnessTests({ athleteId, canPlan = false, canRecord = false }: Props) {
  const [tests, setTests] = useState<FitnessTest[]>([]);
  const [notice, setNotice] = useState("");
  const [record, setRecord] = useState({ value: "", device: "", date: today() });
  const [plan, setPlan] = useState({ protocol: "Test VAM / VO₂ máx.", date: today(), notes: "" });

  const load = async () => {
    const client = supabase; if (!client) return;
    const { data } = await client.from("athlete_fitness_tests").select("id,test_type,protocol,status,scheduled_for,completed_on,vo2_max,device,notes").eq("athlete_id", athleteId).order("created_at", { ascending: false });
    setTests((data ?? []) as FitnessTest[]);
  };
  useEffect(() => { void load(); }, [athleteId]);

  const completed = useMemo(() => tests.filter(test => test.status === "completed" && test.vo2_max !== null).sort((a,b) => String(a.completed_on).localeCompare(String(b.completed_on))), [tests]);
  const points = useMemo(() => {
    if (!completed.length) return "";
    const values = completed.map(test => Number(test.vo2_max));
    const min = Math.min(...values) - 1, max = Math.max(...values) + 1;
    return values.map((value, index) => `${completed.length === 1 ? 50 : 6 + index * 88 / (completed.length - 1)},${84 - ((value - min) / Math.max(1, max - min)) * 66}`).join(" ");
  }, [completed]);

  const saveRecord = async (event: FormEvent) => {
    event.preventDefault(); setNotice("");
    const value = Number(record.value.replace(",", "."));
    if (!Number.isFinite(value) || value < 10 || value > 100) return setNotice("Introduce un VO₂ máx. válido entre 10 y 100.");
    const client = supabase; if (!client) return;
    const { error } = await client.from("athlete_fitness_tests").insert({ athlete_id: athleteId, test_type: "device_estimate", protocol: "Estimación del dispositivo", status: "completed", completed_on: record.date, vo2_max: value, device: record.device.trim(), created_by: (await client.auth.getUser()).data.user?.id });
    if (error) return setNotice(error.message);
    setRecord({ value: "", device: "", date: today() }); setNotice("VO₂ máx. registrado correctamente."); void load();
  };

  const schedule = async (event: FormEvent) => {
    event.preventDefault(); setNotice("");
    const client = supabase; if (!client) return;
    const { error } = await client.from("athlete_fitness_tests").insert({ athlete_id: athleteId, test_type: "planned_test", protocol: plan.protocol.trim(), status: "planned", scheduled_for: plan.date, notes: plan.notes.trim() || null, created_by: (await client.auth.getUser()).data.user?.id });
    if (error) return setNotice(error.message);
    setPlan({ ...plan, notes: "" }); setNotice("Test planificado para el atleta."); void load();
  };

  return <article className="panel fitness-tests-panel">
    <div className="fitness-tests-title"><div><small>CONTROL DE RENDIMIENTO</small><h2>Evolución de VO₂ máx.</h2><p>Estimaciones del dispositivo y test planificados por el entrenador, siempre identificados por su origen.</p></div>{completed.length > 0 && <strong>{Number(completed.at(-1)?.vo2_max).toFixed(1)}<small>último registro</small></strong>}</div>
    {completed.length > 0 ? <div className="vo2-chart"><svg viewBox="0 0 100 92" preserveAspectRatio="none" aria-label="Evolución del VO2 máximo"><defs><linearGradient id="vo2Area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2f80ed" stopOpacity=".4"/><stop offset="1" stopColor="#2f80ed" stopOpacity="0"/></linearGradient></defs><polyline points={`${points} 94,90 6,90`} fill="url(#vo2Area)" stroke="none"/><polyline points={points} fill="none" stroke="#2f80ed" strokeWidth="2.4" vectorEffect="non-scaling-stroke"/></svg><div>{completed.map(test => <span key={test.id}><b>{Number(test.vo2_max).toFixed(1)}</b><small>{new Date(`${test.completed_on}T00:00:00`).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}</small></span>)}</div></div> : <div className="fitness-empty">Aún no hay mediciones. El primer registro creará la curva de evolución.</div>}
    {tests.some(test => test.status === "planned") && <section className="planned-tests"><h3>Próximos test</h3>{tests.filter(test => test.status === "planned").map(test => <div key={test.id}><span><b>{test.protocol || "Test de VO₂ máx."}</b><small>{test.notes || "Pendiente de realización"}</small></span><time>{test.scheduled_for ? new Date(`${test.scheduled_for}T00:00:00`).toLocaleDateString("es-ES") : "Por definir"}</time></div>)}</section>}
    <div className="fitness-actions">
      {canRecord && <form onSubmit={saveRecord}><h3>Registrar VO₂ máx.</h3><div className="fitness-form-grid"><label>VO₂ máx.<input inputMode="decimal" required value={record.value} onChange={e => setRecord({ ...record, value: e.target.value })} placeholder="Ej. 48,6" /></label><label>Dispositivo<input required value={record.device} onChange={e => setRecord({ ...record, device: e.target.value })} placeholder="Apple Watch, Garmin…" /></label><label>Fecha<input type="date" required value={record.date} onChange={e => setRecord({ ...record, date: e.target.value })} /></label></div><button>Guardar registro</button></form>}
      {canPlan && <form onSubmit={schedule}><h3>Planificar test</h3><div className="fitness-form-grid"><label>Protocolo<select value={plan.protocol} onChange={e => setPlan({ ...plan, protocol: e.target.value })}><option>Test VAM / VO₂ máx.</option><option>Test de Cooper · 12 minutos</option><option>Course Navette</option><option>Test de 6 minutos</option><option>Test personalizado</option></select></label><label>Fecha prevista<input type="date" required value={plan.date} onChange={e => setPlan({ ...plan, date: e.target.value })} /></label><label className="wide">Indicaciones<textarea value={plan.notes} onChange={e => setPlan({ ...plan, notes: e.target.value })} placeholder="Lugar, calentamiento y observaciones…" /></label></div><button>Programar test</button></form>}
    </div>
    {notice && <p className={notice.includes("correctamente") || notice.includes("planificado") ? "success-note" : "error-note"}>{notice}</p>}
  </article>;
}

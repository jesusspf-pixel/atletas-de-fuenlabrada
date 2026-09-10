import { useState } from "react";
import { createRoot } from "react-dom/client";
import "./demo.css";

// Standalone entry: never import the real app, authentication, payment or API modules.
const people = ["Álex Demo", "Cris Demo", "Dani Demo", "Mar Demo", "Sam Demo", "Vega Demo"];
const groups = ["Running A", "Running B", "Escuela"];
const initialPlan = ["Rodaje suave · 35 minutos", "Técnica + 6 × 400 m", "Descanso", "Rodaje progresivo · 40 minutos", "Fuerza y movilidad", "Rodaje en grupo · 50 minutos", "Descanso"];
const days = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
type Role = "Administrador" | "Entrenador" | "Familia / atleta";
function Demo() {
  const [role, setRole] = useState<Role>("Administrador");
  const [tab, setTab] = useState("Resumen");
  const [group, setGroup] = useState(groups[0]);
  const [plans, setPlans] = useState<Record<string, string[]>>({});
  const [attendance, setAttendance] = useState<Record<string, boolean>>({});
  const [date, setDate] = useState("2026-09-09");
  const [editing, setEditing] = useState(false);
  const [challenge, setChallenge] = useState(false);
  const [notice, setNotice] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  const plan = plans[group] || initialPlan;
  const staff = role !== "Familia / atleta";
  const tabs = ["Resumen", "Planes", ...(staff ? ["Asistencia"] : []), ...(role === "Administrador" ? ["Cuotas"] : []), "Challenge", "Avisos"];
  const reset = () => { setPlans({}); setAttendance({}); setSent([]); setChallenge(false); setMessage(""); setNotice("Demostración reiniciada. No se ha modificado ninguna cuenta real."); };
  return <div className="demo-shell">
    <div className="demo-banner">MODO DEMOSTRACIÓN · Datos ficticios · Sin cobros, correos ni conexiones externas</div>
    <header><div><small>SPORTMED / CLUB EXPERIENCE</small><h1>Club Horizonte</h1><p>Una muestra interactiva para descubrir tu próximo club digital.</p></div><button onClick={reset}>Reiniciar demo</button></header>
    <section className="demo-controls"><label>Explorar como<select value={role} onChange={e => { setRole(e.target.value as Role); setTab("Resumen"); setEditing(false); }}>{["Administrador", "Entrenador", "Familia / atleta"].map(r => <option key={r}>{r}</option>)}</select></label><label>Grupo<select value={group} onChange={e => { setGroup(e.target.value); setEditing(false); }}>{groups.map(g => <option key={g}>{g}</option>)}</select></label><span>Sesión de ejemplo · Septiembre 2026</span></section>
    <nav aria-label="Secciones de demostración">{tabs.map(t => <button key={t} aria-current={tab === t ? "page" : undefined} onClick={() => { setTab(t); setEditing(false); }}>{t}</button>)}</nav>
    {notice && <p role="status" className="demo-status">{notice}</p>}
    <main>
      {tab === "Resumen" && <><div className="demo-title"><small>TU CLUB, CONECTADO</small><h2>Todo lo importante, en un solo lugar.</h2><p>Cambia de perfil y prueba los planes, la asistencia y los retos. Los cambios duran solo mientras mantengas esta página abierta.</p></div><div className="demo-metrics">{[["18", "Atletas de ejemplo"], ["3", "Grupos activos"], ["12", "Matrículas con importe"], ["960 €", "Matrículas simuladas"]].map(([v,l]) => <article key={l}><strong>{v}</strong><span>{l}</span></article>)}</div><div className="demo-grid"><article><small>PRÓXIMA SESIÓN</small><h3>{group}</h3><p>{plan[0]}</p><button onClick={() => setTab("Planes")}>Ver semana</button></article><article><small>OBJETIVO COLECTIVO</small><h3>El club suma 500 km</h3><p>312 de 500 km · Datos ilustrativos</p><progress max="500" value="312"/><button onClick={() => setTab("Challenge")}>Explorar Challenge</button></article></div></>}
      {tab === "Planes" && <><div className="demo-title"><h2>Tu semana en movimiento</h2><p>{group} · Plan publicado de ejemplo, no una prescripción personal.</p>{staff && <button onClick={() => { if (editing) setNotice("Plan publicado solo en esta demostración."); setEditing(!editing); }}>{editing ? "Publicar en la demo" : "Editar plan de ejemplo"}</button>}</div><div className="demo-week">{days.map((d,i) => <article key={d}><small>{d}</small>{editing ? <textarea aria-label={`Plan del ${d}`} value={plan[i]} onChange={e => setPlans({...plans, [group]: plan.map((p,j) => j === i ? e.target.value : p)})}/> : <h3>{plan[i]}</h3>}</article>)}</div></>}
      {tab === "Asistencia" && staff && <><h2>Pasar lista · {group}</h2><label>Fecha<input type="date" value={date} onChange={e => setDate(e.target.value)}/></label><p>Marca varios atletas o cambia la fecha para consultar otra lista de ejemplo.</p><div className="demo-grid">{people.map(name => { const key = `${group}/${date}/${name}`; return <label className="demo-person" key={name}><input type="checkbox" checked={!!attendance[key]} onChange={e => setAttendance(a => ({...a,[key]: e.target.checked}))}/>{name}</label>; })}</div><p>Guardado únicamente en memoria, sin datos reales.</p></>}
      {tab === "Cuotas" && role === "Administrador" && <><h2>Matrículas cobradas · Simulación</h2><p>12 matrículas con importe · 960 €. Las 6 renovaciones de 0 € no se cuentan como matrículas cobradas.</p><div className="demo-table"><table><thead><tr><th>Atleta ficticio</th><th>Concepto</th><th>Importe</th><th>Estado</th></tr></thead><tbody>{groups.flatMap((g,gi) => people.map((p,i) => <tr key={`${g}/${p}`}><td>{p} · {g}</td><td>{i < 4 ? "Matrícula" : "Renovación"}</td><td>{i < 4 ? "80 €" : "0 €"}</td><td>{i < 4 ? "Cobro simulado" : "Sin cargo"}{gi === -1 ? "" : ""}</td></tr>))}</tbody></table></div></>}
      {tab === "Challenge" && <><h2>Challenge / Superarse juntos</h2><p>Clasificación ficticia. Los retos no recomiendan aumentar la carga ni saltarse descansos.</p><div className="demo-podium">{[1,0,2].map((n) => <article key={n}><small>POSICIÓN {n+1}</small><h3>{people[n]}</h3><strong>{[42,38,31][n]} km</strong></article>)}</div><div className="demo-grid"><article><h3>Reto colectivo · 500 km</h3><progress value="312" max="500"/><p>{challenge ? "Participas en este reto de demostración." : "Sumamos kilómetros entre todos, cada uno a su ritmo."}</p><button onClick={() => setChallenge(!challenge)}>{challenge ? "Salir del reto demo" : "Unirme al reto demo"}</button></article><article><h3>Duelo de constancia</h3><p>Invita a Cris Demo a cumplir las sesiones planificadas esta semana.</p><button onClick={() => setNotice("Invitación simulada a Cris Demo. No se ha enviado ninguna notificación.")}>Simular invitación</button></article></div></>}
      {tab === "Avisos" && <><h2>El club, al día</h2><article><h3>Bienvenidos a la nueva temporada</h3><p>Este mensaje forma parte de la demostración de Club Horizonte.</p></article>{sent.map((s,i) => <article key={i}><small>PUBLICACIÓN SIMULADA</small><p>{s}</p></article>)}{staff && <form onSubmit={e => { e.preventDefault(); if (!message.trim()) return; setSent(s => [...s,message.trim()]); setMessage(""); setNotice("Aviso añadido a esta demo. No se han enviado correos ni notificaciones."); }}><label>Nuevo aviso de ejemplo<textarea required maxLength={1000} value={message} onChange={e => setMessage(e.target.value)}/></label><button>Publicar solo en la demo</button></form>}</>}
    </main><footer>Sportmed · Demostración comercial independiente. No introduzcas datos personales reales. Recargar borra los cambios.</footer>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Demo/>);

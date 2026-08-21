import { FormEvent, useState } from "react";
import { supabase } from "../lib/supabase";

export default function SelfAthleteRegistration({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ first_name: "", last_name: "", birth_date: "", federative_sex: "M", dni_nie: "", health_notes: "" });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: string, value: string) => setForm(current => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); const client = supabase; if (!client) return;
    setBusy(true); setNotice("");
    const { error } = await client.rpc("register_self_as_adult_athlete", { payload: form });
    setBusy(false);
    if (error) return setNotice(error.message);
    setNotice("Tu alta como atleta se ha enviado para revisión.");
    window.setTimeout(onDone, 900);
  };
  return <main className="secure-screen"><section className="access-box"><div className="portal-brand"><b>AF</b><span>CLUB ATLETAS<small>DE FUENLABRADA</small></span></div><small>CUENTA ÚNICA</small><h1>También soy atleta</h1><p>Mantendrás tu acceso de familia y añadiremos tu propia ficha deportiva a esta misma cuenta.</p><form onSubmit={submit}><label>Nombre<input required value={form.first_name} onChange={e => set("first_name", e.target.value)} /></label><label>Apellidos<input required value={form.last_name} onChange={e => set("last_name", e.target.value)} /></label><label>Fecha de nacimiento<input required type="date" value={form.birth_date} onChange={e => set("birth_date", e.target.value)} /></label><label>Sexo federativo<select value={form.federative_sex} onChange={e => set("federative_sex", e.target.value)}><option value="M">Masculino</option><option value="F">Femenino</option></select></label><label>DNI / NIE<input value={form.dni_nie} onChange={e => set("dni_nie", e.target.value)} /></label><label>Información deportiva o médica relevante<textarea value={form.health_notes} onChange={e => set("health_notes", e.target.value)} /></label><button disabled={busy}>{busy ? "Enviando…" : "Crear mi ficha de atleta"}</button></form>{notice && <p className={notice.startsWith("Tu alta") ? "success-note" : "error-note"}>{notice}</p>}<button className="plain" onClick={onDone}>Cancelar</button></section></main>;
}

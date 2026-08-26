import { FormEvent, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function AccountDeletion() {
  const [signedIn, setSignedIn] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || confirmation.trim().toUpperCase() !== "ELIMINAR") return;
    setBusy(true);
    setMessage("");
    const { data } = await supabase.auth.getSession();
    const response = await fetch("/api/account-deletion-request", {
      method: "POST",
      headers: { authorization: `Bearer ${data.session?.access_token || ""}` },
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    setBusy(false);
    setMessage(response.ok ? "Solicitud registrada. El club revisará y completará la eliminación, conservando únicamente los datos legalmente obligatorios." : result.error || "No se pudo registrar la solicitud.");
  };

  return <main className="account-deletion-page">
    <article className="panel account-deletion-card">
      <small>PRIVACIDAD Y CUENTA</small>
      <h1>Eliminar mi cuenta</h1>
      <p>Puedes solicitar la eliminación de tu acceso, perfil, información personal y datos deportivos asociados. Los justificantes contables y la información que el club deba conservar por obligación legal quedarán bloqueados durante el plazo correspondiente.</p>
      {!signedIn ? <>
        <p className="info-note">Para proteger tu cuenta, inicia sesión antes de realizar la solicitud.</p>
        <a className="button-link" href="/?access=1">Iniciar sesión</a>
      </> : <form onSubmit={submit}>
        <label>Escribe <b>ELIMINAR</b> para confirmar
          <input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" />
        </label>
        <button disabled={busy || confirmation.trim().toUpperCase() !== "ELIMINAR"}>{busy ? "Registrando…" : "Solicitar eliminación de cuenta"}</button>
      </form>}
      {message && <p className={message.startsWith("Solicitud") ? "success-note" : "error-note"}>{message}</p>}
      <a className="plain-link" href="/">Volver a Atletas de Fuenlabrada</a>
    </article>
  </main>;
}

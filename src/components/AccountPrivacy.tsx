import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "../lib/supabase";

export default function AccountPrivacy({ email }: { email: string }) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [requested, setRequested] = useState(false);

  const requestDeletion = async () => {
    if (!supabase || confirmText.trim().toUpperCase() !== "ELIMINAR") return;
    setBusy(true);
    setNotice("");
    const { data } = await supabase.auth.getSession();
    const endpoint = Capacitor.isNativePlatform()
      ? "https://atletasdefuenlabrada.com/api/request-account-deletion"
      : "/api/request-account-deletion";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${data.session?.access_token || ""}`,
      },
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    setBusy(false);
    if (!response.ok) return setNotice(body.error || "No se pudo registrar la solicitud.");
    setRequested(true);
    setNotice(body.message || "Solicitud registrada correctamente.");
  };

  return <>
    <div className="page-head"><div><small>CUENTA Y PRIVACIDAD</small><h1>Controla tus datos</h1><p>Consulta los documentos vigentes o inicia la eliminación completa de tu cuenta.</p></div></div>
    <section className="two-columns account-privacy-links">
      <article className="panel"><h2>Privacidad</h2><p>Qué datos utilizamos, para qué y cómo ejercer tus derechos.</p><a className="button-link outline" href="/privacypolicy.html" target="_blank" rel="noreferrer">Abrir política de privacidad</a></article>
      <article className="panel"><h2>Condiciones y autorizaciones</h2><p>Normativa, cuotas, licencia federativa y uso de imágenes.</p><a className="button-link outline" href="/terminos.html" target="_blank" rel="noreferrer">Abrir condiciones</a></article>
    </section>
    <article className="panel account-delete-card">
      <small>ELIMINACIÓN DE CUENTA</small><h2>Solicitar eliminación</h2>
      <p>Se eliminará el acceso asociado a <b>{email}</b> y se suprimirán o anonimizarán los datos que no debamos conservar por obligación legal. Los justificantes contables, de cobro o federativos que deban conservarse quedarán bloqueados y fuera del uso ordinario.</p>
      <p>Completaremos el proceso como máximo en 30 días y recibirás una confirmación por correo. Esta solicitud no puede utilizarse para cancelar una deuda ya generada.</p>
      {requested ? <p className="success-note">{notice}</p> : <div className="stacked-form account-delete-confirm"><label>Escribe ELIMINAR para confirmar<input value={confirmText} onChange={event => setConfirmText(event.target.value)} autoComplete="off" /></label><button className="danger" type="button" disabled={busy || confirmText.trim().toUpperCase() !== "ELIMINAR"} onClick={() => void requestDeletion()}>{busy ? "Registrando solicitud…" : "Solicitar eliminación de mi cuenta"}</button>{notice && <p className="error-note">{notice}</p>}</div>}
      <a href="/eliminar-cuenta.html" target="_blank" rel="noreferrer">Más información sobre el proceso</a>
    </article>
  </>;
}

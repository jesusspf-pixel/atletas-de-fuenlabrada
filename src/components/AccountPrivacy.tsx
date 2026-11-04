import { useEffect, useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "../lib/supabase";

type WithdrawalAthlete = {
  id: string;
  first_name: string;
  last_name: string;
  club_status: string;
};

const endpointFor = (path: string) =>
  Capacitor.isNativePlatform() ? `https://atletasdefuenlabrada.com${path}` : path;

export default function AccountPrivacy({ email, role }: { email: string; role: string }) {
  const [athletes, setAthletes] = useState<WithdrawalAthlete[]>([]);
  const [loadingAthletes, setLoadingAthletes] = useState(
    ["parent", "adult_athlete", "minor_athlete"].includes(role),
  );
  const [selectedAthleteId, setSelectedAthleteId] = useState("");
  const [withdrawalConfirm, setWithdrawalConfirm] = useState("");
  const [withdrawalReason, setWithdrawalReason] = useState("");
  const [withdrawalBusy, setWithdrawalBusy] = useState(false);
  const [withdrawalNotice, setWithdrawalNotice] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [requested, setRequested] = useState(false);

  const canManageWithdrawals = ["parent", "adult_athlete", "minor_athlete"].includes(role);
  const activeAthletes = useMemo(
    () => athletes.filter(athlete => athlete.club_status !== "withdrawn"),
    [athletes],
  );

  useEffect(() => {
    const client = supabase;
    if (!client || !canManageWithdrawals) return;
    let cancelled = false;
    const load = async () => {
      setLoadingAthletes(true);
      const { data } = await client.auth.getSession();
      const response = await fetch(endpointFor("/api/request-club-withdrawal"), {
        headers: { authorization: `Bearer ${data.session?.access_token || ""}` },
      });
      const body = (await response.json().catch(() => ({}))) as {
        athletes?: WithdrawalAthlete[];
        error?: string;
      };
      if (cancelled) return;
      setLoadingAthletes(false);
      if (!response.ok) return setWithdrawalNotice(body.error || "No se pudieron cargar los atletas.");
      setAthletes(body.athletes || []);
    };
    void load();
    return () => { cancelled = true; };
  }, [canManageWithdrawals]);

  const openWithdrawal = (athleteId: string) => {
    setSelectedAthleteId(athleteId);
    setWithdrawalConfirm("");
    setWithdrawalReason("");
    setWithdrawalNotice("");
  };

  const requestWithdrawal = async () => {
    if (!supabase || !selectedAthleteId || withdrawalConfirm.trim().toUpperCase() !== "BAJA") return;
    setWithdrawalBusy(true);
    setWithdrawalNotice("");
    const { data } = await supabase.auth.getSession();
    const response = await fetch(endpointFor("/api/request-club-withdrawal"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${data.session?.access_token || ""}`,
      },
      body: JSON.stringify({
        athleteId: selectedAthleteId,
        confirmation: withdrawalConfirm,
        reason: withdrawalReason,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    setWithdrawalBusy(false);
    if (!response.ok) return setWithdrawalNotice(body.error || "No se pudo tramitar la baja.");
    setAthletes(current => current.map(athlete => athlete.id === selectedAthleteId ? { ...athlete, club_status: "withdrawn" } : athlete));
    setSelectedAthleteId("");
    setWithdrawalConfirm("");
    setWithdrawalReason("");
    setWithdrawalNotice(body.message || "La baja se ha tramitado correctamente.");
  };

  const requestDeletion = async () => {
    if (!supabase || confirmText.trim().toUpperCase() !== "ELIMINAR") return;
    setBusy(true);
    setNotice("");
    const { data } = await supabase.auth.getSession();
    const response = await fetch(endpointFor("/api/request-account-deletion"), {
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
    <div className="page-head"><div><small>CUENTA Y PRIVACIDAD</small><h1>Controla tus datos</h1><p>Consulta los documentos vigentes, gestiona tu baja o inicia la eliminación completa de tu cuenta.</p></div></div>
    <section className="two-columns account-privacy-links">
      <article className="panel"><h2>Privacidad</h2><p>Qué datos utilizamos, para qué y cómo ejercer tus derechos.</p><a className="button-link outline" href="/privacypolicy.html" target="_blank" rel="noreferrer">Abrir política de privacidad</a></article>
      <article className="panel"><h2>Condiciones y autorizaciones</h2><p>Normativa, cuotas, licencia federativa y uso de imágenes.</p><a className="button-link outline" href="/terminos.html" target="_blank" rel="noreferrer">Abrir condiciones</a></article>
    </section>
    {canManageWithdrawals && <article className="panel account-withdrawal-card">
      <small>BAJA DEL CLUB</small><h2>Gestionar mi baja</h2>
      <p>Desde aquí puedes dar de baja únicamente al atleta que elijas. La baja es inmediata: detiene su vinculación con el club, cancela su suscripción y los cobros futuros que aún no se hayan realizado.</p>
      <p>Los pagos ya efectuados, los importes anteriores pendientes y el historial deportivo se conservan. Si hay varios hermanos, la baja de uno no afecta a los demás.</p>
      {role === "minor_athlete" ? <p className="info-note">Por seguridad, la baja de un menor debe tramitarla su padre, madre o tutor desde la cuenta familiar.</p> : loadingAthletes ? <p>Cargando atletas…</p> : activeAthletes.length ? <div className="withdrawal-athlete-list">
        {activeAthletes.map(athlete => {
          const name = `${athlete.first_name} ${athlete.last_name}`.trim();
          const selected = selectedAthleteId === athlete.id;
          return <div className={`withdrawal-athlete ${selected ? "selected" : ""}`} key={athlete.id}>
            <div><b>{name}</b><small>{athlete.club_status === "active" ? "Alta activa" : "Inscripción en curso"}</small></div>
            {!selected && <button className="danger outline" type="button" onClick={() => openWithdrawal(athlete.id)}>{role === "adult_athlete" ? "Darme de baja" : "Dar de baja"}</button>}
            {selected && <div className="stacked-form withdrawal-confirm">
              <p><b>Vas a dar de baja a {name}.</b> Esta acción detendrá los próximos cobros.</p>
              <label>Motivo (opcional)<textarea value={withdrawalReason} onChange={event => setWithdrawalReason(event.target.value)} maxLength={500} rows={3} /></label>
              <label>Escribe BAJA para confirmar<input value={withdrawalConfirm} onChange={event => setWithdrawalConfirm(event.target.value)} autoComplete="off" /></label>
              <div className="withdrawal-actions"><button className="danger" type="button" disabled={withdrawalBusy || withdrawalConfirm.trim().toUpperCase() !== "BAJA"} onClick={() => void requestWithdrawal()}>{withdrawalBusy ? "Tramitando…" : "Confirmar baja"}</button><button className="outline" type="button" disabled={withdrawalBusy} onClick={() => setSelectedAthleteId("")}>Cancelar</button></div>
            </div>}
          </div>;
        })}
      </div> : <p>No hay atletas activos que puedas dar de baja desde esta cuenta.</p>}
      {withdrawalNotice && <p className={withdrawalNotice.toLowerCase().includes("no se") ? "error-note" : "success-note"}>{withdrawalNotice}</p>}
    </article>}
    <article className="panel account-delete-card">
      <small>ELIMINACIÓN DE CUENTA</small><h2>Solicitar eliminación</h2>
      <p>Se eliminará el acceso asociado a <b>{email}</b> y se suprimirán o anonimizarán los datos que no debamos conservar por obligación legal. Los justificantes contables, de cobro o federativos que deban conservarse quedarán bloqueados y fuera del uso ordinario.</p>
      <p>Completaremos el proceso como máximo en 30 días y recibirás una confirmación por correo. Esta solicitud no puede utilizarse para cancelar una deuda ya generada.</p>
      {requested ? <p className="success-note">{notice}</p> : <div className="stacked-form account-delete-confirm"><label>Escribe ELIMINAR para confirmar<input value={confirmText} onChange={event => setConfirmText(event.target.value)} autoComplete="off" /></label><button className="danger" type="button" disabled={busy || confirmText.trim().toUpperCase() !== "ELIMINAR"} onClick={() => void requestDeletion()}>{busy ? "Registrando solicitud…" : "Solicitar eliminación de mi cuenta"}</button>{notice && <p className="error-note">{notice}</p>}</div>}
      <a href="/eliminar-cuenta.html" target="_blank" rel="noreferrer">Más información sobre el proceso</a>
    </article>
  </>;
}

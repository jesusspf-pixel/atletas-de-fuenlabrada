import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/clubApi";
import { supabase } from "../lib/supabase";
import FinancialControlCenter from "./FinancialControlCenter";

type RuleSet = {
  monthly_cents: number; term_autumn_cents: number; term_winter_cents: number; term_spring_cents: number;
  full_rate_through_day: number; half_rate_through_day: number; family_discount_members: number;
  monthly_family_discount_percent: number; enrolment_family_discount_percent: number;
};
type Membership = { id: string; season: string; plan: "monthly" | "term"; athletes?: { first_name: string; last_name: string } | null };
type Payer = { id: string; full_name: string | null; email: string | null; phone: string | null };
type Draft = {
  id: string; membership_id: string; payer_profile_id: string | null;
  charge_kind: "enrolment" | "recurring" | "manual"; scheduled_for: string;
  period_starts_on: string | null; period_ends_on: string | null;
  calculated_amount_cents: number; approved_amount_cents: number | null; discount_cents: number; status: string;
  admin_note: string | null; override_reason: string | null; provider_reference: string | null;
  attempt_count: number; last_attempt_at: string | null; next_attempt_at: string | null;
  created_at: string; updated_at: string;
  athletes?: { first_name: string; last_name: string } | null;
  memberships?: { season: string; plan: string } | null;
};
type AutomationRun = { id: string; started_at: string; completed_at: string | null; status: "running" | "completed" | "failed"; processed_count: number; paid_count: number; failed_count: number; error_message: string | null };
type AdminAction = { id: string; draft_id: string; action_type: string; payment_method: string | null; external_reference: string | null; notes: string | null; created_by: string; created_at: string };
type MetricKey = "enrolments" | "fees" | "failed" | "upcoming";
type ManualResolution = { draft: Draft; method: string; reference: string; notes: string };

const euro = (cents: number | null | undefined) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format((cents || 0) / 100);
const field = (value: number) => (value / 100).toFixed(2);
const date = (value: string | null | undefined, includeTime = false) => value
  ? new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleString("es-ES", includeTime ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "medium" })
  : "—";
const amount = (draft: Draft) => draft.approved_amount_cents ?? draft.calculated_amount_cents;
const typeLabel = (draft: Draft) => draft.charge_kind === "enrolment" ? "Matrícula" : draft.charge_kind === "manual" ? "Cargo excepcional" : "Cuota";
const statusLabel = (value: string) => ({
  awaiting_admin: "Pendiente de revisión", approved: "Programada", collecting: "Procesando",
  checkout_pending: "Pago pendiente", paid: "Cobrada", failed: "Impagada",
  waived: "Exenta", cancelled: "Cancelada",
} as Record<string, string>)[value] || value;
const metricMatches = (draft: Draft, key: MetricKey) => {
  if (key === "enrolments") return draft.charge_kind === "enrolment" && draft.status === "paid" && amount(draft) > 0;
  if (key === "fees") return draft.charge_kind === "recurring" && draft.status === "paid";
  if (key === "failed") return ["failed", "checkout_pending"].includes(draft.status);
  return ["awaiting_admin", "approved", "collecting"].includes(draft.status);
};

export default function BillingControlCenter() {
  const [rules, setRules] = useState<RuleSet | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [payers, setPayers] = useState<Record<string, Payer>>({});
  const [adminActions, setAdminActions] = useState<AdminAction[]>([]);
  const [membershipId, setMembershipId] = useState("");
  const [kind, setKind] = useState<"enrolment" | "recurring">("recurring");
  const [scheduledFor, setScheduledFor] = useState(new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [workspace, setWorkspace] = useState<"fees" | "finance">("fees");
  const [automationRun, setAutomationRun] = useState<AutomationRun | null>(null);
  const [metric, setMetric] = useState<MetricKey>("failed");
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [search, setSearch] = useState("");
  const [manualResolution, setManualResolution] = useState<ManualResolution | null>(null);

  const load = async () => {
    const client = supabase; if (!client) return;
    setBusy(true);
    const [rulesResult, membershipsResult, draftsResult, automationResult, payersResult, actionsResult] = await Promise.all([
      client.from("club_billing_rules").select("*").eq("id", true).maybeSingle(),
      client.from("memberships").select("id,season,plan,athletes(first_name,last_name)").order("created_at", { ascending: false }),
      client.from("billing_charge_drafts").select("id,membership_id,payer_profile_id,charge_kind,scheduled_for,period_starts_on,period_ends_on,calculated_amount_cents,approved_amount_cents,discount_cents,status,admin_note,override_reason,provider_reference,attempt_count,last_attempt_at,next_attempt_at,created_at,updated_at,athletes(first_name,last_name),memberships(season,plan)").order("scheduled_for", { ascending: false }),
      client.from("billing_automation_runs").select("id,started_at,completed_at,status,processed_count,paid_count,failed_count,error_message").order("started_at", { ascending: false }).limit(1).maybeSingle(),
      client.from("profiles").select("id,full_name,email,phone"),
      client.from("billing_admin_actions").select("id,draft_id,action_type,payment_method,external_reference,notes,created_by,created_at").order("created_at", { ascending: false }),
    ]);
    if (rulesResult.data) setRules(rulesResult.data as RuleSet);
    setMemberships((membershipsResult.data ?? []) as unknown as Membership[]);
    setDrafts((draftsResult.data ?? []) as unknown as Draft[]);
    setAutomationRun((automationResult.data as AutomationRun | null) ?? null);
    setPayers(Object.fromEntries(((payersResult.data ?? []) as Payer[]).map(profile => [profile.id, profile])));
    setAdminActions((actionsResult.data ?? []) as AdminAction[]);
    setMessage(rulesResult.error?.message || membershipsResult.error?.message || draftsResult.error?.message || payersResult.error?.message || actionsResult.error?.message || "");
    setBusy(false);
  };
  useEffect(() => { void load(); }, []);

  const groups = useMemo(() => ({
    enrolments: drafts.filter(draft => metricMatches(draft, "enrolments")),
    fees: drafts.filter(draft => metricMatches(draft, "fees")),
    failed: drafts.filter(draft => metricMatches(draft, "failed")),
    upcoming: drafts.filter(draft => metricMatches(draft, "upcoming")),
  }), [drafts]);
  const selectedDraft = drafts.find(draft => draft.id === selectedDraftId) || null;
  const selectedActions = adminActions.filter(action => action.draft_id === selectedDraftId);
  const visibleDrafts = groups[metric].filter(draft => {
    const needle = search.trim().toLowerCase(); if (!needle) return true;
    const payer = draft.payer_profile_id ? payers[draft.payer_profile_id] : null;
    return `${draft.athletes?.first_name || ""} ${draft.athletes?.last_name || ""} ${payer?.full_name || ""} ${payer?.email || ""} ${draft.provider_reference || ""}`.toLowerCase().includes(needle);
  });

  const saveRules = async (event: FormEvent) => {
    event.preventDefault(); const client = supabase; if (!client || !rules) return;
    setBusy(true); setMessage("");
    const { error } = await client.from("club_billing_rules").upsert({ id: true, ...rules, updated_at: new Date().toISOString() });
    setBusy(false); setMessage(error ? error.message : "Reglas de cálculo guardadas.");
  };
  const createDraft = async (event: FormEvent) => {
    event.preventDefault(); const client = supabase; if (!client || !membershipId) return;
    setBusy(true); setMessage("");
    const { error } = await client.rpc("create_billing_charge_draft", { target_membership_id: membershipId, target_kind: kind, target_scheduled_for: scheduledFor });
    if (!error) { setMembershipId(""); await load(); } else setBusy(false);
    setMessage(error ? error.message : "Cargo excepcional creado para revisión.");
  };
  const updateDraft = async (draft: Draft, nextStatus: string) => {
    const client = supabase; if (!client) return;
    const finalAmount = Number(window.prompt("Importe final en euros", field(amount(draft))));
    if (!Number.isFinite(finalAmount) || finalAmount < 0) return;
    const reason = window.prompt("Motivo del ajuste o de la decisión", draft.override_reason || draft.admin_note || "") ?? "";
    if (Math.round(finalAmount * 100) !== draft.calculated_amount_cents && !reason.trim()) return setMessage("Indica el motivo del ajuste para conservar la trazabilidad.");
    setBusy(true); setMessage("");
    const { error } = await client.from("billing_charge_drafts").update({ approved_amount_cents: Math.round(finalAmount * 100), status: nextStatus, override_reason: reason.trim() || null, admin_note: reason.trim() || draft.admin_note }).eq("id", draft.id);
    if (!error) await load(); else { setBusy(false); setMessage(error.message); }
  };
  const retryDraft = async (draft: Draft) => {
    if (!supabase || !window.confirm(`Se intentará cobrar ahora ${euro(amount(draft))} mediante Stripe. ¿Continuar?`)) return;
    setBusy(true); setMessage("");
    const { data: { session } } = await supabase.auth.getSession();
    const response = await apiFetch("/api/collect-approved-charge", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token || ""}` }, body: JSON.stringify({ draftId: draft.id }) });
    const result = await response.json().catch(() => ({})) as { error?: string };
    setMessage(response.ok ? "Cobro realizado correctamente y cuota regularizada." : result.error || "No se pudo completar el cobro.");
    await load();
  };
  const sendReminder = async (draft: Draft) => {
    if (!supabase || !window.confirm("Se enviará un email y un aviso en la app al responsable de pago. ¿Continuar?")) return;
    setBusy(true); setMessage("");
    const { data: announcementId, error } = await supabase.rpc("create_billing_manual_reminder", { target_draft_id: draft.id });
    if (error || !announcementId) { setMessage(error?.message || "No se pudo preparar el recordatorio."); setBusy(false); return; }
    const { data: { session } } = await supabase.auth.getSession();
    const response = await apiFetch("/api/send-event-notification", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token || ""}` }, body: JSON.stringify({ announcementId }) });
    setMessage(response.ok ? "Recordatorio enviado por email y guardado en la app." : "El aviso aparece en la app y el email queda pendiente de reintento.");
    setBusy(false);
  };
  const resolveManually = async (event: FormEvent) => {
    event.preventDefault(); if (!supabase || !manualResolution) return;
    if (!manualResolution.reference.trim()) return setMessage("Indica una referencia, número de recibo o justificante.");
    if (!window.confirm(`Se marcará como pagado ${euro(amount(manualResolution.draft))} por otro medio. Esta acción queda registrada. ¿Continuar?`)) return;
    setBusy(true); setMessage("");
    const { error } = await supabase.rpc("resolve_billing_charge_manually", { target_draft_id: manualResolution.draft.id, target_payment_method: manualResolution.method, target_reference: manualResolution.reference.trim(), target_notes: manualResolution.notes.trim() || null });
    if (error) { setMessage(error.message); setBusy(false); return; }
    setManualResolution(null); setSelectedDraftId(""); setMessage("Pago externo registrado y cuota regularizada con trazabilidad."); await load();
  };

  const metricCard = (key: MetricKey, label: string, hint: string) => {
    const items = groups[key]; const total = items.reduce((sum, draft) => sum + amount(draft), 0);
    return <button type="button" className={`billing-kpi ${key} ${metric === key ? "selected" : ""}`} onClick={() => { setMetric(key); setSelectedDraftId(""); }}><small>{label}</small><b>{items.length}</b><strong>{euro(total)}</strong><span>{hint} →</span></button>;
  };
  const actions = (draft: Draft) => <div className="billing-actions">
    {["failed", "checkout_pending"].includes(draft.status) && <><button disabled={busy} onClick={() => void sendReminder(draft)}>Enviar aviso</button><button className="outline" disabled={busy} onClick={() => void retryDraft(draft)}>Reintentar cobro</button><button className="outline" disabled={busy} onClick={() => setManualResolution({ draft, method: "bank_transfer", reference: "", notes: "" })}>Resolver por otro medio</button></>}
    {draft.status === "awaiting_admin" && <><button disabled={busy} onClick={() => void updateDraft(draft, "approved")}>Revisar y aprobar</button><button className="outline" disabled={busy} onClick={() => void updateDraft(draft, "waived")}>Eximir</button></>}
    {draft.status === "approved" && <><button className="outline" disabled={busy} onClick={() => void updateDraft(draft, "approved")}>Modificar</button><button className="outline" disabled={busy} onClick={() => void updateDraft(draft, "cancelled")}>Cancelar</button></>}
    {draft.status === "collecting" && <small>Stripe está procesando el cobro; las acciones están bloqueadas para evitar duplicados.</small>}
    {draft.status === "paid" && <small>Operación conciliada.</small>}
  </div>;

  if (!rules) return <section className="panel"><h2>Cuotas y cobros</h2><p>{busy ? "Cargando centro de control…" : message || "No se pudo cargar la configuración de cobros."}</p></section>;

  return <section className="billing-control">
    <div className="page-head"><div><small>ADMINISTRACIÓN</small><h1>{workspace === "fees" ? "Contabilidad y cobros" : "Control financiero del club"}</h1><p>{workspace === "fees" ? "Consulta cada operación y resuelve incidencias desde un único panel." : "Ingresos, subvenciones, ventas, gastos, previsiones y resultado real en un único lugar."}</p></div><button className="outline" disabled={busy} onClick={() => void load()}>{busy ? "Actualizando…" : "Actualizar"}</button></div>
    <nav className="billing-workspace-tabs"><button className={workspace === "fees" ? "selected" : ""} onClick={() => setWorkspace("fees")}>Resumen de cobros</button><button className={workspace === "finance" ? "selected" : ""} onClick={() => setWorkspace("finance")}>Ingresos y gastos</button></nav>
    {workspace === "finance" ? <FinancialControlCenter drafts={drafts} /> : <>
      <section className={`billing-automation-status ${automationRun?.status === "failed" ? "has-error" : ""}`}><header><div><small>COBROS AUTOMÁTICOS</small><h2>{automationRun?.status === "failed" ? "Necesita revisión" : "Sistema operativo"}</h2><p>Comprobación horaria · último control {automationRun ? date(automationRun.started_at, true) : "pendiente"}</p></div><span>{automationRun?.status === "failed" ? "Incidencia" : "Activo"}</span></header>{automationRun?.error_message && <aside>{automationRun.error_message}</aside>}</section>
      <section className="billing-kpi-grid">{metricCard("enrolments", "Matrículas cobradas", "Abrir matrículas")}{metricCard("fees", "Cuotas cobradas", "Abrir cuotas")}{metricCard("failed", "Cuotas impagadas", "Gestionar incidencias")}{metricCard("upcoming", "Próximos cobros", "Ver calendario")}</section>
      {message && <p className={message.includes("correctamente") || message.includes("enviado") || message.includes("regularizada") || message.includes("guardadas") || message.includes("creado") ? "success-note panel" : "error-note panel"}>{message}</p>}
      <section className="panel billing-operations">
        <header><div><small>OPERACIONES</small><h2>{({ enrolments: "Matrículas cobradas", fees: "Cuotas cobradas", failed: "Cuotas impagadas", upcoming: "Próximos cobros" } as Record<MetricKey, string>)[metric]}</h2><p>{visibleDrafts.length} operaciones · {euro(visibleDrafts.reduce((sum, draft) => sum + amount(draft), 0))}</p></div><label>Buscar<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Atleta, responsable o referencia" /></label></header>
        <div className="billing-operation-head"><span>Atleta y concepto</span><span>Fecha</span><span>Estado</span><span>Importe</span><span /></div>
        {visibleDrafts.map(draft => <button type="button" className={`billing-operation-row status-${draft.status}`} key={draft.id} onClick={() => setSelectedDraftId(draft.id)}><span><b>{draft.athletes?.first_name} {draft.athletes?.last_name}</b><small>{typeLabel(draft)} · {draft.memberships?.plan === "monthly" ? "Mensual" : "Trimestral"}</small></span><span>{date(draft.scheduled_for)}</span><span><i />{statusLabel(draft.status)}</span><strong>{euro(amount(draft))}</strong><em>Ver operación →</em></button>)}
        {!visibleDrafts.length && <div className="billing-empty-state"><b>No hay operaciones en este apartado</b><p>Cambia de tarjeta o modifica la búsqueda.</p></div>}
      </section>
      {selectedDraft && <section className="billing-detail panel">
        <header><div><small>DETALLE DE LA OPERACIÓN</small><h2>{typeLabel(selectedDraft)} · {selectedDraft.athletes?.first_name} {selectedDraft.athletes?.last_name}</h2></div><button className="outline" onClick={() => setSelectedDraftId("")}>Cerrar</button></header>
        <div className="billing-detail-grid"><article><small>Importe final</small><b>{euro(amount(selectedDraft))}</b><span>Calculado {euro(selectedDraft.calculated_amount_cents)}{selectedDraft.discount_cents ? ` · descuento ${euro(selectedDraft.discount_cents)}` : ""}</span></article><article><small>Estado</small><b>{statusLabel(selectedDraft.status)}</b><span>Actualizado {date(selectedDraft.updated_at, true)}</span></article><article><small>Fecha prevista</small><b>{date(selectedDraft.scheduled_for)}</b><span>Periodo {date(selectedDraft.period_starts_on)} — {date(selectedDraft.period_ends_on)}</span></article><article><small>Responsable del pago</small><b>{selectedDraft.payer_profile_id ? payers[selectedDraft.payer_profile_id]?.full_name || "Responsable familiar" : "Sin responsable"}</b><span>{selectedDraft.payer_profile_id ? payers[selectedDraft.payer_profile_id]?.email || "Sin email" : "—"}</span><span>{selectedDraft.payer_profile_id ? payers[selectedDraft.payer_profile_id]?.phone || "Sin teléfono" : ""}</span></article><article><small>Intentos de cobro</small><b>{selectedDraft.attempt_count || 0}</b><span>Último: {date(selectedDraft.last_attempt_at, true)}</span><span>Próximo: {date(selectedDraft.next_attempt_at, true)}</span></article><article><small>Referencia</small><b className="billing-reference">{selectedDraft.provider_reference || "Sin referencia"}</b><span>Creada {date(selectedDraft.created_at, true)}</span></article></div>
        {(selectedDraft.admin_note || selectedDraft.override_reason) && <aside><b>Notas de administración</b><p>{selectedDraft.admin_note || selectedDraft.override_reason}</p></aside>}
        {selectedActions.length > 0 && <section className="billing-action-history"><small>HISTORIAL DE GESTIÓN</small>{selectedActions.map(action => <article key={action.id}><div><b>{action.action_type === "reminder_sent" ? "Aviso enviado" : action.action_type === "manual_payment" ? "Pago externo conciliado" : statusLabel(action.action_type)}</b><span>{date(action.created_at, true)} · {payers[action.created_by]?.full_name || "Administración"}</span></div><p>{[action.payment_method, action.external_reference, action.notes].filter(Boolean).join(" · ") || "Acción registrada sin observaciones."}</p></article>)}</section>}
        {actions(selectedDraft)}
      </section>}
      <details className="panel billing-settings"><summary>Configuración y cargos excepcionales</summary><section className="two-columns">
        <form className="stacked-form" onSubmit={saveRules}><h2>Reglas de cálculo</h2><label>Cuota mensual (€)<input type="number" min="0" step="0.01" value={field(rules.monthly_cents)} onChange={e => setRules({ ...rules, monthly_cents: Math.round(Number(e.target.value || 0) * 100) })} /></label><label>Septiembre–noviembre (€)<input type="number" min="0" step="0.01" value={field(rules.term_autumn_cents)} onChange={e => setRules({ ...rules, term_autumn_cents: Math.round(Number(e.target.value || 0) * 100) })} /></label><label>Diciembre–febrero (€)<input type="number" min="0" step="0.01" value={field(rules.term_winter_cents)} onChange={e => setRules({ ...rules, term_winter_cents: Math.round(Number(e.target.value || 0) * 100) })} /></label><label>Marzo–junio (€)<input type="number" min="0" step="0.01" value={field(rules.term_spring_cents)} onChange={e => setRules({ ...rules, term_spring_cents: Math.round(Number(e.target.value || 0) * 100) })} /></label><label>Cuota completa hasta el día<input type="number" min="1" max="28" value={rules.full_rate_through_day} onChange={e => setRules({ ...rules, full_rate_through_day: Number(e.target.value) })} /></label><label>Media cuota hasta el día<input type="number" min="1" max="28" value={rules.half_rate_through_day} onChange={e => setRules({ ...rules, half_rate_through_day: Number(e.target.value) })} /></label><label>Descuento familiar desde atletas activos<input type="number" min="1" value={rules.family_discount_members} onChange={e => setRules({ ...rules, family_discount_members: Number(e.target.value) })} /></label><label>Descuento mensual familiar (%)<input type="number" min="0" max="100" value={rules.monthly_family_discount_percent} onChange={e => setRules({ ...rules, monthly_family_discount_percent: Number(e.target.value) })} /></label><label>Descuento matrícula familiar (%)<input type="number" min="0" max="100" value={rules.enrolment_family_discount_percent} onChange={e => setRules({ ...rules, enrolment_family_discount_percent: Number(e.target.value) })} /></label><button disabled={busy}>Guardar reglas</button></form>
        <form className="stacked-form" onSubmit={createDraft}><h2>Cargo excepcional</h2><p>Para ajustes extraordinarios; las altas normales se programan automáticamente.</p><label>Atleta y cuota<select required value={membershipId} onChange={e => setMembershipId(e.target.value)}><option value="">Selecciona una cuota</option>{memberships.map(m => <option key={m.id} value={m.id}>{m.athletes?.first_name} {m.athletes?.last_name} · {m.plan === "monthly" ? "Mensual" : "Trimestral"} · {m.season}</option>)}</select></label><label>Concepto<select value={kind} onChange={e => setKind(e.target.value as "enrolment" | "recurring")}><option value="recurring">Cuota</option><option value="enrolment">Matrícula</option></select></label><label>Fecha prevista<input type="date" value={scheduledFor} onChange={e => setScheduledFor(e.target.value)} /></label><button disabled={busy || !membershipId}>Crear cargo excepcional</button></form>
      </section></details>
      {manualResolution && <div className="billing-modal-backdrop"><form className="billing-modal" onSubmit={resolveManually}><header><div><small>RESOLVER IMPAGO</small><h2>Registrar pago recibido</h2><p>{manualResolution.draft.athletes?.first_name} {manualResolution.draft.athletes?.last_name} · {euro(amount(manualResolution.draft))}</p></div><button type="button" className="outline" onClick={() => setManualResolution(null)}>Cerrar</button></header><label>Método de pago<select value={manualResolution.method} onChange={event => setManualResolution({ ...manualResolution, method: event.target.value })}><option value="bank_transfer">Transferencia bancaria</option><option value="cash">Efectivo</option><option value="card">Tarjeta fuera de la app</option><option value="direct_debit">Domiciliación</option><option value="other">Otro</option></select></label><label>Referencia o justificante<input required value={manualResolution.reference} onChange={event => setManualResolution({ ...manualResolution, reference: event.target.value })} placeholder="Ej. transferencia 13/09 o recibo 0042" /></label><label>Observaciones<textarea value={manualResolution.notes} onChange={event => setManualResolution({ ...manualResolution, notes: event.target.value })} placeholder="Información útil para la conciliación" /></label><aside>Esta acción marcará la operación como cobrada y quedará registrada con tu usuario, fecha, método y referencia.</aside><button disabled={busy}>{busy ? "Guardando…" : "Confirmar pago y resolver"}</button></form></div>}
    </>}
  </section>;
}

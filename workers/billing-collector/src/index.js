const H={"content-type":"application/json",accept:"application/json"};
const EXPECTED_STRIPE_ACCOUNT_ID="acct_1U7GSS4qEOpF73r5";
const required=(env,name)=>{const value=String(env[name]||"").trim();if(!value)throw new Error(`Falta la configuración ${name}`);return value};
const supabaseBase=(env)=>required(env,"SUPABASE_URL").replace(/\/+$/,"").replace(/\/(?:rest|auth)\/v1$/i,"");
const db=(env,path,init={})=>{const base=supabaseBase(env);const key=required(env,"SUPABASE_SERVICE_ROLE_KEY");return fetch(`${base}${path}`,{...init,headers:{apikey:key,authorization:`Bearer ${key}`,...H,...(init.headers||{})}})};
const stripe=async(env,path,params,idempotencyKey)=>{const response=await fetch(`https://api.stripe.com/v1/${path}`,{method:"POST",headers:{authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,"content-type":"application/x-www-form-urlencoded","Idempotency-Key":idempotencyKey},body:params});return{response,data:await response.json().catch(()=>({}))}};
const safe=value=>String(value||"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[char]);
const trackEmailDelivery=async(env,announcementId,status,error="")=>{
  if(!announcementId)return;
  const response=await db(env,`/rest/v1/announcement_deliveries?announcement_id=eq.${announcementId}&channel=eq.email`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({delivery_status:status,last_error:error?error.slice(0,500):null,updated_at:new Date().toISOString()})});
  if(!response.ok)console.error(JSON.stringify({event:"billing_email_tracking_failed",announcementId,status,httpStatus:response.status}));
};
const failureRecipients=async(env,charge)=>{
  const response=await db(env,"/rest/v1/rpc/billing_failure_notification_recipients",{method:"POST",body:JSON.stringify({target_draft_id:charge.id,target_attempt_number:charge.attempt_number})});
  const rows=await response.json().catch(()=>[]);
  if(!response.ok)throw new Error(`No se pudieron resolver los destinatarios del impago (${response.status}).`);
  return rows;
};
const sendFailureEmails=async(env,charge,reason,final)=>{
  let recipients=[];
  try{recipients=await failureRecipients(env,charge)}catch(error){console.error(JSON.stringify({event:"billing_email_recipients_failed",draftId:charge.id,attempt:charge.attempt_number,error:error instanceof Error?error.message:String(error)}));return false}
  const announcementId=recipients[0]?.announcement_id||"";
  if(!recipients.length)return true;
  if(!env.RESEND_API_KEY){await trackEmailDelivery(env,announcementId,"failed","RESEND_API_KEY no está configurada en el cobrador automático.");console.error(JSON.stringify({event:"billing_email_not_configured",draftId:charge.id,attempt:charge.attempt_number}));return false}
  const familySubject=final?"Cuota pendiente: contacta con el club":`No hemos podido cobrar tu cuota · intento ${charge.attempt_number}`;
  const adminSubject=final?"Baja por falta de pago":`Pago rechazado · intento ${charge.attempt_number}`;
  const familyBody=final?`<p>No ha sido posible cobrar la cuota pendiente de <strong>${safe(charge.athlete_first_name)} ${safe(charge.athlete_last_name)}</strong>.</p><p>Para regularizar la situación, revisa la tarjeta o contacta con el club en el 613 05 00 00.</p>`:`<p>No hemos podido cobrar la cuota de <strong>${safe(charge.athlete_first_name)} ${safe(charge.athlete_last_name)}</strong>.</p><p>Revisa la tarjeta o el saldo. Volveremos a intentarlo dentro de 24 horas.</p>`;
  const messages=recipients.map(recipient=>({from:"Club Atletas de Fuenlabrada <info@atletasdefuenlabrada.com>",reply_to:"info@atletasdefuenlabrada.com",to:[recipient.email],subject:recipient.is_admin?`${adminSubject} · ${charge.athlete_first_name} ${charge.athlete_last_name}`:familySubject,text:recipient.is_admin?`Ha fallado el cobro de ${charge.athlete_first_name} ${charge.athlete_last_name}. Motivo: ${reason}`:`No hemos podido cobrar la cuota de ${charge.athlete_first_name} ${charge.athlete_last_name}. Revisa la tarjeta o el saldo.` ,html:recipient.is_admin?`<p>Ha fallado el cobro de <strong>${safe(charge.athlete_first_name)} ${safe(charge.athlete_last_name)}</strong>.</p><p>Motivo: ${safe(reason)}</p>${familyBody}`:familyBody}));
  const idempotencyKey=`billing-failure/${charge.id}/${charge.attempt_number}`;
  let lastError="";
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const response=await fetch("https://api.resend.com/emails/batch",{method:"POST",headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,...H,"Idempotency-Key":idempotencyKey},body:JSON.stringify(messages)});
      if(response.ok){await trackEmailDelivery(env,announcementId,"sent");console.log(JSON.stringify({event:"billing_email_sent",draftId:charge.id,attempt:charge.attempt_number,recipients:messages.length}));return true}
      const detail=await response.json().catch(()=>({}));lastError=detail?.message||`Resend respondió ${response.status}`;
      if(response.status<500&&response.status!==429)break;
    }catch(error){lastError=error instanceof Error?error.message:String(error)}
  }
  await trackEmailDelivery(env,announcementId,"failed",lastError||"El proveedor de correo no aceptó el envío.");
  console.error(JSON.stringify({event:"billing_email_failed",draftId:charge.id,attempt:charge.attempt_number,error:lastError}));
  return false;
};
const patch=(env,id,body)=>db(env,`/rest/v1/billing_charge_drafts?id=eq.${id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({...body,updated_at:new Date().toISOString()})});
const startRun=async(env)=>{const response=await db(env,"/rest/v1/billing_automation_runs",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({status:"running",trigger_source:"scheduled"})});const rows=await response.json().catch(()=>[]);return response.ok?rows?.[0]?.id||"":""};
const finishRun=async(env,id,body)=>{if(!id)return;await db(env,`/rest/v1/billing_automation_runs?id=eq.${id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({...body,completed_at:new Date().toISOString()})})};
async function run(env){
  required(env,"SUPABASE_URL");required(env,"SUPABASE_SERVICE_ROLE_KEY");required(env,"STRIPE_SECRET_KEY");
  const runId=await startRun(env);let paid=0,failed=0,processed=0;
  try{
    const accountResponse=await fetch("https://api.stripe.com/v1/account",{headers:{authorization:`Bearer ${env.STRIPE_SECRET_KEY}`}});const account=await accountResponse.json().catch(()=>({}));if(!accountResponse.ok)throw new Error(`La clave de Stripe no es válida para el cobrador (${accountResponse.status}).`);if(account.id!==EXPECTED_STRIPE_ACCOUNT_ID)throw new Error(`La clave del cobrador pertenece a otra cuenta de Stripe (${account.id||"desconocida"}).`);
    // Keep each run below the Workers Free external-subrequest limit. A charge
    // touches Supabase and Stripe several times, so claiming 100 up front can
    // strand most of the batch in `collecting` when the invocation is stopped.
    const claim=await db(env,"/rest/v1/rpc/claim_due_billing_charges",{method:"POST",body:JSON.stringify({batch_limit:4})});
    const charges=await claim.json().catch(()=>[]);if(!claim.ok)throw new Error(`No se pudieron reclamar los cobros pendientes (${claim.status}): ${JSON.stringify(charges).slice(0,800)}`);processed=charges.length;
  for(const charge of charges){
    const customers=await db(env,`/rest/v1/stripe_customers?profile_id=eq.${charge.payer_profile_id}&select=stripe_customer_id`);const customer=(await customers.json().catch(()=>[]))?.[0]?.stripe_customer_id;
    let method="",reason="No hay una tarjeta válida guardada en Stripe.";
    if(customer){const auth={authorization:`Bearer ${env.STRIPE_SECRET_KEY}`};const response=await fetch(`https://api.stripe.com/v1/customers/${customer}`,{headers:auth});const data=await response.json().catch(()=>({}));method=data.invoice_settings?.default_payment_method||"";if(!method){const methodsResponse=await fetch(`https://api.stripe.com/v1/payment_methods?customer=${encodeURIComponent(customer)}&type=card&limit=1`,{headers:auth});const methods=await methodsResponse.json().catch(()=>({}));method=methodsResponse.ok&&Array.isArray(methods.data)?methods.data[0]?.id||"":""}}
    if(customer&&method){const amount=charge.approved_amount_cents??charge.calculated_amount_cents;const params=new URLSearchParams({amount:String(amount),currency:"eur",customer,payment_method:method,confirm:"true",off_session:"true",description:`Cuota · ${charge.athlete_first_name} ${charge.athlete_last_name}`,"metadata[billing_charge_draft_id]":charge.id,"metadata[membership_id]":charge.membership_id});const result=await stripe(env,"payment_intents",params,`club-charge-${charge.id}-${charge.attempt_number}`);if(result.response.ok&&result.data.status==="succeeded"){await patch(env,charge.id,{status:"paid",provider_reference:result.data.id,admin_note:null,next_attempt_at:null});await db(env,`/rest/v1/memberships?id=eq.${charge.membership_id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({billing_status:"active",access_suspended_at:null,suspension_reason:null,billing_updated_at:new Date().toISOString()})});await db(env,`/rest/v1/athletes?id=eq.${charge.athlete_id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({club_status:"active"})});paid++;continue}reason=result.data?.error?.message||"El banco ha rechazado la cuota."}
    const final=Boolean(charge.is_final_attempt);const next=final?null:new Date(Date.now()+86400000).toISOString();await patch(env,charge.id,{status:"failed",admin_note:reason.slice(0,500),next_attempt_at:next});
    await sendFailureEmails(env,charge,reason,final);
    if(final)await db(env,"/rest/v1/rpc/suspend_membership_for_nonpayment",{method:"POST",body:JSON.stringify({target_membership_id:charge.membership_id})});failed++;
  }
    const summary={processed,paid,failed};await finishRun(env,runId,{status:"completed",processed_count:processed,paid_count:paid,failed_count:failed,error_message:null});console.log(JSON.stringify({event:"automatic_billing_completed",...summary}));return summary;
  }catch(error){const message=error instanceof Error?error.message:String(error);await finishRun(env,runId,{status:"failed",processed_count:processed,paid_count:paid,failed_count:failed,error_message:message.slice(0,1000)});throw error}
}
export default{async fetch(request,env){if(new URL(request.url).pathname==="/health"){try{const response=await fetch("https://api.stripe.com/v1/account",{headers:{authorization:`Bearer ${required(env,"STRIPE_SECRET_KEY")}`}});const account=await response.json().catch(()=>({}));const stripeReady=response.ok&&account.id===EXPECTED_STRIPE_ACCOUNT_ID;return new Response(JSON.stringify({ok:stripeReady,service:"club-atletas-billing-collector",stripeReady}),{status:stripeReady?200:503,headers:H})}catch{return new Response(JSON.stringify({ok:false,service:"club-atletas-billing-collector",stripeReady:false}),{status:503,headers:H})}}return new Response("Not found",{status:404})},async scheduled(event,env,ctx){ctx.waitUntil(run(env).catch(error=>{console.error("Automatic billing run failed",error instanceof Error?error.message:String(error));throw error}))}};

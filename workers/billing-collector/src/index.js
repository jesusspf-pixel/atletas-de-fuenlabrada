const H={"content-type":"application/json",accept:"application/json"};
const EXPECTED_STRIPE_ACCOUNT_ID="acct_1U7GSS4qEOpF73r5";
const required=(env,name)=>{const value=String(env[name]||"").trim();if(!value)throw new Error(`Falta la configuración ${name}`);return value};
const supabaseBase=(env)=>required(env,"SUPABASE_URL").replace(/\/+$/,"").replace(/\/(?:rest|auth)\/v1$/i,"");
const db=(env,path,init={})=>{const base=supabaseBase(env);const key=required(env,"SUPABASE_SERVICE_ROLE_KEY");return fetch(`${base}${path}`,{...init,headers:{apikey:key,authorization:`Bearer ${key}`,...H,...(init.headers||{})}})};
const stripe=async(env,path,params,idempotencyKey)=>{const response=await fetch(`https://api.stripe.com/v1/${path}`,{method:"POST",headers:{authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,"content-type":"application/x-www-form-urlencoded","Idempotency-Key":idempotencyKey},body:params});return{response,data:await response.json().catch(()=>({}))}};
const safe=value=>String(value||"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[char]);
const sendEmailBatch=async(env,messages,idempotencyKey)=>{
  if(env.RESEND_API_KEY)return fetch("https://api.resend.com/emails/batch",{method:"POST",headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,...H,"Idempotency-Key":idempotencyKey},body:JSON.stringify(messages)});
  const key=required(env,"SUPABASE_SERVICE_ROLE_KEY");
  return fetch("https://atletasdefuenlabrada.com/api/internal-notification-batch",{method:"POST",headers:{authorization:`Bearer ${key}`,...H,"Idempotency-Key":idempotencyKey},body:JSON.stringify({messages:messages.map(message=>({to:message.to?.[0]||"",subject:message.subject,text:message.text,html:message.html}))})});
};
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
  const familySubject=final?"Cuota pendiente: contacta con el club":`No hemos podido cobrar tu cuota · intento ${charge.attempt_number}`;
  const adminSubject=final?"Baja por falta de pago":`Pago rechazado · intento ${charge.attempt_number}`;
  const familyBody=final?`<p>No ha sido posible cobrar la cuota pendiente de <strong>${safe(charge.athlete_first_name)} ${safe(charge.athlete_last_name)}</strong>.</p><p>Para regularizar la situación, revisa la tarjeta o contacta con el club en el 613 05 00 00.</p>`:`<p>No hemos podido cobrar la cuota de <strong>${safe(charge.athlete_first_name)} ${safe(charge.athlete_last_name)}</strong>.</p><p>Revisa la tarjeta o el saldo. Volveremos a intentarlo dentro de 24 horas.</p>`;
  const messages=recipients.map(recipient=>({from:"Club Atletas de Fuenlabrada <info@atletasdefuenlabrada.com>",reply_to:"info@atletasdefuenlabrada.com",to:[recipient.email],subject:recipient.is_admin?`${adminSubject} · ${charge.athlete_first_name} ${charge.athlete_last_name}`:familySubject,text:recipient.is_admin?`Ha fallado el cobro de ${charge.athlete_first_name} ${charge.athlete_last_name}. Motivo: ${reason}`:`No hemos podido cobrar la cuota de ${charge.athlete_first_name} ${charge.athlete_last_name}. Revisa la tarjeta o el saldo.` ,html:recipient.is_admin?`<p>Ha fallado el cobro de <strong>${safe(charge.athlete_first_name)} ${safe(charge.athlete_last_name)}</strong>.</p><p>Motivo: ${safe(reason)}</p>${familyBody}`:familyBody}));
  const idempotencyKey=`billing-failure/${charge.id}/${charge.attempt_number}`;
  let lastError="";
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const response=await sendEmailBatch(env,messages,idempotencyKey);
      if(response.ok){await trackEmailDelivery(env,announcementId,"sent");console.log(JSON.stringify({event:"billing_email_sent",draftId:charge.id,attempt:charge.attempt_number,recipients:messages.length}));return true}
      const detail=await response.json().catch(()=>({}));lastError=detail?.message||`Resend respondió ${response.status}`;
      if(response.status<500&&response.status!==429)break;
    }catch(error){lastError=error instanceof Error?error.message:String(error)}
  }
  await trackEmailDelivery(env,announcementId,"failed",lastError||"El proveedor de correo no aceptó el envío.");
  console.error(JSON.stringify({event:"billing_email_failed",draftId:charge.id,attempt:charge.attempt_number,error:lastError}));
  return false;
};
const finishBillingFailureEmails=async(env,rows,status,error="")=>{
  if(!rows.length)return;
  const claimed=rows.map(row=>({announcement_id:row.announcement_id,recipient_profile_id:row.recipient_profile_id}));
  const response=await db(env,"/rest/v1/rpc/complete_billing_failure_emails",{method:"POST",body:JSON.stringify({claimed_deliveries:claimed,final_status:status,failure_detail:error||null})});
  if(!response.ok)console.error(JSON.stringify({event:"billing_email_queue_tracking_failed",status,httpStatus:response.status}));
};
const queuedFailureMessages=rows=>{
  const sample=rows[0];
  const final=Boolean(sample.is_final_attempt);
  const name=`${sample.athlete_first_name} ${sample.athlete_last_name}`.trim();
  const familySubject=final?"Cuota pendiente: contacta con el club":`No hemos podido cobrar tu cuota · intento ${sample.attempt_number}`;
  const adminSubject=final?"Baja por falta de pago":`Pago rechazado · intento ${sample.attempt_number}`;
  const familyBody=final?`<p>No ha sido posible cobrar la cuota pendiente de <strong>${safe(name)}</strong>.</p><p>Para regularizar la situación, revisa la tarjeta o contacta con el club en el 613 05 00 00.</p>`:`<p>No hemos podido cobrar la cuota de <strong>${safe(name)}</strong>.</p><p>Revisa la tarjeta o el saldo. Volveremos a intentarlo dentro de 24 horas.</p>`;
  return rows.map(row=>({from:"Club Atletas de Fuenlabrada <info@atletasdefuenlabrada.com>",reply_to:"info@atletasdefuenlabrada.com",to:[row.email],subject:row.is_admin?`${adminSubject} · ${name}`:familySubject,text:row.is_admin?`Ha fallado el cobro de ${name}. Motivo: ${sample.reason}`:`No hemos podido cobrar la cuota de ${name}. Revisa la tarjeta o el saldo.`,html:row.is_admin?`<p>Ha fallado el cobro de <strong>${safe(name)}</strong>.</p><p>Motivo: ${safe(sample.reason)}</p>${familyBody}`:familyBody}));
};
const sendQueuedBillingFailureEmails=async(env)=>{
  const response=await db(env,"/rest/v1/rpc/claim_billing_failure_emails",{method:"POST",body:JSON.stringify({batch_limit:2})});
  const rows=await response.json().catch(()=>[]);
  if(!response.ok)throw new Error(`No se pudieron reclamar los correos de impagos (${response.status}).`);
  if(!rows.length)return 0;
  const groups=new Map();
  for(const row of rows){const current=groups.get(row.announcement_id)||[];current.push(row);groups.set(row.announcement_id,current)}
  let sentCount=0;
  for(const group of groups.values()){
    const sample=group[0];
    try{
      const sent=await sendEmailBatch(env,queuedFailureMessages(group),`billing-failure/${sample.draft_id}/${sample.attempt_number}`);
      if(!sent.ok){const detail=await sent.json().catch(()=>({}));const message=detail?.message||`Resend respondió ${sent.status}`;await finishBillingFailureEmails(env,group,"failed",message);throw new Error(message)}
      await finishBillingFailureEmails(env,group,"sent");
      sentCount+=group.length;
      console.log(JSON.stringify({event:"billing_email_queue_sent",draftId:sample.draft_id,attempt:sample.attempt_number,recipients:group.length}));
    }catch(error){const message=error instanceof Error?error.message:String(error);await finishBillingFailureEmails(env,group,"failed",message);console.error(JSON.stringify({event:"billing_email_queue_failed",draftId:sample.draft_id,error:message}))}
  }
  return sentCount;
};
const finishRegistrationEmails=async(env,rows,status,error="")=>{
  if(!rows.length)return;
  const claimed=rows.map(row=>({announcement_id:row.announcement_id,recipient_profile_id:row.recipient_profile_id}));
  const response=await db(env,"/rest/v1/rpc/complete_registration_lifecycle_emails",{method:"POST",body:JSON.stringify({claimed_deliveries:claimed,final_status:status,failure_detail:error||null})});
  if(!response.ok)console.error(JSON.stringify({event:"registration_email_tracking_failed",status,httpStatus:response.status}));
};
const registrationEmailHtml=row=>`<div style="font-family:Arial,sans-serif;line-height:1.55;color:#152235;max-width:620px;margin:auto"><div style="background:#092f61;color:#fff;padding:22px 26px"><strong style="font-size:21px">Club Atletas de Fuenlabrada</strong></div><div style="padding:26px;border:1px solid #dfe7f0;border-top:0"><h1 style="font-size:24px;margin:0 0 18px">${safe(row.subject)}</h1><p>${safe(row.body)}</p><p style="margin-top:24px"><a href="https://atletasdefuenlabrada.com/?access=1" style="background:#0b5ccc;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;display:inline-block">Acceder a la aplicación</a></p><p style="color:#66758a;font-size:13px;margin-top:28px">Si necesitas ayuda, responde a este correo.</p></div></div>`;
const sendRegistrationLifecycleEmails=async(env)=>{
  const response=await db(env,"/rest/v1/rpc/claim_registration_lifecycle_emails",{method:"POST",body:JSON.stringify({batch_limit:40})});
  const rows=await response.json().catch(()=>[]);
  if(!response.ok)throw new Error(`No se pudieron reclamar los correos de inscripción (${response.status}).`);
  if(!rows.length)return 0;
  const messages=rows.map(row=>({from:"Club Atletas de Fuenlabrada <info@atletasdefuenlabrada.com>",reply_to:"info@atletasdefuenlabrada.com",to:[row.email],subject:row.subject,text:row.body,html:registrationEmailHtml(row)}));
  const keySource=rows.map(row=>`${row.announcement_id}:${row.recipient_profile_id}`).sort().join("|");
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(keySource));
  const idempotencyKey=`registration-lifecycle/${Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,"0")).join("").slice(0,48)}`;
  try{
    const sent=await sendEmailBatch(env,messages,idempotencyKey);
    if(!sent.ok){const detail=await sent.json().catch(()=>({}));const message=detail?.message||`Resend respondió ${sent.status}`;await finishRegistrationEmails(env,rows,"failed",message);throw new Error(message)}
    await finishRegistrationEmails(env,rows,"sent");
    console.log(JSON.stringify({event:"registration_emails_sent",recipients:rows.length}));
    return rows.length;
  }catch(error){const message=error instanceof Error?error.message:String(error);await finishRegistrationEmails(env,rows,"failed",message);throw error}
};
const patch=(env,id,body)=>db(env,`/rest/v1/billing_charge_drafts?id=eq.${id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({...body,updated_at:new Date().toISOString()})});
const startRun=async(env)=>{const response=await db(env,"/rest/v1/billing_automation_runs",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({status:"running",trigger_source:"scheduled"})});const rows=await response.json().catch(()=>[]);return response.ok?rows?.[0]?.id||"":""};
const finishRun=async(env,id,body)=>{if(!id)return;await db(env,`/rest/v1/billing_automation_runs?id=eq.${id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({...body,completed_at:new Date().toISOString()})})};
async function run(env){
  required(env,"SUPABASE_URL");required(env,"SUPABASE_SERVICE_ROLE_KEY");required(env,"STRIPE_SECRET_KEY");
  const runId=await startRun(env);let paid=0,failed=0,processed=0,registrationEmails=0,billingEmails=0;
  try{
    try{registrationEmails=await sendRegistrationLifecycleEmails(env)}catch(error){console.error(JSON.stringify({event:"registration_email_run_failed",error:error instanceof Error?error.message:String(error)}))}
    try{billingEmails=await sendQueuedBillingFailureEmails(env)}catch(error){console.error(JSON.stringify({event:"billing_email_queue_run_failed",error:error instanceof Error?error.message:String(error)}))}
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
    const summary={processed,paid,failed,registrationEmails,billingEmails};await finishRun(env,runId,{status:"completed",processed_count:processed,paid_count:paid,failed_count:failed,error_message:null});console.log(JSON.stringify({event:"automatic_billing_completed",...summary}));return summary;
  }catch(error){const message=error instanceof Error?error.message:String(error);await finishRun(env,runId,{status:"failed",processed_count:processed,paid_count:paid,failed_count:failed,error_message:message.slice(0,1000)});throw error}
}
export default{async fetch(request,env){if(new URL(request.url).pathname==="/health"){try{const response=await fetch("https://api.stripe.com/v1/account",{headers:{authorization:`Bearer ${required(env,"STRIPE_SECRET_KEY")}`}});const account=await response.json().catch(()=>({}));const stripeReady=response.ok&&account.id===EXPECTED_STRIPE_ACCOUNT_ID;return new Response(JSON.stringify({ok:stripeReady,service:"club-atletas-billing-collector",stripeReady}),{status:stripeReady?200:503,headers:H})}catch{return new Response(JSON.stringify({ok:false,service:"club-atletas-billing-collector",stripeReady:false}),{status:503,headers:H})}}return new Response("Not found",{status:404})},async scheduled(event,env,ctx){ctx.waitUntil(run(env).catch(error=>{console.error("Automatic billing run failed",error instanceof Error?error.message:String(error));throw error}))}};

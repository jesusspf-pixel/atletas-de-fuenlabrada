type Env={SUPABASE_URL?:string;SUPABASE_SERVICE_ROLE_KEY?:string};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8"}});
export const onRequestPost:PagesFunction<Env>=async({request,env})=>{
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:"Servicio no configurado."},503);
 const authorization=request.headers.get("authorization")||""; if(!authorization.startsWith("Bearer "))return json({error:"Inicia sesión de nuevo."},401);
 const service={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,"content-type":"application/json"};
 const auth=await fetch(`${env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization}}); const caller=await auth.json().catch(()=>null) as {id?:string}|null;
 if(!auth.ok||!caller?.id)return json({error:"La sesión ha caducado."},401);
 const body=await request.json().catch(()=>({})) as {athleteId?:string;email?:string;relationship?:string}; const email=String(body.email||"").trim().toLowerCase();
 if(!body.athleteId||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!["padre","madre","tutor_legal"].includes(body.relationship||""))return json({error:"Revisa correo y relación familiar."},400);
 const rows=await fetch(`${env.SUPABASE_URL}/rest/v1/athletes?id=eq.${encodeURIComponent(body.athleteId)}&select=id,first_name,last_name,family_id,families(primary_profile_id)`,{headers:service}).then(r=>r.json()) as any[]; const athlete=rows[0]; if(!athlete?.family_id)return json({error:"No se encontró la familia."},404);
 const profile=await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=role`,{headers:service}).then(r=>r.json()) as any[]; const admin=["owner","admin"].includes(profile[0]?.role);
 if(!admin&&athlete.families?.primary_profile_id!==caller.id)return json({error:"No puedes añadir tutores a esta familia."},403);
 let profiles=await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?email=ilike.${encodeURIComponent(email)}&select=id,email,full_name`,{headers:service}).then(r=>r.json()) as any[]; let target=profiles[0];
 if(!target){const invite=await fetch(`${env.SUPABASE_URL}/auth/v1/invite?redirect_to=${encodeURIComponent(new URL(request.url).origin+'/?access=1')}`,{method:"POST",headers:service,body:JSON.stringify({email,data:{role:"parent",family_id:athlete.family_id}})}); target=await invite.json().catch(()=>null); if(!invite.ok||!target?.id)return json({error:target?.msg||target?.message||"No se pudo enviar la invitación."},502); await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?on_conflict=id`,{method:"POST",headers:{...service,Prefer:"resolution=merge-duplicates"},body:JSON.stringify({id:target.id,email,full_name:email.split('@')[0],role:"parent"})});}
 const saved=await fetch(`${env.SUPABASE_URL}/rest/v1/family_guardians?on_conflict=family_id,profile_id`,{method:"POST",headers:{...service,Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify({family_id:athlete.family_id,profile_id:target.id,relationship:body.relationship,access_status:"active",added_by:caller.id})});
 if(!saved.ok)return json({error:"No se pudo vincular el tutor."},502); return json({ok:true,email,existing:Boolean(profiles[0])});
};

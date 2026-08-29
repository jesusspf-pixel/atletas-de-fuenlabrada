type Env = { ANTHROPIC_API_KEY?: string; SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
type Metrics = { fitness:number; fatigue:number; form:number; weekLoad:number; previousWeekLoad:number; changePercent:number|null; readiness:number|null; dataConfidence:"initial"|"medium_high"; sources:string[]; recentPain:boolean; wellnessEntries:number; runningActivities:number };
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const finite=(value:unknown,fallback=0)=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:fallback};
async function rows<T>(url:string,headers:HeadersInit):Promise<T[]>{const response=await fetch(url,{headers});return response.ok?await response.json() as T[]:[]}

export const onRequestPost:PagesFunction<Env>=async({request,env})=>{
  if(!env.ANTHROPIC_API_KEY||!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:"El análisis avanzado todavía no está activo."},503);
  if(Number(request.headers.get("content-length")||0)>16_384)return json({error:"Solicitud demasiado grande."},413);
  const authorization=request.headers.get("authorization")||"";
  if(!authorization.startsWith("Bearer "))return json({error:"Inicia sesión de nuevo."},401);
  const authResponse=await fetch(`${env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization}});
  const user=await authResponse.json().catch(()=>null) as {id?:string}|null;
  if(!authResponse.ok||!user?.id)return json({error:"La sesión ha caducado."},401);
  const input=await request.json().catch(()=>null) as {athleteId?:string;metrics?:Partial<Metrics>}|null;
  const athleteId=String(input?.athleteId||"");
  if(!/^[0-9a-f-]{36}$/i.test(athleteId)||!input?.metrics)return json({error:"Datos de rendimiento no válidos."},400);
  const serviceHeaders={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`};
  const[profile]=await rows<{role?:string}>(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`,serviceHeaders);
  const[athlete]=await rows<{user_profile_id?:string|null;family_id?:string|null;training_group_id?:string|null}>(`${env.SUPABASE_URL}/rest/v1/athletes?id=eq.${encodeURIComponent(athleteId)}&select=user_profile_id,family_id,training_group_id`,serviceHeaders);
  if(!athlete)return json({error:"Atleta no encontrado."},404);
  let allowed=athlete.user_profile_id===user.id||["owner","admin"].includes(profile?.role||"");
  if(!allowed&&athlete.family_id){const guardians=await rows<{id:string}>(`${env.SUPABASE_URL}/rest/v1/family_guardians?family_id=eq.${encodeURIComponent(athlete.family_id)}&profile_id=eq.${encodeURIComponent(user.id)}&access_status=eq.active&select=id&limit=1`,serviceHeaders);allowed=guardians.length>0}
  if(!allowed&&profile?.role==="coach"&&athlete.training_group_id){const assignments=await rows<{training_group_id:string}>(`${env.SUPABASE_URL}/rest/v1/training_group_coaches?training_group_id=eq.${encodeURIComponent(athlete.training_group_id)}&coach_profile_id=eq.${encodeURIComponent(user.id)}&select=training_group_id&limit=1`,serviceHeaders);allowed=assignments.length>0}
  if(!allowed)return json({error:"No tienes permiso para analizar a este atleta."},403);
  const raw=input.metrics;
  const metrics:Metrics={fitness:finite(raw.fitness),fatigue:finite(raw.fatigue),form:finite(raw.form),weekLoad:Math.max(0,finite(raw.weekLoad)),previousWeekLoad:Math.max(0,finite(raw.previousWeekLoad)),changePercent:raw.changePercent===null?null:finite(raw.changePercent),readiness:raw.readiness===null?null:Math.max(0,Math.min(100,finite(raw.readiness))),dataConfidence:raw.dataConfidence==="medium_high"?"medium_high":"initial",sources:Array.isArray(raw.sources)?raw.sources.map(String).slice(0,5):[],recentPain:Boolean(raw.recentPain),wellnessEntries:Math.max(0,Math.round(finite(raw.wellnessEntries))),runningActivities:Math.max(0,Math.round(finite(raw.runningActivities)))};
  const system=`Eres un asistente de análisis de carga para un club de atletismo. Responde en español de España, con lenguaje claro y profesional. Analiza exclusivamente las métricas aportadas, que son estimaciones deportivas y no un diagnóstico. No inventes datos. Si faltan datos, baja la confianza y dilo. Si recentPain es true, recomienda comunicarlo al entrenador y valorar atención sanitaria si persiste, sin diagnosticar. No prescribas cambios de entrenamiento como órdenes: formula recomendaciones para revisar con el entrenador. Devuelve únicamente JSON válido con esta forma: {"headline":"máximo 8 palabras","summary":"2 o 3 frases","actions":["máximo 3 acciones breves"],"confidence":"baja|media|alta","alert":true|false}.`;
  const claudeResponse=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"content-type":"application/json","x-api-key":env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},body:JSON.stringify({model:"claude-sonnet-5",max_tokens:500,system,messages:[{role:"user",content:`Interpreta estas métricas agregadas y anónimas de los últimos 90 días: ${JSON.stringify(metrics)}`}]})});
  const claude=await claudeResponse.json().catch(()=>null) as {content?:Array<{type?:string;text?:string}>;error?:{message?:string}}|null;
  if(!claudeResponse.ok){console.error(JSON.stringify({event:"performance_insight_failed",status:claudeResponse.status,message:claude?.error?.message||"unknown"}));const billing=claudeResponse.status===402||/credit|billing|balance/i.test(claude?.error?.message||"");return json({error:billing?"Claude está conectado, pero falta activar saldo en la cuenta.":"El análisis inteligente no está disponible ahora mismo."},503)}
  const output=claude?.content?.find(item=>item.type==="text")?.text||"";
  try{const parsed=JSON.parse(output) as {headline?:string;summary?:string;actions?:string[];confidence?:string;alert?:boolean};if(!parsed.headline||!parsed.summary||!Array.isArray(parsed.actions))throw new Error("invalid response");return json({insight:{headline:String(parsed.headline).slice(0,100),summary:String(parsed.summary).slice(0,800),actions:parsed.actions.map(String).slice(0,3),confidence:["baja","media","alta"].includes(parsed.confidence||"")?parsed.confidence:"media",alert:Boolean(parsed.alert)}})}catch{return json({error:"Claude no devolvió un análisis válido. Inténtalo de nuevo."},502)}
};

type Env = { ANTHROPIC_API_KEY?: string; ANTHROPIC_WORKSPACE_ID?: string; SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
type Input = { groupId?:string; weekStartsOn?:string; startingPoint?:string; objective?:string; targetDate?:string; constraints?:string; previousPlans?:string; documents?:Array<{name?:string;data?:string}> };
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const headers=(env:Env)=>({apikey:env.SUPABASE_SERVICE_ROLE_KEY||"",authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY||""}`});
async function rows<T>(url:string,init:RequestInit):Promise<T[]>{const response=await fetch(url,init);return response.ok?await response.json() as T[]:[]}
const clean=(value:unknown,max=6000)=>String(value||"").trim().slice(0,max);
const runningTypes=new Set(["run","running","virtualrun","trailrun","trail_running"]);

export const onRequestPost:PagesFunction<Env>=async({request,env})=>{
  if(!env.ANTHROPIC_API_KEY||!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:"El copiloto de planificación todavía no está disponible."},503);
  const authorization=request.headers.get("authorization")||"";
  if(!authorization.startsWith("Bearer "))return json({error:"Inicia sesión de nuevo."},401);
  const auth=await fetch(`${env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization}});
  const user=await auth.json().catch(()=>null) as {id?:string;email?:string}|null;
  if(!auth.ok||!user?.id)return json({error:"La sesión ha caducado."},401);
  const email=String(user.email||"").replace(/\s/g,"").toLowerCase();
  if(email!=="eatletismourjc@gmail.com")return json({error:"Este piloto está reservado al responsable de planificación de Running A."},403);
  const input=await request.json().catch(()=>null) as Input|null;
  if(!input?.groupId||!input.weekStartsOn||!clean(input.startingPoint)||!clean(input.objective))return json({error:"Faltan el grupo, la semana, el punto de partida o el objetivo."},400);
  const serviceHeaders=headers(env);
  const [group]=await rows<{id:string;name:string;schedule_days?:string;starts_at?:string;ends_at?:string}>(`${env.SUPABASE_URL}/rest/v1/training_groups?id=eq.${encodeURIComponent(input.groupId)}&select=id,name,schedule_days,starts_at,ends_at`,{headers:serviceHeaders});
  if(!group||!/^(?:(?:m[aá]ster\s+)?running\s*a|m[aá]ster\s+running)$/i.test(group.name.trim()))return json({error:"El piloto solo está habilitado para el grupo de Running A."},403);
  const assignment=await rows<{training_group_id:string}>(`${env.SUPABASE_URL}/rest/v1/training_group_coaches?training_group_id=eq.${encodeURIComponent(group.id)}&coach_profile_id=eq.${encodeURIComponent(user.id)}&select=training_group_id&limit=1`,{headers:serviceHeaders});
  if(!assignment.length)return json({error:"Tu cuenta no figura como planificadora de Running A."},403);
  const athletes=await rows<{id:string}>(`${env.SUPABASE_URL}/rest/v1/athletes?training_group_id=eq.${encodeURIComponent(group.id)}&club_status=eq.active&select=id`,{headers:serviceHeaders});
  const athleteIds=athletes.map(item=>item.id);
  const since=new Date();since.setDate(since.getDate()-56);
  let activities:any[]=[];let feedback:any[]=[];
  if(athleteIds.length){
    const encoded=`(${athleteIds.join(",")})`;
    [activities,feedback]=await Promise.all([
      rows<any>(`${env.SUPABASE_URL}/rest/v1/external_sport_activities?athlete_id=in.${encodeURIComponent(encoded)}&started_at=gte.${encodeURIComponent(since.toISOString())}&select=athlete_id,activity_type,started_at,distance_m,moving_time_s,average_heartrate,relative_effort`,{headers:serviceHeaders}),
      rows<any>(`${env.SUPABASE_URL}/rest/v1/athlete_training_feedback?athlete_id=in.${encodeURIComponent(encoded)}&session_date=gte.${since.toISOString().slice(0,10)}&select=athlete_id,session_date,duration_minutes,rpe,fatigue_feeling,pain_or_discomfort,sleep_quality`,{headers:serviceHeaders}),
    ]);
  }
  const runs=activities.filter(item=>runningTypes.has(String(item.activity_type||"").toLowerCase()));
  const aggregate={athletes:athleteIds.length,runnersWithData:new Set([...runs.map(x=>x.athlete_id),...feedback.map(x=>x.athlete_id)]).size,runs:runs.length,totalKm:Math.round(runs.reduce((sum,x)=>sum+Number(x.distance_m||0),0)/100)/10,totalMinutes:Math.round(runs.reduce((sum,x)=>sum+Number(x.moving_time_s||0),0)/60),averageRpe:feedback.length?Math.round(feedback.reduce((sum,x)=>sum+Number(x.rpe||0),0)/feedback.length*10)/10:null,feedbackEntries:feedback.length,painReports:feedback.filter(x=>x.pain_or_discomfort).length,averageFatigue:feedback.length?Math.round(feedback.reduce((sum,x)=>sum+Number(x.fatigue_feeling||0),0)/feedback.length*10)/10:null};
  const content:any[]=[{type:"text",text:`Genera el borrador de la semana ${input.weekStartsOn} para ${group.name}. Horario habitual: ${group.schedule_days||"no indicado"}, ${group.starts_at||""}-${group.ends_at||""}. Punto de partida: ${clean(input.startingPoint)}. Objetivo: ${clean(input.objective)}. Fecha objetivo: ${clean(input.targetDate,40)||"no indicada"}. Condicionantes: ${clean(input.constraints)||"ninguno indicado"}. Planes anteriores o criterio pegado por el entrenador: ${clean(input.previousPlans,12000)||"no aportado"}. Datos agregados y no identificativos de las últimas 8 semanas: ${JSON.stringify(aggregate)}.`}];
  for(const document of (input.documents||[]).slice(0,5))if(document.data&&document.data.length<9_000_000)content.push({type:"document",source:{type:"base64",media_type:"application/pdf",data:document.data},title:clean(document.name,120)||"Plan anterior"});
  const system=`Eres copiloto de un entrenador de atletismo experto. Tu trabajo es proponer, nunca publicar ni sustituir su criterio. Usa los planes aportados para respetar su metodología. Ajusta progresión, recuperación y especificidad al objetivo; si la cobertura de datos es baja, sé conservador. No identifiques atletas ni hagas diagnósticos. Devuelve exclusivamente JSON válido con {"title":"...","sessions":{"Lunes":session,...,"Domingo":session},"rationale":"..."}. Cada session debe incluir strings: objective,warmup,technique,main,cooldown,notes,duration,rpe,volume,intensity. intensity solo puede ser Baja, Media, Alta o Competición. Deja vacíos los días de descanso, excepto notes si conviene explicar descanso. Duración y RPE deben ser strings numéricos.`;
  const callClaude=async(model:string)=>{
    const anthropicHeaders:Record<string,string>={"content-type":"application/json","x-api-key":env.ANTHROPIC_API_KEY||"","anthropic-version":"2023-06-01"};
    if(env.ANTHROPIC_WORKSPACE_ID)anthropicHeaders["anthropic-workspace-id"]=env.ANTHROPIC_WORKSPACE_ID;
    const response=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:anthropicHeaders,body:JSON.stringify({model,max_tokens:3500,system,messages:[{role:"user",content}]})});
    return {response,result:await response.json().catch(()=>null) as any};
  };
  const models=["claude-sonnet-5","claude-haiku-4-5-20251001","claude-sonnet-4-20250514","claude-3-5-haiku-20241022"];
  let response:Response|null=null;let result:any=null;
  for(const model of models){
    ({response,result}=await callClaude(model));
    if(response.ok)break;
    console.error(JSON.stringify({event:"coach_ai_planner_model_failed",model,status:response.status,type:result?.error?.type||"unknown",message:result?.error?.message||"unknown",requestId:response.headers.get("request-id")||response.headers.get("x-request-id")||"unknown"}));
    if(response.status===401||response.status===403||response.status===429||response.status>=500)break;
  }
  if(!response?.ok){
    const status=response?.status||503;
    const type=String(result?.error?.type||"unknown");
    const providerDetail=clean(result?.error?.message,240).replace(/sk-ant-[a-zA-Z0-9_-]+/g,"[clave protegida]");
    const message=status===401?"La conexión segura del copiloto necesita renovarse.":status===403?"El proveedor de IA no ha autorizado este modelo para la cuenta del club.":status===402||type.includes("billing")||/credit|balance|billing/i.test(providerDetail)?"El servicio de IA no tiene saldo disponible.":status===413?"Los documentos ocupan demasiado. Prueba con menos PDF o archivos más pequeños.":status===429?"El servicio está recibiendo demasiadas solicitudes. Espera un minuto y vuelve a intentarlo.":status===400?`Claude ha rechazado la petición: ${providerDetail||"motivo no especificado"}.`:"El servicio de planificación no ha aceptado la solicitud. Vuelve a intentarlo en unos minutos.";
    return json({error:message,diagnostic:`IA-${status}-${type}`},503);
  }
  const raw=String(result?.content?.find((item:any)=>item.type==="text")?.text||"").replace(/^```json\s*|\s*```$/g,"");
  try{const parsed=JSON.parse(raw);if(!parsed?.sessions||typeof parsed.sessions!=="object")throw new Error("invalid");return json({title:clean(parsed.title,140)||`Running A · Semana ${input.weekStartsOn}`,sessions:parsed.sessions,rationale:clean(parsed.rationale,1200)});}catch{return json({error:"La propuesta no llegó con el formato esperado. Vuelve a intentarlo."},502)}
};
